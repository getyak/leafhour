import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createTranslator} from '../server/translation.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createReaderServer} from '../server/server.mjs';

const fixture=async(t,translator)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-translation-cancel-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,catalogDir:null,translator});
 const user={id:'isolated-reader'},book=await library.importDocument(user,{filename:'Synthetic.txt',bytes:Buffer.from('A synthetic first paragraph.\n\nA synthetic second paragraph.')});
 return {library,user,book,id:book.sections[0].paragraphs[0].id};
};

test('already cancelled translation never calls the provider',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return {literal:'L',interpretive:'I'};}),controller=new AbortController();controller.abort();
 await assert.rejects(f.library.translate(f.user,f.book.bookId,f.id,{signal:controller.signal}),e=>e.name==='AbortError');
 assert.equal(calls,0);
});

test('translation passes cancellation out of band and fences a late provider result',async t=>{
 const controller=new AbortController();let deliveredSignal,finish,start,calls=0;
 const began=new Promise(resolve=>start=resolve),f=await fixture(t,async(context,options)=>{assert.equal(Object.hasOwn(context,'signal'),false);deliveredSignal=options?.signal;if(++calls>1)return {literal:'Late literal',interpretive:'Late interpretive'};start();return new Promise(resolve=>finish=resolve);});
 const pending=f.library.translate(f.user,f.book.bookId,f.id,{signal:controller.signal});const rejected=assert.rejects(pending,e=>e.name==='AbortError');
 // A validation failure must not leave this regression waiting forever.
 await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(Error('provider did not start')),1000))]);
 assert.equal(deliveredSignal,controller.signal);controller.abort();finish({literal:'Late literal',interpretive:'Late interpretive'});await rejected;
 assert.deepEqual((await f.library.getBook(f.user,f.book.bookId)).sections[0].paragraphs[0].translations,{});
 const retry=await f.library.translate(f.user,f.book.bookId,f.id);assert.equal(retry.translations.literal.text,'Late literal');
});

test('configured translator aborts its actual provider fetch without serializing the signal',async t=>{
 const controller=new AbortController();let started,requestSignal;
 const began=new Promise(resolve=>started=resolve);
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  requestSignal=options.signal;assert.equal(Object.hasOwn(JSON.parse(JSON.parse(options.body).messages[1].content),'signal'),false);started();
  return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 });
 const pending=createTranslator({DEEPSEEK_API_KEY:'isolated-fixture-only'})({passageId:'p',targetLanguage:'fr'},{signal:controller.signal});
 const rejected=assert.rejects(pending,e=>e.name==='AbortError');await began;controller.abort();await rejected;assert.equal(requestSignal.aborted,true);
});

test('cancellation releases the domain waiter even before an uncooperative provider settles',async t=>{
 const controller=new AbortController();let start,finish,calls=0;
 const began=new Promise(resolve=>start=resolve),f=await fixture(t,async()=>{
  if(++calls>1)return {literal:'Retry literal',interpretive:'Retry interpretive'};
  start();return new Promise(resolve=>finish=resolve);
 });
 t.after(()=>finish?.({literal:'Discarded late literal',interpretive:'Discarded late interpretive'}));
 const pending=f.library.translate(f.user,f.book.bookId,f.id,{signal:controller.signal});
 const rejected=assert.rejects(pending,e=>e.name==='AbortError');await began;controller.abort();
 let timer;try{await Promise.race([rejected,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cancel still waits on provider')),500);})]);}finally{clearTimeout(timer);}
 assert.deepEqual((await f.library.getBook(f.user,f.book.bookId)).sections[0].paragraphs[0].translations,{});
 assert.equal((await f.library.translate(f.user,f.book.bookId,f.id)).translations.literal.text,'Retry literal');
});

test('hosted commit guard runs after asynchronous blob staging and before the CAS commit',async()=>{
 const controller=new AbortController();let commits=0,staged=0;
 const store=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'fixture-only'},fetcher:async(url,options={})=>{
  if(url.includes('/reader_documents?'))return Response.json([]);
  if(url.includes('/storage/')){staged++;controller.abort();return Response.json({});}
  if(url.endsWith('/rpc/reader_document_cas')){commits++;return Response.json(true);}
  throw Error('Unexpected fixture route');
 }});
 await assert.rejects(store.mutate('isolated/translation',{},data=>{data.text='x'.repeat(3500001);},{beforeCommit:()=>controller.signal.throwIfAborted()}),e=>e.name==='AbortError');
 assert.ok(staged>0);assert.equal(commits,0);
});

