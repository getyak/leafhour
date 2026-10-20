// GET-198 first bounded batch: the account UI-language preference backend.
// Synthetic accounts, temporary directories and one loopback server only: no
// browser, real runtime, credentials or product API. The record is an owned
// `ui-preferences.json` beside (never inside) reading preferences, the profile
// or any book, and it must never touch reading language or mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {digest} from '../server/document-import.mjs';
import {globalPreferencesDefaults,validateGlobalPreferences} from '../app/reading-preferences.mjs';

const serviceModule=await import('../server/account-ui-preferences.mjs').catch(()=>({}));
const make=options=>{assert.equal(typeof serviceModule.createAccountUiPreferences,'function','account UI preferences must have an owned persistence service');return serviceModule.createAccountUiPreferences(options);};
const empty={revision:0,updatedAt:null,uiLocale:null};
const alice={id:'ui-alice',email:'alice@example.com'},bob={id:'ui-bob',email:'bob@example.com'};
const exists=async file=>{try{await readFile(file);return true;}catch{return false;}};
const recordFile=(dataDir,user)=>path.join(dataDir,'users',digest(user.id),'ui-preferences.json');
const memoryStore=()=>{const rows=new Map(),queues=new Map();return {rows,async read(key,fallback){return structuredClone(rows.has(key)?rows.get(key):fallback);},async mutate(key,fallback,operation){const prior=queues.get(key)||Promise.resolve(),work=prior.catch(()=>{}).then(async()=>{const row=structuredClone(rows.has(key)?rows.get(key):fallback);const result=await operation(row);rows.set(key,JSON.parse(JSON.stringify(row)));return structuredClone(result);});queues.set(key,work);try{return await work;}finally{if(queues.get(key)===work)queues.delete(key);}}};};
// Real createHostedStore against a synthetic JSONB CAS backend: the fallback
// parameter, document keys and compare-and-swap semantics of the production
// reader_documents store, with synthetic values only and no credentials.
const syntheticCas=()=>{const rows=new Map();let writes=0;return {rows,get writes(){return writes;},fetcher:async(url,options={})=>{const u=new URL(url);if(u.pathname==='/rest/v1/reader_documents'){const row=rows.get(u.searchParams.get('key').slice(3));return Response.json(row?[structuredClone(row)]:[]);}if(u.pathname==='/rest/v1/rpc/reader_document_cas'){const body=JSON.parse(options.body),row=rows.get(body.document_key);if((row?.version||0)!==body.expected_version)return Response.json(false);rows.set(body.document_key,{value:structuredClone(body.document_value),version:body.expected_version+1});writes++;return Response.json(true);}throw Error('Unexpected synthetic route '+u.pathname);}};};
const hostedBackend=seed=>{const fake=syntheticCas(),dataStore=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic-no-secret'},fetcher:fake.fetcher});return {fake,dataStore};};
const local=async(t,name)=>{await mkdir(tmpdir(),{recursive:true});const dataDir=await mkdtemp(path.join(tmpdir(),name));t.after(()=>rm(dataDir,{recursive:true,force:true}));return dataDir;};

test('a UI language read is read-only and a missing record is an explicit empty view',async t=>{
  const dataDir=await local(t,'account-ui-prefs-read-'),prefs=make({dataDir});
  assert.deepEqual(await prefs.get(alice),empty,'a read must not invent state');
  assert.deepEqual(await prefs.get(alice),empty,'repeated reads stay empty');
  assert.equal(await exists(recordFile(dataDir,alice)),false,'reads create no ui-preferences record');
  assert.equal(await exists(path.join(dataDir,'users')),false,'reads create no account directory at all');
  for(const user of [null,{},'x',{id:''},{id:'bad\u0000id'}])await assert.rejects(prefs.get(user),e=>e.status===401);
  for(const input of [null,{baseRevision:0,uiLocale:'en'},'x',[]])await assert.rejects(prefs.save(null,input),e=>e.status===401);
  assert.equal(await exists(path.join(dataDir,'users')),false,'rejected identities never write');
});

test('saves persist one strict v1 record per account and survive rebuilt services',async t=>{
  const dataDir=await local(t,'account-ui-prefs-save-'),first=make({dataDir});
  const saved=await first.save(alice,{baseRevision:0,uiLocale:'zh-Hans'});
  assert.equal(saved.revision,1);assert.equal(saved.uiLocale,'zh-Hans');
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)),'every save carries a timestamp');
  assert.deepEqual(Object.keys(saved).sort(),['revision','uiLocale','updatedAt']);
  assert.deepEqual(await first.get(alice),saved);
  const rebuilt=make({dataDir});
  assert.deepEqual(await rebuilt.get(alice),saved,'a rebuilt service reads the same durable record');
  assert.deepEqual(await rebuilt.get(bob),empty,'another account stays untouched');
  const doc=JSON.parse(await readFile(recordFile(dataDir,alice),'utf8'));
  assert.deepEqual(doc,{kind:'marginalia-ui-preferences',schemaVersion:1,revision:1,updatedAt:saved.updatedAt,uiLocale:'zh-Hans'});
  assert.equal(doc.owner,undefined);assert.equal(doc.email,undefined);assert.equal(doc.user,undefined);assert.equal(doc.preferences,undefined);
  assert.deepEqual(await readdir(path.join(dataDir,'users',digest(alice.id))),['ui-preferences.json'],'the record stays independent of reading preferences and the profile');
  assert.equal(await exists(path.join(dataDir,'users',digest(bob.id))),false);
  const theirs=await rebuilt.save(bob,{baseRevision:0,uiLocale:'ja'});
  assert.equal(theirs.revision,1,'each account keeps its own revision line');
  assert.deepEqual(await rebuilt.get(alice),saved,'accounts never share a language or revision');
});

