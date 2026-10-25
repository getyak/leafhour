export function pageKeyDirection(event,{blocked=false,selection=''}={}){
  if(blocked||selection||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.target?.isContentEditable||event.target?.closest?.('input,textarea,select,a,[role=tab],[role=menu],[contenteditable=true]'))return 0;
  return event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
}
