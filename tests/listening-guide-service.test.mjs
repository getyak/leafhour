import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAudioStore} from '../server/audio-store.mjs';
import {createAudioService} from '../server/audio-service.mjs';
import {audioBook,pcmWav} from './audio-fixture.mjs';
import {createListeningGuideService} from '../server/listening-guide-service.mjs';
const owner={id:'guide-owner'},other={id:'other-owner'};
const request={intent:'explain',chapterId:'ch1',throughPassageId:'p1',contentVersion:'v1',idempotencyKey:'guide-1',confirmProcessing:true};
const pause=()=>new Promise(resolve=>setTimeout(resolve,4));
async function generated(input){
 if(input.stage==='outline')return {passageIds:input.passages.map(p=>p.id),summary:'本批的原文要点。',claims:[{text:'仔细阅读。',sourceRefs:[{chapterId:input.passages[0].chapterId,passageId:input.passages[0].id,quote:input.passages[0].original.slice(0,20)}]}]};
 if(input.stage==='script')return {turns:[{speaker:'guide',text:'这里提醒我们仔细阅读。',style:'calm',sourceRefs:input.outlines[0].claims[0].sourceRefs}]};
 return {checks:input.turns.map(t=>({turnId:t.id,supported:true,reason:'原文支持。'}))};
}
async function fixture(t,{generator=generated,durable=false,speechProvider}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'reader-guides-')),book=audioBook(),base=await createAudioStore({dataDir:dir}),pending=[];
 const store={...base,durable,reserveGuideBudget:async()=>{},reserveGeneration:async()=>{}},library={getBook:async(_owner,id)=>{if(id!==book.bookId)throw Object.assign(Error('hidden'),{status:404});return structuredClone(book);}};
 const audio=await createAudioService({store,getBook:library.getBook,durable:false,speechProvider:speechProvider||{available:true,model:'test',synthesize:async()=>({bytes:pcmWav(),mimeType:'audio/wav'})},schedule:p=>pending.push(p)});
 const options={audio,library,generator,schedule:p=>pending.push(p)},service=createListeningGuideService(options);
 t.after(async()=>{await audio.close();await Promise.allSettled(pending);await rm(dir,{recursive:true,force:true});});
 return {service,options,audio,store,book,pending};
}
async function settle(service,id){
 for(let i=0;i<200;i++){const job=await service.get(owner,'audio-book',id);if(job.status!=='preparing')return job;await pause();}
 throw Error('Guide did not settle');
}

test('prepare discloses bounded original coverage without starting paid work and creation requires an explicit action',async t=>{
 let calls=0;const f=await fixture(t,{generator:async x=>{calls++;return generated(x);}}),preview=await f.service.prepare(owner,'audio-book',request);
 assert.equal(calls,0);assert.equal(preview.sourceCount,1);assert.equal(preview.coverage.covered,1);assert.equal(preview.externalProcessing.privateNotes,false);assert.equal(preview.externalProcessing.maxCalls,3);assert.ok(preview.estimatedDurationSeconds.max>0);
 await assert.rejects(f.service.create(owner,'audio-book',{...request,confirmProcessing:false}),{status:400});assert.equal(calls,0);
});

test('whole-book work reads every original in bounded batches before script and support verification',async t=>{
 const calls=[],f=await fixture(t,{generator:async input=>{calls.push(structuredClone({...input,signal:undefined}));return generated(input);}});
 f.book.sections[0].paragraphs=Array.from({length:50},(_,i)=>({id:'a'+i,original:'Original '+i+'. '+('x'.repeat(1200)),privateNotes:'PRIVATE'}));
 const created=await f.service.create(owner,'audio-book',{intent:'book',contentVersion:'v1',idempotencyKey:'book',confirmProcessing:true}),ready=await settle(f.service,created.id);
 assert.equal(ready.status,'ready');assert.ok(ready.sessionId);assert.ok(ready.dialogueId);assert.equal(ready.coverage.complete,true);
 const outlines=calls.filter(x=>x.stage==='outline');assert.ok(outlines.length>1);assert.deepEqual(outlines.flatMap(x=>x.passages.map(p=>p.id)),[...Array.from({length:50},(_,i)=>'a'+i),'p3']);
 assert.ok(outlines.every(x=>x.passages.reduce((n,p)=>n+p.original.length,0)<=18000));assert.ok(!JSON.stringify(calls).includes('PRIVATE'));
 assert.equal(calls.at(-1).stage,'verify');assert.equal((await f.audio.getDialogue(owner,'audio-book',ready.dialogueId)).kind,'guided-listening');
});

