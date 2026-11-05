import {mountAuthDialog} from './auth-dialog.mjs';
import {safeReaderReturn} from './reader-return.mjs';

const styles=new WeakMap();
function loadStyles(document){
 if(styles.has(document))return styles.get(document);
 const link=document.createElement('link');link.rel='stylesheet';link.href='/auth.css';
 const pending=new Promise(resolve=>{const finish=ready=>{link.removeEventListener('load',loaded);link.removeEventListener('error',failed);if(!ready){link.remove();styles.delete(document);}resolve(ready);};const loaded=()=>finish(true),failed=()=>finish(false);link.addEventListener('load',loaded);link.addEventListener('error',failed);document.head.append(link);});styles.set(document,pending);return pending;
}
async function sharedForm(document,request){
 const response=await request('/library');if(!response.ok)throw Error('Login form unavailable');
 const template=new document.defaultView.DOMParser().parseFromString(await response.text(),'text/html').querySelector('#auth-dialog');
 if(!template)throw Error('Login form unavailable');return document.importNode(template,true);
}

// The existing form/controller own credentials and auth flow. A fresh reader
// document captures the new account instead of mutating the guest's identity.
export function mountReaderLogin({document=globalThis.document,session,getReturnTo,request=globalThis.fetch,navigate=url=>document.defaultView.location.replace(url),loadStyles:styleLoader=loadStyles,loadTemplate=()=>sharedForm(document,request),mountAuth=mountAuthDialog}={}){
 let disposed=false,pending=null,dialog=null,auth=null,opener=null;const cleanup=[];
 const destination=()=>safeReaderReturn(getReturnTo());
 const resume=()=>{const target=destination();if(!disposed&&target)navigate(target);};
 const api=async(url,data)=>{
  if(disposed||!url.startsWith('/api/auth/'))throw Error('Login unavailable');
  const response=await request(url,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{'Content-Type':'application/json'}}),value=await response.json();
  if(disposed)throw Error('Login disposed');if(!response.ok)throw Object.assign(Error(value.error||'Login unavailable'),{...value,status:response.status});return value;
 };
 const ensure=()=>pending??=(async()=>{
  const [ready,form]=await Promise.all([styleLoader(document),loadTemplate()]);if(disposed)return;
  if(!ready)throw Error('Login styles unavailable');dialog=form;dialog.setAttribute('data-reader-login','');document.body.append(dialog);
  auth=mountAuth({dialog,api,getSession:()=>session,getReturnTo:destination,onAuthenticated:resume,onSessionSettled:async()=>{if(disposed)return;const current=await api('/api/auth/session');if(current.user?.id&&!auth.isSettingPasswordFor?.(current.user.id))resume();}});
  const onClose=()=>{if(!disposed&&opener?.isConnected!==false)opener?.focus?.({preventScroll:true});if(!disposed)void api('/api/auth/session').then(current=>{if(current.user?.id)resume();}).catch(()=>{});};
  const close=event=>{event.preventDefault();auth.close();};
  const button=dialog.querySelector('[data-close="auth-dialog"]'),sample=dialog.querySelector('.auth-skip');button?.addEventListener('click',close);sample?.addEventListener('click',close);dialog.addEventListener('close',onClose);
  cleanup.push(()=>button?.removeEventListener('click',close),()=>sample?.removeEventListener('click',close),()=>dialog.removeEventListener('close',onClose));
 })().catch(error=>{pending=null;throw error;});
 return {async open(){if(disposed)return;opener=document.activeElement;await ensure();if(!disposed)auth.open();},dispose(){if(disposed)return;disposed=true;for(const off of cleanup)off();auth?.dispose();dialog?.remove();}};
}
