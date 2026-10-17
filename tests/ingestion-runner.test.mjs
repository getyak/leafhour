import test from 'node:test';import assert from 'node:assert/strict';
import {createIngestionRunner,ingestionWakeToken} from '../server/ingestion-runner.mjs';
const owner={id:'user-one'},id='11111111-1111-4111-8111-111111111111';
function memory(){const rows=new Map();let chain=Promise.resolve();return {read:async(k,f)=>structuredClone(rows.get(k)??f),mutate(k,f,fn){const p=chain.then(()=>{const d=structuredClone(rows.get(k)??f),v=fn(d);rows.set(k,d);return v;});chain=p.catch(()=>{});return p;}};}
function fixture(state='running'){
 const store=memory(),work=[];let steps=0;
 const ingestion={view:async()=>({id,state}),advance:async()=>{steps++;if(steps>=3)state='done';return {id,state};}};
 return {store,work,ingestion,get steps(){return steps;},set state(v){state=v;},make:()=>createIngestionRunner({store,ingestion,schedule:p=>work.push(p),sliceMs:2000,stepDelayMs:0,maxSteps:8})};
}
test('a persisted job finishes without browser polling and survives a new runner instance',async()=>{
 const f=fixture(),first=f.make();await first.enqueue(owner,id,{start:false});assert.equal(f.steps,0);
 const restored=f.make();restored.tick();await Promise.all(f.work);assert.equal(f.steps,3);assert.equal((await f.store.read('ingestion/queue/v1',null)).jobs.length,0);await restored.close();await first.close();
});
test('concurrent workers share a queue lease and do not advance one job twice',async()=>{
 const f=fixture(),a=f.make(),b=f.make();await a.enqueue(owner,id,{start:false});a.tick();b.tick();await Promise.all(f.work);assert.equal(f.steps,3);await a.close();await b.close();
});
test('consent pauses and cancellation are terminal for automatic advancement',async()=>{
 for(const state of ['awaiting_consent','cancelled','failed','needs_review','done']){const f=fixture(state),r=f.make();await r.enqueue(owner,id);await Promise.all(f.work);assert.equal(f.steps,0);await r.close();}
 const f=fixture(),r=f.make();await r.enqueue(owner,id,{start:false});f.state='cancelled';r.tick();await Promise.all(f.work);assert.equal(f.steps,0);await r.close();
});
test('internal wake credentials are purpose-separated, exact and never exposed in queue state',async()=>{
 const f=fixture(),env={SUPABASE_SECRET_KEY:'server-fixture'},r=createIngestionRunner({store:f.store,ingestion:f.ingestion,env,schedule:p=>f.work.push(p)}),token=ingestionWakeToken(env);
 assert.ok(token&&token!=='server-fixture');assert.equal(r.authorized('Bearer '+token),true);for(const header of [undefined,'Bearer server-fixture','Bearer '+token+'x','bearer '+token])assert.equal(r.authorized(header),false);
 await r.enqueue(owner,id,{start:false});assert.ok(!JSON.stringify(await f.store.read('ingestion/queue/v1',null)).includes(token));await r.close();
});
test('a contending hosted worker does not self-wake while another lease is active',async()=>{
 const f=fixture();let wakes=0;await f.store.mutate('ingestion/queue/v1',{jobs:[]},q=>{q.jobs=[{ownerId:owner.id,id,nextAt:0}];q.lease={token:'other-worker',until:Date.now()+60000};});
 const r=createIngestionRunner({store:f.store,ingestion:f.ingestion,env:{SUPABASE_SECRET_KEY:'fixture'},publicOrigin:'https://reader.example.com',fetcher:async()=>{wakes++;return Response.json({});}});
 await r.tick();assert.equal(f.steps,0);assert.equal(wakes,0);await r.close();
});

test('a hosted worker configures its private recovery secret from existing server configuration',async()=>{
 const f=fixture();let configured=0;f.store.configureIngestionWake=async(origin,token)=>{assert.equal(origin,'https://reader.example.com');assert.equal(token,ingestionWakeToken({SUPABASE_SECRET_KEY:'fixture'}));configured++;return true;};const r=createIngestionRunner({store:f.store,ingestion:f.ingestion,env:{SUPABASE_SECRET_KEY:'fixture'},publicOrigin:'https://reader.example.com'});await r.tick();await r.tick();assert.equal(configured,1);await r.close();
});
