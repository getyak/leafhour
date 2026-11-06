// A margin note keeps the mounted reader visible, its anchor and its drafts.
// The history entry lets browser Back return to that same reading session.
const scrollRestorationLeases=new WeakMap();
export function mountReaderChatWorkspace({root,document=globalThis.document,window=globalThis.window,getReader=()=>null,onBack=()=>root?.close?.()}={}){
 const body=document?.body;
 if(!root?.classList||!body?.classList||!window?.addEventListener)return {setOpen(){},setLabels(){},isMobile:()=>false,isFullPage:()=>false,dispose(){}};
 let disposed=false,opened=false,observer=null,scrollLock=null,returnAnchor=null,restoreFrame=null,historyEntry=null,scrollRestoration=null,historyReturnPending=false,historyRevision=0;
 const removers=[],inert=new Map(),originalModal=root.getAttribute('aria-modal'),originalTab=root.getAttribute('tabindex');
 const token='leafhour-chat-'+Math.random().toString(36).slice(2),historyKey='leafhourConversation';
 root.classList.add('reader-chat-workspace');
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);removers.push(()=>target.removeEventListener(type,fn,options));};
 function restoreInert(){
  observer?.disconnect();observer=null;
  if(scrollLock){body.style.setProperty('overflow',scrollLock.overflow);scrollLock=null;}
  for(const [node,value]of inert)node.inert=value;inert.clear();
 }
 function contain(){
  for(const [node,value]of inert)if(root.contains(node)){node.inert=value;inert.delete(node);}
  if(!scrollLock){scrollLock={overflow:body.style.getPropertyValue('overflow')};body.style.setProperty('overflow','hidden');}
  for(const node of body.children)if(node!==root&&!node.contains?.(root)&&!inert.has(node)){inert.set(node,node.inert);node.inert=true;}
  if(!observer&&window.MutationObserver){observer=new window.MutationObserver(contain);observer.observe(body,{childList:true});}
 }
 function capture(){
  const reader=getReader(),book=reader?.getBook?.(),anchor=reader?.getAnchor?.();
  returnAnchor=book&&anchor?{reader,book,anchor,valid:reader.captureLayout?.()||(()=>true)}:null;
 }
 function restore(){
  const saved=returnAnchor;returnAnchor=null;
  if(!saved)return;
  const apply=()=>{restoreFrame=null;if(disposed||opened||getReader()!==saved.reader||saved.reader.getBook?.()!==saved.book||!saved.valid())return;(saved.reader.restoreLayoutAnchor||saved.reader.restoreAnchor)?.call(saved.reader,saved.anchor);};
  if(window.requestAnimationFrame)restoreFrame=window.requestAnimationFrame(apply);else apply();
 }
 function pushHistory(){
  if(!window.history?.pushState)return;
  // Browser restoration happens after popstate and would overwrite a citation
  // jump made while closing. The reader owns this one return, then gives it back.
  try{
   if(scrollRestoration===null){scrollRestoration=scrollRestorationLeases.get(window.history)||{previous:window.history.scrollRestoration,owners:new Set(),waiting:new Map(),pending:null};scrollRestoration.owners.add(token);scrollRestorationLeases.set(window.history,scrollRestoration);if('scrollRestoration' in window.history)window.history.scrollRestoration='manual';}
   // A close traverses history asynchronously. Reopening waits for that return
   // so its old popstate cannot close or duplicate the new destination.
   if(scrollRestoration.pending){scrollRestoration.waiting.set(token,()=>{if(opened&&!disposed)pushHistory();});return;}
   const previous=window.history.state;historyEntry={...(previous&&typeof previous==='object'?previous:{}),[historyKey]:token};window.history.pushState(historyEntry,'');
  }catch{historyEntry=null;releaseScrollRestoration();}
 }
 function releaseScrollRestoration(){
  if(scrollRestoration===null)return;
  const lease=scrollRestoration;scrollRestoration=null;lease.owners.delete(token);lease.waiting.delete(token);
  if(!lease.owners.size){if(lease.previous!==undefined)window.history.scrollRestoration=lease.previous;scrollRestorationLeases.delete(window.history);}
 }
 function finishHistoryReturn(){
  const revision=historyRevision;
  if(!opened&&!historyReturnPending&&scrollRestoration!==null)(window.setTimeout||setTimeout)(()=>{if(!opened&&!historyReturnPending&&revision===historyRevision)releaseScrollRestoration();},0);
 }
 function paint(){
  root.classList.toggle('is-reader-chat-mobile',opened&&window.innerWidth<1100);
  root.classList.toggle('is-reader-margin-note',opened);
  body.classList.toggle('has-margin-note',opened);
  if(opened){contain();root.setAttribute('aria-modal','true');}
  else{restoreInert();root.setAttribute('aria-modal','false');}
  document.dispatchEvent(new Event('reader:chat-layout'));
 }
 listen(window,'popstate',()=>{
  const lease=scrollRestorationLeases.get(window.history);
  if(lease?.pending){const finish=lease.pending;lease.pending=null;finish();const waiting=[...lease.waiting.values()];lease.waiting.clear();for(const start of waiting)start();return;}
  if(opened&&historyEntry&&window.history?.state?.[historyKey]!==token){historyEntry=null;onBack();}finishHistoryReturn();
 });
 listen(window,'resize',()=>{if(opened)paint();});
 for(const name of ['reader:page','reader:jump','reader:chapter','reader:session-changed'])listen(document,name,()=>{returnAnchor=null;if(restoreFrame!==null)window.cancelAnimationFrame?.(restoreFrame);restoreFrame=null;});
 listen(root,'keydown',event=>{
  if(!opened||event.key!=='Tab')return;
  const nodes=[...root.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex]')].filter(node=>!node.disabled&&node.getAttribute('tabindex')!=='-1'&&!node.closest?.('[hidden],[inert]')&&node.getClientRects().length);
  const first=nodes[0]||root,last=nodes.at(-1)||root;
  if(!nodes.length||!root.contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last||document.activeElement===root){event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});}
 });
 return {
  setOpen(value){
   if(disposed||opened===!!value)return;
   opened=!!value;historyRevision++;
   if(opened){if(restoreFrame!==null)window.cancelAnimationFrame?.(restoreFrame);restoreFrame=null;capture();pushHistory();}
   paint();
   if(!opened){
    restore();scrollRestoration?.waiting.delete(token);
    if(historyEntry&&window.history?.state?.[historyKey]===token){historyEntry=null;historyReturnPending=true;if(scrollRestoration)scrollRestoration.pending=()=>{historyReturnPending=false;finishHistoryReturn();};window.history.back();}
    else{historyEntry=null;finishHistoryReturn();}
   }
  },
  setLabels(){},isMobile:()=>opened&&window.innerWidth<1100,isFullPage:()=>false,
  dispose(){
   if(disposed)return;disposed=true;if(restoreFrame!==null)window.cancelAnimationFrame?.(restoreFrame);
   for(const remove of removers)remove();restoreInert();root.classList.remove('reader-chat-workspace','is-reader-chat-mobile','is-reader-margin-note');body.classList.remove('has-margin-note');
   releaseScrollRestoration();
   if(historyEntry&&window.history?.state?.[historyKey]===token){try{const state={...window.history.state};delete state[historyKey];window.history.replaceState(state,'');}catch{}}
   for(const [name,value]of [['aria-modal',originalModal],['tabindex',originalTab]])if(value===null||value===undefined)root.removeAttribute?.(name);else root.setAttribute(name,value);
  }
 };
}
