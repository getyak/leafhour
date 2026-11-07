import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLockedJsonStore} from '../server/locked-json-store.mjs';
import {createBillingRuntime} from '../server/billing-runtime.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const initial={id:'call-1',ownerId:owner,feature:'conversation',funding:'beta',provider:'deepseek',model:'deepseek-flash',status:'unknown',costStatus:'unknown',costMicrousd:null,usage:{inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null},startedAt:'2026-11-07T01:00:00Z'};
test('beta statistics persist without enabling or contacting a financial database',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-beta-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const dataStore=createLockedJsonStore({dataDir:dir}),env={READER_BILLING_ENABLED:'false',SUPABASE_URL:'https://not-a-billing-database.invalid',SUPABASE_SECRET_KEY:'synthetic-not-a-credential',READER_BILLING_ADMIN_USER_IDS:owner};
 const runtime=await createBillingRuntime({env,dataDir:dir,dataStore});
 await runtime.recordProviderCall({...initial,quote:'PRIVATE EXCERPT MUST NOT BE STORED'});
 await runtime.recordProviderCall(initial);
 await runtime.recordProviderCall({...initial,status:'completed',finishedAt:'2026-11-07T01:00:01Z',usage:{inputTokens:90,outputTokens:10,cacheReadTokens:0,cacheWriteTokens:0},costStatus:'reported_usage_rated',costMicrousd:7});
 const reopened=await createBillingRuntime({env,dataDir:dir,dataStore:createLockedJsonStore({dataDir:dir})});
 const report=await reopened.summary({ownerId:owner,from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z'});
 assert.equal(report.calls,1);assert.equal(report.callsByFunding.beta.calls,1);assert.equal(report.knownCostMicrousd,7);assert.equal(report.unknownCostCalls,0);assert.equal(report.financialAvailable,false);assert.equal(report.accounts,undefined);
 await assert.rejects(reopened.summary({ownerId:'another-owner',from:report.from,to:report.to}),e=>e.status===403);
 const bytes=(await Promise.all((await readdir(dir)).filter(x=>x.endsWith('.json')).map(x=>readFile(path.join(dir,x),'utf8')))).join('');
 assert.doesNotMatch(bytes,/PRIVATE EXCERPT/);
});
test('unresolved beta dispatch stays unknown and conflicting identities cannot overwrite it',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-beta-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtime=await createBillingRuntime({env:{READER_BILLING_ADMIN_USER_IDS:owner},dataDir:dir,dataStore:createLockedJsonStore({dataDir:dir})});
 await runtime.recordProviderCall(initial);
 await assert.rejects(runtime.recordProviderCall({...initial,ownerId:'different-owner'}),e=>e.status===409);
 const report=await runtime.summary({ownerId:owner,from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z'});
 assert.equal(report.calls,1);assert.equal(report.knownCostMicrousd,0);assert.equal(report.unknownCostCalls,1);assert.equal(report.complete,false);
});
test('concurrent duplicate callbacks are counted once across usage shards',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-beta-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtime=await createBillingRuntime({env:{READER_BILLING_ADMIN_USER_IDS:owner},dataDir:dir,dataStore:createLockedJsonStore({dataDir:dir})});
 await Promise.all(Array.from({length:24},(_,i)=>runtime.recordProviderCall({...initial,id:'concurrent-'+(i%12)})));
 const report=await runtime.summary({ownerId:owner,from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z'});
 assert.equal(report.calls,12);assert.equal(report.unknownCostCalls,12);
});
test('adding beta usage to a historical report does not mutate financial numbers or inputs',async()=>{
 const {mergeProviderUsage,providerUsageSummary}=await import('../server/beta-usage-store.mjs');
 const historical={accounts:2,paidOrders:1,salesByCurrency:{USD:500},calls:1,knownCostMicrousd:9,unknownCostCalls:0,callsByFunding:{credits:{calls:1,knownCostMicrousd:9,unknownCostCalls:0}},callsByFeature:{conversation:{calls:1,knownCostMicrousd:9,unknownCostCalls:0}}},before=structuredClone(historical);
 const current=providerUsageSummary([initial],{from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z'}),merged=mergeProviderUsage(historical,current);
 assert.equal(merged.paidOrders,1);assert.deepEqual(merged.salesByCurrency,{USD:500});assert.equal(merged.calls,2);assert.equal(merged.unknownCostCalls,1);assert.equal(merged.callsByFeature.conversation.calls,2);assert.deepEqual(historical,before);
});
