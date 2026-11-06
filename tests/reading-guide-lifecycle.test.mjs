import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReadingGuideService} from '../server/reading-guide.mjs';
const user={id:'guide-lifecycle-owner'}, input={bookId:'book-a',contentVersion:'v1',sourceKind:'local-device',locale:'en',context:{title:'Opening',author:'',chapters:[{id:'c',title:'Opening'}],passages:[{id:'p',chapterId:'c',original:'A bounded source opening.'}]}}, output={opening:'A source-bound welcome.',method:'Follow the opening at your pace.',readingQuestion:'What catches your attention?',model:'fixture'};
async function setup(t,extra={}){const dataDir=await mkdtemp(path.join(tmpdir(),'get407-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return {dataDir,...extra};}
test('concurrent and cold opens observe a durable attempt and reuse one result',async t=>{
 let release,started,calls=0;const began=new Promise(r=>started=r),options=await setup(t,{generator:async()=>{calls++;started();return new Promise(r=>release=r);}}),first=createReadingGuideService(options),cold=createReadingGuideService(options);
 assert.equal((await first.view(user,input)).state,'missing');
 const pending=first.ensure(user,input);await began;
 assert.equal((await cold.ensure(user,input)).state,'preparing');assert.equal((await cold.view(user,input)).state,'preparing');assert.equal(calls,1);
 release(output);const ready=await pending;assert.equal(ready.state,'ready');assert.deepEqual((await cold.ensure(user,input)).guide,ready.guide);assert.equal(calls,1);
});
test('provider transport failure and expired work never replay, even with explicit retry',async t=>{
 let calls=0,now=1000;const options=await setup(t,{clock:()=>now,generator:async()=>{calls++;throw Error('transport result unknown');}}),service=createReadingGuideService(options);
 await assert.rejects(service.ensure(user,input));assert.equal((await service.view(user,input)).state,'unknown');
 assert.equal((await createReadingGuideService(options).ensure(user,input,{retry:true})).state,'unknown');assert.equal(calls,1);
 let started;const began=new Promise(r=>started=r),other=createReadingGuideService({...options,generator:async()=>{started();return new Promise(()=>{});},timeoutMs:30});
 const pending=other.ensure(user,{...input,bookId:'book-expired'});await began;now+=31;
 assert.equal((await service.ensure(user,{...input,bookId:'book-expired'})).state,'unknown');await Promise.all([assert.rejects(pending),new Promise(r=>setTimeout(r,40))]);assert.equal(calls,1);
});
test('completed invalid output requires explicit retry while known safe quota errors do not auto replay',async t=>{
 let calls=0;const service=createReadingGuideService(await setup(t,{generator:async()=>{calls++;return calls===1?{}:output;}}));
 await assert.rejects(service.ensure(user,input));assert.equal((await service.view(user,input)).state,'failed');
 assert.equal((await service.ensure(user,input)).state,'failed');assert.equal(calls,1);
 assert.equal((await service.ensure(user,input,{retry:true})).state,'ready');assert.equal(calls,2);
 assert.equal((await service.view({...user,id:'other'},input)).state,'missing');assert.equal((await service.view(user,{...input,bookId:'other'})).state,'missing');assert.equal((await service.view(user,{...input,contentVersion:'v2'})).state,'missing');
});

test('real adapter invalid completion and proven pre-dispatch failure allow only explicit retry',async t=>{
 const {createReadingGuideGenerator}=await import('../harness/reading-guide-generator.mjs');
 const adapter=createReadingGuideGenerator({makeGenerator:()=>async()=>({summary:'not JSON'})}),service=createReadingGuideService(await setup(t,{generator:adapter}));
 await assert.rejects(service.ensure(user,input));assert.equal((await service.view(user,input)).state,'failed');
 for(const readerStage of ['preparation','initialize']){const safe=createReadingGuideService(await setup(t,{generator:async()=>{throw Object.assign(Error('startup failed'),{readerStage});}}));await assert.rejects(safe.ensure(user,input));assert.equal((await safe.view(user,input)).state,'failed');}
});
