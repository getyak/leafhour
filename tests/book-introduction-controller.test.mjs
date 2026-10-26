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
  const f=fixture(),pending=f.controller.generate();await f.controller.generate();assert.equal(f.calls.length,1);f.calls[0].reject(Object.assign(Error('PRIVATE TIMEOUT DETAIL'),{name:'TimeoutError'}));await pending;assert.equal(f.states.at(-1).phase,'error');assert.equal(f.states.at(-1).errorKind,'timeout');
  const retry=f.controller.generate();assert.equal(f.calls.length,2);f.calls[1].resolve(answer);await retry;assert.equal(f.states.at(-1).phase,'idle');
});
test('a source description is never overwritten by an explicit generation action',async()=>{
  const f=fixture();f.book.description='既有书目介绍';await f.controller.generate();assert.equal(f.calls.length,0);assert.equal(f.states.at(-1).source,'provided');
});

test('malformed metadata is a read error rather than a false empty introduction',async()=>{
  for(const reply of [{},{source:'provided',text:''},{source:'missing',text:'invented'},{source:'ai',text:'   '},null]){
    const f=fixture(),pending=f.controller.open();f.calls[0].resolve(reply);await pending;
    assert.equal(f.controller.snapshot().phase,'error');
    assert.equal(f.controller.snapshot().errorKind,'load');
  }
});
test('metadata read timeout settles as an error and ignores the late answer',async()=>{
  let finish;const saved=[],states=[];
  const c=createIntroductionController({getBook:()=>structuredClone(readingBook),request:()=>new Promise(r=>finish=r),onChange:s=>states.push(s),onSaved:s=>saved.push(s),timeoutMs:5});
  const pending=c.open();const settled=await Promise.race([pending.then(()=>true),new Promise(r=>setTimeout(()=>r(false),40))]);assert.equal(settled,true,'the read must settle without waiting for a stalled transport');assert.equal(c.snapshot().phase,'error');assert.equal(c.snapshot().errorKind,'timeout');
  finish(answer);await new Promise(setImmediate);assert.equal(saved.length,0);assert.equal(states.at(-1).phase,'error');c.close();
});
test('a duplicate open shares its pending read and owner change fences a late answer',async()=>{
  let owner='one',finish,calls=0;const saved=[];
  const c=createIntroductionController({getBook:()=>readingBook,getOwner:()=>owner,request:()=>{calls++;return new Promise(r=>finish=r);},onSaved:s=>saved.push(s)});
  const first=c.open(),second=c.open();assert.equal(calls,1);owner='two';finish(answer);await Promise.all([first,second]);assert.equal(saved.length,0);c.close();
});
