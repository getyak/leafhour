import test from 'node:test';
// Isolated acceptance walkthrough: real application routes, synthetic external services.
// No environment files, real accounts, card details or network requests are used.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
const root=new URL('../',import.meta.url).href.replace(/\/$/,'');
const {createPortal}=await import(root+'/server/portal.mjs');
const {createHostedAuth}=await import(root+'/deploy/hosted-auth.mjs');
const {authFixture}=await import(root+'/tests/auth-fixture.mjs');
const {createBillingService}=await import(root+'/server/billing-service.mjs');
const {createBillingMemoryStore}=await import(root+'/server/billing-memory-store.mjs');
const {createCreemClient}=await import(root+'/server/creem.mjs');
const {recordProviderCall}=await import(root+'/server/provider-metering.mjs');

test('isolated login, trial exhaustion, subscription-only sale, monthly renewal and reporting walkthrough',async()=>{
const U=1_000_000,secret='synthetic-walkthrough-secret',identity=authFixture(),origin=identity.env.READER_PUBLIC_ORIGIN;
const directory=await mkdtemp(path.join(tmpdir(),'leafhour-billing-walkthrough-'));
const store=createBillingMemoryStore({dataDir:path.join(directory,'billing')});
const product=(id)=>({id,mode:'sandbox',price:500,currency:'USD',billing_type:id==='prod_monthly'?'recurring':'onetime',...(id==='prod_monthly'?{billing_period:'every-month'}:{}),status:'active',tax_mode:'exclusive'});
const checkouts=new Map(),transactions=new Map();let creations=0,modelCalls=0,cookie=null,ownerId=null,portal;
const start='2026-10-21T00:00:00.000Z',end='2026-11-21T00:00:00.000Z',later='2026-12-21T00:00:00.000Z';
let subscription={id:'sub_walkthrough',mode:'sandbox',product:product('prod_monthly'),customer:'cust_walkthrough',status:'active',last_transaction_id:'tran_initial',current_period_start_date:start,current_period_end_date:end,updated_at:start};
const transaction=(id,from,to)=>({id,mode:'sandbox',type:'invoice',status:'paid',amount:500,amount_paid:550,discount_amount:0,tax_amount:50,refunded_amount:0,currency:'USD',order:id==='tran_initial'?'ord_1':'ord_renewal',subscription:'sub_walkthrough',customer:'cust_walkthrough',period_start:Date.parse(from),period_end:Date.parse(to)});
transactions.set('tran_initial',transaction('tran_initial',start,end));
const creem=createCreemClient({env:{CREEM_MODE:'test',CREEM_API_KEY:'synthetic-walkthrough-key',CREEM_WEBHOOK_SECRET:secret,CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly'},fetcher:async(raw,init)=>{
  const url=new URL(raw);assert.equal(url.origin,'https://test-api.creem.io');
  if(url.pathname.startsWith('/v1/products/'))return Response.json(product(url.pathname.split('/').at(-1)));
  if(url.pathname==='/v1/checkouts'&&init.method==='POST'){
    const body=JSON.parse(init.body),index=++creations,id='ch_walkthrough_'+index,monthly=body.product_id==='prod_monthly';
    checkouts.set(id,{id,request_id:body.request_id,mode:'sandbox',status:'completed',units:1,product:product(body.product_id),customer:'cust_walkthrough',metadata:body.metadata,...(monthly?{subscription:{id:'sub_walkthrough'}}:{}),order:{id:'ord_'+index,...(monthly?{transaction:'tran_initial'}:{}),status:'paid',product:body.product_id,sub_total:500,amount:500,amount_paid:550,tax_amount:50,discount_amount:0,currency:'USD',mode:'sandbox'}});
    return Response.json({id,checkout_url:'https://checkout.creem.io/'+id});
  }
  if(url.pathname==='/v1/checkouts')return Response.json(checkouts.get(url.searchParams.get('checkout_id')));
  if(url.pathname==='/v1/subscriptions')return Response.json(subscription);
  if(url.pathname==='/v1/transactions')return Response.json(transactions.get(url.searchParams.get('transaction_id')));
  if(url.pathname==='/v1/customers/billing')return Response.json({customer_portal_link:'https://creem.io/my-orders/login/walkthrough'});
  throw Error('Unplanned synthetic supplier boundary');
}});
const billing=createBillingService({enabled:true,store,creem,trialBudgetUnits:100*U,adminIds:[identity.user.id],publicOrigin:origin});
const checkpoints=[];
function checked(step,details={}){checkpoints.push({step,status:'passed',...details});}
async function request(route,{method='GET',body,raw,headers={},anonymous=false}={}){
  const bytes=raw??(body===undefined?null:Buffer.from(JSON.stringify(body)));
  const req=Readable.from(bytes?[bytes.subarray(0,5),bytes.subarray(5)]:[]);
  Object.assign(req,{method,headers:{host:new URL(origin).host,...(!anonymous&&cookie?{cookie}:{}),...(!anonymous&&ownerId?{'x-reader-owner':ownerId}:{}),...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},socket:{remoteAddress:'127.0.0.1'}});
  const res=new EventEmitter(),responseHeaders={};res.setHeader=(key,value)=>{responseHeaders[key]=value;};let response;
  const handled=await portal.handle({req,res,url:new URL(route,origin),send:(status,data)=>{res.writableEnded=true;response={status,data};}});
  assert.equal(handled,true,route);return {...response,headers:responseHeaders};
}
async function account(){return (await request('/api/billing/account')).data;}
async function notify(id,eventType,object){
  const raw=Buffer.from(JSON.stringify({id,eventType,object}));
  return request('/api/webhooks/creem',{method:'POST',raw,anonymous:true,headers:{'creem-signature':createHmac('sha256',secret).update(raw).digest('hex')}});
}
try{
  portal=await createPortal({dataDir:path.join(directory,'portal'),publicOrigin:origin,allowLocal:false,catalogDir:null,env:{},authService:createHostedAuth({...identity,store:identity.store()}),billingService:billing,chatGenerator:null,annotationGenerator:null,companionGenerator:null,introductionGenerator:null,translator:async()=>{
    modelCalls++;const now=new Date().toISOString();await recordProviderCall({id:'synthetic-call-'+modelCalls,provider:'deepseek',model:'synthetic-reference',status:'completed',usage:{inputTokens:10,outputTokens:10,cacheReadTokens:0,cacheWriteTokens:0},costMicrousd:1,costStatus:'reported_usage_rated',pricingVersion:'synthetic-reference',startedAt:now,finishedAt:now});
    return {literal:'Synthetic literal translation '+modelCalls,interpretive:'Synthetic interpretive translation '+modelCalls};
  }});
  await assert.rejects(request('/api/billing/account',{anonymous:true}),{status:401});
  const login=await request('/api/auth/password',{method:'POST',body:{email:'reader@example.com',password:'synthetic-fixture-password'},anonymous:true});
  assert.equal(login.status,200);ownerId=login.data.user.id;cookie=login.headers['Set-Cookie'].split(';')[0];
  assert.equal((await request('/api/auth/session')).data.user.id,ownerId);checked('password_login_and_session');
  assert.equal((await account()).availableUnits,0);
  const book=await portal.library.importDocument({id:ownerId},{filename:'synthetic-acceptance.txt',bytes:Buffer.from(Array.from({length:12},(_,i)=>'Synthetic acceptance paragraph '+(i+1)+'.').join('\n\n'))});
  const paragraphs=book.sections.flatMap(s=>s.paragraphs);assert.equal(paragraphs.length,12);
  const endpoint='/api/library/books/'+book.bookId+'/translate';
  async function translate(index,id){
    const input={id,passageId:paragraphs[index].id,contentVersion:book.contentVersion};
    const quote=await request('/api/billing/quotes',{method:'POST',body:{action:'translation',bookId:book.bookId,input}});
    assert.equal(quote.status,201);
    return request(endpoint,{method:'POST',body:{...input,billing:{quoteId:quote.data.id,idempotencyKey:id}}});
  }
  await translate(0,'free-0');assert.equal((await account()).availableUnits,9*U);checked('verified_once_only_trial',{grantedPoints:10});
  for(let i=1;i<10;i++)await translate(i,'free-'+i);
  assert.equal((await account()).availableUnits,0);assert.equal(modelCalls,10);checked('ten_translations_exhaust_trial',{modelCalls});
  await assert.rejects(translate(10,'blocked-10'),{status:402,code:'insufficient_credits'});assert.equal(modelCalls,10);checked('insufficient_credit_blocks_before_model');
  await request(endpoint,{method:'POST',body:{id:'cached-result',passageId:paragraphs[0].id,contentVersion:book.contentVersion}});
  assert.equal(modelCalls,10);assert.equal((await account()).availableUnits,0);checked('saved_translation_remains_free');
  for(const route of ['/zh-hans/pricing','/zh-hans/terms','/zh-hans/refunds'])assert.equal((await request(route,{anonymous:true})).status,200);
  checked('public_pricing_and_legal_pages');
  await assert.rejects(request('/api/billing/checkouts',{method:'POST',body:{productKey:'reading_100',intentKey:'removed-one-time-walkthrough'}}),{code:'unknown_product'});
  assert.equal(creations,0);assert.equal((await account()).availableUnits,0);checked('one_time_purchase_rejected');
  const monthly=await request('/api/billing/checkouts',{method:'POST',body:{intentKey:'monthly-walkthrough'}});
  assert.equal(monthly.status,201);assert.equal(monthly.data.order.productKey,'reading_monthly_100');assert.equal((await account()).availableUnits,0);checked('checkout_redirect_does_not_grant_points');
  await notify('evt_monthly_checkout','checkout.completed',checkouts.get('ch_walkthrough_1'));
  await notify('evt_monthly_paid','subscription.paid',subscription);await notify('evt_monthly_paid','subscription.paid',subscription);
  assert.equal((await account()).availableUnits,100*U);checked('monthly_initial_payment_grants_once',{availablePoints:100});
  await translate(10,'after-subscription');assert.equal((await account()).availableUnits,99*U);assert.equal(modelCalls,11);checked('paid_credits_resume_translation',{availablePoints:99});
  transactions.set('tran_renewal',transaction('tran_renewal',end,later));subscription={...subscription,last_transaction_id:'tran_renewal',current_period_start_date:end,current_period_end_date:later,updated_at:end};
  await notify('evt_renewal','subscription.paid',subscription);await notify('evt_renewal','subscription.paid',subscription);
  assert.equal((await account()).availableUnits,199*U);checked('monthly_renewal_grants_once',{availablePoints:199});
  assert.equal((await request('/api/billing/portal',{method:'POST',body:{subscriptionId:subscription.id}})).status,200);
  subscription={...subscription,status:'canceled',updated_at:new Date(Date.parse(end)+1000).toISOString()};await notify('evt_cancel','subscription.canceled',subscription);
  assert.equal((await account()).availableUnits,199*U);assert.equal((await request('/api/billing/subscriptions')).data.subscriptions[0].status,'canceled');checked('customer_portal_and_cancellation_preserve_points');
  const from=new Date(Date.now()-3600000).toISOString(),to=new Date(Date.now()+3600000).toISOString();
  const summary=(await request('/api/admin/billing/summary?'+new URLSearchParams({from,to}))).data;
  assert.equal(summary.paidOrders,2);assert.equal(summary.monthlyPaidOrders,2);assert.equal(summary.oneTimePaidOrders,0);assert.equal(summary.salesByCurrency.USD,1000);assert.equal(summary.consumedUnits,11*U);assert.equal(summary.calls,11);
  checked('admin_sales_consumption_and_usage',{paidOrders:2,syntheticNetSalesUsd:10,consumedPoints:11,syntheticProviderCalls:11});
  const reopened=createBillingMemoryStore({dataDir:path.join(directory,'billing')});assert.equal((await reopened.command('account',{mode:'test',ownerId})).availableUnits,199*U);checked('reference_ledger_restart_preserves_balance');
  await request('/api/auth/logout',{method:'POST',body:{}});await assert.rejects(request('/api/billing/account'),{status:409});await assert.rejects(request('/api/billing/account',{anonymous:true}),{status:401});checked('logout_revokes_access');
  assert.equal(checkpoints.length,15); assert.equal(creations,1); assert.equal(modelCalls,11);
}finally{
  if(portal){await portal.chat.close();await portal.ingestionRunner.close();await portal.audio?.close();}
  await rm(directory,{recursive:true,force:true});
}

});
