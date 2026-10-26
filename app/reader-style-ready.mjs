import {t,uiReady,onUiLocaleChange,uiHref} from './ui-locale.mjs';

// A packaged reader prefetches full CSS without delaying the shell. The new
// print-only link observes load/error even when the prefetch already failed.
export async function prepareReaderStyles(document,{schedule=setTimeout,cancel=clearTimeout,timeout=30000}={}){
  const preload=document.querySelector('link[data-reader-styles]');
  if(!preload)return;
  const loading=document.getElementById('loading'),status=loading.querySelector('[role="status"]'),retry=loading.querySelector('[data-loading-retry]'),back=loading.querySelector('a'),view=document.defaultView;
  let errorState=false,disposed=false;
  const labels=()=>{if(disposed)return;status.textContent=t(errorState?'reader.shell.loadError':'reader.shell.loading');retry.textContent=t('reader.shell.retryOpen');back.textContent=t('reader.shell.backLibrary');back.dataset.readerUiLink='/library';back.href=uiHref('/library');};
  const offLocale=onUiLocaleChange(labels);labels();void uiReady.then(labels);
  const style=document.createElement('link');style.rel='stylesheet';style.media='print';style.href=preload.href;
  const reopen=()=>view.location.reload();
  let timer,settled=false;
  const stop=()=>{cancel(timer);style.removeEventListener('load',loaded);style.removeEventListener('error',failed);};
  const dispose=()=>{if(disposed)return;disposed=true;stop();offLocale();retry.removeEventListener('click',reopen);view.removeEventListener('pagehide',leaving);};
  const leaving=event=>{if(!event.persisted)dispose();};view.addEventListener('pagehide',leaving);
  let loaded,failed;
  await new Promise((resolve,reject)=>{
    const finish=error=>{
      if(settled||disposed)return;settled=true;stop();
      if(error){style.remove();errorState=true;loading.querySelector('.reading-skeleton').hidden=true;retry.hidden=false;retry.addEventListener('click',reopen);labels();reject(error);return;}
      style.media='all';document.body.dataset.readerStyled='true';dispose();resolve();
    };
    loaded=()=>finish();failed=()=>finish(Error('Reader styles unavailable'));
    timer=schedule(failed,timeout);style.addEventListener('load',loaded);style.addEventListener('error',failed);document.head.append(style);
  });
}
