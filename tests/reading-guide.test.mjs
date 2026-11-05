import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReadingGuideService,normalizeReadingGuideContext} from '../server/reading-guide.mjs';
import {createReadingGuideGenerator} from '../harness/reading-guide-generator.mjs';
import * as guideModule from '../harness/reading-guide-generator.mjs';

const user={id:'isolated-guide-owner'},version='v1';
const context={title:'Synthetic games',author:'Fixture',chapters:[{id:'c1',title:'Opening'}],passages:[{id:'p1',chapterId:'c1',original:'Finite games end. Infinite games continue.'}]};
const selector={lens:'observe',anchors:[{passageId:'p1',quote:'Finite games end.'}],focusTerms:['Finite games']};
const adapterBook={bookId:'isolated-book',contentVersion:'v1'};
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
 const generate=createReadingGuideGenerator({model:'isolated-guide-model',makeGenerator:options=>{configuration=options;return async job=>{calls++;request=job;return {summary:JSON.stringify(selector)};};}});
 const result=await generate({book:{...adapterBook,notes:'PRIVATE_BOOK_NOTE'},context:snapshot,locale:'zh-Hans',signal:controller.signal,text:'HOSTILE_CALLER_TEXT',history:[{role:'user',content:'PRIVATE_CALLER_HISTORY'}],voice:{id:'PRIVATE_VOICE'},guideContext:{opening:'PRIVATE_GUIDE'},notes:['PRIVATE_JOB_NOTE'],onProgress:()=>{throw Error('PRIVATE_PROGRESS');},tools:{definitions:[{name:'hostile_read_notes'}],execute(){callerToolCalls++;return 'PRIVATE_NOTE';}}});
 assert.deepEqual(JSON.parse(request.text),{locale:'zh-Hans',...context});assert.doesNotMatch(request.text,/HOSTILE|PRIVATE|hostile_read_notes/);
 assert.deepEqual(Object.keys(request).sort(),['book','text','signal','history','tools'].sort());assert.deepEqual(request.book,adapterBook);
 assert.deepEqual(request.history,[]);assert.deepEqual(request.tools.definitions,[]);assert.deepEqual(request.tools.sources(),[]);assert.deepEqual(request.tools.recommendations(),[]);
 assert.throws(()=>request.tools.execute('hostile_read_notes',{}),/has no tools/);assert.equal(callerToolCalls,0);assert.equal(request.signal,controller.signal);
 assert.deepEqual({timeoutMs:configuration.timeoutMs,maxRequests:configuration.maxRequests,maxToolCalls:configuration.maxToolCalls,maxTokens:configuration.maxTokens,maxCostCny:configuration.maxCostCny},{timeoutMs:60000,maxRequests:1,maxToolCalls:0,maxTokens:1000,maxCostCny:.1});
 snapshot.passages[0].original='Later caller mutation';assert.equal(JSON.parse(request.text).passages[0].original,context.passages[0].original);
 assert.deepEqual(Object.keys(result).sort(),['opening','method','readingQuestion','model'].sort());assert.equal(result.model,'isolated-guide-model');assert.ok(result.opening.includes('Finite games'));assert.ok(result.method.includes('Finite games end.'));assert.equal(calls,1);
});

test('guide adapter forwards cancellation without replacing it with a JSON failure or retrying',async()=>{
 let started,calls=0;const began=new Promise(resolve=>started=resolve),controller=new AbortController(),reason=new Error('isolated guide cancelled');
 const generate=createReadingGuideGenerator({makeGenerator:()=>async job=>{calls++;started();return new Promise((_,reject)=>job.signal.addEventListener('abort',()=>reject(job.signal.reason),{once:true}));}});
 const pending=generate({book:adapterBook,context,locale:'zh-Hans',signal:controller.signal});await began;controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(calls,1);
});

test('guide adapter rejects malformed or fenced JSON instead of returning a fabricated guide',async()=>{
 for(const summary of ['not JSON','```json\n{"opening":"partial"}\n```','{"opening":']){
  let calls=0;const generate=createReadingGuideGenerator({makeGenerator:()=>async()=>{calls++;return {summary};}});
  await assert.rejects(generate({book:adapterBook,context,locale:'zh-Hans'}),/Invalid reading guide JSON/);assert.equal(calls,1);
 }
});

