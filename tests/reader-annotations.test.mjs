import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createAnnotationArchive,createAnnotationThread,appendAnnotationMessage} from '../app/reader-annotation-records.mjs';

const alice={id:'ann-reader-a'},bob={id:'ann-reader-b'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const paragraph=(id,original)=>({id,original,translations:{},annotationIds:[],termIds:[]});
const translation=(text,status)=>({text,status,variant:status==='reviewed'?'interpretive':'literal',origin:'ai',sourceVersion:'edition-1',createdAt:'2026-01-01T00:00:00.000Z'});
const bookFixture=()=>({
  bookId:'ann-book',contentVersion:'edition-1',visibility:'private',title:{zh:'注解样本',en:'Annotation fixture'},author:'Test author',
  source:{format:'txt',sha256:'edition-1'},
  chapters:[{id:'ch1',kind:'body',number:1,title:{zh:'第一章'}},{id:'ch2',kind:'body',number:2,title:{zh:'第二章'}}],
  sections:[
    {number:1,chapterId:'ch1',paragraphs:[
      {...paragraph('p1','First source sentence.'),translations:{literal:translation('第一句直译。','draft'),interpretive:translation('开头提出这个意思。','reviewed')}},
      paragraph('p2','Second source sentence.'),
      {...paragraph('p3','Third source sentence.'),translations:{literal:translation('第三句直译。','draft')}}]},
    {number:2,chapterId:'ch2',paragraphs:[paragraph('p4','Another chapter begins.')]}
  ],
  annotations:[{text:'PRIVATE OUTSIDE CONTEXT'}],glossary:[{text:'PRIVATE GLOSSARY'}],privateMetadata:'DO NOT SEND THIS'
});
const sourceText='First source sentence.';
const originalQuote=(patch={},bookId='ann-book')=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId,contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:sourceText.length,text:sourceText}],...patch});
const literalQuote=(patch={})=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p1',layer:'literal',start:0,end:'第一句直译。'.length,text:'第一句直译。',translationStatus:'draft'}],...patch});
const p3LiteralQuote=(patch={})=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p3',layer:'literal',start:0,end:'第三句直译。'.length,text:'第三句直译。',translationStatus:'draft'}],...patch});
const input=(patch={})=>({id:'request-1',threadId:'thread-1',quote:originalQuote(),...patch});
const highlightInput=(id='highlight-1',bookId='ann-book')=>({id,bookId,contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p1',language:'en',variant:'interpretive',start:0,end:sourceText.length,text:sourceText}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const status=n=>error=>error.status===n;
const answer=(body='这里解释当前原文的意思。')=>({kind:'annotation',text:body});
async function within(promise,ms,message){
  let timer;try{return await Promise.race([promise,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}
}

// Real HostedStore over an in-memory fetcher: genuine read/CAS semantics with
// deterministic gates, no Supabase, network or credentials.
function fakeSupabase(){
  const docs=new Map();
  let intercept=null;
  const respond=value=>new Response(JSON.stringify(value),{status:200});
  const fetcher=async(url,options={})=>{
    const parsed=new URL(url);
    if(parsed.pathname==='/rest/v1/reader_documents'&&options.method===undefined){
      const key=new URLSearchParams(parsed.search).get('key').slice(3),row=docs.get(key);
      return respond(row?[{value:row.value,version:row.version}]:[]);
    }
    if(parsed.pathname==='/rest/v1/rpc/reader_document_cas'){
      const body=JSON.parse(options.body);
      if(intercept)await intercept({key:body.document_key,expected:body.expected_version,current:(docs.get(body.document_key)||{version:0}).version});
      // CAS acceptance is evaluated when the request executes, after any gate.
      const row=docs.get(body.document_key)||{value:null,version:0},accepted=row.version===body.expected_version;
      if(accepted)docs.set(body.document_key,{value:structuredClone(body.document_value),version:row.version+1});
      return respond(accepted);
    }
    throw Error('Unexpected storage request '+parsed.pathname);
  };
  return {docs,fetcher,arm(fn){intercept=fn;},disarm(){intercept=null;}};
}

async function fixture(t,{generator,annotationGenerator,translator=null,dataStore=null,book=bookFixture(),seedUsers=[alice]}={}){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'marginalia-annotations-'));
  const library=await createLibraryService({dataDir,catalogDir:null,translator,dataStore});
  const services=[];
  const seed=async(user,content=book)=>{
    const file=path.join(dataDir,'users',hash(user.id),'books',hash(content.bookId)+'.json');
    if(dataStore)await dataStore.mutate(file,{},data=>Object.assign(data,structuredClone(content)));
    else{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(content));}
  };
  for(const user of seedUsers)await seed(user);
  const create=async(options={})=>{
    const service=await createReaderChatService({library,dataDir,generator:generator??null,annotationGenerator,dataStore,...options});
    services.push(service);return service;
  };
  const service=await create();
  t.after(async()=>{for(const s of services)await s.close();await rm(dataDir,{recursive:true,force:true});});
  return {dataDir,library,service,create,seed,services,annotations:service.annotations};
}

test('an explicit initial request persists an empty thread and publishes one AI-only attributed message',async t=>{
  let job,inside;
  const {annotations}=await fixture(t,{annotationGenerator:async value=>{
    job=value;
    inside=await annotations.view(alice,'ann-book');
    assert.equal(inside.requests[0].status,'running');
    assert.equal(inside.archive.threads[0].messages.length,0,'initial request must not fabricate a user question');
    return answer();
  }});
  const result=await annotations.explain(alice,'ann-book',input());
  assert.equal(result.request.status,'completed');assert.equal(result.request.id,'request-1');assert.equal(result.request.threadId,'thread-1');
  assert.ok(Number.isFinite(Date.parse(result.request.createdAt)));
  const [message]=result.thread.messages;
  assert.equal(message.origin,'ai');assert.equal(message.body,'这里解释当前原文的意思。');
  assert.deepEqual(message.provenance,{source:'site-agent',label:'Leafhour reading agent'});
  assert.equal(result.thread.messages.length,1);
  assert.equal(job.kind,'annotation');assert.ok(job.runId);assert.ok(job.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(job.book).sort(),['bookId','contentVersion','title']);
  assert.deepEqual(job.history,[]);
  assert.equal(job.text,'请用简体中文解释这段选中的文字。');
  assert.ok(job.tools.definitions.some(d=>d.name==='reader_get_annotations'));
  const safe=JSON.stringify(result)+JSON.stringify(inside);
  for(const secret of ['runId','lease','expiresAt','nonce','hash','DO NOT SEND','PRIVATE OUTSIDE'])assert.ok(!safe.includes(secret),secret+' leaked through the safe shape');
  assert.deepEqual(Object.keys(inside).sort(),['archive','available','requests']);
  assert.equal(inside.available,true);
});

test('follow-ups keep the exact user words once and a failed model never loses them',async t=>{
  const calls=[];
  const {annotations}=await fixture(t,{annotationGenerator:async job=>{calls.push(job);if(calls.length===2)throw Error('SECRET PROVIDER TOKEN /private/path');return answer(calls.length===1?'这里解释当前原文的意思。':'回答 '+job.text);}});
  await annotations.explain(alice,'ann-book',input());
  const follow=await annotations.explain(alice,'ann-book',input({id:'request-2',text:'  我自己的追问  '}));
  assert.equal(follow.request.status,'failed');
  const messages=follow.thread.messages;
  assert.equal(messages.length,2);
  assert.equal(messages[1].origin,'user');assert.equal(messages[1].body,'  我自己的追问  ');
  assert.equal(Object.hasOwn(messages[1],'provenance'),false);
  assert.ok(!JSON.stringify(follow).includes('SECRET')&&!JSON.stringify(follow).includes('/private/path'));
  assert.deepEqual(calls[1].history,[{role:'assistant',content:'这里解释当前原文的意思。'}]);
  assert.equal(calls[1].text,'  我自己的追问  ');
  const retry=await annotations.explain(alice,'ann-book',input({id:'request-2',text:'  我自己的追问  '}));
  assert.equal(retry.request.status,'failed');assert.equal(calls.length,2,'an exact retry must not regenerate or recharge');
});

test('running and terminal receipts are idempotent while changed immutable input conflicts',async t=>{
  const entered=deferred(),finish=deferred();let calls=0;
  const {annotations,create}=await fixture(t,{annotationGenerator:async()=>{calls++;entered.resolve();await finish.promise;return answer();}});
  const pending=annotations.explain(alice,'ann-book',input());
  await entered.promise;
  const running=await annotations.explain(alice,'ann-book',input());
  assert.equal(running.request.status,'running');assert.equal(calls,1,'a running exact retry must return its receipt without a second charge');
  finish.resolve();
  const first=await within(pending,4000,'explain did not finish');
  assert.equal(first.request.status,'completed');
  assert.deepEqual(await annotations.explain(alice,'ann-book',input()),first);
  const offline=await create({annotationGenerator:null});
  assert.deepEqual(await offline.annotations.explain(alice,'ann-book',input()),first);
  for(const patch of [{text:'different'},{threadId:'thread-2'},{quote:literalQuote()},{id:'../escape'}]){
    await assert.rejects(annotations.explain(alice,'ann-book',input(patch)),error=>[400,409].includes(error.status));
  }
  assert.equal(calls,1);
});

test('an exact terminal retry survives a later translation edit as a historical receipt',async t=>{
  let calls=0;
  const {annotations,seed}=await fixture(t,{annotationGenerator:async()=>{calls++;return answer();}});
  const first=await annotations.explain(alice,'ann-book',input({quote:literalQuote()}));
  assert.equal(first.request.status,'completed');
  const changed=bookFixture();changed.sections[0].paragraphs[0].translations.literal=translation('后来的直译文本。','draft');
  await seed(alice,changed);
  assert.deepEqual(await annotations.explain(alice,'ann-book',input({quote:literalQuote()})),first);
  // New writes still require the current source.
  await assert.rejects(annotations.explain(alice,'ann-book',input({id:'request-2',quote:literalQuote()})),status(422));
  assert.equal(calls,1);
});

test('a second request on one thread is rejected while any request is running',async t=>{
  const entered=deferred(),finish=deferred();
  const {annotations}=await fixture(t,{annotationGenerator:async()=>{entered.resolve();await finish.promise;return answer();}});
  const pending=annotations.explain(alice,'ann-book',input());
  await entered.promise;
  await assert.rejects(annotations.explain(alice,'ann-book',input({id:'request-2'})),status(409));
  await assert.rejects(annotations.explain(alice,'ann-book',input({id:'request-2',text:'并发追问'})),status(409));
  finish.resolve();assert.equal((await pending).request.status,'completed');
  assert.equal((await annotations.explain(alice,'ann-book',input({id:'request-2'}))).request.status,'completed');
});

test('identity, stale quotes, bad highlights and oversize input fail before claim, quota or provider',async t=>{
  let calls=0;
  const {annotations,library,seed}=await fixture(t,{annotationGenerator:async()=>{calls++;return answer();}});
  for(const user of [null,{},{id:'',is_anonymous:true},{id:'anon',is_anonymous:true}])await assert.rejects(annotations.explain(user,'ann-book',input()),status(401));
  await library.addHighlight(alice,'ann-book',highlightInput());
  await assert.rejects(annotations.explain(alice,'ann-book',input({quote:literalQuote(),highlightId:'highlight-1'})),error=>[400,409].includes(error.status),'a highlight on other source offsets must be refused');
  await assert.rejects(annotations.explain(alice,'ann-book',input({highlightId:'missing'})),status(404));
  await assert.rejects(annotations.explain(alice,'ann-book',input({text:'界'.repeat(2001)})),status(400));
  await assert.rejects(annotations.explain(alice,'ann-book',{id:'request-1',threadId:'thread-1',quote:originalQuote(),owner:alice.id}),status(400));
  const changed=bookFixture();changed.sections[0].paragraphs[0].original='A corrected original with the same stable paragraph ID.';
  await seed(alice,changed);
  await assert.rejects(annotations.explain(alice,'ann-book',input()),status(422));
  await seed(alice);
  await assert.rejects(annotations.explain(alice,'missing-book',input()),status(404));
  assert.equal(calls,0,'no provider call may precede the preflight');
  const view=await annotations.view(alice,'ann-book');
  assert.deepEqual(view.requests,[],'failed preflight must not claim a run');
});

test('capacity is reserved upfront: message slots and run records refuse explicitly before dispatch',async t=>{
  let calls=0;
  const {annotations,dataDir}=await fixture(t,{annotationGenerator:async()=>{calls++;return answer();}});
  let archive=createAnnotationArchive('ann-book');
  archive=createAnnotationThread(archive,bookFixture(),{id:'thread-1',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'});
  for(let i=0;i<19;i++)archive=appendAnnotationMessage(archive,bookFixture(),'thread-1',i%2?{id:'msg-user-'+i,origin:'user',body:'追问 '+i,createdAt:'2026-01-02T00:00:00.000Z'}:{id:'msg-ai-'+i,origin:'ai',body:'解释 '+i,createdAt:'2026-01-02T00:00:00.000Z',provenance:{source:'site-agent',label:'Leafhour reading agent'}});
  const stateFile=path.join(dataDir,'users',hash(alice.id),'annotations',hash('ann-book')+'.json');
  await mkdir(path.dirname(stateFile),{recursive:true});
  await writeFile(stateFile,JSON.stringify({archive,runs:[]}));
  // 19 stored + one user follow-up + the reserved worst-case AI answer exceeds 20.
  await assert.rejects(annotations.explain(alice,'ann-book',input({text:'最后一次追问'})),status(413));
  assert.equal(calls,0,'capacity must be refused before any paid dispatch');
  const after=JSON.parse(await readFile(stateFile,'utf8'));
  assert.equal(after.archive.threads[0].messages.length,19,'a refused request must persist no partial words');
  assert.deepEqual(after.runs,[]);
  const runs=Array.from({length:100},(_,i)=>({id:'saved-'+i,nonce:'n'+i,threadId:'thread-1',status:'completed',createdAt:'2026-01-01T00:00:00.000Z',expiresAt:1,payload:{id:'saved-'+i,threadId:'thread-1',quote:originalQuote()},aiMessageId:'ai-'+i}));
  await writeFile(stateFile,JSON.stringify({archive:createAnnotationArchive('ann-book'),runs}));
  await assert.rejects(annotations.explain(alice,'ann-book',input({id:'over-capacity'})),status(413));
  assert.equal(calls,0);
});

test('cancellation fences a late model answer durably across service instances',async t=>{
  const entered=deferred(),finish=deferred();let signal;
  const {annotations,create}=await fixture(t,{annotationGenerator:async job=>{signal=job.signal;entered.resolve();await finish.promise;return answer('迟到的回答');}});
  const pending=annotations.explain(alice,'ann-book',input());
  await entered.promise;
  const other=await create();
  assert.equal((await other.annotations.cancel(alice,'ann-book','request-1')).request.status,'cancelled');
  finish.resolve();
  const result=await within(pending,4000,'explain ignored cancellation');
  assert.equal(result.request.status,'cancelled');
  assert.equal(signal.aborted,true);
  assert.deepEqual(result.thread.messages,[],'a cancelled request must never publish an answer');
  await assert.rejects(other.annotations.cancel(alice,'ann-book','missing'),status(404));
});

test('thread removal tombstones durably and can never be revived by a retry or a new request',async t=>{
  let calls=0;
  const {annotations}=await fixture(t,{annotationGenerator:async()=>{calls++;return answer();}});
  await annotations.explain(alice,'ann-book',input());
  const removed=await annotations.remove(alice,'ann-book','thread-1');
  assert.ok(removed.deletedAt);
  await assert.rejects(annotations.explain(alice,'ann-book',input({id:'request-2'})),status(409));
  await assert.rejects(annotations.explain(alice,'ann-book',input({id:'request-2',text:'追问'})),status(409));
  assert.equal(calls,1);
  const restored=await annotations.explain(alice,'ann-book',input({id:'request-1'}));
  assert.equal(restored.request.status,'completed');
  assert.equal((await annotations.view(alice,'ann-book')).archive.threads[0].messages.length,1);
});

test('closing the service cancels its own annotation runs and releases their tickets',async t=>{
  const entered=deferred();let signal;
  const {annotations}=await fixture(t,{annotationGenerator:async job=>{signal=job.signal;entered.resolve();await new Promise((resolve,reject)=>job.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}));}});
  const pending=annotations.explain(alice,'ann-book',input());
  await entered.promise;
  await annotations.close();
  assert.equal(signal.aborted,true);
  assert.equal((await within(pending,4000,'close did not settle the run')).request.status,'cancelled');
});

test('export, validate and restore move only archive words and never jobs or tombstone revival',async t=>{
  const {annotations}=await fixture(t,{annotationGenerator:async()=>answer()});
  await annotations.explain(alice,'ann-book',input());
  await annotations.explain(alice,'ann-book',input({id:'request-2',threadId:'thread-2'}));
  await annotations.remove(alice,'ann-book','thread-2');
  const exported=await annotations.exportArchive(alice,'ann-book');
  assert.equal(exported.kind,'leafhour-reader-annotations');assert.equal(exported.schemaVersion,1);
  assert.deepEqual(Object.keys(exported).sort(),['bookId','kind','revision','schemaVersion','threads']);
  assert.equal(exported.threads.length,2);
  assert.ok(exported.threads.find(row=>row.id==='thread-2').deletedAt);
  assert.ok(JSON.stringify(exported).includes('这里解释当前原文的意思。'));
  const validated=await annotations.validateArchive(alice,bookFixture(),exported);
  assert.deepEqual(validated,exported);
  await assert.rejects(annotations.validateArchive(alice,{...bookFixture(),bookId:'other'},exported),error=>[400,404,409].includes(error.status));
  const merged=await annotations.restoreArchive(alice,bookFixture(),exported);
  assert.equal(merged.threads.length,2);
  const view=await annotations.view(alice,'ann-book');
  assert.equal(view.requests.length,2,'restore must never import runtime jobs');
  assert.equal(view.archive.threads.find(row=>row.id==='thread-2').deletedAt,exported.threads.find(row=>row.id==='thread-2').deletedAt,'a tombstone must survive restore');
});

test('publication first wins as an honest historical snapshot before the deletion ACK',async t=>{
  const store=fakeSupabase(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'fixture'},fetcher:store.fetcher});
  const {annotations,library}=await fixture(t,{dataStore,annotationGenerator:async()=>answer()});
  await library.addHighlight(alice,'ann-book',highlightInput());
  const result=await annotations.explain(alice,'ann-book',input({highlightId:'highlight-1'}));
  assert.equal(result.request.status,'completed');assert.equal(result.thread.messages.length,1);
  await library.removeHighlight(alice,'ann-book','highlight-1');
  const view=await annotations.view(alice,'ann-book');
  assert.equal(view.requests[0].status,'completed','a completed historical answer must not be rewritten by a later deletion');
  assert.equal(view.archive.threads[0].messages.length,1);
});

