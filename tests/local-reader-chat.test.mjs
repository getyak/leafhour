import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {createCreditGate} from '../server/credit-gate.mjs';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
const owner={id:'local-chat-account'},other={id:'different-account'},subject='__leafhour_local_chat__';
const input=(id='local-question')=>({id,text:'Explain this local sentence.',passageId:'p1',contentVersion:'local-version',localBook:{bookId:'local-book',title:'Device book',author:'Fixture',contentVersion:'local-version',chapterId:'c1',chapterTitle:'Chapter',passageId:'p1',original:'A local source sentence.'}});
const answer={kind:'conversation',summary:'An isolated explanation.'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,generator,options={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'local-book-chat-')),library=await createLibraryService({dataDir,catalogDir:null}),services=[];
 for(const name of ['getBook','records','addComment'])library[name]=async()=>assert.fail('Local chat must not access cloud '+name);
 const make=async()=>{const chat=await createReaderChatService({library,dataDir,generator,...options});services.push(chat);assert.equal(typeof chat.local?.send,'function','Local tool relay is implemented');return chat;};
 t.after(async()=>{for(const s of services)await s.close();await rm(dataDir,{recursive:true,force:true});});
 return {chat:await make(),make,library};
}
const envelope=(result,patch={})=>({bookId:'local-book',contentVersion:'local-version',result,...patch});
const page={bookId:'local-book',contentVersion:'local-version',chapterId:'c1',chapterTitle:'Chapter',passages:[{passageId:'p1',original:'A local source sentence.',literal:null,interpretive:null,translationStatus:{literal:'missing',interpretive:'missing'}}],nextOffset:null,nextCursor:null};

test('local read tools cross service instances without cloud book lookup and preserve device provenance',async t=>{
 const request=deferred();let calls=0;const f=await fixture(t,async job=>{calls++;assert.equal(job.book.bookId,'local-book');assert.equal(job.book.source,'local-device');const read=await job.tools.execute('reader_get_context',{});assert.equal(read.passages[0].original,'A local source sentence.');const cite=await job.tools.execute('reader_cite',{bookId:'local-book',passageId:'p1',quote:'local source',layer:'original'});assert.equal(cite.source,'local-device');return answer;});
 const second=await f.make();const pending=f.chat.local.send(owner,input(),{onToolRequest:frame=>request.resolve(frame)}),frame=await request.promise;
 assert.equal(frame.id,'local-question');assert.equal(frame.name,'reader_get_context');assert.deepEqual((await second.local.view(owner,'local-question')).pendingTools,[frame]);
 await assert.rejects(second.local.submitTool(other,frame.id,frame.callId,envelope(page)),{status:404});
 await assert.rejects(second.local.submitTool(owner,frame.id,'another-call',envelope(page)),{status:404});
 await assert.rejects(second.local.submitTool(owner,frame.id,frame.callId,envelope(page,{contentVersion:'stale'})),{status:409});
 await assert.rejects(second.local.submitTool(owner,frame.id,frame.callId,envelope({...page,bookId:'foreign-book'})),{status:409});
 await second.local.submitTool(owner,frame.id,frame.callId,envelope(page));
 const turn=await pending;assert.equal(turn.status,'completed');assert.equal(turn.answer.sourceRefs[0].source,'local-device');assert.equal(turn.answer.sourceRefs[0].url,'leafhour://local/read?book=local-book&sourceVersion=local-version&passage=p1');assert.equal(turn.answer.sourceRefs[0].contentVersion,'local-version');assert.equal(calls,1);
 assert.deepEqual(await second.local.send(owner,input()),turn);assert.equal(calls,1);
 await assert.rejects(second.local.send(owner,{...input(),localBook:{...input().localBook,original:'Changed source'}}),{status:409});
 assert.equal((await second.local.findTurn(other,input().id)),null);
});

