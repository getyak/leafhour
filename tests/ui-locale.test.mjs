import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createUiLocale,browserCatalogueLoader,formatUiMessage,validateUiCatalogue,UI_LOCALE_ATTEMPT_MS} from '../app/ui-locale.mjs';
import * as codec from '../app/ui-locale-codec.mjs';
import {UI_LOCALES,DEFAULT_UI_LOCALE,UI_PREFERENCE_KEY,parseUiParam,normalizeUiLocale,browserUiLocale,withUiParam,readUiParam,classifyUiRoute,uiNavigationContext} from '../app/ui-locale-codec.mjs';
import {auditUiLocaleGraph,buildReaderWeb,targetFileOf} from '../tools/build-reader-web.mjs';
import en from '../app/ui-catalogs/en.mjs';
import zhHans from '../app/ui-catalogs/zh-Hans.mjs';
import zhHant from '../app/ui-catalogs/zh-Hant.mjs';
import ja from '../app/ui-catalogs/ja.mjs';

// The production transaction with injected browser resources: every case below
// runs the real commit matrix, not a model of it.
function fixture({loader,storage=null,href='https://leafhour.com/library',languages=[],history}={}){
  const calls=[];
  const timers=new Map();let timerId=0;
  const location={href};
  const writes=[];
  const realHistory=history||{state:{value:'history-state'},replaceState(state,title,url){writes.push({state,title,url});this.state=state;location.href=new URL(url,location.href).href;}};
  const faults=[];
  const runtime=createUiLocale({
    loadCatalogue:async(code,{retry=false}={})=>{calls.push(code+(retry?'?retry=1':''));return loader(code,{retry});},
    storage,
    languages,
    history:realHistory,
    getLocation:()=>({href:location.href}),
    getHistoryState:()=>realHistory.state,
    timers:{setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>{timers.delete(id);}},
    reportFault:fault=>faults.push(fault)
  });
  return {runtime,calls,location,history:realHistory,writes,timers,faults,fireTimers(){for(const [,timer]of [...timers]){timers.clear();timer.fn();}}};
}
const okCatalogue=code=>({en,'zh-Hans':zhHans,'zh-Hant':zhHant,ja}[code]||en);
const storeFrom=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)});

test('codec accepts only exact canonical codes in owned URLs and keeps bounded navigator mapping separate',()=>{
  assert.deepEqual(parseUiParam('ui=ja'),{status:'valid',code:'ja'});
  assert.deepEqual(parseUiParam('ui=zh-Hans'),{status:'valid',code:'zh-Hans'});
  assert.deepEqual(parseUiParam('ui=ja&ui=ja'),{status:'duplicate',code:null});
  assert.deepEqual(parseUiParam('ui=ja&ui=en'),{status:'conflict',code:null});
  for(const bad of ['ui=ja-JP','ui=zh-CN','ui=ja-unknown','ui=en-unknown','ui= ja ','ui=JA','ui=zz']){
    assert.deepEqual(parseUiParam(bad),{status:'unsupported',code:null},bad+' is unsupported in owned URLs');
  }
  assert.deepEqual(parseUiParam(''),{status:'absent',code:null});
  assert.equal(normalizeUiLocale('zh-TW'),'zh-Hant','bounded navigator alias mapping stays available');
  assert.equal(normalizeUiLocale('ja-JP'),'ja');
  assert.equal(normalizeUiLocale('ja-unknown'),null);
  assert.equal(normalizeUiLocale('en-unknown'),null);
  assert.equal(browserUiLocale(['fr-FR','zh-CN','en']),'zh-Hans');
  assert.equal(browserUiLocale([]),DEFAULT_UI_LOCALE);
  const url=withUiParam('/read?book=alice&passage=p7#note','ja');
  assert.equal(url,'/read?book=alice&passage=p7&ui=ja#note');
  assert.equal(readUiParam(url).code,'ja');
  assert.equal(typeof codec.safeUiNext,'undefined','the unused unsafe generic safe-next helper is gone');
});

test('route classification keeps authored path authority and canonical precedence',()=>{
  assert.deepEqual(classifyUiRoute('/'),{kind:'home',code:'en'});
  assert.deepEqual(classifyUiRoute('/zh-hans'),{kind:'home',code:'zh-Hans'});
  assert.deepEqual(classifyUiRoute('/ja'),{kind:'home',code:'ja'});
  assert.deepEqual(classifyUiRoute('/zh-hant/privacy'),{kind:'support',code:'zh-Hant'});
  assert.deepEqual(classifyUiRoute('/mcp'),{kind:'support',code:'en'});
  for(const path of ['/library','/read','/gift/abcdef','/evals','/source-review','/library/extra'])assert.deepEqual(classifyUiRoute(path),{kind:'canonical',code:null},path);
  assert.deepEqual(uiNavigationContext('https://leafhour.com/read?book=alice&source=zh'),{pathname:'/read',book:'alice',source:'zh'});
});

