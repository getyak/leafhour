// GET-195 external annotation batch: genuine HostedStore CAS interleavings for
// putExternal versus the grant-revocation/source touches, idempotent external
// receipts, pending paid-run protection and the bounded AI-only external read.
// Deterministic gates only: no sleeps, no live models, data or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createAnnotationArchive,createAnnotationThread,appendAnnotationMessage} from '../app/reader-annotation-records.mjs';

const alice={id:'external-owner-a'},bob={id:'external-owner-b'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const stamp='2026-10-20T00:00:00.000Z';
const p2Text='选定原文。'.repeat(200);
const paragraph=(id,original)=>({id,original,translations:{},annotationIds:[],termIds:[]});
const translation=(textValue,status)=>({text:textValue,status,variant:status==='reviewed'?'interpretive':'literal',origin:'ai',sourceVersion:'edition-1',createdAt:stamp});
const bookFixture=()=>({
  bookId:'ann-book',contentVersion:'edition-1',visibility:'private',title:{zh:'外部注解样本'},author:'Test author',
  source:{format:'txt',sha256:'edition-1'},
  chapters:[{id:'ch1',kind:'body',number:1,title:{zh:'第一章'}},{id:'ch2',kind:'body',number:2,title:{zh:'第二章'}}],
  sections:[
    {number:1,chapterId:'ch1',paragraphs:[
      {...paragraph('p1','First source sentence.'),translations:{literal:translation('第一句直译。','draft'),interpretive:translation('开头提出这个意思。','reviewed')}},
      paragraph('p2',p2Text),
      {...paragraph('p3','Third source sentence.'),translations:{literal:translation('第三句直译。','draft')}}]},
    {number:2,chapterId:'ch2',paragraphs:[paragraph('p4','Another chapter begins.')]}
  ],
  annotations:[],glossary:[]
});
const sourceText='First source sentence.';
const originalQuote=(patch={})=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:sourceText.length,text:sourceText}],...patch});
const longQuote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p2',layer:'original',start:0,end:600,text:p2Text.slice(0,600)}]});
const p3LiteralQuote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'edition-1',chapterId:'ch1',parts:[{passageId:'p3',layer:'literal',start:0,end:'第三句直译。'.length,text:'第三句直译。',translationStatus:'draft'}]});
const putInput=(patch={})=>({bookId:'ann-book',threadId:'thread-ext',messageId:'ext-1',quote:originalQuote(),body:'外部解释正文',...patch});
const siteInput=(patch={})=>({id:'request-1',threadId:'thread-1',quote:originalQuote(),...patch});
const answer=(body='站点解释正文')=>({kind:'annotation',text:body});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const status=n=>error=>error.status===n;
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
      const row=docs.get(body.document_key)||{value:null,version:0},accepted=row.version===body.expected_version;
      if(accepted)docs.set(body.document_key,{value:structuredClone(body.document_value),version:row.version+1});
      return respond(accepted);
    }
    throw Error('Unexpected storage request '+parsed.pathname);
  };
  return {docs,fetcher,arm(fn){intercept=fn;},disarm(){intercept=null;}};
}
const hostedEnv={SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'fixture'};
async function fixture(t,{store=null,annotationGenerator=null,translator=null,seedUsers=[alice]}={}){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'annotations-external-'));
  const services=[];
  // Each create() is its own HostedStore instance over the same backing docs,
  // like two application instances sharing one hosted database.
  const create=async()=>{
    const dataStore=store?createHostedStore({env:hostedEnv,fetcher:store.fetcher}):null;
    const library=await createLibraryService({dataDir,catalogDir:null,translator,dataStore});
    const chat=await createReaderChatService({library,dataDir,dataStore,generator:null,annotationGenerator});
    services.push(chat);
    return {library,chat,annotations:chat.annotations,dataStore};
  };
  const seed=async(user,content=bookFixture())=>{
    const file=path.join(dataDir,'users',hash(user.id),'books',hash(content.bookId)+'.json');
    if(store)await createHostedStore({env:hostedEnv,fetcher:store.fetcher}).mutate(file,{},data=>Object.assign(data,structuredClone(content)));
    else{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(content));}
  };
  for(const user of seedUsers)await seed(user);
  t.after(async()=>{for(const service of services)await service.close().catch(()=>{});await rm(dataDir,{recursive:true,force:true});});
  return {dataDir,create,seed};
}
const stateKeyOf=dataDir=>path.join(dataDir,'users',hash(alice.id),'annotations',hash('ann-book')+'.json');

