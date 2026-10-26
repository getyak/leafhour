import {uiReady,t,onUiLocaleChange} from './ui-locale.mjs';
import {otherOverlayOpen,focusableTrigger} from './popover-controls.mjs';

// One user-open import, one shared popover handle and one mounted enhancement.
// Late code is reusable, but callbacks belong to a primitive source/owner stamp.
// Metadata retry never starts generation, gifting or a second overlay registry.
export function mountReaderBookActionsBootstrap({document,info,getBook,api,session,bookId,getOwner=()=>session?.user?.id||'guest',loadEnhancement=()=>import('./reader-book-actions.mjs')}){
  const status=document.getElementById('book-intro-status'),retry=document.getElementById('book-intro-retry'),view=document.defaultView||globalThis;
  let generation=0,pending=null,shared=null,mounted=null,disposed=false,unsubscribe=()=>{},statusId=null,enhancementOwnsStatus=false,timer=null;
  const identity=()=>[getBook()?.bookId,getBook()?.contentVersion,getOwner()].join('\0');
  const paint=()=>{
    if(retry){retry.textContent=t('bookActions.retry');retry.hidden=statusId!=='loadFailure';}
    if(status){status.textContent=statusId?t('bookActions.'+statusId):'';status.setAttribute('role',statusId==='loadFailure'?'alert':'status');}
  };
  const updateLabels=()=>{if(!disposed&&!enhancementOwnsStatus)paint();};
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();
  const reset=()=>{if(mounted||enhancementOwnsStatus)return;statusId=null;paint();};
  const invalidate=()=>{generation++;clearTimeout(timer);pending=null;reset();};
  const current=stamp=>!disposed&&stamp[0]===generation&&stamp[1]===identity();
  const fail=()=>{
    clearTimeout(timer);pending=null;enhancementOwnsStatus=false;statusId='loadFailure';paint();
  };
  function request(){
    if(disposed||mounted||pending||!info.isOpen()||!getBook())return;
    const stamp=[++generation,identity()];pending=stamp;
    statusId='preparing';paint();
    timer=setTimeout(()=>{if(current(stamp)){generation++;fail();}},15000);
    const promise=shared||(shared=(async()=>loadEnhancement())());
    // Consume both import and synchronous setup failure. The enhancement rolls
    // back partial listeners itself; a later explicit retry is therefore safe.
    promise.then(async module=>{
      await uiReady;if(!current(stamp)||!info.isOpen())return;
      if(!focusableTrigger(info.trigger)||otherOverlayOpen(document,info.element)){fail();return;}
      clearTimeout(timer);enhancementOwnsStatus=true;statusId=null;
      paint();
      const handle=module.mountReaderBookActions({document,info,getBook,api,session,bookId});
      if(!current(stamp)){handle?.dispose?.();return;}
      mounted=handle;pending=null;
    }).catch(()=>{if(shared===promise)shared=null;if(current(stamp))fail();});
  }
  const onRetry=()=>{info.element?.focus({preventScroll:true});request();};
  retry?.addEventListener('click',onRetry);
  unsubscribe=info.subscribe({onChange:open=>{if(open)request();else invalidate();}});
  const onReady=()=>{
    if(pending&&!current(pending)){invalidate();request();}
  };
  const events=['reader:ready','reader:chapter'];for(const event of events)document.addEventListener(event,onReady);
  document.addEventListener('reader:session-changed',dispose);view.addEventListener?.('pagehide',dispose);
  function dispose(){
    if(disposed)return;disposed=true;invalidate();
    for(const event of events)document.removeEventListener(event,onReady);
    document.removeEventListener('reader:session-changed',dispose);view.removeEventListener?.('pagehide',dispose);
    unsubscribe();offLocale();retry?.removeEventListener('click',onRetry);
    mounted?.dispose();mounted=null;enhancementOwnsStatus=false;reset();
  }
  return {clear(){invalidate();mounted?.clear();},dispose};
}