test('four catalogues are frozen data with equal keys and matching interpolation parameters',()=>{
  const catalogues={en,'zh-Hans':zhHans,'zh-Hant':zhHant,ja};
  for(const code of UI_LOCALES){
    assert.ok(Object.isFrozen(catalogues[code]),code+' is immutable');
    assert.deepEqual(Object.keys(catalogues[code]).sort(),Object.keys(en).sort(),code+' has the same keys as English');
    for(const [id,value] of Object.entries(catalogues[code])){
      assert.equal(typeof value,'string');
      const params=[...new Set([...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match=>match[1]))].sort();
      const enParams=[...new Set([...String(en[id]).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match=>match[1]))].sort();
      assert.deepEqual(params,enParams,id+' keeps explicit interpolation parameters');
    }
  }
  assert.equal(formatUiMessage('{name} · Account settings',{name:'Ada'}),'Ada · Account settings');
});

test('runtime catalogue validation enforces full coherence, not just required labels',()=>{
  assert.ok(validateUiCatalogue(en,'en',en));
  const missing={...ja};delete missing['ui.language.label'];
  assert.throws(()=>validateUiCatalogue(missing,'ja',en),/keys diverge/,'a missing key fails validation');
  const extra={...ja,'ui.future.key':'x'};
  assert.throws(()=>validateUiCatalogue(extra,'ja',en),/keys diverge/,'an extra key fails validation');
  const wrongParams={...ja,'ui.locale.loadFailed':'{language} only'};
  assert.throws(()=>validateUiCatalogue(wrongParams,'ja',en),/interpolation parameters diverge/,'param divergence fails validation');
  const notString={...ja};notString['ui.language.label']=42;
  assert.throws(()=>validateUiCatalogue(notString,'ja',en),/not a string/);
});

test('initial catalogue failure resolves uiReady once to usable English and keeps a retry target',async()=>{
  const f=fixture({loader:async()=>{throw Error('network down');},languages:['ja-JP']});
  void f.runtime.initialize();
  assert.equal(f.runtime.getUiLocaleState().phase,'pending');
  f.fireTimers();
  const ready=await f.runtime.uiReady;
  assert.equal(ready.effective,'en','uiReady resolves to a usable English fallback');
  assert.equal(f.runtime.getUiLocale(),'en');
  assert.equal(f.runtime.getUiLocaleState().requested,'ja','the requested language is disclosed honestly');
  assert.equal(f.runtime.getUiLocaleState().retryTarget,'ja');
  assert.equal(f.runtime.getUiLocaleState().initialFallback,true,'the initial English fallback is flagged');
  assert.equal(f.runtime.getUiLocaleState().retryActor,'initial');
  assert.equal(typeof f.runtime.t('ui.language.label'),'string','English controls are complete');
  await f.runtime.uiReady;
});

test('switch timeout keeps old UI/query/preference and offers the fixed retry variant only once',async()=>{
  const storage=new Map([[UI_PREFERENCE_KEY,'en']]);
  let rejectLoad;const f=fixture({loader:()=>new Promise((resolve,reject)=>{rejectLoad=reject;}),storage:storeFrom(storage)});
  void f.runtime.initialize();
  const attempt=f.runtime.setUiLocale('ja');
  assert.equal(f.runtime.getUiLocaleState().phase,'pending');
  f.fireTimers();
  assert.equal((await attempt).kind,'rejected');
  assert.equal((await attempt).reason,'timeout');
  assert.equal(f.runtime.getUiLocale(),'en','old active language is kept');
  assert.equal(f.runtime.getUiLocaleState().retryTarget,'ja');
  assert.equal(f.runtime.getUiLocaleState().phase,'error','a timeout settles into an explicit error state');
  assert.deepEqual(f.calls,['ja'],'no automatic retry');
  const retry=f.runtime.retryUiLocale();
  rejectLoad(Error('still down'));
  assert.equal((await retry).kind,'rejected');
  assert.equal((await retry).reason,'load-failed');
  assert.deepEqual(f.calls,['ja','ja?retry=1'],'the single fixed retry variant');
  assert.equal(f.runtime.getUiLocaleState().offerReload,true,'after the variant fails only a manual reload is offered');
  assert.equal(f.runtime.getUiLocaleState().fallbackReason,'load-failed');
  await f.runtime.setUiLocale('ja');
  assert.deepEqual(f.calls,['ja','ja?retry=1'],'repeated clicks create no further module URLs');
});