test('disconnecting translate HTTP aborts server generation and cannot publish late text',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-translation-http-cancel-'));let started,finish,providerSignal;
 const began=new Promise(resolve=>started=resolve);
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,chatGenerator:null,companionGenerator:null,translator:async(_context,options)=>{providerSignal=options?.signal;started();return new Promise(resolve=>finish=resolve);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'Cancel.txt',bytes:Buffer.from('A synthetic source to cancel.')}),id=book.sections[0].paragraphs[0].id;
 let settled;const done=new Promise(resolve=>settled=resolve),translate=server.portal.library.translate;
 server.portal.library.translate=async(...args)=>{try{return await translate(...args);}finally{settled();}};
 const controller=new AbortController(),pending=fetch(base+'/api/library/books/'+book.bookId+'/translate',{method:'POST',signal:controller.signal,headers:{Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id:'cancel-request',passageId:id,contentVersion:book.contentVersion})});
 const rejected=assert.rejects(pending,e=>e.name==='AbortError');await began;assert.ok(providerSignal);controller.abort();await rejected;
 for(let attempt=0;attempt<100&&!providerSignal.aborted;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(providerSignal.aborted,true);finish({literal:'Late literal',interpretive:'Late interpretive'});await done;
 assert.deepEqual((await server.portal.library.getBook(session.user,book.bookId)).sections[0].paragraphs[0].translations,{});
});

async function lostCommitFixture(t,{hideReceipt=false}={}){
 const {createCreditGate}=await import('../server/credit-gate.mjs'),{createBillingService}=await import('../server/billing-service.mjs'),{createBillingMemoryStore}=await import('../server/billing-memory-store.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-translation-ack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const rows=new Map(),blobs=new Map();let loseAck=true,hidden=false,calls=0;
 const dataStore={
  read:async(key,fallback)=>{if(hidden&&key.includes('/translations/'))throw Object.assign(Error('Synthetic receipt temporarily unavailable'),{status:503});return structuredClone(rows.get(key)??fallback);},
  mutate:async(key,fallback,operation,options={})=>{
   const data=structuredClone(rows.get(key)??fallback),result=await operation(data);await options.beforeCommit?.();rows.set(key,structuredClone(data));
   if(key.includes('/translations/')&&loseAck){loseAck=false;hidden=hideReceipt;throw Object.assign(Error('Synthetic lost commit acknowledgement'),{status:503});}
   return result;
  },
  putBlob:async(key,bytes)=>{blobs.set(key,Buffer.from(bytes));},blob:async key=>Buffer.from(blobs.get(key))
 };
 const library=await createLibraryService({dataDir:dir,catalogDir:null,dataStore,translator:async()=>{calls++;return {literal:'Saved literal',interpretive:'Saved interpretive'};}}),user={id:'isolated-ack-reader'};
 const book=await library.importDocument(user,{filename:'Ack.txt',bytes:Buffer.from('A synthetic source for acknowledgement recovery.')}),id=book.sections[0].paragraphs[0].id;
 const store=createBillingMemoryStore(),billing=createBillingService({enabled:true,store}),gate=createCreditGate({billing,library});await billing.trial({ownerId:user.id,verified:true});
 const input={id:'same-original-request',passageId:id,contentVersion:book.contentVersion},quote=await gate.quote(user,{action:'translation',bookId:book.bookId,input});let authority;
 const run=()=>gate.run({user,action:'translation',bookId:book.bookId,input:{...input,billing:{quoteId:quote.id,idempotencyKey:input.id}},execute:async(body,receipt)=>{authority=receipt;return library.translate(user,book.bookId,body.passageId,{expectedContentVersion:book.contentVersion,generationReceipt:receipt});}});
 return {library,user,book,input,billing,gate,run,unhide:()=>{hidden=false;},authority:()=>authority,calls:()=>calls};
}

test('lost domain commit acknowledgement verifies the persisted matching receipt and settles once',async t=>{
 const f=await lostCommitFixture(t);assert.equal((await f.run()).translations.literal.text,'Saved literal');assert.equal(f.calls(),1);
 assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:f.authority().operationId})).status,'settled');
 assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1000000);
 await f.gate.run({user:f.user,action:'translation',bookId:f.book.bookId,input:f.input,execute:()=>assert.fail('saved request must not redispatch')});assert.equal(f.calls(),1);
});

test('unreadable post-commit receipt keeps the original operation recoverable without redispatch',async t=>{
 const f=await lostCommitFixture(t,{hideReceipt:true});await assert.rejects(f.run(),{status:503});
 assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:f.authority().operationId})).status,'running');assert.equal(f.calls(),1);
 f.unhide();await f.gate.recover(f.user);assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:f.authority().operationId})).status,'settled');
 assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1000000);
 await f.gate.run({user:f.user,action:'translation',bookId:f.book.bookId,input:f.input,execute:()=>assert.fail('recovery must not redispatch')});assert.equal(f.calls(),1);
});
