import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReadingGuideService,normalizeReadingGuideContext} from '../server/reading-guide.mjs';
import {createReadingGuideGenerator} from '../harness/reading-guide-generator.mjs';

const user={id:'isolated-guide-owner'},version='v1';
const context={title:'Synthetic games',author:'Fixture',chapters:[{id:'c1',title:'Opening'}],passages:[{id:'p1',chapterId:'c1',original:'Finite games end. Infinite games continue.'}]};
const local={bookId:'local-book',contentVersion:version,sourceKind:'local-device',locale:'zh-Hans',context};
const output={opening:'开篇区分有限和无限的游戏。',method:'先看作者如何定义结束，再比较两个概念。',readingQuestion:'游戏的结束由谁决定？',model:'fixture-model'};
async function fixture(t,generator,library){const dir=await mkdtemp(path.join(tmpdir(),'leafhour-reading-guide-'));t.after(()=>rm(dir,{recursive:true,force:true}));return createReadingGuideService({dataDir:dir,generator,library});}

test('device guide caches per owner book version and never asks cloud library for device data',async t=>{
 let calls=0;const service=await fixture(t,async job=>{calls++;assert.deepEqual(job.context,context);return output;},{getBook(){throw Error('local must not read cloud');}});
 const first=await service.ensure(user,local),again=await service.ensure(user,local);
 assert.deepEqual(again,first);assert.equal(calls,1);assert.equal(first.guide.origin,'ai');assert.equal(first.guide.status,'draft');assert.equal(first.guide.sourceKind,'local-device');
 assert.deepEqual(first.guide.sampleRanges,[{passageId:'p1',chapterId:'c1',charOffset:0,charEnd:42}]);
 await service.ensure({id:'other-isolated-guide-owner'},local);await service.ensure(user,{...local,contentVersion:'v2'});assert.equal(calls,3);
});

test('opening context strictly bounds original text and rejects private data and unchecked identifiers',()=>{
 assert.throws(()=>normalizeReadingGuideContext({...context,notes:['private']}));
 assert.throws(()=>normalizeReadingGuideContext({...context,passages:Array.from({length:7},(_,i)=>({...context.passages[0],id:'p'+i}))}));
 assert.throws(()=>normalizeReadingGuideContext({...context,passages:[{...context.passages[0],original:'字'.repeat(6001)}]}));
 assert.throws(()=>normalizeReadingGuideContext({...context,chapters:Array.from({length:25},(_,i)=>({id:'c'+i,title:'Title'}))}));
 assert.throws(()=>normalizeReadingGuideContext({...context,title:'字'.repeat(7000)}));
 assert.throws(()=>normalizeReadingGuideContext({...context,passages:[{...context.passages[0],original:'\ud800'}]}));
});

test('cloud guide resolves current owner and source version then samples actual library originals',async t=>{
 const book={bookId:'cloud-book',contentVersion:version,title:{zh:'真实隔离书'},author:'Fixture',chapters:[{id:'c1',kind:'body',title:{zh:'正文'}}],sections:[{chapterId:'c1',paragraphs:[{id:'p1',original:'Actual fixture opening.'}]}]};
 let received;const service=await fixture(t,async job=>{received=job.context;return output;},{async getBook(who,id){assert.equal(who.id,user.id);assert.equal(id,'cloud-book');return book;}});
 const value=await service.ensure(user,{bookId:'cloud-book',contentVersion:version,sourceKind:'cloud',locale:'zh-Hans'});
 assert.equal(received.passages[0].original,'Actual fixture opening.');assert.equal(value.guide.sourceKind,'cloud');
 await assert.rejects(service.ensure(user,{bookId:'cloud-book',contentVersion:'stale',sourceKind:'cloud',locale:'zh-Hans'}),e=>e.status===409);
 await assert.rejects(service.ensure(user,{bookId:'cloud-book',contentVersion:version,sourceKind:'cloud',locale:'zh-Hans',context}),e=>e.status===400);
});

test('cancelled and revoked guide completions cannot publish late; duplicate preparation is not a second generation',async t=>{
 let release,started;const began=new Promise(r=>started=r);let calls=0;
 const service=await fixture(t,async()=>{calls++;started();return new Promise(r=>release=r);});
 const controller=new AbortController(),pending=service.ensure(user,local,{signal:controller.signal});await began;
 await assert.rejects(service.ensure(user,local),e=>e.status===409);assert.equal(calls,1);
 controller.abort();await assert.rejects(pending);release(output);
 assert.equal((await service.view(user,local)).guide,null);
 const revoked=await fixture(t,async()=>output);await assert.rejects(revoked.ensure(user,local,{authorize:async()=>false}),e=>e.status===401);
 assert.equal((await revoked.view(user,local)).guide,null);
});