test('a fence ACK wins over a stalled publication CAS and no answer is saved after the ACK',{timeout:15000},async t=>{
  const store=fakeSupabase(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'fixture'},fetcher:store.fetcher});
  const events=[],gate=deferred(),released=deferred();
  const stateKeySuffix=path.join('annotations',hash('ann-book')+'.json');
  let armed=false;
  store.arm(async({key,expected,current})=>{
    if(armed&&key.endsWith(stateKeySuffix)&&expected===current){armed=false;events.push('publication-cas-arrived');gate.resolve();await released.promise;events.push('publication-cas-released');}
  });
  const {annotations,library}=await fixture(t,{dataStore,annotationGenerator:async()=>{armed=true;return answer('迟到的解释');}});
  await library.addHighlight(alice,'ann-book',highlightInput());
  const pending=annotations.explain(alice,'ann-book',input({highlightId:'highlight-1'}));
  await within(gate.promise,6000,'publication CAS never reached the shared store');
  const removed=await library.removeHighlight(alice,'ann-book','highlight-1');
  assert.ok(removed.deletedAt);
  events.push('delete-acknowledged');
  released.resolve();
  const result=await within(pending,8000,'publication did not settle after its CAS was released');
  events.push('publication-settled');
  assert.equal(result.request.status,'cancelled','a fence that won first must leave the run terminal');
  assert.deepEqual(result.thread.messages,[],'no answer may be saved after the source-mutation ACK');
  assert.equal(events[0],'publication-cas-arrived');
  assert.ok(events.indexOf('delete-acknowledged')<events.indexOf('publication-cas-released'),'the ACK must fence before the stalled publication commits');
  const view=await annotations.view(alice,'ann-book');
  assert.equal(view.requests[0].status,'cancelled');
  assert.deepEqual(view.archive.threads[0].messages,[]);
});

