import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';
import {globalPreferencesDefaults,validateGlobalPreferences,openingReadingView} from '../app/reading-preferences.mjs';

const snapshot=(patch={})=>validateGlobalPreferences(raw(patch));
const raw=(patch={})=>({...globalPreferencesDefaults,mode:'parallel',variant:'literal',...patch});
const memoryStore=()=>{const values=new Map(),queues=new Map();return {async read(key,fallback){return structuredClone(values.get(key)??fallback);},async mutate(key,fallback,operation){const prior=queues.get(key)||Promise.resolve(),work=prior.catch(()=>{}).then(async()=>{const row=structuredClone(values.get(key)??fallback);const result=await operation(row);values.set(key,JSON.parse(JSON.stringify(row)));return structuredClone(result);});queues.set(key,work);try{return await work;}finally{if(queues.get(key)===work)queues.delete(work);}}};};
const prefsBackup=(preferences,revision=0)=>({kind:'marginalia-library',schemaVersion:1,books:[],readingPreferences:{kind:'marginalia-reading-preferences',schemaVersion:1,revision,updatedAt:'2026-10-17T00:00:00.000Z',preferences}});
const owner={id:'account-alice'},other={id:'account-bob'};
const exists=async file=>{try{await readFile(file);return true;}catch{return false;}};

test('account reading defaults persist across service processes inside only the owner directory',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const first=await createLibraryService({dataDir:dir,catalogDir:null,translator:null});
  assert.deepEqual(await first.getReadingPreferences(owner),{revision:0,updatedAt:null,preferences:null},'a read must not invent state');
  assert.equal(await exists(path.join(dir,'users',digest(owner.id),'reading-preferences.json')),false);
  const saved=await first.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({font:25,theme:'leaf'})});
  assert.equal(saved.revision,1);assert.equal(saved.preferences.font,25);assert.equal(saved.preferences.theme,'leaf');
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  const second=await createLibraryService({dataDir:dir,catalogDir:null,translator:null});
  assert.deepEqual(await second.getReadingPreferences(owner),saved,'a new process reads the same account snapshot');
  assert.deepEqual(await second.getReadingPreferences(other),{revision:0,updatedAt:null,preferences:null});
  await assert.rejects(second.getReadingPreferences(null),e=>e.status===401);
  await assert.rejects(second.saveReadingPreferences(null,{baseRevision:0,preferences:snapshot()}),e=>e.status===401);
  assert.equal(await exists(path.join(dir,'users',digest(other.id),'reading-preferences.json')),false,'an untouched account keeps no preferences file');
  const raw=JSON.parse(await readFile(path.join(dir,'users',digest(owner.id),'reading-preferences.json'),'utf8'));
  assert.equal(raw.kind,'marginalia-reading-preferences');assert.equal(raw.schemaVersion,1);assert.equal(raw.revision,1);
  assert.equal(raw.email,undefined);assert.equal(raw.user,undefined);assert.equal(raw.owner,undefined);
});

test('GET reads without creating state and the session only exposes the current account defaults',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-http-'));
  const codes=new Map();
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:async(email,code)=>codes.set(email,code),translator:null});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(url,{method='GET',cookie,ownerHeader,body}={})=>{
    const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(ownerHeader?{'X-Reader-Owner':ownerHeader}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,headers:response.headers,data:await response.json().catch(()=>null)};
  };
  const login=async email=>{await call('/api/auth/code',{method:'POST',body:{email,purpose:'login'}});const verify=await call('/api/auth/verify',{method:'POST',body:{email,code:codes.get(email),purpose:'login'}});assert.equal(verify.status,200);return {cookie:verify.headers.get('set-cookie').split(';')[0],user:verify.data.user};};
  const anonymous=await call('/api/account/reading-preferences');
  assert.deepEqual(anonymous.data,{revision:0,updatedAt:null,preferences:null});
  assert.equal(await exists(path.join(dir,'portal','library','users')),false,'anonymous reads create no account state');
  assert.equal((await call('/api/account/reading-preferences',{method:'POST',body:{baseRevision:0,preferences:snapshot()}})).status,401);
  assert.equal((await call('/api/auth/session')).data.readingPreferences,null,'guests never see account defaults');
  const alice=await login('alice@example.com'),bob=await login('bob@example.com');
  assert.deepEqual((await call('/api/auth/session',{cookie:alice.cookie})).data.readingPreferences,{revision:0,updatedAt:null,preferences:null});
  const saved=await call('/api/account/reading-preferences',{method:'POST',cookie:alice.cookie,ownerHeader:alice.user.id,body:{baseRevision:0,preferences:snapshot({mode:'zh',onboarding:'completed'})}});
  assert.equal(saved.status,200);assert.equal(saved.data.preferences.mode,'zh');
  const mine=await call('/api/account/reading-preferences',{cookie:alice.cookie,ownerHeader:alice.user.id});assert.deepEqual(mine.data,saved.data);
  assert.deepEqual((await call('/api/auth/session',{cookie:alice.cookie})).data.readingPreferences,saved.data,'the session carries only the signed-in account snapshot');
  const theirs=await call('/api/account/reading-preferences',{cookie:bob.cookie,ownerHeader:bob.user.id});assert.deepEqual(theirs.data,{revision:0,updatedAt:null,preferences:null});
  assert.deepEqual((await call('/api/auth/session',{cookie:bob.cookie})).data.readingPreferences,{revision:0,updatedAt:null,preferences:null});
  assert.equal((await call('/api/account/reading-preferences',{cookie:bob.cookie})).data.revision,0,'without an owner header the session identity is still the only account read');
  for(const method of ['GET','POST']){
    const mismatch=await call('/api/account/reading-preferences',{method,cookie:alice.cookie,ownerHeader:bob.user.id,...(method==='POST'?{body:{baseRevision:1,preferences:snapshot()}}:{})});
    assert.equal(mismatch.status,409,method);assert.equal(mismatch.headers.get('x-reader-session-changed'),'1');
  }
  assert.equal((await call('/api/account/reading-preferences',{cookie:alice.cookie,ownerHeader:alice.user.id})).data.revision,1,'a rejected stale write changes nothing');
});