test('failed guide can explicitly retry without storing fake text and anonymous callers never run a model',async t=>{
 let calls=0;const service=await fixture(t,async()=>{calls++;if(calls===1)throw Error('provider unavailable');return output;});
 await assert.rejects(service.ensure(null,local),e=>e.status===401);assert.equal(calls,0);
 await assert.rejects(service.ensure(user,local));assert.equal((await service.view(user,local)).guide,null);
 assert.equal((await service.ensure(user,local)).guide.method,output.method);assert.equal(calls,2);
});

test('sponsored guide attempts share bounded introduction capacity while cached reads stay free',async t=>{
 let calls=0;const service=await fixture(t,async()=>{calls++;return output;});
 for(let i=0;i<5;i++)await service.ensure(user,{...local,bookId:'local-'+i});
 await assert.rejects(service.ensure(user,{...local,bookId:'local-over-limit'}),e=>e.status===429);
 assert.equal(calls,5);await service.ensure(user,{...local,bookId:'local-0'});assert.equal(calls,5);
});

test('guide adapter freezes its context payload and excludes caller text history and tools while preserving limits',async()=>{
 let configuration,request,calls=0,callerToolCalls=0;
 const controller=new AbortController(),snapshot=structuredClone(context);
 const generate=createReadingGuideGenerator({model:'isolated-guide-model',makeGenerator:options=>{configuration=options;return async job=>{calls++;request=job;return {summary:JSON.stringify(output)};};}});
 const result=await generate({book:{bookId:'isolated-book',contentVersion:'v1'},context:snapshot,locale:'zh-Hans',signal:controller.signal,text:'HOSTILE_CALLER_TEXT',history:[{role:'user',content:'PRIVATE_CALLER_HISTORY'}],tools:{definitions:[{name:'hostile_read_notes'}],execute(){callerToolCalls++;return 'PRIVATE_NOTE';}}});
 assert.deepEqual(JSON.parse(request.text),{locale:'zh-Hans',...context});assert.doesNotMatch(request.text,/HOSTILE|PRIVATE|hostile_read_notes/);
 assert.deepEqual(request.history,[]);assert.deepEqual(request.tools.definitions,[]);assert.deepEqual(request.tools.sources(),[]);assert.deepEqual(request.tools.recommendations(),[]);
 assert.throws(()=>request.tools.execute('hostile_read_notes',{}),/has no tools/);assert.equal(callerToolCalls,0);assert.equal(request.signal,controller.signal);
 assert.deepEqual({timeoutMs:configuration.timeoutMs,maxRequests:configuration.maxRequests,maxToolCalls:configuration.maxToolCalls,maxTokens:configuration.maxTokens,maxCostCny:configuration.maxCostCny},{timeoutMs:60000,maxRequests:1,maxToolCalls:0,maxTokens:1000,maxCostCny:.1});
 snapshot.passages[0].original='Later caller mutation';assert.equal(JSON.parse(request.text).passages[0].original,context.passages[0].original);
 assert.deepEqual(result,{opening:output.opening,method:output.method,readingQuestion:output.readingQuestion,model:'isolated-guide-model'});assert.equal(calls,1);
});

test('guide adapter forwards cancellation without replacing it with a JSON failure or retrying',async()=>{
 let started,calls=0;const began=new Promise(resolve=>started=resolve),controller=new AbortController(),reason=new Error('isolated guide cancelled');
 const generate=createReadingGuideGenerator({makeGenerator:()=>async job=>{calls++;started();return new Promise((_,reject)=>job.signal.addEventListener('abort',()=>reject(job.signal.reason),{once:true}));}});
 const pending=generate({context,locale:'zh-Hans',signal:controller.signal});await began;controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(calls,1);
});

test('guide adapter rejects malformed or fenced JSON instead of returning a fabricated guide',async()=>{
 for(const summary of ['not JSON','```json\n{"opening":"partial"}\n```','{"opening":']){
  let calls=0;const generate=createReadingGuideGenerator({makeGenerator:()=>async()=>{calls++;return {summary};}});
  await assert.rejects(generate({context,locale:'zh-Hans'}),/Invalid reading guide JSON/);assert.equal(calls,1);
 }
});