test('an exact highlight-deletion retry repeats the fence after an honest listener failure',{timeout:15000},async t=>{
  const store=fakeSupabase(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'fixture'},fetcher:store.fetcher});
  const entered=deferred(),release=deferred();
  const {annotations,library}=await fixture(t,{dataStore,annotationGenerator:async()=>{entered.resolve();await release.promise;return answer('不应保存');}});
  await library.addHighlight(alice,'ann-book',highlightInput());
  const pending=annotations.explain(alice,'ann-book',input({highlightId:'highlight-1'}));
  await within(entered.promise,4000,'the run never started');
  // Simulate the annotation fence's cross-key read failing once: the source ACK
  // must fail honestly even though the highlight deletion already committed.
  const original=library.records.bind(library);let failures=1;
  library.records=async(...args)=>{if(failures-->0)throw Error('simulated fence read failure');return original(...args);};
  await assert.rejects(library.removeHighlight(alice,'ann-book','highlight-1'),/simulated fence read failure/);
  library.records=original;
  assert.equal((await annotations.view(alice,'ann-book')).requests[0].status,'running','a failed fence must leave the run untouched');
  // An exact retry of the already-deleted mutation re-runs the fence.
  const retry=await library.removeHighlight(alice,'ann-book','highlight-1');
  assert.ok(retry.deletedAt);
  release.resolve();
  const result=await within(pending,8000,'the fenced run did not settle');
  assert.equal(result.request.status,'cancelled','the repeated fence must cancel the affected run');
  assert.deepEqual(result.thread.messages,[],'a fenced run must never publish');
});

