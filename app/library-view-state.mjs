import {readWorkspaceView,workspaceUrl} from './reading-workspace-state.mjs';
// GET-176/179 library view URL state: one pure codec/reducer plus one explicit
// UI lifecycle adapter. Owned keys are q/scope/status/topic/language/form and exactly
// one overlay among filter/calendar/settings/upload/trash. Unknown parameters are
// never owned, validated or approved; form contents and owner IDs are never
// serialized. The adapter cancels stale search timers on popstate, hydration,
// reset and real owner switches so a stale callback cannot resurrect old state.
// History ownership: only modal overlays own one entry; the non-modal filter
// chooser owns none. App-written entries carry a bounded owner-generation tag
// (never an owner ID) so a pop into an older owner generation clears its stale
// owned state in place instead of resurrecting it.

export const LIBRARY_SCOPES=Object.freeze(['all','public','private']);
export const LIBRARY_STATUSES=Object.freeze(['all','reading','unread','finished']);
export const LIBRARY_FORMS=Object.freeze(['all','original','translated','bilingual']);
export const LIBRARY_TOPICS=Object.freeze(['all','philosophy','science','literature','history','fiction']);
export const LIBRARY_SETTINGS_TABS=Object.freeze(['account','reading-habits','daily-reading','appearance','data','about']);
// GET-201: one parse-only slug alias. Old links say settings=reading while the
// tab is named reading-habits. The alias is never a tab of its own: app actions
// and serialized URLs stay on the canonical set above.
const SETTINGS_TAB_ALIASES=Object.freeze({reading:'reading-habits'});
const settingsTab=value=>typeof value==='string'?(LIBRARY_SETTINGS_TABS.includes(value)?value:Object.hasOwn(SETTINGS_TAB_ALIASES,value)?SETTINGS_TAB_ALIASES[value]:null):null;
export const LIBRARY_OVERLAYS=Object.freeze(['settings','calendar','notebook','upload','trash','filter']);
export const LIBRARY_VIEW_KEYS=Object.freeze(['q','scope','status','topic','language','form','ui']);
export const LIBRARY_OVERLAY_KEYS=Object.freeze(['filter','calendar','notebook','settings','upload','trash']);

import {parseUiParam,isUiLocale,withUiParam} from './ui-locale-codec.mjs';

export const LIBRARY_QUERY_LIMIT=120;
const CONTROL_CHARS=/[\u0000-\u001f\u007f]/;

// One bounded query normalizer shared by live state, URL parsing, serialization
// and the current-view summary: blanks become empty, control characters and
// malformed Unicode are rejected outright, and length stays capped at 120.
export function normalizeLibraryQuery(value){
  if(typeof value!=='string')return '';
  const trimmed=value.trim();
  if(!trimmed||CONTROL_CHARS.test(trimmed)||!trimmed.isWellFormed())return '';
  const bounded=trimmed.slice(0,LIBRARY_QUERY_LIMIT);
  return /[\uD800-\uDBFF]$/.test(bounded)?bounded.slice(0,-1):bounded;
}
const languageValue=value=>{
  if(value==='unknown')return 'unknown';
  if(typeof value!=='string'||!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value))return null;
  return value.toLowerCase().split('-')[0];
};

export const libraryViewDefaults=()=>({query:'',scope:'all',status:'all',topic:'all',language:'all',form:'all'});

// Overlay normalization keeps business kind and tab apart and refuses any kind
// outside the routed set. Conflicting keys resolve in one fixed precedence.
export function normalizeOverlay(overlay){
  if(!overlay||typeof overlay!=='object')return null;
  const {kind,tab}=overlay;
  if(!LIBRARY_OVERLAYS.includes(kind))throw Object.assign(Error('overlay kind 无效'),{code:'LIBRARY_OVERLAY_INVALID'});
  if(kind==='settings'){
    if(!LIBRARY_SETTINGS_TABS.includes(tab))return null;
    return {kind:'settings',tab};
  }
  return {kind};
}

