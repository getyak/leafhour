import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderServer} from '../server/server.mjs';
import {createCreditGate} from '../server/credit-gate.mjs';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
import {LIBRARY_CHAT_ID,LIBRARY_CHAT_VERSION,LIBRARY_CHAT_PASSAGE} from '../app/library-chat-context.mjs';

const owner={id:'library-chat-owner'},other={id:'library-chat-other'};
const input=(id='account-question',text='A direct conversation without choosing a book.')=>({id,text,contentVersion:LIBRARY_CHAT_VERSION,passageId:LIBRARY_CHAT_PASSAGE});
const answer={kind:'conversation',summary:'A synthetic direct answer.'};
const hash=x=>createHash('sha256').update(x).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup(t,{generator=async()=>answer,clock=Date.now,people=null,dataStore=null}={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'leafhour-account-chat-')),library=await createLibraryService({dataDir,catalogDir:null}),services=[];
 const create=async(options={})=>{const service=await createReaderChatService({library,dataDir,generator,clock,people,dataStore,...options});services.push(service);return service;};
 const service=await create();t.after(async()=>{for(const s of services)await s.close();await rm(dataDir,{recursive:true,force:true});});
 return {library,service,create,dataDir};
}

test('an empty account chats without reading a book, records, notes, or creating book resources',async t=>{
 let calls=0;const {library,service,dataDir}=await setup(t,{people:{update:async()=>assert.fail('No person writes')},generator:async job=>{
  calls++;assert.equal(job.book,null);assert.equal(job.passageId,undefined);assert.equal(job.chapterId,undefined);
  const encoded=encodeReadingChatInput(job),payload=JSON.parse(encoded.split('\n\n读者这次说：\n')[0]);
  assert.deepEqual(payload.location,{scope:'library',currentBook:null});assert.ok(!encoded.includes(LIBRARY_CHAT_ID));
  assert.deepEqual(await job.tools.execute('reader_get_context',{}),{scope:'library',currentBook:null,passages:[]});
  assert.deepEqual((await job.tools.execute('reader_list_books',{})).books,[]);
  assert.ok(!job.tools.definitions.some(d=>['update_preference','delete_preference'].includes(d.name)));
  assert.ok(!job.tools.definitions.some(d=>['people_create','people_update','people_update_items','people_delete','people_restore'].includes(d.name)));
  assert.equal((await job.tools.execute('people_update',{personId:'someone',requestId:'write-person',expectedRevision:1,patch:{originalName:'Changed'}})).error.code,'SCOPE_DENIED');
  for(const inferred of [true,false])assert.equal((await job.tools.execute('update_preference',{baseRevision:0,key:'theme',value:'dark',inferred})).error.code,'SCOPE_DENIED');
  return answer;
 }});
 for(const key of ['getBook','records','addComment','saveProgress','changePreferenceMemory'])library[key]=async()=>{assert.fail('Account conversation must not call '+key);};
 const view=await service.viewLibrary(owner);assert.deepEqual(view.scope,{mode:'library',revision:0});assert.equal(view.context.currentBook,null);assert.equal(view.contentVersion,LIBRARY_CHAT_VERSION);assert.equal(view.context.passageId,LIBRARY_CHAT_PASSAGE);assert.equal(calls,0);
 const turn=await service.sendLibrary(owner,input());assert.equal(turn.status,'completed');assert.equal(calls,1);
 assert.deepEqual((await service.viewLibrary(other)).turns,[]);assert.equal((await service.viewLibrary(owner)).turns.length,1);
 const files=await readdir(path.join(dataDir,'users',hash(owner.id),'chat'));assert.ok(files.includes('account-conversation.json'));assert.ok(!files.includes(hash(LIBRARY_CHAT_ID)+'.json'));
 const exported=await service.exportLibraryHistory(owner);assert.equal(exported.kind,'leafhour-library-chat');assert.equal(exported.conversationId,LIBRARY_CHAT_ID);assert.equal(exported.scope,'library');assert.equal(exported.turns[0].text,input().text);assert.ok(!Object.hasOwn(exported,'bookId'));
});