test('local tools reject cloud, cross book, undeclared tools and unread citations before relaying',async t=>{
 const relayed=[];const f=await fixture(t,async job=>{
  for(const [name,args] of [['reader_read_chapter',{bookId:'foreign',chapterId:'c1'}],['reader_search',{query:'text',bookIds:['foreign']}],['get_preferences',{}],['people_get',{}],['reader_search_web',{query:'secret'}]])assert.ok((await job.tools.execute(name,args)).error);
  assert.equal((await job.tools.execute('reader_cite',{bookId:'local-book',passageId:'p1',quote:'Not read'})).error.code,'UNREAD_SOURCE');return answer;
 });
 assert.equal((await f.chat.local.send(owner,input(),{onToolRequest:frame=>relayed.push(frame)})).status,'completed');assert.deepEqual(relayed,[]);
 for(const patch of [{contentVersion:'other'},{passageId:'other'},{localBook:{...input().localBook,ownerId:other.id}},{peopleWrites:true}])await assert.rejects(f.chat.local.send(owner,{...input('bad'),...patch}));
 await assert.rejects(f.chat.local.send({id:'anon',is_anonymous:true},input()),{status:401});
});

test('local cancellation fences duplicate running sends, late tool replies and stale generator completion',async t=>{
 const request=deferred(),started=deferred();let signal;const f=await fixture(t,async job=>{signal=job.signal;started.resolve();await job.tools.execute('reader_get_context',{});return answer;}),second=await f.make();
 const pending=f.chat.local.send(owner,input(),{onToolRequest:frame=>request.resolve(frame)});await started.promise;const frame=await request.promise;
 await assert.rejects(second.local.send(owner,input()),{status:409});
 assert.equal((await second.local.cancel(owner,input().id)).status,'cancelled');
 await assert.rejects(second.local.submitTool(owner,frame.id,frame.callId,envelope(page)),{status:409});
 assert.equal((await pending).status,'cancelled');assert.equal(signal.aborted,true);
 assert.equal((await second.local.send(owner,input())).status,'cancelled');assert.deepEqual((await second.local.view(owner,input().id)).pendingTools,[]);
});

test('tool replies are idempotent while in flight and immutable once delivered',async t=>{
 const request=deferred(),hold=deferred(),received=deferred();const f=await fixture(t,async job=>{await job.tools.execute('reader_get_context',{});received.resolve();await hold.promise;return answer;});t.after(()=>hold.resolve());
 const pending=f.chat.local.send(owner,input(),{onToolRequest:frame=>request.resolve(frame)}),frame=await request.promise;
 await f.chat.local.submitTool(owner,frame.id,frame.callId,envelope(page));await f.chat.local.submitTool(owner,frame.id,frame.callId,envelope(page));
 await assert.rejects(f.chat.local.submitTool(owner,frame.id,frame.callId,envelope({...page,chapterTitle:'Changed'})),{status:409});
 await received.promise;hold.resolve();assert.equal((await pending).status,'completed');
 await assert.rejects(f.chat.local.submitTool(owner,frame.id,frame.callId,envelope(page)),{status:409});
});

test('local billing quotes bind source and history without cloud ownership and retry charges once',async t=>{
 let calls=0;const f=await fixture(t,async()=>{calls++;return answer;}),store=createBillingMemoryStore(),billing=createBillingService({store,enabled:true}),gate=createCreditGate({billing,library:f.library,chat:f.chat});
 await billing.trial({ownerId:owner.id,verified:true});const body={...input(),history:[{role:'user',content:'Earlier local question'},{role:'assistant',content:'Earlier local answer'}]},quote=await gate.quote(owner,{action:'conversation',bookId:subject,input:body});
 const params={user:owner,action:'conversation',bookId:subject,input:{...body,billing:{quoteId:quote.id,idempotencyKey:'local-charge'}},execute:normalized=>f.chat.local.send(owner,normalized)};
 const result=await gate.run(params);assert.equal(result.status,'completed');assert.deepEqual(await gate.run(params),result);assert.equal(calls,1);
 await assert.rejects(gate.run({...params,input:{...params.input,history:[{role:'user',content:'Different history'}]}}),{status:409});
 assert.equal((await billing.account({ownerId:owner.id})).consumedUnits,4000000);
});

