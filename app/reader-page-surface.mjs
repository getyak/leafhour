import {createPageTurn,leafSegments,leafDragProgress,withinPaperSnapshotBudget} from './reader-page-turn.mjs';

// Paper styling belongs to the requested page mode, outside scroll startup.
let stylesReady=true;
const styleDocument=globalThis.document;
if(styleDocument?.head&&!styleDocument.querySelector('link[data-reader-paper]')){
  stylesReady=await new Promise(resolve=>{
    const link=styleDocument.createElement('link');link.rel='stylesheet';link.href='/reader-paper.css';link.dataset.readerPaper='';
    link.addEventListener('load',()=>resolve(true),{once:true});link.addEventListener('error',()=>{link.remove();resolve(false);},{once:true});styleDocument.head.append(link);
  });
}

// Temporary visual copies never own a passage, selection, or reading position.
export default function mountReaderPageSurface({document,viewport,text,getGeometry,isBlocked=()=>false,onTurn}){
  const view=document.defaultView,host=viewport.parentElement;
  if(!document.createElement||!text.cloneNode||!host?.append)return {turn:onTurn,sync(){},cancel(){},dispose(){}};
  let disposed=false,presentation=null,drag=null,ignoreClickUntil=0;
  const removers=[],handles=[];
  const selected=()=>!!view.getSelection()?.toString();
  const blocked=()=>disposed||document.hidden||isBlocked()||selected();
  const reduced=()=>!!view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const listen=(node,event,fn,options)=>{node.addEventListener(event,fn,options);removers.push(()=>node.removeEventListener(event,fn,options));};
  const clear=()=>{presentation?.root.remove();presentation=null;host.removeAttribute('data-paper-turning');};
  function copyAt(container,offset,shape){
    const copy=text.cloneNode(true);copy.removeAttribute('id');
    for(const node of copy.querySelectorAll('[id],[data-id],[autofocus]')){node.removeAttribute('id');node.removeAttribute('data-id');node.removeAttribute('autofocus');}
    copy.classList.add('paper-turn-text');
    Object.assign(copy.style,{position:'absolute',left:-offset+'px',top:shape.top+'px',width:shape.width+'px',height:shape.height+'px',columnCount:String(shape.columns),columnGap:shape.gap+'px',columnFill:'auto',margin:'0',transform:'none'});
    container.append(copy);
  }
  function draw(progress,direction){
    if(!presentation)return;
    const {strips,width,origin}=presentation;
    for(const [i,part] of leafSegments(progress,width,strips.length,direction).entries()){
      strips[i].style.transform='translate3d('+(origin+part.x)+'px,0,'+(part.z+.5)+'px) rotateY('+part.angle+'deg)';
      strips[i].style.setProperty('--paper-turn-light',String(Math.sin(progress*Math.PI)*(.03+Math.abs(i/strips.length-.5)*.12)));
    }
  }
  function prepare(direction){
    if(presentation)return true;
    const geometry=getGeometry();
    if(!geometry||geometry.page+direction<0||geometry.page+direction>=geometry.count||!stylesReady||reduced()||!withinPaperSnapshotBudget(text.querySelectorAll('*').length,text.textContent.length))return false;
    const bounds=viewport.getBoundingClientRect(),paper=host.getBoundingClientRect();
    const outer=bounds.left-paper.left,width=geometry.columns===2?bounds.width/2+outer:paper.width;
    if(!width||!viewport.clientHeight)return false;
    const origin=geometry.columns===2?bounds.width/2:direction===1?-outer:bounds.width+outer;
    const frontStart=direction===1?origin:origin-width;
    const backStart=geometry.columns===2?(direction===1?-outer:origin):frontStart;
    const destination=geometry.page+direction;
    const root=document.createElement('div');root.className='paper-turn-layer';root.inert=true;root.setAttribute('aria-hidden','true');
    Object.assign(root.style,{left:outer+'px',top:'0',width:bounds.width+'px',height:paper.height+'px'});
    const shape={width:bounds.width,height:viewport.clientHeight,top:bounds.top-paper.top,columns:geometry.columns,gap:geometry.gap};
    const peek=document.createElement('div');peek.className='paper-turn-peek';
    const peekStart=geometry.columns===2?(direction===1?origin:-outer):-outer;
    Object.assign(peek.style,{left:peekStart+'px',width:width+'px'});copyAt(peek,destination*geometry.step+peekStart,shape);root.append(peek);
    const strips=[],count=4,stripWidth=width/count;
    for(let i=0;i<count;i++){
      const strip=document.createElement('div');strip.className='paper-turn-strip';strip.style.width=(stripWidth+.6)+'px';
      const front=document.createElement('div'),back=document.createElement('div');front.className='paper-turn-face';back.className='paper-turn-face';
      const frontOffset=direction===1?frontStart+i*stripWidth:frontStart+width-(i+1)*stripWidth;
      const backOffset=direction===1?backStart+width-(i+1)*stripWidth:backStart+i*stripWidth;
      front.style.transform=direction===1?'none':'rotateY(180deg)';back.style.transform=direction===1?'rotateY(180deg)':'none';
      copyAt(front,geometry.page*geometry.step+frontOffset,shape);copyAt(back,destination*geometry.step+backOffset,shape);
      strip.append(front,back);root.append(strip);strips.push(strip);
    }
    presentation={root,strips,width,origin,direction};draw(0,direction);host.append(root);host.dataset.paperTurning='true';return true;
  }
  const motion=createPageTurn({requestFrame:fn=>view.requestAnimationFrame(fn),cancelFrame:id=>view.cancelAnimationFrame(id),reducedMotion:()=>reduced()||!presentation,
    onPaint:state=>{if(!state.active)clear();else draw(state.progress,state.direction);},onCommit:direction=>{clear();if(!blocked())onTurn(direction);}});
  function cancel(){
    const previous=drag;drag=null;
    if(previous)ignoreClickUntil=(view.performance?.now?.()||previous.time)+500;
    if(previous?.node.hasPointerCapture?.(previous.id))previous.node.releasePointerCapture(previous.id);
    motion.cancel();clear();
  }
  function turn(direction){
    if(blocked())return false;
    const g=getGeometry();if(!g?.active)return false;
    if(motion.active){const result=motion.turn(direction);if(!motion.active)clear();return result;}
    if(g.page+direction<0||g.page+direction>=g.count){cancel();return onTurn(direction);}
    if(!prepare(direction)){cancel();return onTurn(direction);}
    return motion.turn(direction);
  }
  for(const direction of [-1,1]){
    const node=document.createElement('button');node.type='button';node.className='paper-turn-handle '+(direction===1?'is-next':'is-previous');
    node.setAttribute('aria-labelledby',direction===1?'page-next':'page-previous');node.setAttribute('aria-controls','chapter-text');
    node.addEventListener('click',event=>{if(event.detail&&event.timeStamp<ignoreClickUntil)return;turn(direction);});
    listen(node,'pointerdown',event=>{
      if(event.button!==0||event.isPrimary===false||blocked())return;
      const g=getGeometry();if(!g?.active||!(direction===1?g.next:g.previous))return;
      prepare(direction);
      event.preventDefault();const current=motion.grab(direction);if(!current)return;
      const width=presentation?.width||Math.max(1,host.clientWidth/(g.columns===2?2:1)),last=leafSegments(current.progress,width,4,1).at(-1),distance=width-last.x-Math.cos(last.angle*Math.PI/180)*last.width;
      drag={node,id:event.pointerId,x:event.clientX,time:event.timeStamp,width,distance,progress:current.progress,direction:current.direction,moved:false};node.setPointerCapture(event.pointerId);
    });
    listen(node,'pointermove',event=>{
      if(!drag||drag.id!==event.pointerId)return;if(blocked()){cancel();return;}
      const delta=(drag.x-event.clientX)*drag.direction;if(Math.abs(delta)>4)drag.moved=true;
      const dt=Math.max(8,event.timeStamp-drag.time)/1000,width=drag.width;
      const progress=leafDragProgress(drag.distance+delta,width);motion.drag(progress,(progress-drag.progress)/dt);drag.progress=progress;drag.time=event.timeStamp;
    });
    function release(event,cancelled){
      if(!drag||drag.id!==event.pointerId)return;const previous=drag;drag=null;ignoreClickUntil=event.timeStamp+500;
      if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);
      if(!cancelled&&!previous.moved)motion.turn(previous.direction);else motion.release(cancelled,{elapsed:event.timeStamp-previous.time});
      if(!motion.active)clear();
    }
    listen(node,'pointerup',event=>release(event,false));listen(node,'pointercancel',event=>release(event,true));listen(node,'lostpointercapture',event=>release(event,true));
    host.append(node);handles.push({node,direction});
  }
  listen(document,'selectionchange',()=>{if(selected())cancel();});listen(document,'visibilitychange',()=>{if(document.hidden)cancel();});
  for(const event of ['reader:jump','reader:chapter','reader:ready','reader:session-changed','reader:page','reader:layout'])listen(document,event,cancel);
  listen(view,'pagehide',cancel);
  listen(document,'keydown',event=>{
    if(event.key==='Escape'&&presentation){event.preventDefault();cancel();return;}
  });
  const sync=()=>{const g=getGeometry();for(const {node,direction} of handles){node.hidden=!g?.active;node.disabled=!g?.active||(direction===1?!g.next:!g.previous);}};
  sync();
  return {turn,cancel,sync,dispose(){if(disposed)return;cancel();disposed=true;motion.dispose();for(const remove of removers)remove();for(const {node}of handles)node.remove();}};
}
