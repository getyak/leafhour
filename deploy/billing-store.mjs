// Financial mutations go through one database transaction, never the library CAS.
const commands=new Set(['readiness','account','trial','quote','reserve','operation','running','result','settle','release','reverse','ackPublished','order','checkoutAttempt','checkout','expireCheckout','getOrder','lookupOrder','payment','refund','dispute','entries','orders','providerCall','summary','recover','bindSubscription','lookupSubscription','subscriptions','subscriptionState','subscriptionPaid']);
const ownerless=new Set(['readiness','summary','lookupOrder','lookupSubscription']);
const statuses={invalid_input:400,invalid_mode:400,unknown_command:400,invalid_receipt:400,insufficient_credits:402,owner_mismatch:403,frozen_account:403,not_found:404,idempotency_conflict:409,event_conflict:409,stale_quote:409,quote_changed:409,quote_already_used:409,stale_worker:409,payment_mismatch:409,invalid_state:409,subscription_exists:409,trial_budget_exhausted:503};
const messages={invalid_input:'Invalid billing request',insufficient_credits:'Insufficient reading credits',owner_mismatch:'Billing access denied',frozen_account:'Paid generation is currently unavailable for this account',not_found:'Billing record not found',idempotency_conflict:'This billing request conflicts with an existing request',stale_quote:'This quote has expired or changed',invalid_state:'This billing operation cannot change state'};
function failure(code='billing_unavailable'){
  return Object.assign(new Error(messages[code]||'Billing is temporarily unavailable'),{code,status:statuses[code]||503});
}

export function createBillingPostgresStore({env=process.env,fetcher=fetch}={}){
  let base;
  try{base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname))throw Error();}catch{throw failure();}
  const secret=env.SUPABASE_SECRET_KEY;
  if(typeof secret!=='string'||!secret||typeof fetcher!=='function')throw failure();
  const headers={'Content-Type':'application/json',apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})};
  async function command(action,payload){
    if(!commands.has(action)||!payload||Array.isArray(payload)||!['test','live'].includes(payload.mode)||!ownerless.has(action)&&(typeof payload.ownerId!=='string'||!payload.ownerId||payload.ownerId.length>200))throw failure('invalid_input');
    let body;
    try{body=JSON.stringify({command_name:action,command_payload:payload});if(Buffer.byteLength(body)>65536)throw Error();}catch{throw failure('invalid_input');}
    for(let attempt=0;attempt<3;attempt++){
      let response,data;
      try{
        response=await fetcher(base.origin+'/rest/v1/rpc/reader_billing_command',{method:'POST',headers,body,signal:AbortSignal.timeout(45000)});
        data=await response.json();
      }catch{throw failure();}
      if(response.ok)return data;
      // Only a database-declared rollback is safe to retry automatically. Network
      // failures can be ambiguous; callers retry with their original command IDs.
      if(['40001','40P01'].includes(data?.code)&&attempt<2)continue;
      if(data?.code==='P0001'&&typeof data.message==='string'&&data.message.startsWith('reader_billing:')){
        const code=data.message.slice('reader_billing:'.length);
        if(Object.hasOwn(statuses,code))throw failure(code);
      }
      throw failure();
    }
    throw failure();
  }
  return {durable:true,command};
}
