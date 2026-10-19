import {t,onUiLocaleChange,uiReady} from './ui-locale.mjs';
// Keep the complete metadata catalog for search/order; create cards only as needed.
export function mountIncrementalShelf({grid,controls,renderItem}){
  const doc=grid.ownerDocument,view=doc.defaultView,batch=12;
  const summary=doc.createElement('p'),button=doc.createElement('button'),sentinel=doc.createElement('span');
  summary.className='shelf-more-summary';summary.setAttribute('role','status');
  button.type='button';button.className='outline';button.setAttribute('aria-controls',grid.id);
  sentinel.className='shelf-more-sentinel';sentinel.setAttribute('aria-hidden','true');
  controls.replaceChildren(summary,button,sentinel);
  let items=[],count=0,scope,observer=null,frame=null,version=0,destroyed=false;
  const more=()=>count<items.length;
  const offLocale=onUiLocaleChange(()=>{if(!destroyed)sync();});void uiReady.then(()=>{if(!destroyed)sync();});
  function disconnect(){
    version++;observer?.disconnect();observer=null;
    if(frame!==null)view.cancelAnimationFrame(frame);frame=null;
  }
  function sync(){
    controls.hidden=items.length===0;button.hidden=!more();sentinel.hidden=!more();
    summary.textContent=more()?t('ix.shown',{count,total:items.length}):t('ix.all',{total:items.length});
    button.textContent=t('ix.more',{count:Math.min(batch,items.length-count)});
    if(!more())observer?.disconnect();
  }
  function append(manual=false){
    if(destroyed||!more())return;
    const start=count,focusNew=manual&&doc.activeElement===button;
    count=Math.min(items.length,count+batch);
    grid.append(...items.slice(start,count).map(renderItem));sync();
    if(focusNew)grid.children[start]?.querySelector('a[href],button,[tabindex]')?.focus();
  }
  function observe(){
    if(typeof view.IntersectionObserver!=='function'||!more())return;
    const ticket=version;
    observer=new view.IntersectionObserver(entries=>{
      if(ticket!==version||destroyed||frame!==null||!more()||!entries.some(entry=>entry.isIntersecting))return;
      frame=view.requestAnimationFrame(()=>{
        frame=null;if(ticket!==version||destroyed)return;
        append();
        // Recheck a short list that still fits the viewport; each frame adds one batch.
        if(more()){observer.unobserve(sentinel);observer.observe(sentinel);}
      });
    },{rootMargin:'480px 0px'});
    observer.observe(sentinel);
  }
  const onClick=()=>{
    if(frame!==null){view.cancelAnimationFrame(frame);frame=null;}
    append(true);
  };
  button.addEventListener('click',onClick);
  return {
    setItems(next,{key='',anchorId=null}={}){
      if(destroyed)return;
      const reset=key!==scope;let wanted=reset?batch:Math.max(batch,count);
      disconnect();scope=key;items=[...next];
      const anchor=reset?-1:items.findIndex(book=>book.bookId===anchorId);
      if(anchor>=wanted)wanted=Math.ceil((anchor+1)/batch)*batch;
      count=Math.min(wanted,items.length);
      grid.replaceChildren(...items.slice(0,count).map(renderItem));sync();observe();
    },
    destroy(){destroyed=true;offLocale();disconnect();button.removeEventListener('click',onClick);}
  };
}
