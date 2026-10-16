// Columns fragment the existing, selectable text. Paragraph IDs and content stay intact.
export function pageGeometry({width,scrollWidth,gap,columns}){
  const step=width+gap;
  return {step,count:Math.max(1,Math.ceil((scrollWidth-width-.5)/step)+1)};
}
export function fragmentProgress(rects,index){
  const total=rects.reduce((sum,r)=>sum+r.height,0);
  return total?rects.slice(0,index).reduce((sum,r)=>sum+r.height,0)/total:0;
}
export function fragmentIndex(rects,progress=0){
  const target=rects.reduce((sum,r)=>sum+r.height,0)*progress;let height=0;
  for(let i=0;i<rects.length;i++){height+=rects[i].height;if(height>target+.5)return i;}
  return Math.max(0,rects.length-1);
}
export function pageKeyDirection(event,{blocked=false,selection=''}={}){
  if(blocked||selection||event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.target?.isContentEditable||event.target?.closest?.('input,textarea,select,a,[role=tab],[role=menu],[contenteditable=true]'))return 0;
  return event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
}

export function mountReaderPagination({document,isBlocked=()=>false,onTurn=()=>{},onBoundary=()=>false,hasBoundary=()=>false}){
  const view=document.defaultView,viewport=document.getElementById('reading-pages'),text=document.getElementById('chapter-text'),end=document.getElementById('page-end'),controls=document.getElementById('page-turner'),previous=document.getElementById('page-previous'),next=document.getElementById('page-next'),label=document.getElementById('page-position');
  let active=false,page=0,lastAnchor=null,resizeFrame,pointerFocus=false;
  function geometry(){const style=view.getComputedStyle(text);return pageGeometry({width:viewport.clientWidth,scrollWidth:text.scrollWidth,gap:parseFloat(style.columnGap)||0,columns:Number(style.columnCount)||1});}
  function sync(){
    if(!active)return;const {step,count}=geometry();end.style.left=((count-1)*step+viewport.clientWidth-1)+'px';page=Math.max(0,Math.min(count-1,Math.round(viewport.scrollLeft/step)));
    previous.disabled=page===0&&!hasBoundary(-1);next.disabled=page===count-1&&!hasBoundary(1);
    const columns=Number(view.getComputedStyle(text).columnCount)||1;
    label.textContent=(columns===2?'双页':'单页')+' · '+(page+1)+' / '+count;
  }
  function visibleAnchor(){
    if(!active)return null;const bounds=viewport.getBoundingClientRect();
    for(const node of text.querySelectorAll('.passage')){
      const rects=[...node.getClientRects()],index=rects.findIndex(r=>r.right>bounds.left+1&&r.left<bounds.right-1&&r.bottom>bounds.top&&r.top<bounds.bottom);
      if(index<0)continue;
      return {passageId:node.dataset.id,offset:rects[index].top,...(index?{withinParagraph:fragmentProgress(rects,index)}:{})};
    }
    return null;
  }
  function anchor(){return active?(lastAnchor||visibleAnchor()):null;}
  function visibleRect(node){const bounds=viewport.getBoundingClientRect();return [...node.getClientRects()].find(r=>r.right>bounds.left+1&&r.left<bounds.right-1)||null;}
  function restore(position){
    if(!active||!position)return;const node=document.getElementById(position.passageId);if(!node||!text.contains(node))return;
    const rects=[...node.getClientRects()],rect=rects[fragmentIndex(rects,position.withinParagraph)];if(!rect)return;
    const {step,count}=geometry(),left=rect.left-viewport.getBoundingClientRect().left+viewport.scrollLeft;
    const target=Math.max(0,Math.min(count-1,Math.floor((left+.5)/step)));sync();viewport.scrollLeft=target*step;sync();lastAnchor={passageId:position.passageId,offset:Number.isFinite(position.offset)?position.offset:rect.top,...(position.withinParagraph!==undefined?{withinParagraph:position.withinParagraph}:{})};
  }
  function turn(direction){
    if(!active||isBlocked()||view.getSelection()?.toString())return false;
    const {count,step}=geometry(),target=page+direction;
    if(target<0||target>=count){if(!onBoundary(direction))return false;sync();return true;}
    page=target;viewport.scrollLeft=page*step;sync();lastAnchor=visibleAnchor();
    if(text.contains(document.activeElement))document.getElementById('book-page').focus({preventScroll:true});
    onTurn();return true;
  }
  previous.addEventListener('click',()=>turn(-1));next.addEventListener('click',()=>turn(1));
  document.addEventListener('keydown',event=>{
    if(!active)return;const direction=pageKeyDirection(event,{blocked:isBlocked(event.target),selection:view.getSelection()?.toString()});
    if(direction){event.preventDefault();turn(direction);}
  });
  viewport.addEventListener('scroll',()=>{if(active)sync();},{passive:true});
  text.addEventListener('pointerdown',event=>{if(active){pointerFocus=true;try{event.target.closest('.passage')?.focus({preventScroll:true});}finally{pointerFocus=false;}}});
  text.addEventListener('focusin',event=>{if(active&&!pointerFocus&&event.target.matches('.passage')){restore({passageId:event.target.dataset.id});onTurn();}});
  const observer=new view.ResizeObserver(()=>{
    if(!active)return;view.cancelAnimationFrame(resizeFrame);const position=lastAnchor;
    resizeFrame=view.requestAnimationFrame(()=>{restore(position);sync();});
  });observer.observe(viewport);
  return {
    get active(){return active;},anchor,restore,sync,visibleRect,
    update(state){
      const enabled=state.pageLayout==='spread'&&state.mode!=='parallel';
      if(enabled!==active){active=enabled;document.body.dataset.paginated=String(active);controls.hidden=!active;end.hidden=!active;viewport.scrollLeft=0;page=0;lastAnchor=null;if(active)view.scrollTo(0,0);}
      document.getElementById('page-layout').value=state.pageLayout;
      document.getElementById('page-layout-setting').hidden=state.mode==='parallel';document.getElementById('page-layout-hint').hidden=state.mode==='parallel';sync();
    },
    last(){if(!active)return;sync();viewport.scrollLeft=(geometry().count-1)*geometry().step;sync();lastAnchor=visibleAnchor();}
  };
}
