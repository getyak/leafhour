// GET-192 shared mutable UI-locale runtime. This is the ONE physical browser
// module carrying the single mutable UI-language state: the compiled reader and
// the public lazy owners resolve the same /ui-locale.mjs URL and API identity.
//
// Boundaries:
// - static imports are the codec, English data and explicit account factories;
// - the three selected non-English catalogues load through exactly six literal
//   dynamic imports (three base URLs + three fixed ?retry=1 URLs) below;
// - no component imports and no cycle into any owner.
//
// Transaction rules (normative v2 commit matrix + v4 navigation settlement):
// one 3000ms bounded attempt per request generation, load/validate the selected
// catalogue FIRST, then a synchronous history-first commit; storage failure
// after successful history becomes honest session-only; late success/failure of
// superseded attempts may only cache code; a same-effective transition still
// advances the generation and cancels pending work without republishing labels;
// the owned canonical navigation context captured at request start is rechecked
// immediately before the first commit side effect.
//
// GET-198 manual/account split: every legal picker intent starts with a
// strictly increasing intent token and only the picker commit that truly
// activated and completed BOTH the history and device steps emits the matching
// manual success event. initial/route/popstate/account recovery never emit one.
// The account-actor recovery activates only catalogues in this same singleton:
// no device preference, no history write, no remount. Its caller-captured
// isCurrent guard is rechecked after the async catalogue settles and before
// any active state/document/subscription side effect; a stale guard settles
// only its own pending request and can never tear down a newer picker.
import {UI_LOCALES,DEFAULT_UI_LOCALE,UI_PREFERENCE_KEY,UI_SESSION_PREFERENCE_KEY,isUiLocale,isUiPreference,resolveUiPreference,browserUiLocale,parseUiParam,withUiParam,withoutUiParam,readUiParam,mergeOwnedUi,classifyUiRoute,uiNavigationContext,sameUiNavigationContext} from './ui-locale-codec.mjs';
import englishCatalogue from './ui-catalogs/en.mjs';
import {readInitialUiDecision} from './ui-first-paint-codec.mjs';
import {settleInitialUi,mirrorUiLanguageHint,readVerifiedUiSession} from './ui-first-paint-bootstrap.mjs';
import {createBrowserAccountUiPreferences} from './account-ui-preferences-browser.mjs';

export const UI_LOCALE_ATTEMPT_MS=3000;
export const UI_LOCALE_RETRY_QUERY='?retry=1';

// Exactly six catalogue edges: three base literals and three fixed retry
// literals. No other query, alias or path variant exists anywhere in the graph.
export function browserCatalogueLoader(){
  return async function loadCatalogue(code,{retry=false}={}){
    switch(code){
      case 'zh-Hans':return retry?(await import('./ui-catalogs/zh-Hans.mjs?retry=1')).default:(await import('./ui-catalogs/zh-Hans.mjs')).default;
      case 'zh-Hant':return retry?(await import('./ui-catalogs/zh-Hant.mjs?retry=1')).default:(await import('./ui-catalogs/zh-Hant.mjs')).default;
      case 'ja':return retry?(await import('./ui-catalogs/ja.mjs?retry=1')).default:(await import('./ui-catalogs/ja.mjs')).default;
      default:return englishCatalogue;
    }
  };
}

export function formatUiMessage(template,params){
  if(typeof template!=='string')return template==null?'':String(template);
  if(!params)return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g,(match,name)=>Object.prototype.hasOwnProperty.call(params,name)&&params[name]!=null?String(params[name]):match);
}

const messageParams=value=>[...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match=>match[1]);

// Per-owner bounded label tracking: owners record the nodes they own with
// stable message IDs and refresh exactly those in place on a language commit.
// No DOM walking, no business refresh, no remount; form drafts, IME state,
// focus, timers and request IDs are untouched.
function makeUiLabels(translate,report){
  // Bounded per-owner tracking: one entry per owned node+attribute slot, so
  // re-render paths can rewrite labels without growing state.
  const items=new Map();
  const record=(node,key,item)=>{
    let slots=items.get(node);
    if(!slots){slots=new Map();items.set(node,slots);}
    slots.set(key,item);
  };
  const prune=()=>{for(const node of items.keys())if(node.isConnected===false)items.delete(node);};
  return {
    text(node,id,params){
      record(node,'text',{node,id,params});
      try{node.textContent=translate(id,params);}catch(error){report(error);}
      return node;
    },
    attr(node,attribute,id,params){
      record(node,attribute,{node,id,params,attribute});
      try{node.setAttribute(attribute,translate(id,params));}catch(error){report(error);}
      return node;
    },
    forget(node,slot){
      if(slot===undefined)items.delete(node);
      else{const slots=items.get(node);slots?.delete(slot);if(!slots?.size)items.delete(node);}
    },
    prune,
    refresh({pruneDetached=false}={}){
      if(pruneDetached)prune();
      for(const slots of items.values())for(const item of slots.values()){
        try{
          if(item.attribute)item.node.setAttribute(item.attribute,translate(item.id,item.params));
          else item.node.textContent=translate(item.id,item.params);
        }catch(error){report(error);}
      }
    },
    clear(){items.clear();}
  };
}

