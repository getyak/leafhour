import test from 'node:test';
import assert from 'node:assert/strict';
import {readingBook} from './reading-fixtures.mjs';
const {createIntroductionController}=await import('../app/book-introduction-controller.mjs').catch(()=>({}));
function fixture(){
  assert.equal(typeof createIntroductionController,'function');let book=structuredClone(readingBook);const calls=[],states=[],saved=[];
  const request=(data,options)=>new Promise((resolve,reject)=>calls.push({data,options,resolve,reject}));
  const controller=createIntroductionController({getBook:()=>book,request,onChange:value=>states.push(value),onSaved:value=>saved.push(value)});
  return {controller,calls,states,saved,get book(){return book;},change:()=>book={...book,bookId:'another'}};
}
const answer={source:'ai',text:'一段有限取样的介绍。',introduction:{status:'draft'},available:true};
test('constructing and opening the introduction only reads metadata; generation requires explicit action',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);const open=f.controller.open();assert.equal(f.calls[0].data,undefined);f.calls[0].resolve({source:'missing',text:'',introduction:null,available:true});await open;
  assert.equal(f.calls.length,1);const generate=f.controller.generate();assert.deepEqual(f.calls[1].data,{contentVersion:f.book.contentVersion});f.calls[1].resolve(answer);await generate;assert.equal(f.states.at(-1).text,answer.text);assert.equal(f.saved.length,1);
});
test('closing aborts the request and a provider ignoring abort cannot update or reopen the surface',async()=>{
  const f=fixture(),pending=f.controller.generate();const count=f.states.length;f.controller.close();assert.equal(f.calls[0].options.signal.aborted,true);f.calls[0].resolve(answer);await pending;assert.equal(f.states.length,count);assert.equal(f.saved.length,0);
});
test('changing the current book fences a response even when its request succeeds',async()=>{
  const f=fixture(),pending=f.controller.generate();f.change();f.calls[0].resolve(answer);await pending;assert.equal(f.saved.length,0);assert.notEqual(f.states.at(-1).source,'ai');
});
test('repeated clicks do not issue duplicate POSTs; failure leaves an honest retry',async()=>{
  const f=fixture(),pending=f.controller.generate();await f.controller.generate();assert.equal(f.calls.length,1);f.calls[0].reject(Error('模型超时，请重试'));await pending;assert.equal(f.states.at(-1).phase,'error');assert.match(f.states.at(-1).error,/超时/);
  const retry=f.controller.generate();assert.equal(f.calls.length,2);f.calls[1].resolve(answer);await retry;assert.equal(f.states.at(-1).phase,'idle');
});
test('a source description is never overwritten by an explicit generation action',async()=>{
  const f=fixture();f.book.description='既有书目介绍';await f.controller.generate();assert.equal(f.calls.length,0);assert.equal(f.states.at(-1).source,'provided');
});
