import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreemClient,normalizeCreemEvent} from '../server/creem.mjs';
import * as supplier from '../server/creem.mjs';
import {validateBillingProduct} from '../server/billing-product.mjs';

const env={CREEM_MODE:'test',CREEM_API_KEY:'synthetic-key',CREEM_WEBHOOK_SECRET:'synthetic-secret',CREEM_PRODUCT_READING_100:'prod_topup',CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly'};
test('selected products and documented subscription, transaction and portal endpoints stay environment bound',async()=>{
 const calls=[];const client=createCreemClient({env,fetcher:async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/billing')?{customer_portal_link:'https://creem.io/my-orders/login/synthetic'}:init.method==='POST'?{id:'ch_monthly',checkout_url:'https://checkout.creem.io/ch_monthly'}:{id:'synthetic'});}});
 assert.deepEqual(client.productIds,{reading_monthly_100:'prod_monthly'});assert.equal(client.productId,'prod_monthly');
 await client.retrieveProduct({productId:'prod_monthly'});await client.retrieveSubscription({subscriptionId:'sub_synthetic'});await client.retrieveTransaction({transactionId:'tran_synthetic'});
 await client.createCheckout({orderId:'local-order',ownerId:'synthetic-owner',productId:'prod_monthly',successUrl:'https://leafhour.example/billing'});
 assert.equal((await client.createPortal({customerId:'cust_synthetic'})).portalUrl,'https://creem.io/my-orders/login/synthetic');
 assert.deepEqual(calls.map(c=>c.url),['https://test-api.creem.io/v1/products/prod_monthly','https://test-api.creem.io/v1/subscriptions?subscription_id=sub_synthetic','https://test-api.creem.io/v1/transactions?transaction_id=tran_synthetic','https://test-api.creem.io/v1/checkouts','https://test-api.creem.io/v1/customers/billing']);
 assert.equal(JSON.parse(calls[3].init.body).product_id,'prod_monthly');assert.deepEqual(JSON.parse(calls[4].init.body),{customer_id:'cust_synthetic'});
 await assert.rejects(client.createCheckout({productId:'prod_foreign'}),{code:'unknown_product'});
 await assert.rejects(client.retrieveSubscription({subscriptionId:'sub_unsafe?'}),{code:'invalid_input'});
 await assert.rejects(client.retrieveTransaction({transactionId:'tran_unsafe?'}),{code:'invalid_input'});
});
test('transaction retrieval supports the documented tran, txn and tx identifier prefixes',async()=>{
 const urls=[],client=createCreemClient({env,fetcher:async url=>{urls.push(url);return Response.json({});}});
 for(const transactionId of ['tran_invoice','txn_invoice','tx_invoice'])await client.retrieveTransaction({transactionId});
 assert.equal(urls.length,3);
 for(const transactionId of ['cust_foreign','tx_bad?x=1','tx_../other'])await assert.rejects(client.retrieveTransaction({transactionId}),{code:'invalid_input'});
});
test('monthly configuration can stand alone and portal redirects use a separate strict allowlist',async()=>{
 const client=createCreemClient({env:{...env,CREEM_PRODUCT_READING_100:undefined}});assert.equal(client.ready,true);
 assert.equal(typeof supplier.safeCreemPortalUrl,'function');
 assert.equal(supplier.safeCreemPortalUrl('https://creem.io/my-orders/login/synthetic'),'https://creem.io/my-orders/login/synthetic');
 for(const url of ['http://creem.io/my-orders/login/a','https://creem.io.attacker.test/my-orders/login/a','https://user@creem.io/my-orders/login/a','https://creem.io:444/my-orders/login/a','https://creem.io/payment/a','https://checkout.creem.io/ch_a'])assert.throws(()=>supplier.safeCreemPortalUrl(url),{code:'unsafe_portal_url'});
});
test('subscription normalization preserves the paid transaction identity and discards private customer data',()=>{
 const event=normalizeCreemEvent({id:'evt_paid',eventType:'subscription.paid',created_at:1792540800000,object:{id:'sub_synthetic',mode:'sandbox',status:'active',product:{id:'prod_monthly',billing_type:'recurring',price:500},customer:{id:'cust_synthetic',email:'PRIVATE'},last_transaction_id:'tran_original',current_period_start_date:'2026-10-21T00:00:00Z',current_period_end_date:'2026-11-21T00:00:00Z',updated_at:'2026-10-21T00:00:00Z',metadata:{ownerId:'synthetic-owner',orderId:'synthetic-order',private:'PRIVATE'}}});
 assert.equal(event.ignored,undefined);assert.equal(event.subscriptionId,'sub_synthetic');assert.equal(event.customerId,'cust_synthetic');assert.equal(event.transactionId,'tran_original');assert.equal(event.mode,'test');assert.equal(event.productId,'prod_monthly');assert.equal(event.currentPeriodEnd,'2026-11-21T00:00:00Z');assert.doesNotMatch(JSON.stringify(event),/PRIVATE/);
 const checkout=normalizeCreemEvent({id:'evt_checkout',eventType:'checkout.completed',object:{id:'ch_synthetic',mode:'test',subscription:{id:'sub_synthetic',last_transaction_id:'tran_later'},customer:'cust_synthetic',order:{id:'ord_initial',transaction:'tran_initial'}}});
 assert.equal(checkout.transactionId,'tran_initial');assert.equal(checkout.subscriptionId,'sub_synthetic');
 const missing=normalizeCreemEvent({id:'evt_checkout_old',eventType:'checkout.completed',object:{id:'ch_synthetic',mode:'test',subscription:{id:'sub_synthetic',last_transaction_id:'tran_later'},order:{id:'ord_initial'}}});
 assert.equal(missing.transactionId,undefined,'a mutable subscription last transaction cannot identify the initial checkout payment');
});
test('monthly product validation requires the approved monthly recurrence and rejects trials',()=>{
 const product={id:'prod_monthly',mode:'test',price:500,currency:'USD',billing_type:'recurring',billing_period:'every-month',status:'active',tax_mode:'exclusive'};
 assert.equal(validateBillingProduct(product,{productId:'prod_monthly',productKey:'reading_monthly_100',mode:'test'}),true);
 assert.equal(validateBillingProduct({...product,trial_period_days:null,recurring_interval:'month',recurring_interval_count:1},{productId:'prod_monthly',productKey:'reading_monthly_100',mode:'test'}),true);
 for(const patch of [{billing_type:'onetime'},{billing_period:'every-year'},{price:499},{trial_period_days:7},{recurring_interval_count:2},{recurring_interval:'year'},{usage_prices:[{meter_id:'mtr_usage',unit_price:.002}]},{pay_what_you_want:true}])assert.throws(()=>validateBillingProduct({...product,...patch},{productId:'prod_monthly',productKey:'reading_monthly_100',mode:'test'}),{code:'billing_product_unverified'});
});

test('the adapter rejects a configured legacy product before sending a checkout request',async()=>{
 let calls=0;const client=createCreemClient({env,fetcher:async()=>{calls++;return Response.json({id:'ch_legacy',checkout_url:'https://checkout.creem.io/ch_legacy'});}});
 await assert.rejects(client.createCheckout({orderId:'legacy',ownerId:'synthetic-owner',productId:'prod_topup',successUrl:'https://leafhour.example/billing'}),{code:'unknown_product'});assert.equal(calls,0);
});
test('payment retrieval remains available with credentials after all sale product IDs are removed',async()=>{
 const calls=[],client=createCreemClient({env:{CREEM_MODE:'test',CREEM_API_KEY:'synthetic-key',CREEM_WEBHOOK_SECRET:'synthetic-secret'},fetcher:async url=>{calls.push(url);return Response.json({id:'ch_legacy'});}});
 assert.equal(client.ready,true);assert.deepEqual(await client.retrieveCheckout({checkoutId:'ch_legacy'}),{id:'ch_legacy'});assert.equal(calls.length,1);
 await assert.rejects(client.createCheckout({productId:'prod_topup'}),{code:'unknown_product'});assert.equal(calls.length,1);
});

test('new-sale product validation defaults to monthly and rejects legacy one-time products',()=>{
 const monthly={id:'prod_monthly',mode:'test',price:500,currency:'USD',billing_type:'recurring',billing_period:'every-month',status:'active',tax_mode:'exclusive'};
 assert.equal(validateBillingProduct(monthly,{productId:'prod_monthly',mode:'test'}),true);
 const legacy={...monthly,id:'prod_topup',billing_type:'onetime'};
 assert.throws(()=>validateBillingProduct(legacy,{productId:'prod_topup',mode:'test'}),{code:'billing_product_unverified'});
 assert.throws(()=>validateBillingProduct(legacy,{productId:'prod_topup',productKey:'reading_100',mode:'test'}),{code:'billing_product_unverified'});
});