test('translation changes fence only runs with an invalidated frozen quote and spare fresh nonces',async t=>{
  const store=fakeSupabase(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'fixture'},fetcher:store.fetcher});
  const firstWave=deferred(),secondWave=deferred();
  const translator=async()=>({literal:'新的直译结果。',interpretive:'新的意译结果。'});
  const {annotations,library}=await fixture(t,{dataStore,translator,annotationGenerator:async job=>{
    if(job.text.includes('fresh')){await secondWave.promise;return answer('fresh 的解释');}
    await firstWave.promise;return answer(job.text.includes('p3')?'p3 的解释':'原文层的解释');
  }});
  const quoted=annotations.explain(alice,'ann-book',input({id:'quoted-run',threadId:'thread-quote',quote:p3LiteralQuote(),text:'p3 请解释'}));
  const original=annotations.explain(alice,'ann-book',input({id:'original-run',threadId:'thread-original',quote:originalQuote(),text:'原文请解释'}));
  await within((async()=>{for(let attempt=0;(await annotations.view(alice,'ann-book')).requests.length<2&&attempt<200;attempt++)await new Promise(r=>setTimeout(r,5));})(),4000,'both runs did not start');
  await library.translate(alice,'ann-book','p3');
  firstWave.resolve();
  assert.equal((await within(quoted,8000,'the invalidated quote run did not settle')).request.status,'cancelled','a translation change must fence runs whose frozen quote no longer validates');
  assert.equal((await within(original,8000,'the unrelated run did not settle')).request.status,'completed','an unrelated run must survive the fence');
  const view=await annotations.view(alice,'ann-book');
  assert.deepEqual(view.archive.threads.find(row=>row.id==='thread-quote').messages.map(message=>[message.origin,message.body]),[['user','p3 请解释']],'invalidated answer is absent and actual user words remain');
  // A late duplicate invalidation must spare a fresh generation on the new source.
  const fresh=annotations.explain(alice,'ann-book',input({id:'fresh-run',threadId:'thread-fresh',quote:{...p3LiteralQuote(),parts:[{passageId:'p3',layer:'literal',start:0,end:'新的直译结果。'.length,text:'新的直译结果。',translationStatus:'draft'}]},text:'fresh 请解释'}));
  await within((async()=>{for(let attempt=0;(await annotations.view(alice,'ann-book')).requests.length<3&&attempt<200;attempt++)await new Promise(r=>setTimeout(r,5));})(),4000,'the fresh run did not start');
  await library.translate(alice,'ann-book','p3');
  secondWave.resolve();
  assert.equal((await within(fresh,8000,'fresh run did not settle')).request.status,'completed','a fresh nonce must not be cancelled by a late duplicate invalidation');
});

