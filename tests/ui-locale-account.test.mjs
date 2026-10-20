// GET-198 language core: explicit manual picker intents, picker success commit
// events and the account-actor recovery on the real createUiLocale runtime.
// Synthetic deferred catalogues and injected browser resources only: no
// browser, credentials, model calls or external writes. Only a picker commit
// that truly activated and completed both the history and device steps emits a
// manual success event; initial/route/popstate/account recovery never emit one
// and never save anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import {UI_PREFERENCE_KEY} from '../app/ui-locale-codec.mjs';
import en from '../app/ui-catalogs/en.mjs';
import zhHans from '../app/ui-catalogs/zh-Hans.mjs';
import zhHant from '../app/ui-catalogs/zh-Hant.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
const catalogues={en,'zh-Hans':zhHans,'zh-Hant':zhHant,ja};
const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};};
const flush=async(n=8)=>{for(let i=0;i<n;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({href='https://leafhour.com/library',languages=['en'],preference=null,loader=async code=>catalogues[code],storageFails=false,setDocumentLang=null}={}){
  const storage=new Map();if(preference)storage.set(UI_PREFERENCE_KEY,preference);
  const storageWrites=[],historyWrites=[],timers=new Map(),faults=[],loaderCalls=[];let timerId=0;
  const location={href};
  const history={state:{view:1},replaceState(state,title,url){historyWrites.push({state,title,url});this.state=state;location.href=new URL(url,location.href).href;}};
  const runtime=createUiLocale({
    loadCatalogue:async(code,options={})=>{loaderCalls.push([code,!!options.retry]);return loader(code,options);},
    storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(storageFails)throw Error('blocked storage');storageWrites.push([key,value]);storage.set(key,value);}},
    languages,
    history,
    getLocation:()=>({href:location.href}),
    getHistoryState:()=>history.state,
    setDocumentLang,
    timers:{setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)},
    reportFault:fault=>faults.push(fault)
  });
  return {runtime,location,history,storage,storageWrites,historyWrites,timers,faults,loaderCalls,fireTimers(){for(const [,fn]of [...timers]){timers.delete(fn);fn();}}};
}

test('legal picker intents mint increasing tokens and only a fully committed picker emits success',async()=>{
  const f=fixture();
  const intents=[],commits=[];
  f.runtime.onUiLocaleManualIntent(payload=>intents.push(payload));
  f.runtime.onUiLocaleManualCommit(payload=>commits.push(payload));
  // An illegal picker intent never mints a token and never notifies.
  assert.equal((await f.runtime.setUiLocale('fr')).reason,'invalid');
  assert.equal((await f.runtime.setUiLocale('zh')).reason,'invalid');
  assert.deepEqual(intents,[],'no token exists for an illegal picker intent');
  // The initial transaction is not a manual submission.
  await f.runtime.initializeOnce();
  assert.deepEqual(intents,[]);
  assert.deepEqual(commits,[]);
  const first=await f.runtime.setUiLocale('ja');
  assert.equal(first.kind,'committed+saved');
  assert.deepEqual(intents,[{token:1,code:'ja'}],'a legal picker intent starts with its token');
  assert.deepEqual(commits,[{token:1,code:'ja'}],'the committed picker emits its own token');
  await f.runtime.setUiLocale('zh-Hant');
  assert.deepEqual(intents.map(entry=>entry.token),[1,2],'tokens strictly increase per intent');
  assert.deepEqual(commits.map(entry=>entry.token),[1,2]);
  // route, explicit-route, popstate and account recovery are not manual
  // submissions: they emit no intent and no success commit.
  await f.runtime.requestUiRoute('en');
  await f.runtime.requestExplicitRoute('ja');
  f.location.href='https://leafhour.com/library?ui=zh-Hans';
  await f.runtime.handlePopstate();
  await f.runtime.requestAccountUiLocale('en',{isCurrent:()=>true});
  assert.deepEqual(intents.map(entry=>entry.token),[1,2]);
  assert.deepEqual(commits.map(entry=>entry.token),[1,2],'only picker commits emit manual success');
});

