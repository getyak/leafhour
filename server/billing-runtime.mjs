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
export async function createBillingRuntime({env=process.env,dataDir,store,creem,publicOrigin=env.READER_PUBLIC_ORIGIN||'http://localhost:3000'}={}){
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
