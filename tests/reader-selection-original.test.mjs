import test from 'node:test';
import assert from 'node:assert/strict';
import {originalSelectionParts,mountReaderSelectionOriginal} from '../app/reader-selection-original.mjs';
import {fixture} from './annotation-dom-fixture.mjs';

const book={bookId:'b',contentVersion:'v1',sourceLanguage:'en',chapters:[{id:'c',number:1}],sections:[{chapterId:'c',number:1,paragraphs:[{id:'p1',original:'First 🌱 sentence. Second sentence.',translations:{interpretive:{text:'第一句。第二句。'}}},{id:'p2',original:'Literal **user Markdown** stays literal.',translations:{interpretive:{text:'另一段。'}}}]}]};
const snapshot=parts=>({bookId:'b',contentVersion:'v1',chapterId:'c',parts});
test('source inspection preserves an exact original slice and immutable snapshot',()=>{
 const source=book.sections[0].paragraphs[0].original,start=source.indexOf('🌱'),end=source.indexOf(' Second');
 const quote=snapshot([{passageId:'p1',language:'en',variant:'interpretive',start,end,text:source.slice(start,end)}]),before=structuredClone(quote);
 assert.deepEqual(originalSelectionParts(book,quote),[{passageId:'p1',language:'en',start,end,text:source.slice(start,end),wholePassage:false}]);
 assert.deepEqual(quote,before);
});
test('translated multi-passage selection uses full original context without invented offsets',()=>{
 const quote=snapshot([{passageId:'p1',language:'zh',variant:'interpretive',start:0,end:3,text:'第一句'},{passageId:'p2',language:'zh',variant:'interpretive',start:0,end:4,text:'另一段。'}]);
 const parts=originalSelectionParts(book,quote);
 assert.deepEqual(parts.map(part=>[part.passageId,part.start,part.end,part.wholePassage]),[['p1',0,book.sections[0].paragraphs[0].original.length,true],['p2',0,book.sections[0].paragraphs[1].original.length,true]]);
 assert.equal(parts[1].text,'Literal **user Markdown** stays literal.');
});
test('source inspection refuses wrong book, version and altered text',()=>{
 const quote=snapshot([{passageId:'p1',language:'en',variant:'interpretive',start:0,end:5,text:'First'}]);
 for(const patch of [{bookId:'other'},{contentVersion:'v2'},{parts:[{...quote.parts[0],text:'wrong'}]}])assert.throws(()=>originalSelectionParts(book,{...quote,...patch}));
});
test('mounted source view uses public emphasis, keeps private Markdown literal, and closes on ownership changes',()=>{
 for(const visibility of ['public','private']){
  const {document}=fixture('<body><dialog id="source"></dialog><div id="content"></div></body>'),dialog=document.getElementById('source'),content=document.getElementById('content');
  const current=structuredClone(book);current.visibility=visibility;current.source={format:'txt'};current.sections[0].paragraphs[0].original='A _bold_ sentence.';
  const text=current.sections[0].paragraphs[0].original,quote=snapshot([{passageId:'p1',language:'en',start:0,end:text.length,text}]);let opened=0,visible=true;
  const view=mountReaderSelectionOriginal({document,dialog,content,listen:(node,event,handler)=>node.addEventListener(event,handler),write:(node,id)=>{node.textContent=id;},getBook:()=>current,getExcerpt:()=>quote,isVisible:()=>visible,onOpen:()=>opened++});
  view.open();assert.equal(dialog.open,true);assert.equal(opened,1);assert.equal(content.querySelector('blockquote').textContent,text);assert.equal(content.querySelectorAll('em').length,visibility==='public'?1:0);assert.equal(content.querySelectorAll('.source-syntax').length,visibility==='public'?2:0);
  document.dispatchEvent(new Event('reader:session-changed'));assert.equal(dialog.open,false);assert.equal(content.textContent,'');
  visible=false;assert.throws(()=>view.open());assert.equal(dialog.open,false);view.dispose();
 }
});
