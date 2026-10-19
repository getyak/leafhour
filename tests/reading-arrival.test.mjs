import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as arrival from '../app/reading-arrival.mjs';

function setup() {
  const timers=new Map(),views=[];let next=0;
  const state=arrival.createArrivalLifecycle({render:view=>views.push(view),schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
  return {state,timers,views,slow(){const fn=[...timers.values()][0];timers.clear();fn?.();}};
}

test('ready content dismisses the arrival immediately and cancels the slow-load reminder',()=>{
  const {state,timers,views}=setup(),ticket=state.start();
  assert.equal(views.at(-1).phase,'loading');
  assert.equal(state.finish(ticket),true);
  assert.deepEqual(views.at(-1),{phase:'hidden',slow:false});
  assert.equal(timers.size,0);
});

test('a late completion or timer from an earlier attempt cannot dismiss or change a retry',()=>{
  const {state,timers,views}=setup(),old=state.start(),oldTimer=[...timers.values()][0],current=state.start();
  oldTimer();assert.equal(views.at(-1).slow,false);
  assert.equal(state.finish(old),false);assert.equal(views.at(-1).phase,'loading');
  assert.equal(state.finish(current),true);assert.equal(views.at(-1).phase,'hidden');
});

test('the slower-load message only appears while that same load remains pending',()=>{
  const {state,views,slow}=setup(),ticket=state.start();slow();
  assert.deepEqual(views.at(-1),{phase:'loading',slow:true});
  state.finish(ticket);assert.equal(views.at(-1).phase,'hidden');
  state.start();assert.deepEqual(views.at(-1),{phase:'loading',slow:false});
});

test('arrival quotes preserve catalog source text, translation provenance and the matching book',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../catalog/manifest.json',import.meta.url)));
  for(const book of catalog.filter(book=>book.format!=='structured')){
    const quote=arrival.arrivalQuote(book.id);
    assert.equal(quote.bookId,book.id);
    assert.equal(quote.sourceUrl,book.sourceUrl);
    const source=(await readFile(new URL('../catalog/'+book.file,import.meta.url),'utf8')).replace(/[_\s]+/g,' ');
    assert.ok(source.includes(quote.original.replace(/[_\s]+/g,' ')),book.id+' quote must exist verbatim in its source');
    const translations=JSON.parse(await readFile(new URL('../catalog/translations/'+book.id+'.zh.json',import.meta.url)));
    const passage=translations.passages.find(row=>row.id===quote.passageId);
    assert.ok(passage.translations[quote.variant].text.includes(quote.translation));
    assert.equal(quote.status,passage.translations[quote.variant].status);
    assert.equal(quote.contentVersion,translations.contentVersion);
  }
});

test('an unknown or private book never displays an unrelated catalog quote',()=>{
  assert.equal(arrival.arrivalQuote('private-book'),null);
  assert.equal(arrival.arrivalQuote(null),null);
  assert.equal(arrival.arrivalQuote('gutenberg-alice').context,'书中一句');
});

test('the ending companion reuses the paper drawing in a decorative bookmark pose without floating leaves',()=>{
  const doc={createElement:tag=>({tag,children:[],className:'',setAttribute(name,value){this[name]=value;},append(...nodes){this.children.push(...nodes);}})};
  const ending=arrival.createPaperCompanion(doc,{pose:'bookmark'});
  assert.match(ending.className,/paper-companion-bookmark/);assert.equal(ending['aria-hidden'],'true');
  const classes=node=>[node.className,...node.children.flatMap(classes)];
  assert.ok(classes(ending).includes('arrival-bookmark'));assert.ok(classes(ending).includes('arrival-face'));
  assert.ok(!classes(ending).some(name=>name.includes('arrival-leaf')));
  const loading=arrival.createPaperCompanion(doc);assert.ok(classes(loading).includes('arrival-page arrival-page-turn'));
});


test('a loaded book excerpt uses only the requested book and preserves original source identity',()=>{
  const book={bookId:'private-book',contentVersion:'v1',sourceLanguage:'zh',title:{zh:'自己的书'},author:'原作者',chapters:[{id:'ch1',title:{zh:'第一章'}}],sections:[{chapterId:'ch1',paragraphs:[{id:'p1',original:'这是一段来自当前书籍的原文，没有为了等待页新增 AI 翻译。'}]}]};
  const quote=arrival.arrivalBookQuote(book,{bookId:'private-book'});
  assert.equal(quote.bookId,book.bookId);assert.equal(quote.passageId,'p1');assert.equal(quote.contentVersion,'v1');
  assert.equal(quote.original,book.sections[0].paragraphs[0].original);assert.equal(quote.translation,null);assert.equal(quote.sourceLanguage,'zh');
  assert.equal(quote.title,'自己的书');assert.equal(quote.author,'原作者');
  assert.equal(arrival.arrivalBookQuote(book,{bookId:'another-book'}),null);
  const empty=arrival.arrivalBookQuote({...book,sections:[]},{bookId:'private-book'});
  assert.equal(empty.title,'自己的书');assert.equal(empty.original,null);
});

function mountFixture(bookId){
  class Element {
    constructor(){this.children=[];this.dataset={};this.hidden=false;this.classList={add(){},toggle(){}};}
    setAttribute(){} removeAttribute(){} addEventListener(){} removeEventListener(){} append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;}
  }
  const doc={defaultView:{location:{search:'?book='+bookId,reload(){}}},createElement:()=>new Element()};
  const root=new Element();root.ownerDocument=doc;root.dataset.readingArrival='reader';
  return {root,controller:arrival.mountReadingArrival(root)};
}
test('arrival content updates reject another book, a finished request and an earlier retry ticket',()=>{
  const {root,controller}=mountFixture('private-book');
  const book={bookId:'private-book',title:{zh:'真实书名'},author:'作者',sourceLanguage:'zh',sections:[{paragraphs:[{id:'p1',original:'此处内容来自当前加载的书籍，不能显示另一人的书籍。'}]}]};
  const find=name=>root.children.find(node=>node.className===name);
  assert.equal(find('arrival-quote').hidden,true);assert.equal(find('arrival-source').hidden,true);
  const first=controller.start();assert.equal(controller.setBook({...book,bookId:'other'},first),false);
  assert.equal(controller.setBook(book,first),true);assert.match(find('arrival-source').textContent,/真实书名/);assert.equal(find('arrival-quote').lang,'zh');
  const second=controller.start();assert.equal(find('arrival-quote').hidden,true);assert.equal(controller.setBook(book,first),false);
  controller.finish(second);assert.equal(root.hidden,true);assert.equal(controller.setBook(book,second),false);
});
test('arrival excerpt work is bounded and never labels untranslated original as an AI translation',()=>{
  const long='Source paragraph. '.repeat(100),book={bookId:'b',title:'Actual title',sections:[{chapterId:'c',paragraphs:[{id:'p',original:long}]}]};
  const quote=arrival.arrivalBookQuote(book,{bookId:'b'});
  assert.equal(quote.original,'Source paragraph.');assert.equal(quote.translation,null);
});


