import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createReadingAgentTools} from '../server/reading-agent-tools.mjs';

const owner={id:'memory-alice'},other={id:'memory-bob'};
async function setup(t,dataStore){const dir=await mkdtemp(path.join(tmpdir(),'memory-'));t.after(()=>rm(dir,{recursive:true,force:true}));return createLibraryService({dataDir:dir,catalogDir:null,translator:null,dataStore});}
test('explicit preferences persist by owner, inferred values wait for confirmation, delete resets defaults',async t=>{
 const library=await setup(t);assert.equal(typeof library.getPreferenceMemory,'function');
 let view=await library.getPreferenceMemory(owner);assert.equal(view.revision,0);
 view=await library.changePreferenceMemory(owner,{baseRevision:0,action:'update',key:'theme',value:'night',inferred:true},'agent');
 assert.equal(view.preferences.theme,'system');assert.equal(view.memory.suggestions.theme.value,'night');
 assert.equal((await library.getReadingPreferences(owner)).preferences.theme,'system');
 view=await library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'confirm',key:'theme'},'settings');
 assert.equal(view.preferences.theme,'night');assert.equal(view.memory.suggestions.theme,undefined);
 view=await library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'update',key:'topic',value:'philosophy'},'onboarding');
 assert.equal(view.memory.topic,'philosophy');assert.equal((await library.getPreferenceMemory(other)).memory.topic,null);
 view=await library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'delete',key:'theme'},'agent');
 assert.equal(view.preferences.theme,'system');assert.equal(view.memory.history.at(-1).source,'agent');
 await assert.rejects(library.changePreferenceMemory(owner,{baseRevision:0,action:'delete',key:'topic'},'settings'),e=>e.status===409);
 await assert.rejects(library.getPreferenceMemory(null),e=>e.status===401);
 for(const input of [{baseRevision:view.revision,action:'__proto__',key:'theme'},{baseRevision:view.revision,action:'update',key:'owner',value:'bob'},{baseRevision:view.revision,action:'update',key:'theme',value:'evil'},{baseRevision:view.revision,action:'delete',key:'topic',owner:'bob'}])await assert.rejects(library.changePreferenceMemory(owner,input,'settings'),e=>e.status===400);
 const results=await Promise.allSettled(['fiction','history'].map(value=>library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'update',key:'topic',value},'settings')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('onboarding is at most three questions, records assigned order and skips once, and is portable',async t=>{
 const library=await setup(t);assert.equal(typeof library.changePreferenceMemory,'function');
 let view=await library.changePreferenceMemory(owner,{baseRevision:0,action:'onboarding',event:'started'},'onboarding');
 const order=view.memory.onboarding.order;assert.equal(order.length,3);
 for(const key of order){view=await library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'onboarding',event:'skipped',key},'onboarding');}
 assert.equal(view.memory.onboarding.status,'completed');assert.equal(view.memory.onboarding.events.filter(e=>e.event==='skipped').length,3);
 assert.equal(view.memory.onboarding.events.filter(e=>e.event==='completed').length,1);
 assert.deepEqual(view.memory.onboarding.events[0].order,order);
 const backup=await library.exportLibrary(owner);assert.ok(backup.readingPreferences.memory);
 const target=await setup(t);await target.restoreLibrary(owner,backup);
 assert.deepEqual((await target.getPreferenceMemory(owner)).memory,view.memory);
});
test('Agent tools capture account and require trusted per-turn permission for effective writes',async t=>{
 const library=await setup(t),tools=createReadingAgentTools({library,user:owner,scope:'library',env:{}});
 assert.ok(tools.definitions.some(d=>d.name==='get_preferences'));
 let view=await tools.execute('get_preferences');
 let result=await tools.execute('update_preference',{baseRevision:view.revision,key:'theme',value:'night',inferred:false});assert.ok(result.error);
 result=await tools.execute('update_preference',{baseRevision:view.revision,key:'theme',value:'night',inferred:true});assert.equal(result.preferences.theme,'system');
 const permitted=createReadingAgentTools({library,user:owner,scope:'library',allowPreferenceWrites:true,env:{}});
 view=await permitted.execute('get_preferences');view=await permitted.execute('update_preference',{baseRevision:view.revision,key:'theme',value:'night',inferred:false});assert.equal(view.preferences.theme,'night');
 view=await permitted.execute('delete_preference',{baseRevision:view.revision,key:'theme'});assert.equal(view.preferences.theme,'system');
 assert.ok((await tools.execute('delete_preference',{baseRevision:view.revision,key:'topic'})).error);
 assert.equal((await library.getPreferenceMemory(other)).revision,0);
});