test('authenticated NDJSON local chat streams progress and services tool results before terminal completion',async t=>{
 const {createReaderServer}=await import('../server/server.mjs'),dir=await mkdtemp(path.join(tmpdir(),'local-chat-http-'));
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),portalDataDir:path.join(dir,'portal'),env:{},chatGenerator:async job=>{await job.onProgress({sequence:1,text:'Local streamed prefix'});const result=await job.tools.execute('reader_get_context',{});assert.equal(result.passages[0].original,'A local source sentence.');return answer;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,url=base+'/api/library/local-chat',session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base,Accept:'application/x-ndjson'};
 assert.equal((await fetch(url)).status,401);assert.equal((await (await fetch(url,{headers})).json()).available,true);
 assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Reader-Owner':'stale'},body:JSON.stringify(input())})).status,409);
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(input())});assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',frames=[];
 while(!frames.some(f=>f.type==='tool_request')){const next=await reader.read();assert.equal(next.done,false);buffer+=decoder.decode(next.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();frames.push(...lines.filter(Boolean).map(JSON.parse));}
 assert.equal(frames[0].type,'progress');assert.equal(frames[0].text,'Local streamed prefix');assert.ok(!frames.some(f=>f.type==='result'));
 const tool=frames.find(f=>f.type==='tool_request');assert.deepEqual((await (await fetch(url+'/'+input().id,{headers})).json()).pendingTools,[tool]);
 const resultUrl=url+'/'+input().id+'/tools/'+tool.callId;
 assert.equal((await fetch(resultUrl,{method:'POST',headers:{...headers,'X-Reader-Owner':'stale'},body:JSON.stringify(envelope(page))})).status,409);
 assert.equal((await fetch(resultUrl,{method:'POST',headers,body:JSON.stringify(envelope(page))})).status,200);
 for(;;){const next=await reader.read();if(next.done)break;buffer+=decoder.decode(next.value,{stream:true});}frames.push(...buffer.trim().split('\n').filter(Boolean).map(JSON.parse));
 assert.equal(frames.at(-1).type,'result');assert.equal(frames.at(-1).turn.status,'completed');
 assert.equal((await (await fetch(url+'/'+input().id,{headers})).json()).turn.status,'completed');
});

test('versioned Unicode continuation cites adjacent read ranges',async t=>{
 const f=await fixture(t,async job=>{
  assert.equal((await job.tools.execute('reader_read_chapter',{bookId:'local-book',chapterId:'c1',sourceVersion:'old'})).error.code,'SCOPE_DENIED');
  await job.tools.execute('reader_read_chapter',{bookId:'local-book',chapterId:'c1',sourceVersion:'local-version'});
  await job.tools.execute('reader_read_chapter',{bookId:'local-book',chapterId:'c1',passageId:'p1',layer:'original',charOffset:2,sourceVersion:'local-version'});
  const cite=await job.tools.execute('reader_cite',{bookId:'local-book',passageId:'p1',quote:'😀BC',sourceVersion:'local-version'});assert.equal(cite.quote,'😀BC');assert.equal(cite.sourceVersion,'local-version');return answer;
 });
 let count=0;const pending=f.chat.local.send(owner,input(),{onToolRequest:async frame=>{count++;const original=count===1?'A😀':'BC';await f.chat.local.submitTool(owner,frame.id,frame.callId,envelope({...page,sourceVersion:'local-version',passages:[{...page.passages[0],original,visibleRanges:{original:{charOffset:count===1?0:2,charEnd:count===1?2:4,totalChars:4}}}]}));}});
 assert.equal((await pending).status,'completed');assert.equal(count,2);
});

test('shared document CAS replay preserves a single relay and generation across hosted instances',async t=>{
 const values=new Map(),queues=new Map(),dataStore={read:async(key,fallback)=>structuredClone(values.has(key)?values.get(key):fallback),async mutate(key,fallback,fn){const previous=queues.get(key)||Promise.resolve();const work=previous.catch(()=>{}).then(async()=>{const row=await this.read(key,fallback);await fn(structuredClone(row));const result=await fn(row);values.set(key,structuredClone(row));return structuredClone(result);});queues.set(key,work);return work;}};
 let calls=0;const request=deferred(),f=await fixture(t,async job=>{calls++;await job.tools.execute('reader_get_context',{});return answer;},{dataStore}),second=await f.make();
 const pending=f.chat.local.send(owner,input(),{onToolRequest:frame=>request.resolve(frame)}),frame=await request.promise;
 assert.equal((await second.local.view(owner,input().id)).pendingTools.length,1);
 await second.local.submitTool(owner,frame.id,frame.callId,envelope(page));assert.equal((await pending).status,'completed');assert.equal(calls,1);
 assert.equal((await second.local.send(owner,input())).status,'completed');assert.equal(calls,1);
});

