import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
import {createCreemClient} from '../server/creem.mjs';
import {createBillingRoutes} from '../server/billing-routes.mjs';
import {validateBillingProduct} from '../server/billing-product.mjs';

const U=1_000_000,ownerId='annual-synthetic-owner',secret='synthetic-secret',start='2026-10-22T00:00:00.000Z',end='2027-10-22T00:00:00.000Z',next='2028-10-22T00:00:00.000Z';
const product=(annual=true)=>({id:annual?'prod_yearly':'prod_monthly',mode:'sandbox',price:annual?5000:500,currency:'USD',billing_type:'recurring',billing_period:annual?'every-year':'every-month',status:'active',tax_mode:'exclusive'});
async function fixture({schemaVersion,env={}}={}){
 const memory=createBillingMemoryStore(),store=schemaVersion?{...memory,command:(action,p)=>action==='readiness'?Promise.resolve({ready:true,durable:true,backend:'postgres',schemaVersion}):memory.command(action,p)}:memory;
 const transactions=new Map([['tran_initial',{id:'tran_initial',mode:'sandbox',type:'invoice',status:'paid',amount:5000,amount_paid:5500,tax_amount:500,discount_amount:0,refunded_amount:null,currency:'USD',order:'ord_initial',subscription:'sub_yearly',customer:'cust_reader',period_start:start,period_end:end}]]);
 const subscription={id:'sub_yearly',mode:'sandbox',product:product(),customer:'cust_reader',status:'active',last_transaction_id:'tran_initial',current_period_start_date:start,current_period_end_date:end,updated_at:start};
 let checkout,creations=0,successUrl;
 const creem=createCreemClient({env:{CREEM_MODE:'test',CREEM_API_KEY:'synthetic-key',CREEM_WEBHOOK_SECRET:secret,CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly',CREEM_PRODUCT_READING_YEARLY_1200:'prod_yearly',...env},fetcher:async(url,init)=>{
  const parsed=new URL(url);
  if(parsed.pathname.startsWith('/v1/products/'))return Response.json(product(parsed.pathname.endsWith('prod_yearly')));
  if(parsed.pathname==='/v1/checkouts'&&init.method==='POST'){
   creations++;const body=JSON.parse(init.body);successUrl=body.success_url;
   checkout={id:'ch_annual_'+creations,mode:'sandbox',request_id:body.request_id,metadata:body.metadata,status:'completed',units:1,product:product(),customer:'cust_reader',subscription:'sub_yearly',order:{id:'ord_initial',status:'paid',transaction:'tran_initial',amount:5000,amount_paid:5500,tax_amount:500,discount_amount:0,currency:'USD'}};
   return Response.json({id:checkout.id,checkout_url:'https://checkout.creem.io/annual'});
  }
  if(parsed.pathname==='/v1/checkouts')return Response.json(checkout);
  if(parsed.pathname==='/v1/subscriptions')return Response.json(subscription);
  if(parsed.pathname==='/v1/transactions')return Response.json(transactions.get(parsed.searchParams.get('transaction_id')));
  throw Error('Unexpected supplier request');
 }});
 const service=createBillingService({store,creem,enabled:true,clock:()=>Date.parse(start),publicOrigin:'https://leafhour.example/ignored?untrusted=path'});
 const send=(id,type,object)=>{const rawBody=Buffer.from(JSON.stringify({id,eventType:type,object}));return service.webhook({rawBody,signature:createHmac('sha256',secret).update(rawBody).digest('hex')});};
 const buy=()=>service.checkout({ownerId,productKey:'reading_yearly_1200',intentKey:'annual-intent'});
 const complete=async()=>{await buy();return send('evt_checkout','checkout.completed',checkout);};
 return {service,store,creem,transactions,subscription,buy,complete,send,get checkout(){return checkout;},get creations(){return creations;},get successUrl(){return successUrl;}};
}

