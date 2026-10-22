import {safeCheckoutUrl} from './billing.mjs';

let scriptReady=null;
const problem=code=>Object.assign(new Error(code),{code});

// Official loader: https://docs.creem.io/features/checkout/embedded-checkout
// Load it only after an explicit choice and an owner-bound checkout response.
function loadSdk(){
 if(globalThis.Creem?.openCheckout&&globalThis.Creem?.close)return Promise.resolve(globalThis.Creem);
 if(scriptReady)return scriptReady;
 scriptReady=new Promise((resolve,reject)=>{
  const script=document.createElement('script');let timer;
  const fail=()=>{clearTimeout(timer);script.remove();scriptReady=null;reject(problem('BILLING_EMBED_UNAVAILABLE'));};
  script.src='https://www.creem.io/embed.js';script.async=true;script.referrerPolicy='no-referrer';
  script.onerror=fail;script.onload=()=>{
   if(!globalThis.Creem?.openCheckout||!globalThis.Creem?.close){fail();return;}
   clearTimeout(timer);resolve(globalThis.Creem);
  };
  timer=setTimeout(fail,15000);document.head.append(script);
 });
 return scriptReady;
}

export function createCheckoutEmbed({loadSdk:load=loadSdk}={}){
 return async function open({checkoutUrl,locale='en',onComplete,onClose,isCurrent=()=>true}={}){
  const valid=safeCheckoutUrl(checkoutUrl);
  if(!valid||new URL(valid).port)throw problem('BILLING_INVALID_CHECKOUT');
  const sdk=await load();
  if(!isCurrent())throw problem('BILLING_ACCOUNT_CHANGED');
  let closed=false,handle;
  const close=()=>{if(closed)return;closed=true;if(handle?.close)handle.close();else sdk.close();};
  handle=sdk.openCheckout({checkoutUrl:valid,locale,
   theme:globalThis.document?.documentElement?.dataset?.theme==='dark'?'dark':'light',
   onComplete:detail=>onComplete?.({checkoutId:detail?.checkoutId}),
   onClose:()=>{if(closed)return;closed=true;onClose?.();}
  });
  return {close};
 };
}

export const openEmbeddedCheckout=createCheckoutEmbed();