// Cached UI message descriptors ({id,params}) reformat in place on a language
// commit. Unknown remote error prose is never a dictionary key: callers hand
// the honest generic fallback id instead of raw service text.
export function createUiMessage(render,translate=t){
  let last=null;
  return {
    set(id,params,error=false){last={id,params,error};render(translate(id,params),error);},
    clear(){last=null;render('',false);},
    refresh(){if(last)render(translate(last.id,last.params),last.error);}
  };
}

// Full catalogue coherence: identical keys and identical sets of explicit
// interpolation parameters against the complete English default data.
export function validateUiCatalogue(catalogue,code,english=englishCatalogue){
  if(!catalogue||typeof catalogue!=='object'||Array.isArray(catalogue))throw Object.assign(Error('UI catalogue is not data'),{code:'UI_CATALOGUE_INVALID',locale:code});
  const englishKeys=Object.keys(english).sort(),keys=Object.keys(catalogue).sort();
  if(keys.length!==englishKeys.length||keys.some((key,index)=>key!==englishKeys[index]))throw Object.assign(Error('UI catalogue keys diverge from English'),{code:'UI_CATALOGUE_INVALID',locale:code});
  for(const [id,value] of Object.entries(catalogue)){
    if(typeof value!=='string'||!id)throw Object.assign(Error('UI catalogue entry is not a string'),{code:'UI_CATALOGUE_INVALID',locale:code});
    const expected=[...new Set(messageParams(english[id]))].sort(),actual=[...new Set(messageParams(value))].sort();
    if(expected.length!==actual.length||expected.some((name,index)=>name!==actual[index]))throw Object.assign(Error('UI catalogue interpolation parameters diverge: '+id),{code:'UI_CATALOGUE_INVALID',locale:code});
  }
  return Object.freeze({...catalogue});
}

