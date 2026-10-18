import {readerInteractionBlocked} from './reader-conversation.mjs';

// Immersion is a page layout. Browser fullscreen is requested only by a user action.
// GET-184: the floating #exit-focus/#focus-fullscreen pair is gone; the pill
// reveals both tools surfaces through the explicit show/close hooks below and
// fullscreen failure or concealment restores focus to the visible pill fallback.
export function mountReaderImmersion({document,announce=()=>{},beforeLayout=()=>null,afterLayout=()=>{},focusReturn=null,onToolsCloseRequest=null}){
  const header=document.getElementById('reading-header'),headerScreen=document.getElementById('enter-focus'),setting=document.getElementById('immersive-reading');
  const supported=typeof document.documentElement.requestFullscreen==='function'&&document.fullscreenEnabled!==false;
  let focused=true,toolsOpen=false,pending=false;
  const visible=target=>!!target&&typeof target.focus==='function'&&target.isConnected!==false&&!target.hidden;
  function restoreToolFocus(){
    const pill=focusReturn?.();
    if(visible(pill))pill.focus({preventScroll:true});
    else if(visible(headerScreen)&&!header?.inert)headerScreen.focus({preventScroll:true});
  }
  function sync(){
    const full=!!document.fullscreenElement,hidden=focused&&!toolsOpen;
    document.body.classList.toggle('is-focused',focused);document.body.dataset.readingTools=toolsOpen?'open':'closed';document.body.dataset.fullscreen=String(full);
    header.inert=hidden;header.setAttribute('aria-hidden',String(hidden));
    headerScreen.hidden=!supported;setting.checked=focused;
    headerScreen.setAttribute('aria-label',full?'退出全屏':'全屏阅读');headerScreen.setAttribute('aria-pressed',String(full));
    headerScreen.textContent=full?'退出全屏':'全屏';
  }
  // GET-184 coordinator ownership: every close request routes through the one
  // tools coordinator so toolbar.expanded and the header state cannot split.
  const requestToolsClose=target=>onToolsCloseRequest?onToolsCloseRequest(target):closeTools();
  function setFocused(value){
    const anchor=beforeLayout();requestToolsClose();focused=!!value;sync();afterLayout(anchor);
    document.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused}}));
  }
  function showTools({focus=true}={}){if(toolsOpen)return false;toolsOpen=true;sync();if(focus)header.querySelector('a[href],button:not([disabled]):not([hidden])')?.focus({preventScroll:true});return true;}
  function closeTools({restoreFocus=false}={}){if(!toolsOpen)return false;toolsOpen=false;sync();if(restoreFocus)restoreToolFocus();return true;}
  function toggleTools(options){return toolsOpen?closeTools():showTools(options);}
  async function toggleFullscreen(){
    if(pending)return false;
    const anchor=beforeLayout(),restoreFocus=visible(document.activeElement)&&(document.activeElement===headerScreen||header?.contains(document.activeElement));requestToolsClose();pending=true;focused=true;sync();
    let failed=false;
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(supported)await document.documentElement.requestFullscreen({navigationUI:'hide'});
      else throw Error('Fullscreen unavailable');
      return true;
    }catch{failed=true;announce('已保留沉浸阅读；当前浏览器未能切换全屏。');return false;}
    // GET-184: a fullscreen failure always lands on the visible pill, never a
    // removed floating control.
    finally{pending=false;sync();afterLayout(anchor);if(failed||restoreFocus)restoreToolFocus();}
  }
  headerScreen.addEventListener('click',toggleFullscreen);
  setting.addEventListener('change',()=>setFocused(setting.checked));
  document.addEventListener('fullscreenchange',()=>{sync();afterLayout(null);});
  document.addEventListener('pointerdown',event=>{
    if(!toolsOpen||readerInteractionBlocked(document,event.target)||event.target.closest('.reading-header'))return;
    requestToolsClose(event.target);
  });
  sync();return {setFocused,toggleTools,showTools,closeTools,toggleFullscreen,restoreToolFocus};
}
