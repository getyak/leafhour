import {validateObservabilityEvent,observabilityCategory,OBSERVABILITY_LIMITS} from './observability-contract.mjs';

const off=()=>({enabled:false,analytics:false,diagnostics:false,excluded:false,release:null});
export function safeErrorKind(error){
  if(error?.name==='AbortError')return 'aborted';
  if(error?.name==='TimeoutError')return 'timeout';
  if(error?.name==='TypeError')return 'network';
  if(error?.name==='SyntaxError')return 'parse';
  if(error?.name==='QuotaExceededError'||error?.name==='SecurityError')return 'storage';
  return 'unknown';
}

// The transport receives validated metadata only. It never wraps global fetch,
// persists an activity queue, reads DOM text, or loads a vendor browser SDK.
export function createBrowserObservability({fetcher=globalThis.fetch?.bind(globalThis),getOwner=()=>null,page='other',window=globalThis.window,document=globalThis.document,timers=globalThis,now=()=>Date.now(),randomUUID=()=>globalThis.crypto.randomUUID(),initialOperationId=null,batchDelay=500}={}){
  let owner=getOwner()||null,operationId=initialOperationId||randomUUID(),generation=0,disposed=false,config=off(),loaded=false,queue=[],timer=null,pending=null,refreshing=null,retries=0;
  const controllers=new Set(),subscribers=new Set(),listeners=[];
  const notify=()=>{for(const fn of subscribers){try{fn({...config});}catch{}}};
  const stop=()=>{if(timer!==null)timers.clearTimeout(timer);timer=null;queue=[];retries=0;for(const controller of controllers)controller.abort();controllers.clear();pending=null;};
  const current=(token,captured)=>!disposed&&generation===token&&owner===captured&&(getOwner()||null)===captured;
  function syncOwner(){const next=getOwner()||null;if(next===owner)return false;generation++;owner=next;operationId=randomUUID();stop();refreshing=null;config=off();loaded=false;notify();return true;}
  async function request(path,{method='GET',body}={},token=generation,captured=owner){
    const controller=new AbortController();controllers.add(controller);const timeout=timers.setTimeout(()=>controller.abort(),2000);timeout?.unref?.();
    try{
      const response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',headers:{'X-Reader-Owner':captured,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
      if(!current(token,captured))return null;
      if(!response.ok||response.headers?.get('X-Reader-Session-Changed')==='1')throw Error('Observability unavailable');
      return response;
    }finally{timers.clearTimeout(timeout);controllers.delete(controller);}
  }
  const adopt=value=>{const previous=config;config={enabled:value?.enabled===true,analytics:value?.analytics===true,diagnostics:value?.diagnostics===true,excluded:value?.excluded===true,release:null};loaded=true;if(!config.enabled||(!config.analytics&&!config.diagnostics)||(previous.analytics&&!config.analytics)||(previous.diagnostics&&!config.diagnostics))stop();else queue=queue.filter(event=>config[observabilityCategory(event.name)]);notify();};
  async function refresh(){
    syncOwner();if(disposed||!owner)return {...config};if(refreshing)return refreshing;
    const token=generation,captured=owner;
    refreshing=(async()=>{try{const response=await request('/api/account/observability',{},token,captured);if(!response)return {...config};const value=await response.json();if(current(token,captured))adopt(value);}catch{if(current(token,captured)){config=off();loaded=false;stop();notify();}}finally{if(current(token,captured))refreshing=null;}return {...config};})();return refreshing;
  }
  async function setConsent(value){
    syncOwner();if(disposed||!owner)throw Error('Observability unavailable');
    const consent={analytics:value?.analytics===true,diagnostics:value?.diagnostics===true},captured=owner;
    // A revoke takes effect before its network acknowledgement. A failed save
    // must never reactivate local collection or resurrect a pending batch.
    generation++;stop();refreshing=null;const saveToken=generation;config={...config,analytics:config.analytics&&consent.analytics,diagnostics:config.diagnostics&&consent.diagnostics};notify();
    const response=await request('/api/account/observability',{method:'POST',body:consent},saveToken,captured);
    if(!response||!current(saveToken,captured))return {...config};const result=await response.json();if(current(saveToken,captured)){adopt(result);broadcast();}return {...config};
  }
  function schedule(){if(timer!==null||disposed||!queue.length)return;timer=timers.setTimeout(()=>{timer=null;void flush();},batchDelay);timer?.unref?.();}
  function event(name,properties={}){
    syncOwner();const category=observabilityCategory(name);if(disposed||!owner||!loaded||!config.enabled||!config[category])return false;
    const safe=validateObservabilityEvent({id:randomUUID(),operationId,name,occurredAt:new Date(now()).toISOString(),properties:{...properties,page,client:'browser'}});if(!safe)return false;
    if(queue.length>=OBSERVABILITY_LIMITS.events)return false;queue.push(safe);schedule();return true;
  }
  async function flush(){
    syncOwner();if(disposed||!owner||!queue.length||pending)return;
    if(timer!==null)timers.clearTimeout(timer);timer=null;
    const token=generation,captured=owner,batch=queue.splice(0,OBSERVABILITY_LIMITS.events).filter(item=>config.enabled&&config[observabilityCategory(item.name)]);if(!batch.length)return;
    const body={events:batch};if(new TextEncoder().encode(JSON.stringify(body)).length>OBSERVABILITY_LIMITS.bytes)return;
    const work=(async()=>{try{await request('/api/account/observability/events',{method:'POST',body},token,captured);if(current(token,captured))retries=0;}catch{if(current(token,captured)&&retries++<1)queue=[...batch,...queue].slice(0,OBSERVABILITY_LIMITS.events);}finally{if(current(token,captured)){pending=null;schedule();}}})();pending=work;await work;
  }
  function error(error,properties={}){const errorKind=safeErrorKind(error);if(errorKind==='aborted'||(error?.status>=400&&error.status<500))return false;return event('client_error',{...properties,stage:'client',outcome:'failure',errorKind});}
  function requestFailed({status,error}={}){if(status&&status<500)return false;const errorKind=status?'http':safeErrorKind(error);if(errorKind==='aborted')return false;return event('request_failed',{stage:'request',outcome:'failure',errorKind,...(Number.isInteger(status)?{status}:{})});}
  function listen(target,name,callback){target?.addEventListener?.(name,callback);listeners.push(()=>target?.removeEventListener?.(name,callback));}
  // Cross-tab revocation contains no identity or activity data. Other tabs
  // stop first, then ask the authenticated endpoint for current preferences.
  const storageKey='leafhour-observability-consent-change';
  function broadcast(){try{window?.localStorage?.setItem(storageKey,String(now()));}catch{}}
  listen(window,'storage',event=>{if(event.key!==storageKey)return;generation++;stop();refreshing=null;config=off();loaded=false;notify();void refresh();});
  listen(window,'focus',()=>{void refresh();});
  listen(document,'visibilitychange',()=>{if(!document.hidden)void refresh();});
  listen(window,'error',event=>{error(event.error);});
  listen(window,'unhandledrejection',event=>{error(event.reason);});
  return {event,error,requestFailed,refresh,setConsent,syncOwner,flush,config:()=>({...config}),get loaded(){return loaded;},get operationId(){syncOwner();return operationId;},subscribe(fn){subscribers.add(fn);return ()=>subscribers.delete(fn);},dispose(){disposed=true;generation++;stop();for(const off of listeners)off();subscribers.clear();}};
}


