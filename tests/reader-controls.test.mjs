import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as navigation from '../app/reader-navigation.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});

const book={title:{zh:'爱丽丝梦游仙境',en:'Alice’s Adventures in Wonderland'},source:{structure:'source_chapters'},chapters:[{id:'front',kind:'frontmatter',number:0,title:{zh:'出版说明',en:'Front matter'}},{id:'ch01',kind:'body',number:1,title:{zh:'掉进兔子洞',en:'Down the Rabbit-Hole'}},{id:'ch03',kind:'body',number:3,title:{zh:'绕圈赛跑与长故事',en:'A Caucus-Race and a Long Tale'}}],sections:[{chapterId:'ch01',number:1,title:'开篇',paragraphs:[{id:'p1'}]},{chapterId:'ch03',number:3,title:'长故事',paragraphs:[{id:'p3'}]}]};
const grouped={...book,source:{structure:'automatic_groups'},chapters:[{id:'g1',number:1,title:{zh:'第一片段'}},{id:'g2',number:2,title:{zh:'第二片段'}}],sections:[]};

class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.attributes=new Map();this.dataset={};this.disabled=false;this.open=false;this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  focus(){this.focused=true;this.ownerFocus?.(this);}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;this.dispatchEvent(new Event('close'));}}
  set innerHTML(value){throw Error('book data must be inserted as text');}
}
const all=(node,tag)=>node.children.flatMap(child=>[...(child.tagName===tag?[child]:[]),...all(child,tag)]);
function fixture(){
  const focused=[],nodes=new Map(),document=new EventTarget();
  const attach=node=>{node.ownerFocus=target=>focused.push(target);return node;};
  Object.assign(document,{body:attach(new Element('body')),createElement:tag=>attach(new Element(tag)),getElementById:id=>nodes.get(id)||null});
  const add=(id,tag='button')=>{const node=attach(new Element(tag));node.id=id;nodes.set(id,node);return node;};
  return {document,nodes,add,focused};
}

test('the top entry splits the book metadata trigger from a real current-chapter chooser',async()=>{
  const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
  const info=/<button id="open-book-info"[\s\S]*?<\/button>/.exec(html)?.[0],chooser=/<button id="open-chapter"[\s\S]*?<\/button>/.exec(html)?.[0];
  assert.ok(info&&chooser,'both top entries must exist');
  assert.match(info,/id="running-book-title"/);assert.doesNotMatch(info,/id="running-chapter"/,'the metadata trigger must not carry the chapter label');
  assert.match(info,/popovertarget="book-info"/);assert.match(info,/aria-controls="book-info"/);
  assert.match(chooser,/aria-haspopup="dialog"/);assert.match(chooser,/aria-controls="toc-dialog"/);assert.match(chooser,/aria-expanded="false"/);
  assert.match(chooser,/disabled/,'the chooser is disabled before book readiness');assert.match(chooser,/id="running-chapter"/);assert.match(chooser,/<svg[^>]*aria-hidden/,'the chevron is decorative');
  assert.ok(html.indexOf('class="running-entries"')<html.indexOf('id="open-chapter"'),'both entries share the header centre column');
  assert.ok(html.indexOf('id="open-toc"')>0&&html.indexOf('id="settings-chapters"')>0,'the existing directory entries stay available');
});

test('the chapter heading stays quiet and the single listen entry is a 44px side-panel row',async()=>{
  const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
  const heading=/<header class="chapter-heading"[\s\S]*?<\/header>/.exec(html)?.[0];
  assert.ok(heading);assert.equal(heading.includes('<button'),false,'no standalone control inside chapter content');
  assert.equal(html.split('id="listen-chapter"').length-1,1,'exactly one listen entry, one ID');
  const at=html.indexOf('id="listen-chapter"'),panel=html.indexOf('id="reading-tools-panel"'),end=html.indexOf('</section>',panel);
  assert.ok(panel<at&&at<end,'the listen entry lives inside the collapsible reading-tools panel');
  assert.match(html,/id="listen-chapter"[^>]*>Listen to this chapter</,'the raw English shell labels the direct listen entry');assert.match(html,/id="listen-options"[^>]*aria-haspopup="dialog"/,'optional listening modes retain a separate dialog entry');
});