test('both paid plans can be independently available and monthly remains the checkout default',async()=>{
 const f=await fixture(),catalog=await f.service.catalog();
 assert.deepEqual(catalog.products.map(p=>[p.key,p.amount,p.points,p.billingPeriod,p.available]),[['reading_monthly_100',500,100,'every-month',true],['reading_yearly_1200',5000,1200,'every-year',true]]);
 const onlyMonthly=await fixture({env:{CREEM_PRODUCT_READING_YEARLY_1200:undefined}});assert.deepEqual((await onlyMonthly.service.catalog()).products.map(p=>p.available),[true,false]);
 const onlyYearly=await fixture({env:{CREEM_PRODUCT_READING_MONTHLY_100:undefined}});assert.deepEqual((await onlyYearly.service.catalog()).products.map(p=>p.available),[false,true]);
});
test('annual purchase saves its price, points and period and returns directly to pricing',async()=>{
 const f=await fixture(),{order}=await f.buy();assert.equal(order.amount,5000);assert.equal(order.units,1200*U);assert.equal(order.billingPeriod,'every-year');
 assert.equal(f.successUrl,'https://leafhour.example/pricing?order='+order.id);
 assert.equal((await f.service.order({ownerId,orderId:order.id})).checkoutUrl,'https://checkout.creem.io/annual');
 assert.equal((await f.service.orders({ownerId})).orders[0].checkoutUrl,'https://checkout.creem.io/annual');
});
test('annual paid invoice delivers all 1200 points upfront once and yearly renewal accumulates another 1200',async()=>{
 const f=await fixture();await f.complete();await f.send('evt_paid','subscription.paid',f.subscription);assert.equal((await f.service.account({ownerId})).availableUnits,1200*U);
 const renewal={...f.transactions.get('tran_initial'),id:'tran_renewal',order:'ord_renewal',period_start:end,period_end:next};f.transactions.set(renewal.id,renewal);
 await f.send('evt_renewal','subscription.paid',{...f.subscription,last_transaction_id:renewal.id});await f.send('evt_renewal','subscription.paid',{...f.subscription,last_transaction_id:renewal.id});
 assert.equal((await f.service.account({ownerId})).availableUnits,2400*U);
 const orders=(await f.service.orders({ownerId})).orders;assert.equal(orders.length,2);assert.ok(orders.every(o=>o.billingPeriod==='every-year'));
 const summary=await f.store.command('summary',{mode:'test',from:start,to:end});assert.equal(summary.yearlyPaidOrders,2);assert.equal(summary.oneTimePaidOrders,0);
});
test('yearly subscription state and paid reconciliation use saved financial identity after sale configuration retires',async()=>{
 const f=await fixture();await f.complete();f.creem.productIds.reading_yearly_1200=undefined;
 Object.assign(f.subscription,{status:'scheduled_cancel',updated_at:'2026-10-23T00:00:00Z'});await f.send('evt_cancel','subscription.scheduled_cancel',f.subscription);
 assert.equal((await f.service.account({ownerId})).availableUnits,1200*U);
 const renewal={...f.transactions.get('tran_initial'),id:'tran_renewal',order:'ord_renewal',period_start:end,period_end:next};f.transactions.set(renewal.id,renewal);
 await f.send('evt_renewal','subscription.paid',{...f.subscription,last_transaction_id:renewal.id});assert.equal((await f.service.account({ownerId})).availableUnits,2400*U);
});
test('yearly finance rejects monthly price, currency, discounts and wrong recurrence without granting credits',async()=>{
 for(const patch of [{amount:500},{currency:'EUR'},{discount_amount:5000,amount_paid:0,tax_amount:0},{period_end:'2026-11-22T00:00:00Z'}]){
  const f=await fixture();Object.assign(f.transactions.get('tran_initial'),patch);await assert.rejects(f.complete(),e=>[409,503].includes(e.status));assert.equal((await f.service.account({ownerId})).availableUnits,0);
 }
 const f=await fixture();f.subscription.product.billing_period='every-month';await assert.rejects(f.complete(),{code:'payment_mismatch'});assert.equal((await f.service.account({ownerId})).availableUnits,0);
});
test('yearly refunds and disputes act on the complete upfront purchase lot',async()=>{
 for(const [status,refunded,available,frozen]of [['partialRefund',2750,600,false],['refunded',5500,0,false],['chargedBack',0,0,true]]){
  const f=await fixture();Object.assign(f.transactions.get('tran_initial'),{status,refunded_amount:refunded});await f.complete();const account=await f.service.account({ownerId});assert.equal(account.availableUnits,available*U);assert.equal(account.frozen,frozen);
 }
});
test('monthly and yearly intents share a single atomic pending signup lock',async()=>{
 const f=await fixture(),other=createBillingService({store:f.store,creem:f.creem,enabled:true});
 const results=await Promise.allSettled([f.buy(),other.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'monthly-intent'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'subscription_exists');assert.equal(f.creations,1);
});
test('a nonterminal annual subscription blocks monthly signup until authoritative cancellation',async()=>{
 const f=await fixture();await f.complete();await assert.rejects(f.service.checkout({ownerId,intentKey:'monthly-intent'}),{code:'subscription_exists'});
 Object.assign(f.subscription,{status:'canceled',updated_at:'2026-10-23T00:00:00Z'});await f.send('evt_canceled','subscription.canceled',f.subscription);
 assert.equal((await f.service.account({ownerId})).availableUnits,1200*U);assert.equal((await f.service.checkout({ownerId,intentKey:'new-monthly'})).order.productKey,'reading_monthly_100');
});
test('v2 schema keeps monthly ready but disables annual checkout before creating an order',async()=>{
 const f=await fixture({schemaVersion:2});assert.equal((await f.service.readiness()).ready,true);assert.equal((await f.service.readiness({productKey:'reading_yearly_1200'})).reason,'billing_schema_outdated');
 assert.deepEqual((await f.service.catalog()).products.map(p=>p.available),[true,false]);await assert.rejects(f.buy(),{status:503});assert.equal(f.creations,0);assert.equal((await f.service.orders({ownerId})).orders.length,0);
});
test('annual product preflight requires the approved annual price, year recurrence and no trial',()=>{
 const input=product();assert.equal(validateBillingProduct(input,{productId:'prod_yearly',productKey:'reading_yearly_1200',mode:'test'}),true);
 for(const patch of [{price:500},{billing_period:'every-month'},{recurring_interval:'month'},{recurring_interval_count:2},{trial_period_days:7},{usage_prices:[{}]}])assert.throws(()=>validateBillingProduct({...input,...patch},{productId:'prod_yearly',productKey:'reading_yearly_1200',mode:'test'}),{code:'billing_product_unverified'});
});
test('saved annual order terms reject changed or missing recurrence on repeated intents',async()=>{
 const f=await fixture(),{order}=await f.buy();
 for(const patch of [{billingPeriod:'every-month'},{billingPeriod:undefined},{amount:500}])await assert.rejects(f.store.command('order',{...order,...patch,mode:'test'}),e=>['invalid_input','idempotency_conflict'].includes(e.code));
 assert.equal((await f.service.order({ownerId,orderId:order.id})).billingPeriod,'every-year');
});

test('annual checkout route keeps the server session owner and exact checkout response',async()=>{
 const f=await fixture(),routes=createBillingRoutes({billing:f.service,publicOrigin:'https://leafhour.example'});let result;
 await routes.handle({req:{method:'POST',headers:{origin:'https://leafhour.example','x-reader-owner':ownerId}},res:{setHeader(){}},url:new URL('https://leafhour.example/api/billing/checkouts'),user:{id:ownerId},body:{productKey:'reading_yearly_1200',intentKey:'route-yearly'},send:(status,data)=>{result={status,data};}});
 assert.equal(result.status,201);assert.deepEqual(Object.keys(result.data).sort(),['checkoutUrl','order']);assert.equal(result.data.order.ownerId,ownerId);assert.equal(result.data.order.productKey,'reading_yearly_1200');assert.equal(result.data.order.units,1200*U);assert.equal(f.creations,1);
});
test('frozen accounts cannot create a new monthly or annual checkout',async()=>{
 for(const productKey of ['reading_monthly_100','reading_yearly_1200']){
  const f=await fixture(),base={mode:'test',ownerId};
  await f.store.command('order',{...base,id:'freeze-source',intentKey:'freeze-source',productKey:'reading_100',productId:'prod_retired',amount:500,currency:'USD',units:100*U});
  await f.store.command('dispute',{...base,orderId:'freeze-source',eventId:'evt_freeze',eventHash:'hash_freeze'});
  assert.equal((await f.service.account({ownerId})).frozen,true);
  await assert.rejects(f.service.checkout({ownerId,productKey,intentKey:'frozen-new-purchase'}),{code:'frozen_account',status:403});assert.equal(f.creations,0);assert.equal((await f.service.orders({ownerId})).orders.length,1);
 }
});

test('monthly schema-v2 checkout also checks the frozen account before any order or supplier mutation',async()=>{
 const mutations=[];
 const store={command:async(action)=>{if(action==='readiness')return {ready:true,backend:'reference',schemaVersion:2};if(action==='account')return {frozen:true};mutations.push(action);throw Error('Unexpected mutation '+action);}};
 const creem={ready:true,mode:'test',productIds:{reading_monthly_100:'prod_monthly'},retrieveProduct:async()=>product(false),createCheckout:async()=>{mutations.push('supplier');throw Error('Unexpected supplier call');}};
 const service=createBillingService({enabled:true,store,creem});
 await assert.rejects(service.checkout({ownerId,productKey:'reading_monthly_100',intentKey:'blocked-frozen'}),{code:'frozen_account',status:403});assert.deepEqual(mutations,[]);
});

test('real-shaped annual transaction without discount_amount delivers exactly one upfront grant',async()=>{
 const f=await fixture(),invoice={...f.transactions.get('tran_initial'),object:'transaction',mode:'test',amount_paid:5000,tax_amount:0,period_start:Date.parse(start),period_end:Date.parse(end)};delete invoice.discount_amount;f.transactions.set(invoice.id,invoice);
 await f.buy();Object.assign(f.checkout.order,{amount_paid:5000,tax_amount:0});await f.complete();await f.send('evt_real_shape_paid','subscription.paid',f.subscription);
 assert.equal((await f.service.account({ownerId})).availableUnits,1200*U);
 const order=(await f.service.orders({ownerId})).orders[0];assert.equal(order.amount,5000);assert.equal(order.paidAmount,5000);assert.equal(order.taxAmount,0);assert.equal(order.discountAmount,0);
 assert.equal((await f.service.entries({ownerId})).entries.filter(e=>e.type==='grant').length,1);
});
test('omitted discount never supplies missing money facts or permits annual underpayment or overpayment',async()=>{
 for(const patch of [{amount:undefined},{amount:null},{amount_paid:undefined},{amount_paid:null},{amount_paid:'5000'},{tax_amount:undefined},{tax_amount:null},{tax_amount:'0'},{amount_paid:4999},{amount_paid:5001},{discount_amount:null}]){
  const f=await fixture(),invoice={...f.transactions.get('tran_initial'),amount_paid:5000,tax_amount:0};delete invoice.discount_amount;Object.assign(invoice,patch);f.transactions.set(invoice.id,invoice);
  await assert.rejects(f.complete(),e=>e.status===409,JSON.stringify(patch));assert.equal((await f.service.account({ownerId})).availableUnits,0);
 }
});
test('annual omission of discount preserves authoritative partial refund, full refund and dispute tombstones',async()=>{
 for(const [status,refunded,available,frozen]of [['partialRefund',2500,600,false],['refunded',5000,0,false],['chargedBack',0,0,true]]){
  const f=await fixture(),invoice={...f.transactions.get('tran_initial'),amount_paid:5000,tax_amount:0,status,refunded_amount:refunded};delete invoice.discount_amount;f.transactions.set(invoice.id,invoice);await f.complete();
  const account=await f.service.account({ownerId});assert.equal(account.availableUnits,available*U);assert.equal(account.frozen,frozen);
 }
});