test('F1: history rejection settles an explicit history error in the old language before any write',async()=>{
  const storage=new Map([[UI_PREFERENCE_KEY,'en']]);
  const f=fixture({loader:async code=>okCatalogue(code),storage:storeFrom(storage),history:{state:{view:1},replaceState(){throw Error('history denied');}}});
  void f.runtime.initialize();
  const result=await f.runtime.setUiLocale('ja');
  assert.equal(result.kind,'rejected');
  assert.equal(result.reason,'history');
  const state=f.runtime.getUiLocaleState();
  assert.equal(state.phase,'error','the request settles instead of staying pending');
  assert.equal(state.fallbackReason,'history');
  assert.equal(state.effective,'en','active language is untouched');
  assert.equal(state.retryTarget,'ja','the retry target is the requested code');
  assert.equal(state.retryActor,'picker','the originating actor is retained');
  assert.equal(f.timers.size,0,'the owned timer is released');
  assert.equal(storage.get(UI_PREFERENCE_KEY),'en','no preference write happens after a history failure');
  assert.equal(storage.get('unrelated'),undefined);
  // A successful retry of the failed picker attempt performs the real
  // history-first commit and saves the choice.
  const fixed=fixture({loader:async code=>okCatalogue(code),storage:storeFrom(storage)});
  void fixed.runtime.initialize();
  const second=await fixed.runtime.setUiLocale('ja');
  assert.equal(second.kind,'committed+saved');
  assert.match(fixed.location.href,/ui=ja/);
  assert.equal(storage.get(UI_PREFERENCE_KEY),'ja');
});

test('F2: retry keeps the originating actor semantics for picker, route and authored activation',async()=>{
  // picker retry: history-first and device save.
  {
    const pending=new Map();const storage=new Map();
    const f=fixture({loader:(code,{retry=false}={})=>new Promise((resolve,reject)=>pending.set(code+(retry?'?retry=1':''),{resolve,reject})),storage:storeFrom(storage)});
    void f.runtime.initialize();
    const attempt=f.runtime.setUiLocale('ja');
    pending.get('ja').reject(Error('base down'));
    assert.equal((await attempt).reason,'load-failed');
    assert.equal(f.runtime.getUiLocaleState().retryActor,'picker');
    const retry=f.runtime.retryUiLocale();
    pending.get('ja?retry=1').resolve(okCatalogue('ja'));
    assert.equal((await retry).kind,'committed+saved','a picker retry saves like a picker');
    assert.equal(storage.get(UI_PREFERENCE_KEY),'ja');
    assert.match(f.location.href,/ui=ja/);
    assert.deepEqual(f.calls,['ja','ja?retry=1']);
  }
  // route retry: never writes URL or preference.
  {
    const pending=new Map();const storage=new Map([[UI_PREFERENCE_KEY,'en']]);
    const f=fixture({loader:(code,{retry=false}={})=>new Promise((resolve,reject)=>pending.set(code+(retry?'?retry=1':''),{resolve,reject})),storage:storeFrom(storage),href:'https://leafhour.com/library?ui=ja'});
    const first=f.runtime.initialize();
    pending.get('ja').reject(Error('base down'));
    assert.equal((await first).kind,'rejected');
    assert.equal(f.runtime.getUiLocaleState().retryActor,'route');
    const before=f.location.href;
    const retry=f.runtime.retryUiLocale();
    pending.get('ja?retry=1').resolve(okCatalogue('ja'));
    assert.equal((await retry).kind,'committed+route','a route retry stays a route actor');
    assert.equal(storage.get(UI_PREFERENCE_KEY),'en','the device choice is not overwritten');
    assert.equal(f.location.href,before,'the route retry writes no URL');
  }
  // authored activation retry persists its explicit choice after activation.
  {
    const pending=new Map();const storage=new Map();
    const f=fixture({loader:(code,{retry=false}={})=>new Promise((resolve,reject)=>pending.set(code+(retry?'?retry=1':''),{resolve,reject})),storage:storeFrom(storage),href:'https://leafhour.com/ja'});
    const first=f.runtime.initialize();
    pending.get('ja').reject(Error('base down'));
    assert.equal((await first).kind,'rejected');
    assert.equal(f.runtime.getUiLocaleState().retryActor,'explicit-route');
    const retry=f.runtime.retryUiLocale();
    pending.get('ja?retry=1').resolve(okCatalogue('ja'));
    assert.equal((await retry).kind,'committed+saved','the authored choice persists only after activation');
    assert.equal(storage.get(UI_PREFERENCE_KEY),'ja');
  }
});

