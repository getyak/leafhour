// GET-192 shared mutable UI-locale runtime. This is the ONE physical browser
// module carrying the single mutable UI-language state: the compiled reader and
// the public lazy owners resolve the same /ui-locale.mjs URL and API identity.
//
// Boundaries:
// - static imports are only the pure codec and the immutable English catalogue;
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
import {UI_LOCALES,DEFAULT_UI_LOCALE,UI_PREFERENCE_KEY,isUiLocale,browserUiLocale,parseUiParam,withUiParam,readUiParam,mergeOwnedUi,classifyUiRoute,uiNavigationContext,sameUiNavigationContext} from './ui-locale-codec.mjs';
import englishCatalogue from './ui-catalogs/en.mjs';

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
  languages=[],
  history=null,
  getLocation=()=>globalThis.location||{href:''},
  getHistoryState=()=>history&&history.state,
  setDocumentLang=null,
  timers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)},
  reportFault=()=>{},
  english=englishCatalogue
}={}){
  if(typeof loadCatalogue!=='function')throw Error('createUiLocale requires a catalogue loader');
  const englishData=validateUiCatalogue(english,'en',english);
  const catalogues=new Map([['en',englishData]]);
  const attempts=new Map(); // code -> {base,retry}
  const languageListeners=new Set(),stateListeners=new Set(),faultListeners=new Set(),beforePopListeners=new Set(),roots=new Set();
  let generation=0,currentRequest=null,firstSettled=false,uiReadyResolve=null,started=false,startPromise=null;
  const uiReady=new Promise(resolve=>{uiReadyResolve=resolve;});
  const state={
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
    requested:state.requested,effective:state.effective,fallbackReason:state.fallbackReason,
    retryTarget:state.retryTarget,retryActor:state.retryActor,attempt:state.attempt,
    persistence:state.persistence,phase:state.phase,offerReload:state.offerReload,
    initialFallback:state.initialFallback
  });
  const emitState=()=>{for(const listener of [...stateListeners]){try{listener(snapshot());}catch(error){reportSubscriberFault('state',error);}}};
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
  const uiHref=url=>withUiParam(url,state.effective);
  const readPreference=()=>{
    try{return isUiLocale(storage?.getItem?.(UI_PREFERENCE_KEY))?storage.getItem(UI_PREFERENCE_KEY):null;}catch{return null;}
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
    if(retry&&!record.retry){
      record.retry=true;
      return validateUiCatalogue(await loadCatalogue(code,{retry:true}),code,englishData);
    }
    if(!retry&&!record.base){
      record.base=true;
      return validateUiCatalogue(await loadCatalogue(code,{retry:false}),code,englishData);
    }
    if(!retry&&!record.retry){
      // A new explicit user action after a base failure is the one explicit
      // retry: it uses the single fixed ?retry=1 variant and no other URL.
      record.retry=true;
      return validateUiCatalogue(await loadCatalogue(code,{retry:true}),code,englishData);
    }
    throw Object.assign(Error('UI catalogue load budget exhausted'),{code:'UI_CATALOGUE_EXHAUSTED'});
  };
  const settleFirst=()=>{
    if(firstSettled)return;
    firstSettled=true;
    uiReadyResolve(snapshot());
  };
  let currentContext=null,retryContext=null;
  const isAuthoredActor=()=>{
    const route=classifyUiRoute(uiNavigationContext(String(getLocation().href||'')).pathname);
    return route.kind!=='canonical';
  };
  const failRequest=(code,actor,reason,{error}={})=>{
    // Failure keeps every old active value: effective language, URL and the
    // device preference. The state discloses requested-vs-effective, the
    // retry target and the originating actor. After the one fixed retry
    // variant has also failed/timed out, no further module URL exists and the
    // only honest fallback is a manually activated reload.
    const record=attempts.get(code);
    const exhausted=reason==='exhausted'||(!catalogues.has(code)&&!!record&&record.base&&record.retry);
    state.phase='error';
    state.fallbackReason=reason;
    state.retryTarget=code;
    state.retryActor=actor;retryContext=currentContext;
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
  const commitHistoryFirst=(code,actor)=>{
    // Synchronous commit block: no await between the final navigation-context
    // check / location read and the history write, and history failure rejects
    // before any preference or active-language side effect.
    const href=String(getLocation().href||'');
    if(!sameUiNavigationContext(currentContext,uiNavigationContext(href)))return {kind:'stale',reason:'navigated'};
    let sessionOnly=false;
    if(actor==='picker'){
      let target;
      try{target=withUiParam(href,code);}catch{return {kind:'rejected',reason:'invalid-target'};}
      // Falsy history state (0, false, '') is preserved exactly.
      try{history.replaceState(getHistoryState()??null,'',target);}
      catch(error){return failRequest(code,actor,'history',{error});}
    }
    if(actor==='picker'||actor==='explicit-route'){
      if(!storage||typeof storage.setItem!=='function')sessionOnly=true;
      else{try{storage.setItem(UI_PREFERENCE_KEY,code);}catch{sessionOnly=true;}}
    }
    const previous=state.effective;
    state.requested=code;state.effective=code;state.fallbackReason='none';state.retryTarget=null;state.retryActor=null;retryContext=null;
    state.attempt=0;state.phase='ready';state.offerReload=false;state.initialFallback=false;
    state.persistence=actor==='picker'||actor==='explicit-route'?sessionOnly?'session-only':'saved':actor==='initial'?'initial':'route';
    if(setDocumentLang&&!isAuthoredActor()){try{setDocumentLang(code);}catch(error){reportSubscriberFault('document-lang',error);}}
    if(previous!==code||actor==='picker')publish();
    emitState();
    return {kind:sessionOnly?'committed+session-only':actor==='route'||actor==='initial'?'committed+route':'committed+saved',locale:code};
  };
  const run=async(code,actor,{useRetryVariant=false}={})=>{
    if(!isUiLocale(code))return {kind:'rejected',reason:'invalid'};
    const stamp=++generation;
    // A superseding request replaces the retry identity and settles the older
    // attempt as stale instead of leaving its caller promise hanging.
    cancelPending('superseded');
    state.retryTarget=null;state.retryActor=null;retryContext=null;
    if(code===state.effective&&(actor==='route'||actor==='initial')&&catalogues.has(code)){
      // Same-effective transitions skip formatting only: pending work was
      // already cancelled above and obsolete pending/error state clears.
      state.phase='ready';state.requested=code;state.fallbackReason='none';state.offerReload=false;state.initialFallback=false;
      state.persistence=actor==='initial'?'initial':'route';
      emitState();
      settleFirst();
      return {kind:'committed+route',locale:code,sameEffective:true};
    }
    currentContext=uiNavigationContext(String(getLocation().href||''));
    state.requested=code;state.phase='pending';state.fallbackReason='none';state.offerReload=false;
    emitState();
    const result=await new Promise(resolve=>{
      const request={timer:null,settle:null,settled:false};
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
      loadFor(code,{retry:useRetryVariant||(attempts.get(code)?.base&&!attempts.get(code)?.retry&&!catalogues.has(code))}).then(
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
      state.requested=state.effective;state.phase='ready';state.fallbackReason='none';
      state.retryTarget=null;state.retryActor=null;retryContext=null;state.attempt=0;state.offerReload=false;state.initialFallback=false;
      settleFirst();emitState();return {kind:'stale',reason:'navigated'};
    }
    if(result.kind==='timeout'||result.kind==='failed'){
      const exhausted=result.error?.code==='UI_CATALOGUE_EXHAUSTED';
      return failRequest(code,actor,result.kind==='timeout'?'timeout':exhausted?'exhausted':'load-failed',{error:result.error});
    }
    const outcome=commitHistoryFirst(code,actor);
    settleFirst();
    return outcome;
  };
  const routeTarget=()=>{
    // Canonical precedence: one validated query ui, then the saved choice, then
    // bounded navigator fallback. Authored routes are path-authoritative.
    const href=String(getLocation().href||'');
    const route=classifyUiRoute(uiNavigationContext(href).pathname);
    if(route.kind!=='canonical')return {code:route.code,actor:'route'};
    const query=readUiParam(href);
    if(query.status==='valid')return {code:query.code,actor:'route'};
    const saved=readPreference();
    if(saved)return {code:saved,actor:'route'};
    return {code:browserUiLocale(languages),actor:'initial'};
  };
  return {
    uiReady,
    t,
    createUiLabels(translate=t){return makeUiLabels(translate,error=>reportSubscriberFault('label',error));},
    bindUi,
    uiHref,
    getUiLocale:()=>state.effective,
    getRequestedUiLocale:()=>state.requested,
    getUiLocaleState:snapshot,
    readUiParam,
    mergeOwnedUi,
    onUiLocaleChange(fn){if(typeof fn==='function')languageListeners.add(fn);return()=>{languageListeners.delete(fn);};},
    onUiLocaleStateChange(fn){if(typeof fn==='function')stateListeners.add(fn);return()=>{stateListeners.delete(fn);};},
    onUiLocaleFault(fn){if(typeof fn==='function')faultListeners.add(fn);return()=>{faultListeners.delete(fn);};},
    onBeforeUiPopstate(fn){if(typeof fn==='function')beforePopListeners.add(fn);return()=>{beforePopListeners.delete(fn);};},
    setUiLocale(code){return isUiLocale(code)?run(code,'picker'):Promise.resolve({kind:'rejected',reason:'invalid'});},
    requestUiRoute(code){return isUiLocale(code)?run(code,'route'):Promise.resolve({kind:'rejected',reason:'invalid'});},
    requestExplicitRoute(code){return isUiLocale(code)?run(code,'explicit-route'):Promise.resolve({kind:'rejected',reason:'invalid'});},
    handlePopstate(){
      // Trusted document owners may normalize an explicitly consumed history
      // entry before route lookup. Window at-target listener order cannot give
      // a later capture listener this guarantee. Keep this protocol synchronous.
      for(const listener of [...beforePopListeners]){try{listener();}catch(error){reportSubscriberFault('before-popstate',error);}}
      // Native popstate is a route-override actor: no URL/device write, and an
      // authored route's path language wins over a conflicting ui.
      const target=routeTarget();
      return run(target.code,'route');
    },
    initialize(){
      // An authored route records its explicit route choice only after
      // successful catalogue activation; canonical surfaces never persist an
      // implicit choice.
      const href=String(getLocation().href||'');
      const route=classifyUiRoute(uiNavigationContext(href).pathname);
      if(route.kind!=='canonical')return run(route.code,'explicit-route');
      const query=readUiParam(href);
      if(query.status==='valid')return run(query.code,'route');
      const saved=readPreference();
      if(saved)return run(saved,'route');
      return run(browserUiLocale(languages),'initial');
    },
    initializeOnce(){
      if(!started){started=true;startPromise=Promise.resolve(this.initialize());}
      return startPromise;
    },
    retryUiLocale(){
      if(state.retryTarget&&retryContext&&!sameUiNavigationContext(retryContext,uiNavigationContext(String(getLocation().href||'')))){
        state.requested=state.effective;state.phase='ready';state.fallbackReason='none';
        state.retryTarget=null;state.retryActor=null;retryContext=null;state.attempt=0;state.offerReload=false;state.initialFallback=false;
        settleFirst();emitState();return Promise.resolve({kind:'stale',reason:'navigated'});
      }
      const target=state.retryTarget||state.requested;
      const actor=state.retryActor||'route';
      if(!isUiLocale(target))return Promise.resolve({kind:'rejected',reason:'invalid'});
      return run(target,actor,{useRetryVariant:true});
    }
  };
}

// Shared explicit locale fallback/retry notice for every actual page. It is
// mounted by the palette bootstrap (which covers all actual pages) with the
// runtime's own resources and stays completely separate from the palette's
// load-failure retry budget. Exhaustion offers only the honest manual reload.
export function mountUiLocaleNotice({document:doc=globalThis.document,runtime=uiLocale}={}){
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
function browserLanguages(){
  return globalThis.navigator?.languages||[];
}
export const uiLocale=createUiLocale({
  loadCatalogue:browserCatalogueLoader(),
  storage:browserStorage(),
  languages:browserLanguages(),
  history:globalThis.history||null,
  getLocation:()=>({href:globalThis.location?.href||''}),
  getHistoryState:()=>globalThis.history?.state,
  setDocumentLang:code=>{if(globalThis.document)globalThis.document.documentElement.lang=code;}
});

export const t=(id,params)=>uiLocale.t(id,params);
export const createUiLabels=(translate=t)=>uiLocale.createUiLabels(translate);
export const getUiLocale=()=>uiLocale.getUiLocale();
export const getUiLocaleState=()=>uiLocale.getUiLocaleState();
export const setUiLocale=code=>uiLocale.setUiLocale(code);
export const onUiLocaleChange=fn=>uiLocale.onUiLocaleChange(fn);
export const onUiLocaleStateChange=fn=>uiLocale.onUiLocaleStateChange(fn);
export const onUiLocaleFault=fn=>uiLocale.onUiLocaleFault(fn);
export const onBeforeUiPopstate=fn=>uiLocale.onBeforeUiPopstate(fn);
export const uiHref=url=>uiLocale.uiHref(url);
export const bindUi=root=>uiLocale.bindUi(root);
export const retryUiLocale=()=>uiLocale.retryUiLocale();
export const uiReady=uiLocale.uiReady;
export const requestUiRoute=code=>uiLocale.requestUiRoute(code);

// One idempotent production startup: every independent entry owner awaits the
// same uiReady (or falls back to the statically complete English catalogue),
// and the initial transaction runs exactly once per document.
if(globalThis.document&&globalThis.location){
  uiLocale.initializeOnce();
  globalThis.addEventListener?.('popstate',()=>{void uiLocale.handlePopstate();});
}
