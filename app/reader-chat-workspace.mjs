// Reader-only layout ownership. UI strings are injected by the existing reader
// owner so this module never creates another interface-locale runtime.
const WIDTH_KEY='marginalia:ui:reader-chat-width';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function mountReaderChatWorkspace({root,getReader=()=>null,document=globalThis.document,window=globalThis.window,storage,labels={}}={}){
 const body=document?.body;
 if(!root?.classList||!body?.classList||!document.createElement||!window?.addEventListener)return {setOpen(){},setLabels(){},isMobile:()=>false,dispose(){}};
 let disposed=false,opened=false,preferred=440,generation=0,frame1=null,frame2=null,drag=null,observer=null;
 const removers=[],inert=new Map(),originalModal=root.getAttribute('aria-modal'),originalTab=root.getAttribute('tabindex');
 const originalWidth=body.style.getPropertyValue('--reader-chat-width');
 try{storage??=window.localStorage;const saved=storage?.getItem(WIDTH_KEY);if(typeof saved==='string'&&/^\d{3}$/.test(saved)&&Number(saved)>=320&&Number(saved)<=640)preferred=Number(saved);}catch{}
 const separator=document.createElement('div');separator.className='reader-chat-separator';separator.setAttribute('role','separator');separator.setAttribute('aria-orientation','vertical');separator.setAttribute('tabindex','0');root.prepend(separator);
 root.classList.add('reader-chat-workspace');
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);removers.push(()=>target.removeEventListener(type,fn,options));};
 const mobile=()=>window.innerWidth<1100;
 const width=()=>clamp(preferred,320,Math.min(640,Math.max(320,window.innerWidth-640)));
 const cancelFrames=()=>{generation++;if(frame1!==null)window.cancelAnimationFrame(frame1);if(frame2!==null)window.cancelAnimationFrame(frame2);frame1=frame2=null;};
 function preserveLayout(change){
  cancelFrames();const token=generation,reader=getReader(),book=reader?.getBook?.(),anchor=reader?.getAnchor?.(),current=reader?.captureLayout?.()||(()=>true);change();
  if(!book||!anchor)return;
  const identity={bookId:book.bookId,version:book.contentVersion,chapterId:anchor.chapterId};
  frame1=window.requestAnimationFrame(()=>{frame1=null;if(disposed||token!==generation)return;frame2=window.requestAnimationFrame(()=>{
   frame2=null;if(disposed||token!==generation||!current())return;const live=getReader(),now=live?.getBook?.();
   if(now?.bookId!==identity.bookId||now?.contentVersion!==identity.version||identity.chapterId&&live?.getAnchor?.()?.chapterId!==identity.chapterId)return;
   (live.restoreLayoutAnchor||live.restoreAnchor)?.call(live,anchor);
  });});
 }
 function restoreInert(){observer?.disconnect();observer=null;for(const [node,value]of inert)node.inert=value;inert.clear();}
 function contain(){
  for(const node of body.children)if(node!==root&&!node.contains?.(root)&&!inert.has(node)){inert.set(node,node.inert);node.inert=true;}
  if(!observer&&window.MutationObserver){observer=new window.MutationObserver(contain);observer.observe(body,{childList:true});}
 }
 function paint(){
  const narrow=opened&&mobile(),wide=opened&&!mobile();
  body.classList.toggle('has-reader-chat',wide);root.classList.toggle('is-reader-chat-mobile',narrow);
  separator.hidden=!wide;body.style.setProperty('--reader-chat-width',width()+'px');
  separator.setAttribute('aria-valuemin','320');separator.setAttribute('aria-valuemax',String(Math.min(640,Math.max(320,window.innerWidth-640))));separator.setAttribute('aria-valuenow',String(width()));
  if(narrow){contain();root.setAttribute('aria-modal','true');if(!root.contains(document.activeElement)){root.setAttribute('tabindex','-1');(root.querySelector('.library-chat-close')||root).focus({preventScroll:true});}}
  else{restoreInert();root.setAttribute('aria-modal','false');}
 }
 const save=()=>{try{storage?.setItem(WIDTH_KEY,String(Math.round(preferred)));}catch{}};
 function resize(value,{persist=false}={}){preferred=clamp(Math.round(value),320,Math.min(640,Math.max(320,window.innerWidth-640)));preserveLayout(paint);if(persist)save();}
 function endDrag(persist){const previous=drag;if(!previous)return;drag=null;root.classList.remove('is-resizing');if(persist)save();else resize(previous.width);if(separator.hasPointerCapture?.(previous.id))separator.releasePointerCapture(previous.id);}
 listen(separator,'keydown',event=>{
  if(!opened||mobile()||event.altKey||event.ctrlKey||event.metaKey)return;const step=event.shiftKey?64:16,max=Math.min(640,window.innerWidth-640);
  const next=({ArrowLeft:width()+step,ArrowRight:width()-step,Home:320,End:max})[event.key];if(next===undefined)return;event.preventDefault();resize(next,{persist:true});
 });
 listen(separator,'pointerdown',event=>{if(!opened||mobile()||event.button!==0)return;event.preventDefault();endDrag(false);drag={id:event.pointerId,x:event.clientX,width:width()};separator.setPointerCapture(event.pointerId);separator.focus({preventScroll:true});root.classList.add('is-resizing');});
 listen(separator,'pointermove',event=>{if(drag?.id===event.pointerId)resize(drag.width+drag.x-event.clientX);});
 listen(separator,'pointerup',event=>{if(drag?.id===event.pointerId)endDrag(true);});
 listen(separator,'pointercancel',()=>endDrag(false));listen(separator,'lostpointercapture',()=>{if(drag)endDrag(false);});
 listen(root,'keydown',event=>{
  if(!opened||!mobile()||event.key!=='Tab')return;
  const nodes=[...root.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex]')].filter(node=>!node.disabled&&node.getAttribute('tabindex')!=='-1'&&!node.closest?.('[hidden],[inert]')&&node.getClientRects().length);
  const first=nodes[0]||root,last=nodes.at(-1)||root;
  if(!nodes.length||!root.contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last||document.activeElement===root){event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});}
 });
 listen(window,'resize',()=>{if(opened){endDrag(false);preserveLayout(paint);}});
 for(const event of ['reader:jump','reader:ready','reader:session-changed'])listen(document,event,cancelFrames);
 listen(document,'wheel',cancelFrames,{passive:true});
 function setLabels(next){labels=next||{};separator.setAttribute('aria-label',labels.resize||'Resize AI workspace');}
 setLabels(labels);
 return {setOpen(value){if(disposed||opened===!!value)return;endDrag(false);preserveLayout(()=>{opened=!!value;paint();});},setLabels,isMobile:()=>opened&&mobile(),dispose(){
  if(disposed)return;disposed=true;cancelFrames();const pointer=drag?.id;drag=null;if(pointer!==undefined&&separator.hasPointerCapture?.(pointer))separator.releasePointerCapture(pointer);for(const remove of removers)remove();restoreInert();separator.remove();body.classList.remove('has-reader-chat');root.classList.remove('reader-chat-workspace','is-reader-chat-mobile','is-resizing');
  if(originalWidth)body.style.setProperty('--reader-chat-width',originalWidth);else body.style.removeProperty('--reader-chat-width');
  for(const [name,value]of [['aria-modal',originalModal],['tabindex',originalTab]])if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);
 }};
}
