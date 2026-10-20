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
function fakeSupabase({reorderKeys=false}={}){
  const docs=new Map();
  let intercept=null;
  const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value;
  const respond=value=>new Response(JSON.stringify(reorderKeys?reorder(value):value),{status:200});
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


const externalInput=(patch={})=>({bookId:'ann-book',threadId:'external-thread',messageId:'external-message',quote:originalQuote(),body:'  Exact external AI words  ',...patch});
for(const kind of ['revoke','source'])test('independent actual HostedStore empty-wrapper '+kind+' ACK defeats held external put CAS',{timeout:10000},async t=>{
 const store=fakeSupabase(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic'},fetcher:store.fetcher});
 const {annotations,library,create}=await fixture(t,{dataStore});await create();
 const grant=await library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
 const authorize=()=>library.authorize(grant.token,'ann-book','annotation:write');
 if(kind==='source')await library.addHighlight(alice,'ann-book',highlightInput());
 const entered=deferred(),release=deferred();let armed=true,pending;
 store.arm(async({key})=>{if(armed&&key.endsWith('/annotations/'+hash('ann-book')+'.json')){armed=false;entered.resolve();await release.promise;}});
 try{
  pending=annotations.putExternal(alice,'ann-book',externalInput(kind==='source'?{highlightId:'highlight-1'}:{}),{authorize});pending.catch(()=>{});
  await within(entered.promise,2000,'external put never reached CAS');
  if(kind==='revoke')await library.revokeGrant(alice,grant.id);else await library.removeHighlight(alice,'ann-book','highlight-1');
  release.resolve();await assert.rejects(pending,error=>kind==='revoke'?error.status===403:[404,422].includes(error.status));
  assert.deepEqual((await annotations.exportArchive(alice,'ann-book')).threads,[]);
 }finally{release.resolve();await pending?.catch(()=>{});}
});
test('independent narrow external receipt and AI-only read omit private follow-up',async t=>{
 const {annotations,library}=await fixture(t);
 const grant=await library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write','annotations']});
 const authorize=()=>library.authorize(grant.token,'ann-book','annotation:write');
 let archive=createAnnotationThread(createAnnotationArchive('ann-book'),bookFixture(),{id:'external-thread',quote:originalQuote()});
 archive=appendAnnotationMessage(archive,bookFixture(),'external-thread',{id:'private-user',origin:'user',body:'PRIVATE_FOLLOWUP_SENTINEL',createdAt:'2026-10-20T00:00:00.000Z'});
 await annotations.restoreArchive(alice,bookFixture(),archive);
 const receipt=await annotations.putExternal(alice,'ann-book',externalInput(),{authorize});
 assert.deepEqual(Object.keys(receipt).sort(),['createdAt','messageId','status','threadId']);
 assert.deepEqual(await annotations.putExternal(alice,'ann-book',externalInput(),{authorize}),receipt);
 await assert.rejects(annotations.putExternal(alice,'ann-book',externalInput({body:'different'}),{authorize}),status(409));
 const page=await annotations.readExternal(alice,'ann-book',{bookId:'ann-book'},{authorize:()=>library.authorize(grant.token,'ann-book','annotations')});
 assert.equal(page.items.length,1);assert.equal(page.items[0].body,'  Exact external AI words  ');assert.ok(!JSON.stringify(page).includes('PRIVATE_FOLLOWUP_SENTINEL'));
 await library.revokeGrant(alice,grant.id);
 await assert.rejects(annotations.putExternal(alice,'ann-book',externalInput(),{authorize}),status(403));
});

test('independent exact retry with an accepted highlight alias remains idempotent',async t=>{
 const {annotations,library}=await fixture(t);
 await library.addHighlight(alice,'ann-book',highlightInput('canonical'));
 const alias=await library.addHighlight(alice,'ann-book',highlightInput('alias'));assert.equal(alias.id,'canonical');
 const grant=await library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
 const authorize=()=>library.authorize(grant.token,'ann-book','annotation:write');
 const payload=externalInput({highlightId:'alias'});
 const first=await annotations.putExternal(alice,'ann-book',payload,{authorize});
 assert.deepEqual(await annotations.putExternal(alice,'ann-book',payload,{authorize}),first);
 const second=await annotations.putExternal(alice,'ann-book',{...payload,messageId:'alias-followup'},{authorize});assert.equal(second.status,'stored');
 await library.removeHighlight(alice,'ann-book','canonical');
 assert.deepEqual(await annotations.putExternal(alice,'ann-book',payload,{authorize}),first);
 await assert.rejects(annotations.putExternal(alice,'ann-book',{...payload,messageId:'after-highlight-removal'},{authorize}),status(404));
});

test('independent historical exact receipt survives source edits while a new message remains strict',async t=>{
 const {annotations,library,seed}=await fixture(t);
 const grant=await library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});
 const authorize=()=>library.authorize(grant.token,'ann-book','annotation:write');
 const payload=externalInput({quote:literalQuote()});const first=await annotations.putExternal(alice,'ann-book',payload,{authorize});
 const changed=bookFixture();changed.sections[0].paragraphs[0].translations.literal=translation('Different current text.','draft');await seed(alice,changed);
 assert.deepEqual(await annotations.putExternal(alice,'ann-book',payload,{authorize}),first);
 await assert.rejects(annotations.putExternal(alice,'ann-book',{...payload,messageId:'new-message'},{authorize}),status(422));
});