export function createUiLocale({
  loadCatalogue,
  storage=null,
  sessionStorage=null,
  languages=[],
  getLanguages=()=>languages,
  history=null,
  getLocation=()=>globalThis.location||{href:''},
  getHistoryState=()=>history&&history.state,
  setDocumentLang=null,
  timers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)},
  reportFault=()=>{},
  english=englishCatalogue,
  initialAccountPreference=null,
  initialDevicePreference=null
}={}){
  if(typeof loadCatalogue!=='function')throw Error('createUiLocale requires a catalogue loader');
  const englishData=validateUiCatalogue(english,'en',english);
  const catalogues=new Map([['en',englishData]]);
  const attempts=new Map(); // code -> {base,retry}
  const loading=new Map(); // code -> the in-flight base/retry catalogue promises
  const languageListeners=new Set(),stateListeners=new Set(),faultListeners=new Set(),beforePopListeners=new Set(),manualIntentListeners=new Set(),manualCommitListeners=new Set(),roots=new Set();
  let generation=0,currentRequest=null,firstSettled=false,uiReadyResolve=null,started=false,startPromise=null;
  let intentToken=0,retryIntentToken=null;
  let accountPreference=isUiPreference(initialAccountPreference)?initialAccountPreference:null,manualPreference=null,retryDecision=null,pendingChoice=null,pickerPromise=null,sessionRetry=null,lastPickerPreference=null;
  const uiReady=new Promise(resolve=>{uiReadyResolve=resolve;});
  const state={
    preference:'system',preferenceSource:'default',source:'default',pendingPreference:null,persistenceScope:null,
    requested:DEFAULT_UI_LOCALE,
    effective:DEFAULT_UI_LOCALE,
    fallbackReason:'none',
    retryTarget:null,
    retryActor:null,
    attempt:0,
    persistence:'initial',
    phase:'ready',
    offerReload:false,
    initialFallback:false
  };
  const snapshot=()=>Object.freeze({
    preference:state.preference,preferenceSource:state.preferenceSource,source:state.source,pendingPreference:state.pendingPreference,
    persistenceScope:state.persistenceScope,
    requested:state.requested,effective:state.effective,fallbackReason:state.fallbackReason,
    retryTarget:state.retryTarget,retryActor:state.retryActor,attempt:state.attempt,
    persistence:state.persistence,phase:state.phase,offerReload:state.offerReload,
    initialFallback:state.initialFallback
  });
  const emitState=()=>{for(const listener of [...stateListeners]){try{listener(snapshot());}catch(error){reportSubscriberFault('state',error);}}};
  const emitManualIntent=payload=>{for(const listener of [...manualIntentListeners]){try{listener(payload);}catch(error){reportSubscriberFault('manual-intent',error);}}};
  const emitManualCommit=payload=>{for(const listener of [...manualCommitListeners]){try{listener(payload);}catch(error){reportSubscriberFault('manual-commit',error);}}};
  // A caller guard may throw; a throwing guard is a stale guard.
  const guardHolds=isCurrent=>{if(typeof isCurrent!=='function')return true;try{return !!isCurrent();}catch{return false;}};
  const reportSubscriberFault=(kind,error)=>{
    try{reportFault({kind,error});}catch{}
    for(const listener of [...faultListeners]){try{listener({kind,error});}catch{}}
  };
  const messageFor=(node,id)=>formatUiMessage(catalogues.get(state.effective)?.[id]??englishData[id]??id,null);
  const bindNode=node=>{
    const id=node.getAttribute('data-ui');
    // A marked node that owns element children may hold source/user content,
    // inputs or dialogs: never replace its contents.
    if(id&&!node.children?.length){node.textContent=messageFor(node,id);node.setAttribute('lang',state.effective);}
    for(const attribute of ['aria-label','title','placeholder']){
      const key=node.getAttribute('data-ui-'+attribute);
      if(key){node.setAttribute(attribute,messageFor(node,key));node.setAttribute('lang',state.effective);}
    }
    for(const child of node.querySelectorAll?.('[data-ui],[data-ui-aria-label],[data-ui-title],[data-ui-placeholder]')||[]){
      const childId=child.getAttribute('data-ui');
      if(childId&&!child.children?.length){child.textContent=messageFor(child,childId);child.setAttribute('lang',state.effective);}
      for(const attribute of ['aria-label','title','placeholder']){
        const key=child.getAttribute('data-ui-'+attribute);
        if(key){child.setAttribute(attribute,messageFor(child,key));child.setAttribute('lang',state.effective);}
      }
    }
  };
  const bindUi=root=>{
    if(!root)return ()=>{};
    roots.add(root);bindNode(root);
    return ()=>{roots.delete(root);};
  };
  const publish=()=>{
    for(const root of [...roots]){try{bindNode(root);}catch(error){reportSubscriberFault('bind',error);}}
    for(const listener of [...languageListeners]){try{listener(state.effective);}catch(error){reportSubscriberFault('language',error);}}
  };
  const t=(id,params)=>{
    const catalogue=catalogues.get(state.effective)||englishData;
    const template=catalogue[id]??englishData[id];
    return formatUiMessage(template==null?id:template,params);
  };
  // Authored pages already display their route language before the first
  // catalogue settles. Keep early navigation in that language without treating
  // temporary English data as a committed choice. Once settled (including
  // fallback), later pending requests always retain the effective language.
  const getUiNavigationLocale=()=>{
    if(!firstSettled&&(generation===0||state.phase==='pending')){
      const route=classifyUiRoute(uiNavigationContext(String(getLocation().href||'')).pathname);
      if(route.kind!=='canonical')return route.code;
    }
    return state.effective;
  };
  const getUiLinkLocale=()=>(firstSettled?state.preference:resolveTarget().preference)==='system'?null:getUiNavigationLocale();
  const uiHref=url=>getUiLinkLocale()===null?withoutUiParam(url):withUiParam(url,getUiNavigationLocale());
  const readSessionPreference=()=>{try{const value=sessionStorage?.getItem?.(UI_SESSION_PREFERENCE_KEY);return isUiPreference(value)?value:null;}catch{return null;}};
  const readPreference=()=>{
    const session=readSessionPreference();if(session)return session;
    try{if(!storage||typeof storage.getItem!=='function')return isUiPreference(initialDevicePreference)?initialDevicePreference:null;const value=storage.getItem(UI_PREFERENCE_KEY);return isUiPreference(value)?value:null;}catch{return isUiPreference(initialDevicePreference)?initialDevicePreference:null;}
  };
  const resolveTarget=({account=accountPreference,manual=manualPreference,page=true}={})=>{
    const choice=resolveUiPreference({manual,account,device:readPreference()});
    let code=choice.preference==='system'?browserUiLocale(getLanguages()):choice.preference;
    let source=choice.preferenceSource;
    const href=String(getLocation().href||''),route=classifyUiRoute(uiNavigationContext(href).pathname),query=readUiParam(href);
    if(page&&(route.kind!=='canonical'||query.status==='valid')){code=route.kind!=='canonical'?route.code:query.code;source='page';}
    return {...choice,code,source,account,manual};
  };
  const cancelPending=reason=>{
    const request=currentRequest;
    currentRequest=null;
    if(!request)return;
    if(request.timer){try{timers.clearTimeout(request.timer);}catch{}request.timer=null;}
    request.settle({kind:'stale',reason});
  };
  const attemptRecord=code=>{
    if(!attempts.has(code))attempts.set(code,{base:false,retry:false});
    return attempts.get(code);
  };
  const loadFor=async(code,{retry})=>{
    const record=attemptRecord(code);
    if(catalogues.has(code))return catalogues.get(code);
    let pending=loading.get(code);if(!pending){pending={};loading.set(code,pending);}
    // Owner clear and restore may supersede each other's transactions. They
    // share the physical import, while each transaction keeps its own guard.
    if(pending.retry)return pending.retry;
    if(!retry&&pending.base)return pending.base;
    const variant=retry||record.base?'retry':'base';
    if(record[variant])throw Object.assign(Error('UI catalogue load budget exhausted'),{code:'UI_CATALOGUE_EXHAUSTED'});
    record[variant]=true;
    const promise=(async()=>validateUiCatalogue(await loadCatalogue(code,{retry:variant==='retry'}),code,englishData))();
    pending[variant]=promise;
    try{return await promise;}finally{if(pending[variant]===promise)delete pending[variant];}
  };
  const settleFirst=()=>{
    if(firstSettled)return;
    firstSettled=true;
    uiReadyResolve(snapshot());
  };
  let currentContext=null,retryContext=null,retryGuard=null;
  // A stale request cleans up ONLY its own pending bookkeeping; a newer
  // request owns the state and is never touched here.
  const clearOwnPending=()=>{
    state.pendingPreference=null;
    retryDecision=null;
    state.requested=state.effective;state.phase='ready';state.fallbackReason='none';
    state.retryTarget=null;state.retryActor=null;retryIntentToken=null;retryGuard=null;retryContext=null;
    state.attempt=0;state.offerReload=false;state.initialFallback=false;
  };
  const isAuthoredActor=()=>{
    const route=classifyUiRoute(uiNavigationContext(String(getLocation().href||'')).pathname);
    return route.kind!=='canonical';
  };
  const failRequest=(code,actor,reason,{error,intentToken:token=null,guard=null}={})=>{
    // Failure keeps every old active value: effective language, URL and the
    // device preference. The state discloses requested-vs-effective, the
    // retry target and the originating actor. After the one fixed retry
    // variant has also failed/timed out, no further module URL exists and the
    // only honest fallback is a manually activated reload. GET-198: a stored
    // account request keeps its captured guard so the one explicit retry can
    // never act unguarded.
    const record=attempts.get(code);
    const exhausted=reason==='exhausted'||(!catalogues.has(code)&&!!record&&record.base&&record.retry);
    state.phase='error';
    state.fallbackReason=reason;
    state.retryTarget=code;
    state.retryActor=actor;retryContext=currentContext;retryIntentToken=token;retryGuard=guard;
    state.offerReload=exhausted;
    if(!firstSettled){
      state.initialFallback=true;
      state.persistence='initial';
    }
    settleFirst();
    emitState();
    // The returned reason is the granular cause; exhaustion is carried by
    // offerReload (no further module URL exists) except for clicks that never
    // started an attempt at all.
    return {kind:'rejected',reason,error};
  };
  const commitHistoryFirst=(code,actor,{intentToken:token=null,isCurrent=null,decision=null}={})=>{
    // Synchronous commit block: no await between the final navigation-context
    // check / location read and the history write, and history failure rejects
    // before any preference or active-language side effect. The GET-198 caller
    // guard (account recovery) is rechecked here, before the first active
    // state/document/subscription side effect: a stale guard never activates
    // and never rolls back, because nothing has changed yet.
    if(!guardHolds(isCurrent))return {kind:'stale',reason:'guard'};
    const href=String(getLocation().href||'');
    if(!sameUiNavigationContext(currentContext,uiNavigationContext(href)))return {kind:'stale',reason:'navigated'};
    let sessionOnly=false;
    let persistenceScope=state.persistenceScope;
    if(actor==='picker'){
      let target;
      try{target=decision?.preference==='system'?withoutUiParam(href):withUiParam(href,code);}catch{return {kind:'rejected',reason:'invalid-target'};}
      // Falsy history state (0, false, '') is preserved exactly.
      try{history.replaceState(getHistoryState()??null,'',target);}
      catch(error){return failRequest(code,actor,'history',{error,intentToken:token,guard:isCurrent});}
    }
    if(actor==='picker'||actor==='explicit-route'){
      if(!storage||typeof storage.setItem!=='function')sessionOnly=true;
      else{try{storage.setItem(UI_PREFERENCE_KEY,decision?.preference||code);}catch{sessionOnly=true;}}
      if(sessionOnly){
        persistenceScope='page';
        try{if(typeof sessionStorage?.setItem==='function'){sessionStorage.setItem(UI_SESSION_PREFERENCE_KEY,decision?.preference||code);persistenceScope='tab';}}catch{}
      }else{
        persistenceScope='device';try{sessionStorage?.removeItem?.(UI_SESSION_PREFERENCE_KEY);}catch{}
      }
    }
    const previous=state.effective;
    const previousPreference=state.preference;
    const sessionChoice=decision?.account==null&&decision?.manual==null&&decision?.preference===readSessionPreference();
    const keepSessionOnly=sessionChoice||state.persistence==='session-only'&&decision?.manual!=null&&decision.manual===manualPreference;
    if(sessionChoice)persistenceScope='tab';
    if(decision){
      accountPreference=decision.account;manualPreference=decision.manual;
      state.preference=decision.preference;state.preferenceSource=decision.preferenceSource;state.source=decision.source;
    }
    state.pendingPreference=null;
    state.requested=code;state.effective=code;state.fallbackReason='none';state.retryTarget=null;state.retryActor=null;retryIntentToken=null;retryGuard=null;retryContext=null;
    retryDecision=null;
    state.attempt=0;state.phase='ready';state.offerReload=false;state.initialFallback=false;
    state.persistence=actor==='picker'||actor==='explicit-route'?sessionOnly?'session-only':'saved':keepSessionOnly?'session-only':actor==='initial'?'initial':actor==='account'?'account':'route';
    state.persistenceScope=persistenceScope;
    if(actor==='picker'){sessionRetry=sessionOnly?{decision,token}:null;lastPickerPreference=decision?.preference;}
    else if(actor==='explicit-route')lastPickerPreference=null;
    if(setDocumentLang&&!isAuthoredActor()){try{setDocumentLang(code);}catch(error){reportSubscriberFault('document-lang',error);}}
    if(previous!==code||previousPreference!==state.preference||actor==='picker')publish();
    emitState();
    return {kind:sessionOnly?'committed+session-only':actor==='route'||actor==='initial'?'committed+route':actor==='account'?'committed+account':'committed+saved',locale:code};
  };
  const run=async(code,actor,{useRetryVariant=false,intentToken:token=null,isCurrent=null,decision=resolveTarget()}={})=>{
    if(!isUiLocale(code))return {kind:'rejected',reason:'invalid'};
    const retryAfterFailure=(actor==='picker'||actor==='explicit-route')&&state.phase==='error'&&state.retryTarget===code;
    const stamp=++generation;
    // A superseding request replaces the retry identity and settles the older
    // attempt as stale instead of leaving its caller promise hanging.
    cancelPending('superseded');
    state.retryTarget=null;state.retryActor=null;retryIntentToken=null;retryGuard=null;retryContext=null;
    retryDecision=decision;
    if(code===state.effective&&(actor==='route'||actor==='initial')&&catalogues.has(code)){
      // Same-effective transitions skip formatting only: pending work was
      // already cancelled above and obsolete pending/error state clears.
      state.phase='ready';state.requested=code;state.fallbackReason='none';state.offerReload=false;state.initialFallback=false;
      if(state.persistence!=='session-only')state.persistence=actor==='initial'?'initial':'route';
      const modeChanged=state.preference!==decision.preference;
      state.preference=decision.preference;state.preferenceSource=decision.preferenceSource;state.source=decision.source;state.pendingPreference=null;
      if(modeChanged)publish();
      emitState();
      settleFirst();
      return {kind:'committed+route',locale:code,sameEffective:true};
    }
    currentContext=uiNavigationContext(String(getLocation().href||''));
    state.requested=code;state.phase='pending';state.pendingPreference=decision.preference;state.fallbackReason='none';state.offerReload=false;
    emitState();
    const result=await new Promise(resolve=>{
      const request={timer:null,settle:null,settled:false,actor,intentToken:token};
      const settle=outcome=>{
        if(request.settled)return;
        request.settled=true;
        if(request.timer){try{timers.clearTimeout(request.timer);}catch{}request.timer=null;}
        if(currentRequest===request)currentRequest=null;
        resolve(outcome);
      };
      request.settle=settle;
      currentRequest=request;
      request.timer=timers.setTimeout(()=>settle({kind:'timeout'}),UI_LOCALE_ATTEMPT_MS);
      loadFor(code,{retry:useRetryVariant||retryAfterFailure}).then(
        catalogue=>{if(catalogue&&stamp===generation&&!catalogues.has(code))catalogues.set(code,catalogue);settle({kind:'loaded',catalogue});},
        error=>settle({kind:'failed',error})
      );
    });
    if(stamp!==generation){
      // Late settlement of a superseded attempt: consume only. Code caching is
      // allowed; publication, URL and preference writes are not.
      if(result.kind==='loaded'&&result.catalogue&&!catalogues.has(code))catalogues.set(code,result.catalogue);
      return {kind:'stale',reason:'superseded'};
    }
    if(!sameUiNavigationContext(currentContext,uiNavigationContext(String(getLocation().href||'')))){
      // Every same-generation outcome from an obsolete canonical context is
      // consumed, including rejection/deadline: no obsolete retry can act.
      clearOwnPending();
      settleFirst();emitState();return {kind:'stale',reason:'navigated'};
    }
    // GET-198: every async completion branch (success, reject, timeout)
    // rechecks the captured caller guard before any outcome side effect. A
    // stale guard settles only its own request, leaves no retryable request
    // behind and never rolls back anything it never changed.
    if(!guardHolds(isCurrent)){
      clearOwnPending();
      settleFirst();emitState();return {kind:'stale',reason:'guard'};
    }
    if(result.kind==='timeout'||result.kind==='failed'){
      const exhausted=result.error?.code==='UI_CATALOGUE_EXHAUSTED';
      return failRequest(code,actor,result.kind==='timeout'?'timeout':exhausted?'exhausted':'load-failed',{error:result.error,intentToken:token,guard:isCurrent});
    }
    const outcome=commitHistoryFirst(code,actor,{intentToken:token,isCurrent,decision});
    settleFirst();
    if(outcome.kind==='stale'&&outcome.reason==='guard'&&stamp===generation){
      // A stale account guard cleans up ONLY its own pending bookkeeping; a
      // newer request owns the state and is never touched here.
      clearOwnPending();
      emitState();
    }
    if(actor==='picker'&&outcome.kind==='committed+saved'&&token)emitManualCommit({token,code:decision.preference});
    return outcome;
  };
  const routeTarget=()=>{
    // Canonical precedence: one validated query ui, then the saved choice, then
    // bounded navigator fallback. Authored routes are path-authoritative.
    return {...resolveTarget(),actor:'route'};
  };
  return {
    uiReady,
    t,
    createUiLabels(translate=t){return makeUiLabels(translate,error=>reportSubscriberFault('label',error));},
    bindUi,
    uiHref,
    getUiLocale:()=>state.effective,
    getUiNavigationLocale,
    getUiLinkLocale,
    getRequestedUiLocale:()=>state.requested,
    getUiLocaleState:snapshot,
    readUiParam,
    mergeOwnedUi,
    onUiLocaleChange(fn){if(typeof fn==='function')languageListeners.add(fn);return()=>{languageListeners.delete(fn);};},
    onUiLocaleStateChange(fn){if(typeof fn==='function')stateListeners.add(fn);return()=>{stateListeners.delete(fn);};},
    onUiLocaleFault(fn){if(typeof fn==='function')faultListeners.add(fn);return()=>{faultListeners.delete(fn);};},
    onBeforeUiPopstate(fn){if(typeof fn==='function')beforePopListeners.add(fn);return()=>{beforePopListeners.delete(fn);};},
    onUiLocaleManualIntent(fn){if(typeof fn==='function')manualIntentListeners.add(fn);return()=>{manualIntentListeners.delete(fn);};},
    onUiLocaleManualCommit(fn){if(typeof fn==='function')manualCommitListeners.add(fn);return()=>{manualCommitListeners.delete(fn);};},
    setUiLocale(code){
      // Every legal picker intent starts with its strictly increasing token,
      // emitted synchronously so owners can bind owner+intent at start.
      if(!isUiPreference(code))return Promise.resolve({kind:'rejected',reason:'invalid'});
      if(pendingChoice===code&&pickerPromise&&state.phase==='pending')return pickerPromise;
      if(lastPickerPreference===code&&state.phase==='ready'&&state.preference===code&&state.preferenceSource==='manual'&&state.source!=='page'&&state.effective===(code==='system'?browserUiLocale(getLanguages()):code))return Promise.resolve({kind:'unchanged'});
      const token=++intentToken;
      emitManualIntent({token,code});
      const decision=resolveTarget({manual:code,page:false});
      pendingChoice=code;
      const promise=run(decision.code,'picker',{intentToken:token,decision});
      pickerPromise=promise;
      void promise.finally(()=>{if(pickerPromise===promise){pendingChoice=null;pickerPromise=null;}});
      return promise;
    },
    requestUiRoute(code){return isUiLocale(code)?run(code,'route'):Promise.resolve({kind:'rejected',reason:'invalid'});},
    requestExplicitRoute(code){return isUiLocale(code)?run(code,'explicit-route',{decision:resolveTarget({manual:code,page:false})}):Promise.resolve({kind:'rejected',reason:'invalid'});},
    requestAccountUiLocale(code,{isCurrent=null}={}){
      // GET-198 account-actor recovery: activate only catalogues here, with no
      // device preference, no history write and no remount. `code:null` means
      // "no account choice" and resolves the write-free device/browser/route
      // path. A pending manual picker owns the request until it settles: an
      // account recovery must never tear it down.
      if(currentRequest&&currentRequest.actor==='picker')return Promise.resolve({kind:'stale',reason:'manual-pending'});
      if(code!==null&&!isUiPreference(code))return Promise.resolve({kind:'rejected',reason:'invalid'});
      const decision=resolveTarget({account:code,manual:null});
      return run(decision.code,'account',{isCurrent,decision});
    },
    invalidateUiOwner(){
      // Identity changes revoke old picker and retry capabilities immediately,
      // including A -> B -> A. A later catalogue can only warm its cache.
      ++generation;cancelPending('owner-changed');
      accountPreference=null;manualPreference=null;sessionRetry=null;lastPickerPreference=null;
      pendingChoice=null;pickerPromise=null;retryDecision=null;
      clearOwnPending();
      const decision=resolveTarget();
      return run(decision.code,'account',{decision});
    },
    handlePopstate(){
      // Trusted document owners may normalize an explicitly consumed history
      // entry before route lookup. Window at-target listener order cannot give
      // a later capture listener this guarantee. Keep this protocol synchronous.
      for(const listener of [...beforePopListeners]){try{listener();}catch(error){reportSubscriberFault('before-popstate',error);}}
      // Native popstate is a route-override actor: no URL/device write, and an
      // authored route's path language wins over a conflicting ui.
      const target=routeTarget();
      return run(target.code,'route',{decision:target});
    },
    initialize(){
      // Opening a document is read-only. Only a successful manual picker
      // (including a verified authored-link handoff) records a preference.
      const target=resolveTarget();
      state.preference=target.preference;state.preferenceSource=target.preferenceSource;
      if(readSessionPreference()&&target.preferenceSource==='device'){state.persistence='session-only';state.persistenceScope='tab';}
      return run(target.code,target.source==='default'?'initial':'route',{decision:target});
    },
    handleLanguagechange(){
      const decision=resolveTarget();
      if(decision.preference!=='system'||decision.source==='page'||currentRequest?.actor==='picker')return Promise.resolve({kind:'unchanged'});
      // Browser lifecycle events never spend the user's fixed retry import.
      if(state.requested===decision.code&&(state.phase==='pending'||state.phase==='error')||state.effective===decision.code&&state.phase==='ready')return Promise.resolve({kind:'unchanged'});
      if(!catalogues.has(decision.code)&&attempts.get(decision.code)?.base)return Promise.resolve({kind:'unchanged'});
      return run(decision.code,'system',{decision});
    },
    handleStorage(){
      // A tab cannot override this document's picker, explicit account or temporary choice.
      if(manualPreference!==null||accountPreference!==null||state.persistence==='session-only'||currentRequest?.actor==='picker')return Promise.resolve({kind:'unchanged'});
      const decision=resolveTarget();
      return run(decision.code,'route',{decision});
    },
    initializeOnce(){
      if(!started){started=true;startPromise=Promise.resolve(this.initialize());}
      return startPromise;
    },
    retryUiLocale(){
      // GET-198: a retry must never tear down a manual picker that is still
      // operating, whichever request stored the retry identity (the picker's
      // own run already replaced it).
      if(currentRequest&&currentRequest.actor==='picker')return Promise.resolve({kind:'stale',reason:'manual-pending'});
      if(state.persistence==='session-only'&&state.phase!=='error'){
        // A restored tab has no token from this document. Bind a new intent
        // to its current owner before attempting device/account persistence.
        if(!sessionRetry)return this.setUiLocale(state.preference);
        const decision=resolveTarget({manual:sessionRetry.decision.preference,page:false});
        return run(decision.code,'picker',{intentToken:sessionRetry.token,decision});
      }
      if(state.retryTarget&&retryContext&&!sameUiNavigationContext(retryContext,uiNavigationContext(String(getLocation().href||'')))){
        clearOwnPending();
        settleFirst();emitState();return Promise.resolve({kind:'stale',reason:'navigated'});
      }
      const originalTarget=state.retryTarget||state.requested;
      let decision=retryDecision||resolveTarget();
      if(decision.preference==='system'&&decision.source!=='page')decision={...decision,code:browserUiLocale(getLanguages())};
      const target=decision.code||originalTarget;
      const actor=state.retryActor||'route';
      if(!isUiLocale(target))return Promise.resolve({kind:'rejected',reason:'invalid'});
      // A picker retry continues the same manual intent token; an account
      // retry reuses its captured guard so it can never act unguarded.
      return run(target,actor,{useRetryVariant:target===originalTarget,intentToken:retryIntentToken,isCurrent:retryGuard,decision});
    }
  };
}