test('a held external put CAS loses to the grant-revocation touch ACK and stores no late message',{timeout:15000},async t=>{
  const store=fakeSupabase();let modelCalls=0;
  const {create,dataDir}=await fixture(t,{store,annotationGenerator:async()=>{modelCalls++;return answer();}});
  const a=await create(),b=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const suffix=path.join('annotations',hash('ann-book')+'.json');
  const events=[];const held=deferred(),release=deferred();
  let armed=true;
  store.arm(async({key})=>{
    if(!key.endsWith(suffix))return;
    if(armed){armed=false;events.push('put-cas-held');held.resolve();await release.promise;events.push('put-cas-released');}
    else events.push('touch-cas');
  });
  const pending=a.annotations.putExternal(alice,'ann-book',putInput(),{authorize:()=>a.library.authorize(grant.token,'ann-book','annotation:write')}).then(result=>{events.push('put-settled');return result;},error=>{events.push('put-settled');throw error;});
  await within(held.promise,6000,'the external put CAS never reached the shared store');
  const revoke=b.library.revokeGrant(alice,grant.id).then(result=>{events.push('revoke-acked');return result;});
  await within(revoke,6000,'the revocation ACK did not complete its same-key touch');
  assert.deepEqual(events,['put-cas-held','touch-cas','revoke-acked']);
  // The ACK observed one committed no-op touch: an existing wrapper with an
  // empty archive and empty runs, no fake fence fields and no paid fake run.
  const row=store.docs.get(stateKeyOf(dataDir));
  assert.equal(row.version,1,'the no-op touch must really CAS even with empty archive/runs');
  assert.deepEqual(Object.keys(row.value).sort(),['archive','runs']);
  assert.deepEqual(row.value.runs,[]);
  assert.deepEqual(row.value.archive.threads,[]);
  assert.deepEqual(Object.keys(row.value.archive).sort(),['bookId','kind','revision','schemaVersion','threads']);
  release.resolve();
  await assert.rejects(within(pending,8000,'the released put did not settle'),status(403));
  assert.ok(events.indexOf('put-cas-released')<events.indexOf('put-settled'));
  const view=await b.annotations.view(alice,'ann-book');
  assert.deepEqual(view.archive.threads,[],'no late external write may land after the revocation ACK');
  assert.equal(modelCalls,0,'an external put never calls a model');
});

test('a source-mutation touch fences a held external put with the honest source status',{timeout:15000},async t=>{
  const store=fakeSupabase();
  const {create}=await fixture(t,{store,translator:async()=>({literal:'新的直译结果。',interpretive:'新的意译结果。'})});
  const a=await create(),b=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const suffix=path.join('annotations',hash('ann-book')+'.json');
  const held=deferred(),release=deferred();
  let armed=true;
  store.arm(async({key})=>{if(armed&&key.endsWith(suffix)){armed=false;held.resolve();await release.promise;}});
  const pending=a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-p3',messageId:'ext-p3',quote:p3LiteralQuote()}),{authorize:()=>a.library.authorize(grant.token,'ann-book','annotation:write')});
  await within(held.promise,6000,'the external put CAS never reached the shared store');
  await within(b.library.translate(alice,'ann-book','p3'),8000,'the translation ACK did not commit its touch');
  release.resolve();
  await assert.rejects(within(pending,8000,'the released put did not settle'),status(422),'a stale anchor after the source ACK must fail with the source status');
  const view=await b.annotations.view(alice,'ann-book');
  assert.deepEqual(view.archive.threads,[],'a fenced external put must persist no words');
});

