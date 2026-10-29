import {overlayOpen} from './popover-controls.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';

import {cancelReadingToolFocus} from './reading-tool-focus.mjs';
export {handoffReadingToolFocus,cancelReadingToolFocus} from './reading-tool-focus.mjs';

// Visibility is independent of the reading clock and never records activity.
export function createReadingToolbarState({onChange=()=>{}}={}) {
  let expanded=false,preview=false,timer,disposed=false;
  const holds=new Set();
  function cancel(){clearTimeout(timer);timer=undefined;}
  function conceal(options){cancel();holds.clear();if(disposed||!expanded)return;expanded=false;onChange(false,options);}
  function arm(){cancel();if(!disposed&&expanded&&!holds.size)timer=setTimeout(conceal,preview?200:5000);}
  return {
    get expanded(){return expanded;},
    get preview(){return preview;},
    reveal({preview:next=false}={}){if(disposed)return;const changed=!expanded||preview&&!next;preview=expanded&&!preview?false:next;expanded=true;if(changed)onChange(true,{preview});arm();},
    conceal,
    hold(reason,value){if(disposed||holds.has(reason)===value)return;if(value)holds.add(reason);else holds.delete(reason);arm();},
    unmount(){disposed=true;cancel();holds.clear();}
  };
}

// mountReadingToolbar owns the single pill click handler and the single
// conceal timer (200ms preview grace or five-second explicit idle). A coordinator drives both surfaces
// only through the explicit hooks returned here; there is no second timer.
export function mountReadingToolbar(root,{onExpandedChange=()=>{},header=null,document=root.ownerDocument||globalThis.document}={}) {
  const trigger=root.querySelector('#reading-tools-trigger'),panel=root.querySelector('#reading-tools-panel'),close=root.querySelector('#reading-tools-close'),label=root.querySelector('#reading-tools-label'),notice=root.querySelector('#reading-tools-notice');
  let keyboard=false,status='idle',attention=false,draftCount=0,focused=false;
  let revealFocus=true,disposed=false;
  const listeners=[];
  const listen=(target,name,fn,options)=>{const owned=event=>{if(!disposed)fn(event);};target.addEventListener(name,owned,options);listeners.push(()=>target.removeEventListener(name,owned,options));};
  const reveal=(focus=true,preview=false)=>{revealFocus=focus;toolbar.reveal({preview});};
  const toolbar=createReadingToolbarState({onChange(expanded,{restoreFocus=true,preview=false}={}){
    if(!expanded)cancelReadingToolFocus(document);
    // Focus must never remain inside a concealed, inert panel.
    if(!expanded&&restoreFocus&&root.contains(document.activeElement))trigger.focus({preventScroll:true});
    panel.inert=!expanded;
    panel.setAttribute('aria-hidden',String(!expanded));
    root.dataset.expanded=String(expanded);
    updateLabel();
    // Pointer previews never request focus; explicit click/keyboard may.
    onExpandedChange(expanded,{focus:expanded&&revealFocus,preview,restoreFocus});
  }});
  function updateText(){
    if(disposed)return;
    label.textContent=t(attention?'reader.tools.unsaved':status==='active'?'reader.tools.active':'reader.tools.idle');
    const details=[status==='active'?t('reader.tools.clockActive'):status==='paused'?t('reader.tools.clockPaused'):'',attention?t('reader.tools.pending'):'',draftCount?t('reader.tools.drafts',{count:draftCount}):''].filter(Boolean).join(t('reader.tools.separator'));
    const named=t('reader.tools.'+(toolbar.expanded?'expanded':'expand')+(focused&&!toolbar.preview?'Navigation':''));
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
  const inside=target=>root.contains(target)||header?.contains(target);
  const focusHold=()=>{if(!disposed)toolbar.hold('keyboard',inside(document.activeElement)&&(keyboard||!!document.activeElement?.closest?.('input,textarea,select,[contenteditable=true]')));};
  for(const node of [trigger,panel,header,root.querySelector('#reading-tools-chat-slot')].filter(Boolean)){
    const reason=node===header?'header-pointer':'pointer';
    listen(node,'pointerenter',event=>{if(event.pointerType!=='mouse')return;if(focused)return;if(node===trigger&&!toolbar.expanded&&!overlayOpen(document))reveal(false,true);if(toolbar.expanded&&(node!==header||!toolbar.preview))toolbar.hold(reason,true);});
    listen(node,'pointerleave',event=>{if(event.pointerType==='mouse'&&!node.contains(event.relatedTarget)&&!(node!==header&&(trigger.contains(event.relatedTarget)||panel.contains(event.relatedTarget))))toolbar.hold(reason,false);});
  }
  listen(trigger,'click',event=>{if(toolbar.expanded&&!toolbar.preview)toolbar.conceal();else reveal(event.detail!==1);});
  listen(panel,'click',event=>{if(!event.target.closest('#reading-tools-close,[data-tools-handoff]')&&!overlayOpen(document))reveal(false);});
  listen(panel,'wheel',()=>{if(toolbar.expanded)reveal(false);},{passive:true});
  listen(panel,'scroll',()=>{if(toolbar.expanded&&!toolbar.preview)toolbar.reveal();},{passive:true});
  listen(close,'click',()=>toolbar.conceal());
  listen(document,'keydown',event=>{if(['Tab','Enter',' '].includes(event.key)){keyboard=true;focusHold();}},true);
  listen(document,'pointerdown',event=>{keyboard=false;focusHold();if(event.pointerType!=='mouse')toolbar.hold('pointer',false);if(panel.contains(event.target)){reveal(false);toolbar.hold('gesture',true);}},true);
  for(const name of ['pointerup','pointercancel'])listen(document,name,()=>{toolbar.hold('gesture',false);focusHold();},true);
  listen(document,'pointercancel',()=>{toolbar.hold('pointer',false);toolbar.hold('header-pointer',false);},true);
  listen(document,'selectionchange',()=>{const selection=document.getSelection?.();toolbar.hold('selection',!!selection&&!selection.isCollapsed&&(panel.contains(selection.anchorNode)||panel.contains(selection.focusNode)));});
  listen(root,'focusin',focusHold);
  listen(root,'focusout',()=>queueMicrotask(focusHold));
  if(header){listen(header,'focusin',focusHold);listen(header,'focusout',()=>queueMicrotask(focusHold));}
  listen(document,'keydown',event=>{
    if(event.key==='Escape'&&toolbar.expanded&&!event.defaultPrevented&&!event.isComposing&&!overlayOpen(document)){
      event.preventDefault();const nested=[...panel.querySelectorAll?.('details[open]')||[]].at(-1);
      if(nested){nested.open=false;nested.querySelector('summary')?.focus();}else toolbar.conceal();
    }
  });
  // Dialogs and book info return focus to their opener. Keep that same tools
  // surface available, including while an optional enhancement loads slowly.
  const handed=new Set();
  listen(document,'beforetoggle',event=>{if(event.newState==='open'&&inside(document.activeElement))handed.add(event.target);},true);
  const overlayHold=()=>{if(disposed)return;const open=[...document.querySelectorAll('dialog[open],[popover][data-popover-open]')];for(const node of handed)if(!open.includes(node))handed.delete(node);toolbar.hold('overlay',open.some(node=>handed.has(node)||[...root.querySelectorAll?.('[aria-controls],[popovertarget]')||[],...header?.querySelectorAll?.('[aria-controls],[popovertarget]')||[]].some(trigger=>[trigger.getAttribute('aria-controls'),trigger.getAttribute('popovertarget')].includes(node.id))));};
  // Audio creates its dialog later; the shared popover controller owns its
  // marker in both native and fallback browsers. Closing releases this hold.
  const observer=new MutationObserver(overlayHold);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','data-popover-open']});
  overlayHold();
  const suspend=()=>{if(toolbar.preview)toolbar.conceal();else{toolbar.hold('pointer',false);toolbar.hold('header-pointer',false);toolbar.hold('gesture',false);toolbar.hold('suspended',true);}};
  const resume=()=>{toolbar.hold('suspended',false);focusHold();};
  if(document.defaultView){listen(document.defaultView,'blur',suspend);listen(document.defaultView,'focus',resume);}
  listen(document,'visibilitychange',()=>document.hidden?suspend():resume());
  for(const name of ['reader:chapter','reader:ready','reader:session-changed'])listen(document,name,()=>toolbar.conceal());
  panel.inert=true;panel.setAttribute('aria-hidden','true');root.dataset.expanded='false';
  updateLabel();
  return {update(values){
    let changed=false;
    if(values.status!==undefined&&values.status!==status){status=values.status;changed=true;}
    if(values.attention!==undefined&&values.attention!==attention){attention=values.attention;changed=true;}
    if(values.draftCount!==undefined&&values.draftCount!==draftCount){draftCount=values.draftCount;changed=true;}
    if(changed)updateLabel();
  },
  get expanded(){return toolbar.expanded;},
  reveal,
  conceal:toolbar.conceal,
  hold:toolbar.hold,
  setControlMode:mode=>{focused=mode==='focused';updateLabel();},
  unmount(){if(disposed)return;toolbar.conceal();disposed=true;offLocale();observer.disconnect?.();toolbar.unmount();handed.clear();for(const release of listeners)release();listeners.length=0;}};
}