test('hosted CAS backend persists choices and provenance without sharing another owner row',async t=>{
 const values=new Map(),queues=new Map();
 const dataStore={async read(key,fallback){return structuredClone(values.get(key)??fallback);},async mutate(key,fallback,fn){const prior=queues.get(key)||Promise.resolve();const work=prior.catch(()=>{}).then(()=>{const value=structuredClone(values.get(key)??fallback),result=fn(value);values.set(key,structuredClone(value));return result;});queues.set(key,work);return work;}};
 const library=await setup(t,dataStore);
 let view=await library.changePreferenceMemory(owner,{baseRevision:0,action:'update',key:'mode',value:'zh'},'settings');
 view=await library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'update',key:'topic',value:'science',inferred:true},'agent');
 assert.equal(view.memory.topic,null);assert.equal(view.preferences.mode,'zh');
 const second=await setup(t,dataStore); // same logical account root must use same key on the hosted store
 assert.equal(values.size,1);assert.equal((await library.getPreferenceMemory(other)).revision,0);
 const row=[...values.values()][0];assert.equal(row.memory.sources.mode.source,'settings');assert.equal(row.memory.history.at(-1).operation,'suggest');
 assert.equal((await second.getPreferenceMemory(other)).revision,0);
});

test('answered onboarding immediately changes the existing reader defaults and records completion once',async t=>{
 const library=await setup(t);let view=await library.getPreferenceMemory(owner);
 for(const key of view.memory.onboarding.order){const choice={topic:'fiction',language:'zh',style:'night'}[key];view=await library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'onboarding',event:'answered',key,choice},'onboarding');}
 assert.equal(view.preferences.mode,'zh');assert.equal(view.preferences.readingPurpose,'manual');assert.equal(view.preferences.theme,'night');assert.equal(view.memory.topic,'fiction');
 assert.equal(view.memory.onboarding.events.filter(e=>e.event==='completed').length,1);
 await assert.rejects(library.changePreferenceMemory(owner,{baseRevision:view.revision,action:'onboarding',event:'started'},'onboarding'),e=>e.status===409);
 const otherView=await library.changePreferenceMemory(other,{baseRevision:0,action:'onboarding',event:'dismissed'},'onboarding');assert.equal(otherView.memory.onboarding.status,'dismissed');
 assert.equal(otherView.memory.onboarding.events.filter(e=>e.event==='dismissed').length,1);
});

test('HTTP memory endpoint requires the current owner and rejects identity injection and oversized bodies',async t=>{
 const {createReaderServer}=await import('../server/server.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'memory-http-')),codes=new Map();
 const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:async(email,code)=>codes.set(email,code),translator:null,env:{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body,cookie='',ownerId='')=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie,...(ownerId?{'X-Reader-Owner':ownerId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await call('/api/account/preference-memory')).status,401);
 await call('/api/auth/code',{email:'memory@example.com',purpose:'login'});const signed=await call('/api/auth/verify',{email:'memory@example.com',purpose:'login',code:codes.get('memory@example.com')});
 const cookie=signed.headers.get('set-cookie').split(';')[0],user=(await signed.json()).user;
 const input={baseRevision:0,action:'update',key:'theme',value:'night'};
 assert.equal((await call('/api/account/preference-memory',input,cookie)).status,409);
 assert.equal((await call('/api/account/preference-memory',input,cookie,'someone-else')).status,409);
 const saved=await call('/api/account/preference-memory',input,cookie,user.id);assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);assert.equal((await saved.json()).preferences.theme,'night');
 assert.equal((await call('/api/account/preference-memory',{...input,baseRevision:1,ownerId:'someone-else'},cookie,user.id)).status,400);
 assert.equal((await call('/api/account/preference-memory',{large:'x'.repeat(9000)},cookie,user.id)).status,413);
 assert.equal((await(await call('/api/auth/session',undefined,cookie)).json()).preferenceMemory.preferences.theme,'night');
});

test('restore refuses onboarding state that would hide chat with no question or exit',async()=>{
 const {validatePreferenceMemory,initialPreferenceMemory}=await import('../app/preference-memory-codec.mjs');const memory=initialPreferenceMemory();
 memory.onboarding.answers=[{key:'topic',choice:null},{key:'language',choice:null},{key:'style',choice:null}];
 assert.throws(()=>validatePreferenceMemory(memory));
});

test('deleting mode clears its language/form filter and unrelated preference changes leave filters alone',async()=>{
 const {preferenceShelfPatch}=await import('../app/library-filter-controls.mjs');
 const view={preferences:{mode:'en'},memory:{topic:'fiction',sources:{}}};
 assert.deepEqual(preferenceShelfPatch(view,{keys:['mode']}),{language:'all',form:'all'});
 assert.deepEqual(preferenceShelfPatch(view,{keys:['theme']}),{});
});