export function parseLibraryView(search){
  let params;
  try{params=new URLSearchParams(typeof search==='string'?search:'');}catch{return {view:libraryViewDefaults(),overlay:null};}
  const raw=key=>{const all=params.getAll(key);return all.length===1?all[0]:null;};
  const view=libraryViewDefaults();
  const query=normalizeLibraryQuery(raw('q'));if(query)view.query=query;
  const scope=raw('scope');if(LIBRARY_SCOPES.includes(scope))view.scope=scope;
  const status=raw('status');if(LIBRARY_STATUSES.includes(status))view.status=status;
  const topic=raw('topic');if(LIBRARY_TOPICS.includes(topic))view.topic=topic;
  const language=languageValue(raw('language'));if(language)view.language=language;
  const form=raw('form');if(LIBRARY_FORMS.includes(form))view.form=form;
  const settings=settingsTab(raw('settings')),calendar=raw('calendar'),notebook=raw('notebook'),upload=raw('upload'),trash=raw('trash'),filter=raw('filter');
  let overlay=null;
  if(settings!==null)overlay={kind:'settings',tab:settings};
  else if(calendar==='1')overlay={kind:'calendar'};
  else if(notebook==='1')overlay={kind:'notebook'};
  else if(upload==='1')overlay={kind:'upload'};
  else if(trash==='1')overlay={kind:'trash'};
  else if(filter==='1')overlay={kind:'filter'};
  return {view,overlay,ui:parseUiParam(params).code||null};
}

export function libraryViewParams({view,overlay}){
  const params=[];
  if(view.query)params.push(['q',view.query]);
  for(const key of ['scope','status','topic','language','form'])if(view[key]&&view[key]!=='all')params.push([key,view[key]]);
  if(overlay)params.push(overlay.kind==='settings'?['settings',overlay.tab]:[overlay.kind,'1']);
  return params;
}

// Rewrites only owned keys inside the current query; unrelated parameters and
// their order stay untouched.
export function writeLibraryView(search,state){
  const params=new URLSearchParams(typeof search==='string'?search:'');
  // GET-192: the view codec preserves exactly one validated ui alongside
  // shelf/q/topic/source-language/overlay writes. Invalid, duplicate or
  // conflicting values are dropped here; they never broaden the URL.
  const parsedUi=parseUiParam(params);
  for(const key of [...LIBRARY_VIEW_KEYS,...LIBRARY_OVERLAY_KEYS])params.delete(key);
  for(const [key,value] of libraryViewParams(state))params.append(key,value);
  const ui=isUiLocale(state?.ui)?state.ui:parsedUi.code;
  if(ui)params.append('ui',ui);
  const text=params.toString();
  return text?'?'+text:'';
}

export function libraryViewReducer(state,action){
  const current={view:{...state.view},overlay:state.overlay?{...state.overlay}:null};
  switch(action?.type){
    case 'hydrate':{
      const parsed=action.parsed||parseLibraryView(action.search);
      return {view:{...parsed.view},overlay:parsed.overlay?{...parsed.overlay}:null};
    }
    case 'set-view':{
      const patch=action.patch||{};
      for(const key of Object.keys(patch)){
        if(!['query','scope','status','topic','language','form'].includes(key))continue;
        current.view[key]=key==='query'?normalizeLibraryQuery(patch[key]):patch[key];
      }
      return current;
    }
    case 'set-query':current.view.query=normalizeLibraryQuery(action.query);return current;
    case 'clear':{
      const key=action.key;
      if(key==='query')current.view.query='';
      else if(['scope','status','topic','language','form'].includes(key))current.view[key]='all';
      return current;
    }
    case 'clear-all':current.view=libraryViewDefaults();return current;
    case 'open-overlay':current.overlay=normalizeOverlay(action.overlay);return current;
    case 'close-overlay':current.overlay=null;return current;
    default:return current;
  }
}