test('F3: a changed navigation context makes the pending request stale with zero side effects',async()=>{
  let release;const slow=new Promise(resolve=>{release=resolve;});
  const storage=new Map([[UI_PREFERENCE_KEY,'en']]);
  const f=fixture({loader:()=>slow,storage:storeFrom(storage)});
  void f.runtime.initialize();
  const attempt=f.runtime.setUiLocale('ja');
  // Same document navigates to a different canonical context before settle.
  f.location.href='https://leafhour.com/read?book=other&ui=en';
  release(okCatalogue('ja'));
  assert.equal((await attempt).kind,'stale','a cross-context commit is refused');
  assert.equal(f.runtime.getUiLocale(),'en','no language commit');
  assert.equal(storage.get(UI_PREFERENCE_KEY),'en','no preference write');
  assert.ok(!/ui=ja/.test(f.location.href),'no URL write');
  assert.equal(f.writes.length,0,'no history write at all');
});

test('F3: same-context view writers change search/filter/overlay while waiting and only ui changes after success',async()=>{
  const storage=new Map();
  const f=fixture({loader:code=>new Promise(resolve=>setTimeout(()=>resolve(okCatalogue(code)),0)),storage:storeFrom(storage)});
  void f.runtime.initialize();
  const attempt=f.runtime.setUiLocale('ja');
  f.location.href='https://leafhour.com/library?q=alice&topic=fiction&settings=account#shelf';
  f.history.state={owner:7};
  await attempt;
  const url=new URL(f.location.href);
  assert.equal(url.searchParams.get('q'),'alice');
  assert.equal(url.searchParams.get('topic'),'fiction');
  assert.equal(url.searchParams.get('settings'),'account');
  assert.equal(url.hash,'#shelf');
  assert.deepEqual(url.searchParams.getAll('ui'),['ja'],'only the owned ui merge changes');
  assert.deepEqual(f.writes.at(-1).state,{owner:7},'the latest history.state is preserved exactly');
});

test('F6: falsy history.state values survive the owned ui merge exactly',async()=>{
  for(const value of [0,false,'',null,{deep:1}]){
    const f=fixture({loader:async code=>okCatalogue(code),history:{state:value,replaceState(state,title,url){this.last=state;this.state=state;}}});
    void f.runtime.initialize();
    await f.runtime.setUiLocale('ja');
    assert.equal(f.history.last,value,`state ${JSON.stringify(value)} is preserved`);
  }
});

test('late success and late failure after supersede only consume; timers settle stale',async()=>{
  const pending=new Map();const storage=new Map();
  const f=fixture({loader:code=>new Promise((resolve,reject)=>pending.set(code,{resolve,reject})),storage:storeFrom(storage)});
  void f.runtime.initialize();
  const old=f.runtime.setUiLocale('ja');
  const newer=f.runtime.setUiLocale('zh-Hans');
  pending.get('zh-Hans').resolve(okCatalogue('zh-Hans'));
  assert.equal((await newer).kind,'committed+saved');
  assert.equal(f.runtime.getUiLocale(),'zh-Hans');
  assert.equal(f.timers.size,0,'the superseded attempt releases its owned timer');
  pending.get('ja').resolve(okCatalogue('ja'));
  assert.equal((await old).kind,'stale');
  assert.equal(f.runtime.getUiLocale(),'zh-Hans','a late success never publishes');
  assert.equal(f.calls.join(','),'ja,zh-Hans');
  const failed=f.runtime.setUiLocale('zh-Hant');
  const newerAgain=f.runtime.setUiLocale('en');
  await newerAgain;
  pending.get('zh-Hant').reject(Error('late failure'));
  assert.equal((await failed).kind,'stale','a late failure never reports into newer state');
  assert.equal(f.runtime.getUiLocaleState().phase,'ready');
});

test('storage failure after successful history commits session-only and keeps other keys',async()=>{
  const storage=new Map([['unrelated','keep-me'],[UI_PREFERENCE_KEY,'en']]);
  const f=fixture({loader:async code=>okCatalogue(code),storage:{getItem:key=>storage.get(key)??null,setItem(){throw Error('quota');}}});
  void f.runtime.initialize();
  const result=await f.runtime.setUiLocale('ja');
  assert.equal(result.kind,'committed+session-only');
  assert.equal(f.runtime.getUiLocale(),'ja','the new UI still commits');
  assert.equal(f.runtime.getUiLocaleState().persistence,'session-only');
  assert.equal(storage.get(UI_PREFERENCE_KEY),'en','the stored preference keeps its old value');
  assert.equal(storage.get('unrelated'),'keep-me','other keys are untouched');
  assert.match(f.location.href,/ui=ja/,'owned links carry the new effective ui');
});

