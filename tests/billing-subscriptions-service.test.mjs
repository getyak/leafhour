import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
import {createCreemClient} from '../server/creem.mjs';

const U=1_000_000,ownerId='synthetic-owner',secret='synthetic-secret',date='2026-10-21T00:00:00.000Z',end='2026-11-21T00:00:00.000Z',later='2026-12-21T00:00:00.000Z';
const product=(id,monthly=false)=>({id,mode:'sandbox',price:500,currency:'USD',billing_type:monthly?'recurring':'onetime',...(monthly?{billing_period:'every-month'}:{}),status:'active',tax_mode:'exclusive'});
const transaction=(id='tran_initial',patch={})=>({id,mode:'sandbox',object:'transaction',type:'invoice',status:'paid',amount:500,amount_paid:550,discount_amount:0,tax_amount:50,refunded_amount:0,currency:'USD',order:id==='tran_initial'?'ord_initial':'ord_'+id,subscription:'sub_synthetic',customer:'cust_synthetic',period_start:Date.parse(id==='tran_initial'?date:end),period_end:Date.parse(id==='tran_initial'?end:later),...patch});
async function fixture({products={},env={}}={}){
 const store=createBillingMemoryStore(),calls=[],transactions=new Map([['tran_initial',transaction()]]);let creations=0,localOrder;
 let subscription={id:'sub_synthetic',object:'subscription',mode:'sandbox',product:product('prod_monthly',true),customer:{id:'cust_synthetic',email:'PRIVATE-CUSTOMER'},status:'active',last_transaction_id:'tran_initial',current_period_start_date:date,current_period_end_date:end,updated_at:date};
 let checkout;
 const creem=createCreemClient({env:{CREEM_MODE:'test',CREEM_API_KEY:'synthetic-key',CREEM_WEBHOOK_SECRET:secret,CREEM_PRODUCT_READING_100:'prod_topup',CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly',...env},fetcher:async(url,init)=>{
  calls.push({url,method:init.method});const parsed=new URL(url);
  if(parsed.pathname.startsWith('/v1/products/')){const id=parsed.pathname.split('/').at(-1);return Response.json({...product(id,id==='prod_monthly'),...products[id]});}
  if(parsed.pathname==='/v1/checkouts'&&init.method==='POST'){creations++;const body=JSON.parse(init.body),checkoutId=creations===1?'ch_monthly':'ch_monthly_'+creations;localOrder=body.request_id;checkout={id:checkoutId,request_id:localOrder,mode:'sandbox',status:'completed',units:1,product:product(body.product_id,body.product_id==='prod_monthly'),customer:'cust_synthetic',metadata:body.metadata,subscription:{id:'sub_synthetic'},order:{id:'ord_initial',transaction:'tran_initial',status:'paid',product:body.product_id,currency:'USD',amount:500,amount_paid:550,tax_amount:50,discount_amount:0}};return Response.json({id:checkoutId,checkout_url:'https://checkout.creem.io/'+checkoutId});}
  if(parsed.pathname==='/v1/checkouts')return Response.json(checkout);
  if(parsed.pathname==='/v1/subscriptions')return Response.json(subscription);
  if(parsed.pathname==='/v1/transactions')return Response.json(transactions.get(parsed.searchParams.get('transaction_id'))||{});
  if(parsed.pathname==='/v1/customers/billing')return Response.json({customer_portal_link:'https://creem.io/my-orders/login/synthetic'});
  throw Error('Unexpected supplier request');
 }});
 const service=createBillingService({store,creem,enabled:true,clock:()=>Date.parse(date),publicOrigin:'https://leafhour.example'});
 const send=payload=>{const rawBody=Buffer.from(JSON.stringify(payload));return service.webhook({rawBody,signature:createHmac('sha256',secret).update(rawBody).digest('hex')});};
 const checkoutEvent=()=>({id:'evt_checkout',eventType:'checkout.completed',object:checkout});
 const paidEvent=(id='evt_paid',patch={})=>({id,eventType:'subscription.paid',object:{...subscription,...patch}});
 const buy=()=>service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'monthly-1'});
 const complete=async()=>{await buy();return send(checkoutEvent());};
 return {store,creem,service,calls,transactions,send,buy,complete,checkoutEvent,paidEvent,get creations(){return creations;},get localOrder(){return localOrder;},get subscription(){return subscription;},set subscription(value){subscription=value;},get checkout(){return checkout;}};
}
test('catalog product readiness is independent and the selected monthly product is revalidated before checkout',async()=>{
 const f=await fixture({products:{prod_monthly:{price:600}}}),catalog=await f.service.catalog();
 assert.equal(catalog.available,true);assert.equal(catalog.products.find(p=>p.key==='reading_100').available,true);assert.equal(catalog.products.find(p=>p.key==='reading_monthly_100')?.available,false);
 await assert.rejects(f.buy(),e=>e.status===503);assert.equal(f.creations,0);await f.service.checkout({ownerId,intentKey:'topup'});assert.equal(f.creations,1);
 const missing=await fixture({env:{CREEM_PRODUCT_READING_MONTHLY_100:undefined}});assert.equal((await missing.service.catalog()).products.find(p=>p.key==='reading_100').available,true);
 const valid=await fixture();await valid.service.catalog();await valid.buy();assert.equal(valid.calls.filter(c=>c.url.endsWith('/products/prod_monthly')).length,2);
});
test('checkout plus repeated signed paid events grant one initial purchase lot and one order',async()=>{
 const f=await fixture();await f.complete();await f.send(f.paidEvent());await f.send(f.paidEvent());
 assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
 const orders=await f.service.orders({ownerId});assert.equal(orders.orders.length,1);assert.equal(orders.orders[0].productKey,'reading_monthly_100');assert.equal(orders.orders[0].transactionId,'tran_initial');
 const subscriptions=await f.service.subscriptions({ownerId});assert.equal(subscriptions.subscriptions.length,1);assert.equal(subscriptions.subscriptions[0].id,'sub_synthetic');assert.equal(subscriptions.subscriptions[0].currentPeriodEnd,end);assert.doesNotMatch(JSON.stringify(subscriptions),/PRIVATE/);
 const entries=await f.service.entries({ownerId});assert.equal(entries.entries.filter(e=>e.type==='grant').length,1);assert.equal(entries.entries.find(e=>e.type==='grant').source,'purchase');
});
test('documented paid transaction with explicit null refund amount grants once while an omitted refund field stays unverified',async()=>{
 const f=await fixture();f.transactions.set('tran_initial',transaction('tran_initial',{refunded_amount:null}));
 await f.complete();await f.send(f.paidEvent());
 assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
 const unverified=await fixture();unverified.transactions.set('tran_initial',transaction('tran_initial',{refunded_amount:undefined}));
 await assert.rejects(unverified.complete(),{code:'payment_amount_unverified'});
 assert.equal((await unverified.service.account({ownerId})).availableUnits,0);
});
test('an out-of-order paid event retries binding and then resolves without an extra initial grant',async()=>{
 const f=await fixture();await f.buy();await assert.rejects(f.send(f.paidEvent()),{code:'payment_binding_pending',status:503});assert.equal((await f.service.account({ownerId})).availableUnits,0);
 await f.send(f.checkoutEvent());await f.send(f.paidEvent());assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
});
test('renewal events retrieve their original signed transaction even after the supplier snapshot advances',async()=>{
 const f=await fixture();await f.complete();const oldPaid=f.paidEvent('evt_renewal',{last_transaction_id:'tran_renewal',current_period_start_date:end,current_period_end_date:later});
 f.transactions.set('tran_renewal',transaction('tran_renewal'));
 f.subscription={...f.subscription,last_transaction_id:'tran_future',current_period_start_date:later,current_period_end_date:'2027-01-21T00:00:00.000Z',updated_at:later};
 await f.send(oldPaid);await f.send(oldPaid);assert.equal((await f.service.account({ownerId})).availableUnits,200*U);
 assert.equal(f.calls.some(c=>c.url.endsWith('transaction_id=tran_future')),false);assert.equal(f.calls.some(c=>c.url.endsWith('transaction_id=tran_renewal')),true);
 const orders=(await f.service.orders({ownerId})).orders;assert.equal(orders.length,2);assert.equal(orders.find(o=>o.transactionId==='tran_renewal').periodStart,end);
});
test('state changes and failed renewals do not mint points or remove delivered points',async()=>{
 const f=await fixture();await f.complete();
 for(const [status,type,index]of [['past_due','subscription.past_due',1],['unpaid','subscription.unpaid',2],['scheduled_cancel','subscription.scheduled_cancel',3],['canceled','subscription.canceled',4]]){
  f.subscription={...f.subscription,status,updated_at:new Date(Date.parse(date)+index*1000).toISOString()};await f.send({id:'evt_state_'+index,eventType:type,object:f.subscription});assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
 }
 assert.equal((await f.service.subscriptions({ownerId})).subscriptions[0].status,'canceled');
});
test('each successful paid cycle requires explicit financial facts and binding to its authenticated subscription',async()=>{
 const patches=[{amount_paid:undefined},{tax_amount:undefined},{discount_amount:undefined},{amount:499},{currency:'EUR'},{discount_amount:500,amount_paid:0,tax_amount:0},{mode:'prod'},{subscription:'sub_foreign'},{customer:'cust_foreign'},{status:'declined'},{order:undefined},{period_start:undefined},{period_end:Date.parse(end)},{refunded_amount:undefined},{status:'refunded',refunded_amount:275},{type:'payment'}];
 for(const patch of patches){const f=await fixture();await f.complete();f.transactions.set('tran_invalid',transaction('tran_invalid',patch));await assert.rejects(f.send(f.paidEvent('evt_invalid',{last_transaction_id:'tran_invalid'})),e=>[409,503].includes(e.status),JSON.stringify(patch));assert.equal((await f.service.account({ownerId})).availableUnits,100*U);}
});
test('paid reconciliation atomically respects supplier full refund or chargeback facts',async()=>{
 for(const [status,refunded,frozen]of [['refunded',550,false],['partialRefund',275,false],['chargedBack',550,true]]){
  const f=await fixture();f.transactions.set('tran_initial',transaction('tran_initial',{status,refunded_amount:refunded}));await f.complete();
  const account=await f.service.account({ownerId});assert.equal(account.availableUnits,status==='partialRefund'?50*U:0);assert.equal(account.frozen,frozen);
 }
});
test('portal customer identity comes only from an owner-bound subscription',async()=>{
 const f=await fixture();await f.complete();assert.deepEqual(await f.service.portal({ownerId,subscriptionId:'sub_synthetic'}),{portalUrl:'https://creem.io/my-orders/login/synthetic'});
 const before=f.calls.length;await assert.rejects(f.service.portal({ownerId:'foreign-owner',subscriptionId:'sub_synthetic'}),{status:404});assert.equal(f.calls.length,before);assert.deepEqual(await f.service.subscriptions({ownerId:'foreign-owner'}),{subscriptions:[]});
});
test('concurrent monthly intents across service instances cannot create two supplier subscriptions',async()=>{
 const f=await fixture(),other=createBillingService({store:f.store,creem:f.creem,enabled:true,clock:()=>Date.parse(date)});
 const result=await Promise.allSettled([f.buy(),other.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'another-intent'})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.creations,1);
});
test('renewal refunds target their transaction order even when checkout metadata still references the initial order',async()=>{
 const f=await fixture();await f.complete();f.transactions.set('tran_renewal',transaction('tran_renewal'));await f.send(f.paidEvent('evt_renewal',{last_transaction_id:'tran_renewal'}));
 const object={id:'ref_renewal',mode:'sandbox',status:'succeeded',refund_amount:275,checkout:f.checkout,subscription:{id:'sub_synthetic'},order:{id:'ord_tran_renewal',currency:'USD',amount_paid:550},transaction:{...transaction('tran_renewal'),refunded_amount:275}};
 await f.send({id:'evt_refund',eventType:'refund.created',object});assert.equal((await f.service.account({ownerId})).availableUnits,150*U);
 const orders=(await f.service.orders({ownerId})).orders;assert.equal(orders.find(o=>o.transactionId==='tran_initial').status,'paid');assert.equal(orders.find(o=>o.transactionId==='tran_renewal').status,'partially_refunded');
});
test('concurrent reuse of one intent for different products fails instead of returning the other product checkout',async()=>{
 const f=await fixture(),results=await Promise.allSettled([f.service.checkout({ownerId,intentKey:'shared-intent'}),f.service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'shared-intent'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'idempotency_conflict');assert.equal(f.creations,1);
});
test('live monthly configuration requires subscription schema readiness before either payment path opens',async()=>{
 const creem={ready:true,mode:'live',productId:'prod_topup',productIds:{reading_100:'prod_topup',reading_monthly_100:'prod_monthly'},retrieveProduct:async()=>({...product('prod_topup'),mode:'prod'})};
 const service=createBillingService({enabled:true,mode:'live',creem,store:{durable:true,kind:'postgres',command:async()=>({ready:true,durable:true,backend:'postgres',schemaVersion:1})}});
 assert.equal((await service.readiness()).reason,'billing_schema_outdated');assert.equal((await service.catalog()).available,false);await assert.rejects(service.checkout({ownerId,intentKey:'unsafe-schema'}),{status:503});
});
test('authenticated expiry releases the monthly lock only for a new explicit intent',async()=>{
 const f=await fixture(),{order}=await f.buy();Object.assign(f.checkout,{status:'expired',subscription:null,order:null});
 assert.equal((await f.service.order({ownerId,orderId:order.id,reconcile:true})).status,'expired');
 assert.equal((await f.service.order({ownerId,orderId:order.id,reconcile:true})).status,'expired');
 await assert.rejects(f.buy(),{code:'checkout_expired',status:409});
 const replacement=await f.service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'monthly-replacement'});assert.notEqual(replacement.order.id,order.id);assert.equal(f.creations,2);assert.equal((await f.service.account({ownerId})).availableUnits,0);
});
test('pending or processing supplier checkouts retain the existing monthly lock',async()=>{
 for(const status of ['pending','processing']){const f=await fixture(),{order}=await f.buy();Object.assign(f.checkout,{status,subscription:null,order:null});assert.equal((await f.service.order({ownerId,orderId:order.id,reconcile:true})).status,'pending');await assert.rejects(f.service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'another-intent'}),{code:'subscription_exists'});assert.equal(f.creations,1);}
});
test('expired snapshots must match checkout, account, product, request and environment without subscription or payment',async()=>{
 const patches=[{id:'ch_foreign'},{mode:'prod'},{product:'prod_foreign'},{request_id:'foreign-order'},{metadata:{ownerId:'foreign-owner'}},{metadata:{orderId:'foreign-order'}},{subscription:'sub_synthetic'},{order:{id:'ord_initial',status:'paid',amount_paid:0}},{order:{id:'ord_initial',status:'pending',amount_paid:1}},{order:{id:'ord_initial',status:'pending',amount_paid:0,transaction:'tran_initial'}},{transaction:'tran_initial'}];
 for(const patch of patches){const f=await fixture(),{order}=await f.buy();Object.assign(f.checkout,{status:'expired',subscription:null,order:null},patch);await assert.rejects(f.service.order({ownerId,orderId:order.id,reconcile:true}),e=>[409,503].includes(e.status),JSON.stringify(patch));assert.equal((await f.service.order({ownerId,orderId:order.id})).status,'pending');await assert.rejects(f.service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'another-intent'}),{code:'subscription_exists'});}
});
test('paid monthly orders cannot be expired and a foreign account cannot reconcile an order',async()=>{
 const f=await fixture();await f.complete();Object.assign(f.checkout,{status:'expired',subscription:null,order:null});await assert.rejects(f.service.order({ownerId,orderId:f.localOrder,reconcile:true}),{status:409});assert.equal((await f.service.order({ownerId,orderId:f.localOrder})).status,'paid');assert.equal((await f.service.account({ownerId})).availableUnits,100*U);
 const before=f.calls.length;assert.equal(await f.service.order({ownerId:'foreign-owner',orderId:f.localOrder,reconcile:true}),null);assert.equal(f.calls.length,before);
});
test('order reconciliation rejects a different completed checkout before applying its financial snapshot',async()=>{
 const f=await fixture(),{order}=await f.buy();f.checkout.id='ch_foreign';await assert.rejects(f.service.order({ownerId,orderId:order.id,reconcile:true}),{code:'payment_binding_mismatch',status:409});assert.equal((await f.service.account({ownerId})).availableUnits,0);
});
test('a recovered checkout without a stored URL requires reconciliation instead of returning an unsafe redirect',async()=>{
 const f=await fixture();await f.store.command('order',{mode:'test',ownerId,id:'recovered-order',intentKey:'recovered',productKey:'reading_100',productId:'prod_topup',amount:500,currency:'USD',units:100*U});await f.store.command('checkout',{mode:'test',ownerId,orderId:'recovered-order',checkoutId:'ch_recovered'});
 await assert.rejects(f.service.checkout({ownerId,intentKey:'recovered'}),{code:'checkout_reconciliation_required',status:503});assert.equal(f.creations,0);
});
test('monthly checkout requires subscription schema version two in test mode too',async()=>{
 const f=await fixture(),store={...f.store,command:async(action,p)=>action==='readiness'?{ready:true,durable:true,backend:'postgres',schemaVersion:1}:f.store.command(action,p)},service=createBillingService({enabled:true,store,creem:f.creem});
 assert.equal((await service.readiness({productKey:'reading_monthly_100'})).reason,'billing_schema_outdated');await assert.rejects(service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'old-schema'}),{status:503});assert.equal((await service.catalog()).products.find(p=>p.key==='reading_100').available,true);
});