// Shared explicit locale fallback/retry notice for every actual page. It is
// mounted by the palette bootstrap (which covers all actual pages) with the
// runtime's own resources and stays completely separate from the palette's
// load-failure retry budget. Exhaustion offers only the honest manual reload.
export function mountUiLocaleNotice({document:doc=globalThis.document,runtime={...uiLocale,getUiLocaleState,onUiLocaleStateChange,retryUiLocale}}={}){
  if(!doc?.createElement)return {update(){},unmount(){}};
  const notice=doc.createElement('div');notice.className='locale-notice';notice.setAttribute('role','status');
  const retry=doc.createElement('button');retry.type='button';retry.className='text-link locale-retry';
  const reload=doc.createElement('button');reload.type='button';reload.className='text-link locale-reload';
  retry.addEventListener('click',()=>{runtime.retryUiLocale().catch(()=>{});});
  reload.addEventListener('click',()=>{globalThis.location?.reload?.();});
  notice.append(retry,reload);
  (doc.body||doc.documentElement)?.append?.(notice);
  const update=()=>{
    const state=runtime.getUiLocaleState();
    const target=runtime.t('ui.language.option.'+(state.retryTarget||state.requested||'en'));
    const effective=runtime.t('ui.language.option.'+(state.effective||'en'));
    retry.textContent=runtime.t('ui.locale.retry');reload.textContent=runtime.t('ui.locale.reload');
    if(state.phase==='error'){
      notice.hidden=false;
      notice.textContent=state.fallbackReason==='history'?runtime.t('ui.locale.historyError'):state.initialFallback?runtime.t('ui.locale.fallback.notice',{language:target}):runtime.t('ui.locale.loadFailed',{language:target,effective});
      notice.append(retry,reload);
      retry.hidden=!!state.offerReload;reload.hidden=!state.offerReload;
    }else if(['error','conflict'].includes(state.account?.phase)){
      notice.hidden=false;notice.textContent=runtime.t('ui.accountLocale.'+state.account.phase);notice.append(retry,reload);
      retry.hidden=false;reload.hidden=true;
    }else notice.hidden=true;
  };
  update();
  const off=runtime.onUiLocaleStateChange(update);
  const offLanguage=runtime.onUiLocaleChange(update);
  return {update,unmount(){off();offLanguage();notice.remove();}};
}

