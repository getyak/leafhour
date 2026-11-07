// Offsets are UTF-16, matching Selection/Range and stored reader quotes.
export function sentenceSelection(text,start,end,{locale,Segmenter=Intl.Segmenter}={}){
 if(typeof text!=='string'||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length)return null;
 let first=0,last=text.length;
 if(Segmenter){
  let segments;
  try{segments=[...new Segmenter(locale||undefined,{granularity:'sentence'}).segment(text)];}
  catch{segments=[...new Segmenter(undefined,{granularity:'sentence'}).segment(text)];}
  const included=segments.filter(part=>part.index<end&&part.index+part.segment.length>start);
  if(included.length){first=included[0].index;last=included.at(-1).index+included.at(-1).segment.length;}
 }
 const raw=text.slice(first,last),leading=raw.length-raw.trimStart().length;
 first+=leading;last-=raw.length-raw.trimEnd().length;
 return last>first?{start:first,end:last}:null;
}

// This only authorizes a selection already created by the browser. It never
// implements a synthetic long press or consumes a native touch event.
export function createTouchSelectionIntent({now=()=>performance.now()}={}){
 let touch=false,candidate=null,active=false;
 const cancel=()=>{candidate=null;active=false;};
 return {
  begin({prose,x,y,adjusting=false}){
   touch=true;candidate=null;active=adjusting;
   if(prose&&!adjusting)candidate={prose,x,y,at:now(),until:now()+5000};
  },
  move({x,y,touches=1}){if(candidate&&(touches!==1||Math.hypot(x-candidate.x,y-candidate.y)>10))cancel();},
  end(){if(candidate){if(now()-candidate.at<350)cancel();else candidate.until=Math.min(candidate.until,now()+1000);}},
  cancel,
  reset(){cancel();touch=false;},
  selection(prose){
   if(!touch)return {accept:true,touch:false,expand:false};
   if(active)return {accept:true,touch:true,expand:false};
   if(candidate&&prose===candidate.prose&&now()-candidate.at>=350&&now()<=candidate.until){candidate=null;active=true;return {accept:true,touch:true,expand:true};}
   return {accept:false,touch:true,expand:false};
  }
 };
}

const proseAt=(node,root)=>{
 const element=node?.nodeType===3?node.parentElement:node;
 const prose=element?.closest?.('p[data-reading-layer]');
 return prose&&root.contains(prose)&&!element.closest('a,button,input,textarea,select,[contenteditable]')?prose:null;
};

// Native handle hit regions extend outside the actual prose. A retained range
// elsewhere on the page does not turn a fresh hold into handle editing.
export function touchAdjustsSelection(selection,point,root){
 if(!point||selection?.isCollapsed!==false||selection.rangeCount!==1||!root.contains(selection.anchorNode))return false;
 const rects=[...selection.getRangeAt(0).getClientRects()].filter(rect=>rect.width||rect.height);
 return [rects[0],rects.at(-1)].some((rect,index)=>rect&&Math.abs(point.clientX-(index?rect.right:rect.left))<=26&&point.clientY>=rect.top-26&&point.clientY<=rect.bottom+26);
}
const rangeState=range=>range&&[range.startContainer,range.startOffset,range.endContainer,range.endOffset];
const sameRange=(a,b)=>!!a&&!!b&&a.every((value,index)=>value===b[index]);

export function mountReaderTouchSelection({document,root,listen,rangeForOffsets,getSelection=()=>document.getSelection(),now}){
 const intent=createTouchSelectionIntent({now});let captured=null;
 listen(document,'pointerdown',event=>{if(event.pointerType&&event.pointerType!=='touch')intent.reset();},{capture:true,passive:true});
 listen(document,'keydown',()=>intent.reset(),{capture:true,passive:true});
 listen(document,'touchstart',event=>{
  const point=event.touches?.[0],selection=getSelection();
  if(!selection||selection.isCollapsed)captured=null;
  intent.begin({prose:event.touches?.length===1?proseAt(event.target,root):null,x:point?.clientX,y:point?.clientY,adjusting:event.touches?.length===1&&touchAdjustsSelection(selection,point,root)});
 },{capture:true,passive:true});
 listen(document,'touchmove',event=>{const point=event.touches?.[0];intent.move({x:point?.clientX,y:point?.clientY,touches:event.touches?.length||0});},{capture:true,passive:true});
 for(const event of ['touchend','touchcancel'])listen(document,event,()=>intent.end(),{capture:true,passive:true});
 listen(document,'wheel',()=>intent.cancel(),{capture:true,passive:true});
 for(const event of ['reader:chapter','reader:jump','reader:page','reader:layout','reader:session-changed'])listen(document,event,()=>intent.cancel());
 return {
  capture(){
   const selection=getSelection(),range=selection?.rangeCount===1&&!selection.isCollapsed?selection.getRangeAt(0):null;
   const prose=range&&proseAt(range.startContainer,root),decision=intent.selection(prose);
   if(decision.touch&&sameRange(captured,rangeState(range)))return {...decision,accept:false};
   if(decision.accept)captured=rangeState(range);
   if(!decision.accept||!decision.expand||!prose||proseAt(range.endContainer,root)!==prose)return decision;
   const prefix=range.cloneRange();prefix.selectNodeContents(prose);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length;
   prefix.setEnd(range.endContainer,range.endOffset);const end=prefix.toString().length;
   const bounds=sentenceSelection(prose.textContent,start,end,{locale:prose.lang||prose.closest('[lang]')?.lang});
   const expanded=bounds&&rangeForOffsets(prose,bounds.start,bounds.end);
   if(expanded){
    // Keep the native Selection object and its handles; modify only once.
    if(selection.setBaseAndExtent)selection.setBaseAndExtent(expanded.startContainer,expanded.startOffset,expanded.endContainer,expanded.endOffset);
    else{selection.removeAllRanges();selection.addRange(expanded);}
    captured=rangeState(selection.getRangeAt(0));
   }
   return decision;
  }
 };
}