test('account tools read only explicitly requested real books under the captured owner',async t=>{
 let owned,foreign;const {library,service}=await setup(t,{generator:async job=>{
  assert.equal(job.book,null);
  const listed=await job.tools.execute('reader_list_books',{});assert.deepEqual(listed.books.map(b=>b.bookId),[owned.bookId]);
  assert.ok((await job.tools.execute('reader_get_outline',{bookId:foreign.bookId})).error);
  const page=await job.tools.execute('reader_read_chapter',{bookId:owned.bookId,chapterId:owned.chapters[0].id});
  const passage=page.passages[0];assert.equal(passage.original,'An isolated source sentence.');
  await job.tools.execute('reader_cite',{bookId:owned.bookId,passageId:passage.passageId,quote:passage.original,layer:'original'});
  return answer;
 }});
 owned=await library.importDocument(owner,{filename:'isolated.txt',bytes:Buffer.from('An isolated source sentence.')});
 foreign=await library.importDocument(other,{filename:'other.txt',bytes:Buffer.from('Private to a different account.')});
 const before=await library.records(owner,owned.bookId),result=await service.sendLibrary(owner,input());
 assert.equal(result.answer.sourceRefs[0].bookId,owned.bookId);assert.deepEqual(await library.records(owner,owned.bookId),before);
});

test('account terminal retries preserve exact identity, history survives restart, and book history stays separate',async t=>{
 let calls=0;const jobs=[];const {service,create,library}=await setup(t,{generator:async job=>{calls++;jobs.push(job);return answer;}});
 const first=await service.sendLibrary(owner,input());assert.deepEqual(await service.sendLibrary(owner,input()),first);assert.equal(calls,1);
 await assert.rejects(service.sendLibrary(owner,{...input(),text:'Changed question'}),{status:409});
 const reloaded=await create();assert.deepEqual((await reloaded.viewLibrary(owner)).turns,[first]);
 await reloaded.sendLibrary(owner,input('next-question'));assert.deepEqual(jobs[1].history,[{role:'user',content:input().text},{role:'assistant',content:answer.summary}]);
 const book=await library.importDocument(owner,{filename:'real.txt',bytes:Buffer.from('Real source.')});assert.deepEqual((await service.view(owner,book.bookId)).turns,[]);
 await assert.rejects(service.view(owner,LIBRARY_CHAT_ID),{status:404});
 for(const patch of [{peopleWrites:true},{preferenceWrites:true},{passageId:'fake-passage'},{contentVersion:'fake-version'},{quote:{}}])await assert.rejects(service.sendLibrary(owner,{...input('rejected'),...patch}),{status:400});
 for(const user of [null,{id:'anonymous',is_anonymous:true}]){
  await assert.rejects(service.viewLibrary(user),{status:401});await assert.rejects(service.sendLibrary(user,input()),{status:401});await assert.rejects(service.cancelLibrary(user,input().id),{status:401});await assert.rejects(service.exportLibraryHistory(user),{status:401});
 }
});

test('account cancellation fences another instance and late answers never replace the terminal',async t=>{
 const started=deferred(),held=deferred();const {service,create}=await setup(t,{generator:async job=>{started.resolve(job);await held.promise;return answer;}});
 const pending=service.sendLibrary(owner,input());const job=await started.promise,second=await create();
 await assert.rejects(second.sendLibrary(owner,input()),{status:409});
 await assert.rejects(second.cancelLibrary(other,input().id),{status:404});assert.equal(job.signal.aborted,false);
 const cancelled=await second.cancelLibrary(owner,input().id);assert.equal(cancelled.status,'cancelled');
 const result=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('shared cancellation stalled')),1500))]);
 assert.equal(result.status,'cancelled');assert.equal(job.signal.aborted,true);held.resolve();
 assert.equal((await service.viewLibrary(owner)).turns[0].answer,null);
 assert.equal((await second.sendLibrary(owner,input())).status,'cancelled');
});

test('account expiry uses the infrastructure-aligned lease and rejects late generation',async t=>{
 let now=Date.now(),calls=0;const started=deferred(),held=deferred();const {service}=await setup(t,{clock:()=>now,generator:async job=>{calls++;started.resolve(job);await held.promise;return answer;}});
 const pending=service.sendLibrary(owner,input()),job=await started.promise;now+=300001;
 const expired=(await service.viewLibrary(owner)).turns[0];assert.equal(expired.status,'failed');assert.equal(expired.failureCode,'interrupted');
 held.resolve();const result=await pending;assert.equal(result.status,'failed');assert.equal(result.answer,null);assert.equal(job.signal.aborted,true);
 assert.equal((await service.sendLibrary(owner,input())).status,'failed');assert.equal(calls,1);
});

