import test from 'node:test';
import assert from 'node:assert/strict';
import {billingConfiguration,prepareBillingProducts} from '../tools/configure-billing.mjs';
const env={CREEM_MODE:'test',CREEM_API_KEY:'synthetic-key',READER_PUBLIC_ORIGIN:'https://leafhour.example/',CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly',CREEM_PRODUCT_READING_YEARLY_1200:'prod_yearly'};
const product=(yearly=false)=>({id:yearly?'prod_yearly':'prod_monthly',mode:'sandbox',price:yearly?5000:500,currency:'USD',billing_type:'recurring',billing_period:yearly?'every-year':'every-month',status:'active',tax_mode:'exclusive'});
test('setup validates both configured plans and creates neither without the explicit create flag',async()=>{
 const calls=[],result=await prepareBillingProducts({env,fetcher:async(url,options)=>{calls.push([url,options.method]);return Response.json(product(url.endsWith('prod_yearly')));}});
 assert.deepEqual(result.environment,{CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly',CREEM_PRODUCT_READING_YEARLY_1200:'prod_yearly'});assert.equal(calls.length,2);assert.ok(calls.every(c=>c[1]==='GET'));
 const missing=await prepareBillingProducts({env:{...env,CREEM_PRODUCT_READING_YEARLY_1200:''},fetcher:async()=>Response.json(product())});assert.deepEqual(missing.missingProducts,['reading_yearly_1200']);
 assert.equal(billingConfiguration(env).requiredSchemaVersion,3);assert.equal(billingConfiguration({...env,CREEM_PRODUCT_READING_YEARLY_1200:''}).requiredSchemaVersion,2);
});
test('explicit setup creates the approved annual terms with stable independent idempotency and pricing return URL',async()=>{
 const calls=[],input={env:{...env,CREEM_PRODUCT_READING_YEARLY_1200:''},createMissing:true,fetcher:async(url,options)=>{calls.push({url,options});return Response.json(product(options.method==='POST'));}};
 const first=await prepareBillingProducts(input),second=await prepareBillingProducts(input);assert.deepEqual(first.created,['reading_yearly_1200']);assert.deepEqual(second.created,first.created);
 const writes=calls.filter(c=>c.options.method==='POST');assert.equal(writes.length,2);assert.equal(writes[0].options.headers['Idempotency-Key'],writes[1].options.headers['Idempotency-Key']);
 const body=JSON.parse(writes[0].options.body);assert.equal(body.price,5000);assert.equal(body.billing_period,'every-year');assert.equal(body.default_success_url,'https://leafhour.example/pricing');assert.match(body.description,/1200/);
});
test('annual-only hosting can be configured independently of the monthly sale',()=>{
 const configured={...env,CREEM_PRODUCT_READING_MONTHLY_100:'',CREEM_WEBHOOK_SECRET:'synthetic-secret',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'synthetic-service',READER_BILLING_ENABLED:'true',READER_BILLING_TRIAL_BUDGET_POINTS:'10000'};
 assert.equal(billingConfiguration(configured).configurationComplete,true);
});