test('strict snapshots reject unknown, missing, unbounded and owner-bearing payloads without saving',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-strict-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null}),good=snapshot();
  await library.saveReadingPreferences(owner,{baseRevision:0,preferences:good});
  const invalid=[
    {...good,theme:'unknown'},{...good,font:99},{...good,indent:'yes'},{...good,mode:'fr'},{...good,variant:'gist'},{...good,onboarding:'nagged'},
    {...good,parallelStyle:'blur(9px)'},{...good,letterSpacing:5},{...good,extra:1},Object.fromEntries(Object.entries(good).filter(([key])=>key!=='font')),
    {ownerId:'account-bob'},{kind:'marginalia-reading-preferences'},{},null,42,'x',[],
  ];
  for(const preferences of invalid){
    for(const input of [{baseRevision:1,preferences},{baseRevision:1,preferences:good,ownerId:'account-bob'},{baseRevision:1,preferences:good,id:'chosen-by-payload'},{baseRevision:'1',preferences:good},{preferences:good},{baseRevision:1,preferences,account:'other'}]){
      await assert.rejects(library.saveReadingPreferences(owner,input),e=>e.status===400,JSON.stringify(input));
    }
    assert.deepEqual((await library.getReadingPreferences(owner)).preferences,good,'a rejected request never alters the saved snapshot');
  }
  assert.deepEqual((await library.getReadingPreferences(owner)).preferences,good);
});

test('revision compare-and-swap rejects stale writers, keeps one winner and never rewinds',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-cas-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null}),first=await library.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({font:20})});
  assert.equal(first.revision,1);
  await assert.rejects(library.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({font:21})}),e=>e.status===409);
  assert.equal((await library.getReadingPreferences(owner)).preferences.font,20);
  const results=await Promise.allSettled([library.saveReadingPreferences(owner,{baseRevision:1,preferences:snapshot({font:22})}),library.saveReadingPreferences(owner,{baseRevision:1,preferences:snapshot({font:23})})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'exactly one concurrent writer may advance the revision');
  assert.equal((await library.getReadingPreferences(owner)).revision,2);
  const winner=results.find(r=>r.status==='fulfilled').value;
  assert.equal((await library.getReadingPreferences(owner)).preferences.font,winner.preferences.font);
});

test('first-reading setup can be saved, durably dismissed and reopened by the same owner',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-setup-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null});
  assert.equal((await library.getReadingPreferences(owner)).preferences,null,'no setup has happened yet');
  const completed=await library.saveReadingPreferences(owner,{baseRevision:0,preferences:snapshot({onboarding:'completed'})});
  assert.equal(completed.preferences.onboarding,'completed');
  const dismissed=await library.saveReadingPreferences(owner,{baseRevision:1,preferences:snapshot({onboarding:'dismissed'})});
  assert.equal(dismissed.preferences.onboarding,'dismissed');
  const reopened=await library.saveReadingPreferences(owner,{baseRevision:2,preferences:snapshot({onboarding:'pending'})});
  assert.equal(reopened.preferences.onboarding,'pending');assert.equal(reopened.revision,3);
  await assert.rejects(library.saveReadingPreferences(owner,{baseRevision:3,preferences:raw({onboarding:'done'})}),e=>e.status===400);
  const restored=await createLibraryService({dataDir:dir,catalogDir:null,translator:null});
  assert.equal((await restored.getReadingPreferences(owner)).preferences.onboarding,'pending','the dismissed/completed state survives new processes');
});