test('ordinary account conversations run independently across owners',async t=>{
 let calls=0;const {service}=await setup(t,{generator:async()=>{calls++;return answer;}});
 const results=await Promise.all([owner,other,{id:'third-owner'}].map(u=>service.sendLibrary(u,input())));assert.ok(results.every(t=>t.status==='completed'));assert.equal(calls,3);
});

test('account and book requests continue past the old hourly quota',async t=>{
 let now=Date.now(),calls=0;const {service,library}=await setup(t,{clock:()=>now,generator:async()=>{calls++;return answer;}});
 for(let i=0;i<9;i++)await service.sendLibrary(owner,input('question-'+i));
 const book=await library.importDocument(owner,{filename:'quota.txt',bytes:Buffer.from('A quota source.')});
 const bookInput={id:'book-question',text:'One source question.',passageId:book.sections[0].paragraphs[0].id,contentVersion:book.contentVersion};
 assert.equal((await service.send(owner,book.bookId,bookInput)).status,'completed');
 assert.equal((await service.sendLibrary(owner,input('over-quota'))).status,'completed');assert.equal(calls,11);
 now+=3600001;assert.equal((await service.sendLibrary(owner,input('new-hour'))).status,'completed');assert.equal(calls,12);
});

test('account history retains all turns above the old transport budget',async t=>{
 let last;const {service}=await setup(t,{generator:async job=>{last=job;return answer;}});
 for(let i=0;i<8;i++)await service.sendLibrary(owner,input('history-'+i,'question-'+i));
 assert.equal(last.history.length,14);assert.equal(last.history[0].content,'question-0');
 const encoded=encodeReadingChatInput({book:null,text:'Current',history:Array.from({length:8},(_,i)=>[{role:'user',content:'问'.repeat(4000)+i},{role:'assistant',content:'答'.repeat(4000)+i}]).flat()});
 assert.ok(Buffer.byteLength(encoded)>24576);const payload=JSON.parse(encoded.split('\n\n读者这次说：\n')[0]);assert.equal(payload.history.length%2,0);
});

test('account chat HTTP preserves owner, origin, streaming, cancellation and independent export contracts',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-account-http-'));let calls=0;
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),portalDataDir:path.join(dir,'portal'),env:{},translator:null,sendCode:null,chatGenerator:async job=>{calls++;assert.equal(job.book,null);await job.onProgress?.({sequence:1,text:'Synthetic prefix'});return answer;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await server.portal.chat.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,url=base+'/api/library/chat';assert.equal((await fetch(url)).status,401);
 const session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
 const post=(suffix,body,extra={})=>fetch(url+suffix,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 const response=await fetch(url,{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal((await response.json()).bookId,LIBRARY_CHAT_ID);
 assert.equal((await post('',input(),{'X-Reader-Owner':'another'})).status,409);assert.equal((await post('',input(),{'X-Reader-Owner':''})).status,409);assert.equal((await post('',input(),{Origin:'https://untrusted.example'})).status,403);assert.equal(calls,0);
 assert.equal((await post('',input('long-message','x'.repeat(32768)))).status,200);assert.equal(calls,1);
 const result=await post('',input(),{Accept:'application/x-ndjson'});assert.match(result.headers.get('content-type'),/application\/x-ndjson/);const frames=(await result.text()).trim().split('\n').map(JSON.parse);assert.equal(frames[0].type,'progress');assert.equal(frames.at(-1).turn.status,'completed');
 assert.equal((await (await post('/'+input().id+'/cancel',{})).json()).status,'completed');assert.equal(calls,2);
 const exported=await (await fetch(url+'/export',{headers})).json();assert.equal(exported.kind,'leafhour-library-chat');assert.equal(exported.turns.length,2);
 assert.equal((await fetch(base+'/library-chat-context.mjs')).status,200);
});

async function billingSetup(){
 const store=createBillingMemoryStore(),billing=createBillingService({enabled:true,store});await billing.trial({ownerId:owner.id,verified:true});
 const turns=[],library={getBook:async()=>assert.fail('Account billing must never look up a book')},chat={viewLibrary:async user=>{assert.equal(user.id,owner.id);return {turns:structuredClone(turns)};}};
 const gate=createCreditGate({billing,library,chat});return {store,billing,turns,library,chat,gate};
}
const billingRequest=(body,quote)=>({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:{...body,billing:{quoteId:quote.id,idempotencyKey:body.id}}});

test('account credit scope, receipt, exact cache and settlement use their independent namespace',async()=>{
 const f=await billingSetup(),body=input(),q=await f.gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:body});
 assert.equal(q.scope.contextPolicy,LIBRARY_CHAT_VERSION);assert.equal(q.scope.bookId,LIBRARY_CHAT_ID);assert.equal(q.scope.contentVersion,LIBRARY_CHAT_VERSION);assert.equal(q.scope.passageId,LIBRARY_CHAT_PASSAGE);assert.ok(!JSON.stringify(q.scope).includes(body.text));
 let calls=0;const execute=async normalized=>{calls++;const turn={...normalized,status:'completed',answer};f.turns.push(turn);return turn;};
 await f.gate.run({...billingRequest(body,q),execute});assert.equal((await f.billing.account({ownerId:owner.id})).consumedUnits,4000000);
 await f.gate.run({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:body,execute});assert.equal(calls,1);
 await assert.rejects(f.gate.run({...billingRequest({...body,text:'Changed'},q),execute}),{status:409});
 const operationId='credit-'+hash(JSON.stringify([owner.id,'conversation',LIBRARY_CHAT_ID,body.id])),op=await f.billing.operation({ownerId:owner.id,operationId});assert.equal(op.receipt.bookId,LIBRARY_CHAT_ID);assert.equal(op.receipt.resultId,body.id);
});

