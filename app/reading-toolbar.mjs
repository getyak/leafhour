import {overlayOpen} from './popover-controls.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';
// Visibility is independent of the reading clock and never records activity.
export function createReadingToolbarState({onChange=()=>{}}={}) {
  let expanded=false,timer,disposed=false;
  const holds=new Set();
  function cancel(){clearTimeout(timer);timer=undefined;}
  function conceal(){cancel();if(disposed||!expanded)return;expanded=false;onChange(false);}
  function arm(){cancel();if(!disposed&&expanded&&!holds.size)timer=setTimeout(conceal,5000);}
  return {
    get expanded(){return expanded;},
    reveal(){if(disposed)return;if(!expanded){expanded=true;onChange(true);}arm();},
    conceal,
    hold(reason,value){if(disposed||holds.has(reason)===value)return;if(value)holds.add(reason);else holds.delete(reason);arm();},
    unmount(){disposed=true;cancel();holds.clear();}
  };
}

// mountReadingToolbar owns the single pill click handler and the single
// five-second conceal timer. A tools coordinator drives both reader surfaces
// only through the explicit hooks returned here; there is no second timer.
export function mountReadingToolbar(root,{onExpandedChange=()=>{},document=root.ownerDocument||globalThis.document}={}) {
  const trigger=root.querySelector('#reading-tools-trigger'),panel=root.querySelector('#reading-tools-panel'),close=root.querySelector('#reading-tools-close'),label=root.querySelector('#reading-tools-label'),notice=root.querySelector('#reading-tools-notice');
  let keyboard=false,status='idle',attention=false,draftCount=0,hoverPreview=false,controlMode='unfocused';
  let revealFocus=true,disposed=false;
  const listeners=[];
  const listen=(target,name,fn,options)=>{const owned=event=>{if(!disposed)fn(event);};target.addEventListener(name,owned,options);listeners.push(()=>target.removeEventListener(name,owned,options));};
  const reveal=(focus=true)=>{revealFocus=focus;toolbar.reveal();};
  const toolbar=createReadingToolbarState({onChange(expanded){
    // Focus must never remain inside a concealed, inert panel.
    if(!expanded&&panel.contains(document.activeElement))trigger.focus({preventScroll:true});
    panel.inert=!expanded;
    panel.setAttribute('aria-hidden',String(!expanded));
    root.dataset.expanded=String(expanded);
    if(!expanded)hoverPreview=false;
    updateLabel();
    // Pointer previews never request focus; explicit click/keyboard may.
    onExpandedChange(expanded,{focus:expanded&&revealFocus});
  }});
  function updateText(){
    if(disposed)return;
    label.textContent=t(attention?'reader.tools.unsaved':status==='active'?'reader.tools.active':'reader.tools.idle');
    const details=[status==='active'?t('reader.tools.clockActive'):status==='paused'?t('reader.tools.clockPaused'):'',attention?t('reader.tools.pending'):'',draftCount?t('reader.tools.drafts',{count:draftCount}):''].filter(Boolean).join(t('reader.tools.separator'));
    const named=t('reader.tools.'+(toolbar.expanded?'expanded':'expand')+(controlMode==='focused'?'Navigation':''));
    trigger.setAttribute('aria-label',named+(details?t('reader.tools.separator')+details:''));
    trigger.title=t('reader.tools.hint')+(details?' · '+details:'');
    notice.textContent=attention?t('reader.tools.notice'):'';
  }
  const offLocale=onUiLocaleChange(updateText);
  function updateLabel(){
    if(disposed)return;
    root.dataset.attention=String(attention);
    root.dataset.reading=status;
    trigger.setAttribute('aria-expanded',String(toolbar.expanded));
    updateText();
  }
  const focusHold=()=>{if(!disposed)toolbar.hold('keyboard',keyboard&&panel.contains(document.activeElement));};
  listen(trigger,'pointerenter',event=>{if(event.pointerType==='mouse'&&!toolbar.expanded){hoverPreview=true;reveal(false);}});
  listen(root,'pointerenter',event=>{if(event.pointerType==='mouse')toolbar.hold('pointer',true);});
  listen(root,'pointerleave',event=>{if(event.pointerType==='mouse')toolbar.hold('pointer',false);});
  listen(trigger,'click',()=>{if(toolbar.expanded&&!hoverPreview)toolbar.conceal();else{hoverPreview=false;reveal(true);}});
  listen(panel,'click',event=>{if(!event.target.closest('#reading-tools-close,[data-tools-handoff]')&&!overlayOpen(document))toolbar.reveal();});
  listen(close,'click',()=>toolbar.conceal());
  listen(document,'keydown',event=>{if(event.key==='Tab'){keyboard=true;focusHold();}},true);
  listen(document,'pointerdown',()=>{keyboard=false;focusHold();},true);
  listen(root,'focusin',focusHold);
  listen(root,'focusout',()=>queueMicrotask(focusHold));
  listen(root,'keydown',event=>{
    if(event.key==='Escape'&&toolbar.expanded){event.preventDefault();event.stopPropagation();toolbar.conceal();}
  });
  // Dialogs and book info return focus to their opener. Keep that same tools
  // surface available, including while an optional enhancement loads slowly.
  const overlayHold=()=>{if(!disposed)toolbar.hold('overlay',overlayOpen(document));};
  // Audio creates its dialog later; the shared popover controller owns its
  // marker in both native and fallback browsers. Closing releases this hold.
  const observer=new MutationObserver(overlayHold);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','data-popover-open']});
  overlayHold();
  panel.inert=true;panel.setAttribute('aria-hidden','true');root.dataset.expanded='false';
  updateLabel();
  return {update(values){
    if(values.status!==undefined)status=values.status;
    if(values.attention!==undefined)attention=values.attention;
    if(values.draftCount!==undefined)draftCount=values.draftCount;
    updateLabel();
  },
  get expanded(){return toolbar.expanded;},
  reveal,
  conceal:toolbar.conceal,
  hold:toolbar.hold,
  setControlMode:mode=>{controlMode=mode==='focused'?'focused':'unfocused';updateLabel();},
  unmount(){if(disposed)return;disposed=true;offLocale();observer.disconnect?.();toolbar.unmount();for(const release of listeners)release();listeners.length=0;}};
}
