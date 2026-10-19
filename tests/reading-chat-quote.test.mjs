import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReadingChatQuote,validateCurrentReadingChatQuote,validateHistoricalReadingChatQuote,readingChatQuoteFromExcerpt} from '../app/reading-chat-quote.mjs';
const book=()=>({bookId:'book',contentVersion:'v1',sourceLanguage:'zh',sections:[{chapterId:'ch1',paragraphs:[{id:'p1',original:'原文😀 end',translations:{literal:{text:'A literal translation.',status:'draft'},interpretive:{text:'An interpretation.',status:'reviewed'}}},{id:'p2',original:'Second source',translations:{}}]},{chapterId:'ch2',paragraphs:[{id:'p3',original:'Third source'}]}]});
const quote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:2,text:'原文'}]});
const clone=value=>structuredClone(value);
test('exact original and each translation are copied with actual independent status',()=>{
 const b=book(),q=quote();assert.deepEqual(validateCurrentReadingChatQuote(q,b),q);const copy=normalizeReadingChatQuote(q);copy.parts[0].text='different';assert.equal(q.parts[0].text,'原文');
 for(const layer of ['literal','interpretive']){const t=b.sections[0].paragraphs[0].translations[layer],selected={...q,parts:[{passageId:'p1',layer,start:0,end:t.text.length,text:t.text,translationStatus:t.status}]};assert.deepEqual(validateCurrentReadingChatQuote(selected,b),selected);}
});
test('legacy en snapshots denote the original layer even in a Chinese source book',()=>{
 const q=readingChatQuoteFromExcerpt({bookId:'book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',language:'en',variant:'literal',start:0,end:2,text:'原文'}]},book());assert.equal(q.parts[0].layer,'original');assert.equal(Object.hasOwn(q.parts[0],'translationStatus'),false);
 const q2=readingChatQuoteFromExcerpt({bookId:'book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',language:'zh',variant:'literal',start:0,end:1,text:'A'}]},book());assert.equal(q2.parts[0].translationStatus,'draft');
});
const invalid={
 'wrong book':q=>q.bookId='other','wrong version':q=>q.contentVersion='v2','wrong chapter':q=>q.chapterId='ch2','unknown passage':q=>q.parts[0].passageId='unknown','forged text':q=>q.parts[0].text='伪造','bad offsets':q=>q.parts[0].start=-1,'huge offset':q=>{q.parts[0].start=1000000;q.parts[0].end=1000002;},'wrong length':q=>q.parts[0].end=3,'empty':q=>{q.parts[0].text='';q.parts[0].end=0;},'unpaired surrogate':q=>{q.parts[0].text='\ud800';q.parts[0].end=1;},'unknown layer':q=>q.parts[0].layer='notes','original draft spoof':q=>q.parts[0].translationStatus='draft','extra field':q=>q.parts[0].grant='library','duplicate passage':q=>q.parts.push(clone(q.parts[0])),'reversed order':q=>q.parts.unshift({passageId:'p2',layer:'original',start:0,end:6,text:'Second'}),'cross chapter':q=>q.parts.push({passageId:'p3',layer:'original',start:0,end:5,text:'Third'}),'mixed layer':q=>q.parts.push({passageId:'p2',layer:'literal',start:0,end:1,text:'A',translationStatus:'draft'}),'missing translation':q=>q.parts=[{passageId:'p2',layer:'literal',start:0,end:1,text:'A',translationStatus:'draft'}],'spoof reviewed':q=>q.parts=[{passageId:'p1',layer:'literal',start:0,end:1,text:'A',translationStatus:'reviewed'}],'too long':q=>q.parts=[{passageId:'p1',layer:'original',start:0,end:2001,text:'x'.repeat(2001)}],'too many':q=>q.parts=Array.from({length:9},(_,i)=>({passageId:'p'+i,layer:'original',start:0,end:1,text:'x'}))
};
for(const [name,change]of Object.entries(invalid))test('rejects '+name,()=>{const q=quote();change(q);assert.throws(()=>validateCurrentReadingChatQuote(q,book()));});
test('rejects inherited, symbol, accessor and array prototype surprises without invoking getters',()=>{
 for(const change of [q=>Object.setPrototypeOf(q,{grant:true}),q=>q[Symbol('hidden')]=true,q=>Object.defineProperty(q,'extra',{value:true}),q=>Object.defineProperty(q.parts[0],'text',{enumerable:true,get(){throw Error('getter invoked');}}),q=>Object.setPrototypeOf(q.parts,class extends Array{}.prototype)]){const q=quote();change(q);assert.throws(()=>normalizeReadingChatQuote(q),error=>error.status===400);}
});
test('historical snapshots keep edited translations but still require version, chapter and ordered anchors',()=>{
 const b=book(),q={...quote(),parts:[{passageId:'p1',layer:'literal',start:0,end:22,text:'A literal translation.',translationStatus:'draft'}]};assert.deepEqual(validateCurrentReadingChatQuote(q,b),q);b.sections[0].paragraphs[0].translations.literal={text:'New',status:'reviewed'};assert.throws(()=>validateCurrentReadingChatQuote(q,b));assert.deepEqual(validateHistoricalReadingChatQuote(q,b),q);q.parts[0].passageId='unknown';assert.throws(()=>validateHistoricalReadingChatQuote(q,b));
});
test('boundary selection accepts a complete astral character without splitting it',()=>{
 const q={...quote(),parts:[{passageId:'p1',layer:'original',start:2,end:4,text:'😀'}]};assert.deepEqual(validateCurrentReadingChatQuote(q,book()),q);for(const part of [{start:2,end:3,text:'\ud83d'},{start:3,end:4,text:'\ude00'}])assert.throws(()=>validateCurrentReadingChatQuote({...q,parts:[{...q.parts[0],...part}]},book()));
});