test('source-focus renderer accepts all four locales and seven lenses without translating literal terms or exceeding field bounds',()=>{
 const a='🚲'.repeat(180),b='🌿'.repeat(180),source={title:'Fixture',author:'',chapters:[{id:'章-一',title:'Scope'}],passages:[{id:'段-甲',chapterId:'章-一',original:a+'🪶'.repeat(60)},{id:'段-乙',chapterId:'章-一',original:b}]};
 for(const locale of ['zh-Hans','zh-Hant','en','ja'])for(const lens of ['observe','narrative','comparison','definition','argument','imagery','metadata']){
  const selected={lens,anchors:[{passageId:'段-甲',quote:a},{passageId:'段-乙',quote:b}],focusTerms:['🚲'.repeat(60),'🌿'.repeat(60),'🪶'.repeat(60)]};
  const guide=guideModule.renderGuideSelection(selected,source,locale);
  assert.deepEqual(Object.keys(guide).sort(),['opening','method','readingQuestion'].sort());
  assert.ok(selected.focusTerms.every(term=>guide.opening.includes(term)));assert.ok(guide.method.includes(a)&&guide.method.includes(b));
  assert.ok(guide.opening.length<=1200&&guide.method.length<=1200&&guide.readingQuestion.length<=300);
  assert.ok(!guide.readingQuestion.includes(a)&&!guide.readingQuestion.includes(b));
 }
});

test('three literal focus terms from selected fixture paragraphs are accepted without rewriting',()=>{
 const source={title:'Isolated notebook fixture',author:'',chapters:[{id:'fixture-chapter',title:'Excerpt'}],passages:[
  {id:'fixture-notebook-a',chapterId:'fixture-chapter',original:'Asha compares a notebook with a chart before choosing a route.'},
  {id:'fixture-notebook-b',chapterId:'fixture-chapter',original:'The sample places an earlier assumption beside a choice based on fresh observations.'}
 ]};
 const selection={lens:'comparison',anchors:[
  {passageId:'fixture-notebook-a',quote:'Asha compares a notebook with a chart before choosing a route.'},
  {passageId:'fixture-notebook-b',quote:'The sample places an earlier assumption beside a choice based on fresh observations.'}
 ],focusTerms:['compares a notebook with a chart','earlier assumption','fresh observations']};
 const guide=guideModule.renderGuideSelection(selection,source);
 assert.ok(selection.focusTerms.every(term=>guide.opening.includes(term)));
 assert.ok(selection.anchors.every(anchor=>guide.method.includes(anchor.quote)));
});

test('a literal term outside its displayed quote remains valid inside the selected source paragraph',()=>{
 const source={title:'Isolated platform fixture',author:'',chapters:[{id:'fixture-chapter',title:'Excerpt'}],passages:[
  {id:'fixture-platform-a',chapterId:'fixture-chapter',original:'A traveler sees a posted timetable, but one display is blank.'},
  {id:'fixture-platform-b',chapterId:'fixture-chapter',original:'A green lamp remains on. The sample leaves the departure status unresolved.'}
 ]};
 const selection={lens:'observe',anchors:[
  {passageId:'fixture-platform-a',quote:'one display is blank'},
  {passageId:'fixture-platform-b',quote:'The sample leaves the departure status unresolved.'}
 ],focusTerms:['display is blank','green lamp remains on']};
 const guide=guideModule.renderGuideSelection(selection,source);
 assert.ok(guide.opening.includes('green lamp remains on'));
 assert.ok(!selection.anchors.some(anchor=>anchor.quote.includes('green lamp remains on')));
 assert.ok(guide.method.includes(selection.anchors[1].quote));
});

test('focus terms cannot come from an unselected paragraph even when it is in the same authorized context',()=>{
 const source={...context,passages:[context.passages[0],{id:'p2',chapterId:'c1',original:'A blue marker is visible in this unselected paragraph.'}]};
 assert.throws(()=>guideModule.renderGuideSelection({...selector,focusTerms:['blue marker is visible']},source));
 const sameParagraph=guideModule.renderGuideSelection({...selector,focusTerms:['Infinite games']},context);
 assert.ok(sameParagraph.opening.includes('Infinite games'));
 assert.ok(!selector.anchors[0].quote.includes('Infinite games'));
});

test('selector rejects invented anchors, unselected focus terms, duplicates and old free-prose schemas',()=>{
 const source={...context,passages:[{id:'p1',chapterId:'c1',original:'Finite games end. Infinite games continue. e\u0301'}]};
 const badSelections=[
  {...selector,opening:'fabricated'}, {...selector,angle:'free prose'}, {...selector,lens:'unknown'},
  {...selector,anchors:[]}, {...selector,anchors:[...selector.anchors,...selector.anchors]}, {...selector,lens:'comparison'},
  {...selector,anchors:[{passageId:'missing',quote:'Finite games end.'}]}, {...selector,anchors:[{passageId:'p1',quote:'Finite games never end.'}]},
  {...selector,anchors:[{passageId:'p1',quote:'é'}]}, {...selector,focusTerms:[]}, {...selector,focusTerms:['Finite games','Finite games']},
  {...selector,focusTerms:['not in source']}, {...selector,focusTerms:[' ']},
  {...selector,focusTerms:['x'.repeat(61)]}, {...selector,anchors:[{passageId:'p1',quote:'x'.repeat(181)}]},
  {opening:'old',method:'old',readingQuestion:'old'}
 ];
 assert.equal(typeof guideModule.renderGuideSelection,'function');
 for(const selection of badSelections)assert.throws(()=>guideModule.renderGuideSelection(selection,source));
});

