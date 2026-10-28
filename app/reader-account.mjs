import {deviceBookStore} from './offline-reading.mjs';
import {t,onUiLocaleChange,uiHref} from './ui-locale.mjs';
import {focusableTrigger} from './popover-controls.mjs';

// An optional reader surface. Identity, requests and the logout transition stay
// with the captured reader session; this surface never fetches another owner.
export function mountReaderAccount({document,trigger,session,request,loginHref,onSignedOut=()=>{const win=document.defaultView;document.dispatchEvent(new win.Event('reader:session-changed'));win.location.assign(uiHref('/library'));}}){
 const make=(tag,id)=>{const n=document.createElement(tag);if(id)n.id=id;return n;};
 const dialog=make('dialog','reader-account');dialog.className='reader-account';dialog.setAttribute('aria-labelledby','reader-account-title');
 const heading=make('header'),title=make('h2','reader-account-title'),close=make('button','reader-account-close');close.type='button';close.autofocus=true;heading.append(title,close);
 const name=make('p','reader-account-name'),email=make('p','reader-account-email'),consequence=make('p','reader-account-consequence');
 const actions=make('div');actions.className='reader-account-actions';
 const login=make('a','reader-account-login'),logout=make('button','reader-account-logout'),cancel=make('button','reader-account-cancel');logout.type=cancel.type='button';
 const status=make('p','reader-account-status');status.setAttribute('role','status');actions.append(login,cancel,logout);dialog.append(heading,name,email,consequence,actions,status);document.body.append(dialog);
 const listeners=[];let disposed=false,confirming=false,busy=false,failed=false;
 const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
 function paint(){
  if(disposed)return;
  const user=session?.user;login.href=loginHref();
  title.textContent=t(confirming?'shell.account.logoutConfirm.title':'shell.settings.tab.account');close.textContent=t('reader.shell.close');
  name.textContent=user?.displayName||user?.email?.split('@')[0]||t('shell.account.title.guest');email.textContent=user?.email||'';email.hidden=!user?.email;
  consequence.hidden=!confirming;consequence.textContent=t('shell.account.logoutConfirm.consequence');
  login.hidden=!!user;login.textContent=t('shell.account.login');
  logout.hidden=!user;logout.disabled=busy;logout.textContent=t(busy?'shell.account.loggingOut':confirming?'shell.account.logoutConfirm.action':'shell.account.logout');
  cancel.hidden=!confirming;cancel.disabled=busy;cancel.textContent=t('shell.account.logoutConfirm.cancel');
  status.textContent=failed?t('ui.generic.error'):'';
 }
 const offLocale=onUiLocaleChange(paint);
 const restore=()=>{trigger.setAttribute('aria-expanded','false');if(focusableTrigger(trigger))trigger.focus({preventScroll:true});};
 listen(close,'click',()=>dialog.close());listen(dialog,'close',restore);
 listen(dialog,'keydown',event=>{
  if(event.key!=='Tab'||event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
  const controls=[close,login,cancel,logout].filter(n=>!n.hidden&&!n.disabled),index=controls.indexOf(document.activeElement);
  event.preventDefault();controls[event.shiftKey?(index<=0?controls.length-1:index-1):(index+1)%controls.length].focus({preventScroll:true});
 });
 listen(dialog,'click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
 listen(cancel,'click',()=>{confirming=false;failed=false;paint();logout.focus({preventScroll:true});});
 listen(logout,'click',async()=>{
  if(disposed||busy||!session?.user)return;
  if(!confirming){confirming=true;failed=false;paint();cancel.focus({preventScroll:true});return;}
  busy=true;failed=false;paint();
  try{
   await deviceBookStore().clear().catch(()=>{});
   const response=await request('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   if(!response.ok||(await response.json()).signedOut!==true)throw Error('LOGOUT_UNCONFIRMED');
   if(!disposed)onSignedOut();
  }catch{if(!disposed){failed=true;}}
  finally{if(!disposed){busy=false;paint();}}
 });
 paint();
 return {
  open(){if(disposed)return;confirming=false;failed=false;paint();if(!dialog.open)dialog.showModal();trigger.setAttribute('aria-expanded','true');close.focus({preventScroll:true});},
  unmount(){if(disposed)return;disposed=true;offLocale();for(const off of listeners)off();if(dialog.open)dialog.close();dialog.remove();trigger.setAttribute('aria-expanded','false');}
 };
}
