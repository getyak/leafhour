import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAccountUiPreferences} from '../server/account-ui-preferences.mjs';
import {digest} from '../server/document-import.mjs';
const owner={id:'synthetic-get219'},stamp='2026-10-25T00:00:00Z';
for(const backend of ['file','store'])test(backend+': legacy clears stay absent; system upgrades only an explicit CAS; v2 is never downgraded',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'get219-')),file=path.join(dataDir,'users',digest(owner.id),'ui-preferences.json');t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const old={kind:'marginalia-ui-preferences',schemaVersion:1,revision:7,updatedAt:stamp,uiLocale:null};let stored=structuredClone(old);
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(old));
 const dataStore=backend==='store'?{read:async()=>structuredClone(stored),mutate:async(key,fallback,fn)=>{const next=structuredClone(stored);const result=fn(next);stored=next;return result;}}:null;
 const prefs=createAccountUiPreferences({dataDir,dataStore}),raw=async()=>backend==='file'?JSON.parse(await readFile(file,'utf8')):stored;
 assert.equal((await prefs.get(owner)).uiLocale,null);assert.deepEqual(await raw(),old,'read does not migrate or write');
 await assert.rejects(prefs.save(owner,{baseRevision:6,uiLocale:'system'}),e=>e.status===409);assert.deepEqual(await raw(),old);
 const system=await prefs.save(owner,{baseRevision:7,uiLocale:'system'});assert.equal(system.uiLocale,'system');assert.equal(system.revision,8);assert.equal((await raw()).schemaVersion,2);
 const rebuilt=createAccountUiPreferences({dataDir,dataStore});assert.deepEqual(await rebuilt.get(owner),system);
 const cleared=await rebuilt.save(owner,{baseRevision:8,uiLocale:null});assert.equal(cleared.uiLocale,null);assert.equal(cleared.revision,9);assert.equal((await raw()).schemaVersion,2);
 assert.equal((await rebuilt.get(owner)).uiLocale,null,'v2 explicit clears still mean no account choice');
 await rebuilt.save(owner,{baseRevision:9,uiLocale:'ja'});assert.equal((await raw()).schemaVersion,2);assert.equal((await rebuilt.get(owner)).uiLocale,'ja');
});
for(const record of [
 {schemaVersion:1,uiLocale:'system'}, {schemaVersion:3,uiLocale:'system'},
 {schemaVersion:2,uiLocale:'system',extra:true}, {schemaVersion:2,uiLocale:'SYSTEM'},
 {schemaVersion:2,uiLocale:'system',revision:0,updatedAt:null}
])test('strict system document refuses '+JSON.stringify(record),async()=>{
 const original={kind:'marginalia-ui-preferences',schemaVersion:1,revision:2,updatedAt:stamp,uiLocale:null,...record};let writes=0;
 const prefs=createAccountUiPreferences({dataDir:'/synthetic-get219',dataStore:{read:async()=>original,mutate:async(k,f,fn)=>{const result=fn(original);writes++;return result;}}});
 await assert.rejects(prefs.get(owner),e=>e.status===409);await assert.rejects(prefs.save(owner,{baseRevision:original.revision,uiLocale:'system'}),e=>e.status===409);assert.equal(writes,0);
});