test('owner payloads, unknown or missing keys, wrong types, foreign languages and unsafe revisions never save',async t=>{
  const dataDir=await local(t,'account-ui-prefs-strict-'),prefs=make({dataDir});
  const saved=await prefs.save(alice,{baseRevision:0,uiLocale:'en'});
  const invalid=[
    {baseRevision:0,uiLocale:'en',owner:bob.id},{baseRevision:0,uiLocale:'en',ownerId:bob.id},{baseRevision:0,uiLocale:'en',id:'chosen-by-payload'},{baseRevision:0,uiLocale:'en',extra:1},
    {baseRevision:0},{uiLocale:'en'},{},
    {baseRevision:0,uiLocale:'fr'},{baseRevision:0,uiLocale:'zh'},{baseRevision:0,uiLocale:'EN'},{baseRevision:0,uiLocale:'zh-cn'},{baseRevision:0,uiLocale:'ja-JP'},{baseRevision:0,uiLocale:''},{baseRevision:0,uiLocale:'zh Hans'},
    {baseRevision:0,uiLocale:0},{baseRevision:0,uiLocale:{}},{baseRevision:0,uiLocale:['en']},{baseRevision:0,uiLocale:undefined},{baseRevision:0,uiLocale:true},
    {baseRevision:-1,uiLocale:'en'},{baseRevision:1.5,uiLocale:'en'},{baseRevision:'1',uiLocale:'en'},{baseRevision:null,uiLocale:'en'},{baseRevision:NaN,uiLocale:'en'},{baseRevision:Number.MAX_SAFE_INTEGER+1,uiLocale:'en'},
    null,42,'x',[],true,
  ];
  for(const input of invalid)await assert.rejects(prefs.save(alice,input),e=>e.status===400,JSON.stringify(input));
  assert.deepEqual(await prefs.get(alice),saved,'a rejected request never alters the saved record');
});

test('clearing the language is an explicit choice that still advances the revision',async t=>{
  const dataDir=await local(t,'account-ui-prefs-clear-'),prefs=make({dataDir});
  await prefs.save(alice,{baseRevision:0,uiLocale:'ja'});
  const cleared=await prefs.save(alice,{baseRevision:1,uiLocale:null});
  assert.equal(cleared.uiLocale,null);assert.equal(cleared.revision,2,'clearing an explicit choice still advances the revision');
  assert.ok(Number.isFinite(Date.parse(cleared.updatedAt)));
  assert.deepEqual(await prefs.get(alice),cleared);
  const doc=JSON.parse(await readFile(recordFile(dataDir,alice),'utf8'));
  assert.equal(doc.uiLocale,null);assert.equal(doc.revision,2);
  assert.deepEqual(await make({dataDir}).get(alice),cleared,'a cleared choice stays explicit instead of reverting to the empty view');
});

