import test from 'node:test';
import assert from 'node:assert/strict';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
import {createBillingPostgresStore} from '../deploy/billing-store.mjs';

const base={mode:'test',ownerId:'synthetic-sub-owner',now:'2026-10-21T00:00:00Z'};
const order={id:'monthly-initial',intentKey:'monthly-intent',productKey:'reading_monthly_100',productId:'monthly-product',amount:500,currency:'USD',units:100_000_000};
const binding={subscriptionId:'sub-1',customerId:'customer-1',orderId:order.id,productKey:order.productKey,productId:order.productId,status:'active',currentPeriodStart:'2026-10-21T00:00:00Z',currentPeriodEnd:'2026-11-21T00:00:00Z',supplierUpdatedAt:'2026-10-21T00:00:01Z'};
const paid={subscriptionId:'sub-1',customerId:'customer-1',transactionId:'transaction-1',providerOrderId:'provider-order-1',orderId:order.id,periodStart:binding.currentPeriodStart,periodEnd:binding.currentPeriodEnd,amount:500,paidAmount:500,taxAmount:0,discountAmount:0,currency:'USD',units:order.units,eventId:'paid-1',eventHash:'hash-1'};
async function setup(){const store=createBillingMemoryStore();await store.command('order',{...base,...order});await store.command('checkout',{...base,orderId:order.id,checkoutId:'checkout-initial'});await store.command('bindSubscription',{...base,...binding});return store;}
const run=(store,action,payload={})=>store.command(action,{...base,...payload});
const error=code=>e=>e.code===code;

test('initial checkout and subscription paid notifications share one ordinary purchase lot',async()=>{
  const store=await setup();
  const first=await run(store,'subscriptionPaid',paid);
  const duplicate=await run(store,'subscriptionPaid',{...paid,eventId:'paid-checkout',eventHash:'checkout-hash'});
  assert.equal(first.id,order.id);assert.equal(first.subscriptionId,'sub-1');assert.equal(first.transactionId,'transaction-1');
  assert.equal(duplicate.id,first.id);
  assert.equal((await run(store,'account')).availableUnits,order.units);
  assert.deepEqual((await run(store,'entries')).entries.filter(e=>e.type==='grant').map(e=>e.source),['purchase']);
  assert.equal((await run(store,'orders')).orders.length,1);
  assert.equal((await store.command('lookupSubscription',{mode:'test',subscriptionId:'sub-1'})).initialProviderOrderId,paid.providerOrderId);
});

test('every paid renewal creates a distinct refundable order and exact transaction/period dedupe',async()=>{
  const store=await setup();await run(store,'subscriptionPaid',paid);
  const renewal={...paid,orderId:undefined,transactionId:'transaction-2',providerOrderId:'provider-order-2',periodStart:'2026-11-21T00:00:00Z',periodEnd:'2026-12-21T00:00:00Z',eventId:'paid-2',eventHash:'hash-2'};
  const second=await run(store,'subscriptionPaid',renewal);
  assert.notEqual(second.id,order.id);assert.equal(second.productKey,order.productKey);
  assert.equal((await run(store,'subscriptionPaid',{...renewal,eventId:'paid-2-repeat',eventHash:'hash-2-repeat'})).id,second.id);
  assert.equal((await run(store,'account')).availableUnits,2*order.units);
  await assert.rejects(run(store,'subscriptionPaid',{...renewal,eventId:'conflict-period',eventHash:'conflict-period-hash',transactionId:'transaction-3',providerOrderId:'provider-order-3'}),error('payment_mismatch'));
  await assert.rejects(run(store,'subscriptionPaid',{...renewal,eventId:'conflict-money',eventHash:'conflict-money-hash',paidAmount:600,taxAmount:100}),error('payment_mismatch'));
  await run(store,'refund',{orderId:second.id,eventId:'refund-renewal',eventHash:'refund-hash',refundId:'refund-id',refundAmount:500,cumulativeRefundAmount:500,paidAmount:500});
  await run(store,'subscriptionPaid',{...renewal,eventId:'paid-after-refund',eventHash:'hash-after-refund'});
  assert.equal((await run(store,'account')).availableUnits,order.units);
  assert.equal((await store.command('lookupOrder',{mode:'test',providerOrderId:'provider-order-2'})).id,second.id);
});

