// Progressive enhancement: content is visible before and without this module.
// The library shares the document but must never mount the homepage motion.
export function mountHomeMotion(root,win=root?.ownerDocument?.defaultView){
  if(!root||root.hidden||!win?.IntersectionObserver||!win.Element?.prototype.animate)return ()=>{};
  const doc=root.ownerDocument,preference=win.matchMedia('(prefers-reduced-motion: reduce)');
  const seen=new WeakSet(),active=new Map();
  const selectors='.reading-promise, .section-copy, .sample-sheet, .daily-copy, .page-detail, .section-top, .ownership-section > div, .closing';
  const shelf=root.querySelector('#featured-books');
  let observer=null,changes=null,disposed=false;
  const stop=()=>{
    observer?.disconnect();changes?.disconnect();observer=null;changes=null;
    for(const animation of active.values())animation.cancel();active.clear();
  };
  const watchCards=()=>{
    if(!observer)return;
    for(const card of shelf?.querySelectorAll('.book-card')||[])if(!seen.has(card))observer.observe(card);
  };
  const start=()=>{
    stop();if(disposed||preference.matches||doc.hidden||root.hidden)return;
    observer=new win.IntersectionObserver(entries=>{
      if(preference.matches||doc.hidden||!observer)return;
      let index=0;
      for(const entry of entries){
        if(!entry.isIntersecting||seen.has(entry.target))continue;
        const element=entry.target;seen.add(element);observer.unobserve(element);
        if(element.contains(doc.activeElement))continue;
        // Focus follows pointerdown. Cancelling a moving link here would make
        // pointerup land on its parent, so interactive hit areas never translate.
        const actionable='a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
        const interactive=element.matches(actionable)||element.querySelector(actionable);
        const frames=interactive?[{opacity:.65},{opacity:1}]:[{opacity:.65,translate:'0 12px'},{opacity:1,translate:'0 0'}];
        const animation=element.animate(frames,{
          duration:420,delay:Math.min(index++*50,100),fill:'backwards',easing:'cubic-bezier(.22,1,.36,1)'
        });
        active.set(element,animation);
        const finished=()=>{if(active.get(element)===animation)active.delete(element);};
        animation.finished.then(finished,finished);
      }
    },{threshold:.08,rootMargin:'0px 0px 32px 0px'});
    for(const element of root.querySelectorAll(selectors))if(!seen.has(element))observer.observe(element);
    watchCards();
    if(shelf&&win.MutationObserver){changes=new win.MutationObserver(watchCards);changes.observe(shelf,{childList:true});}
  };
  const focus=event=>{
    // A keyboard user can act immediately, even during a staggered entrance.
    for(const [element,animation] of active)if(element.contains(event.target)){animation.cancel();active.delete(element);}
  };
  preference.addEventListener('change',start);doc.addEventListener('visibilitychange',start);
  win.addEventListener('pagehide',stop);win.addEventListener('pageshow',start);root.addEventListener('focusin',focus);
  start();
  return ()=>{
    disposed=true;stop();preference.removeEventListener('change',start);doc.removeEventListener('visibilitychange',start);
    win.removeEventListener('pagehide',stop);win.removeEventListener('pageshow',start);root.removeEventListener('focusin',focus);
  };
}

if(typeof document!=='undefined')mountHomeMotion(document.getElementById('home-view'));