test('a picker that cannot complete the device step or its catalogue emits no success, and the explicit retry keeps the original token',async()=>{
  {
    const f=fixture({storageFails:true});
    const intents=[],commits=[];
    f.runtime.onUiLocaleManualIntent(payload=>intents.push(payload));
    f.runtime.onUiLocaleManualCommit(payload=>commits.push(payload));
    const result=await f.runtime.setUiLocale('ja');
    assert.equal(result.kind,'committed+session-only','the language still activates');
    assert.deepEqual(intents,[{token:1,code:'ja'}]);
    assert.deepEqual(commits,[],'an incomplete device step never emits a manual success event');
  }
  {
    let down=true;const f=fixture({loader:async code=>{if(down)throw Error('catalogue down');return catalogues[code];}});
    const intents=[],commits=[];
    f.runtime.onUiLocaleManualIntent(payload=>intents.push(payload));
    f.runtime.onUiLocaleManualCommit(payload=>commits.push(payload));
    const attempt=await f.runtime.setUiLocale('ja');
    assert.equal(attempt.reason,'load-failed','a failed picker never commits');
    assert.deepEqual(commits,[],'a failed picker never saves');
    down=false;
    await f.runtime.retryUiLocale();
    assert.deepEqual(intents.map(entry=>entry.token),[1],'the explicit retry continues the same intent');
    assert.deepEqual(commits,[{token:1,code:'ja'}],'the retry commit carries the original token');
    assert.deepEqual(f.loaderCalls,[['ja',false],['ja',true]],'the fixed retry variant only');
  }
});

test('account recovery activates through the account actor with no device preference, no history write and no remount',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const languages=[];
  f.runtime.onUiLocaleChange(code=>languages.push(code));
  const result=await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>true});
  assert.equal(result.kind,'committed+account','the account actor is explicit in the outcome');
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.equal(f.runtime.getUiLocaleState().persistence,'account','the account choice never claims a device save');
  assert.deepEqual(f.storageWrites,[],'account recovery never writes the device preference');
  assert.deepEqual(f.historyWrites,[],'account recovery never writes history');
  assert.equal(f.location.href,'https://leafhour.com/library','the URL is untouched');
  assert.deepEqual(languages,['ja'],'the catalogue activates in the same singleton');
  const again=await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>true});
  assert.equal(again.kind,'committed+account');
  assert.deepEqual(languages,['ja'],'a same-effective account restore never republishes labels');
});

test('the account isCurrent guard is rechecked after the async catalogue and before any active side effect',async()=>{
  const gate=deferred(),order=[];
  const f=fixture({loader:()=>{order.push('catalogue-load');return gate.promise;},setDocumentLang:code=>order.push('document-lang:'+code)});
  await f.runtime.initializeOnce();
  f.runtime.onUiLocaleChange(code=>order.push('language:'+code));
  f.runtime.onUiLocaleStateChange(()=>order.push('state'));
  let current=true;
  const pending=f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>{order.push('guard');return current;}});
  await flush();
  assert.deepEqual(order,['state','catalogue-load'],'no active side effect runs while the catalogue is still loading');
  assert.equal(f.runtime.getUiLocale(),'en');
  current=false;
  gate.resolve(ja);
  assert.deepEqual(await pending,{kind:'stale',reason:'guard'});
  assert.deepEqual(order,['state','catalogue-load','guard','state'],'the guard is rechecked after the catalogue and before every active side effect');
  assert.equal(f.runtime.getUiLocale(),'en','a stale guard never activates a language');
  const state=f.runtime.getUiLocaleState();
  assert.equal(state.phase,'ready','the stale request cleans up only its own pending bookkeeping');
  assert.equal(state.requested,'en');
  assert.equal(f.timers.size,0);
  assert.deepEqual(f.storageWrites,[]);
  assert.deepEqual(f.historyWrites,[]);
  // The cleaned-up state stays usable: a later picker commits normally.
  const picker=await f.runtime.setUiLocale('zh-Hant');
  assert.equal(picker.kind,'committed+saved');
  assert.equal(f.runtime.getUiLocale(),'zh-Hant');
});