test('revision compare-and-swap rejects stale writers and keeps exactly one winner',async t=>{
  const dataDir=await local(t,'account-ui-prefs-cas-'),prefs=make({dataDir}),other=make({dataDir});
  const first=await prefs.save(alice,{baseRevision:0,uiLocale:'en'});
  assert.equal(first.revision,1);
  await assert.rejects(prefs.save(alice,{baseRevision:0,uiLocale:'ja'}),e=>e.status===409,'a stale writer is refused');
  assert.deepEqual(await prefs.get(alice),first,'the refused write changes nothing');
  const results=await Promise.allSettled([prefs.save(alice,{baseRevision:1,uiLocale:'zh-Hans'}),other.save(alice,{baseRevision:1,uiLocale:'zh-Hant'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'exactly one concurrent writer may advance the revision');
  for(const rejected of results.filter(r=>r.status==='rejected'))assert.equal(rejected.reason.status,409);
  const after=await prefs.get(alice);
  assert.equal(after.revision,2);
  assert.equal(after.uiLocale,results.find(r=>r.status==='fulfilled').value.uiLocale,'the durable record keeps the winner');
});

test('an exhausted revision range is refused instead of wrapping open a new CAS window',async t=>{
  const dataDir=await local(t,'account-ui-prefs-overflow-'),prefs=make({dataDir});
  await prefs.save(alice,{baseRevision:0,uiLocale:'en'});
  const file=recordFile(dataDir,alice),doc=JSON.parse(await readFile(file,'utf8'));doc.revision=Number.MAX_SAFE_INTEGER;await writeFile(file,JSON.stringify(doc));
  assert.equal((await prefs.get(alice)).revision,Number.MAX_SAFE_INTEGER);
  await assert.rejects(prefs.save(alice,{baseRevision:Number.MAX_SAFE_INTEGER,uiLocale:'ja'}),e=>e.status===409,'overflow is refused');
  await assert.rejects(prefs.save(alice,{baseRevision:Number.MAX_SAFE_INTEGER-1,uiLocale:'ja'}),e=>e.status===409);
  const after=await prefs.get(alice);
  assert.equal(after.revision,Number.MAX_SAFE_INTEGER);assert.equal(after.uiLocale,'en');
});

test('local saves leave a private 0600 record and no pending residue',async t=>{
  const dataDir=await local(t,'account-ui-prefs-fs-'),prefs=make({dataDir});
  for(const [baseRevision,uiLocale]of [[0,'en'],[1,'zh-Hant'],[2,null]])await prefs.save(alice,{baseRevision,uiLocale});
  const dir=path.join(dataDir,'users',digest(alice.id)),entries=await readdir(dir);
  assert.deepEqual(entries,['ui-preferences.json'],'no pending or temporary files may remain');
  assert.equal(entries.some(name=>name.includes('pending')),false);
  const info=await stat(recordFile(dataDir,alice));
  assert.equal(info.mode&0o777,0o600,'the account record is written as a private file');
});

test('the UI language never rewrites reading defaults and reading saves never rewrite it',async t=>{
  const dataDir=await local(t,'account-ui-prefs-coexist-');
  const library=await createLibraryService({dataDir,catalogDir:null,translator:null}),prefs=make({dataDir});
  const snapshot=validateGlobalPreferences({...globalPreferencesDefaults,mode:'parallel',variant:'literal',font:22});
  const reading=await library.saveReadingPreferences(alice,{baseRevision:0,preferences:snapshot});
  const readingFile=path.join(dataDir,'users',digest(alice.id),'reading-preferences.json');
  const before=await readFile(readingFile,'utf8');
  const ui=await prefs.save(alice,{baseRevision:0,uiLocale:'zh-Hans'});
  assert.equal(await readFile(readingFile,'utf8'),before,'the UI language never rewrites reading defaults');
  assert.deepEqual(await library.getReadingPreferences(alice),reading);
  const uiDoc=JSON.parse(await readFile(recordFile(dataDir,alice),'utf8'));
  assert.equal(uiDoc.preferences,undefined);assert.equal(uiDoc.mode,undefined);assert.equal(uiDoc.uiLocale,'zh-Hans');
  assert.equal(JSON.parse(before).uiLocale,undefined,'reading defaults carry no UI language field');
  await library.saveReadingPreferences(alice,{baseRevision:1,preferences:{...snapshot,font:23}});
  assert.deepEqual(await prefs.get(alice),ui,'reading saves never rewrite the UI language');
  assert.deepEqual((await readdir(path.join(dataDir,'users',digest(alice.id)))).sort(),['reading-preferences.json','ui-preferences.json'],'no profile or book record is mixed into this account directory');
});

test('hosted instances share one durable record and one CAS winner through the supplied data store',async()=>{
  const store=memoryStore(),key=path.join('ui-preferences-fixture','users',digest(alice.id),'ui-preferences.json');
  const a=make({dataDir:'ui-preferences-fixture',dataStore:store}),b=make({dataDir:'ui-preferences-fixture',dataStore:store});
  assert.deepEqual(await a.get(alice),empty,'a hosted read must not invent state');
  const saved=await a.save(alice,{baseRevision:0,uiLocale:'zh-Hant'});
  assert.deepEqual(await b.get(alice),saved,'separate hosted instances share the same durable record');
  assert.deepEqual(await make({dataDir:'ui-preferences-fixture',dataStore:store}).get(alice),saved,'a rebuilt hosted service persists identically');
  assert.deepEqual([...store.rows.keys()],[key],'only the owned ui-preferences key is written');
  assert.deepEqual(JSON.parse(JSON.stringify(store.rows.get(key))),{kind:'marginalia-ui-preferences',schemaVersion:1,revision:1,updatedAt:saved.updatedAt,uiLocale:'zh-Hant'});
  assert.doesNotMatch(JSON.stringify([...store.rows]),/alice@example|ui-alice/,'the stored record carries no account identity');
  await assert.rejects(a.save(alice,{baseRevision:0,uiLocale:'en'}),e=>e.status===409,'a stale hosted write is refused');
  const results=await Promise.allSettled([a.save(alice,{baseRevision:1,uiLocale:'en'}),b.save(alice,{baseRevision:1,uiLocale:null})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'the data store keeps exactly one CAS winner');
  const after=await a.get(alice);
  assert.equal(after.revision,2);assert.equal(after.uiLocale,results.find(r=>r.status==='fulfilled').value.uiLocale);
  assert.deepEqual(await b.get(bob),empty,'another hosted account stays untouched');
  await assert.rejects(a.save(null,{baseRevision:0,uiLocale:'en'}),e=>e.status===401);
  // A real invalid stored value is data, never the missing-record fallback.
  const corrupt=path.join('ui-preferences-fixture','users',digest(bob.id),'ui-preferences.json');
  store.rows.set(corrupt,[]);
  await assert.rejects(b.get(bob),e=>e.status===409);
  await assert.rejects(b.save(bob,{baseRevision:0,uiLocale:'en'}),e=>e.status===409);
  assert.deepEqual(store.rows.get(corrupt),[],'an invalid stored value is neither masked by the fallback nor rewritten');
  store.rows.set(corrupt,null);
  await assert.rejects(b.get(bob),e=>e.status===409,'a stored null is real invalid data, not a missing record');
  await assert.rejects(b.save(bob,{baseRevision:0,uiLocale:'en'}),e=>e.status===409);
  assert.equal(store.rows.get(corrupt),null);
});

// P1: an existing unsupported or corrupt record must refuse reads and writes
// with 409 and stay byte-identical. Only a missing record may be initialized
// and only the explicit complete v1 shape is supported; an empty view must
// never open a baseRevision-0 CAS window over existing data.
const seedRecord={kind:'marginalia-ui-preferences',schemaVersion:1,revision:7,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'};
const corruptCases=[
  ['foreign-kind',{...seedRecord,kind:'other-document',futureData:'must-survive'},0],
  ['future-schema',{...seedRecord,schemaVersion:2,futureData:'must-survive'},7],
  ['unknown-field',{...seedRecord,futureData:'must-survive'},7],
  ['missing-field',{schemaVersion:1,revision:7,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'},7],
  ['unsafe-revision',{...seedRecord,revision:Number.MAX_SAFE_INTEGER+1},0],
  ['negative-revision',{...seedRecord,revision:-1},7],
  ['fractional-revision',{...seedRecord,revision:1.5},7],
  ['string-revision',{...seedRecord,revision:'7'},7],
  ['empty-object',{},0],
  ['array',[],0],
  ['null',null,0],
  ['number-scalar',42,0],
  ['string-scalar','x',0],
  ['initial-with-choice',{kind:'marginalia-ui-preferences',schemaVersion:1,revision:0,updatedAt:null,uiLocale:'en'},0],
  ['choice-without-updatedAt',{...seedRecord,updatedAt:null},7],
  ['bad-updatedAt',{...seedRecord,updatedAt:'not-a-date'},7],
  ['bad-language',{...seedRecord,uiLocale:'fr'},7],
];
const fsCorruptFixture=async(t,seed)=>{
  const dataDir=await local(t,'account-ui-prefs-corrupt-fs-'),file=recordFile(dataDir,alice);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(seed));
  return {prefs:make({dataDir}),file,raw:async()=>readFile(file,'utf8')};
};
const hostedCorruptFixture=(seed,dataDir)=>{
  const {fake,dataStore}=hostedBackend(),key=String(recordFile(dataDir,alice)).replaceAll('\\','/');
  fake.rows.set(key,{value:structuredClone(seed),version:1});
  return {prefs:make({dataDir,dataStore}),dataStore,fake,after:async()=>fake.rows.get(key)?.value};
};
for(const [name,seed,baseRevision]of corruptCases){
  test(`an existing corrupt record (${name}) refuses reads and writes and stays untouched on fs`,async t=>{
    const f=await fsCorruptFixture(t,seed);
    await assert.rejects(f.prefs.get(alice),e=>e.status===409,`${name}: get must refuse`);
    await assert.rejects(f.prefs.save(alice,{baseRevision,uiLocale:'en'}),e=>e.status===409,`${name}: save must refuse`);
    await assert.rejects(f.prefs.get(alice),e=>e.status===409,`${name}: repeated reads stay refused`);
    assert.equal(await f.raw(),JSON.stringify(seed),`${name}: the stored document must stay byte-identical`);
  });
  test(`an existing corrupt record (${name}) refuses reads and writes and stays untouched on the hosted CAS store`,async t=>{
    const f=hostedCorruptFixture(seed,await local(t,'account-ui-prefs-corrupt-hosted-'));
    await assert.rejects(f.prefs.get(alice),e=>e.status===409,`${name}: get must refuse`);
    await assert.rejects(f.prefs.save(alice,{baseRevision,uiLocale:'en'}),e=>e.status===409,`${name}: save must refuse`);
    assert.deepEqual(await f.after(),seed,`${name}: the stored document must stay untouched`);
    assert.equal(f.fake.writes,0,`${name}: no CAS write may be issued`);
  });
}

test('unparseable stored JSON is corrupt data and stays byte-identical on fs',async t=>{
  const dataDir=await local(t,'account-ui-prefs-corrupt-json-'),file=recordFile(dataDir,alice),raw='{not-json{{{';
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,raw);
  const prefs=make({dataDir});
  await assert.rejects(prefs.get(alice),e=>e.status===409);
  await assert.rejects(prefs.save(alice,{baseRevision:0,uiLocale:'en'}),e=>e.status===409);
  assert.equal(await readFile(file,'utf8'),raw);
});

test('only the explicit complete v1 shape is read and CAS-advanced on both backends',async t=>{
  const fsDataDir=await local(t,'account-ui-prefs-v1-fs-'),fsFile=recordFile(fsDataDir,alice);
  await mkdir(path.dirname(fsFile),{recursive:true});await writeFile(fsFile,JSON.stringify(seedRecord));
  const hostedDir=await local(t,'account-ui-prefs-v1-hosted-'),hosted=hostedCorruptFixture(seedRecord,hostedDir);
  for(const [name,prefs,raw,rebuild]of [
    ['fs',make({dataDir:fsDataDir}),async()=>JSON.parse(await readFile(fsFile,'utf8')),()=>make({dataDir:fsDataDir})],
    ['hosted',hosted.prefs,hosted.after,()=>make({dataDir:hostedDir,dataStore:hosted.dataStore})],
  ]){
    assert.deepEqual(await prefs.get(alice),{revision:7,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'},name);
    await assert.rejects(prefs.save(alice,{baseRevision:6,uiLocale:'en'}),e=>e.status===409,name+' stale');
    assert.deepEqual(await raw(),seedRecord,name+' stale writes change nothing');
    const saved=await prefs.save(alice,{baseRevision:7,uiLocale:'en'});
    assert.equal(saved.revision,8,name);assert.equal(saved.uiLocale,'en');
    const doc=await raw();
    assert.deepEqual(Object.keys(doc).sort(),['kind','revision','schemaVersion','uiLocale','updatedAt'],name);
    assert.equal(doc.kind,'marginalia-ui-preferences');assert.equal(doc.schemaVersion,1,name+' the version is never downgraded');
    assert.deepEqual(await rebuild().get(alice),saved,name+' a rebuilt service agrees');
  }
});

const serve=async t=>{
  await mkdir(tmpdir(),{recursive:true});
  const dir=await mkdtemp(path.join(tmpdir(),'account-ui-prefs-http-')),codes=new Map();
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:async(email,code)=>codes.set(email,code),translator:null});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(url,{method='GET',cookie,ownerHeader,body,origin=base}={})=>{
    const response=await fetch(base+url,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(ownerHeader?{'X-Reader-Owner':ownerHeader}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,headers:response.headers,data:await response.json().catch(()=>null)};
  };
  const login=async email=>{await call('/api/auth/code',{method:'POST',body:{email,purpose:'login'}});const verify=await call('/api/auth/verify',{method:'POST',body:{email,code:codes.get(email),purpose:'login'}});assert.equal(verify.status,200);return {cookie:verify.headers.get('set-cookie').split(';')[0],user:verify.data.user};};
  return {dir,base,call,login};
};
const route='/api/account/ui-preferences';

test('the account UI preference API requires authentication and its GET never writes',async t=>{
  const {dir,call,login}=await serve(t);
  assert.equal((await call(route)).status,401,'anonymous reads are refused');
  assert.equal((await call(route,{method:'POST',body:{baseRevision:0,uiLocale:'en'}})).status,401,'anonymous writes are refused');
  assert.equal(await exists(path.join(dir,'portal','library','users')),false,'anonymous requests create no account state');
  const me=await login('reader@example.com');
  const first=await call(route,{cookie:me.cookie});
  assert.deepEqual(first.data,empty);
  assert.equal(first.headers.get('cache-control'),'private, no-store');
  assert.deepEqual((await call(route,{cookie:me.cookie})).data,empty,'an authenticated GET stays read-only');
  assert.equal(await exists(path.join(dir,'portal','library','users',digest(me.user.id),'ui-preferences.json')),false,'GET creates no state');
  assert.equal((await call('/api/auth/session',{cookie:me.cookie})).data.uiPreferences,undefined,'the session keeps its existing shape');
});

test('writes require the exact current owner header and the shared origin boundary',async t=>{
  const {call,login}=await serve(t);
  const mine=await login('writer@example.com'),theirs=await login('other@example.com');
  assert.equal((await call(route,{method:'POST',cookie:mine.cookie,body:{baseRevision:0,uiLocale:'en'}})).status,409,'POST without the owner header is refused');
  const mismatch=await call(route,{method:'POST',cookie:mine.cookie,ownerHeader:theirs.user.id,body:{baseRevision:0,uiLocale:'en'}});
  assert.equal(mismatch.status,409);assert.equal(mismatch.headers.get('x-reader-session-changed'),'1');
  assert.equal((await call(route,{cookie:mine.cookie,ownerHeader:theirs.user.id})).status,409,'a present GET owner header must match the session too');
  assert.equal((await call(route,{method:'POST',cookie:mine.cookie,ownerHeader:'not-the-owner',body:{baseRevision:0,uiLocale:'en'}})).status,409);
  assert.equal((await call(route,{method:'POST',cookie:mine.cookie,ownerHeader:mine.user.id,origin:'https://evil.example',body:{baseRevision:0,uiLocale:'en'}})).status,403,'cross-origin writes are refused');
  assert.equal((await call(route,{cookie:mine.cookie,origin:'https://evil.example'})).status,403,'cross-origin reads are refused');
  assert.deepEqual((await call(route,{cookie:mine.cookie,ownerHeader:mine.user.id})).data,empty,'every rejected request leaves the record untouched');
  const accepted=await call(route,{method:'POST',cookie:mine.cookie,ownerHeader:mine.user.id,body:{baseRevision:0,uiLocale:'zh-Hans'}});
  assert.equal(accepted.status,200);assert.deepEqual(accepted.data,{revision:1,updatedAt:accepted.data.updatedAt,uiLocale:'zh-Hans'});
  assert.equal(accepted.headers.get('cache-control'),'private, no-store');
  assert.deepEqual((await call(route,{cookie:mine.cookie,ownerHeader:mine.user.id})).data,accepted.data);
  assert.deepEqual((await call(route,{cookie:theirs.cookie})).data,empty,'another account reads only its own default');
});

test('strict request shapes, unknown keys, foreign languages and other methods never save',async t=>{
  const {call,login}=await serve(t);
  const me=await login('strict@example.com');
  const saved=await call(route,{method:'POST',cookie:me.cookie,ownerHeader:me.user.id,body:{baseRevision:0,uiLocale:'ja'}});
  assert.equal(saved.status,200);
  for(const body of [{baseRevision:0,uiLocale:'en',owner:me.user.id},{baseRevision:0,uiLocale:'en',extra:1},{baseRevision:0},{uiLocale:'en'},{},{baseRevision:0,uiLocale:'fr'},{baseRevision:0,uiLocale:'zh'},{baseRevision:'0',uiLocale:'en'},{baseRevision:-1,uiLocale:'en'},{baseRevision:1.5,uiLocale:'en'},{baseRevision:1,uiLocale:null,note:'x'}]){
    const bad=await call(route,{method:'POST',cookie:me.cookie,ownerHeader:me.user.id,body});
    assert.equal(bad.status,400,JSON.stringify(body));
  }
  const oversize=await call(route,{method:'POST',cookie:me.cookie,ownerHeader:me.user.id,body:{baseRevision:0,uiLocale:'en',padding:'x'.repeat(5000)}});
  assert.equal(oversize.status,413,'requests stay inside the 4 KiB body budget');
  for(const method of ['PUT','DELETE','PATCH'])assert.equal((await call(route,{method,cookie:me.cookie,ownerHeader:me.user.id,body:{baseRevision:0,uiLocale:'en'}})).status,405,method);
  assert.deepEqual((await call(route,{cookie:me.cookie})).data,saved.data,'no rejected shape or method may write');
});

test('accounts stay isolated over the API and errors never carry the other account choice',async t=>{
  const {call,login}=await serve(t);
  const mine=await login('first@example.com'),theirs=await login('second@example.com');
  const mineSaved=await call(route,{method:'POST',cookie:mine.cookie,ownerHeader:mine.user.id,body:{baseRevision:0,uiLocale:'zh-Hans'}});
  assert.equal(mineSaved.status,200);
  const theirsSaved=await call(route,{method:'POST',cookie:theirs.cookie,ownerHeader:theirs.user.id,body:{baseRevision:0,uiLocale:'ja'}});
  assert.equal(theirsSaved.status,200);
  assert.deepEqual((await call(route,{cookie:mine.cookie})).data,mineSaved.data,'each account keeps its own record');
  assert.deepEqual((await call(route,{cookie:theirs.cookie})).data,theirsSaved.data);
  for(const attempt of [
    await call(route,{method:'POST',cookie:theirs.cookie,ownerHeader:mine.user.id,body:{baseRevision:1,uiLocale:'en'}}),
    await call(route,{cookie:theirs.cookie,ownerHeader:mine.user.id}),
    await call(route,{method:'POST',cookie:theirs.cookie,body:{baseRevision:1,uiLocale:'en'}}),
  ]){
    assert.equal(attempt.status,409);
    const payload=JSON.stringify(attempt.data);
    assert.ok(!payload.includes(mine.user.id)&&!payload.includes('zh-Hans')&&!payload.includes('alice@example.com'),'an error may never carry the other account identity or choice');
  }
  const cleared=await call(route,{method:'POST',cookie:mine.cookie,ownerHeader:mine.user.id,body:{baseRevision:1,uiLocale:null}});
  assert.deepEqual(cleared.data,{revision:2,updatedAt:cleared.data.updatedAt,uiLocale:null},'clearing stays an explicit advancing choice');
  assert.deepEqual((await call(route,{cookie:mine.cookie})).data,cleared.data);
  assert.deepEqual((await call(route,{cookie:theirs.cookie})).data,theirsSaved.data,'a clear on one account never touches another');
});