test('enabling billing does not allow a changed same-id unbilled account conversation to become a receipt',async()=>{
 const f=await billingSetup(),body=input();f.turns.push({...body,scopeRevision:0,status:'completed',answer});
 const execute=async()=>assert.fail('Cached account turns cannot redispatch');
 assert.equal((await f.gate.run({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:body,execute})).status,'completed');
 await assert.rejects(f.gate.run({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:{...body,text:'A different question'},execute}),{status:409});
 const q=await f.gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:{id:'defaults',text:'Without artificial source fields'}});
 assert.equal(q.scope.contentVersion,LIBRARY_CHAT_VERSION);assert.equal(q.scope.passageId,LIBRARY_CHAT_PASSAGE);
});

test('account billing recovers durable success and releases cancelled or expired holds without book services',async()=>{
 for(const status of ['completed','cancelled','failed']){
  const f=await billingSetup(),body=input('recovery-'+status),q=await f.gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:body});
  const id='credit-'+hash(JSON.stringify([owner.id,'conversation',LIBRARY_CHAT_ID,body.id]));
  const op=await f.store.command('reserve',{mode:'test',ownerId:owner.id,quoteId:q.id,scopeHash:q.scopeHash,operationId:id,idempotencyKey:body.id});
  await f.store.command('running',{mode:'test',ownerId:owner.id,operationId:id,reservationToken:op.reservationToken});
  f.turns.push({...body,status,answer:status==='completed'?answer:null});await f.gate.recover(owner);
  const recovered=await f.billing.operation({ownerId:owner.id,operationId:id});assert.equal(recovered.status,status==='completed'?'settled':'cancelled');
  assert.equal((await f.billing.account({ownerId:owner.id})).consumedUnits,status==='completed'?4000000:0);assert.equal((await f.billing.account({ownerId:owner.id})).reservedUnits,0);
 }
 const f=await billingSetup(),body=input('cancel-hold'),q=await f.gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:body});
 const id='credit-'+hash(JSON.stringify([owner.id,'conversation',LIBRARY_CHAT_ID,body.id]));await f.store.command('reserve',{mode:'test',ownerId:owner.id,quoteId:q.id,scopeHash:q.scopeHash,operationId:id,idempotencyKey:body.id});await f.gate.cancel(owner,'conversation',LIBRARY_CHAT_ID,body.id);assert.equal((await f.billing.operation({ownerId:owner.id,operationId:id})).status,'cancelled');
});

