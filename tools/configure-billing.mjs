import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadLocalEnvironment} from '../server/local-env.mjs';
import {validateBillingProduct} from '../server/billing-product.mjs';

const products=[{key:'reading_100',variable:'CREEM_PRODUCT_READING_100',name:'Leafhour · 100 reading points',billing_type:'onetime'},
 {key:'reading_monthly_100',variable:'CREEM_PRODUCT_READING_MONTHLY_100',name:'Leafhour · 100 reading points monthly',billing_type:'recurring',billing_period:'every-month'}];
const required=['CREEM_API_KEY','CREEM_WEBHOOK_SECRET','CREEM_PRODUCT_READING_100','CREEM_PRODUCT_READING_MONTHLY_100','SUPABASE_URL','SUPABASE_SECRET_KEY','READER_PUBLIC_ORIGIN'];
const fail=code=>{throw Object.assign(new Error(code),{code});};

// An inventory is not an attestation: readiness still needs authoritative
// product/schema checks and executed checkout/webhook acceptance.
export function billingConfiguration(env={}){
 const missing=required.filter(key=>typeof env[key]!=='string'||!env[key].trim());
 if(!['test','live'].includes(env.CREEM_MODE))missing.push('CREEM_MODE');
 if(env.READER_BILLING_ENABLED!=='true')missing.push('READER_BILLING_ENABLED');
 if(env.CREEM_MODE==='live'&&env.READER_BILLING_SCHEMA_VERIFIED!=='true')missing.push('READER_BILLING_SCHEMA_VERIFIED');
 const budget=env.READER_BILLING_TRIAL_BUDGET_POINTS;
 if(!/^\d+$/.test(budget||'')||!Number.isSafeInteger(Number(budget)*1_000_000)||Number(budget)<10)missing.push('READER_BILLING_TRIAL_BUDGET_POINTS');
 return {ready:false,configurationComplete:missing.length===0,mode:['test','live'].includes(env.CREEM_MODE)?env.CREEM_MODE:null,missing,webhookPath:'/api/webhooks/creem',requiredSchemaVersion:2,trialPointsPerVerifiedAccount:10,suggestedTrialCampaignPoints:10000};
}

export async function prepareBillingProducts({env={},fetcher=globalThis.fetch,createMissing=false}={}){
 const mode=env.CREEM_MODE;
 if(!['test','live'].includes(mode)||typeof env.CREEM_API_KEY!=='string'||!env.CREEM_API_KEY)fail('billing_setup_configuration_missing');
 let origin;
 try{const url=new URL(env.READER_PUBLIC_ORIGIN);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/')throw Error();origin=url.origin;}catch{fail('billing_setup_origin_invalid');}
 const base=mode==='live'?'https://api.creem.io':'https://test-api.creem.io',environment={},created=[],missingProducts=[];
 async function request(url,{body,idempotencyKey}={}){
  let response,data;
  try{response=await fetcher(url,{method:body?'POST':'GET',headers:{'x-api-key':env.CREEM_API_KEY,...(body?{'Content-Type':'application/json','Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});if(!response.ok)fail('billing_setup_supplier_unavailable');data=await response.json();}
  catch{fail('billing_setup_supplier_unavailable');}
  return data;
 }
 function remember(p,product,productId){
  if(typeof productId!=='string'||!/^prod_[A-Za-z0-9_-]+$/.test(productId))fail('billing_setup_product_id_invalid');
  validateBillingProduct(product,{productId,mode,productKey:p.key});environment[p.variable]=productId;
 }
 // Preflight every existing product before creating any missing one. A wrong
 // monthly price must not leave an unrelated newly-created top-up behind.
 for(const p of products){
  const existing=env[p.variable];
  if(existing){if(!/^prod_[A-Za-z0-9_-]+$/.test(existing))fail('billing_setup_product_id_invalid');remember(p,await request(base+'/v1/products/'+encodeURIComponent(existing)),existing);}
 }
 for(const p of products){
  if(environment[p.variable])continue;
  if(createMissing){
   let product;
   product=await request(base+'/v1/products',{idempotencyKey:'leafhour-'+mode+'-'+p.key+'-usd500-v1',body:{name:p.name,description:p.key==='reading_100'?'One-time purchase of 100 reading points.':'100 reading points after each successful monthly payment. Cancel future renewals in the customer portal. Points accumulate without expiry.',price:500,currency:'USD',billing_type:p.billing_type,...(p.billing_period?{billing_period:p.billing_period}:{}),tax_mode:'exclusive',tax_category:'saas',default_success_url:origin+'/billing'}});
   created.push(p.key);
   remember(p,product,product?.id);
  }else{missingProducts.push(p.key);continue;}
 }
 return {mode,environment,created,missingProducts,webhookUrl:origin+'/api/webhooks/creem',liveBillingEnabled:false};
}

async function main(){
 const args=process.argv.slice(2);
 if(args.includes('--help')){console.log('Usage: node tools/configure-billing.mjs [--check | --create-products]\nReads protected environment variables and the existing local .env. Never prints credentials. Default --check makes no supplier writes. --create-products creates only missing approved US$5 products with stable idempotency; it does not enable billing, configure webhooks, migrate databases or charge a customer.');return;}
 if(args.some(arg=>!['--check','--create-products'].includes(arg))||args.includes('--check')&&args.includes('--create-products'))fail('billing_setup_invalid_arguments');
 const env={...process.env};await loadLocalEnvironment({env});
 const inventory=billingConfiguration(env);
 if(inventory.mode&&env.CREEM_API_KEY&&env.READER_PUBLIC_ORIGIN){
  const prepared=await prepareBillingProducts({env,createMissing:args.includes('--create-products')});console.log(JSON.stringify({...inventory,products:prepared},null,2));
 }else{
  console.log(JSON.stringify(inventory,null,2));
  if(args.includes('--create-products'))fail('billing_setup_configuration_missing');
 }
 if(!inventory.configurationComplete)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(['billing_setup_configuration_missing','billing_setup_origin_invalid','billing_setup_product_id_invalid','billing_setup_supplier_unavailable','billing_setup_invalid_arguments','billing_product_unverified'].includes(error.code)?error.code:'billing_setup_failed');process.exitCode=1;});