// Bounded shared return codec for auth: only /library with owned safe view and
// overlay keys survives. Reader and gift whitelists live in reader-return.mjs;
// no external destination and no unknown parameter is ever approved here.
export function safeLibraryReturn(value){
  if(typeof value!=='string'||value.length>1500||CONTROL_CHARS.test(value)||value.includes('\\')||!value.startsWith('/')||value.startsWith('//'))return null;
  let url;try{url=new URL(value,'https://reader.invalid');}catch{return null;}
  if(url.origin!=='https://reader.invalid'||url.pathname!=='/library'||url.hash||value.split('?')[0]!=='/library')return null;
  if(url.searchParams.has('workspace')){
    const allowed=['workspace','date','month','book','kind','wtopic','note','questions','ui'];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1))return null;
    const state=readWorkspaceView(url.search),locale=parseUiParam(url.searchParams);if(!state.page||!['valid','absent'].includes(locale.status))return null;
    for(const [key,value]of [['date',state.date],['month',state.month],['book',state.bookId],['kind',state.kind],['wtopic',state.topicId],['note',state.noteKey]])if(url.searchParams.has(key)&&!value)return null;
    if(url.searchParams.has('questions')&&url.searchParams.get('questions')!=='open')return null;
    return workspaceUrl(state,locale.code);
  }
  const parsed=parseLibraryView(url.search);
  return '/library'+writeLibraryView('',parsed);
}

// Explicit auth-return precedence used by the client login handoff: the upload
// retry, then the reader/gift whitelist, then the parsed safe library return,
// then the live library view. Callers only pass already-validated targets; form
// contents, owner IDs and external destinations are never inputs.
export function authReturnTarget({pendingUpload=false,readerReturn=null,libraryReturn=null,current='/library',ui}={}){
  const next=pendingUpload?'/library?upload=1':readerReturn||libraryReturn&&libraryReturn!=='/library'&&libraryReturn||(typeof current==='string'&&current.startsWith('/library')?current:'/library');
  return isUiLocale(ui)?withUiParam(next,ui):next;
}