// Production singleton: real browser storage/history/URL, real catalogue edges.
function browserStorage(){
  try{return globalThis.localStorage||null;}catch{return null;}
}
function browserSessionStorage(){try{return globalThis.sessionStorage||null;}catch{return null;}}
function browserLanguages(){
  const nav=globalThis.navigator;
  return nav?.languages?.length?nav.languages:[nav?.language].filter(Boolean);
}
const stampedInitialUi=readInitialUiDecision(globalThis.document);
const initialRoute=classifyUiRoute(globalThis.location?.pathname||'/');
const initialUi=stampedInitialUi||(initialRoute.kind!=='canonical'?{locale:initialRoute.code,source:'page',preference:initialRoute.code,ownerId:null,deviceHint:null}:null);
let initialUiSettled=!initialUi;
export const uiLocale=createUiLocale({
  loadCatalogue:browserCatalogueLoader(),
  initialAccountPreference:stampedInitialUi?.source==='account'?stampedInitialUi.preference:null,
  initialDevicePreference:stampedInitialUi?.source==='device'?stampedInitialUi.preference:null,
  storage:browserStorage(),
  sessionStorage:browserSessionStorage(),
  getLanguages:browserLanguages,
  history:globalThis.history||null,
  getLocation:()=>({href:globalThis.location?.href||''}),
  getHistoryState:()=>globalThis.history?.state,
  setDocumentLang:code=>{if(globalThis.document?.documentElement&&(initialUiSettled||!initialUi||code===initialUi.locale))globalThis.document.documentElement.lang=code;}
});

