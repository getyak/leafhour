import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReadingGuideService,normalizeReadingGuideContext} from '../server/reading-guide.mjs';

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