test('an accepted external write is historical and the revocation ACK waits for the same-key lock',async t=>{
  const {create}=await fixture(t,{});
  const a=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const entered=deferred(),resume=deferred();let auth=0;const events=[];
  const pending=a.annotations.putExternal(alice,'ann-book',putInput(),{authorize:async()=>{const result=await a.library.authorize(grant.token,'ann-book','annotation:write');if(++auth===2){entered.resolve();await resume.promise;}return result;}}).then(result=>{events.push('put-accepted');return result;});
  await within(entered.promise,6000,'the external put never reached its transaction');
  const revoke=a.library.revokeGrant(alice,grant.id).then(result=>{events.push('revoke-acked');return result;});
  const probe=deferred();setImmediate(()=>probe.resolve('probe'));
  assert.equal(await Promise.race([revoke.then(()=>'acked'),probe.promise]),'probe','the revocation ACK must wait for the same-key lock');
  resume.resolve();
  const receipt=await within(pending,8000,'the external put did not settle');
  await within(revoke,8000,'the revocation did not acknowledge');
  assert.deepEqual(events,['put-accepted','revoke-acked']);
  assert.equal(receipt.status,'stored');
  const view=await a.annotations.view(alice,'ann-book');
  assert.equal(view.archive.threads[0].messages[0].body,'外部解释正文','a write accepted before the ACK stays honest history');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({messageId:'ext-2'}),{authorize:()=>a.library.authorize(grant.token,'ann-book','annotation:write')}),status(403),'later writes need the current grant');
});

test('a failed revocation listener fails the ACK honestly and exact retries touch again',{timeout:15000},async t=>{
  const store=fakeSupabase();
  const {create,dataDir}=await fixture(t,{store});
  const a=await create(),b=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const key=stateKeyOf(dataDir),touches=()=>store.docs.get(key)?.version??0;
  const original=b.library.grants.bind(b.library);
  b.library.grants=async()=>{throw Error('simulated grant lookup failure');};
  await assert.rejects(within(b.library.revokeGrant(alice,grant.id),6000,'the failed revoke did not settle'),/simulated grant lookup failure/);
  b.library.grants=original;
  assert.equal(touches(),0,'a failed listener must acknowledge nothing');
  await within(b.library.revokeGrant(alice,grant.id),6000,'the revoke retry did not acknowledge');
  assert.equal(touches(),1,'the exact retry must perform a real touch');
  await within(b.library.revokeGrant(alice,grant.id),6000,'the repeated revoke did not acknowledge');
  assert.equal(touches(),2,'a repeated revoke must touch again, never early-return');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput(),{authorize:()=>a.library.authorize(grant.token,'ann-book','annotation:write')}),status(403));
});

