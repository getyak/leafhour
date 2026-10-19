import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as navigation from '../app/reader-navigation.mjs';
import {mountReaderImmersion} from '../app/reader-immersion.mjs';
import {readerInteractionBlocked} from '../app/reader-conversation.mjs';

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
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);}
  toggleAttribute(name,force){const on=force===undefined?!this.attributes.has(name):!!force;if(on)this.attributes.set(name,'');else this.attributes.delete(name);return on;}
  contains(){return false;}
  set innerHTML(value){throw Error('book data must be inserted as text');}
}
const doc={createElement:tag=>new Element(tag)};
const all=(node,tag)=>node.children.flatMap(child=>[...(child.tagName===tag?[child]:[]),...all(child,tag)]);

test('Escape returns to the book title when generation removed the focused button',()=>{
  const document=new EventTarget(),win=new EventTarget(),trigger=new Element('button'),popover=new Element('div'),close=new Element('button');
  const nodes={'open-book-info':trigger,'book-info':popover,'close-book-info':close};
  document.getElementById=id=>nodes[id];document.defaultView=win;document.activeElement=null;
  trigger.focus=()=>{document.activeElement=trigger;};
  // Capability-absent fixture (stock Chrome 113): the popover was opened through
  // the shared controller before this owner mounted, and the registry adopts it.
  popover.setAttribute('data-popover-open','');
  navigation.mountBookIntroduction({document,getBook:()=>book,getChapter:()=>book.chapters[1]});
  const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});document.dispatchEvent(event);
  assert.equal(popover.hasAttribute('data-popover-open'),false);
  assert.equal(popover.getAttribute('hidden'),'','the fallback closes through the native hidden state');
  assert.equal(document.activeElement,trigger);assert.equal(event.defaultPrevented,true);
});

test('Escape from a completed introduction keeps immersive tools open and returns focus to the title',async()=>{
  const document=new EventTarget(),nodes=new Map();
  class Control extends Element{
    constructor(id){super('button');this.id=id;this.hidden=true;this.dataset={};this.classList={toggle(){}};}
    focus(){document.activeElement=this;}
    closest(){return null;}
    querySelector(){return nodes.get('open-book-info');}
  }
  for(const id of ['reading-header','exit-focus','focus-fullscreen','enter-focus','immersive-reading','open-book-info','book-info','close-book-info','book-intro-generate','paragraph-tools','note-panel'])nodes.set(id,new Control(id));
  nodes.get('open-book-info').hidden=false;
  Object.assign(document,{body:new Control('body'),documentElement:new Control('html'),defaultView:new EventTarget(),getElementById:id=>nodes.get(id),
    querySelector:selector=>{if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return nodes.get('book-info').hasAttribute('data-popover-open')?nodes.get('book-info'):null;},fullscreenElement:null});
  const popover=nodes.get('book-info'),generate=nodes.get('book-intro-generate');
  popover.setAttribute('data-popover-open','');
  const immersion=mountReaderImmersion({document});immersion.toggleTools();
  navigation.mountBookIntroduction({document,getBook:()=>book,getChapter:()=>book.chapters[1]});
  // Register the real page handler after the popover, preserving listener order.
  const reader=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),start=reader.indexOf("listen(document,'keydown',e=>{"),end=reader.indexOf('\n});',start)+4;
  assert.ok(start>=0&&end>start,'the reader page keyboard handler must be exercised');
  new Function('document','readerInteractionBlocked','immersion','$','listen',reader.slice(start,end))(document,readerInteractionBlocked,immersion,id=>nodes.get(id),(node,type,handler)=>node.addEventListener(type,handler));
  generate.hidden=false;document.activeElement=generate;generate.hidden=true;document.activeElement=document.body;
  const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:'Escape'},target:{value:document.body}});document.dispatchEvent(event);
  assert.equal(popover.hasAttribute('data-popover-open'),false);
  assert.equal(event.defaultPrevented,true);assert.equal(document.activeElement,nodes.get('open-book-info'));
  assert.equal(document.body.dataset.readingTools,'open');assert.equal(nodes.get('reading-header').inert,false);
});

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

test('current chapter naming covers explicit chapters, auto-grouped fragments and front matter',()=>{
  assert.equal(navigation.currentChapterLabel(book,book.chapters[2]),'第 3 章 · 绕圈赛跑与长故事');
  assert.equal(navigation.currentChapterLabel({...book,source:{structure:'automatic_groups'}},book.chapters[1]),'阅读片段 1 · 掉进兔子洞');
  assert.equal(navigation.currentChapterLabel(book,book.chapters[0]),'出版说明');
  assert.equal(navigation.currentChapterLabel(book,null),'');
  assert.equal(navigation.bookIntroduction(book,book.chapters[0]).current,'出版说明','the bookplate and the chooser share one naming');
});