test('long arrival text stops at a word boundary and remains an exact source prefix',async()=>{
 const {arrivalExcerpt}=await import('../app/arrival-excerpt.mjs');
 for(const original of ['Long source paragraph without terminal punctuation '.repeat(20),'字'.repeat(400),'😀'.repeat(200)]){
  const excerpt=arrivalExcerpt(original);assert.ok([...excerpt].length<=161);assert.ok(excerpt.endsWith('…'));assert.ok(original.startsWith(excerpt.slice(0,-1)));assert.ok(!excerpt.includes('\ufffd'));
 }
 assert.equal(arrivalExcerpt('Mr. Brown opens a book. Then he reads on.'),'Mr. Brown opens a book.');
 assert.equal(arrivalExcerpt('这是当前书籍的一句原文。接着是第二句原文。'),'这是当前书籍的一句原文。');
});

test('arrival context has an explicit localized descriptor while source and ticket stay stable',async()=>{
 const {requestUiRoute,t}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
 const {root,controller}=mountFixture('gutenberg-alice');const find=name=>root.children.find(n=>n.className===name),quote=find('arrival-quote'),source=find('arrival-source'),literal=quote.textContent;
 try{assert.equal(find('arrival-context').textContent,t('arrival.context.sentence'));for(const code of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(code);assert.ok(find('arrival-quote')===quote);assert.ok(find('arrival-source')===source);assert.equal(quote.textContent,literal);assert.equal(find('arrival-context').textContent,t('arrival.context.sentence'));}assert.equal(controller.finish(),true);}finally{controller.dispose();}
});
