import test from 'node:test';
import assert from 'node:assert/strict';

const mode='test',origin='https://leafhour.com';
const product=(id,key)=>({id,mode:'test',price:500,currency:'USD',tax_mode:'exclusive',status:'active',billing_type:key==='reading_100'?'onetime':'recurring',...(key==='reading_100'?{}:{billing_period:'every-month'})});
const env={CREEM_MODE:mode,READER_PUBLIC_ORIGIN:origin,CREEM_API_KEY:'test-private-credential',CREEM_PRODUCT_READING_100:'prod_topup',CREEM_PRODUCT_READING_MONTHLY_100:'prod_monthly'};

test('configuration inventory names missing variables without exposing credentials or changing environment',async()=>{
 const {billingConfiguration}=await import('../tools/configure-billing.mjs');
 const before=structuredClone(env),result=billingConfiguration(env);
 assert.equal(result.ready,false);assert.ok(result.missing.includes('CREEM_WEBHOOK_SECRET'));assert.ok(result.missing.includes('SUPABASE_SECRET_KEY'));
 assert.ok(!JSON.stringify(result).includes(env.CREEM_API_KEY));assert.deepEqual(env,before);
});

test('product preparation validates only the monthly offer and ignores retired top-up configuration',async()=>{
 const {prepareBillingProducts}=await import('../tools/configure-billing.mjs');const requests=[];
 const result=await prepareBillingProducts({env,fetcher:async(url,options)=>{requests.push({url,options});return Response.json(product(url.endsWith('prod_topup')?'prod_topup':'prod_monthly',url.endsWith('prod_topup')?'reading_100':'reading_monthly_100'));}});
 assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith("/prod_monthly"));assert.deepEqual(Object.keys(result.environment),["CREEM_PRODUCT_READING_MONTHLY_100"]);assert.ok(requests.every(r=>r.options.method==='GET'));assert.equal(result.environment.CREEM_PRODUCT_READING_MONTHLY_100,'prod_monthly');
 assert.ok(!JSON.stringify(result).includes(env.CREEM_API_KEY));
});

test('missing monthly product is not created without an explicit create flag',async()=>{
 const {prepareBillingProducts}=await import('../tools/configure-billing.mjs');let writes=0;
 const result=await prepareBillingProducts({env:{...env,CREEM_PRODUCT_READING_MONTHLY_100:''},fetcher:async(_url,options)=>{if(options.method==='POST')writes++;return Response.json(product('prod_topup','reading_100'));}});
 assert.equal(writes,0);assert.deepEqual(result.missingProducts,['reading_monthly_100']);
});

test('explicit setup creates only a missing approved monthly product with stable idempotency',async()=>{
 const {prepareBillingProducts}=await import('../tools/configure-billing.mjs');const requests=[];
 const fetcher=async(url,options)=>{requests.push({url,options});return Response.json(product(options.method==='POST'?'prod_new':'prod_topup',options.method==='POST'?'reading_monthly_100':'reading_100'));};
 const input={env:{...env,CREEM_PRODUCT_READING_MONTHLY_100:''},fetcher,createMissing:true};
 for(let i=0;i<2;i++)assert.equal((await prepareBillingProducts(input)).environment.CREEM_PRODUCT_READING_MONTHLY_100,'prod_new');
 const posts=requests.filter(r=>r.options.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].options.headers['Idempotency-Key'],posts[1].options.headers['Idempotency-Key']);
 const body=JSON.parse(posts[0].options.body);assert.equal(body.price,500);assert.equal(body.currency,'USD');assert.equal(body.billing_type,'recurring');assert.equal(body.billing_period,'every-month');assert.equal(body.tax_mode,'exclusive');assert.equal(body.default_success_url,origin+'/billing');
 assert.equal(posts[0].url,'https://test-api.creem.io/v1/products');
});

test('unsafe setup and mismatched product never fall through to a purchase or leak supplier errors',async()=>{
 const {prepareBillingProducts}=await import('../tools/configure-billing.mjs');let requests=0;
 for(const patch of [{CREEM_MODE:'typo'},{READER_PUBLIC_ORIGIN:'https://user:password@leafhour.com'},{CREEM_API_KEY:''}])await assert.rejects(prepareBillingProducts({env:{...env,...patch},createMissing:true,fetcher:async()=>{requests++;}}));
 assert.equal(requests,0);
 await assert.rejects(prepareBillingProducts({env,fetcher:async()=>Response.json({...product('prod_monthly','reading_monthly_100'),price:600})}),{code:'billing_product_unverified'});
 await assert.rejects(prepareBillingProducts({env,fetcher:async()=>{throw Error(env.CREEM_API_KEY);}}),error=>!error.message.includes(env.CREEM_API_KEY));
});
test('invalid monthly product is rejected without creating any additional offer',async()=>{
 const {prepareBillingProducts}=await import('../tools/configure-billing.mjs');const calls=[];
 await assert.rejects(prepareBillingProducts({env:{...env,CREEM_PRODUCT_READING_100:''},createMissing:true,fetcher:async(url,options)=>{calls.push(options.method);return Response.json(options.method==='POST'?product('prod_new','reading_100'):{...product('prod_monthly','reading_monthly_100'),price:999});}}),{code:'billing_product_unverified'});
 assert.deepEqual(calls,['GET']);
});


test('monthly-only configuration never requires or creates a retired one-time product',async()=>{
 const {billingConfiguration,prepareBillingProducts}=await import('../tools/configure-billing.mjs');
 const configured={...env,CREEM_PRODUCT_READING_100:undefined,CREEM_WEBHOOK_SECRET:'test-secret',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-key',READER_BILLING_ENABLED:'true',READER_BILLING_TRIAL_BUDGET_POINTS:'10000'};
 assert.equal(billingConfiguration(configured).configurationComplete,true);
 const calls=[];const result=await prepareBillingProducts({env:configured,createMissing:true,fetcher:async(url,options)=>{calls.push({url,options});return Response.json(product('prod_monthly','reading_monthly_100'));}});
 assert.deepEqual(result.created,[]);assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');assert.deepEqual(Object.keys(result.environment),['CREEM_PRODUCT_READING_MONTHLY_100']);
});