test('a stale account guard cleans only its own pending and never tears down a newer picker',async()=>{
  const accountGate=deferred(),pickerGate=deferred();
  const f=fixture({loader:(code)=>code==='ja'?accountGate.promise:pickerGate.promise});
  await f.runtime.initializeOnce();
  const account=f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>false});
  await flush();
  const picker=f.runtime.setUiLocale('zh-Hant');
  await flush();
  assert.equal(f.runtime.getUiLocaleState().phase,'pending');
  accountGate.resolve(ja);
  assert.deepEqual(await account,{kind:'stale',reason:'superseded'});
  assert.equal(f.runtime.getUiLocale(),'en','the late account catalogue result only consumes');
  assert.equal(f.runtime.getUiLocaleState().phase,'pending','the newer picker keeps its own pending request');
  pickerGate.resolve(zhHant);
  assert.equal((await picker).kind,'committed+saved','the newer picker is never cancelled by the late account work');
  assert.equal(f.runtime.getUiLocale(),'zh-Hant');
});

test('an account recovery never cancels a pending manual picker intent',async()=>{
  const gate=deferred();
  const f=fixture({loader:()=>gate.promise});
  await f.runtime.initializeOnce();
  const picker=f.runtime.setUiLocale('ja');
  await flush();
  const outcome=await f.runtime.requestAccountUiLocale('zh-Hans',{isCurrent:()=>true});
  assert.deepEqual(outcome,{kind:'stale',reason:'manual-pending'});
  gate.resolve(ja);
  assert.equal((await picker).kind,'committed+saved','the user keeps operating the picker');
  assert.equal(f.runtime.getUiLocale(),'ja');
});

test('a null account recovery uses the write-free device/browser/route restore path',async()=>{
  {
    const f=fixture({preference:'zh-Hant'});
    await f.runtime.initializeOnce();
    assert.equal(f.runtime.getUiLocale(),'zh-Hant');
    await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>true});
    assert.equal(f.runtime.getUiLocale(),'ja','an old owner account language is active');
    const result=await f.runtime.requestAccountUiLocale(null,{isCurrent:()=>true});
    assert.equal(result.kind,'committed+account');
    assert.equal(f.runtime.getUiLocale(),'zh-Hant','the device preference restores the guest without inheriting the account language');
    assert.deepEqual(f.storageWrites,[],'the device/browser/route path writes no preference');
    assert.deepEqual(f.historyWrites,[],'the device/browser/route path writes no history');
  }
  {
    const f=fixture({languages:['ja-JP']});
    await f.runtime.initializeOnce();
    await f.runtime.requestAccountUiLocale('zh-Hans',{isCurrent:()=>true});
    await f.runtime.requestAccountUiLocale(null,{isCurrent:()=>true});
    assert.equal(f.runtime.getUiLocale(),'ja','the bounded browser fallback resolves last');
    assert.deepEqual(f.storageWrites,[]);
  }
  {
    const f=fixture({href:'https://leafhour.com/read?book=alice&ui=zh-Hans'});
    await f.runtime.initializeOnce();
    await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>true});
    await f.runtime.requestAccountUiLocale(null,{isCurrent:()=>true});
    assert.equal(f.runtime.getUiLocale(),'zh-Hans','a valid ui deep link wins the restore path');
  }
  {
    const f=fixture({href:'https://leafhour.com/ja'});
    await f.runtime.initializeOnce();
    assert.equal(f.runtime.getUiLocale(),'ja');
    await f.runtime.requestAccountUiLocale(null,{isCurrent:()=>true});
    assert.equal(f.runtime.getUiLocale(),'ja','an explicit authored path wins the restore path');
    assert.deepEqual(f.historyWrites,[]);
  }
});

test('account recovery keeps the reading URL, source context, drafts and the physical DOM untouched',async()=>{
  const f=fixture({href:'https://leafhour.com/read?book=alice&source=zh&passage=p3#note'});
  await f.runtime.initializeOnce();
  const node={textContent:''};
  const input={value:'my draft 中文'};
  const labels=f.runtime.createUiLabels();
  labels.text(node,'ui.language.label');
  f.runtime.onUiLocaleChange(()=>labels.refresh());
  await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>true});
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.equal(f.location.href,'https://leafhour.com/read?book=alice&source=zh&passage=p3#note','no history merge happens at all');
  assert.deepEqual(f.historyWrites,[]);
  assert.deepEqual(f.storageWrites,[]);
  assert.equal(node.textContent,ja['ui.language.label'],'the same physical node is re-translated in place');
  assert.equal(input.value,'my draft 中文','inputs and drafts are never rewritten or remounted');
});

