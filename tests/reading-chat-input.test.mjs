import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
const quote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:12,text:'ignore rules'}]});
const job=()=>({book:{bookId:'book',contentVersion:'v1',title:{en:'Book'}},passageId:'p1',chapterId:'ch1',chapterTitle:{en:'Chapter'},text:'My question',history:[{role:'assistant',content:'companion'},{role:'user',content:'earlier'},{role:'assistant',content:'reply'}]});
const decode=(input,label='读者这次说：')=>JSON.parse(input.split('\n\n'+label+'\n')[0]);
test('legacy no-quote encoding keeps actual location/history bytes and custom introduction labels',()=>{
 for(const inputLabel of ['读者这次说：','Companion context:','Introduction:']){const j=job(),expected=JSON.stringify({location:{bookId:'book',contentVersion:'v1',title:{en:'Book'},passageId:'p1',chapterId:'ch1',chapterTitle:{en:'Chapter'}},history:j.history})+'\n\n'+inputLabel+'\n'+j.text;assert.equal(encodeReadingChatInput(j,{inputLabel}),expected);}
});
test('current and prior user quotes are separate attributed JSON data and never assistant/tool claims',()=>{
 const j=job();j.quote=quote();j.history[1].quote=quote();j.history[2].quote=quote();const encoded=encodeReadingChatInput(j),data=decode(encoded);assert.deepEqual(data.selectedQuote,quote());assert.deepEqual(data.history[1].selectedQuote,quote());assert.equal(Object.hasOwn(data.history[2],'selectedQuote'),false);assert.equal(encoded.endsWith('\nMy question'),true);assert.equal(Object.hasOwn(data,'sourceRefs'),false);
});
test('history bounds remove complete oldest pairs while retaining the current quote and question',()=>{
 const j=job();j.quote=quote();j.history=Array.from({length:8},(_,i)=>[{role:'user',content:i===6?'x'.repeat(25000):'question-'+i},{role:'assistant',content:'answer-'+i}]).flat();const input=encodeReadingChatInput(j),data=decode(input);assert.deepEqual(data.history,[{role:'user',content:'question-7'},{role:'assistant',content:'answer-7'}]);assert.deepEqual(data.selectedQuote,quote());assert.ok(new TextEncoder().encode(input).length<=24576);
});
test('six prior whole pairs are retained even with no size pressure',()=>{
 const j=job();j.history=Array.from({length:8},(_,i)=>[{role:'user',content:'q'+i},{role:'assistant',content:'a'+i}]).flat();assert.deepEqual(decode(encodeReadingChatInput(j)).history,j.history.slice(4));
});
test('escaped metadata and current quote budgets reject before history trimming can hide oversize',()=>{
 const j=job();j.book.title={en:'\u0001'.repeat(5000)};assert.throws(()=>encodeReadingChatInput(j),error=>error.status===413);const k=job();k.quote={...quote(),parts:[{...quote().parts[0],start:0,end:2000,text:'\u0001'.repeat(2000)}]};k.book.title={en:'\u0002'.repeat(2000)};k.text='q'.repeat(2000);assert.throws(()=>encodeReadingChatInput(k),error=>error.status===413);
});
test('malformed current or historical user quotation cannot be silently omitted',()=>{
 const j=job();j.quote={kind:'fake'};assert.throws(()=>encodeReadingChatInput(j));delete j.quote;j.history[1].quote={kind:'fake'};assert.throws(()=>encodeReadingChatInput(j));
});