test('account billing releases an expired running orphan even when conversation storage has no turn',async()=>{
 const f=await billingSetup(),body=input('orphan-hold'),q=await f.gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:body});
 const op=await f.store.command('reserve',{mode:'test',ownerId:owner.id,quoteId:q.id,scopeHash:q.scopeHash,operationId:'account-orphan',idempotencyKey:body.id});
 await f.store.command('running',{mode:'test',ownerId:owner.id,operationId:op.id,reservationToken:op.reservationToken});
 const stale=createCreditGate({billing:f.billing,library:f.library,chat:f.chat,clock:()=>Date.now()+16*60000});await stale.recover(owner);
 assert.equal((await f.billing.operation({ownerId:owner.id,operationId:op.id})).status,'cancelled');assert.equal((await f.billing.account({ownerId:owner.id})).reservedUnits,0);
});

function replayStore(){
 const values=new Map(),queues=new Map();let fault=null;
 return {values,setFault:callback=>{fault=callback;},async read(file,fallback){return structuredClone(values.has(file)?values.get(file):fallback);},async mutate(file,fallback,operation){
  const prior=queues.get(file)||Promise.resolve(),work=prior.catch(()=>{}).then(async()=>{
   if(fault)fault(file);
   const data=await this.read(file,fallback);await operation(structuredClone(data));const result=await operation(data);values.set(file,structuredClone(data));return structuredClone(result);
  });queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
 }};
}

test('the account active window continues past one hundred turns while exports and old id receipts survive restart',async t=>{
 let now=Date.now(),calls=0;const originals=[],started=deferred(),held=deferred();const {service,create}=await setup(t,{clock:()=>now,generator:async()=>{calls++;if(calls===1){started.resolve();await held.promise;}return calls===2||calls%9===0?{kind:'conversation',summary:''}:answer;}});
 now+=3600001;const pending=service.sendLibrary(owner,input('window-0'));await started.promise;await service.cancelLibrary(owner,'window-0');held.resolve();originals.push(await pending);
 for(let i=1;i<105;i++){now+=3600001;originals.push(await service.sendLibrary(owner,input('window-'+i)));}
 assert.equal(originals[0].status,'cancelled');assert.equal(originals[1].status,'failed');
 assert.equal(calls,105);const view=await service.viewLibrary(owner);assert.equal(view.turns.length,100);assert.equal(view.turns[0].id,'window-5');assert.equal(view.turns.at(-1).id,'window-104');
 const reloaded=await create();assert.deepEqual(await reloaded.findLibraryTurn(owner,'window-0'),originals[0]);assert.deepEqual(await reloaded.sendLibrary(owner,input('window-0')),originals[0]);assert.equal(calls,105);
 await assert.rejects(reloaded.sendLibrary(owner,{...input('window-0'),text:'Changed old request'}),{status:409});assert.equal(calls,105);
 assert.equal(await reloaded.findLibraryTurn(other,'window-0'),null);assert.deepEqual(await reloaded.cancelLibrary(owner,'window-0'),originals[0]);
 const exported=await reloaded.exportLibraryHistory(owner);assert.deepEqual(exported.turns,originals);assert.equal(exported.turns.length,105);
});

test('archived paid account receipts remain cached and never generate or charge the same id again',async t=>{
 let now=Date.now(),calls=0;const {service}=await setup(t,{clock:()=>now,generator:async()=>{calls++;return answer;}}),f=await billingSetup();
 const gate=createCreditGate({billing:f.billing,library:f.library,chat:service}),body=input('paid-window-0'),q=await gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:body});
 const execute=normalized=>service.sendLibrary(owner,normalized),original=await gate.run({...billingRequest(body,q),execute});
 for(let i=1;i<102;i++){now+=3600001;await service.sendLibrary(owner,input('paid-window-'+i));}
 assert.ok(!(await service.viewLibrary(owner)).turns.some(t=>t.id===body.id));const before=await f.billing.account({ownerId:owner.id});
 const cached=await gate.run({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:body,execute:async()=>assert.fail('Archived receipt must not dispatch')});assert.deepEqual(cached,original);assert.equal(calls,102);
 assert.deepEqual(await f.billing.account({ownerId:owner.id}),before);await gate.recover(owner);assert.deepEqual(await f.billing.account({ownerId:owner.id}),before);
 await assert.rejects(gate.run({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:{...body,text:'Changed archived request'},execute}),{status:409});
 assert.equal((await service.exportLibraryHistory(owner)).turns.length,102);
});