test('external writes refuse wrong owner, book and scope before any history lookup',async t=>{
  const store=fakeSupabase();let modelCalls=0,lookups=0;
  const {create}=await fixture(t,{store,annotationGenerator:async()=>{modelCalls++;return answer();}});
  const a=await create();
  const write=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const read=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotations']});
  const originalGet=a.library.getBook.bind(a.library),originalRecords=a.library.records.bind(a.library);
  a.library.getBook=async(...args)=>{lookups++;return originalGet(...args);};
  a.library.records=async(...args)=>{lookups++;return originalRecords(...args);};
  try{
    await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput(),{authorize:async()=>false}),status(403));
    await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput(),{authorize:async()=>({id:bob.id})}),status(403),'a grant owned by someone else must fail closed');
    await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput(),{authorize:()=>a.library.authorize(read.token,'ann-book','annotation:write')}),status(403),'the read scope never authorizes a write');
    await assert.rejects(a.annotations.putExternal(alice,'other-book',putInput({bookId:'other-book',threadId:'thread-x',messageId:'ext-x',quote:{...originalQuote(),bookId:'other-book'}}),{authorize:()=>a.library.authorize(write.token,'other-book','annotation:write')}),status(403),'a grant for another book must fail before any lookup');
    assert.equal(lookups,0,'strict grant checks precede book and history lookups');
    await assert.rejects(a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book'},{authorize:()=>a.library.authorize(write.token,'ann-book','annotations')}),status(403),'the write scope never authorizes the read');
  }finally{a.library.getBook=originalGet;a.library.records=originalRecords;}
  // A write-only receipt stays narrow and never echoes private user words.
  await a.annotations.explain(alice,'ann-book',siteInput({text:'PRIVATE USER SENTINEL'}));
  assert.equal(modelCalls,1);
  const receipt=await a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-1',messageId:'ext-in-thread'}),{authorize:()=>a.library.authorize(write.token,'ann-book','annotation:write')});
  assert.deepEqual(Object.keys(receipt).sort(),['createdAt','messageId','status','threadId']);
  const serial=JSON.stringify(receipt);
  assert.ok(!serial.includes('PRIVATE USER SENTINEL')&&!serial.includes('外部解释正文')&&!serial.includes('站点解释正文'),'a write receipt must exclude user words and bodies');
  const page=await a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book',limit:20},{authorize:()=>a.library.authorize(read.token,'ann-book','annotations')});
  assert.ok(!JSON.stringify(page).includes('PRIVATE USER SENTINEL'));
  assert.equal(modelCalls,1,'neither read nor receipt re-invokes a model');
});

test('an exact external retry repeats one receipt while changed payloads conflict without a model',async t=>{
  let modelCalls=0;
  const {create}=await fixture(t,{store:fakeSupabase(),annotationGenerator:async()=>{modelCalls++;return answer();}});
  const a=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const authorize=()=>a.library.authorize(grant.token,'ann-book','annotation:write');
  const first=await a.annotations.putExternal(alice,'ann-book',putInput(),{authorize});
  assert.deepEqual(Object.keys(first).sort(),['createdAt','messageId','status','threadId']);
  assert.equal(first.status,'stored');
  assert.deepEqual(await a.annotations.putExternal(alice,'ann-book',putInput(),{authorize}),first,'an exact retry returns the same receipt and timestamp');
  for(const patch of [{body:'不同的解释'},{quote:originalQuote({parts:[{passageId:'p1',layer:'original',start:0,end:5,text:'First'}]})},{highlightId:'highlight-1'}]){
    await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput(patch),{authorize}),status(409),JSON.stringify(patch));
  }
  const archive=await a.annotations.exportArchive(alice,'ann-book');
  assert.equal(archive.threads.length,1);
  assert.equal(archive.threads[0].messages.length,1,'a conflicting retry must never add a second message');
  assert.equal(archive.threads[0].messages[0].body,'外部解释正文','new text is stored exactly, without trimming or rewriting');
  assert.deepEqual(archive.threads[0].messages[0].provenance,{source:'external-agent',label:'External Agent'});
  assert.equal(modelCalls,0);
});

test('an exact external retry survives later source edits while new writes need the current source',async t=>{
  const {create,seed}=await fixture(t,{store:fakeSupabase()});
  const a=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const authorize=()=>a.library.authorize(grant.token,'ann-book','annotation:write');
  const first=await a.annotations.putExternal(alice,'ann-book',putInput(),{authorize});
  const changed=bookFixture();changed.sections[0].paragraphs[0].original='A corrected original with the same stable paragraph ID.';
  await seed(alice,changed);
  assert.deepEqual(await a.annotations.putExternal(alice,'ann-book',putInput(),{authorize}),first,'the exact receipt survives a later source edit as history');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({messageId:'ext-2'}),{authorize}),status(422),'a NEW message still needs the current source');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-new',messageId:'ext-3'}),{authorize}),status(422));
  const archive=await a.annotations.exportArchive(alice,'ann-book');
  assert.equal(archive.threads.length,1);
  assert.equal(archive.threads[0].messages.length,1);
});

