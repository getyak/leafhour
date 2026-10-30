import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './annotation-dom-fixture.mjs';
import {readingBook} from './reading-fixtures.mjs';
import {mountReaderHighlights} from '../app/reader-highlights.mjs';
import {mountReaderAnnotations} from '../app/reader-annotations.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
const quote=()=>({bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,chapterId:'ch01',parts:[{passageId:'p1',language:'en',variant:'interpretive',start:5,end:9,text:'this'}]});

function setup({lazy=null,read=null}={}){
 const f=fixture('<body><main id="book-page"><div id="reading-pages"><div id="chapter-text"><p id="p1">Read this first.</p><p id="p2">Keep your own question.</p></div></div><div id="page-turner"></div></main><div id="paragraph-tools"><button id="show-highlight"></button><button id="annotate-selection"></button></div><p id="highlight-status"></p><textarea id="thought-text"></textarea><button id="elsewhere">Another action</button></body>');
 const book=structuredClone(readingBook),records={highlights:[],comments:[]},saving=gate(),writes=[],storage=new Map();
 f.document.getSelection=()=>null;f.win.getSelection=()=>null;
 f.win.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 f.win.marginaliaPaletteAdapter={getOwner:()=> 'synthetic-owner'};
 f.win.marginaliaReader={getBook:()=>book,getAnchor:()=>({passageId:'p1',chapterId:'ch01'}),captureLayout:()=>()=>true,dismissTools(){}};
 const api=async(url,input)=>{if(input){assert.equal(url,'/api/highlights');writes.push(input);return saving.promise;}if(read)await read.promise;return {archive:{kind:'leafhour-reader-annotations',bookId:book.bookId,threads:[]},requests:[]};};
 const controller=mountReaderHighlights({document:f.document,getRecords:()=>records,signedIn:()=>true,available:()=>true,selectionMatches:()=>false,api,onSelect(){},onNote(){},onChange(){},announce(){},loginUrl:()=>'/library',loadAnnotationModule:async()=>{if(lazy)await lazy.promise;return {mountReaderAnnotations};}});
 const $=id=>f.document.getElementById(id);
 const event=(name,target=$('elsewhere'))=>{const value=new Event(name);Object.defineProperty(value,'target',{value:target});f.document.dispatchEvent(value);};
 const start=()=>{controller.updateTools(quote());$('show-highlight').focus();$('show-highlight').dispatchEvent(new Event('click'));};
 const openExisting=()=>{const row={...quote(),id:'saved'};records.highlights.push(row);const mark=f.document.createElement('mark');mark.className='reader-highlight';mark.dataset.highlightIds=row.id;$('chapter-text').append(mark);event('focusin',$('elsewhere'));const click=new Event('click');Object.defineProperty(click,'target',{value:mark});$('chapter-text').dispatchEvent(click);};
 const finish=async()=>{saving.resolve({...writes[0]});await tick();await tick();};
 return {...f,$,controller,records,event,start,openExisting,finish,dispose:()=>controller.unmount()};
}

for(const intent of ['dismiss','selection','wheel','chapter','note focus','button focus','pointer'])test('a saved highlight respects newer '+intent+' intent while retaining its receipt',async()=>{
 const f=setup();try{
  f.start();
  if(intent==='dismiss')f.controller.updateTools(null);
  if(intent==='selection')f.controller.updateTools({...quote(),parts:[{passageId:'p2',language:'en',variant:'interpretive',start:0,end:4,text:'Keep'}]});
  if(intent==='wheel')f.event('wheel');
  if(intent==='chapter')f.event('reader:chapter');
  if(intent.endsWith('focus')){const target=f.$(intent==='note focus'?'thought-text':'elsewhere');target.focus();f.event('focusin',target);}
  if(intent==='pointer')f.event('pointerdown');
  const focus=f.document.activeElement;await f.finish();
  assert.equal(f.records.highlights.length,1,'the confirmed save must still be adopted');
  assert.ok(!f.document.querySelector('.reader-annotation-card')||f.document.querySelector('.reader-annotation-card').hidden,'an obsolete save must not open its old annotation');
  assert.ok(f.document.activeElement===focus,'an obsolete save must preserve the newer focus');
 }finally{f.dispose();}
});

test('an unchanged highlight action still opens the confirmed annotation',async()=>{
 const f=setup();try{f.start();await f.finish();assert.equal(f.records.highlights.length,1);const card=f.document.querySelector('.reader-annotation-card');assert.equal(card.hidden,false);assert.ok(f.document.activeElement===card.querySelector('.reader-annotation-close'));}finally{f.dispose();}
});

for(const boundary of ['lazy import','annotation read'])test('highlight intent is checked again after '+boundary,async()=>{
 const waiting=gate(),f=setup(boundary==='lazy import'?{lazy:waiting}:{read:waiting});try{
  f.start();await f.finish();f.controller.updateTools(null);f.$('elsewhere').focus();f.event('focusin',f.$('elsewhere'));waiting.resolve();await tick();await tick();
  assert.equal(f.records.highlights.length,1);assert.ok(!f.document.querySelector('.reader-annotation-card')||f.document.querySelector('.reader-annotation-card').hidden);assert.ok(f.document.activeElement===f.$('elsewhere'));
 }finally{waiting.resolve();f.dispose();}
});

for(const boundary of ['lazy import','annotation read'])test('opening an existing mark respects newer reading intent after '+boundary,async()=>{
 const waiting=gate(),f=setup(boundary==='lazy import'?{lazy:waiting}:{read:waiting});try{
  f.openExisting();await tick();f.$('elsewhere').focus();f.event('focusin',f.$('elsewhere'));f.event('wheel');waiting.resolve();await tick();await tick();
  assert.ok(!f.document.querySelector('.reader-annotation-card')||f.document.querySelector('.reader-annotation-card').hidden);assert.ok(f.document.activeElement===f.$('elsewhere'));
 }finally{waiting.resolve();f.dispose();}
});