test('refund and dispute supplier snapshots make late paid cycles tombstones atomically',async()=>{
  const store=await setup();
  const refunded=await run(store,'subscriptionPaid',{...paid,cumulativeRefundAmount:500});
  assert.equal(refunded.status,'refunded');assert.equal((await run(store,'account')).availableUnits,0);
  await run(store,'subscriptionPaid',{...paid,eventId:'late-refunded',eventHash:'late-refund'});
  assert.equal((await run(store,'account')).availableUnits,0);
  const renewal={...paid,orderId:undefined,transactionId:'transaction-disputed',providerOrderId:'provider-disputed',periodStart:'2026-11-21T00:00:00Z',periodEnd:'2026-12-21T00:00:00Z',eventId:'disputed-paid',eventHash:'disputed-hash',disputed:true};
  assert.equal((await run(store,'subscriptionPaid',renewal)).status,'disputed');
  const account=await run(store,'account');assert.equal(account.availableUnits,0);assert.equal(account.frozen,true);
});

test('exact paid-event replay reflects a newer authoritative refund snapshot',async()=>{
  const store=await setup();await run(store,'subscriptionPaid',paid);
  const result=await run(store,'subscriptionPaid',{...paid,cumulativeRefundAmount:500});
  assert.equal(result.status,'refunded');assert.equal((await run(store,'account')).availableUnits,0);
  const disputed=await run(store,'subscriptionPaid',{...paid,disputed:true});
  assert.equal(disputed.status,'disputed');
});

test('checkout binding makes the initial provider order discoverable before payment',async()=>{
  const store=createBillingMemoryStore();await run(store,'order',order);
  const bound=await run(store,'bindSubscription',{...binding,providerOrderId:paid.providerOrderId});
  assert.equal(bound.initialProviderOrderId,paid.providerOrderId);
  assert.equal((await store.command('lookupOrder',{mode:'test',providerOrderId:paid.providerOrderId})).id,order.id);
});

