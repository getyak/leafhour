import test from 'node:test';
import assert from 'node:assert/strict';
import * as navigation from '../app/reader-navigation.mjs';

const book={title:{zh:'爱丽丝梦游仙境',en:'Alice’s Adventures in Wonderland'},author:'Lewis Carroll',description:'跟着白兔进入一个熟悉的陌生世界。',source:{structure:'source_chapters',url:'https://www.gutenberg.org/ebooks/11'},chapters:[{id:'front',kind:'frontmatter',number:0,title:{zh:'出版说明',en:'Front matter'}},{id:'ch01',kind:'body',number:1,title:{zh:'掉进兔子洞',en:'Down the Rabbit-Hole'}},{id:'ch03',kind:'body',number:3,title:{zh:'绕圈赛跑与长故事',en:'A Caucus-Race and a Long Tale'}}],sections:[{chapterId:'ch01',number:1,title:'开篇',paragraphs:[{id:'p1'}]},{chapterId:'ch03',number:3,title:'长故事',paragraphs:[{id:'p3'}]}]};

test('book introduction uses the loaded book and current chapter without counting front matter as a chapter',()=>{
  const info=navigation.bookIntroduction(book,book.chapters[2]);
  assert.equal(info.title,'爱丽丝梦游仙境');assert.equal(info.author,'Lewis Carroll');
  assert.equal(info.description,'跟着白兔进入一个熟悉的陌生世界。');
  assert.equal(info.extent,'2 章');assert.equal(info.current,'第 3 章 · 绕圈赛跑与长故事');
  assert.equal(info.sourceUrl,'https://www.gutenberg.org/ebooks/11');
});

test('an uploaded book with missing metadata has an honest fallback and cannot turn its source into an executable link',()=>{
  const info=navigation.bookIntroduction({...book,author:'',description:'',source:{structure:'automatic_groups',url:'javascript:alert(1)'}},book.chapters[1]);
  assert.equal(info.author,'');assert.equal(info.description,'这本书还没有简介。');
  assert.equal(info.extent,'3 个阅读片段');assert.equal(info.current,'阅读片段 1 · 掉进兔子洞');assert.equal(info.sourceUrl,null);
  for(const url of ['data:text/html,hello','https://name:password@example.com/','not a URL'])assert.equal(navigation.bookIntroduction({...book,source:{url}}).sourceUrl,null);
});

class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.attributes=new Map();}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(name,value){this.attributes.set(name,value);}
  getAttribute(name){return this.attributes.get(name);}
  set innerHTML(value){throw Error('book data must be inserted as text');}
}
const doc={createElement:tag=>new Element(tag)};
const all=(node,tag)=>node.children.flatMap(child=>[...(child.tagName===tag?[child]:[]),...all(child,tag)]);

test('the contents list opens a source chapter in one click and marks only the current chapter',()=>{
  const list=new Element('nav'),calls=[];
  navigation.renderBookContents({list,book,chapterId:'ch03',document:doc,onNavigate:(...args)=>calls.push(args)});
  const buttons=all(list,'button');assert.equal(buttons.length,3);
  assert.equal(buttons.filter(b=>b.getAttribute('aria-current')==='location').length,1);
  buttons[2].dispatchEvent(new Event('click'));assert.deepEqual(calls,[['ch03']]);
  assert.equal(all(list,'details').length,0);
});

test('books with numbered sections retain direct paragraph anchors in their expandable contents',()=>{
  const list=new Element('nav'),calls=[];
  navigation.renderBookContents({list,book:{...book,source:{structure:'numbered_sections'}},chapterId:'ch03',document:doc,onNavigate:(...args)=>calls.push(args)});
  const details=all(list,'details');assert.equal(details.length,2);assert.equal(details[1].open,true);
  const sectionButton=all(details[1],'button')[0];sectionButton.dispatchEvent(new Event('click'));assert.deepEqual(calls,[['ch03','p3']]);
});

test('the edition scope is visible separately from an editorial description and is absent for unmarked books',()=>{
 assert.equal(navigation.bookIntroduction({...book,source:{...book.source,scopeNote:'本版收录正文，作者序言见出处。'}}).scopeNote,'本版收录正文，作者序言见出处。');
 assert.equal(navigation.bookIntroduction(book).scopeNote,'');
});
