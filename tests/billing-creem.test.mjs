import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const {createCreemClient,verifyCreemSignature,normalizeCreemEvent,safeCreemCheckoutUrl}=await import('../server/creem.mjs');
const secret='test-only-webhook-secret';
test('HMAC verifies exact bounded raw bytes before parsing',()=>{
  const raw=Buffer.from('{ not json }'),sig=createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal(verifyCreemSignature(raw,sig,secret),true);
  assert.throws(()=>verifyCreemSignature(Buffer.concat([raw,Buffer.from(' ')]),sig,secret),{code:'invalid_signature'});
  assert.throws(()=>verifyCreemSignature(raw,'',secret),{code:'invalid_signature'});
  assert.throws(()=>verifyCreemSignature({raw},sig,secret),{code:'invalid_webhook'});
});
test('checkout uses fixed API environment and safe return/product fields',async()=>{
  let request;const client=createCreemClient({env:{CREEM_MODE:'test',CREEM_API_KEY:'test-key',CREEM_WEBHOOK_SECRET:secret,CREEM_PRODUCT_READING_100:'prod_test'},fetcher:async(url,init)=>{request={url,init};return {ok:true,json:async()=>({id:'ch_test',checkout_url:'https://checkout.creem.io/ch_test'})};}});
  await client.createCheckout({orderId:'local-order',ownerId:'owner',productId:'prod_test',successUrl:'https://leafhour.example/billing?order=local-order'});
  assert.equal(request.url,'https://test-api.creem.io/v1/checkouts');const body=JSON.parse(request.init.body);
  assert.equal(body.request_id,'local-order');assert.equal(body.units,1);assert.equal(body.metadata.ownerId,'owner');assert.equal(body.custom_price,undefined);
  assert.throws(()=>safeCreemCheckoutUrl('https://checkout.creem.io.attacker.example/x'),{code:'unsafe_checkout_url'});
  assert.throws(()=>safeCreemCheckoutUrl('javascript:alert(1)'),{code:'unsafe_checkout_url'});
});
test('normalization retains verified finance facts but discards customer/private payload',()=>{
  const payload={id:'evt_test',eventType:'checkout.completed',object:{id:'ch_test',request_id:'local-order',status:'completed',mode:'test',units:1,metadata:{ownerId:'owner',secret:'discard'},product:{id:'prod_test',billing_type:'one-time'},order:{id:'ord_test',product:'prod_test',amount:500,currency:'USD',sub_total:500,tax_amount:50,amount_paid:550,status:'paid',mode:'test'},customer:{email:'private@example.com'}}};
  const event=normalizeCreemEvent(payload);
  assert.equal(event.orderId,'local-order');assert.equal(event.paidAmount,550);assert.equal(event.taxAmount,50);assert.equal(event.ownerId,'owner');
  assert.equal(JSON.stringify(event).includes('private@example.com'),false);assert.equal(JSON.stringify(event).includes('discard'),false);
});
test('normalization carries only explicit coupon ID and amount facts',()=>{
  const event=normalizeCreemEvent({id:'evt_review',eventType:'checkout.completed',object:{id:'ch_review',mode:'test',discount:{id:'dis_review',code:'SECRET-REVIEW'},order:{id:'ord_review',amount:500,discount_amount:500,amount_paid:0,tax_amount:0}}});
  assert.equal(event.discountId,'dis_review');assert.equal(event.discountAmount,500);assert.equal(JSON.stringify(event).includes('SECRET-REVIEW'),false);
});
test('tax-inclusive order totals do not replace pre-tax product principal',()=>{
  const event=normalizeCreemEvent({id:'evt_tax',eventType:'checkout.completed',object:{id:'ch_tax',mode:'test',product:{id:'prod_test',price:500},order:{id:'ord_tax',amount:550,sub_total:500,amount_paid:550,tax_amount:50,discount_amount:0}}});
  assert.equal(event.amount,500);assert.equal(event.paidAmount,550);assert.equal(event.taxAmount,50);
});
test('official production mode maps to the separate live ledger',()=>{
 assert.equal(normalizeCreemEvent({id:'evt_prod',eventType:'checkout.completed',object:{id:'ch_prod',mode:'prod',order:{id:'ord_prod',mode:'prod'}}}).mode,'live');
});
test('official onetime product type normalizes to the domain one-time type',()=>{
 assert.equal(normalizeCreemEvent({id:'evt_onetime',eventType:'checkout.completed',object:{id:'ch_onetime',mode:'test',product:{id:'prod_test',billing_type:'onetime'},order:{id:'ord_onetime'}}}).billingType,'one-time');
});

test('product lookup uses the fixed authenticated environment and encoded supplier ID',async()=>{
 let request;const client=createCreemClient({env:{CREEM_MODE:'live',CREEM_API_KEY:'test-key',CREEM_WEBHOOK_SECRET:secret,CREEM_PRODUCT_READING_100:'prod_test'},fetcher:async(url,init)=>{request={url,init};return Response.json({id:'prod_test'});}});
 assert.deepEqual(await client.retrieveProduct(),{id:'prod_test'});assert.equal(request.url,'https://api.creem.io/v1/products/prod_test');assert.equal(request.init.method,'GET');
});
