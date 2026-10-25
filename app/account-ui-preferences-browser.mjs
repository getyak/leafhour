import {classifyUiRoute} from './ui-locale-codec.mjs';
import {createAccountUiPreferencesBridge} from './account-ui-preferences.mjs';
import {createAccountUiPreferencesTransport} from './account-ui-preferences-transport.mjs';
import {createAuthoredUiChoiceHandoff} from './authored-ui-choice.mjs';

// Entry adapter for the one locale runtime. Hosts supply their verified owner;
// no second auth request, active language, reading state or model lives here.
export function createBrowserAccountUiPreferences({runtime,request=globalThis.fetch,document=globalThis.document,view=globalThis.window,getLocation=()=>globalThis.location,storage,timeoutMs=6000}={}){
 const listeners=new Set();let owner,epoch=0,manual=false,disposed=false,outgoing=false,localChoiceApplied=false,accountChoiceApplied=false,bridge,offBridge,pending=Promise.resolve();
 try{storage??=globalThis.sessionStorage;}catch{}
 const handoff=createAuthoredUiChoiceHandoff({storage,getLocation,getOwner:()=>owner});
 const state=()=>({...runtime.getUiLocaleState(),account:bridge.getState()});
 const notify=()=>{if(disposed)return;for(const fn of [...listeners]){try{fn(state());}catch(error){globalThis.reportError?.(error);}}};
 const perform=(method,target,input)=>{
  const captured=epoch;
  if(disposed||target!==owner)return Promise.reject(Object.assign(Error('Account identity changed.'),{status:401}));
  const transport=createAccountUiPreferencesTransport({request,timeoutMs,onSessionChanged:id=>{if(epoch===captured&&id===owner)invalidate();}});
  return transport[method](target,input);
 };
 const createBridge=()=>{bridge=createAccountUiPreferencesBridge({runtime,read:id=>perform('read',id),write:(id,input)=>perform('write',id,input),getLocation});offBridge=bridge.onStatus(notify);};
 createBridge();
 const offCore=runtime.onUiLocaleStateChange(()=>{notify();void applyHandoff();}),offManual=runtime.onUiLocaleManualIntent(()=>{manual=true;handoff.discard();});
 // uiReady also settles on a load failure. A handoff must wait for the actual
 // authored catalogue to succeed, including a later explicit user retry.
 async function applyHandoff(){
  if(disposed||outgoing||manual)return;
  let route;try{route=classifyUiRoute(new URL(getLocation().href).pathname);}catch{return;}
  const core=runtime.getUiLocaleState();
  if(route.kind==='canonical'||core.phase!=='ready'||core.initialFallback||core.effective!==route.code)return;
  if(!localChoiceApplied){
   const choice=handoff.takeLocalChoice({manual});
   if(choice){localChoiceApplied=true;await runtime.requestExplicitRoute(choice.code);return applyHandoff();}
  }
  if(owner===undefined||accountChoiceApplied)return;
  const choice=handoff.consume(owner,{manual});
  if(choice){accountChoiceApplied=true;await runtime.setUiLocale(choice.code);}
 }
 void Promise.resolve(runtime.uiReady).then(applyHandoff);
 function invalidate(){
  epoch++;owner=undefined;offBridge();bridge.dispose();
  void runtime.invalidateUiOwner?.();
  const captured=epoch;
  void runtime.requestAccountUiLocale(null,{isCurrent:()=>!disposed&&epoch===captured&&owner===undefined});
 }
 function adoptOwner(next){
  if(next!==null&&(typeof next!=='string'||!next||next.length>512||/[\u0000-\u001f\u007f]/.test(next)))return Promise.resolve({adopted:false});
  if(disposed)return Promise.resolve({adopted:false});
  if(owner===next&&bridge.getState().phase!=='disposed')return pending;
  const captured=++epoch;owner=next;
  if(bridge.getState().phase==='disposed')createBridge();
  const adoption=bridge.adoptOwner(next);
  const choice=Promise.resolve(runtime.uiReady).then(()=>{
   if(disposed||epoch!==captured||owner!==next)return;
   return applyHandoff();
  });
  pending=Promise.all([adoption,choice]).then(()=>({adopted:!disposed&&epoch===captured&&owner===next}));
  return pending;
 }
 // Public guides have no account controller. This explicit entry check is
 // confined to those authored pages; library/read reuse their own sessions.
 async function verifySupportOwner(){
  let original;try{original=new URL(getLocation().href);}catch{return {verified:false};}
  if(disposed||classifyUiRoute(original.pathname).kind!=='support')return {verified:false};
  const captured=epoch,controller=new AbortController();let timer,identity;
  try{
   identity=await Promise.race([(async()=>{
    const response=await request('/api/auth/session',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    if(!response.ok)return null;
    const value=await response.json();
    if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'user'))return null;
    const id=value.user===null?null:value.user?.id;
    if(id!==null&&(typeof id!=='string'||!id||id.length>512||/[\u0000-\u001f\u007f]/.test(id)))return null;
    return {owner:id};
   })(),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},Number.isFinite(timeoutMs)?Math.max(1,Math.min(15000,timeoutMs)):6000);})]);
  }catch{return {verified:false};}
  finally{clearTimeout(timer);controller.abort();}
  if(!identity||disposed||epoch!==captured||getLocation().href!==original.href)return {verified:false};
  await adoptOwner(identity.owner);return {verified:true};
 }
 const onClick=event=>{const link=event.target?.closest?.('.home-languages a[lang],#home-menu-languages a[lang]');if(link&&handoff.capture(link,event))outgoing=true;};
 const onHide=event=>{if(event.persisted)invalidate();else dispose();};
 const onShow=event=>{if(event.persisted)void verifySupportOwner();};
 const onSessionChanged=()=>invalidate();
 document?.addEventListener?.('click',onClick,{capture:true});
 document?.addEventListener?.('reader:session-changed',onSessionChanged);
 view?.addEventListener?.('pagehide',onHide);view?.addEventListener?.('pageshow',onShow);
 function dispose(){
  if(disposed)return;disposed=true;epoch++;owner=undefined;offCore();offManual();offBridge();bridge.dispose();listeners.clear();
  document?.removeEventListener?.('click',onClick,{capture:true});document?.removeEventListener?.('reader:session-changed',onSessionChanged);view?.removeEventListener?.('pagehide',onHide);view?.removeEventListener?.('pageshow',onShow);
 }
 return {
  adoptOwner,dispose,verifySupportOwner,getUiLocaleState:state,
  onUiLocaleStateChange(fn){if(typeof fn==='function')listeners.add(fn);return()=>listeners.delete(fn);},
  retryUiLocale(){const core=runtime.getUiLocaleState();return core.phase==='error'||core.persistence==='session-only'?runtime.retryUiLocale():bridge.retry();}
 };
}