test('the top chapter entry stays disabled until readiness and names the current chapter',()=>{
  const {document,nodes,add}=fixture();
  add('open-chapter');add('running-chapter','span');
  let chapter=null,currentBook=book,opened=0;
  const entry=navigation.mountChapterEntry({document,getBook:()=>currentBook,getChapter:()=>chapter,onOpen:()=>opened++});
  assert.equal(nodes.get('open-chapter').disabled,true);assert.equal(nodes.get('running-chapter').textContent,'选择章节');
  chapter=book.chapters[1];document.dispatchEvent(new Event('reader:ready'));
  assert.equal(nodes.get('open-chapter').disabled,false);assert.equal(nodes.get('running-chapter').textContent,'第 1 章 · 掉进兔子洞');
  chapter=book.chapters[2];document.dispatchEvent(new Event('reader:chapter'));
  assert.equal(nodes.get('running-chapter').textContent,'第 3 章 · 绕圈赛跑与长故事');
  nodes.get('open-chapter').dispatchEvent(new Event('click'));assert.equal(opened,1,'the chooser opens the contents dialog once per activation');
  chapter=grouped.chapters[1];currentBook=grouped;entry.refresh();assert.equal(nodes.get('running-chapter').textContent,'阅读片段 2 · 第二片段','auto-grouped fragments stay labelled as fragments');
  chapter=book.chapters[0];currentBook=book;entry.refresh();assert.equal(nodes.get('running-chapter').textContent,'出版说明','front matter is not mislabelled as a numbered chapter');
  nodes.get('open-chapter').disabled=true;nodes.get('open-chapter').dispatchEvent(new Event('click'));assert.equal(opened,1,'a disabled chooser cannot open');
});

for(const paginated of ['false','true'])test('choosing a chapter closes the chooser and lands in the selected chapter in '+paginated+' pagination mode',()=>{
  const {document,nodes,add,focused}=fixture();
  document.body.dataset.paginated=paginated;
  const dialog=add('toc-dialog','dialog');add('toc-list','nav');add('open-toc');add('open-chapter');const metadata=add('open-book-info');let metadataOpens=0;metadata.addEventListener('click',()=>metadataOpens++);
  let current=book.chapters[1],chosen=null;
  const contents=navigation.mountContentsDialog({document,getBook:()=>book,getChapterId:()=>current.id,onNavigate:id=>{chosen=id;current=book.chapters.find(c=>c.id===id);contents.close();}});
  assert.equal(contents.open(nodes.get('open-chapter')),true);
  assert.equal(dialog.open,true);assert.equal(nodes.get('open-chapter').getAttribute('aria-expanded'),'true');assert.equal(nodes.get('open-toc').getAttribute('aria-expanded'),'false');
  const buttons=all(nodes.get('toc-list'),'button'),marked=buttons.filter(b=>b.getAttribute('aria-current')==='location');
  assert.equal(marked.length,1);assert.equal(buttons.indexOf(marked[0]),1,'the current chapter is indicated in the one contents model');
  buttons[2].dispatchEvent(new Event('click'));
  assert.equal(chosen,'ch03','the selected chapter is the one handed to navigation');
  assert.equal(dialog.open,false,'choosing closes the chooser');
  assert.equal(focused.at(-1),nodes.get('open-chapter'),'focus returns to the actual opener, not the metadata trigger');
  assert.equal(metadataOpens,0);assert.equal(metadata.focused,undefined);
  assert.equal(nodes.get('open-chapter').getAttribute('aria-expanded'),'false');
});

test('Escape returns focus to the actual opener and stale openers fall back to the directory entry',()=>{
  const {document,nodes,add,focused}=fixture();
  const dialog=add('toc-dialog','dialog');add('toc-list','nav');const toc=add('open-toc'),chooser=add('open-chapter');
  const contents=navigation.mountContentsDialog({document,getBook:()=>book,getChapterId:()=>book.chapters[1].id,onNavigate:()=>{}});
  assert.equal(contents.open(chooser),true);dialog.close();
  assert.equal(focused.at(-1),chooser,'Escape closes the dialog and restores the chooser');
  assert.equal(chooser.getAttribute('aria-expanded'),'false');assert.equal(toc.getAttribute('aria-expanded'),'false');
  contents.open(toc);dialog.close();assert.equal(focused.at(-1),toc);
  const stale=add('settings-chapters');stale.closest=selector=>selector.startsWith('dialog')?{open:false}:null;
  contents.open(stale);dialog.close();assert.equal(focused.at(-1),toc,'an opener inside a closed dialog is not focusable; the directory entry receives focus');
});