// UI lifecycle adapter: explicit open/close/tab calls only. A modal overlay
// opened by the app owns exactly one history entry and may consume exactly that
// entry on an explicit close; the non-modal filter chooser owns none, and any
// direct-URL overlay only replaces/removes its own keys and never leaves the
// site. Every app-written entry carries a bounded owner-generation tag so pops
// into an older owner generation clear their stale owned state in place.
export function createLibraryViewHistory({window,onChange=()=>{},debounceMs=250,timers=globalThis,getUiLocale=()=>null,onBeforeUiPopstate=()=>()=>{}}){
  const history=window.history;
  const savedEpoch=history.state?.libraryState?.epoch;
  let state=parseLibraryView(window.location.search),epoch=Number.isSafeInteger(savedEpoch)&&savedEpoch>=0?savedEpoch:0,generation=0,pending=null,closing=null,destroyed=false,composing=false,sessionHandedOff=false;
  const emit=meta=>{if(!destroyed)onChange({view:{...state.view},overlay:state.overlay?{...state.overlay}:null},meta);};
  const marker=()=>{const value=history.state?.libraryOverlay;return value&&typeof value==='object'?value:null;};
  const ownsModalEntry=()=>{const own=marker();return !!own&&own.owned===true&&own.consumable===true&&own.epoch===epoch;};
  // Opaque, bounded entry identity is local history metadata, never account or
  // view data. A consumed close must match its exact predecessor, not any pop
  // in the same owner epoch. Replacements keep identity; pushes get a new one.
  const validEntry=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/.test(value);
  let entrySequence=0;
  // This is correlation, not authentication. Plain HTTP self-hosting need not
  // expose secure-context randomUUID; a local sequence plus fresh nonce works.
  const newEntry=()=>globalThis.crypto?.randomUUID?.()||`lh-${Date.now().toString(36)}-${(++entrySequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
  const predecessorEntry=()=>{
    const base=history.state&&typeof history.state==='object'?history.state:{};
    const tag=base.libraryState;
    if(tag?.epoch===epoch&&validEntry(tag.entry))return tag.entry;
    const entry=newEntry();
    // Tag only our namespace, retaining the predecessor's exact URL and all
    // foreign state even when open is called before initial hydration.
    history.replaceState({...base,libraryState:{epoch,entry}},'');
    return entry;
  };
  // overlayEntry: true writes this entry's modal marker, false removes it and
  // undefined preserves whatever marker the entry already carries. Ownership of
  // an app-created modal entry survives tab/overlay replacement and view
  // changes that extend the same entry.
  const commit=(mode,{overlayEntry,parentEntry,uiOverride,consumeAuth=false}={})=>{
    const search=new URLSearchParams(window.location.search);
    if(consumeAuth)for(const key of ['login','auth_error','next'])search.delete(key);
    // The runtime commits picker UI to the current URL independently. Captured
    // hydration state must never overwrite that successful route choice.
    const ui=isUiLocale(uiOverride)?uiOverride:parseUiParam(search).code||null;
    const url=window.location.pathname+writeLibraryView(search.toString(),{...state,ui})+(window.location.hash||'');
    const base={...(history.state&&typeof history.state==='object'?history.state:{})};
    const existing=base.libraryOverlay,tag=base.libraryState;
    const entry=mode==='replace'&&tag?.epoch===epoch&&validEntry(tag.entry)?tag.entry:newEntry();
    delete base.libraryOverlay;
    delete base.libraryState;
    if(overlayEntry===true&&state.overlay){
      const carried=existing&&typeof existing==='object'&&existing.owned===true&&existing.consumable===true&&existing.epoch===epoch;
      const parent=mode==='push'?parentEntry:carried?existing.parentEntry:null;
      base.libraryOverlay={kind:state.overlay.kind,...(state.overlay.tab?{tab:state.overlay.tab}:{}),owned:true,consumable:mode==='push'?true:!!carried,epoch,...(validEntry(parent)?{parentEntry:parent}:{})};
    }else if(overlayEntry===undefined&&existing&&typeof existing==='object')base.libraryOverlay=existing;
    base.libraryState={epoch,entry};
    if(mode==='push')history.pushState(base,'',url);else history.replaceState(base,'',url);
  };
  const cancelPending=()=>{if(pending!==null){timers.clearTimeout(pending);pending=null;}};
  const bump=()=>{generation++;closing=null;cancelPending();};
  const replace=meta=>{commit('replace');emit(meta);};
  // A discrete commit first flushes the pending query into the current entry,
  // then writes the new view. While an app-owned modal entry is current the new
  // view extends that entry so the overlay close still consumes exactly one
  // entry; otherwise the discrete change pushes a fresh entry.
  const push=meta=>{
    flushPending();
    if(ownsModalEntry())commit('replace',{overlayEntry:true});
    else commit('push',{overlayEntry:false});
    emit(meta);
  };
  const flushPending=()=>{if(pending!==null){cancelPending();commit('replace');}};

  function hydrate(){
    bump();
    state=parseLibraryView(window.location.search);
    commit('replace');
    emit({source:'hydrate'});
    return {view:{...state.view},overlay:state.overlay?{...state.overlay}:null};
  }
  function setView(patch,{source='user'}={}){
    flushPending();bump();
    state=libraryViewReducer(state,{type:'set-view',patch});
    push({source,action:'set-view'});
  }
  function clearView(key){
    flushPending();bump();
    state=libraryViewReducer(state,{type:'clear',key});
    push({source:'user',action:'clear'});
  }
  function clearAll(){
    flushPending();bump();
    state=libraryViewReducer(state,{type:'clear-all'});
    push({source:'user',action:'clear-all'});
  }
  function setQuery(value){
    closing=null;
    const next=normalizeLibraryQuery(value);
    state=libraryViewReducer(state,{type:'set-query',query:next});
    if(composing)return next;
    const own=++generation;
    cancelPending();
    pending=timers.setTimeout(()=>{
      pending=null;
      if(destroyed||own!==generation||composing)return;
      commit('replace');
      emit({source:'user',action:'set-query'});
    },debounceMs);
    return next;
  }
  function compositionStart(){
    closing=null;
    composing=true;
    cancelPending();
  }
  function compositionEnd(value){
    composing=false;
    return setQuery(value);
  }
  function openOverlay(overlay){
    const normalized=normalizeOverlay(overlay);
    flushPending();bump();
    state=libraryViewReducer(state,{type:'open-overlay',overlay:normalized});
    if(state.overlay.kind==='filter')commit('replace',{overlayEntry:false});
    else if(ownsModalEntry())commit('replace',{overlayEntry:true});
    else commit('push',{overlayEntry:true,parentEntry:predecessorEntry()});
    emit({source:'user',action:'open-overlay'});
  }
  function closeOverlay(reason='user'){
    if(!state.overlay)return;
    if(reason==='replaced'||reason==='owner'){closing=null;state=libraryViewReducer(state,{type:'close-overlay'});return;}
    bump();
    state=libraryViewReducer(state,{type:'close-overlay'});
    if(ownsModalEntry()){
      const own=marker(),ui=parseUiParam(window.location.search).code;
      // Only a successful, canonical URL choice crosses this one explicit
      // close. Requested/pending locale and unowned/legacy entries do not.
      if(ui&&ui===getUiLocale()&&validEntry(own.parentEntry))closing={ui,parentEntry:own.parentEntry,epoch,generation,pathname:window.location.pathname};
      history.back();return;
    }
    commit('replace',{overlayEntry:false});
    emit({source:'user',action:'close-overlay'});
  }
  function adoptOwner(){
    bump();
    epoch++;
    state=libraryViewReducer(state,{type:'clear-all'});
    state=libraryViewReducer(state,{type:'close-overlay'});
    commit('replace',{overlayEntry:false});
    emit({source:'owner',action:'reset'});
  }
  function normalizeClosePop(){
    const close=closing;closing=null;
    const target=history.state?.libraryState;
    if(!destroyed&&close&&close.ui===getUiLocale()&&close.generation===generation&&close.epoch===epoch&&close.pathname===window.location.pathname&&target?.epoch===epoch&&target.entry===close.parentEntry){
      // The runtime invokes this synchronously before reading its pop target.
      // Change only target ui; retain restored view/hash and exact history state.
      const href=window.location.pathname+window.location.search+(window.location.hash||'');
      history.replaceState(history.state,'',withUiParam(href,close.ui));
    }
  }
  function onPopState(){
    bump();
    const tag=history.state&&typeof history.state==='object'?history.state.libraryState:null;
    if(tag&&typeof tag==='object'&&tag.epoch!==epoch){
      // Popped into an older owner generation: clear its stale owned state in
      // place. Never push, never go back, keep unrelated parameters.
      state=parseLibraryView(window.location.search);
      state=libraryViewReducer(state,{type:'clear-all'});
      state=libraryViewReducer(state,{type:'close-overlay'});
      commit('replace',{overlayEntry:false});
      emit({source:'pop',cleared:true});
      return;
    }
    state=parseLibraryView(window.location.search);
    emit({source:'pop'});
  }
  const offBeforePop=onBeforeUiPopstate(normalizeClosePop);
  window.addEventListener('popstate',onPopState);
  return {
    snapshot:()=>({view:{...state.view},overlay:state.overlay?{...state.overlay}:null}),
    hydrate,setView,clearView,clearAll,setQuery,compositionStart,compositionEnd,openOverlay,closeOverlay,adoptOwner,
    // One bounded session-ready handoff: it reflects the CURRENT overlay, so a
    // stale hydrate descriptor can never resurrect an overlay the user already
    // replaced, and it can only be taken once.
    takeSessionOverlay(){
      if(sessionHandedOff)return null;
      sessionHandedOff=true;
      return state.overlay?{...state.overlay}:null;
    },
    // Adopting a validated safe auth return rewrites the current entry in place
    // and hands back the overlay to open. Never pushes, never calls back.
    adoptReturn(target){
      const safe=safeLibraryReturn(target);
      if(!safe)return null;
      bump();
      const parsed=parseLibraryView(safe.slice('/library'.length));
      state=libraryViewReducer({view:libraryViewDefaults(),overlay:null},{type:'hydrate',parsed});
      commit('replace',{overlayEntry:false,uiOverride:parsed.ui,consumeAuth:true});
      emit({source:'return',action:'adopt-return'});
      return state.overlay?{...state.overlay}:null;
    },
    destroy(){destroyed=true;bump();offBeforePop();window.removeEventListener('popstate',onPopState);}
  };
}
