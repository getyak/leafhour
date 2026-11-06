import {createUiMessage,t} from './ui-locale.mjs';

// Presentation only: retain the form's original live region and recovery
// controls. These timers never dispatch work or own the autosave queue.
export function mountSaveFeedback({document,status,retry,recover,getOwner=()=>null,timers=globalThis,translate=t}={}){
 const root=document.createElement('div');root.className='settings-save-feedback';root.hidden=true;root.append(status,retry,recover);
 let ticket=0,hold=null,fade=null,disposed=false;
 const sync=()=>{if(!disposed)root.hidden=!status.textContent&&retry.hidden&&recover.hidden;};
 const message=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('error',!!error);status.setAttribute('role',error?'alert':'status');status.setAttribute('aria-live',error?'assertive':'polite');status.setAttribute('aria-atomic','true');sync();},translate);
 const cancel=()=>{if(hold!==null)timers.clearTimeout(hold);if(fade!==null)timers.clearTimeout(fade);hold=fade=null;};
 const schedule=(fn,ms)=>{const id=timers.setTimeout(fn,ms);id?.unref?.();return id;};
 function clear(){if(disposed)return;ticket++;cancel();root.dataset.phase='idle';message.clear();}
 function set(id,params,error=false){
  if(disposed)return;const current=++ticket;cancel();root.dataset.phase='visible';message.set(id,params,error);
  if(id!=='prefs.saved'||error)return;
  const owner=getOwner(),currentMessage=()=>!disposed&&ticket===current&&getOwner()===owner;
  hold=schedule(()=>{hold=null;if(!currentMessage())return;root.dataset.phase='dismissing';fade=schedule(()=>{fade=null;if(!currentMessage())return;clear();},160);},1500);
 }
 return {root,set,clear,refresh(){if(!disposed)message.refresh();},sync,dispose(){if(disposed)return;clear();disposed=true;root.hidden=true;}};
}
