// Immersion is a page layout. Browser fullscreen is requested only by a user action.
export function mountReaderImmersion({document,announce=()=>{},beforeLayout=()=>null,afterLayout=()=>{}}){
  const header=document.getElementById('reading-header'),menu=document.getElementById('exit-focus'),screen=document.getElementById('focus-fullscreen'),headerScreen=document.getElementById('enter-focus'),setting=document.getElementById('immersive-reading');
  const supported=typeof document.documentElement.requestFullscreen==='function'&&document.fullscreenEnabled!==false;
  let focused=true,toolsOpen=false,pending=false;
  function sync(){
    const full=!!document.fullscreenElement,hidden=focused&&!toolsOpen;
    document.body.classList.toggle('is-focused',focused);document.body.dataset.readingTools=toolsOpen?'open':'closed';document.body.dataset.fullscreen=String(full);
    header.inert=hidden;header.setAttribute('aria-hidden',String(hidden));menu.hidden=!focused;menu.setAttribute('aria-expanded',String(toolsOpen));
    screen.hidden=!focused||!supported||toolsOpen;headerScreen.hidden=!supported;setting.checked=focused;
    for(const button of [screen,headerScreen]){button.setAttribute('aria-label',full?'退出全屏':'全屏阅读');button.setAttribute('aria-pressed',String(full));}
    headerScreen.textContent=full?'退出全屏':'全屏';
  }
  function setFocused(value){
    const anchor=beforeLayout();focused=!!value;toolsOpen=false;sync();afterLayout(anchor);
    document.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused}}));
  }
  function toggleTools(){toolsOpen=!toolsOpen;sync();if(toolsOpen)header.querySelector('a[href],button:not([disabled]):not([hidden])')?.focus({preventScroll:true});}
  function closeTools({restoreFocus=false}={}){if(!toolsOpen)return false;toolsOpen=false;sync();if(restoreFocus)menu.focus({preventScroll:true});return true;}
  async function toggleFullscreen(){
    if(pending)return false;
    const anchor=beforeLayout(),restoreFocus=document.activeElement===screen||document.activeElement===headerScreen;pending=true;focused=true;toolsOpen=false;sync();
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(supported)await document.documentElement.requestFullscreen({navigationUI:'hide'});
      else throw Error('Fullscreen unavailable');
      return true;
    }catch{announce('已保留沉浸阅读；当前浏览器未能切换全屏。');return false;}
    finally{pending=false;sync();afterLayout(anchor);if(restoreFocus)screen.focus({preventScroll:true});}
  }
  menu.addEventListener('click',toggleTools);screen.addEventListener('click',toggleFullscreen);headerScreen.addEventListener('click',toggleFullscreen);
  setting.addEventListener('change',()=>setFocused(setting.checked));
  document.addEventListener('fullscreenchange',()=>{sync();afterLayout(null);});
  document.addEventListener('pointerdown',event=>{
    if(!toolsOpen||document.querySelector('dialog[open],[popover]:popover-open')||event.target.closest('.reading-header,.focus-actions'))return;
    closeTools();
  });
  sync();return {setFocused,toggleTools,closeTools,toggleFullscreen};
}
