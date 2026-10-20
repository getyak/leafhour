import {classifyUiRoute,isUiLocale} from './ui-locale-codec.mjs';
export const AUTHORED_UI_CHOICE_KEY='leafhour.ui.locale.navigation.v1';
const validOwner=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
// Native full-document links keep authored prose. A session handoff records
// the actual click; only a matching independently verified destination owner
// may turn it into an account commit. Unknown identity permits device only.
export function createAuthoredUiChoiceHandoff({storage,getLocation=()=>globalThis.location,getOwner=()=>undefined,now=Date.now}={}){
 const clear=()=>storage?.removeItem(AUTHORED_UI_CHOICE_KEY);
 function capture(link,event={}){
  if(event.defaultPrevented||event.button!==undefined&&event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link?.hasAttribute?.('download')||link?.target&&link.target!=='_self')return false;
  try{
   const source=new URL(getLocation().href),target=new URL(link.href,source),owner=getOwner(),createdAt=now(),verified=owner!==undefined;
   if(source.pathname!=='/'&&classifyUiRoute(source.pathname).kind==='canonical')return false;
   const route=classifyUiRoute(target.pathname);
   if(target.origin!==source.origin||route.kind==='canonical'||route.code!==link.lang||!isUiLocale(link.lang)||verified&&!validOwner(owner)||!Number.isSafeInteger(createdAt)||createdAt<0)return false;
   storage?.setItem(AUTHORED_UI_CHOICE_KEY,JSON.stringify({version:1,code:route.code,path:target.pathname,owner:verified?owner:null,verified,createdAt}));
   return typeof storage?.setItem==='function';
  }catch{return false;}
 }
 function read(){
  const raw=storage?.getItem(AUTHORED_UI_CHOICE_KEY);if(raw===null||raw===undefined)return null;
  if(typeof raw!=='string'||raw.length>2048)return null;
  const row=JSON.parse(raw),keys=row&&typeof row==='object'&&!Array.isArray(row)?Object.keys(row):[];
  if(keys.length!==6||keys.some(key=>!['version','code','path','owner','verified','createdAt'].includes(key)))return null;
  const location=new URL(getLocation().href),age=now()-row.createdAt;
  if(row.version!==1||!isUiLocale(row.code)||!validOwner(row.owner)||typeof row.verified!=='boolean'||!row.verified&&row.owner!==null||row.path!==location.pathname||classifyUiRoute(row.path).code!==row.code||!Number.isSafeInteger(row.createdAt)||row.createdAt<0||!Number.isFinite(age)||age< -5000||age>90000)return null;
  return row;
 }
 function consume(owner,{manual=false}={}){
  try{const row=read();clear();return !manual&&validOwner(owner)&&row?.verified&&row.owner===owner?{code:row.code}:null;}catch{try{clear();}catch{}return null;}
 }
 function takeLocalChoice({manual=false}={}){
  try{const row=read();if(manual||!row){clear();return null;}if(!row.verified)clear();return {code:row.code};}catch{try{clear();}catch{}return null;}
 }
 function discard(){try{clear();}catch{}}
 return {capture,consume,takeLocalChoice,discard};
}