test('the sidebar listen entry needs explicit activation and navigation requests no audio or providers',async()=>{
  const {document,nodes,add}=fixture();
  const dialog=add('toc-dialog','dialog');add('toc-list','nav');add('open-toc');add('open-chapter');add('running-chapter','span');const listen=add('listen-chapter');
  let listens=0,fetches=0;const realFetch=globalThis.fetch;globalThis.fetch=()=>{fetches++;return Promise.reject(Error('unexpected request'));};
  try{
    navigation.mountListenChapterEntry({document,onListenChapter:()=>listens++});
    let current=book.chapters[1];
    const contents=navigation.mountContentsDialog({document,getBook:()=>book,getChapterId:()=>current.id,onNavigate:id=>{current=book.chapters.find(c=>c.id===id);contents.close();}});
    navigation.mountChapterEntry({document,getBook:()=>book,getChapter:()=>current,onOpen:trigger=>contents.open(trigger)});
    document.dispatchEvent(new Event('reader:ready'));
    nodes.get('open-chapter').dispatchEvent(new Event('click'));
    all(nodes.get('toc-list'),'button')[2].dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('reader:chapter'));
    assert.equal(dialog.open,false);
    assert.equal(listens,0,'opening and changing chapters never reaches the listen handler');
    assert.equal(fetches,0,'navigation performs no audio generation or provider request');
    listen.dispatchEvent(new Event('click'));assert.equal(listens,1,'the current-chapter listen panel opens only from the side-panel row');
    assert.equal(fetches,0);
  }finally{globalThis.fetch=realFetch;}
});

test('the reader shell keeps audio generation out of navigation and the listen handler implicit-free',async()=>{
  const reader=await readFile(new URL('../app/reader.js',import.meta.url),'utf8');
  for(const token of ['/api/audio','/api/guides','/api/dialogues','new Audio','.play('])assert.equal(reader.includes(token),false,'reader.js must not reach '+token+' from navigation code');
  const audio=await readFile(new URL('../app/reader-audio.js',import.meta.url),'utf8');
  const bootstrap=await readFile(new URL('../app/reader-audio-bootstrap.mjs',import.meta.url),'utf8');assert.match(bootstrap,/mountChapter\(\{document,onListenChapter:\(\)=>activate\('listen-chapter'\)\}\)/,'the sidebar row dispatches the first explicit action');
  assert.equal([...audio.matchAll(/showChapter\s*\(/g)].length,2,'showChapter is only defined and invoked by the explicit dispatcher');
});

test('locale preserves an open contents dialog, opener, row identity and scroll without reading the book again',async()=>{
  const {document,nodes,add,focused}=fixture();const dialog=add('toc-dialog','dialog'),list=add('toc-list','nav');add('open-toc');const opener=add('open-chapter');add('running-chapter','span');
  let bookReads=0,chapterReads=0,navigations=0;const getBook=()=>{bookReads++;return book;};
  const contents=navigation.mountContentsDialog({document,getBook,getChapterId:()=>book.chapters[1].id,onNavigate:()=>navigations++});
  const entry=navigation.mountChapterEntry({document,getBook,getChapter:()=>{chapterReads++;return book.chapters[1];},onOpen:target=>contents.open(target)});
  contents.open(opener);list.scrollTop=190;const rows=[...list.children],buttons=all(list,'button'),current=buttons.find(row=>row.getAttribute('aria-current')==='location'),reads={bookReads,chapterReads},focuses=focused.length;
  for(const [code,label]of [['en','Chapter 1 · 掉进兔子洞'],['ja','第1章 · 掉进兔子洞'],['zh-Hant','第 1 章 · 掉进兔子洞']]){
    await requestUiRoute(code);assert.equal(nodes.get('running-chapter').textContent,label);assert.deepEqual(list.children,rows);assert.deepEqual(all(list,'button'),buttons);assert.equal(current.getAttribute('aria-current'),'location');assert.equal(list.scrollTop,190);assert.equal(dialog.open,true);assert.equal(contents.getOpener(),opener);assert.equal(focused.length,focuses);assert.deepEqual({bookReads,chapterReads},reads);assert.equal(navigations,0);
  }
  contents.unmount();entry.unmount();const detached=nodes.get('running-chapter').textContent;await requestUiRoute('en');assert.equal(nodes.get('running-chapter').textContent,detached);
});
