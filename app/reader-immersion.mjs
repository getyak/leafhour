import {readerInteractionBlocked} from './reader-conversation.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';

// Immersion is a page layout. Browser fullscreen is requested only by a user action.
// GET-184: the floating #exit-focus/#focus-fullscreen pair is gone; the pill
// reveals both tools surfaces through the explicit show/close hooks below and
// fullscreen failure or concealment restores focus to the visible pill fallback.
export function mountReaderImmersion({document,announce=()=>{},beforeLayout=()=>null,afterLayout=()=>{},focusReturn=null,onToolsCloseRequest=null}){
  const header=document.getElementById('reading-header'),headerScreen=document.getElementById('enter-focus'),setting=document.getElementById('immersive-reading');
  const supported=typeof document.documentElement.requestFullscreen==='function'&&document.fullscreenEnabled!==false;
  let focused=true,toolsOpen=false,pending=false,disposed=false;
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
    headerScreen.hidden=!supported;setting.checked=focused;
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
  function showTools({focus=true}={}){if(disposed||toolsOpen)return false;toolsOpen=true;sync();if(focus)header.querySelector('a[href],button:not([disabled]):not([hidden])')?.focus({preventScroll:true});return true;}
  function closeTools({restoreFocus=false}={}){if(disposed||!toolsOpen)return false;toolsOpen=false;sync();if(restoreFocus)restoreToolFocus();return true;}
  function toggleTools(options){return toolsOpen?closeTools():showTools(options);}
  async function toggleFullscreen(){
    if(disposed||pending)return false;
    const anchor=beforeLayout(),restoreFocus=visible(document.activeElement)&&(document.activeElement===headerScreen||header?.contains(document.activeElement));requestToolsClose();pending=true;focused=true;sync();
    let failed=false;
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(supported)await document.documentElement.requestFullscreen({navigationUI:'hide'});
      else throw Error('Fullscreen unavailable');
      return !disposed;
    }catch{failed=true;if(!disposed)announce(t('reader.fullscreen.unavailable'));return false;}
    // GET-184: a fullscreen failure always lands on the visible pill, never a
    // removed floating control.
    finally{pending=false;if(!disposed){sync();afterLayout(anchor);if(failed||restoreFocus)restoreToolFocus();}}
  }
  listen(headerScreen,'click',toggleFullscreen);
  listen(setting,'change',()=>setFocused(setting.checked));
  listen(document,'fullscreenchange',()=>{sync();afterLayout(null);});
  listen(document,'pointerdown',event=>{
    if(!toolsOpen||readerInteractionBlocked(document,event.target)||event.target.closest('.reading-header'))return;
    requestToolsClose(event.target);
  });
  sync();return {setFocused,toggleTools,showTools,closeTools,toggleFullscreen,restoreToolFocus,unmount(){if(disposed)return;disposed=true;offLocale();for(const release of listeners)release();listeners.length=0;}};
}
