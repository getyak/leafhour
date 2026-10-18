import {otherOverlayOpen,focusableTrigger} from './popover-controls.mjs';

// GET-173 real user-open lazy bookplate enhancement. The common popover
// controller stays eagerly bundled and immediately usable; this bootstrap is
// statically imported only by the reader page and loads exactly
// ./reader-book-actions.mjs once, on actual book-info open or an explicit
// retry, injecting the page's one shared popover handle so the external module
// can never create a second registry copy. One shared import promise and one
// mounted enhancement per page. Every open or retry captures one monotonic
// generation with the primitive book identity and owner, and a late module
// after cancellation is only cached code: it may not mount DOM, read or call
// introduction/quote/history APIs, move focus or attach stale listeners.
export function mountReaderBookActionsBootstrap({document,info,getBook,api,session,bookId,getOwner=()=>session?.user?.id||'guest',loadEnhancement=()=>import('./reader-book-actions.mjs')}){
  const status=document.getElementById('book-intro-status'),retry=document.getElementById('book-intro-retry'),view=document.defaultView||globalThis;
  let generation=0,pending=null,shared=null,mounted=null,disposed=false,unsubscribe=()=>{};
  // Resetting the loading/retry state on every close or reset keeps the next
  // open coherent; a mounted enhancement owns its own status text.
  const reset=()=>{if(mounted)return;pending=null;if(status)status.textContent='';if(retry)retry.hidden=true;};
  const invalidate=()=>{generation++;pending=null;reset();};
  const current=stamp=>!disposed&&stamp.generation===generation&&stamp.bookId===(getBook()?.bookId??null)&&stamp.version===(getBook()?.contentVersion??null)&&stamp.owner===getOwner();
  const fail=()=>{
    pending=null;
    if(retry)retry.hidden=false;
    if(status){status.setAttribute('role','alert');status.textContent='简介与分享暂时无法载入，可以重试。';}
  };
  function request(){
    if(disposed||mounted||pending)return;
    const book=getBook();
    if(!info.isOpen()||!book)return;
    const stamp={generation:++generation,bookId:book.bookId,version:book.contentVersion,owner:getOwner()};
    pending=stamp;
    if(retry)retry.hidden=true;
    if(status){status.setAttribute('role','status');status.textContent='正在准备简介与分享…';}
    // One shared import promise started on the first real request; a failed
    // load or setup is consumed and cleared so the next explicit retry or
    // close/reopen imports once again.
    const promise=shared||(shared=(async()=>loadEnhancement())());
    // The whole load-and-mount chain is consumed: a synchronous enhancement
    // setup throw is never an unhandled rejection and rolls back to honest
    // retry feedback with every partial listener already detached by the
    // enhancement's own setup rollback.
    promise.then(module=>{
      if(!current(stamp))return;
      if(!info.isOpen()||!focusableTrigger(info.trigger))return;
      // A newer overlay keeps this request honest: retry feedback without
      // moving focus, and never mounting over another surface.
      if(otherOverlayOpen(document,info.element)){fail();return;}
      // Hand status ownership over before mounting: the enhancement may
      // synchronously announce a pending introduction read during subscribe.
      if(status){status.textContent='';status.setAttribute('role','status');}
      const handle=module.mountReaderBookActions({document,info,getBook,api,session,bookId});
      // A mount that completed after its stamp went stale is rolled back
      // instead of kept, so retry can never duplicate a poisoned ready.
      if(!current(stamp)){handle?.dispose?.();return;}
      mounted=handle;
      pending=null;
    }).catch(()=>{
      if(shared===promise)shared=null;
      if(current(stamp))fail();
    });
  }
  retry?.addEventListener('click',()=>request());
  unsubscribe=info.subscribe({onChange:open=>{if(open)request();else invalidate();}});
  const onReady=()=>invalidate();
  const onLeave=()=>dispose();
  document.addEventListener('reader:ready',onReady);
  // The product announces account/session change immediately before its
  // /library redirect; this existing event is the only owner boundary here.
  document.addEventListener('reader:session-changed',onLeave);
  view.addEventListener?.('pagehide',onLeave);
  function dispose(){
    if(disposed)return;
    disposed=true;
    generation++;pending=null;
    document.removeEventListener('reader:ready',onReady);
    document.removeEventListener('reader:session-changed',onLeave);
    view.removeEventListener?.('pagehide',onLeave);
    unsubscribe();
    if(mounted){mounted.dispose();mounted=null;}
    reset();
  }
  return {
    clear(){generation++;if(mounted)mounted.clear();reset();},
    dispose
  };
}