test('expired local runs retain interrupted originals and reject stale results without restarting',async t=>{
 let now=Date.now(),calls=0;const request=deferred(),f=await fixture(t,async job=>{calls++;await job.tools.execute('reader_get_context',{});return answer;},{clock:()=>now,conversationTimeoutMs:1000}),second=await f.make();
 const pending=f.chat.local.send(owner,input(),{onToolRequest:frame=>request.resolve(frame)}),frame=await request.promise;now+=1001;
 const saved=await second.local.view(owner,input().id);assert.equal(saved.turn.status,'failed');assert.equal(saved.turn.failureCode,'interrupted');assert.equal(saved.turn.text,'Explain this local sentence.');assert.deepEqual(saved.pendingTools,[]);
 await assert.rejects(second.local.submitTool(owner,frame.id,frame.callId,envelope(page)),{status:409});assert.equal((await pending).status,'failed');assert.equal((await second.local.send(owner,input())).status,'failed');assert.equal(calls,1);
});

test('paid cancellation releases its hold and local recovery never loads a cloud book',async t=>{
 const request=deferred(),f=await fixture(t,async job=>{await job.tools.execute('reader_get_context',{});return answer;}),store=createBillingMemoryStore(),billing=createBillingService({enabled:true,store}),gate=createCreditGate({billing,library:f.library,chat:f.chat});
 await billing.trial({ownerId:owner.id,verified:true});const body=input(),quote=await gate.quote(owner,{action:'conversation',bookId:subject,input:body});
 const pending=gate.run({user:owner,action:'conversation',bookId:subject,input:{...body,billing:{quoteId:quote.id,idempotencyKey:'cancel-charge'}},execute:normalized=>f.chat.local.send(owner,normalized,{onToolRequest:frame=>request.resolve(frame)})});
 await request.promise;await f.chat.local.cancel(owner,input().id);await gate.cancel(owner,'conversation',subject,input().id);
 await assert.rejects(pending);await gate.recover(owner);const account=await billing.account({ownerId:owner.id});assert.equal(account.consumedUnits,0);assert.equal(account.reservedUnits,0);
});

test('conflicting text under an unchanged device version cannot publish earlier citations',async t=>{
 const f=await fixture(t,async job=>{await job.tools.execute('reader_get_context',{});await job.tools.execute('reader_cite',{bookId:'local-book',passageId:'p1',quote:'local source'});try{await job.tools.execute('reader_get_context',{});}catch{}return answer;});
 let count=0;const turn=await f.chat.local.send(owner,input(),{onToolRequest:async frame=>{count++;await f.chat.local.submitTool(owner,frame.id,frame.callId,envelope(count===1?page:{...page,passages:[{...page.passages[0],original:'A changed source sentence.'}]}));}});
 assert.equal(turn.status,'failed');assert.equal(turn.answer,null);
});

test('local voice uses the same owner-validated recording and survives exact request recovery',async t=>{
 const {createChatVoice}=await import('../server/chat-voice.mjs'),{randomUUID,createHash}=await import('node:crypto'),rows=new Map(),blobs=new Map(),voice=createChatVoice({store:{read:async(k,d)=>structuredClone(rows.get(k)??d),mutate:async(k,d,fn)=>{const row=structuredClone(rows.get(k)??d),result=await fn(row);rows.set(k,row);return result;},putBlob:async(k,b)=>blobs.set(k,Buffer.from(b)),blob:async k=>Buffer.from(blobs.get(k))}}),audio=Buffer.from('caffsynthetic-original-audio'),sha256=createHash('sha256').update(audio).digest('hex'),audioId=randomUUID();
 await voice.start(owner,audioId,{bytes:audio.length,sha256,mimeType:'audio/x-caf',durationMs:1200});await voice.part(owner,audioId,{index:0,sha256,base64:audio.toString('base64')});const receipt=await voice.complete(owner,audioId);
 let calls=0;const f=await fixture(t,async job=>{calls++;assert.deepEqual(job.voice,receipt);return answer;},{validateVoice:voice.validate}),body={...input(),voice:receipt};
 await assert.rejects(f.chat.local.send(other,body),{status:404});assert.equal(await f.chat.local.findTurn(other,body.id),null);
 const result=await f.chat.local.send(owner,body);assert.deepEqual(result.voice,receipt);assert.equal(result.status,'completed');assert.deepEqual(await voice.bytes(owner,audioId,0),audio);
 const second=await f.make();assert.deepEqual(await second.local.send(owner,body),result);assert.equal(calls,1);await assert.rejects(second.local.send(owner,{...body,voice:{...receipt,durationMs:1300}}),{status:409});
});