const browserAccountUi=createBrowserAccountUiPreferences({runtime:uiLocale,initialDecision:stampedInitialUi});
export const readUiSession=options=>readVerifiedUiSession(options);
export const adoptUiOwner=(owner,{verified=true}={})=>verified?browserAccountUi.adoptOwner(owner):Promise.resolve({adopted:false});

export const t=(id,params)=>uiLocale.t(id,params);
export const createUiLabels=(translate=t)=>uiLocale.createUiLabels(translate);
export const getUiLocale=()=>uiLocale.getUiLocale();
export const getUiNavigationLocale=()=>uiLocale.getUiNavigationLocale();
export const getUiLinkLocale=()=>uiLocale.getUiLinkLocale();
export const getUiLocaleState=()=>browserAccountUi.getUiLocaleState();
export const setUiLocale=code=>uiLocale.setUiLocale(code);
export const onUiLocaleChange=fn=>uiLocale.onUiLocaleChange(fn);
export const onUiLocaleStateChange=fn=>browserAccountUi.onUiLocaleStateChange(fn);
export const onUiLocaleFault=fn=>uiLocale.onUiLocaleFault(fn);
export const onBeforeUiPopstate=fn=>uiLocale.onBeforeUiPopstate(fn);
export const uiHref=url=>uiLocale.uiHref(url);
export const bindUi=root=>uiLocale.bindUi(root);
export const retryUiLocale=()=>browserAccountUi.retryUiLocale();
export const requestAccountUiLocale=(code,options)=>uiLocale.requestAccountUiLocale(code,options);
export const onUiLocaleManualIntent=fn=>uiLocale.onUiLocaleManualIntent(fn);
export const onUiLocaleManualCommit=fn=>uiLocale.onUiLocaleManualCommit(fn);
export const uiReady=uiLocale.uiReady;
export const requestUiRoute=code=>uiLocale.requestUiRoute(code);

// One idempotent production startup: every independent entry owner awaits the
// same uiReady (or falls back to the statically complete English catalogue),
// and the initial transaction runs exactly once per document.
if(globalThis.document&&globalThis.location){
  if(initialUi){await settleInitialUi(uiLocale,{initialDecision:initialUi});initialUiSettled=true;document.documentElement.lang=uiLocale.getUiLocale();}
  else uiLocale.initializeOnce();
  mirrorUiLanguageHint();uiLocale.onUiLocaleStateChange(()=>mirrorUiLanguageHint());
  if(classifyUiRoute(globalThis.location.pathname||uiNavigationContext(String(globalThis.location.href||'')).pathname).kind==='support')void browserAccountUi.verifySupportOwner();
  globalThis.addEventListener?.('popstate',()=>{void uiLocale.handlePopstate();});
  globalThis.addEventListener?.('languagechange',()=>{void uiLocale.handleLanguagechange();});
  globalThis.addEventListener?.('storage',event=>{if(event.key===UI_PREFERENCE_KEY)void uiLocale.handleStorage();});
  globalThis.addEventListener?.('pageshow',event=>{if(event.persisted)void uiLocale.handlePopstate();});
}