test('a deleted thread is never overwritten or resurrected by external writes',async t=>{
  const {create}=await fixture(t,{store:fakeSupabase()});
  const a=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const authorize=()=>a.library.authorize(grant.token,'ann-book','annotation:write');
  const first=await a.annotations.putExternal(alice,'ann-book',putInput(),{authorize});
  await a.annotations.remove(alice,'ann-book','thread-ext');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({messageId:'ext-2'}),{authorize}),status(409),'a new message must never resurrect a tombstone');
  // The exact historical receipt survives without touching the tombstone.
  assert.deepEqual(await a.annotations.putExternal(alice,'ann-book',putInput(),{authorize}),first);
  const archive=await a.annotations.exportArchive(alice,'ann-book');
  assert.ok(archive.threads[0].deletedAt,'the tombstone stays in place');
  assert.equal(archive.threads[0].messages.length,1);
  assert.equal(archive.threads[0].messages[0].body,'外部解释正文');
});

test('a pending site run keeps its output identity against external writes',async t=>{
  const entered=deferred(),finish=deferred();let modelCalls=0;
  const {create}=await fixture(t,{store:fakeSupabase(),annotationGenerator:async()=>{modelCalls++;entered.resolve();await finish.promise;return answer('站点解释正文');}});
  const a=await create();
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const authorize=()=>a.library.authorize(grant.token,'ann-book','annotation:write');
  t.after(()=>finish.resolve());
  const pending=a.annotations.explain(alice,'ann-book',siteInput());
  await within(entered.promise,6000,'the site run never started');
  const aiId='ai-'+hash('request-1').slice(0,32);
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-ext',messageId:aiId}),{authorize}),status(409),'an external write must not occupy a running paid answer id');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-1',messageId:aiId}),{authorize}),status(409));
  finish.resolve();
  const result=await within(pending,8000,'the site run did not settle');
  assert.equal(result.thread.messages[0].id,aiId);
  assert.equal(result.thread.messages[0].body,'站点解释正文');
  assert.equal(result.thread.messages[0].provenance.source,'site-agent');
  assert.equal(modelCalls,1);
});