test('route overrides never write URL or preference; priority and invalid ui fall through',async()=>{
  const storage=new Map([[UI_PREFERENCE_KEY,'zh-Hant']]);
  const f=fixture({loader:async code=>okCatalogue(code),storage:storeFrom(storage),href:'https://leafhour.com/library?ui=ja'});
  const result=await f.runtime.initialize();
  assert.equal(result.kind,'committed+route');
  assert.equal(f.runtime.getUiLocale(),'ja','a valid canonical query ui wins');
  assert.equal(storage.get(UI_PREFERENCE_KEY),'zh-Hant','route overrides do not overwrite the saved choice');
  assert.equal(f.calls.length,1);
  const invalid=fixture({loader:async code=>okCatalogue(code),storage:storeFrom(storage),href:'https://leafhour.com/library?ui=zz'});
  const outcome=await invalid.runtime.initialize();
  assert.equal(invalid.runtime.getUiLocale(),'zh-Hant','invalid ui falls through to the saved choice');
  assert.equal(outcome.kind,'committed+route');
  const browser=fixture({loader:async code=>okCatalogue(code),href:'https://leafhour.com/library',languages:['ja-JP']});
  await browser.runtime.initialize();
  assert.equal(browser.runtime.getUiLocale(),'ja','browser language resolves last');
  assert.equal(browser.runtime.getUiLocaleState().persistence,'initial','initial resolution never persists a fallback');
});

test('F4: authored route language is authoritative over a conflicting ui query',async()=>{
  const storage=new Map([[UI_PREFERENCE_KEY,'en']]);
  const f=fixture({loader:async code=>okCatalogue(code),storage:storeFrom(storage),href:'https://leafhour.com/zh-hans?ui=ja'});
  const result=await f.runtime.initialize();
  assert.equal(f.runtime.getUiLocale(),'zh-Hans','the authored path wins over the conflicting query');
  assert.equal(result.kind,'committed+saved','an authored route records its explicit choice after activation');
  assert.equal(storage.get(UI_PREFERENCE_KEY),'zh-Hans');
});

test('same-effective Back cancels a pending picker attempt and never republishes labels',async()=>{
  const pending=new Map();
  const f=fixture({loader:code=>new Promise((resolve,reject)=>pending.set(code,{resolve,reject}))});
  void f.runtime.initialize();
  let notifications=0;f.runtime.onUiLocaleChange(()=>{notifications++;});
  const attempt=f.runtime.setUiLocale('ja');
  // Native Back lands on an older entry with the same effective language.
  f.location.href='https://leafhour.com/library?ui=en';
  const back=await f.runtime.requestUiRoute('en');
  assert.equal(back.sameEffective,true);
  assert.equal(notifications,0,'a same-effective transition does not republish labels');
  assert.equal(f.timers.size,0,'pending work is cancelled and its timer released');
  pending.get('ja').reject(Error('late rejection'));
  assert.equal((await attempt).kind,'stale','the pending picker attempt settles stale before Back returns');
  assert.equal(f.runtime.getUiLocale(),'en');
});

test('subscriber exceptions are isolated and reported as separate UI-update faults',async()=>{
  const storage=new Map();
  const f=fixture({loader:async code=>okCatalogue(code),storage:storeFrom(storage)});
  void f.runtime.initialize();
  let second=false;
  f.runtime.onUiLocaleChange(()=>{throw Error('owner render failed');});
  f.runtime.onUiLocaleChange(()=>{second=true;});
  const result=await f.runtime.setUiLocale('ja');
  assert.equal(result.kind,'committed+saved','a subscriber fault cannot become a catalogue failure');
  assert.equal(second,true,'other owners still update');
  assert.equal(f.faults.length,1);
  assert.equal(f.faults[0].kind,'language');
});

test('the real browser catalogue loader uses exactly six literal base/retry edges',async()=>{
  const loader=browserCatalogueLoader();
  assert.equal((await loader('en'))['ui.language.option.en'],'English');
  assert.equal((await loader('zh-Hans'))['ui.language.option.zh-Hans'],'简体中文');
  assert.equal((await loader('zh-Hant'))['ui.language.option.zh-Hant'],'繁體中文');
  assert.equal((await loader('ja'))['ui.language.option.ja'],'日本語');
  assert.equal((await loader('zh-Hans',{retry:true}))['ui.language.option.zh-Hans'],'简体中文');
  assert.equal((await loader('ja',{retry:true}))['ui.language.option.ja'],'日本語');
});