test('source-mutation fences respect owner and book boundaries',{timeout:15000},async t=>{
  const store=fakeSupabase(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'fixture'},fetcher:store.fetcher});
  const second=bookFixture();second.bookId='other-book';
  const waveA=deferred(),waveB=deferred(),waveC=deferred();
  const {annotations,library,seed}=await fixture(t,{dataStore,seedUsers:[alice,bob],annotationGenerator:async job=>{await (job.text.includes('cross')?waveA:job.text.includes('theirs')?waveC:waveB).promise;return answer();}});
  await seed(alice,second);await seed(bob,second);
  await library.addHighlight(alice,'ann-book',highlightInput());
  await library.addHighlight(alice,'other-book',highlightInput('highlight-1','other-book'));
  await library.addHighlight(bob,'ann-book',highlightInput());
  // Two concurrent runs fill the shared gate: alice's own book and her other book.
  const mine=annotations.explain(alice,'ann-book',input({id:'mine',threadId:'thread-mine',highlightId:'highlight-1',text:'mine 请解释'}));
  const cross=annotations.explain(alice,'other-book',input({id:'cross',threadId:'thread-cross',quote:originalQuote({},'other-book'),highlightId:'highlight-1',text:'cross 请解释'}));
  await within((async()=>{for(let attempt=0;((await annotations.view(alice,'ann-book')).requests.length<1|| (await annotations.view(alice,'other-book')).requests.length<1)&&attempt<200;attempt++)await new Promise(r=>setTimeout(r,5));})(),4000,'both runs did not start');
  await library.removeHighlight(alice,'ann-book','highlight-1');
  waveA.resolve();waveB.resolve();
  assert.equal((await within(mine,8000,'owner run did not settle')).request.status,'cancelled');
  assert.equal((await within(cross,8000,'cross-book run did not settle')).request.status,'completed');
  // A late duplicate invalidation must spare another owner's fresh run.
  const theirs=annotations.explain(bob,'ann-book',input({id:'theirs',threadId:'thread-theirs',highlightId:'highlight-1',text:'theirs 请解释'}));
  await within((async()=>{for(let attempt=0;(await annotations.view(bob,'ann-book')).requests.length<1&&attempt<200;attempt++)await new Promise(r=>setTimeout(r,5));})(),4000,'the other owner run did not start');
  await library.removeHighlight(alice,'ann-book','highlight-1');
  waveC.resolve();
  assert.equal((await within(theirs,8000,'other-owner run did not settle')).request.status,'completed','another owner and book must stay independent');
});