test('monthly signup serializes different intents and allows replacement only after cancellation',async()=>{
  const store=createBillingMemoryStore();
  const results=await Promise.allSettled([run(store,'order',order),run(store,'order',{...order,id:'second-monthly',intentKey:'different-intent'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'subscription_exists');
  await run(store,'bindSubscription',binding);
  await run(store,'subscriptionState',{...binding,status:'past_due',supplierUpdatedAt:'2026-10-22T00:00:00Z'});
  await assert.rejects(run(store,'order',{...order,id:'third-monthly',intentKey:'third-intent'}),error('subscription_exists'));
  await run(store,'subscriptionState',{...binding,status:'canceled',supplierUpdatedAt:'2026-10-23T00:00:00Z'});
  assert.equal((await run(store,'order',{...order,id:'replacement-monthly',intentKey:'replacement-intent'})).id,'replacement-monthly');
  assert.equal((await run(store,'order',{...order,id:'top-up',intentKey:'top-up',productKey:'reading_100'})).id,'top-up');
});

test('verified checkout expiry is idempotent and frees a monthly account for a fresh intent',async()=>{
  const store=createBillingMemoryStore();await run(store,'order',order);
  await run(store,'checkout',{orderId:order.id,checkoutId:'expired-checkout'});
  const payload={orderId:order.id,checkoutId:'expired-checkout'};
  const expired=await run(store,'expireCheckout',payload);
  assert.equal(expired.status,'expired');assert.equal(expired.paymentVerified,false);
  assert.equal((await run(store,'expireCheckout',payload)).status,'expired');
  assert.equal((await run(store,'order',{...order,id:'fresh-monthly',intentKey:'fresh-intent'})).status,'pending');
  assert.equal((await run(store,'account')).availableUnits,0);
});

test('checkout expiry refuses wrong identity, unknown checkout, subscription binding and actual payment',async()=>{
  const store=createBillingMemoryStore();await run(store,'order',order);
  const payload={orderId:order.id,checkoutId:'expire-me'};
  await assert.rejects(run(store,'expireCheckout',payload),error('invalid_state'));
  await assert.rejects(run(store,'order',{...order,id:'unknown-checkout-second',intentKey:'unknown-second-intent'}),error('subscription_exists'));
  await run(store,'checkout',payload);
  await assert.rejects(run(store,'expireCheckout',{...payload,checkoutId:'foreign-checkout'}),error('payment_mismatch'));
  await assert.rejects(run(store,'expireCheckout',{...payload,ownerId:'foreign-owner'}),error('not_found'));
  await assert.rejects(run(store,'expireCheckout',{...payload,mode:'live'}),error('not_found'));
  await run(store,'bindSubscription',binding);
  await assert.rejects(run(store,'expireCheckout',payload),error('invalid_state'));
  await run(store,'subscriptionPaid',paid);
  await assert.rejects(run(store,'expireCheckout',payload),error('invalid_state'));
  assert.equal((await run(store,'getOrder',{orderId:order.id})).status,'paid');
});

test('an actual paid order without a subscription cannot be expired or lose its credits',async()=>{
  const store=createBillingMemoryStore();await run(store,'order',{...order,productKey:'reading_100'});
  await run(store,'checkout',{orderId:order.id,checkoutId:'paid-topup-checkout'});
  await run(store,'payment',{...paid,orderId:order.id,checkoutId:'paid-topup-checkout',productId:order.productId});
  await assert.rejects(run(store,'expireCheckout',{orderId:order.id,checkoutId:'paid-topup-checkout'}),error('invalid_state'));
  assert.equal((await run(store,'getOrder',{orderId:order.id})).status,'paid');
  assert.equal((await run(store,'account')).availableUnits,order.units);
});

test('expired subscriptions retain the signup lock while payment retries can reactivate them',async()=>{
  const store=await setup();
  await run(store,'subscriptionState',{...binding,status:'expired',supplierUpdatedAt:'2026-10-23T00:00:00Z'});
  await assert.rejects(run(store,'order',{...order,id:'during-expiry',intentKey:'during-expiry'}),error('subscription_exists'));
  const resumed=await run(store,'subscriptionState',{...binding,status:'active',supplierUpdatedAt:'2026-10-24T00:00:00Z'});
  assert.equal(resumed.status,'active');
  await run(store,'subscriptionState',{...binding,status:'canceled',supplierUpdatedAt:'2026-10-25T00:00:00Z'});
  await run(store,'order',{...order,id:'after-expiry',intentKey:'after-expiry'});
  await run(store,'bindSubscription',{...binding,subscriptionId:'after-expiry-sub',orderId:'after-expiry',supplierUpdatedAt:'2026-10-26T00:00:00Z'});
  await assert.rejects(run(store,'subscriptionState',{...binding,status:'active',supplierUpdatedAt:'2026-10-27T00:00:00Z'}),error('subscription_exists'));
  const stale=await run(store,'subscriptionState',{...binding,status:'active',supplierUpdatedAt:'2026-10-22T00:00:00Z'});
  assert.equal(stale.status,'canceled');
});

test('subscription identity and transaction identity remain bound to account and environment',async()=>{
  const store=await setup();await run(store,'subscriptionPaid',paid);
  await store.command('order',{...base,ownerId:'other-synthetic-owner',...order,id:'other-order'});
  await assert.rejects(store.command('bindSubscription',{...base,...binding,ownerId:'other-synthetic-owner',orderId:'other-order'}),error('owner_mismatch'));
  await assert.rejects(run(store,'subscriptionPaid',{...paid,ownerId:'other-synthetic-owner'}),error('owner_mismatch'));
  assert.deepEqual(await run(store,'subscriptions',{ownerId:'other-synthetic-owner'}),{subscriptions:[]});
  assert.equal(await store.command('lookupSubscription',{mode:'live',subscriptionId:'sub-1'}),null);
  assert.equal((await store.command('lookupSubscription',{mode:'test',subscriptionId:'sub-1'})).initialOrderId,order.id);
});

test('supplier snapshots cannot regress lifecycle state and state-only events never mint points',async()=>{
  const store=await setup();
  await run(store,'subscriptionState',{...binding,status:'scheduled_cancel',supplierUpdatedAt:'2026-10-23T00:00:00Z'});
  const stale=await run(store,'subscriptionState',{...binding,status:'active',supplierUpdatedAt:'2026-10-22T00:00:00Z'});
  assert.equal(stale.status,'scheduled_cancel');
  await assert.rejects(run(store,'subscriptionState',{...binding,status:'paused',supplierUpdatedAt:'2026-10-23T00:00:00Z'}),error('idempotency_conflict'));
  assert.equal((await run(store,'account')).availableUnits,0);
  await assert.rejects(run(store,'subscriptionPaid',{...paid,periodEnd:paid.periodStart}),error('invalid_input'));
  await assert.rejects(run(store,'subscriptionPaid',{...paid,paidAmount:0,discountAmount:500}),error('payment_mismatch'));
});

test('a replaced canceled subscription cannot reactivate alongside its replacement',async()=>{
  const store=await setup();
  await run(store,'subscriptionState',{...binding,status:'canceled',supplierUpdatedAt:'2026-10-23T00:00:00Z'});
  await run(store,'order',{...order,id:'replacement',intentKey:'replacement-intent'});
  await run(store,'bindSubscription',{...binding,subscriptionId:'replacement-sub',orderId:'replacement',supplierUpdatedAt:'2026-10-24T00:00:00Z'});
  await assert.rejects(run(store,'subscriptionState',{...binding,status:'active',supplierUpdatedAt:'2026-10-25T00:00:00Z'}),error('subscription_exists'));
  assert.equal((await run(store,'subscriptions')).subscriptions.filter(s=>s.status==='active').length,1);
});

test('transaction identities and webhook hashes cannot be reassigned or mutate earlier grants',async()=>{
  const store=await setup();await run(store,'subscriptionPaid',paid);
  await store.command('order',{...base,ownerId:'other-owner',...order,id:'other-initial'});
  await run(store,'bindSubscription',{...binding,ownerId:'other-owner',subscriptionId:'other-sub',customerId:'other-customer',orderId:'other-initial'});
  await assert.rejects(run(store,'subscriptionPaid',{...paid,ownerId:'other-owner',subscriptionId:'other-sub',customerId:'other-customer',orderId:'other-initial',eventId:'other-event',eventHash:'other-hash'}),error('payment_mismatch'));
  await assert.rejects(run(store,'subscriptionPaid',{...paid,eventHash:'mutated-hash',cumulativeRefundAmount:500}),error('event_conflict'));
  assert.equal((await run(store,'account')).availableUnits,order.units);
  assert.equal((await run(store,'account',{ownerId:'other-owner'})).availableUnits,0);
});

test('reference readiness and sales summaries distinguish subscription cycles from topups',async()=>{
  const store=await setup();await run(store,'subscriptionPaid',paid);
  assert.equal((await store.command('readiness',{mode:'test'})).schemaVersion,2);
  const summary=await store.command('summary',{mode:'test',from:'2026-10-01T00:00:00Z',to:'2026-12-01T00:00:00Z'});
  assert.equal(summary.monthlyPaidOrders,1);assert.equal(summary.oneTimePaidOrders,0);assert.equal(summary.activeSubscriptions,1);
  assert.equal(summary.paidOrders,1);assert.equal(summary.grantedUnitsBySource.purchase,order.units);
});

test('durable adapter accepts service-only subscription commands and checkout expiry and maps conflicts',async()=>{
  let sent;const store=createBillingPostgresStore({env:{SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'synthetic-service-key'},fetcher:async(_url,opts)=>{sent=JSON.parse(opts.body);return Response.json({});}});
  for(const action of ['bindSubscription','lookupSubscription','subscriptions','subscriptionState','subscriptionPaid','expireCheckout']){
    const payload={mode:'test',...(action==='lookupSubscription'?{}:{ownerId:base.ownerId}),subscriptionId:'sub-1'};
    await store.command(action,payload);assert.deepEqual(sent,{command_name:action,command_payload:payload});
  }
  await assert.rejects(store.command('subscriptions',{mode:'test'}),error('invalid_input'));
  const denied=createBillingPostgresStore({env:{SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'synthetic-key'},fetcher:async()=>Response.json({code:'P0001',message:'reader_billing:subscription_exists'},{status:409})});
  await assert.rejects(denied.command('order',{mode:'test',ownerId:base.ownerId}),e=>e.code==='subscription_exists'&&e.status===409);
});