test('two instances share one paid operation and an idempotency key cannot change source scope',async t=>{
 let release,calls=0;const f=await fixture(t,{generator:async input=>{calls++;if(input.stage==='outline')await new Promise(resolve=>release=resolve);return generated(input);}}),second=createListeningGuideService(f.options);
 const [first,duplicate]=await Promise.all([f.service.create(owner,'audio-book',request),second.create(owner,'audio-book',request)]);
 assert.equal(first.id,duplicate.id);while(!release)await pause();assert.equal(calls,1);
 await second.get(owner,'audio-book',first.id);assert.equal(calls,1);
 await assert.rejects(second.create(owner,'audio-book',{...request,scopeMode:'chapter'}),{status:409});
 release();assert.equal((await settle(second,first.id)).status,'ready');assert.equal(calls,3);
 assert.equal((await f.store.read(owner.id,'audio-book')).dialogues.length,1);
});

test('cancellation aborts the current call and a late response cannot publish a guide or session',async t=>{
 let release,signal;const f=await fixture(t,{generator:async input=>{if(input.stage==='outline'){signal=input.signal;await new Promise(resolve=>release=resolve);}return generated(input);}}),job=await f.service.create(owner,'audio-book',request);
 while(!release)await pause();await assert.rejects(f.service.cancel(other,'audio-book',job.id),{status:404});assert.equal(signal.aborted,false);
 await f.service.cancel(owner,'audio-book',job.id);assert.equal(signal.aborted,true);release();await pause();
 assert.equal((await f.service.get(owner,'audio-book',job.id)).status,'cancelled');const data=await f.store.read(owner.id,'audio-book');assert.equal(data.dialogues.length,0);assert.equal(data.sessions.length,0);
});

test('expired in-flight requests become interrupted and only a new explicit request can generate again',async t=>{
 const f=await fixture(t,{durable:true});const job=await f.service.create(owner,'audio-book',request);
 await Promise.allSettled(f.pending);await f.store.mutate(owner.id,'audio-book',data=>{const j=data.guideJobs[0];j.stage='script';j.lease={token:'old-process',expiresAt:Date.now()-1,inFlight:true};return null;});
 let calls=0;const fresh=createListeningGuideService({...f.options,generator:async input=>{calls++;return generated(input);}});
 assert.equal((await fresh.get(owner,'audio-book',job.id)).status,'interrupted');assert.equal((await fresh.create(owner,'audio-book',request)).status,'interrupted');assert.equal(calls,0);
 const next=await fresh.create(owner,'audio-book',{...request,idempotencyKey:'new-explicit-request'});assert.notEqual(next.id,job.id);assert.equal((await settle(fresh,next.id)).status,'ready');assert.equal(calls,3);
});

test('a fresh worker resumes only the next known unsubmitted stage without rereading a completed batch',async t=>{
 const calls=[],f=await fixture(t,{durable:true,generator:async input=>{calls.push(input.stage);return generated(input);}}),job=await f.service.create(owner,'audio-book',request);
 await Promise.allSettled(f.pending);assert.deepEqual(calls,['outline']);
 const fresh=createListeningGuideService(f.options),done=await settle(fresh,job.id);assert.equal(done.status,'ready');assert.deepEqual(calls,['outline','script','verify']);
});

test('changed originals invalidate an in-flight result before the script can be published',async t=>{
 let release,calls=0;const f=await fixture(t,{generator:async input=>{calls++;await new Promise(resolve=>release=resolve);return generated(input);}}),job=await f.service.create(owner,'audio-book',request);
 while(!release)await pause();f.book.sections[0].paragraphs[0].original='Changed original.';release();
 const failed=await settle(f.service,job.id);assert.equal(failed.status,'failed');assert.equal(failed.error.code,'stale_source');assert.equal(calls,1);assert.equal((await f.store.read(owner.id,'audio-book')).dialogues.length,0);
});