for(const boundary of ['before-index','after-index'])test('account archive recovers a crash '+boundary+' without CAS replay side effects or lost export history',async t=>{
 let now=Date.now(),calls=0;const dataStore=replayStore(),{service}=await setup(t,{dataStore,clock:()=>now,generator:async()=>{calls++;return answer;}});
 for(let i=0;i<100;i++){now+=3600001;await service.sendLibrary(owner,input('crash-'+i));}
 let indexed=false,failed=false;
 dataStore.setFault(file=>{
  if(file.endsWith('/account-history/index.json')){if(boundary==='before-index'&&!failed){failed=true;throw Error('Isolated index storage failure');}indexed=true;}
  if(boundary==='after-index'&&indexed&&file.endsWith('/account-conversation.json')&&!failed){failed=true;throw Error('Isolated active window storage failure');}
 });
 now+=3600001;await assert.rejects(service.sendLibrary(owner,input('crash-100')),/Isolated/);assert.equal(failed,true);assert.equal(calls,100);
 dataStore.setFault(null);assert.equal((await service.exportLibraryHistory(owner)).turns.length,100);assert.equal((await service.viewLibrary(owner)).turns.length,100);
 assert.equal((await service.sendLibrary(owner,input('crash-100'))).status,'completed');assert.equal(calls,101);assert.equal((await service.viewLibrary(owner)).turns.length,100);
 const exported=await service.exportLibraryHistory(owner);assert.equal(exported.turns.length,101);assert.equal(new Set(exported.turns.map(t=>t.id)).size,101);
 assert.equal((await service.sendLibrary(owner,input('crash-0'))).status,'completed');assert.equal(calls,101);
 const index=[...dataStore.values.entries()].find(([key])=>key.endsWith('/account-history/index.json'))[1];assert.deepEqual(index.ids,['crash-0']);
});

test('corrupt or conflicting account archive receipts fail closed without overwriting or redispatch',async t=>{
 let now=Date.now(),calls=0;const dataStore=replayStore(),{service}=await setup(t,{dataStore,clock:()=>now,generator:async()=>{calls++;return answer;}});
 for(let i=0;i<100;i++){now+=3600001;await service.sendLibrary(owner,input('corrupt-'+i));}
 const activeKey=[...dataStore.values.keys()].find(key=>key.endsWith('/account-conversation.json')),receiptKey=path.join(path.dirname(activeKey),'account-history',hash('corrupt-0')+'.json');
 const original=(await service.viewLibrary(owner)).turns[0],conflict={kind:'leafhour-library-chat-receipt',schemaVersion:1,ownerId:owner.id,conversationId:LIBRARY_CHAT_ID,turn:{...original,text:'A conflicting existing receipt'}};
 dataStore.values.set(receiptKey,conflict);now+=3600001;await assert.rejects(service.sendLibrary(owner,input('corrupt-100')),{status:409});assert.deepEqual(dataStore.values.get(receiptKey),conflict);assert.equal((await service.viewLibrary(owner)).turns.length,100);assert.equal(calls,100);
 dataStore.values.delete(receiptKey);await service.sendLibrary(owner,input('corrupt-100'));const saved=structuredClone(dataStore.values.get(receiptKey));
 dataStore.values.set(receiptKey,{...saved,ownerId:other.id});await assert.rejects(service.sendLibrary(owner,input('corrupt-0')),{status:409});await assert.rejects(service.exportLibraryHistory(owner),{status:409});assert.equal(calls,101);assert.equal(dataStore.values.get(receiptKey).ownerId,other.id);
 dataStore.values.set(receiptKey,saved);assert.equal((await service.exportLibraryHistory(owner)).turns.length,101);
});

test('ordinary chat accepts long messages and answers, passes all history and has no hourly quota',async t=>{
 const jobs=[];const {service}=await setup(t,{generator:async job=>{jobs.push(job);return {kind:'conversation',summary:'答'.repeat(15000)};}});
 for(let i=0;i<12;i++)assert.equal((await service.sendLibrary(owner,input('unlimited-'+i,'问'.repeat(3000)))).status,'completed');
 assert.equal(jobs.length,12);assert.equal(jobs.at(-1).history.length,22);assert.equal(jobs.at(-1).history[0].content.length,3000);
 assert.equal((await service.exportLibraryHistory(owner)).turns[0].answer.summary.length,15000);
});

