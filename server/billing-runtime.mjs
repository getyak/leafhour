import {createBetaUsageStore,mergeProviderUsage} from './beta-usage-store.mjs';
import {createBillingService,CREDIT_UNITS} from './billing-service.mjs';
import {createBillingMemoryStore} from './billing-memory-store.mjs';
import {createBillingPostgresStore} from '../deploy/billing-store.mjs';
import {createCreem} from './creem.mjs';

// A configuration error disables financial mutations, not access to books.
// Keep enabled=true so a misconfigured commercial host cannot generate for free.
function unavailable(mode,publicOrigin){
 const service=createBillingService({enabled:false,mode,publicOrigin});
 return {...service,enabled:true,readiness:async()=>({enabled:true,mode,ready:false,reason:'billing_configuration_incomplete'}),catalog:async()=>({...await service.catalog(),enabled:true,available:false})};
}
async function createFinancialRuntime({env=process.env,dataDir,store,creem,publicOrigin=env.READER_PUBLIC_ORIGIN||'http://localhost:3000'}={}){
 const enabled=env.READER_BILLING_ENABLED==='true',mode=env.CREEM_MODE||'test';
 if(!enabled)return createBillingService({enabled:false,mode:['test','live'].includes(mode)?mode:'test',publicOrigin});
 if(!['test','live'].includes(mode))return unavailable('test',publicOrigin);
 try{
  const raw=env.READER_BILLING_TRIAL_BUDGET_POINTS??'0',points=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(points*CREDIT_UNITS))throw Error('Invalid trial campaign budget');
  const backend=store||(env.SUPABASE_URL&&env.SUPABASE_SECRET_KEY?createBillingPostgresStore({env}):mode==='test'?await createBillingMemoryStore({dataDir}):null);
  if(!backend||mode==='live'&&(!backend.durable||env.READER_BILLING_SCHEMA_VERIFIED!=='true'))throw Error('Durable billing store required');
  return createBillingService({store:backend,creem:creem||createCreem({env}),enabled,mode,publicOrigin,trialBudgetUnits:points*CREDIT_UNITS,adminIds:(env.READER_BILLING_ADMIN_USER_IDS||'').split(',').map(v=>v.trim()).filter(Boolean)});
 }catch{return unavailable(mode,publicOrigin);}
}

// Beta usage is observed, never reserved against or debited from a reader's ledger.
export async function createBillingRuntime(options={}){
 const env=options.env||process.env,service=await createFinancialRuntime(options);
 if(env.READER_USAGE_POLICY==='metered')return {...service,usagePolicy:'metered'};
 const mode=service.mode||(['test','live'].includes(env.CREEM_MODE)?env.CREEM_MODE:'test');
 const usageStore=options.store||createBetaUsageStore({dataDir:options.dataDir,dataStore:options.dataStore});
 const catalog=service.catalog.bind(service);
 return {...service,usagePolicy:'beta',
  catalog:async()=>({...await catalog(),enabled:false,available:false,usagePolicy:'beta',statisticsOnly:true}),
  recordProviderCall:facts=>usageStore.command('providerCall',{...facts,mode}),
  async summary(input){
   if(!(env.READER_BILLING_ADMIN_USER_IDS||'').split(',').map(v=>v.trim()).includes(input.ownerId))throw Object.assign(Error('admin_required'),{status:403});
   const current=await usageStore.command('summary',{...input,mode});
   if(options.store)return current;
   let financial={financialAvailable:false};
   if(service.enabled){try{financial={...await service.summary(input),financialAvailable:true};}catch{/* Usage remains available independently of historical finance readiness. */}}
   return mergeProviderUsage(financial,current);
  },
 };
}
