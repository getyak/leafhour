import {getUiLocale,t,onUiLocaleChange} from './ui-locale.mjs';

export function validReadingGuide(guide,target){
 return guide?.kind==='leafhour-reading-guide'&&guide.schemaVersion===1&&guide.origin==='ai'&&guide.status==='draft'&&guide.scope==='opening-sample'
  && ['bookId','contentVersion','sourceKind','locale'].every(key=>guide[key]===target[key])
  && ['opening','method','readingQuestion'].every(key=>typeof guide[key]==='string'&&guide[key].trim()&&[...guide[key]].length<=(key==='readingQuestion'?300:1200));
}

// All recovery is read-only; only a missing durable attempt can auto-prepare.
export function createReaderGuideController({api,getTarget,onChange=()=>{},storage=null,verifyOwner=async()=>true,schedule=setTimeout,unschedule=clearTimeout}){
 let epoch=0,disposed=false,busy=false,timer=null,view={state:'missing',guide:null},targetKey=null;
 const key=target=>JSON.stringify([target.ownerId,target.bookId,target.contentVersion,target.sourceKind,target.locale]);
 const publish=value=>{view=value;onChange(view);};
 async function prepare(action='ensure'){
  const target=getTarget();if(disposed||!target)return;
  const identity=key(target);if(busy&&identity===targetKey)return;
  const ticket=++epoch;targetKey=identity;busy=true;unschedule(timer);
  const current=()=>!disposed&&ticket===epoch&&getTarget()&&key(getTarget())===identity;
  const cache='leafhour:reading-guide:'+identity;
  let cached=null;try{cached=JSON.parse(storage?.getItem(cache)||'null');}catch{}
  publish({state:'preparing',guide:null});
  const {ownerId,...body}=target;
  try{
   if(validReadingGuide(cached,target)){if(!await verifyOwner(target.ownerId)||!current())throw Error('Account unconfirmed');publish({state:'ready',guide:cached});return;}
   let result=await api('/api/library/reading-guide',{...body,action:'view'});if(!current())return;
   if((result.state==='missing'&&action!=='view')||(result.state==='failed'&&action==='retry')){
    result=await api('/api/library/reading-guide',{...body,action});if(!current())return;
   }
   if(result.guide&&!validReadingGuide(result.guide,target))throw Error('Invalid reading guide');
   if(result.guide){try{storage?.setItem(cache,JSON.stringify(result.guide));}catch{}}
   publish({state:result.guide?'ready':result.state||'unknown',guide:result.guide||null});
   if(result.state==='preparing')timer=schedule(()=>{if(current())void prepare('view');},2000);
  }catch{if(current())publish({state:'unknown',guide:null});}
  finally{if(ticket===epoch)busy=false;}
 }
 return {prepare,retry:()=>prepare(['failed','missing'].includes(view.state)?'retry':'view'),view:()=>view,dispose(){disposed=true;epoch++;unschedule(timer);}};
}

export function mountReaderGuide({surface,api,getTarget,storage=null,verifyOwner=async()=>true,document=globalThis.document}){
 if(!surface?.setLeadingContent)return null;
 if(!document.getElementById?.('reader-guide-style')){const style=document.createElement('link');style.id='reader-guide-style';style.rel='stylesheet';style.href='/reader-reading-guide.css';document.head?.append(style);}
 const host=document.createElement('section');host.className='reader-reading-guide';host.setAttribute('aria-label',t('guide.title'));host.hidden=true;
 let state={state:'missing',guide:null};
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 function paint(){
  host.replaceChildren();host.hidden=!getTarget();if(host.hidden)return;
  host.setAttribute('aria-label',t('guide.title'));host.setAttribute('aria-busy',String(state.state==='preparing'));
  host.append(node('h3',t('guide.title')));
  if(state.guide){host.append(node('p',t('guide.attribution')),node('p',state.guide.opening),node('p',state.guide.method),node('p',state.guide.readingQuestion),node('small',t('guide.boundary')));}
  else{
   const status=node('p',t('guide.'+(['preparing','failed','missing'].includes(state.state)?state.state:'unknown')));status.setAttribute('role','status');host.append(status);
   if(state.state!=='preparing'){const retry=node('button',t(['failed','missing'].includes(state.state)?'guide.retry':'guide.check'));retry.type='button';retry.className='library-chat-text-button';retry.addEventListener('click',()=>void controller.retry());host.append(retry);}
  }
 }
 const controller=createReaderGuideController({api,getTarget,storage,verifyOwner,onChange:value=>{state=value;paint();}}),unsubscribe=onUiLocaleChange(()=>{paint();void controller.prepare();});
 surface.setLeadingContent(host);paint();
 return {...controller,open(){surface.focusLeadingContent?.();void controller.prepare();},dispose(){unsubscribe();controller.dispose();surface.setLeadingContent(null);host.remove();}};
}

export function readerGuideTarget({reader,ownerId,bookId,locale=getUiLocale()}){
 const book=reader?.getBook?.();return ownerId&&book?.bookId===bookId&&typeof book.contentVersion==='string'?{ownerId,bookId,contentVersion:book.contentVersion,sourceKind:'cloud',locale}:null;
}