// ---------------------------------------------------------------------------
// Production ESM singleton: real route fixtures and idempotent bootstrap.
let singletonCase=0;
const savedGlobals=new Map();
function setGlobal(name,value){
  if(!savedGlobals.has(name))savedGlobals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
  Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
}
function restoreGlobals(){
  for(const [name,descriptor]of savedGlobals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  savedGlobals.clear();
}
async function productionSingleton({href,lang='en',languages=['en'],preference=null}){
  const storage=new Map();if(preference)storage.set(UI_PREFERENCE_KEY,preference);
  setGlobal('document',{documentElement:{lang},body:{classList:{contains:()=>false}}});
  setGlobal('location',{href});
  setGlobal('history',{state:null,replaceState(state,title,url){this.state=state;globalThis.location.href=new URL(url,href).href;}});
  setGlobal('localStorage',{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)});
  setGlobal('navigator',{languages});
  const mod=await import('../app/ui-locale.mjs?singleton='+(++singletonCase));
  return {mod,storage,location:globalThis.location};
}

test('production singleton bootstrap runs once and classifies actual routes',async t=>{
  t.after(restoreGlobals);
  {
    const {mod,storage}=await productionSingleton({href:'https://leafhour.com/read?book=alice&ui=ja',preference:'zh-Hant'});
    await mod.uiReady;
    assert.equal(mod.getUiLocale(),'ja','/read is canonical: a valid query ui wins');
    assert.equal(storage.get(UI_PREFERENCE_KEY),'zh-Hant','canonical routes never persist an implicit choice');
  }
  restoreGlobals();
  {
    const {mod,storage}=await productionSingleton({href:'https://leafhour.com/zh-hans?ui=ja'});
    await mod.uiReady;
    assert.equal(mod.getUiLocale(),'zh-Hans','authored home routes are path-authoritative');
    assert.equal(storage.get(UI_PREFERENCE_KEY),'zh-Hans','an authored route records its explicit choice after activation');
  }
  restoreGlobals();
  {
    const {mod,storage}=await productionSingleton({href:'https://leafhour.com/library',preference:'ja'});
    await mod.uiReady;
    assert.equal(mod.getUiLocale(),'ja','canonical routes fall through to the saved choice');
    assert.equal(storage.get(UI_PREFERENCE_KEY),'ja');
  }
  restoreGlobals();
  {
    const {mod}=await productionSingleton({href:'https://leafhour.com/ja/mcp'});
    await mod.uiReady;
    assert.equal(mod.getUiLocale(),'ja','support routes keep their route language');
    // The startup is idempotent: initializeOnce returns the same transaction.
    const again=mod.uiLocale.initializeOnce();
    assert.ok(again instanceof Promise);
    await again;
  }
});