function visible(node,document,window,bounds={left:0,right:window?.innerWidth||0,top:0,bottom:window?.innerHeight||0}){
  if(!node||node.isConnected===false||node.hidden||document?.hidden||!node.getClientRects?.().length)return false;
  const style=window?.getComputedStyle?.(node);if(style&&(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0))return false;
  return [...node.getClientRects()].some(rect=>(rect.width??rect.right-rect.left)>0&&(rect.height??rect.bottom-rect.top)>0&&rect.bottom>Math.max(0,bounds.top)&&rect.top<Math.min(window?.innerHeight||0,bounds.bottom)&&rect.right>Math.max(0,bounds.left)&&rect.left<Math.min(window?.innerWidth||0,bounds.right));
}
export function findVisibleReaderContent({root,document=globalThis.document,window=globalThis.window,viewport=null}={}){const bounds=viewport?.getBoundingClientRect();return [...(root?.querySelectorAll('.passage')||[])].find(node=>visible(node,document,window,bounds));}

// Reading signals receive DOM nodes only to test visibility/interaction. No
// node attribute, identifier, selected text or content enters an event.
export function createReaderObservabilitySignals({collector,document=globalThis.document,window=globalThis.window,getContent,getInteractionRoot=getContent,isPaginated=()=>false,now=()=>performance.now(),requestFrame=callback=>window.requestAnimationFrame(callback),cancelFrame=id=>window.cancelAnimationFrame(id)}={}){
  let generation=0,disposed=false,startedAt=0,contentSeen=false,active=false,resumed=false,frame=null,ready=false,openingObserved=false,started=false,resumeState=null,resumeSuperseded=false;
  const duration=()=>Math.max(0,Math.min(OBSERVABILITY_LIMITS.durationMs,Math.round(now()-startedAt)));
  function start(){if(disposed)return;generation++;if(frame!==null)cancelFrame(frame);frame=null;started=true;startedAt=now();contentSeen=active=resumed=ready=false;resumeState=null;resumeSuperseded=false;openingObserved=collector.event('reader_open_requested',{stage:'reader_open'})!==false;}
  // Called once after the initial account consent check. This observes the
  // present document at the current timestamp; it keeps no pre-consent event.
  function observeCurrentOpening(){if(disposed||!started||openingObserved)return;openingObserved=collector.event('reader_open_requested',{stage:'reader_open'})!==false;if(openingObserved){startedAt=now();if(ready)contentReady();}}
  function contentReady(){if(disposed)return;ready=true;if(frame!==null)cancelFrame(frame);const token=generation;frame=requestFrame(()=>{frame=null;if(disposed||token!==generation||!openingObserved||contentSeen||!visible(getContent(),document,window))return;contentSeen=collector.event('reader_content_visible',{stage:'reader_visible',outcome:'success',durationMs:duration()})!==false;publishResume();});}
  function publishResume(){if(disposed||resumed||!openingObserved||!contentSeen||!resumeState||resumeSuperseded)return;resumed=collector.event('reader_resume_result',{stage:'reader_resume',...resumeState,durationMs:duration()})!==false;}
  function pageTurned({trusted=false}={}){if(disposed||active||!trusted||!contentSeen||document.hidden||document.hasFocus?.()===false||!visible(getContent(),document,window))return;active=collector.event('reader_active',{stage:'reader_active',outcome:'success',durationMs:duration()})!==false;}
  function interact(event){
    if(event.isTrusted&&resumeState&&!resumed)resumeSuperseded=true;
    if(disposed||active||!contentSeen||!event.isTrusted||document.hidden||document.hasFocus?.()===false||!visible(getContent(),document,window))return;
    const target=event.target,content=getInteractionRoot();if(target?.closest?.('input,textarea,select,button,a,[contenteditable],dialog,[popover],#note-panel'))return;
    if(event.type==='keydown'){if(isPaginated()||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp',' ','Home','End'].includes(event.key))return;}
    else if(!content?.contains?.(target))return;
    active=true;collector.event('reader_active',{stage:'reader_active',outcome:'success',durationMs:duration()});
  }
  // The current opening's enum-only status is operational state, not a saved
  // analytics event. The initial consent observer may describe it now, after
  // real visible content, without backdating or replaying a reading action.
  function resumeResult({resume,restored=false,outcome}={}){if(disposed||resumed||resumeState||(resume==='restored'&&!restored))return;resumeState={resume,outcome:outcome||(resume==='failed'?'failure':resume==='none'?'skipped':resume)};publishResume();}
  const onVisibility=()=>{if(ready&&!contentSeen)contentReady();};
  for(const name of ['pointerdown','wheel','touchstart','keydown'])document?.addEventListener?.(name,interact,{capture:true,passive:true});
  const retryEvents=['visibilitychange','reader:page','reader:layout','reader:chapter','reader:content'];for(const name of retryEvents)document?.addEventListener?.(name,onVisibility);window?.addEventListener?.('scroll',onVisibility,{passive:true,capture:true});
  return {start,observeCurrentOpening,contentReady,interact,pageTurned,resumeResult,loadFailed(error){if(safeErrorKind(error)==='aborted'||(error?.status>=400&&error.status<500))return;collector.event('reader_load_failed',{stage:'reader_load',outcome:'failure',errorKind:safeErrorKind(error),durationMs:duration()});},dispose(){disposed=true;generation++;if(frame!==null)cancelFrame(frame);for(const name of ['pointerdown','wheel','touchstart','keydown'])document?.removeEventListener?.(name,interact,{capture:true});for(const name of retryEvents)document?.removeEventListener?.(name,onVisibility);window?.removeEventListener?.('scroll',onVisibility,{capture:true});}};
}