test('missing batch coverage and unsupported important claims cannot become playable scripts',async t=>{
 const f=await fixture(t,{generator:async input=>input.stage==='outline'?{...await generated(input),passageIds:[]}:generated(input)}),job=await f.service.create(owner,'audio-book',request),failed=await settle(f.service,job.id);
 assert.equal(failed.status,'failed');assert.equal(failed.error.code,'incomplete_coverage');
 const second=createListeningGuideService({...f.options,generator:async input=>input.stage==='verify'?{checks:input.turns.map(t=>({turnId:t.id,supported:false,reason:'作者没有这样说。'}))}:generated(input)});
 const next=await second.create(owner,'audio-book',{...request,idempotencyKey:'unsupported'}),unsupported=await settle(second,next.id);
 assert.equal(unsupported.status,'failed');assert.equal(unsupported.error.code,'unsupported_claim');assert.equal(unsupported.transcript.turns[0].text,'这里提醒我们仔细阅读。');
 assert.equal((await f.store.read(owner.id,'audio-book')).sessions.length,0);
});

test('synthesis failure retains the verified manuscript and guide session for inspection',async t=>{
 const f=await fixture(t,{speechProvider:{available:true,model:'test',synthesize:async()=>{throw Object.assign(Error('unavailable'),{status:502,code:'provider_unavailable'});}}}),job=await f.service.create(owner,'audio-book',request),ready=await settle(f.service,job.id);
 assert.equal(ready.status,'ready');assert.ok(ready.dialogueId);assert.ok(ready.sessionId);
 for(let n=0;n<50;n++){const session=await f.audio.getSession(owner,'audio-book',ready.sessionId);if(session.status==='failed')break;await pause();}
 assert.equal((await f.audio.getSession(owner,'audio-book',ready.sessionId)).status,'failed');assert.ok((await f.audio.getDialogue(owner,'audio-book',ready.dialogueId)).turns.length);
 await assert.rejects(f.service.get(other,'audio-book',job.id),{status:404});
});

test('whole-job quota is reserved before any submission and quota outages never call a provider',async t=>{
 const events=[],f=await fixture(t,{generator:async input=>{events.push(input.stage);return generated(input);}});
 f.store.reserveGuideBudget=async(_id,_job,max)=>{events.push('budget:'+max);};f.store.reserveGeneration=async(_id,stage,options)=>{assert.ok(options.guideJobId);events.push('reserve:'+stage.split(':').at(-1));};
 const job=await f.service.create(owner,'audio-book',request);assert.equal((await settle(f.service,job.id)).status,'ready');assert.equal(events[0],'budget:3');assert.equal(events.filter(x=>x.startsWith('reserve:')).length,3);
 f.store.reserveGuideBudget=async()=>{throw Object.assign(Error('quota unavailable'),{code:'quota_unavailable',status:503});};
 const before=events.length,next=await f.service.create(owner,'audio-book',{...request,idempotencyKey:'quota-failure'}),failed=await settle(f.service,next.id);
 assert.equal(failed.status,'failed');assert.equal(failed.error.code,'quota_unavailable');assert.equal(events.length,before);
});

test('cancelling a ready guide cancels its associated audio session as well',async t=>{
 const f=await fixture(t),job=await f.service.create(owner,'audio-book',request),ready=await settle(f.service,job.id);
 const cancelled=await f.service.cancel(owner,'audio-book',job.id);assert.equal(cancelled.status,'cancelled');
 assert.equal((await f.audio.getSession(owner,'audio-book',ready.sessionId)).status,'cancelled');
});

test('duration estimates stay ordered even when an opening contains a long first paragraph',async t=>{
 const f=await fixture(t);f.book.sections[0].paragraphs[0].original='x'.repeat(5000);
 const preview=await f.service.prepare(owner,'audio-book',{intent:'intro',chapterId:'ch1',contentVersion:'v1'});
 assert.ok(preview.estimatedDurationSeconds.min<=preview.estimatedDurationSeconds.max);assert.ok(preview.estimatedDurationSeconds.max<=90);
});

