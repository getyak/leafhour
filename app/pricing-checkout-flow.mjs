const plans=new Set(['reading_monthly_100','reading_yearly_1200']);
const owner=client=>client.snapshot().session?.user?.id||null;
const unpaid=order=>plans.has(order?.productKey)&&!['paid','completed','fulfilled','refunded','partially_refunded','disputed','cancelled','canceled','failed','expired'].includes(order.status);
const verified=order=>order?.paymentVerified===true&&['paid','completed','fulfilled'].includes(order.status);
const blocked=subscription=>!['canceled','cancelled'].includes(subscription?.status);
const issue=code=>Object.assign(new Error(code),{code});

// The provider callback changes presentation only. The local owner-bound order
// must be reconciled by the server before leaving the pricing page.
export function createPricingCheckout({client,openCheckout,onSignIn=async()=>{},navigate=()=>{},onChange=()=>{},locale='en',libraryHref=()=>'/library?ui='+encodeURIComponent(locale),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollAttempts=12}={}){
 let generation=0,handle=null,disposed=false;
 const state={phase:'loading',selectedPlan:null,errorCode:null,orderId:null};
 const snapshot=()=>({...state});
 const emit=(phase,errorCode=null)=>{if(disposed)return;Object.assign(state,{phase,errorCode});onChange(snapshot());};
 const close=()=>{const current=handle;handle=null;current?.close?.();};
 const current=(ticket,actor)=>!disposed&&ticket===generation&&owner(client)===actor;
 function forgetIdentity(){generation++;state.selectedPlan=null;state.orderId=null;close();emit('error','BILLING_ACCOUNT_CHANGED');}
 function checkpoint(ticket,actor){if(disposed||ticket!==generation)return false;if(owner(client)!==actor){forgetIdentity();return false;}return true;}
 function failed(error,ticket){if(disposed||ticket!==generation)return;if(error.code==='BILLING_ACCOUNT_CHANGED')forgetIdentity();else emit('error',error.code||'BILLING_REQUEST_FAILED');}
 const available=key=>{const c=client.snapshot().catalog;return c?.enabled===true&&c.products?.some(p=>p.key===key&&p.available===true);};
 async function privateState(){await client.loadSubscriptions();await client.loadOrders();}
 async function initialize(){
  const ticket=generation;emit('loading');
  try{
   await Promise.all([client.refreshSession(),client.loadCatalog()]);
   if(disposed||ticket!==generation)return;
   if(owner(client)&&client.snapshot().catalog?.enabled){const actor=owner(client);await privateState();if(!checkpoint(ticket,actor))return;}
   emit(client.snapshot().catalog?.enabled?'ready':'unavailable');
  }catch(error){failed(error,ticket);}
 }
 async function reconcile(order,ticket,actor){
  if(!checkpoint(ticket,actor))return;emit('confirming');
  try{
   for(let attempt=0;attempt<pollAttempts;attempt++){
    const result=await client.recheckOrder(order.id);
    if(!checkpoint(ticket,actor))return;
    if(result?.id!==order.id)throw issue('BILLING_INVALID_ORDER');
    if(verified(result)){emit('done');navigate(libraryHref());return;}
    if(['refunded','partially_refunded','disputed','cancelled','canceled','failed','expired'].includes(result.status)){emit('error','BILLING_PAYMENT_NOT_COMPLETED');return;}
    if(attempt+1<pollAttempts)await delay(2500);
    if(!checkpoint(ticket,actor))return;
   }
   emit('pending');
  }catch(error){if(error.code==='BILLING_ACCOUNT_CHANGED')failed(error,ticket);else if(checkpoint(ticket,actor))emit('pending',error.code||'BILLING_REQUEST_FAILED');}
 }
 async function openOwned(result,ticket,actor,plan){
  const order=result.order||result;
   if(!order?.id||!order.checkoutId||!plans.has(order.productKey)||order.productKey!==plan)throw issue('BILLING_INVALID_CHECKOUT');
   state.orderId=order.id;let completed=false;
   const opened=await openCheckout({checkoutUrl:result.checkoutUrl,locale,isCurrent:()=>current(ticket,actor),
    onComplete:async detail=>{
     if(completed||!checkpoint(ticket,actor)||detail?.checkoutId!==order.checkoutId)return;
     completed=true;close();await reconcile(order,ticket,actor);
    },
    onClose:()=>{if(!completed&&checkpoint(ticket,actor))emit('pending');}
   });
   if(!checkpoint(ticket,actor)||completed){opened?.close?.();return;}
   handle=opened;emit('checkout');
 }
 async function choose(plan){
  if(disposed||['opening','checkout','confirming'].includes(state.phase))return;
  if(!plans.has(plan)){emit('error','BILLING_INVALID_PRODUCT');return;}
  if(!available(plan)){emit('unavailable');return;}
  state.selectedPlan=plan;const ticket=++generation,previousOwner=owner(client);emit('opening');
  try{
   await client.refreshSession();
   if(disposed||ticket!==generation)return;
   if(previousOwner&&owner(client)!==previousOwner){forgetIdentity();return;}
   const actor=owner(client);
   if(!actor){emit('signin');await onSignIn();return;}
   await privateState();if(!checkpoint(ticket,actor))return;
   await client.loadAccount();if(!checkpoint(ticket,actor))return;
   if(client.snapshot().account?.frozen)throw issue('frozen_account');
   if(client.snapshot().subscriptions?.some(blocked))throw issue('BILLING_SUBSCRIPTION_EXISTS');
   const pending=client.snapshot().orders.find(unpaid);
   if(pending&&pending.productKey!==plan)throw issue('BILLING_SUBSCRIPTION_EXISTS');
   const result=pending?await client.resumeCheckout(pending.id):await client.checkout(plan);
   if(!checkpoint(ticket,actor))return;
   await openOwned(result,ticket,actor,plan);
  }catch(error){failed(error,ticket);}
 }
 async function resumeOrder(id){
  if(disposed||['opening','checkout','confirming'].includes(state.phase))return;
  const ticket=++generation,previousOwner=owner(client);emit('opening');
  try{
   await client.refreshSession();if(disposed||ticket!==generation)return;
   if(previousOwner&&owner(client)!==previousOwner){forgetIdentity();return;}
   const actor=owner(client);if(!actor)throw issue('BILLING_SIGN_IN_REQUIRED');
   const result=await client.resumeCheckout(id);if(!checkpoint(ticket,actor))return;
   if(client.snapshot().account?.frozen)throw issue('frozen_account');
   state.selectedPlan=result.productKey;await openOwned(result,ticket,actor,result.productKey);
  }catch(error){failed(error,ticket);}
 }
 async function authenticated(){const selected=state.selectedPlan,ticket=generation;await initialize();if(!disposed&&ticket===generation&&state.selectedPlan===selected&&state.phase==='ready'&&selected&&owner(client))await choose(selected);}
 async function identityChanged(){generation++;state.selectedPlan=null;state.orderId=null;close();await initialize();}
 return {snapshot,initialize,choose,resumeOrder,authenticated,identityChanged,
  cancelSignIn(){if(state.phase==='signin'){state.selectedPlan=null;emit('ready');}},
  checkOrder:async id=>{const actor=owner(client);if(!actor)return;state.orderId=id;const ticket=++generation;await reconcile({id},ticket,actor);},
  dispose(){if(disposed)return;disposed=true;generation++;close();}
 };
}