test('hosted JSONB key reordering preserves external exact receipts without weakening conflicts',async t=>{
 const store=fakeSupabase({reorderKeys:true}),dataStore=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic'},fetcher:store.fetcher});const {annotations,library}=await fixture(t,{dataStore});
 const grant=await library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']});const authorize=()=>library.authorize(grant.token,'ann-book','annotation:write'),payload=externalInput();const first=await annotations.putExternal(alice,'ann-book',payload,{authorize});assert.deepEqual(await annotations.putExternal(alice,'ann-book',payload,{authorize}),first);await assert.rejects(annotations.putExternal(alice,'ann-book',{...payload,body:'Actually changed words'},{authorize}),status(409));assert.equal((await annotations.exportArchive(alice,'ann-book')).threads[0].messages.length,1);
});
test('hosted JSONB key reordering preserves site request retries and subsequent real follow-ups',async t=>{
 const store=fakeSupabase({reorderKeys:true}),dataStore=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic'},fetcher:store.fetcher});let calls=0;const {annotations}=await fixture(t,{dataStore,annotationGenerator:async()=>{calls++;return answer();}}),payload=input();const first=await annotations.explain(alice,'ann-book',payload);assert.equal(first.request.status,'completed');assert.deepEqual(await annotations.explain(alice,'ann-book',payload),first);assert.equal(calls,1);await assert.rejects(annotations.explain(alice,'ann-book',{...payload,text:'Changed same request'}),status(409));const follow=await annotations.explain(alice,'ann-book',{...payload,id:'site-followup',text:'  Actual synthetic question  '});assert.equal(follow.request.status,'completed');assert.equal(follow.thread.messages[1].body,'  Actual synthetic question  ');assert.equal(calls,2);
});

for(const kind of ['site','external'])test('hosted signed-zero quote offsets preserve '+kind+' exact retry',async t=>{
 const store=fakeSupabase({reorderKeys:true}),dataStore=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic'},fetcher:store.fetcher});let calls=0;const {annotations,library}=await fixture(t,{dataStore,annotationGenerator:async()=>{calls++;return answer();}});
 const quote=originalQuote();quote.parts[0].start=-0;
 if(kind==='site'){const payload=input({quote}),first=await annotations.explain(alice,'ann-book',payload);assert.deepEqual(await annotations.explain(alice,'ann-book',payload),first);assert.equal(calls,1);await assert.rejects(annotations.explain(alice,'ann-book',{...payload,text:'Changed request'}),status(409));}
 else{const grant=await library.createGrant(alice,{bookId:'ann-book',scopes:['annotation:write']}),authorize=()=>library.authorize(grant.token,'ann-book','annotation:write'),payload=externalInput({quote}),first=await annotations.putExternal(alice,'ann-book',payload,{authorize});assert.deepEqual(await annotations.putExternal(alice,'ann-book',payload,{authorize}),first);await assert.rejects(annotations.putExternal(alice,'ann-book',{...payload,body:'Changed request'},{authorize}),status(409));}
});