test('a request deadline releases scheduled work even if a provider ignores its abort signal',async t=>{
 let release,signal;const f=await fixture(t,{generator:input=>{signal=input.signal;return new Promise(resolve=>release=()=>resolve(generated(input)));}}),scheduled=[];
 const service=createListeningGuideService({...f.options,sliceDurationMs:25,schedule:p=>scheduled.push(p)}),job=await service.create(owner,'audio-book',request);
 while(!release)await pause();const bounded=await Promise.race([scheduled[0].then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),150))]);
 assert.equal(bounded,true);assert.equal(signal.aborted,true);release();await pause();
 assert.equal((await f.store.read(owner.id,'audio-book')).dialogues.length,0);
 await f.store.mutate(owner.id,'audio-book',data=>{data.guideJobs[0].lease.expiresAt=0;return null;});assert.equal((await service.get(owner,'audio-book',job.id)).status,'interrupted');
});

test('a consumed reservation before a crashed submission marker is interrupted rather than retried',async t=>{
 let calls=0;const f=await fixture(t,{durable:true,generator:async input=>{calls++;return generated(input);}}),job=await f.service.create(owner,'audio-book',request);
 await Promise.allSettled(f.pending);assert.equal(calls,1);
 f.store.reserveGeneration=async()=>{throw Object.assign(Error('already submitted'),{status:409,code:'already_submitted'});};
 await f.store.mutate(owner.id,'audio-book',data=>{data.guideJobs[0].lease={token:'crashed',expiresAt:0,inFlight:false};return null;});
 const fresh=createListeningGuideService(f.options),done=await settle(fresh,job.id);assert.equal(done.status,'interrupted');assert.equal(calls,1);
});

test('cancelling an unknown request fences off a late create before any paid work',async t=>{
 let calls=0,budgets=0;const f=await fixture(t,{generator:async input=>{calls++;return generated(input);}});
 f.store.reserveGuideBudget=async()=>{budgets++;};
 assert.equal(typeof f.service.cancelRequest,'function');
 const stopped=await f.service.cancelRequest(owner,'audio-book',request.idempotencyKey);assert.equal(stopped.status,'cancelled');
 const fresh=createListeningGuideService(f.options),late=await fresh.create(owner,'audio-book',request);assert.equal(late.status,'cancelled');assert.ok(late.id);
 assert.equal((await fresh.create(owner,'audio-book',request)).id,late.id);assert.equal(calls,0);assert.equal(budgets,0);
 const otherOwner=await fresh.create(other,'audio-book',request);assert.equal((await settle({...fresh,get:(_o,b,id)=>fresh.get(other,b,id)},otherOwner.id)).status,'ready');
});

test('request cancellation finds a ready guide whose original create response was lost',async t=>{
 const f=await fixture(t),created=await f.service.create(owner,'audio-book',request),ready=await settle(f.service,created.id);
 assert.equal(typeof f.service.cancelRequest,'function');
 assert.equal((await f.service.cancelRequest(owner,'audio-book',request.idempotencyKey)).status,'cancelled');
 assert.equal((await f.audio.getSession(owner,'audio-book',ready.sessionId)).status,'cancelled');
});

test('an unavailable request scheduler cannot leave untracked paid work running',async t=>{
 let calls=0;const f=await fixture(t,{generator:async input=>{calls++;return generated(input);}}),service=createListeningGuideService({...f.options,schedule:()=>{throw Error('scheduler unavailable');}});
 await assert.rejects(service.create(owner,'audio-book',request));await pause();assert.equal(calls,0);
});

test('a configuration outage cannot hide an existing idempotent result or bypass a cancellation tombstone',async t=>{
 const f=await fixture(t),created=await f.service.create(owner,'audio-book',request),ready=await settle(f.service,created.id),offline=createListeningGuideService({...f.options,generator:null});
 assert.equal((await offline.create(owner,'audio-book',request)).id,ready.id);
 await f.service.cancelRequest(owner,'audio-book','offline-cancel');
 assert.equal((await offline.create(owner,'audio-book',{...request,idempotencyKey:'offline-cancel'})).status,'cancelled');
});