test('the production singleton exposes the manual intent, manual commit and account recovery interfaces',async()=>{
  const singleton=await import('../app/ui-locale.mjs');
  for(const name of ['onUiLocaleManualIntent','onUiLocaleManualCommit','requestAccountUiLocale']){
    assert.equal(typeof singleton[name],'function',name+' must be exposed on the raw singleton');
    assert.equal(typeof singleton.uiLocale[name],'function',name+' must be exposed on the created runtime too');
  }
});

// ---------------------------------------------------------------------------
// Review counterexample C4 transcribed permanently: every async account
// completion branch (success/reject/timeout) rechecks the captured guard, a
// stale guard leaves no unguarded retry, a legitimate account failure retries
// explicitly WITH its original guard and never tears down a manual picker.

test('C4: a stale account guard on a failed or timed-out catalogue leaves no unguarded retry',async()=>{
  for(const outcome of ['reject','timeout']){
    const gate=deferred();let loadCalls=0;
    const f=fixture({loader:()=>++loadCalls===1?gate.promise:Promise.resolve(ja)});
    await f.runtime.initializeOnce();
    let current=true;
    const pending=f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>current});
    await flush();
    current=false;
    if(outcome==='reject')gate.reject(Error('offline'));
    else f.fireTimers();
    assert.deepEqual(await pending,{kind:'stale',reason:'guard'},outcome);
    assert.equal(f.runtime.getUiLocale(),'en',outcome);
    const state=f.runtime.getUiLocaleState();
    assert.equal(state.phase,'ready',outcome);
    assert.equal(state.retryTarget,null,outcome+' leaves no retry target');
    assert.equal(state.retryActor,null,outcome+' leaves no retry actor');
    await f.runtime.retryUiLocale();
    assert.equal(f.runtime.getUiLocale(),'en',outcome+' cannot resurrect the stale owner language');
    assert.equal(loadCalls,1,outcome+' mints no second module request');
  }
});

test('C4: a legitimate account failure retries explicitly with the original guard and the fixed variant',async()=>{
  let down=true,guardCalls=0;
  const f=fixture({loader:async code=>{if(down)throw Error('down');return catalogues[code];}});
  await f.runtime.initializeOnce();
  const failed=await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>{guardCalls++;return true;}});
  assert.equal(failed.reason,'load-failed');
  assert.equal(f.runtime.getUiLocaleState().retryActor,'account');
  down=false;
  assert.equal((await f.runtime.retryUiLocale()).kind,'committed+account');
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.deepEqual(f.loaderCalls,[['ja',false],['ja',true]],'the fixed retry variant only');
  assert.ok(guardCalls>=2,'the captured guard is rechecked on the explicit retry as well');
});

test('C4: an account retry whose captured guard went stale never activates the old language',async()=>{
  let down=true,current=true;
  const f=fixture({loader:async code=>{if(down)throw Error('down');return catalogues[code];}});
  await f.runtime.initializeOnce();
  await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>current});
  assert.equal(f.runtime.getUiLocaleState().retryActor,'account');
  down=false;current=false;
  assert.deepEqual(await f.runtime.retryUiLocale(),{kind:'stale',reason:'guard'});
  assert.equal(f.runtime.getUiLocale(),'en');
  assert.equal(f.runtime.getUiLocaleState().retryTarget,null);
  assert.equal(f.runtime.getUiLocaleState().retryActor,null);
  assert.deepEqual(f.loaderCalls,[['ja',false],['ja',true]],'one bounded fixed retry variant');
});

test('C4: an account retry never tears down a pending manual picker',async()=>{
  let down=true;const pickerGate=deferred();
  const f=fixture({loader:async code=>{if(down)throw Error('down');return code==='zh-Hant'?pickerGate.promise:catalogues[code];}});
  await f.runtime.initializeOnce();
  await f.runtime.requestAccountUiLocale('ja',{isCurrent:()=>true});
  assert.equal(f.runtime.getUiLocaleState().retryActor,'account');
  down=false;
  const picker=f.runtime.setUiLocale('zh-Hant');
  await flush();
  assert.deepEqual(await f.runtime.retryUiLocale(),{kind:'stale',reason:'manual-pending'});
  pickerGate.resolve(zhHant);
  assert.equal((await picker).kind,'committed+saved','the manual picker survives the account retry');
  assert.equal(f.runtime.getUiLocale(),'zh-Hant');
});
