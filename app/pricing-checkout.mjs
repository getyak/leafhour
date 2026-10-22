import {createBillingClient,billingLabels} from './billing.mjs';
import {commerceLocale} from './commerce-pages.mjs';
import {createPricingCheckout} from './pricing-checkout-flow.mjs';
import {openEmbeddedCheckout} from './checkout-embed.mjs';

const words={
 en:{loading:'',opening:'Opening secure checkout…',signin:'Sign in to continue with your selected plan.',confirming:'Confirming your payment…',pending:'Payment is not yet confirmed. Select the same plan to continue.',unavailable:'Subscriptions are not open yet. You can keep reading for free.',error:'Checkout could not open. Please try again.',exists:'You already have a subscription. Manage it in your account.',manage:'Manage subscription',changed:'Your account changed. Please select your plan again.',confirm:'Confirm payment',test:'Test checkout. No real payment will be taken.'},
 'zh-Hans':{loading:'',opening:'正在打开安全付款窗口…',signin:'登录后继续所选方案。',confirming:'正在确认付款…',pending:'付款尚未确认，可点原方案继续。',unavailable:'订阅暂未开放，仍可免费阅读。',error:'暂时无法打开付款窗口，请重试。',exists:'你已有订阅，可在账号中管理。',manage:'管理订阅',changed:'账号已切换，请重新选择方案。',confirm:'确认付款',test:'测试付款窗口，不会实际扣款。'},
 'zh-Hant':{loading:'',opening:'正在開啟安全付款視窗…',signin:'登入後繼續所選方案。',confirming:'正在確認付款…',pending:'付款尚未確認，可點原方案繼續。',unavailable:'訂閱暫未開放，仍可免費閱讀。',error:'暫時無法開啟付款視窗，請重試。',exists:'你已有訂閱，可在帳號中管理。',manage:'管理訂閱',changed:'帳號已切換，請重新選擇方案。',confirm:'確認付款',test:'測試付款視窗，不會實際扣款。'},
 ja:{loading:'',opening:'安全な決済画面を開いています…',signin:'ログイン後、選んだプランで続けます。',confirming:'お支払いを確認しています…',pending:'お支払いは未確認です。同じプランを選ぶと続けられます。',unavailable:'定期プランは準備中です。無料で読書を続けられます。',error:'決済画面を開けませんでした。もう一度お試しください。',exists:'すでに定期プランがあります。アカウントから管理できます。',manage:'プランを管理',changed:'アカウントが変わりました。プランを選び直してください。',confirm:'支払いを確認',test:'テスト決済です。実際の請求はありません。'}
};

export async function mountPricingCheckout({document=globalThis.document,window=globalThis.window,openCheckout=openEmbeddedCheckout}={}){
 const status=document?.getElementById('pricing-status');
 if(!status)return null;
 const locale=commerceLocale(document.documentElement.lang),c=words[locale],billing=billingLabels(locale);
 const buttons=[...document.querySelectorAll('[data-pricing-subscribe]')];
 let auth=null,disposed=false,controller,returnOwner=null;
 const client=createBillingClient({onChange:()=>render()});
 const owner=()=>client.snapshot().session?.user?.id||null;
 const active=()=>client.snapshot().subscriptions?.some(s=>!['canceled','cancelled'].includes(s.status));
 function render(){
  if(disposed||!controller)return;
  const state=controller.snapshot(),catalog=client.snapshot().catalog;
  const busy=['loading','opening','checkout','confirming'].includes(state.phase);
  const noProduct=catalog?.enabled===true&&!catalog.products?.some(p=>p.available===true);
  let text=c[state.phase]||'';
  if(state.phase==='ready')text=active()?c.exists:noProduct?c.unavailable:catalog?.mode==='test'?c.test:'';
  if(state.phase==='error')text=state.errorCode==='BILLING_ACCOUNT_CHANGED'?c.changed:state.errorCode==='BILLING_SUBSCRIPTION_EXISTS'?c.exists:state.errorCode==='frozen_account'?billing.frozen:c.error;
  status.replaceChildren(document.createTextNode(text));
  status.setAttribute('role',state.phase==='error'?'alert':'status');
  if(active()){
   const link=document.createElement('a');link.href='/billing?ui='+encodeURIComponent(locale);link.textContent=c.manage;status.append(' ',link);
  }
  if(state.phase==='pending'&&state.orderId&&owner()){
   const confirm=document.createElement('button');confirm.type='button';confirm.className='pricing-confirm';confirm.textContent=c.confirm;confirm.addEventListener('click',()=>{void controller.checkOrder(state.orderId);});status.append(' ',confirm);
  }
  for(const button of buttons){
   const product=catalog?.products?.find(p=>p.key===button.dataset.pricingSubscribe);
   button.disabled=busy||catalog?.enabled!==true||product?.available!==true||!!active();
   button.setAttribute('aria-busy',String(busy&&state.selectedPlan===button.dataset.pricingSubscribe));
  }
  if(order&&/^[A-Za-z0-9_-]{1,160}$/.test(order)&&!owner()&&!busy){
   status.textContent=c.signin;const confirm=document.createElement('button');confirm.type='button';confirm.className='pricing-confirm';confirm.textContent=c.confirm;confirm.addEventListener('click',()=>{void showAuth();});status.append(' ',confirm);
  }
 }
 async function showAuth(){
  if(!auth){
   const {mountAuthDialog}=await import('./auth-dialog.mjs');
   auth=mountAuthDialog({dialog:document.getElementById('auth-dialog'),api:client.authRequest,getSession:()=>client.snapshot().session,getReturnTo:()=>window.location.pathname+window.location.search,
    onAuthenticated:async()=>{await controller.authenticated();await checkReturn();},
    onSessionSettled:async()=>{await client.refreshSession();auth?.updateCapabilities();}
   });
   document.getElementById('billing-auth-close').addEventListener('click',()=>auth.close());
   document.getElementById('auth-dialog').addEventListener('close',()=>controller.cancelSignIn());
  }
  auth.open();
 }
 controller=createPricingCheckout({client,openCheckout,onSignIn:showAuth,onChange:render,locale,navigate:url=>window.location.assign(url)});
 for(const button of buttons)button.addEventListener('click',()=>{void controller.choose(button.dataset.pricingSubscribe);});
 const params=new URLSearchParams(window.location.search),order=params.get('order');
 async function checkReturn(){
  if(!order||!/^[A-Za-z0-9_-]{1,160}$/.test(order))return;
  const actor=owner();if(returnOwner&&returnOwner!==actor)return;
  if(!actor){render();return;}
  returnOwner=actor;await controller.checkOrder(order);
 }
 async function checkIdentity(){
  if(disposed||document.hidden||auth?.hasPendingSessionChange())return;
  const before=owner();try{await client.refreshSession();if(before!==owner()){auth?.reset();await controller.identityChanged();}}
  catch{client.adoptSession({user:null});auth?.reset();await controller.identityChanged();}
 }
 const focus=()=>{void checkIdentity();};
 const visibility=()=>{if(!document.hidden)void checkIdentity();};
 window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);
 const identityTimer=setInterval(focus,30000);
 const dispose=()=>{if(disposed)return;disposed=true;clearInterval(identityTimer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);controller.dispose();auth?.dispose();};
 window.addEventListener('pagehide',dispose,{once:true});
 await controller.initialize();await checkReturn();
 return {client,controller,dispose};
}

if(typeof document!=='undefined'&&document.getElementById('pricing-status'))void mountPricingCheckout();