test('the account API bypasses reader-api per-book path rewriting',async t=>{
  globalThis.location=new URL('http://reader.test/read?book=chosen-book');
  globalThis.window={addEventListener(){}};
  globalThis.document={addEventListener(){}};
  const {readerApiUrl,readerStorageKey}=await import('../app/reader-api.mjs');
  assert.equal(readerApiUrl('/api/account/reading-preferences'),'/api/account/reading-preferences');
  assert.equal(readerApiUrl('/api/auth/session'),'/api/auth/session');
  assert.equal(readerApiUrl('/api/records'),'/api/library/books/chosen-book/records');
  assert.equal(readerApiUrl('/api/book'),'/api/library/books/chosen-book');
  assert.match(readerStorageKey('marginalia-focus-position-v1'),/\|guest\|chosen-book$/);
});

test('account requests stay inside the 8 KiB body budget',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-body-'));
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,Origin:base,'Content-Type':'application/json'};
  const post=async body=>fetch(base+'/api/account/reading-preferences',{method:'POST',headers,body:JSON.stringify(body)});
  assert.ok(JSON.stringify({baseRevision:0,preferences:snapshot()}).length<8*1024,'a full snapshot is comfortably inside the budget');
  assert.equal((await post({baseRevision:0,preferences:snapshot()})).status,200);
  assert.equal((await post({baseRevision:1,preferences:snapshot(),padding:'x'.repeat(9000)})).status,413);
  assert.equal((await fetch(base+'/api/account/reading-preferences',{headers})).status,200);
  const asset=await fetch(base+'/library-reading-preferences.mjs');assert.equal(asset.status,200,'the account settings module ships with the library');assert.match(asset.headers.get('content-type'),/javascript/);
});

test('a restore advances the revision past pending CAS writers on fs and datastore backends',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'account-prefs-restore-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const backends=[['fs',await createLibraryService({dataDir:path.join(dir,'fs'),catalogDir:null,translator:null})],['datastore',await createLibraryService({dataDir:path.join(dir,'cloud'),catalogDir:null,translator:null,dataStore:memoryStore()})]];
  for(const [name,library]of backends){
    const user={id:'restore-'+name};
    const first=await library.saveReadingPreferences(user,{baseRevision:0,preferences:snapshot({font:21})});
    assert.equal(first.revision,1,name);
    // Regression: a pending CAS write for rev1 must never overwrite restored content.
    await library.restoreLibrary(user,prefsBackup(snapshot({font:18,theme:'mist'}),0));
    const restored=await library.getReadingPreferences(user);
    assert.equal(restored.revision,2,name+'：恢复替换内容后版本必须前进到恢复前 CAS 之后');
    assert.equal(restored.preferences.font,18);assert.equal(restored.preferences.theme,'mist');
    await assert.rejects(library.saveReadingPreferences(user,{baseRevision:1,preferences:snapshot({font:22})}),e=>e.status===409,name+'：恢复前发出的旧写入必须409');
    assert.equal((await library.getReadingPreferences(user)).preferences.font,18,name+'：恢复结果必须保留');
    const again=await library.saveReadingPreferences(user,{baseRevision:2,preferences:snapshot({font:23})});assert.equal(again.revision,3,name);
    // A restore also never lands below the archive's own revision.
    const fresh={id:'incoming-'+name};
    await library.restoreLibrary(fresh,prefsBackup(snapshot({font:24}),5));
    assert.equal((await library.getReadingPreferences(fresh)).revision,5,name+'：版本不低于备份自带版本');
  }
  // preserveExisting with a configured target stays an unchanged no-op
  const keep=await createLibraryService({dataDir:path.join(dir,'keep'),catalogDir:null,translator:null}),user={id:'keep-owner'},kept=await keep.saveReadingPreferences(user,{baseRevision:0,preferences:snapshot({font:19})});
  await keep.restoreLibrary(user,prefsBackup(snapshot({font:18}),9),{preserveExisting:true});
  assert.deepEqual(await keep.getReadingPreferences(user),kept,'preserveExisting keeps a configured target as an unchanged no-op');
  // Overflow is refused instead of wrapping back into an open CAS window
  const overflow=await createLibraryService({dataDir:path.join(dir,'overflow'),catalogDir:null,translator:null}),max={id:'overflow-owner'};
  await overflow.saveReadingPreferences(max,{baseRevision:0,preferences:snapshot()});
  const file=path.join(dir,'overflow','users',digest(max.id),'reading-preferences.json'),doc=JSON.parse(await readFile(file,'utf8'));doc.revision=Number.MAX_SAFE_INTEGER;await writeFile(file,JSON.stringify(doc));
  await assert.rejects(overflow.restoreLibrary(max,prefsBackup(snapshot({font:18}),0)),e=>e.status===409);
  await assert.rejects(overflow.saveReadingPreferences(max,{baseRevision:Number.MAX_SAFE_INTEGER,preferences:snapshot({font:18})}),e=>e.status===409);
  assert.equal((await overflow.getReadingPreferences(max)).preferences.font,snapshot().font);
});
