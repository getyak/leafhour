import {readerInteractionBlocked} from './reader-conversation.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';
import {handoffReadingToolFocus} from './reading-toolbar.mjs';

// Immersion is a page layout. Browser fullscreen is requested only by a user action.
// GET-184: the floating #exit-focus/#focus-fullscreen pair is gone; the pill
// reveals both tools surfaces through the explicit show/close hooks below and
// fullscreen failure or concealment restores focus to the visible pill fallback.
export function mountReaderImmersion({document,announce=()=>{},beforeLayout=()=>null,afterLayout=()=>{},onToolsLayout=()=>{},focusReturn=null,onToolsCloseRequest=null}){
  const header=document.getElementById('reading-header'),headerScreen=document.getElementById('enter-focus'),setting=document.getElementById('immersive-reading'),exit=document.getElementById('reader-exit-fullscreen');
  const supported=typeof document.documentElement.requestFullscreen==='function'&&document.fullscreenEnabled!==false;
  let focused=true,toolsOpen=false,pending=false,disposed=false,composing=false;
  let cancelToolFocus=()=>{};
  const listeners=[];
  const listen=(target,name,fn,options)=>{const owned=event=>{if(!disposed)fn(event);};target.addEventListener(name,owned,options);listeners.push(()=>target.removeEventListener(name,owned,options));};
  const visible=target=>!!target&&typeof target.focus==='function'&&target.isConnected!==false&&!target.hidden;
  function restoreToolFocus(){
    if(disposed)return;
    const pill=focusReturn?.();
    if(visible(pill))pill.focus({preventScroll:true});
    else if(visible(headerScreen)&&!header?.inert)headerScreen.focus({preventScroll:true});
  }
  function updateLabels(){
    if(disposed)return;
    const full=!!document.fullscreenElement;
    // The icon stays; only the optional text label is rebound.
    const label=headerScreen.querySelector?.('.quiet-label')||headerScreen;
    label.textContent=t(full?'reader.fullscreen.exit':'reader.fullscreen.short');
    headerScreen.setAttribute('aria-label',t(full?'reader.fullscreen.exit':'reader.fullscreen.enter'));
  }
  const offLocale=onUiLocaleChange(updateLabels);
  function sync(){
    if(disposed)return;
    const full=!!document.fullscreenElement,hidden=focused&&!toolsOpen;
    document.body.classList.toggle('is-focused',focused);document.body.dataset.readingTools=toolsOpen?'open':'closed';document.body.dataset.fullscreen=String(full);
    header.inert=hidden;header.setAttribute('aria-hidden',String(hidden));
    headerScreen.hidden=!supported&&!full;if(exit){const hidden=!full||toolsOpen,restore=exit===document.activeElement&&hidden;exit.hidden=hidden;if(restore)restoreToolFocus();}setting.checked=focused;
    headerScreen.setAttribute('aria-pressed',String(full));updateLabels();
  }
  // GET-184 coordinator ownership: every close request routes through the one
  // tools coordinator so toolbar.expanded and the header state cannot split.
  const requestToolsClose=target=>onToolsCloseRequest?onToolsCloseRequest(target):closeTools();
  function setFocused(value){
    if(disposed)return;
    const anchor=beforeLayout();requestToolsClose();focused=!!value;sync();afterLayout(anchor);
    document.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused}}));
  }
  function showTools({focus=true}={}){if(disposed||toolsOpen)return false;const wakeEdge=document.activeElement===document.getElementById('reader-top-edge');toolsOpen=true;sync();onToolsLayout();if(focus)cancelToolFocus=handoffReadingToolFocus({document,target:()=>header.querySelector('a[href],button:not([disabled]):not([hidden])'),current:()=>!disposed&&toolsOpen&&!header.inert,allowHiddenOpener:wakeEdge});return true;}
  function closeTools({restoreFocus=false}={}){cancelToolFocus();if(disposed||!toolsOpen)return false;toolsOpen=false;sync();onToolsLayout();if(restoreFocus)restoreToolFocus();return true;}
  function toggleTools(options){return toolsOpen?closeTools():showTools(options);}
  async function changeFullscreen(enter){
    if(disposed||pending||!enter&&!document.fullscreenElement)return false;
    const anchor=beforeLayout(),restoreFocus=visible(document.activeElement)&&(document.activeElement===headerScreen||header?.contains(document.activeElement));requestToolsClose();pending=true;focused=true;sync();
    let failed=false;
    try{
      if(!enter)await document.exitFullscreen();
      else if(supported)await document.documentElement.requestFullscreen({navigationUI:'hide'});
      else throw Error('Fullscreen unavailable');
      return !disposed&&!!document.fullscreenElement===enter;
    }catch{failed=!!document.fullscreenElement!==enter;if(failed&&!disposed)announce(t('reader.fullscreen.unavailable'));return !disposed&&!failed;}
    // GET-184: a fullscreen failure always lands on the visible pill, never a
    // removed floating control.
    finally{pending=false;if(!disposed){sync();afterLayout(anchor);if(failed||restoreFocus)restoreToolFocus();}}
  }
  const toggleFullscreen=()=>changeFullscreen(!document.fullscreenElement),exitFullscreen=()=>changeFullscreen(false);
  // Called by the existing reader key owner AFTER its overlays have had Escape.
  // Browser close requests may exit without delivering a key to the page.
  function handleKeydown(event){
    if(disposed||composing||event.defaultPrevented||event.isComposing||event.keyCode===229||event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.target?.isContentEditable||event.target?.closest?.('input,textarea,select,[contenteditable]'))return false;
    if(event.key==='Escape')return exitFullscreen();
    if(event.key?.toLowerCase()==='f'){event.preventDefault();return toggleFullscreen();}
    return false;
  }
  listen(document,'compositionstart',()=>composing=true);
  listen(document,'compositionend',()=>composing=false);
  listen(headerScreen,'click',toggleFullscreen);
  if(exit)listen(exit,'click',exitFullscreen);
  listen(setting,'change',()=>setFocused(setting.checked));
  listen(document,'fullscreenchange',()=>{if(document.body.dataset.fullscreen!==String(!!document.fullscreenElement))requestToolsClose();sync();afterLayout(null);});
  listen(document,'fullscreenerror',sync);
  let gesture=null;
  const inside=target=>header.contains(target)||!!target?.closest?.('#reading-session');
  listen(document,'pointerdown',event=>{gesture={id:event.pointerId,type:event.pointerType,inside:inside(event.target),x:event.clientX||0,y:event.clientY||0,cancelled:event.button!==0||event.isPrimary===false||readerInteractionBlocked(document,event.target)};},true);
  listen(document,'pointermove',event=>{if(gesture&&gesture.id===event.pointerId&&Math.hypot((event.clientX||0)-gesture.x,(event.clientY||0)-gesture.y)>8)gesture.cancelled=true;},true);
  listen(document,'pointercancel',()=>{if(gesture)gesture.cancelled=true;},true);
  listen(document,'pointerup',event=>{if(gesture?.id===event.pointerId)gesture.touchEnd=gesture.type==='touch';},true);
  listen(document,'click',event=>{
    const previous=gesture;gesture=null;
    if((!toolsOpen&&!onToolsCloseRequest)||event.button>0||inside(event.target)||readerInteractionBlocked(document,event.target))return;
    // WebKit may emit touch(0) -> compatibility mouse click(1). Only a matched,
    // released touch gesture receives that exception; cancellation/move still win.
    if(event.detail===0||previous&&!previous.inside&&!previous.cancelled&&(event.pointerId===undefined||previous.id===event.pointerId||previous.touchEnd&&event.pointerType==='mouse'))requestToolsClose(event.target);
  },true);
  sync();return {setFocused,toggleTools,showTools,closeTools,toggleFullscreen,exitFullscreen,handleKeydown,restoreToolFocus,unmount(){if(disposed)return;disposed=true;cancelToolFocus();offLocale();for(const release of listeners)release();listeners.length=0;}};
}