// ---------------------------------------------------------------------------
// Graph: real syntactic edges (comments/strings never count) and actual builds.
const runtimeStub=[
 "import './ui-catalogs/en.mjs';",
 "export const load=async(code,{retry=false}={})=>{",
 " if(code==='zh-Hans')return retry?(await import('./ui-catalogs/zh-Hans.mjs?retry=1')).default:(await import('./ui-catalogs/zh-Hans.mjs')).default;",
 " if(code==='zh-Hant')return retry?(await import('./ui-catalogs/zh-Hant.mjs?retry=1')).default:(await import('./ui-catalogs/zh-Hant.mjs')).default;",
 " if(code==='ja')return retry?(await import('./ui-catalogs/ja.mjs?retry=1')).default:(await import('./ui-catalogs/ja.mjs')).default;",
 " return null;};"
].join('\n');
const catalogueFiles={'app/ui-catalogs/en.mjs':'export default {};','app/ui-catalogs/zh-Hans.mjs':'export default {};','app/ui-catalogs/zh-Hant.mjs':'export default {};','app/ui-catalogs/ja.mjs':'export default {};'};
const backing=['app/ui-locale.mjs','app/ui-locale-codec.mjs','app/ui-catalogs/en.mjs','app/ui-catalogs/zh-Hans.mjs','app/ui-catalogs/zh-Hant.mjs','app/ui-catalogs/ja.mjs'];
const readerHtml='<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><script type="module" src="/palette-bootstrap.mjs"></script><link rel="stylesheet" href="/styles.css"></head>';
async function graphFixture(t,files,release){
  const root=await mkdtemp(path.join(tmpdir(),'ui-locale-graph-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [file,contents]of Object.entries(files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),contents);}
  await writeFile(path.join(root,'release-files.json'),JSON.stringify(release));
  return root;
}
const lazyShell={'app/reader.js':'console.log("boot");','app/reader-translation.js':'export {};','app/styles.css':'body{color:#123}','app/command-palette.mjs':'export const palette={lazy:true};','app/palette-bootstrap.mjs':'export const open=()=>import("./command-palette.mjs");console.log(open);'};

test('the source graph allows only reviewed owners and the exact six real catalogue edges',async()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const audit=await auditUiLocaleGraph({root});
  assert.deepEqual(audit.catalogueEdges,['ja','ja?retry=1','zh-Hans','zh-Hans?retry=1','zh-Hant','zh-Hant?retry=1']);
  assert.ok(audit.owners.includes('app/library-shell.mjs'));
});

test('G2: comment-only catalogue imports never count and real six plus same-name comments pass',async t=>{
  const commentOnly=['import en from \'./ui-catalogs/en.mjs\';','export const uiLocale={en};',
   "// import('./ui-catalogs/zh-Hans.mjs');","// import('./ui-catalogs/zh-Hans.mjs?retry=1');",
   "// import('./ui-catalogs/zh-Hant.mjs');","// import('./ui-catalogs/zh-Hant.mjs?retry=1');",
   "// import('./ui-catalogs/ja.mjs');","// import('./ui-catalogs/ja.mjs?retry=1');"].join('\n');
  const root=await graphFixture(t,{'app/ui-locale.mjs':commentOnly,'app/library-shell.mjs':"import './ui-locale.mjs';export default 1;",...catalogueFiles},backing);
  await assert.rejects(auditUiLocaleGraph({root}),/exactly six/,'comment-only imports are not real edges');
  const commentedReal=runtimeStub+"\n// import('./ui-catalogs/ja.mjs'); import('./ui-catalogs/ja.mjs?retry=1');";
  const root2=await graphFixture(t,{'app/ui-locale.mjs':commentedReal,'app/library-shell.mjs':"import './ui-locale.mjs';export default 1;",...catalogueFiles},backing);
  const ok=await auditUiLocaleGraph({root:root2});
  assert.deepEqual(ok.catalogueEdges,['ja','ja?retry=1','zh-Hans','zh-Hans?retry=1','zh-Hant','zh-Hant?retry=1'],'same-name comments beside the real six are harmless');
});

test('G1: root-absolute, require, hash, alias and wrong-caller edges fail in audit AND actual build',async t=>{
  const cases={
   'root absolute query':{lazy:"import {uiLocale} from '/ui-locale.mjs?copy=1';export const locale=uiLocale;"},
   'root absolute exact':{lazy:"import {uiLocale} from '/ui-locale.mjs';export const locale=uiLocale;"},
   'require kind':{lazy:"export const locale=require('./ui-locale.mjs');"},
   'dynamic kind':{lazy:"export const locale=()=>import('./ui-locale.mjs');"},
   'hash alias':{lazy:"import './ui-locale.mjs#copy';export const locale=1;"},
   'path alias':{lazy:"import './ui-locale';export const locale=1;"},
   'catalogue edge':{lazy:"import './ui-catalogs/ja.mjs';export const locale=1;"},
   'opaque dynamic':{lazy:"const p='./ui-loca'+'le.mjs';export const locale=()=>import(p);"}
  };
  for(const [name,spec]of Object.entries(cases)){
   const files={'app/ui-locale.mjs':runtimeStub,...catalogueFiles,...lazyShell,'app/command-palette.mjs':spec.lazy};
   const release=[...new Set([...Object.keys(files),...backing])];
   const root=await graphFixture(t,files,release);
   await assert.rejects(auditUiLocaleGraph({root}),/.+/,name+' must fail the source audit');
   await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out'),html:readerHtml}),/.+/,name+' must fail the actual build');
  }
});

test('graph negatives: missing backing, wrong caller, unused permission and a fully authorized owner pass',async t=>{
  {
   const root=await graphFixture(t,{'app/ui-locale.mjs':runtimeStub,'app/library-shell.mjs':"import './ui-locale.mjs';export default 1;",...catalogueFiles},['app/library-shell.mjs']);
   await assert.rejects(auditUiLocaleGraph({root}),/missing release backing/);
  }
  {
   const files={'app/ui-locale.mjs':runtimeStub,'app/unreviewed-reader.mjs':"import './ui-locale.mjs';export default 1;",...catalogueFiles};
   const root=await graphFixture(t,files,backing);
   await assert.rejects(auditUiLocaleGraph({root}),/wrong caller|Unauthorized/);
  }
  {
   const files={'app/ui-locale.mjs':runtimeStub,'app/library-shell.mjs':'export default 1;',...catalogueFiles};
   const root=await graphFixture(t,files,backing);
   await assert.rejects(auditUiLocaleGraph({root}),/Unused ui-locale owner permission/);
  }
  {
   const files={'app/ui-locale.mjs':runtimeStub,'app/library-shell.mjs':"import './ui-locale.mjs';export default 1;",...catalogueFiles};
   const root=await graphFixture(t,files,backing);
   const ok=await auditUiLocaleGraph({root});
   assert.deepEqual(ok.owners,['app/library-shell.mjs']);
  }
});

test('targetFileOf maps relative, root-absolute and rejects bare specifiers',()=>{
  assert.equal(targetFileOf('app/reader.js','./ui-locale.mjs'),'app/ui-locale.mjs');
  assert.equal(targetFileOf('app/reader.js','/ui-locale.mjs?copy=1'),'app/ui-locale.mjs');
  assert.equal(targetFileOf('app/sub/x.mjs','../ui-locale.mjs'),'app/ui-locale.mjs');
  assert.equal(targetFileOf('app/x.mjs','some-package'),null);
});


test('before-pop normalizers run synchronously before route lookup with no extra preference or history write',async()=>{
  const storage=new Map(),f=fixture({href:'https://leafhour.com/library?ui=ja',loader:async code=>okCatalogue(code),storage:storeFrom(storage)});
  await f.runtime.initializeOnce();const order=[],writes=f.writes.length;
  const off=f.runtime.onBeforeUiPopstate(()=>{order.push(['normalize',f.runtime.getUiLocale()]);f.history.replaceState(f.history.state,'','/library?other=kept&ui=ja#anchor');});
  f.runtime.onBeforeUiPopstate(()=>order.push(['observe',new URL(f.location.href).searchParams.get('ui')]));
  f.location.href='https://leafhour.com/library?other=kept&ui=en#anchor';
  const result=f.runtime.handlePopstate();assert.deepEqual(order,[['normalize','ja'],['observe','ja']],'all trusted callbacks complete before handlePopstate returns');
  assert.equal((await result).kind,'committed+route');assert.equal(f.runtime.getUiLocale(),'ja');assert.equal(f.runtime.getUiLocaleState().phase,'ready');
  assert.equal(f.writes.length,writes+1,'only the normalizer writes its target ui');assert.equal(storage.size,0,'a route pop never persists a picker preference');
  assert.equal(f.history.state.value,'history-state');assert.equal(new URL(f.location.href).hash,'#anchor');off();
});

test('before-pop subscriptions release idempotently, deduplicate, and never run during picker or ordinary initialization',async()=>{
  const f=fixture({href:'https://leafhour.com/library?ui=en',loader:async code=>okCatalogue(code)});let calls=0;
  const listener=()=>{calls++;};const off=f.runtime.onBeforeUiPopstate(listener);f.runtime.onBeforeUiPopstate(listener);
  await f.runtime.initializeOnce();await f.runtime.setUiLocale('ja');await f.runtime.requestUiRoute('en');assert.equal(calls,0,'only handlePopstate enters the protocol');
  await f.runtime.handlePopstate();assert.equal(calls,1,'same listener is stored once');off();off();
  f.location.href='https://leafhour.com/library?ui=en';const writes=f.writes.length;await f.runtime.handlePopstate();
  assert.equal(calls,1);assert.equal(f.runtime.getUiLocale(),'en','unsubscribed native Back follows its actual route');assert.equal(f.writes.length,writes,'no hook means no history writes');
  const invalidOff=f.runtime.onBeforeUiPopstate(null);assert.equal(typeof invalidOff,'function');invalidOff();
  assert.equal(typeof (await import('../app/ui-locale.mjs')).onBeforeUiPopstate,'function','the production singleton exposes the same protocol');
});

test('before-pop normalizer faults are isolated and reported without changing route settlement',async()=>{
  const f=fixture({href:'https://leafhour.com/library?ui=ja',loader:async code=>okCatalogue(code)});await f.runtime.initializeOnce();
  let later=0,faults=0;const failure=Error('synthetic normalizer failed');
  f.runtime.onUiLocaleFault(()=>{faults++;throw Error('synthetic fault subscriber failed');});
  const off=f.runtime.onBeforeUiPopstate(()=>{throw failure;});f.runtime.onBeforeUiPopstate(()=>{later++;});
  f.location.href='https://leafhour.com/library?ui=en';const writes=f.writes.length;const result=await f.runtime.handlePopstate();
  assert.equal(result.kind,'committed+route');assert.equal(f.runtime.getUiLocale(),'en');assert.equal(f.runtime.getUiLocaleState().retryTarget,null);assert.equal(later,1);assert.equal(faults,1);
  assert.equal(f.faults.length,1);assert.equal(f.faults[0].kind,'before-popstate');assert.equal(f.faults[0].error,failure);assert.equal(f.writes.length,writes);
  off();await f.runtime.handlePopstate();assert.equal(later,2);assert.equal(f.faults.length,1,'off removes the throwing owner');
});
