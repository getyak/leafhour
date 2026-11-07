// Parser-blocking passive observer for the known synthetic fixture only.
// No Selection mutation, dispatch, business callbacks, storage, auth or input.
(() => {
 'use strict';
 const config=/*GET273_CONFIG*/null;
 const document=window.document,started=window.performance.now(),documentId=window.crypto.randomUUID().replaceAll('-','');
 let seq=0;
 const allowed=new Map(config.paragraphs.map(p=>[p.id,p]));
 const send=(kind,detail={},trusted=false)=>{
  if(seq>=2000)return;
  const value={run:config.run,documentId,seq:seq++,t:Math.max(0,window.performance.now()-started),trusted,kind,...detail};
  void window.fetch('/qa/events',{method:'POST',credentials:'omit',mode:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}).catch(()=>{});
 };
 const proseFor=node=>{
  const element=node?.nodeType===3?node.parentElement:node,prose=element?.closest?.('p[data-reading-layer]'),passage=prose?.closest('.passage');
  const root=document.getElementById('chapter-text'),p=allowed.get(passage?.id);
  if(!root?.contains(prose)||!p)return null;
  const layer=prose.dataset.readingLayer,variant=prose.dataset.variant||'interpretive',source=layer==='original'?p.original:layer==='translation'?p[variant]:null;
  return ['literal','interpretive'].includes(variant)&&typeof source==='string'&&prose.textContent===source?{prose,passageId:passage.id,layer,variant,source}:null;
 };
 // Count nodes without constructing or changing any DOM Range.
 const offsetAt=(root,target,offset)=>{
  if(root===target){if(root.nodeType===3)return offset<=root.textContent.length?offset:null;return offset<=root.childNodes.length?[...root.childNodes].slice(0,offset).reduce((n,node)=>n+node.textContent.length,0):null;}
  let count=0;for(const child of root.childNodes){if(child===target||child.contains?.(target)){const inner=offsetAt(child,target,offset);return inner===null?null:count+inner;}count+=child.textContent.length;}return null;
 };
 const snapshot=()=>{
  const selection=document.getSelection();if(!selection||selection.rangeCount!==1)return null;
  const a=proseFor(selection.anchorNode);if(!a)return null;
  if(selection.isCollapsed)return {collapsed:true,parts:[]};
  const range=selection.getRangeAt(0),parts=[];
  if(!proseFor(range.startContainer)||!proseFor(range.endContainer))return null;
  for(const prose of document.querySelectorAll('#chapter-text .passage p[data-reading-layer]')){
   const p=proseFor(prose);if(!p||!range.intersectsNode(prose))continue;
   const start=prose.contains(range.startContainer)?offsetAt(prose,range.startContainer,range.startOffset):0;
   const end=prose.contains(range.endContainer)?offsetAt(prose,range.endContainer,range.endOffset):p.source.length;
   if(start===null||end===null||end<=start)continue;
   parts.push({passageId:p.passageId,layer:p.layer,variant:p.variant,start,end,text:p.source.slice(start,end)});
  }
  return parts.length&&parts.length<=10?{collapsed:false,parts}:null;
 };
 for(const name of ['pointerdown','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel'])document.addEventListener(name,event=>{
  const p=proseFor(event.target);if(!p)return;
  const pointerType=name.startsWith('touch')?'touch':['touch','mouse','pen'].includes(event.pointerType)?event.pointerType:'unknown';
  const touches=event.touches?.length||0;if(!Number.isInteger(touches)||touches<0||touches>5)return;
  send('input',{event:name,passageId:p.passageId,pointerType,touches},event.isTrusted===true);
 },{capture:true,passive:true});
 document.addEventListener('selectionchange',event=>{const value=snapshot();if(value)send('selection',value,event.isTrusted===true);},{capture:true,passive:true});
 document.addEventListener('reader:selection',()=>{const value=snapshot();if(value)send('app-selection',value);},{capture:true,passive:true});
 document.addEventListener('reader:ready',()=>send('reader-ready'),{once:true,passive:true});
 send('observer-ready');
})();