test('runs carry bounded activity, never private context, and tools stay scoped to the current book',async t=>{
  let job;
  const {annotations}=await fixture(t,{annotationGenerator:async value=>{
    job=value;
    await job.tools.execute('reader_get_context',{});
    const read=await job.tools.execute('reader_get_annotations',{});
    assert.ok(read.error||read.items,'the annotation tool answers with bounded AI views only');
    await job.tools.execute('reader_cite',{bookId:'ann-book',passageId:'p1',layer:'original',quote:'First source sentence.'});
    const denied=await job.tools.execute('reader_read_chapter',{bookId:'other',chapterId:'ch1'});
    assert.ok(denied.error,'scope stays current-book');
    return {kind:'annotation',text:'带引用的解释',sourceRefs:[{passageId:'p1',layer:'original',quote:'First source sentence.'}]};
  }});
  await annotations.explain(alice,'ann-book',input());
  assert.deepEqual(job.tools.sources().map(ref=>ref.passageId),['p1']);
  const view=await annotations.view(alice,'ann-book');
  assert.ok(view.requests[0].activity.length>0);
  const message=view.archive.threads[0].messages[0];
  assert.deepEqual(message.sourceRefs,[{passageId:'p1',layer:'original',quote:'First source sentence.'}]);
  const serial=JSON.stringify(view);
  assert.ok(!serial.includes('DO NOT SEND')&&!serial.includes('PRIVATE GLOSSARY'));
});