test('voice receipts are validated by owner, stored and included in exact retry matching',async t=>{
 const {create}=await setup(t);const receipt={id:'voice-1',mimeType:'audio/mp4',bytes:32,sha256:'a'.repeat(64),durationMs:1200};let validations=0;
 const service=await create({exportVoice:async(u,receipt)=>({receipt,parts:['c3ludGhldGlj']}),validateVoice:async(user,v)=>{assert.equal(user.id,owner.id);validations++;return v;}});
 const body={...input('voice-turn'),voice:receipt},turn=await service.sendLibrary(owner,body);
 assert.deepEqual(turn.voice,receipt);assert.equal((await service.sendLibrary(owner,body)).status,'completed');
 await assert.rejects(service.sendLibrary(owner,{...body,voice:{...receipt,id:'other'}}),{status:409});
 assert.ok(validations);assert.deepEqual((await service.exportLibraryHistory(owner)).turns[0].voice,receipt);
});

test('account message replies stay in their conversation and pass the billing gate as structured references',async t=>{
 const jobs=[];const {service,library}=await setup(t,{generator:async job=>{jobs.push(job);return answer;}});
 await service.sendLibrary(owner,input('account-source','Original account question'));
 const book=await library.importDocument(owner,{filename:'reply.txt',bytes:Buffer.from('Separate book source.')}),passageId=book.sections[0].paragraphs[0].id;
 await service.send(owner,book.bookId,{id:'book-only-source',text:'Book question',passageId,contentVersion:book.contentVersion});
 await assert.rejects(service.sendLibrary(owner,{...input('cross-book-reply'),replyTo:{turnId:'book-only-source',role:'user'}}),{status:404});
 await assert.rejects(service.sendLibrary(other,{...input('cross-owner-reply'),replyTo:{turnId:'account-source',role:'user'}}),{status:404});
 const billing=createBillingService({store:createBillingMemoryStore(),enabled:false}),gate=createCreditGate({billing,library,chat:service}),body={...input('account-reply','Why?'),replyTo:{turnId:'account-source',role:'assistant',text:'Client text is not authoritative'}};
 const saved=await gate.run({user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:body,execute:normalized=>service.sendLibrary(owner,normalized)});
 assert.deepEqual(saved.replyTo,{turnId:'account-source',role:'assistant',text:'A synthetic direct answer.'});assert.deepEqual(jobs.at(-1).replyTo,saved.replyTo);assert.deepEqual((await service.exportLibraryHistory(owner)).turns.at(-1).replyTo,saved.replyTo);
});

test('paid message replies normalize preview text and reject changing a pre-existing uncharged reference',async t=>{
 let calls=0;const {service,library}=await setup(t,{generator:async()=>{calls++;return answer;}}),billing=createBillingService({store:createBillingMemoryStore(),enabled:true}),gate=createCreditGate({billing,library,chat:service});
 await billing.trial({ownerId:owner.id,verified:true});await service.sendLibrary(owner,input('paid-reference-source','Original source'));
 const body={...input('paid-reference-reply','Continue'),replyTo:{turnId:'paid-reference-source',role:'assistant',text:'Forged preview'}},quote=await gate.quote(owner,{action:'conversation',bookId:LIBRARY_CHAT_ID,input:body}),request={...body,billing:{quoteId:quote.id,idempotencyKey:'paid-reference-charge'}};
 const params={user:owner,action:'conversation',bookId:LIBRARY_CHAT_ID,input:request,execute:normalized=>service.sendLibrary(owner,normalized)},saved=await gate.run(params);assert.equal(saved.replyTo.text,answer.summary);
 assert.deepEqual(await gate.run({...params,input:{...request,replyTo:{turnId:'paid-reference-source',role:'assistant',text:'Another preview'}}}),saved);assert.equal(calls,2);assert.equal((await billing.account({ownerId:owner.id})).consumedUnits,4000000);
 const uncharged={...input('uncharged-reference'),replyTo:{turnId:'paid-reference-source',role:'user'}};await service.sendLibrary(owner,uncharged);
 await assert.rejects(gate.run({...params,input:{...uncharged,replyTo:{turnId:'paid-reference-source',role:'assistant'}}}),{status:409});
});
