// Header fallback and the optional hub share one keyboard intent. A control
// with a rectangle may still be visibility:hidden on the first transition
// frame, in which case native focus() silently does nothing.
const focusHandoffs=new WeakMap();
export function cancelReadingToolFocus(document){focusHandoffs.get(document)?.();}
export function handoffReadingToolFocus({document,target,blocked,current=()=>true,allowHiddenOpener=false}){
  if(typeof blocked!=='function')throw new TypeError('Reading tool focus requires a blocking guard');
  cancelReadingToolFocus(document);
  const view=document.defaultView,opener=document.activeElement,listeners=[];
  let cancelled=false,delivering=false,frame,timer,frames=0;
  const cancel=()=>{if(cancelled)return;cancelled=true;view?.cancelAnimationFrame?.(frame);if(timer!==undefined)(view?.clearTimeout?.bind(view)||clearTimeout)(timer);for(const off of listeners)off();if(focusHandoffs.get(document)===cancel)focusHandoffs.delete(document);};
  const listen=(node,name,fn)=>{if(!node?.addEventListener)return;node.addEventListener(name,fn,true);listeners.push(()=>node.removeEventListener(name,fn,true));};
  const usable=node=>{
    if(!node||node.isConnected===false||node.disabled||node.hidden||node.closest?.('[hidden],[inert],dialog:not([open])'))return false;
    if(node.getClientRects&&!node.getClientRects().length)return false;
    for(let part=node;part;part=part.parentElement){
      if(part.inert||part.hidden)return false;
      const style=view?.getComputedStyle?.(part);
      if(style&&(style.display==='none'||['hidden','collapse'].includes(style.visibility)||Number(style.opacity)===0))return false;
    }
    const rect=node.getBoundingClientRect?.();
    return !rect||rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<(view?.innerHeight??Infinity)&&rect.left<(view?.innerWidth??Infinity);
  };
  const tick=()=>{
    if(cancelled)return;
    // The top wake edge hides itself on reveal. Native hidden-element blur
    // silently lands on body; actual newer focus/input events still cancel.
    const nativeBlur=allowHiddenOpener&&document.activeElement===document.body&&!usable(opener);
    if(!current()||document.hidden||document.activeElement!==opener&&!nativeBlur||blocked()||++frames>90){cancel();return;}
    const node=target();
    if(usable(node)){
      delivering=true;try{node.focus({preventScroll:true});}finally{delivering=false;}
      if(document.activeElement===node){cancel();return;}
    }
    if(view?.requestAnimationFrame)frame=view.requestAnimationFrame(tick);else cancel();
  };
  focusHandoffs.set(document,cancel);
  for(const name of ['keydown','pointerdown','beforeinput','input','compositionstart','wheel','touchstart','reader:chapter','reader:ready','reader:session-changed'])listen(document,name,cancel);
  listen(document,'focusin',()=>{if(!delivering)cancel();});
  listen(document,'beforetoggle',event=>{if(event.newState==='open')cancel();});
  listen(document,'visibilitychange',()=>{if(document.hidden)cancel();});listen(view,'blur',event=>{if(event.target===view)cancel();});
  // This is a cleanup deadline, not a delay before focusing. It also releases
  // listeners when a background browser suspends animation frames entirely.
  if(view?.requestAnimationFrame){timer=(view.setTimeout?.bind(view)||setTimeout)(cancel,1200);timer?.unref?.();frame=view.requestAnimationFrame(tick);}else tick();
  return cancel;
}
