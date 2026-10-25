import {isUiPreference,resolveUiPreference,browserUiLocale,readUiParam,UI_PREFERENCE_KEY,UI_SESSION_PREFERENCE_KEY} from './ui-locale-codec.mjs';

const destinations={en:'/en','zh-Hans':'/zh-hans','zh-Hant':'/zh-hant',ja:'/ja'};
function accountChoice(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const keys=Object.keys(value);
 if(keys.length!==3||keys.some(k=>!['revision','updatedAt','uiLocale'].includes(k)))return null;
 if(!Number.isSafeInteger(value.revision)||value.revision<0)return null;
 if(value.uiLocale!==null&&!isUiPreference(value.uiLocale))return null;
 if(value.revision===0){if(value.updatedAt!==null||value.uiLocale!==null)return null;}
 else if(typeof value.updatedAt!=='string'||!value.updatedAt||value.updatedAt.length>64||!Number.isFinite(Date.parse(value.updatedAt)))return null;
 return value.uiLocale;
}

// The automatic root entry owns one navigation, no preference or auth writes.
// Authored documents and business routes keep their existing lifecycle.
export async function enterAutoHome({
 location=globalThis.location,view=globalThis.window,storage,sessionStorage,
 languages=globalThis.navigator?.languages?.length?globalThis.navigator.languages:[globalThis.navigator?.language].filter(Boolean),request=globalThis.fetch,
 timeoutMs=2000,accountTimeoutMs=5000
}={}){
 let original;
 try{original=new URL(location?.href);}catch{return {kind:'continue',reason:'no-location'};}
 if(original.pathname!=='/')return {kind:'continue',reason:'explicit-route'};
 const active=view?.document?.activeElement;
 if(active?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(active?.tagName))return {kind:'continue',reason:'interacted'};
 const query=readUiParam(original.href),controller=new AbortController();
 let interacted=false,timer=null,device=null,releaseInteraction;
 const interaction=new Promise(resolve=>{releaseInteraction=resolve;});
 const events=['pointerdown','keydown','compositionstart','pagehide','hashchange','popstate'];
 const mark=()=>{interacted=true;controller.abort();releaseInteraction(null);};
 for(const type of events)view?.addEventListener?.(type,mark,{capture:true});
 view?.document?.addEventListener?.('reader:session-changed',mark,{capture:true});
 try{
  try{const value=(storage===undefined?globalThis.localStorage:storage)?.getItem?.(UI_PREFERENCE_KEY);if(isUiPreference(value))device=value;}catch{}
  try{const value=(sessionStorage===undefined?globalThis.sessionStorage:sessionStorage)?.getItem?.(UI_SESSION_PREFERENCE_KEY);if(isUiPreference(value))device=value;}catch{}
  let code=query.status==='valid'?query.code:null;
  if(!code&&typeof request==='function'){
   // Guests retain the short identity deadline. Only a verified owner gets a
   // preference + owner-recheck window using the remaining five-second budget.
   const now=()=>globalThis.performance?.now?.()??Date.now(),absoluteDeadline=now()+5000;
   let deadlineAt,expire;
   const arm=duration=>{
    if(timer!==null)clearTimeout(timer);
    deadlineAt=Math.min(absoluteDeadline,now()+duration);
    timer=setTimeout(expire,Math.max(0,deadlineAt-now()));
   };
   const deadline=new Promise(resolve=>{expire=()=>{controller.abort();resolve(null);};arm(Number.isFinite(timeoutMs)?Math.max(1,Math.min(5000,timeoutMs)):2000);});
   const expired=()=>{
    if(controller.signal.aborted)return true;
    if(now()>=deadlineAt){expire();return true;}
    return false;
   };
   const read=async()=>{
    const options={method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal};
    const identity=await request('/api/auth/session',options);
    if(!identity.ok)return null;
    const user=(await identity.json())?.user;
    if(typeof user?.id!=='string'||!user.id||user.id.length>512||/[\u0000-\u001f\u007f]/.test(user.id))return null;
    // A late identity response must never revive a timed-out attempt, even
    // when its fetch implementation ignores abort or timer delivery is late.
    if(expired())return null;
    arm(Number.isFinite(accountTimeoutMs)?Math.max(1,Math.min(5000,accountTimeoutMs)):5000);
    const response=await request('/api/account/ui-preferences',{...options,headers:{'X-Reader-Owner':user.id}});
    const choice=response.ok?accountChoice(await response.json()):null;
    if(!choice||expired())return null;
    // The cookie may have changed while the preference response was in flight.
    // Recheck the captured owner inside the same deadline, before navigation.
    const current=await request('/api/auth/session',options);
    if(!current.ok)return null;
    const currentOwner=(await current.json())?.user?.id;
    return !expired()&&currentOwner===user.id?choice:null;
   };
   code=await Promise.race([Promise.resolve().then(read).catch(()=>null),deadline,interaction]);
   if(expired())code=null;
  }
  const preference=resolveUiPreference({account:code,device}).preference;
  code=preference==='system'?browserUiLocale(languages):preference;
  if(interacted||location.href!==original.href)return {kind:'continue',reason:interacted?'interacted':'navigated'};
  const target=new URL(original.href);target.pathname=destinations[code];
  try{location.replace(target.pathname+target.search+target.hash);}catch{return {kind:'continue',reason:'navigation-unavailable'};}
  return {kind:'redirected',locale:code};
 }finally{
  if(timer!==null)clearTimeout(timer);
  controller.abort();
  for(const type of events)view?.removeEventListener?.(type,mark,{capture:true});
  view?.document?.removeEventListener?.('reader:session-changed',mark,{capture:true});
 }
}