test('an external write cannot consume a pending answer slot and succeeds once it is released',async t=>{
  const entered=deferred(),finish=deferred();let modelCalls=0;
  const {create,dataDir}=await fixture(t,{store:fakeSupabase(),annotationGenerator:async()=>{modelCalls++;entered.resolve();await finish.promise;return answer('站点解释正文');}});
  const a=await create();
  t.after(()=>finish.resolve());
  let archive=createAnnotationThread(createAnnotationArchive('ann-book'),bookFixture(),{id:'thread-site',quote:originalQuote()},{now:stamp});
  for(let i=0;i<19;i++)archive=appendAnnotationMessage(archive,bookFixture(),'thread-site',{id:'seed-'+i,origin:i%2?'user':'ai',body:'已有内容 '+i,createdAt:stamp,...(i%2?{}:{provenance:{source:'site-agent',label:'Leafhour reading agent'}})});
  await a.dataStore.mutate(stateKeyOf(dataDir),{},data=>Object.assign(data,{archive,runs:[]}));
  const grant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const authorize=()=>a.library.authorize(grant.token,'ann-book','annotation:write');
  const pending=a.annotations.explain(alice,'ann-book',{id:'slot-run',threadId:'thread-site',quote:originalQuote()});
  await within(entered.promise,6000,'the site run never started');
  await assert.rejects(a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-site',messageId:'ext-slot'}),{authorize}),error=>error.status===413,'the pending answer slot is not external capacity');
  assert.equal((await a.annotations.exportArchive(alice,'ann-book')).threads[0].messages.length,19);
  await a.annotations.cancel(alice,'ann-book','slot-run');
  finish.resolve();
  await within(pending,8000,'the cancelled run did not settle');
  const receipt=await a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-site',messageId:'ext-slot'}),{authorize});
  assert.equal(receipt.status,'stored');
  assert.equal((await a.annotations.exportArchive(alice,'ann-book')).threads[0].messages.length,20);
  assert.equal(modelCalls,1);
});

test('the bounded AI-only external read paginates long Unicode bodies completely and hides user words',async t=>{
  const modelCalls={n:0};
  const longBody='开头😀\u0001"\\尾'.repeat(1500);
  const {create}=await fixture(t,{store:fakeSupabase(),annotationGenerator:async()=>{modelCalls.n++;return answer('站点回答');}});
  const a=await create();
  const readGrant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotations']});
  const writeGrant=await a.library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
  const readAuthorize=()=>a.library.authorize(readGrant.token,'ann-book','annotations');
  const writeAuthorize=()=>a.library.authorize(writeGrant.token,'ann-book','annotation:write');
  const receipt=await a.annotations.putExternal(alice,'ann-book',putInput({threadId:'thread-read',messageId:'ext-long',quote:longQuote(),body:longBody}),{authorize:writeAuthorize});
  assert.equal(receipt.status,'stored');
  await a.annotations.explain(alice,'ann-book',{id:'follow-1',threadId:'thread-read',quote:longQuote(),text:'PRIVATE USER SENTINEL'});
  assert.equal(modelCalls.n,1);
  // limit defaults to one; each page is bounded and continuation is exact.
  const first=await a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book'},{authorize:readAuthorize});
  assert.equal(first.items.length,1);
  assert.equal(first.items[0].messageId,'ext-long');
  assert.equal([...first.items[0].anchor.excerpt].length,400,'stored selected context is capped at 400 code points');
  assert.equal(first.items[0].anchor.context,'stored selected-text context, not a source citation');
  assert.equal(first.items[0].attribution.source,'external-agent');
  const collected=new Map();let args={bookId:'ann-book',limit:20},steps=0,prior=null;
  do{
    const page=await a.annotations.readExternal(alice,'ann-book',args,{authorize:readAuthorize});
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=24576,'every page stays inside the hard bound');
    assert.ok(!JSON.stringify(page).includes('PRIVATE USER SENTINEL'),'user words are structurally absent');
    for(const item of page.items){if(!collected.has(item.messageId))collected.set(item.messageId,'');collected.set(item.messageId,collected.get(item.messageId)+item.body);}
    args=page.nextCursor?{bookId:'ann-book',...page.nextCursor}:null;
    assert.notEqual(JSON.stringify(args),prior,'continuation must advance');prior=JSON.stringify(args);
    assert.ok(++steps<200);
  }while(args);
  assert.equal(collected.get('ext-long'),longBody,'the complete body and tail reconstruct exactly');
  assert.equal(collected.get('ext-long').length,longBody.length);
  // Stable pagination: the same cursor repeats the same page.
  const again=await a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book'},{authorize:readAuthorize});
  assert.deepEqual(again,first);
  const middle=longBody.indexOf('😀')+1;
  await assert.rejects(a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book',threadId:'thread-read',messageId:'ext-long',charOffset:middle,snapshot:first.snapshot},{authorize:readAuthorize}),status(400),'a surrogate-splitting offset is rejected, never repaired');
  await assert.rejects(a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book',snapshot:'f'.repeat(64)},{authorize:readAuthorize}),status(409));
  await assert.rejects(a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book',limit:21},{authorize:readAuthorize}),status(400));
  await assert.rejects(a.annotations.readExternal(alice,'ann-book',{bookId:'ann-book',junk:'1'},{authorize:readAuthorize}),status(400));
  assert.equal(collected.size,2,'only the AI messages are projected');
  assert.ok([...collected.values()].includes('站点回答'),'the site answer stays readable alongside the external one');
});
