export function pageKeyDirection(event,{blocked=false,selection=''}={}){
  if(blocked||selection||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.target?.isContentEditable||event.target?.closest?.('input,textarea,select,a,.source-preformatted,[role=tab],[role=menu],[contenteditable=true]'))return 0;
  return event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
}

// Basic input remains available even when the optional visual assets fail.
export function mountReaderPageInputs({document,viewport,text,getGeometry,isBlocked=()=>false,onTurn,loadSurface=()=>import('./reader-page-surface.mjs')}){
  let surface,loading=false,disposed=false;
  function turn(direction){
    if(disposed||!getGeometry()?.active||isBlocked()||document.defaultView.getSelection()?.toString())return false;
    return surface?surface.turn(direction):onTurn(direction);
  }
  const key=event=>{
    const direction=pageKeyDirection(event,{blocked:disposed||!getGeometry()?.active||isBlocked(event.target),selection:document.defaultView.getSelection()?.toString()});
    if(direction){event.preventDefault();turn(direction);}
  };
  document.addEventListener('keydown',key);
  async function enhance(){
    if(loading||surface||disposed)return;loading=true;
    try{const mount=(await loadSurface()).default;if(!disposed){surface=mount({document,viewport,text,getGeometry,isBlocked,onTurn});surface.sync();}}
    catch{}finally{loading=false;}
  }
  return {turn,cancel:()=>surface?.cancel(),sync(){surface?.sync();if(getGeometry()?.active)enhance();},dispose(){if(disposed)return;disposed=true;document.removeEventListener('keydown',key);surface?.dispose();}};
}
