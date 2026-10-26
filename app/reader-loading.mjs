import {t,onUiLocaleChange} from './ui-locale.mjs';

// The text-column placeholder is already in HTML. It needs no illustration,
// catalogue, animation, private content or extra request to become visible.
export function mountReaderLoading(root,{schedule=setTimeout,cancel=clearTimeout}={}){
  const status=root.querySelector('[role="status"]'),retry=root.querySelector('[data-loading-retry]');
  let sequence=0,pending=false,disposed=false,timer;
  const clear=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
  const labels=()=>{status.textContent=t('reader.shell.loading');retry.textContent=t('reader.shell.retryOpen');};
  const reopen=()=>{if(!disposed&&pending)root.ownerDocument.defaultView.location.reload();};
  retry.addEventListener('click',reopen);
  const offLocale=onUiLocaleChange(labels);labels();
  return {
    start(){
      if(disposed)return null;
      clear();const ticket=++sequence;pending=true;root.hidden=false;retry.hidden=true;
      timer=schedule(()=>{if(!disposed&&pending&&ticket===sequence)retry.hidden=false;},8000);
      return ticket;
    },
    finish(ticket){
      if(disposed||!pending||ticket!==sequence)return false;
      pending=false;clear();root.hidden=true;retry.hidden=true;return true;
    },
    dispose(){if(disposed)return;disposed=true;pending=false;clear();offLocale();retry.removeEventListener('click',reopen);}
  };
}
