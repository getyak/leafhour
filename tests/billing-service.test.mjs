import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';

const {createBillingMemoryStore}=await import('../server/billing-memory-store.mjs');
const {createBillingService}=await import('../server/billing-service.mjs');
const {createCreem}=await import('../server/creem.mjs');
const U=1_000_000, ownerId='test-owner', mode='test';
const scope={bookId:'book-1',sourceVersion:'sha-1',passageId:'p-1',inputHash:'a'.repeat(64)};
const command=(store,action,p={})=>store.command(action,{mode,ownerId,...p});
async function fixture(){
  let time=Date.parse('2026-10-21T00:00:00Z');const store=createBillingMemoryStore({clock:()=>time});let creations=0;
  const creem={ready:true,mode,productIds:{reading_monthly_100:'prod_test'},async createCheckout(){creations++;return {id:'ch_test',checkoutUrl:'https://checkout.creem.io/ch_test'};}};
  const service=createBillingService({store,creem,enabled:true,mode,publicOrigin:'https://leafhour.example',clock:()=>time});
  return {store,service,creem,get creations(){return creations;},advance:ms=>time+=ms};
}
async function funded(store,units=10*U){await command(store,'trial',{grantId:'trial',units,now:'2026-10-21T00:00:00.000Z'});}
async function paid(store){
  await command(store,'order',{id:'order-1',intentKey:'intent-1',productKey:'reading_100',productId:'prod_test',amount:500,currency:'USD',units:100*U});
  await command(store,'checkout',{orderId:'order-1',checkoutId:'ch_test',checkoutUrl:'https://checkout.creem.io/ch_test'});
  return command(store,'payment',{orderId:'order-1',eventId:'evt-1',eventHash:'hash-1',checkoutId:'ch_test',providerOrderId:'ord_test',productId:'prod_test',amount:500,currency:'USD',paidAmount:550,taxAmount:50,discountAmount:0,units:100*U});
}
test('payment events and provider order are deduplicated atomically',async()=>{
  const {store}=await fixture(); await paid(store);
  for(let n=0;n<10;n++)await command(store,'payment',{orderId:'order-1',eventId:'evt-1',eventHash:'hash-1',checkoutId:'ch_test',providerOrderId:'ord_test',productId:'prod_test',amount:500,currency:'USD',paidAmount:550,taxAmount:50,discountAmount:0,units:100*U});
  assert.equal((await command(store,'account')).availableUnits,100*U);
  await assert.rejects(command(store,'payment',{orderId:'order-1',eventId:'evt-1',eventHash:'changed'}),{code:'event_conflict'});
});
test('concurrent holds cannot overspend and idempotency cannot change input',async()=>{
  const {store,service}=await fixture();await funded(store,4*U);
  const q=await service.quote({ownerId,action:'conversation',scope}),q2=await service.quote({ownerId,action:'conversation',scope});
  const args={quoteId:q.id,scopeHash:q.scopeHash};
  const results=await Promise.allSettled([command(store,'reserve',{...args,operationId:'op-1',idempotencyKey:'key-1'}),command(store,'reserve',{quoteId:q2.id,scopeHash:q2.scopeHash,operationId:'op-2',idempotencyKey:'key-2'})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'insufficient_credits');
  assert.equal((await command(store,'reserve',{...args,operationId:'op-other',idempotencyKey:'key-1'})).id,'op-1');
  await assert.rejects(command(store,'reserve',{...args,scopeHash:'changed',operationId:'op-1',idempotencyKey:'key-1'}),{code:'idempotency_conflict'});
});
test('stale and changed quotes fail before model execution',async()=>{
  const f=await fixture();await funded(f.store); const q=await f.service.quote({ownerId,action:'translation',scope});let calls=0;
  f.advance(601000);
  await assert.rejects(f.service.run({ownerId,quoteId:q.id,idempotencyKey:'x',scope,execute:async()=>{calls++;}}),{code:'stale_quote'});
  assert.equal(calls,0);
});
test('failure releases, persisted success settles once, and replay never executes',async()=>{
  const {store,service}=await fixture();await funded(store);const q=await service.quote({ownerId,action:'conversation',scope});
  await assert.rejects(service.run({ownerId,quoteId:q.id,idempotencyKey:'fail',scope,execute:async()=>{throw new Error('supplier failed');}}));
  assert.equal((await command(store,'account')).availableUnits,10*U);
  const successQuote=await service.quote({ownerId,action:'conversation',scope});let calls=0;const request={ownerId,quoteId:successQuote.id,idempotencyKey:'success',scope,execute:async({operationId})=>{calls++;return {receipt:{ownerId,...scope,resultId:operationId}};}};
  const first=await service.run(request),again=await service.run(request);
  assert.equal(first.status,'settled');assert.equal(again.id,first.id);assert.equal(calls,1);
  assert.equal((await command(store,'account')).consumedUnits,4*U);
});
test('cancellation fencing prevents late saved result or settlement',async()=>{
  const {store,service}=await fixture();await funded(store);const q=await service.quote({ownerId,action:'translation',scope});
  const op=await command(store,'reserve',{quoteId:q.id,scopeHash:q.scopeHash,operationId:'cancel-op',idempotencyKey:'cancel'});
  await command(store,'release',{operationId:op.id,reservationToken:op.reservationToken,reason:'cancelled'});
  await assert.rejects(command(store,'result',{operationId:op.id,reservationToken:op.reservationToken,receipt:{ownerId,...scope,resultId:'late'}}),{code:'invalid_state'});
  assert.equal((await command(store,'account')).availableUnits,10*U);
});
test('purchase intent repeats once and foreign owner cannot read it',async()=>{
  const f=await fixture();const a=await f.service.checkout({ownerId,intentKey:'buy-1'}),b=await f.service.checkout({ownerId,intentKey:'buy-1'});
  assert.equal(a.order.id,b.order.id);assert.equal(f.creations,1);
  assert.equal(await f.service.order({ownerId:'foreign',orderId:a.order.id}),null);
});
test('refund before payment and dispute cannot revive purchase credits',async()=>{
  const {store}=await fixture();await command(store,'order',{id:'order-1',intentKey:'intent-1',productKey:'reading_100',productId:'prod_test',amount:500,currency:'USD',units:100*U});
  await command(store,'checkout',{orderId:'order-1',checkoutId:'ch_test',checkoutUrl:'https://checkout.creem.io/ch_test'});
  await command(store,'refund',{orderId:'order-1',eventId:'refund-event',eventHash:'refund-hash',refundId:'ref-1',refundAmount:550,cumulativeRefundAmount:550,paidAmount:550});
  await command(store,'payment',{orderId:'order-1',eventId:'pay-event',eventHash:'pay-hash',checkoutId:'ch_test',providerOrderId:'ord_test',productId:'prod_test',amount:500,currency:'USD',paidAmount:550,taxAmount:50,discountAmount:0,units:100*U});
  assert.equal((await command(store,'account')).availableUnits,0);
  await command(store,'dispute',{orderId:'order-1',eventId:'dispute-event',eventHash:'d'});
  assert.equal((await command(store,'account')).frozen,true);
});
test('durable isolated reference survives restart and refuses live production use',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'billing-reference-'));
  try{await funded(createBillingMemoryStore({dataDir}));assert.equal((await command(createBillingMemoryStore({dataDir}),'account')).availableUnits,10*U);}
  finally{await rm(dataDir,{recursive:true,force:true});}
  assert.throws(()=>createBillingService({enabled:true,mode:'live',store:createBillingMemoryStore(),creem:{ready:true}}),{code:'durable_store_required'});
});
test('result_saved recovery settles without supplier replay and entries omit source text',async()=>{
  const {store,service}=await fixture();await funded(store);const q=await service.quote({ownerId,action:'translation',scope});
  const op=await command(store,'reserve',{quoteId:q.id,scopeHash:q.scopeHash,operationId:'recover-op',idempotencyKey:'recover'});
  await command(store,'running',{operationId:op.id,reservationToken:op.reservationToken});
  await command(store,'result',{operationId:op.id,reservationToken:op.reservationToken,receipt:{ownerId,...scope,resultId:'saved'}});
  let calls=0;const replay=await service.run({ownerId,quoteId:q.id,idempotencyKey:'recover',scope,execute:async()=>{calls++;}});
  assert.equal(replay.status,'settled');assert.equal(calls,0);
  assert.equal(JSON.stringify(await service.entries({ownerId})).includes('sourceVersion'),false);
});
test('two service instances sharing a store dispatch one operation at most once',async()=>{
  const f=await fixture();await funded(f.store);const other=createBillingService({store:f.store,creem:f.creem,enabled:true,clock:()=>Date.parse('2026-10-21T00:00:00Z')});
  const q=await f.service.quote({ownerId,action:'translation',scope});let calls=0;
  const request={ownerId,quoteId:q.id,idempotencyKey:'shared',scope,execute:async({operationId})=>{calls++;await Promise.resolve();return {receipt:{ownerId,...scope,resultId:operationId}};}};
  await Promise.all([f.service.run(request),other.run(request)]);assert.equal(calls,1);
});
test('GET account does not mint trial and disabled catalog needs no store',async()=>{
  assert.equal((await createBillingService().catalog()).available,false);
  const f=await fixture();assert.equal((await f.service.account({ownerId,verified:true})).availableUnits,0);
  await assert.rejects(async()=>f.service.trial({ownerId,verified:false}),{code:'verified_account_required'});
  assert.equal((await f.service.trial({ownerId,verified:true})).availableUnits,10*U);
  assert.equal((await f.service.trial({ownerId,verified:true})).availableUnits,10*U);
});
test('completion recovery preserves result without supplier rerun and publication is acknowledged',async()=>{
  const f=await fixture();await funded(f.store);const q=await f.service.quote({ownerId,action:'translation',scope});
  const op=await command(f.store,'reserve',{quoteId:q.id,operationId:'crash-after-save',idempotencyKey:'crash-after-save',scopeHash:q.scopeHash});
  await command(f.store,'running',{operationId:op.id,reservationToken:op.reservationToken});
  const completed=await f.service.complete({ownerId,operationId:op.id,receipt:{ownerId,...scope,resultId:'already-saved'}});
  assert.equal(completed.status,'settled');await f.service.ackPublished({ownerId,operationId:op.id});
  assert.equal((await f.service.recover({ownerId})).operations.length,0);
});
test('finite campaign budget prevents multiple-account trial exhaustion',async()=>{
  const f=await fixture();const service=createBillingService({store:f.store,creem:f.creem,enabled:true,trialBudgetUnits:10*U});
  await service.trial({ownerId,verified:true});await assert.rejects(service.trial({ownerId:'second-account',verified:true}),{code:'trial_budget_exhausted'});
  assert.equal((await service.account({ownerId:'second-account'})).availableUnits,0);
});
test('unknown checkout response is not blindly retried after restart',async()=>{
  const f=await fixture();let calls=0;f.creem.createCheckout=async()=>{calls++;throw new Error('network timeout');};
  await assert.rejects(f.service.checkout({ownerId,intentKey:'unknown'}));
  await assert.rejects(f.service.checkout({ownerId,intentKey:'unknown'}),{code:'checkout_reconciliation_required'});
  assert.equal(calls,1);
});
function paymentPayload(order,overrides={}){return {id:'evt-payment',eventType:'checkout.completed',object:{id:'ch_test',request_id:order.id,mode:'test',status:'completed',units:1,metadata:{ownerId,orderId:order.id},product:{id:'prod_test',billing_type:'one-time'},order:{id:'ord_test',product:'prod_test',amount:500,currency:'USD',amount_paid:550,tax_amount:50,discount_amount:0,status:'paid',mode:'test'},...overrides}};}
function signed(service,payload){const rawBody=Buffer.from(JSON.stringify(payload));const signature=createHmac('sha256','test-secret').update(rawBody).digest('hex');return service.webhook({rawBody,signature});}
async function webhookFixture(reviewIds='',productEnv={CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly'}){
  const f=await fixture();let providerFacts;const creem=createCreem({env:{CREEM_MODE:'test',CREEM_API_KEY:'test-key',CREEM_WEBHOOK_SECRET:'test-secret',...productEnv,CREEM_REVIEW_DISCOUNT_IDS:reviewIds},fetcher:async(url,init)=>({ok:true,json:async()=>url.includes('/v1/products/')?{id:'prod_test',mode:'test',price:500,currency:'USD',billing_type:'onetime',status:'active',tax_mode:'exclusive'}:init.method==='POST'?({id:'ch_test',checkout_url:'https://checkout.creem.io/ch_test'}):providerFacts})});
  const service=createBillingService({store:f.store,creem,enabled:true,publicOrigin:'https://leafhour.example',clock:()=>Date.parse('2026-10-21T00:00:00Z')});
  // This order predates subscription-only sales; fulfillment must use its immutable snapshot.
  const order=await command(f.store,'order',{id:'legacy-webhook-order',intentKey:'webhook-buy',productKey:'reading_100',productId:'prod_test',amount:500,currency:'USD',units:100*U});await command(f.store,'checkout',{orderId:order.id,checkoutId:'ch_test',checkoutUrl:'https://checkout.creem.io/ch_test'});providerFacts=paymentPayload(order).object;return {...f,creem,service,order,setProviderFacts:facts=>providerFacts=facts};
}
test('verified webhook fulfills once and rejects arbitrary metadata, mode, product and amount',async()=>{
  const f=await webhookFixture(),payload=paymentPayload(f.order);await signed(f.service,payload);await signed(f.service,payload);
  assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
  for(const patch of [{mode:'live'},{product:{id:'prod_foreign'}},{metadata:{ownerId:'foreign',orderId:f.order.id}},{order:{...payload.object.order,amount_paid:500}}]){
    f.setProviderFacts({...payload.object,...patch});
    await assert.rejects(signed(f.service,paymentPayload(f.order,patch)));assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
  }
});
test('documented minimal payment webhook retrieves authoritative financial fields before validation',async()=>{
 const f=await webhookFixture(),payload=paymentPayload(f.order);delete payload.object.order.amount_paid;delete payload.object.order.tax_amount;delete payload.object.order.discount_amount;
 await signed(f.service,payload);assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
});
test('only an explicitly whitelisted full review discount grants zero-sale review credits',async()=>{
  const f=await webhookFixture('dis_review'),payload=paymentPayload(f.order);payload.object.order={...payload.object.order,discount:'dis_review',discount_amount:500,amount_paid:0,tax_amount:0};
  f.setProviderFacts(payload.object);await signed(f.service,payload);const order=await f.service.order({ownerId,orderId:f.order.id});assert.equal(order.paidAmount,0);
  const entries=await f.service.entries({ownerId});assert.equal(entries.entries.find(e=>e.type==='grant').source,'review');
  const rejected=await webhookFixture(),rejectedPayload=paymentPayload(rejected.order,{order:payload.object.order});rejected.setProviderFacts(rejectedPayload.object);await assert.rejects(signed(rejected.service,rejectedPayload),{code:'payment_amount_unverified'});
});
test('signed webhook recovers checkout binding after an unknown create response',async()=>{
  const f=await webhookFixture();await command(f.store,'order',{id:'unknown-order',intentKey:'unknown-order',productKey:'reading_100',productId:'prod_test',amount:500,currency:'USD',units:100*U});
  const payload=paymentPayload({id:'unknown-order'},{id:'ch_recovered',order:{...paymentPayload(f.order).object.order,id:'ord_recovered'}});f.setProviderFacts(payload.object);await signed(f.service,payload);
  assert.equal((await f.service.order({ownerId,orderId:'unknown-order'})).paymentVerified,true);
});
test('refund removes held lot, prevents late result, and spent exposure freezes new work',async()=>{
  const f=await fixture();await paid(f.store);const q=await f.service.quote({ownerId,action:'conversation',scope});
  const op=await command(f.store,'reserve',{quoteId:q.id,operationId:'refund-held',idempotencyKey:'refund-held',scopeHash:q.scopeHash});
  await command(f.store,'refund',{orderId:'order-1',eventId:'r',eventHash:'rh',refundId:'ref',refundAmount:550,cumulativeRefundAmount:550,paidAmount:550});
  assert.equal((await f.service.operation({ownerId,operationId:op.id})).status,'released');
  assert.equal((await f.service.account({ownerId})).availableUnits,0);
  await assert.rejects(command(f.store,'result',{operationId:op.id,reservationToken:op.reservationToken,receipt:{ownerId,...scope,resultId:'late'}}),{code:'stale_worker'});
  const spent=await fixture();await paid(spent.store);const qs=await spent.service.quote({ownerId,action:'conversation',scope});
  await spent.service.run({ownerId,quoteId:qs.id,idempotencyKey:'spent',scope,execute:async()=>({receipt:{ownerId,...scope,resultId:'persisted'}})});
  await command(spent.store,'refund',{orderId:'order-1',eventId:'r',eventHash:'rh',refundId:'ref',refundAmount:550,cumulativeRefundAmount:550,paidAmount:550});
  assert.equal((await spent.service.account({ownerId})).frozen,true);assert.equal((await spent.service.account({ownerId})).availableUnits,0);
});
test('receipt cannot cross owner/source or contain raw text in the ledger',async()=>{
  const f=await fixture();await funded(f.store);const q=await f.service.quote({ownerId,action:'translation',scope});
  await assert.rejects(f.service.run({ownerId,quoteId:q.id,idempotencyKey:'foreign-result',scope,execute:async()=>({receipt:{ownerId:'foreign',...scope,resultId:'x'}})}),{code:'invalid_receipt'});
  const q2=await f.service.quote({ownerId,action:'translation',scope});const op=await f.service.run({ownerId,quoteId:q2.id,idempotencyKey:'good-result',scope,execute:async()=>({receipt:{ownerId,...scope,resultId:'safe',text:'PRIVATE CONTENT'}})});
  assert.equal(JSON.stringify(op).includes('PRIVATE CONTENT'),false);
});
test('durable result remains reserved when recording its receipt temporarily fails',async()=>{
  const f=await fixture();await funded(f.store);const q=await f.service.quote({ownerId,action:'translation',scope});let failed=false;
  const unreliable={...f.store,command:async(action,p)=>{if(action==='result'&&!failed){failed=true;throw Object.assign(new Error('database unavailable'),{status:503});}return f.store.command(action,p);}};
  const service=createBillingService({store:unreliable,creem:f.creem,enabled:true,clock:()=>Date.parse('2026-10-21T00:00:00Z')});
  await assert.rejects(service.run({ownerId,quoteId:q.id,operationId:'persisted-before-db-failure',idempotencyKey:'persisted-before-db-failure',scope,execute:async()=>({receipt:{ownerId,...scope,resultId:'saved-result'}})}));
  assert.equal((await service.account({ownerId})).reservedUnits,U);
  assert.equal((await service.complete({ownerId,operationId:'persisted-before-db-failure',receipt:{ownerId,...scope,resultId:'saved-result'}})).status,'settled');
});
test('summary uses half-open payment/refund event windows and reports unknown costs',async()=>{
  const f=await fixture();await paid(f.store);f.advance(86400000);
  await command(f.store,'refund',{orderId:'order-1',eventId:'next-day-refund',eventHash:'next-day-refund-hash',refundId:'ref-next-day',refundAmount:275,cumulativeRefundAmount:275,paidAmount:550});
  await command(f.store,'providerCall',{id:'attempt-1',feature:'conversation',funding:'credits',provider:'dsh',model:'model',status:'failed',usage:null,costStatus:'unknown',startedAt:'2026-10-22T01:00:00.000Z'});
  const first=await f.store.command('summary',{mode,from:'2026-10-21T00:00:00Z',to:'2026-10-22T00:00:00Z'}),second=await f.store.command('summary',{mode,from:'2026-10-22T00:00:00Z',to:'2026-10-23T00:00:00Z'});
  assert.equal(first.salesByCurrency.USD,500);assert.equal(first.refundsByCurrency.USD||0,0);assert.equal(second.refundsByCurrency.USD,275);assert.equal(second.paidOrders,0);assert.equal(second.unknownCostCalls,1);
  assert.equal(JSON.stringify(second).includes(ownerId),false);
});
test('late payment rechecks supplier refund facts before granting credits',async()=>{
  const f=await webhookFixture(),payload=paymentPayload(f.order);
  f.setProviderFacts({...payload.object,order:{...payload.object.order,status:'refunded',refunded_amount:550}});
  await signed(f.service,payload);assert.equal((await f.service.account({ownerId})).availableUnits,0);
  assert.equal((await f.service.order({ownerId,orderId:f.order.id})).status,'refunded');
});
test('provider receipt retains the actual pricing reference and discards unrelated private text',async()=>{
 const f=await fixture();await command(f.store,'providerCall',{id:'priced-call',feature:'translation',funding:'credits',provider:'dsh',model:'deepseek-v4-flash',status:'completed',usage:{inputTokens:1,outputTokens:1,cacheReadTokens:0,cacheWriteTokens:0},costMicrousd:1,costStatus:'reported_usage_rated',pricingVersion:'2026-10-21-verified',startedAt:'2026-10-21T00:00:00Z',prompt:'PRIVATE'});
 const receipt=await command(f.store,'providerCall',{id:'priced-call',feature:'translation',funding:'credits',provider:'dsh',model:'deepseek-v4-flash',status:'completed',usage:{inputTokens:1,outputTokens:1,cacheReadTokens:0,cacheWriteTokens:0},costMicrousd:1,costStatus:'reported_usage_rated',pricingVersion:'2026-10-21-verified',startedAt:'2026-10-21T00:00:00Z'});
 assert.equal(receipt.pricingVersion,'2026-10-21-verified');assert.equal(JSON.stringify(receipt).includes('PRIVATE'),false);
});
test('reserved-only orphan release cannot race a worker that already claimed running',async()=>{
 const f=await fixture();await funded(f.store);const q=await f.service.quote({ownerId,action:'translation',scope});
 const op=await command(f.store,'reserve',{quoteId:q.id,operationId:'release-race',idempotencyKey:'release-race',scopeHash:q.scopeHash});await command(f.store,'running',{operationId:op.id,reservationToken:op.reservationToken});
 const unchanged=await command(f.store,'release',{operationId:op.id,reservationToken:op.reservationToken,reason:'cancelled',expectedStatus:'reserved'});
 assert.equal(unchanged.status,'running');assert.equal((await f.service.account({ownerId})).reservedUnits,U);
});
test('summary separates funding, feature and credit origins without invented fees',async()=>{
 const f=await fixture();await funded(f.store);await paid(f.store);const q=await f.service.quote({ownerId,action:'conversation',scope});
 await f.service.run({ownerId,quoteId:q.id,idempotencyKey:'stats-operation',scope,execute:async()=>({receipt:{ownerId,...scope,resultId:'stats-result'}})});
 for(const [id,funding,feature,cost,costStatus]of [['paid-call','credits','conversation',3,'reported_usage_rated'],['sponsor-call','sponsor','companion',null,'unknown']])await command(f.store,'providerCall',{id,feature,funding,provider:'dsh',model:'model',status:'completed',costMicrousd:cost,costStatus,startedAt:'2026-10-21T00:00:00Z'});
 const summary=await f.store.command('summary',{mode,from:'2026-10-21T00:00:00Z',to:'2026-10-22T00:00:00Z'});
 assert.deepEqual(summary.callsByFunding.credits,{calls:1,knownCostMicrousd:3,unknownCostCalls:0});assert.equal(summary.callsByFeature.companion.unknownCostCalls,1);
 assert.equal(summary.grantedUnitsBySource.trial,10*U);assert.equal(summary.grantedUnitsBySource.purchase,100*U);assert.equal(summary.consumedUnitsBySource.trial,4*U);assert.equal(summary.consumedUnitsBySource.purchase,0);
 assert.equal(summary.operationCounts.settled,1);assert.equal(summary.trialGrants,1);assert.equal(summary.paymentFeesStatus,'unknown');assert.equal(summary.costCoverage,.5);
});
test('undeliverable reversal after full refund reverses consumption without reviving credits',async()=>{
 const f=await fixture();await paid(f.store);const q=await f.service.quote({ownerId,action:'conversation',scope});
 const op=await f.service.run({ownerId,quoteId:q.id,idempotencyKey:'refund-reversal',scope,execute:async()=>({receipt:{ownerId,...scope,resultId:'undeliverable'}})});
 await command(f.store,'refund',{orderId:'order-1',eventId:'refund-reversal-event',eventHash:'refund-reversal-hash',refundId:'refund-reversal',refundAmount:550,cumulativeRefundAmount:550,paidAmount:550});
 await f.service.reverse({ownerId,operationId:op.id});const account=await f.service.account({ownerId});assert.equal(account.availableUnits,0);assert.equal(account.consumedUnits,0);
 const entries=await f.service.entries({ownerId}),reverse=entries.entries.find(e=>e.type==='reverse');assert.equal(reverse.units,4*U);assert.equal(reverse.restoredUnits,0);assert.equal((await f.service.order({ownerId,orderId:'order-1'})).exposureUnits,0);
});
test('quote retry preserves immutable source and expiry rather than replacing its creation time',async()=>{
 const f=await fixture(),q=await f.service.quote({ownerId,action:'translation',scope});f.advance(1000);
 const retry=await command(f.store,'quote',{...q,now:'2026-10-21T00:00:01.000Z'});assert.deepEqual(retry,q);
});
test('repeated order polling accepts paid to partial and full refund snapshots monotonically',async()=>{
 const f=await webhookFixture(),paidFacts=paymentPayload(f.order).object;
 for(const [status,refundedAmount,availableUnits]of [['paid',0,100*U],['partially_refunded',275,50*U],['refunded',550,0]]){
  f.setProviderFacts({...paidFacts,order:{...paidFacts.order,status,refunded_amount:refundedAmount}});
  for(let n=0;n<3;n++){
   const order=await f.service.order({ownerId,orderId:f.order.id,reconcile:true});assert.equal(order.status,status==='partially_refunded'?'partially_refunded':status);
   assert.equal((await f.service.account({ownerId})).availableUnits,availableUnits);
  }
 }
 // Even a stale supplier snapshot cannot override a previously verified refund.
 f.setProviderFacts(paidFacts);assert.equal((await f.service.order({ownerId,orderId:f.order.id,reconcile:true})).status,'refunded');
 assert.equal((await f.service.account({ownerId})).availableUnits,0);
 const entries=await f.service.entries({ownerId});assert.equal(entries.entries.filter(e=>e.type==='grant').length,1);assert.equal(entries.entries.filter(e=>e.type==='refund_cash').reduce((n,e)=>n+e.amount,0),550);
});

test('configured supplier product is verified before any checkout can charge money',async()=>{
 for(const patch of [{price:1000},{currency:'EUR'},{billing_type:'onetime'},{status:'archived'},{tax_mode:'inclusive'},{mode:'prod'},{id:'prod_other'}]){
  const f=await fixture();f.creem.retrieveProduct=async()=>({id:'prod_test',mode:'test',price:500,currency:'USD',billing_type:'recurring',billing_period:'every-month',status:'active',tax_mode:'exclusive',...patch});
  assert.equal((await f.service.catalog()).available,false);
  await assert.rejects(f.service.checkout({ownerId,intentKey:'wrong-product'}),e=>e.status===503);assert.equal(f.creations,0);
 }
 const f=await fixture();let reads=0;f.creem.retrieveProduct=async()=>{reads++;return {id:'prod_test',mode:'sandbox',price:500,currency:'USD',billing_type:'recurring',billing_period:'every-month',status:'active',tax_mode:'exclusive'};};
 assert.equal((await f.service.catalog()).available,true);await f.service.catalog();assert.equal(reads,1,'public readiness caches verified facts');
 await f.service.checkout({ownerId,intentKey:'verified-product'});assert.equal(f.creations,1);assert.equal(reads,2,'checkout revalidates current supplier facts');
});

test('saved one-time payments reconcile and refund after sale product configuration is removed',async()=>{
 const f=await webhookFixture('',{}),payload=paymentPayload(f.order);
 await signed(f.service,payload);assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
 f.setProviderFacts({...payload.object,order:{...payload.object.order,status:'partially_refunded',refunded_amount:275}});
 await f.service.order({ownerId,orderId:f.order.id,reconcile:true});assert.equal((await f.service.account({ownerId})).availableUnits,50*U);
 const refund={id:'evt_legacy_refund',eventType:'refund.created',object:{id:'ref_legacy',mode:'test',status:'succeeded',refund_amount:275,checkout:payload.object,transaction:{order:'ord_test',amount_paid:550,refunded_amount:550,currency:'USD'}}};
 await signed(f.service,refund);await signed(f.service,refund);assert.equal((await f.service.account({ownerId})).availableUnits,0);assert.equal((await f.service.order({ownerId,orderId:f.order.id})).status,'refunded');
 f.setProviderFacts(payload.object);await signed(f.service,payload);assert.equal((await f.service.account({ownerId})).availableUnits,0);
});
test('legacy fulfillment still rejects foreign products, accounts, modes and altered signatures without product environment configuration',async()=>{
 for(const [patch,code] of [[{product:{id:'prod_foreign',billing_type:'onetime'}},'payment_mismatch'],[{metadata:{ownerId:'foreign-owner',orderId:'legacy-webhook-order'}},'payment_binding_mismatch'],[{mode:'prod'},'payment_environment_mismatch']]){
  const f=await webhookFixture('',{}),payload=paymentPayload(f.order,patch);f.setProviderFacts(payload.object);await assert.rejects(signed(f.service,payload),{code});assert.equal((await f.service.account({ownerId})).availableUnits,0);
 }
 const f=await webhookFixture('',{}),rawBody=Buffer.from(JSON.stringify(paymentPayload(f.order)));await assert.rejects(f.service.webhook({rawBody,signature:'0'.repeat(64)}),{code:'invalid_signature'});assert.equal((await f.service.account({ownerId})).availableUnits,0);
});
test('a signed legacy refund cannot target a different saved product',async()=>{
 const f=await webhookFixture('',{}),payload=paymentPayload(f.order);await signed(f.service,payload);
 const refund={id:'evt_foreign_product_refund',eventType:'refund.created',object:{id:'ref_foreign',mode:'test',status:'succeeded',refund_amount:550,checkout:{...payload.object,product:{id:'prod_foreign'}},transaction:{order:'ord_test',amount_paid:550,refunded_amount:550,currency:'USD'}}};
 await assert.rejects(signed(f.service,refund),{code:'payment_mismatch'});assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
});

test('legacy order views omit payment URLs without changing the saved order or its signed payment rights',async()=>{
 const f=await webhookFixture('',{}),raw=await command(f.store,'getOrder',{orderId:f.order.id}),{checkoutUrl,...expected}=raw;
 assert.equal(checkoutUrl,'https://checkout.creem.io/ch_test');assert.equal(raw.status,'pending');
 f.setProviderFacts({...paymentPayload(f.order).object,status:'pending',order:null});
 assert.deepEqual(await f.service.order({ownerId,orderId:f.order.id}),expected);
 assert.deepEqual(await f.service.order({ownerId,orderId:f.order.id,reconcile:true}),expected);
 const orders=await f.service.orders({ownerId});assert.deepEqual(orders.orders,[expected]);
 assert.deepEqual(await command(f.store,'getOrder',{orderId:f.order.id}),raw,'view filtering must not rewrite the persisted order');
 const payload=paymentPayload(f.order);f.setProviderFacts(payload.object);await signed(f.service,payload);
 const paid=await f.service.order({ownerId,orderId:f.order.id});assert.equal(paid.status,'paid');assert.equal(paid.paymentVerified,true);assert.equal(paid.checkoutUrl,undefined);assert.equal(paid.checkoutId,raw.checkoutId);
 assert.equal((await f.service.order({ownerId,orderId:f.order.id,reconcile:true})).checkoutUrl,undefined);
 assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
 assert.equal((await command(f.store,'getOrder',{orderId:f.order.id})).checkoutUrl,checkoutUrl);
 assert.equal((await f.service.orders({ownerId})).orders[0].checkoutUrl,undefined);
});
test('monthly order views keep the saved checkout URL for the supported resume flow',async()=>{
 const f=await fixture(),{order,checkoutUrl}=await f.service.checkout({ownerId,intentKey:'resume-monthly'});
 assert.equal((await f.service.order({ownerId,orderId:order.id})).checkoutUrl,checkoutUrl);
 assert.equal((await f.service.orders({ownerId})).orders[0].checkoutUrl,checkoutUrl);
});