test('local chapter cursor schemas preserve large legitimate offsets for native length validation',async t=>{
 const f=await fixture(t,async job=>{const result=await job.tools.execute('reader_read_chapter',{bookId:'local-book',chapterId:'c1',passageId:'p1',layer:'original',charOffset:10000001,offset:1000001,sourceVersion:'local-version'});assert.equal(result.error.code,'INVALID_CURSOR');return answer;});
 let count=0;const turn=await f.chat.local.send(owner,input(),{onToolRequest:async frame=>{count++;await f.chat.local.submitTool(owner,frame.id,frame.callId,envelope({error:{code:'INVALID_CURSOR',message:'Native validated actual source length'}}));}});
 assert.equal(turn.status,'completed');assert.equal(count,1);
});

test('local message replies use same-account receipts and match the exact local book version',async t=>{
 const jobs=[];const f=await fixture(t,async job=>{jobs.push(job);return answer;});await f.chat.local.send(owner,input('local-source'));
 const request={...input('local-reply'),text:'Explain that claim',replyTo:{turnId:'local-source',role:'assistant',text:'Untrusted replacement'}};
 const saved=await f.chat.local.send(owner,request);assert.equal(saved.status,'completed');assert.deepEqual(saved.replyTo,{turnId:'local-source',role:'assistant',text:'An isolated explanation.'});assert.deepEqual(jobs[1].replyTo,saved.replyTo);assert.equal(saved.text,'Explain that claim');
 const second=await f.make();assert.deepEqual(await second.local.send(owner,{...request,replyTo:{turnId:'local-source',role:'assistant'}}),saved);assert.equal(jobs.length,2);
 await assert.rejects(second.local.send(owner,{...request,replyTo:{turnId:'local-source',role:'user'}}),{status:409});
 await assert.rejects(second.local.send(other,{...input('foreign-reference'),replyTo:{turnId:'local-source',role:'assistant'}}),{status:404});
 for(const patch of [{localBook:{...input().localBook,bookId:'other-local-book'}},{contentVersion:'other-version',localBook:{...input().localBook,contentVersion:'other-version'}}])await assert.rejects(second.local.send(owner,{...input('mismatched-local-reference'),...patch,replyTo:{turnId:'local-source',role:'assistant'}}),{status:409});
 assert.equal(await second.local.findTurn(owner,'mismatched-local-reference'),null);assert.equal(jobs.length,2);
});

test('local message reactions validate owner, local book and saved text before generation',async t=>{
 const jobs=[],f=await fixture(t,async job=>{jobs.push(job);return answer;});
 await f.chat.local.send(owner,input('reaction-source'));
 const reaction={turnId:'reaction-source',role:'assistant',emoji:'🌱'},request={...input('reaction-followup'),reactions:[reaction]};
 const saved=await f.chat.local.send(owner,request);assert.deepEqual(jobs[1].reactions,[{...reaction,text:answer.summary}]);
 assert.deepEqual(await f.chat.local.send(owner,request),saved);assert.equal(jobs.length,2);
 await assert.rejects(f.chat.local.send(other,{...input('reaction-other'),reactions:[reaction]}),{status:404});
 await assert.rejects(f.chat.local.send(owner,{...input('reaction-other-book'),localBook:{...input().localBook,bookId:'another-book'},reactions:[reaction]}),{status:404});
});

test('paid local reactions retain canonical targets for exactly-once receipt recovery',async t=>{
 const f=await fixture(t,async()=>answer),billing=createBillingService({enabled:true,store:createBillingMemoryStore()}),gate=createCreditGate({billing,library:f.library,chat:f.chat});
 await billing.trial({ownerId:owner.id,verified:true});await f.chat.local.send(owner,input('local-reaction-paid-source'));
 const body={...input('local-reaction-paid'),reactions:[{turnId:'local-reaction-paid-source',role:'assistant',emoji:'🌱'}]},quote=await gate.quote(owner,{action:'conversation',bookId:subject,input:body}),request={...body,billing:{quoteId:quote.id,idempotencyKey:'local-reaction-once'}};
 const params={user:owner,action:'conversation',bookId:subject,input:request,execute:normalized=>f.chat.local.send(owner,normalized)},saved=await gate.run(params);
 assert.deepEqual(await gate.run(params),saved);assert.equal((await billing.account({ownerId:owner.id})).consumedUnits,4000000);
});