test('quote and focus limits reject otherwise literal selections at the exact length boundary',()=>{
 const source={...context,passages:[{id:'p1',chapterId:'c1',original:'x'.repeat(181)}]};
 const selected={lens:'observe',anchors:[{passageId:'p1',quote:'x'.repeat(180)}],focusTerms:['x'.repeat(60)]};
 assert.ok(guideModule.renderGuideSelection(selected,source).method.includes(selected.anchors[0].quote));
 assert.throws(()=>guideModule.renderGuideSelection({...selected,anchors:[{passageId:'p1',quote:'x'.repeat(181)}]},source));
 assert.throws(()=>guideModule.renderGuideSelection({...selected,focusTerms:['x'.repeat(61)]},source));
 assert.throws(()=>guideModule.renderGuideSelection({...selector,focusTerms:['Finite','games','end.','games end.']},context));
 const repeated={...context,passages:[context.passages[0],{...context.passages[0],id:'p2'}]};
 assert.throws(()=>guideModule.renderGuideSelection({...selector,lens:'comparison',anchors:[selector.anchors[0],{...selector.anchors[0],passageId:'p2'}]},repeated));
});

test('invalid locale, source envelope or identity never reaches a model',async()=>{
 let calls=0;const generate=createReadingGuideGenerator({makeGenerator:()=>async()=>{calls++;return {summary:JSON.stringify(selector)};}});
 const job={book:adapterBook,context,locale:'zh-Hans'};
 const badJobs=[{...job,locale:'fr'},{...job,context:{...context,notes:['private']}},{...job,context:{...context,passages:[...context.passages,...context.passages]}},{...job,book:{bookId:'\ud800',contentVersion:'v1'}},{...job,book:{bookId:'book\nid',contentVersion:'v1'}},
  {...job,context:{...context,passages:[{...context.passages[0],id:'段\n甲'}]}},
  {...job,context:{...context,passages:Array.from({length:7},(_,i)=>({...context.passages[0],id:'p'+i}))}},
  {...job,context:{...context,passages:[{...context.passages[0],original:'字'.repeat(6001)}]}},
  {...job,context:{...context,title:'字'.repeat(7000)}},
  {...job,context:{...context,passages:[{...context.passages[0],original:'\ud800'}]}}
 ];
 for(const invalid of badJobs)await assert.rejects(generate(invalid));
 assert.equal(calls,0);
});

test('the source snapshot and book identity remain frozen across an awaited selector response',async()=>{
 const source=structuredClone(context),book={...adapterBook};let release,started,captured;const began=new Promise(resolve=>started=resolve);
 const generate=createReadingGuideGenerator({makeGenerator:()=>async job=>{captured=job;started();return new Promise(resolve=>release=resolve);}});
 const pending=generate({book,context:source,locale:'zh-Hans'});await began;
 source.passages[0].original='Changed while model was running';source.passages.push({id:'other',chapterId:'c1',original:'Additional private text'});book.bookId='changed-book';
 release({summary:JSON.stringify(selector)});const result=await pending;
 assert.equal(captured.book.bookId,adapterBook.bookId);assert.equal(JSON.parse(captured.text).passages.length,1);assert.ok(result.method.includes(selector.anchors[0].quote));
});

test('pre-aborted and late-aborted selector calls preserve the cancellation reason before JSON parsing',async()=>{
 const reason=new Error('source-focus cancelled'),before=new AbortController();before.abort(reason);let calls=0;
 const generate=createReadingGuideGenerator({makeGenerator:()=>async()=>{calls++;return {summary:JSON.stringify(selector)};}});
 await assert.rejects(generate({book:adapterBook,context,locale:'zh-Hans',signal:before.signal}),error=>error===reason);assert.equal(calls,0);
 const after=new AbortController();const late=createReadingGuideGenerator({makeGenerator:()=>async()=>{after.abort(reason);return {summary:'invalid JSON'};}});
 await assert.rejects(late({book:adapterBook,context,locale:'zh-Hans',signal:after.signal}),error=>error===reason);
});