test('initial annotation language is system-owned and immutable across four locales',async t=>{
 const expected={en:'Please explain the selected words in English.','zh-Hans':'请用简体中文解释这段选中的文字。','zh-Hant':'請用繁體中文解釋這段選取的文字。',ja:'選択した文章を日本語で説明してください。'};
 for(const [index,[locale,prompt]]of Object.entries(expected).entries()){
  let calls=0,job;
  const {annotations}=await fixture(t,{annotationGenerator:async value=>{calls++;job=value;return answer();}});
  const request=input({id:'locale-'+index,responseLocale:locale});
  const result=await annotations.explain(alice,'ann-book',request);
  assert.equal(result.request.status,'completed');assert.equal(job.text,prompt);
  assert.deepEqual(result.thread.messages.map(message=>message.origin),['ai']);
  await annotations.explain(alice,'ann-book',request);assert.equal(calls,1);
  await assert.rejects(annotations.explain(alice,'ann-book',{...request,responseLocale:locale==='en'?'ja':'en'}),status(409));
 }
 const {annotations}=await fixture(t,{annotationGenerator:async()=>answer()});
 await assert.rejects(annotations.explain(alice,'ann-book',input({responseLocale:'invalid'})),status(400));
 assert.deepEqual((await annotations.view(alice,'ann-book')).requests,[]);
});
