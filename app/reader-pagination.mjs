import {t,onUiLocaleChange} from './ui-locale.mjs';
import {mountReaderPageInputs} from './reader-page-inputs.mjs';
export {pageKeyDirection} from './reader-page-inputs.mjs';
// Columns fragment the existing, selectable text. Paragraph IDs and content stay intact.
export function pageGeometry({width,scrollWidth,gap}){
  const step=width+gap;
  return {step,count:Math.max(1,Math.ceil((scrollWidth-width-.5)/step)+1)};
}
const totalHeight=rects=>rects.reduce((sum,r)=>sum+r.height,0);
const overlaps=(rect,bounds)=>rect.right>bounds.left+1&&rect.left<bounds.right-1;
export function fragmentProgress(rects,index){const total=totalHeight(rects);return total?totalHeight(rects.slice(0,index))/total:0;}
export function fragmentIndex(rects,progress=0){
  const target=totalHeight(rects)*progress;let height=0;
  for(let i=0;i<rects.length;i++){height+=rects[i].height;if(height>target+.5)return i;}
  return Math.max(0,rects.length-1);
}
export function mountReaderPagination({document,isBlocked=()=>false,onTurn=()=>{},onBoundary=()=>false,hasBoundary=()=>false}){
  const view=document.defaultView,viewport=document.getElementById('reading-pages'),text=document.getElementById('chapter-text'),end=document.getElementById('page-end'),controls=document.getElementById('page-turner'),previous=document.getElementById('page-previous'),next=document.getElementById('page-next'),label=document.getElementById('page-position');
  let active=false,page=0,lastAnchor,resizeFrame,resizeEpoch=0,pointerFocus=false,pageLabel,disposed=false;
  const inputs=mountReaderPageInputs({document,viewport,text,getGeometry:()=>active?{...geometry(),page,active,previous:!previous.disabled,next:!next.disabled}:null,isBlocked,onTurn:commitTurn});
  const cancelResize=()=>{resizeEpoch++;view.cancelAnimationFrame(resizeFrame);inputs.cancel();};
  const listeners=[];
  const listen=(target,name,fn,options)=>{const owned=event=>{if(!disposed)fn(event);};target.addEventListener(name,owned,options);listeners.push(()=>target.removeEventListener(name,owned,options));};
  // Locale publication reads only the last measured UI descriptor. Measuring
  // columns or restoring anchors here would disturb an active text selection.
  function updateLabels(){if(!disposed&&pageLabel)label.textContent=t(pageLabel.id,pageLabel.params);}
  const offLocale=onUiLocaleChange(updateLabels);
  function geometry(){const style=view.getComputedStyle(text),gap=parseFloat(style.columnGap)||0,columns=Number(style.columnCount)||1;return {...pageGeometry({width:viewport.clientWidth,scrollWidth:text.scrollWidth,gap}),gap,columns};}
  function sync(){
    if(!active){inputs.sync();return;}
    text.style.setProperty?.('--paper-page-height',viewport.clientHeight+'px');
    const {step,count,columns}=geometry();end.style.left=((count-1)*step+viewport.clientWidth-1)+'px';page=Math.max(0,Math.min(count-1,Math.round(viewport.scrollLeft/step)));
    previous.disabled=page===0&&!hasBoundary(-1);next.disabled=page===count-1&&!hasBoundary(1);
    inputs.sync();
    pageLabel={id:columns===2?'reader.pages.spread':'reader.pages.single',params:{page:page+1,count}};updateLabels();
  }
  function visibleAnchor(){
    if(!active)return null;const bounds=viewport.getBoundingClientRect();
    for(const node of text.querySelectorAll('.passage')){
      const rects=[...node.getClientRects()],index=rects.findIndex(r=>overlaps(r,bounds)&&r.bottom>bounds.top&&r.top<bounds.bottom);
      if(index<0)continue;
      return {passageId:node.dataset.id,offset:rects[index].top,...(index?{withinParagraph:fragmentProgress(rects,index)}:{})};
    }
    return null;
  }
  function anchor(){return active?(lastAnchor||visibleAnchor()):null;}
  function visibleRect(node){const bounds=viewport.getBoundingClientRect();return [...node.getClientRects()].find(r=>overlaps(r,bounds))||null;}
  function revealRect(rect,passageId){
    if(!active||!rect)return false;const node=document.getElementById(passageId);if(!node)return false;
    const rects=[...node.getClientRects()],index=rects.findIndex(r=>rect.left>=r.left-.5&&rect.left<r.right+.5);if(index<0)return false;
    restore({passageId,offset:rect.top,withinParagraph:fragmentProgress(rects,index)});return true;
  }
  function restore(position){
    cancelResize();
    if(!active||!position)return;const node=document.getElementById(position.passageId);if(!node||!text.contains(node))return;
    const rects=[...node.getClientRects()],rect=rects[fragmentIndex(rects,position.withinParagraph)];if(!rect)return;
    const {step,count}=geometry(),left=rect.left-viewport.getBoundingClientRect().left+viewport.scrollLeft;
    const target=Math.max(0,Math.min(count-1,Math.floor((left+.5)/step)));sync();viewport.scrollLeft=target*step;sync();lastAnchor={passageId:position.passageId,offset:Number.isFinite(position.offset)?position.offset:rect.top,...(position.withinParagraph!==undefined?{withinParagraph:position.withinParagraph}:{})};
  }
  function turn(direction,source={}){
    // Paging remains immediate if its optional visual module is still loading.
    return inputs.turn(direction,source);
  }
  function commitTurn(direction,source={}){
    if(!active||isBlocked()||view.getSelection()?.toString())return false;
    cancelResize();
    const {count,step}=geometry(),target=page+direction;
    if(target<0||target>=count){if(!onBoundary(direction,{trusted:source.trusted===true}))return false;sync();return true;}
    page=target;viewport.scrollLeft=page*step;sync();lastAnchor=visibleAnchor();
    if(text.contains(document.activeElement))document.getElementById('book-page').focus({preventScroll:true});
    onTurn({trusted:source.trusted===true});return true;
  }
  listen(previous,'click',event=>turn(-1,{trusted:event.isTrusted===true}));listen(next,'click',event=>turn(1,{trusted:event.isTrusted===true}));
  listen(viewport,'scroll',()=>{if(active)sync();},{passive:true});
  listen(text,'pointerdown',event=>{if(active){pointerFocus=true;try{event.target.closest('.passage')?.focus({preventScroll:true});}finally{pointerFocus=false;}}});
  listen(text,'focusin',event=>{
    if(!active||pointerFocus||!event.target.matches('.passage'))return;
    const rects=[...event.target.getClientRects()],visible=visibleRect(event.target),index=visible?rects.findIndex(r=>r.left===visible.left&&r.top===visible.top):0;
    restore({passageId:event.target.dataset.id,...(visible?{offset:visible.top,withinParagraph:fragmentProgress(rects,index)}:{})});onTurn({trusted:false});
  });
  const observer=new view.ResizeObserver(()=>{
    if(!active||disposed)return;cancelResize();const position=lastAnchor,epoch=resizeEpoch;
    resizeFrame=view.requestAnimationFrame(()=>{if(disposed||!active||epoch!==resizeEpoch)return;restore(position);sync();});
  });observer.observe(viewport);
  for(const event of ['reader:jump','reader:chapter','reader:ready','reader:session-changed','reader:page'])listen(document,event,cancelResize);
  return {
    get active(){return active;},anchor,restore,sync,visibleRect,revealRect,
    update(state){
      if(disposed)return;
      cancelResize();
      const enabled=state.pageLayout==='spread'&&state.mode!=='parallel';
      if(enabled!==active){active=enabled;document.body.dataset.paginated=String(active);controls.hidden=!active;end.hidden=!active;viewport.scrollLeft=0;page=0;lastAnchor=null;if(active)view.scrollTo(0,0);}
      document.getElementById('page-layout').value=state.pageLayout;
      document.getElementById('page-layout-setting').hidden=state.mode==='parallel';document.getElementById('page-layout-hint').hidden=state.mode==='parallel';sync();
    },
    last(){if(!active)return;cancelResize();sync();viewport.scrollLeft=(geometry().count-1)*geometry().step;sync();lastAnchor=visibleAnchor();},
    unmount(){if(disposed)return;disposed=true;active=false;inputs.dispose();offLocale();observer.disconnect?.();view.cancelAnimationFrame(resizeFrame);for(const release of listeners)release();listeners.length=0;}
  };
}
