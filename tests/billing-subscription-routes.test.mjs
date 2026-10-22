import test from 'node:test';
import assert from 'node:assert/strict';
import {createBillingRoutes} from '../server/billing-routes.mjs';
import {createBillingService,CREDIT_UNITS} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';

function fixture({verified=true,budget=100*CREDIT_UNITS}={}){
 const billing=createBillingService({store:createBillingMemoryStore(),enabled:true,trialBudgetUnits:budget});
 const scope={bookId:'book',contentVersion:'v1',requestHash:'request'};
 const gate={quote:(user,input)=>billing.quote({ownerId:user.id,action:input.action,scope})};
 const routes=createBillingRoutes({billing,gate,publicOrigin:'https://leafhour.example',verifyEmail:async()=>verified});
 const user={id:'reader',emailVerified:!verified};
 const run=async(path,{method='GET',body,headers={},as=user}={})=>{
  let result;const res={setHeader(){}};
  const handled=await routes.handle({req:{method,headers:{origin:'https://leafhour.example','x-reader-owner':'reader',...headers}},res,url:new URL(path,'https://leafhour.example'),user:as,body,send:(status,data)=>{result={status,data};}});
  return {handled,...result};
 };
 return {billing,run,scope,user};
}

test('first explicit AI quote automatically grants exactly ten points using fresh verified identity',async()=>{
 const f=fixture();assert.equal((await f.billing.account({ownerId:'reader'})).availableUnits,0);
 for(let i=0;i<2;i++)assert.equal((await f.run('/api/billing/quotes',{method:'POST',body:{action:'translation',bookId:'book',input:{}}})).status,201);
 const account=await f.billing.account({ownerId:'reader'});
 assert.equal(account.availableUnits,10*CREDIT_UNITS);assert.equal(account.trialGranted,true);
 assert.equal((await f.billing.entries({ownerId:'reader'})).entries.filter(e=>e.type==='grant').length,1);
});

test('unverified identity never receives automatic trial despite stale browser session claims',async()=>{
 const f=fixture({verified:false});await f.run('/api/billing/quotes',{method:'POST',body:{action:'translation',bookId:'book',input:{}}});
 assert.equal((await f.billing.account({ownerId:'reader'})).trialGranted,false);
});

test('exhausted trial campaign does not prevent a valid quote or mint a grant',async()=>{
 const f=fixture({budget:0});assert.equal((await f.run('/api/billing/quotes',{method:'POST',body:{action:'conversation',bookId:'book',input:{}}})).status,201);
 assert.equal((await f.billing.account({ownerId:'reader'})).availableUnits,0);
});

test('after ten translations trial is exhausted and the next generation stops before execution',async()=>{
 const f=fixture();let executions=0;
 for(let i=0;i<11;i++){
  const {data:q}=await f.run('/api/billing/quotes',{method:'POST',body:{action:'translation',bookId:'book',input:{}}});
  const task=f.billing.run({ownerId:'reader',quoteId:q.id,idempotencyKey:'translation-'+i,scope:f.scope,execute:async({operationId})=>{executions++;return {receipt:{ownerId:'reader',bookId:'book',contentVersion:'v1',resultId:'translation-'+i,operationId}};}});
  if(i<10)await task;else await assert.rejects(task,{code:'insufficient_credits',status:402});
 }
 assert.equal(executions,10);assert.equal((await f.billing.account({ownerId:'reader'})).availableUnits,0);
});

test('subscription and portal routes enforce owner, origin and server-resolved customer identity',async()=>{
 const calls=[],billing={subscriptions:async input=>(calls.push(['subscriptions',input]),{subscriptions:[]}),portal:async input=>(calls.push(['portal',input]),{portalUrl:'https://creem.io/customer-portal/test'})};
 const routes=createBillingRoutes({billing,publicOrigin:'https://leafhour.example'});
 const run=async(path,{method='GET',headers={},body,user={id:'reader'}}={})=>{
  let result;return {handled:await routes.handle({req:{method,headers:{origin:'https://leafhour.example','x-reader-owner':'reader',...headers}},res:{setHeader(){}},url:new URL(path,'https://leafhour.example'),user,body,send:(status,data)=>{result={status,data};}}),...result};
 };
 assert.equal((await run('/api/billing/subscriptions')).status,200);
 assert.deepEqual(calls.at(-1),['subscriptions',{ownerId:'reader'}]);
 assert.equal((await run('/api/billing/portal',{method:'POST',body:{subscriptionId:'sub_abc'}})).status,200);
 assert.deepEqual(calls.at(-1),['portal',{ownerId:'reader',subscriptionId:'sub_abc'}]);
 await assert.rejects(run('/api/billing/portal',{method:'POST',body:{subscriptionId:'sub_abc',customerId:'cust_foreign'}}),{status:400});
 await assert.rejects(run('/api/billing/portal',{method:'POST',headers:{'x-reader-owner':'other'},body:{subscriptionId:'sub_abc'}}),{status:409});
 await assert.rejects(run('/api/billing/portal',{method:'POST',headers:{origin:'https://foreign.example'},body:{subscriptionId:'sub_abc'}}),{status:403});
 await assert.rejects(run('/api/billing/subscriptions',{user:null}),{status:401});
 await assert.rejects(run('/api/billing/subscriptions',{method:'POST',body:{}}),{status:405});
});
