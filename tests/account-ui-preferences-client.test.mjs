// GET-198 account UI-preferences client bridge: the real createUiLocale
// runtime with synthetic deferred read/write IO. Synthetic owners and
// snapshots only: no browser, auth probing, credentials, model calls, reading
// records or external writes. The bridge never owns a second active language,
// never fetches auth and never guesses an owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountUiPreferencesBridge,isAccountUiSnapshot,ACCOUNT_UI_PHASES,ACCOUNT_UI_REASONS} from '../app/account-ui-preferences.mjs';
import {createUiLocale} from '../app/ui-locale.mjs';
import {UI_PREFERENCE_KEY} from '../app/ui-locale-codec.mjs';
import en from '../app/ui-catalogs/en.mjs';
import zhHans from '../app/ui-catalogs/zh-Hans.mjs';
import zhHant from '../app/ui-catalogs/zh-Hant.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
const catalogues={en,'zh-Hans':zhHans,'zh-Hant':zhHant,ja};
const stamp='2026-10-20T08:00:00.000Z';
const emptyView=()=>({revision:0,updatedAt:null,uiLocale:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};};
const until=async(predicate,message)=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail(message||'condition was never reached');};
function fixture({href='https://leafhour.com/library',languages=['en'],preference=null,loader=async code=>catalogues[code],readImpl=null,writeImpl=null}={}){
  const storage=new Map();if(preference)storage.set(UI_PREFERENCE_KEY,preference);
  const storageWrites=[],historyWrites=[],loaderCalls=[],calls=[],readQueue=[],writeQueue=[],statuses=[];let timerId=0;
  const timers=new Map();
  const location={href};
  const history={state:{view:1},replaceState(state,title,url){historyWrites.push({state,title,url});this.state=state;location.href=new URL(url,location.href).href;}};
  const runtime=createUiLocale({
    loadCatalogue:async(code,options={})=>{loaderCalls.push([code,!!options.retry]);return loader(code,options);},
    storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storageWrites.push([key,value]);storage.set(key,value);}},
    languages,
    history,
    getLocation:()=>({href:location.href}),
    getHistoryState:()=>history.state,
    timers:{setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)}
  });
  const read=owner=>{calls.push(['read',owner]);if(readImpl)return Promise.resolve().then(()=>readImpl(owner));const gate=deferred();readQueue.push(Object.assign({owner},gate));return gate.promise;};
  const write=(owner,input)=>{calls.push(['write',owner,{...input}]);if(writeImpl)return Promise.resolve().then(()=>writeImpl(owner,input));const gate=deferred();writeQueue.push(Object.assign({owner,input},gate));return gate.promise;};
  const bridge=createAccountUiPreferencesBridge({runtime,read,write,getLocation:()=>({href:location.href}),onStatus:state=>statuses.push({phase:state.phase,reason:state.reason})});
  return {bridge,runtime,location,history,storage,storageWrites,historyWrites,loaderCalls,calls,readQueue,writeQueue,statuses,timers,
    takeRead:async()=>{await until(()=>readQueue.length>0,'no read was issued');return readQueue.shift();},
    takeWrite:async()=>{await until(()=>writeQueue.length>0,'no write was issued');return writeQueue.shift();},
    phases:()=>statuses.map(entry=>entry.phase)};
}

test('an initial adoption with no account record reads once, never writes and calls nothing else',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  const read=await f.takeRead();
  assert.deepEqual(f.calls,[['read','owner-a']]);
  read.resolve(emptyView());
  await adoption;
  assert.deepEqual(f.calls,[['read','owner-a']],'a missing record is read-only: no write, no model, no reading-record call');
  assert.deepEqual(f.loaderCalls,[],'a first adoption with no account choice loads no catalogue at all');
  assert.equal(f.bridge.getState().phase,'idle');
  assert.deepEqual(f.phases(),['reading','idle']);
  assert.deepEqual(f.storageWrites,[]);
  assert.deepEqual(f.historyWrites,[]);
  assert.equal(f.runtime.getUiLocale(),'en','no account choice changes nothing');
});

test('a known account uiLocale restores through the account actor without device or history writes',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  const read=await f.takeRead();
  read.resolve({revision:2,updatedAt:stamp,uiLocale:'ja'});
  await adoption;
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.deepEqual(f.storageWrites,[],'an account restore never writes the device preference');
  assert.deepEqual(f.historyWrites,[],'an account restore never writes history');
  assert.equal(f.location.href,'https://leafhour.com/library');
  assert.deepEqual(f.calls,[['read','owner-a']]);
});

test('an old owner language never leaks into the next owner or the guest session',async()=>{
  const f=fixture({preference:'zh-Hant'});
  await f.runtime.initializeOnce();
  const first=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:'ja'});
  await first;
  assert.equal(f.runtime.getUiLocale(),'ja');
  const second=f.bridge.adoptOwner('owner-b');
  const readB=await f.takeRead();
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-b']]);
  readB.resolve(emptyView());
  await second;
  assert.equal(f.runtime.getUiLocale(),'zh-Hant','a new owner without a choice falls back to the write-free device path');
  assert.deepEqual(f.storageWrites,[]);
  await f.bridge.adoptOwner(null);
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-b']],'a guest session issues no account read');
  assert.equal(f.runtime.getUiLocale(),'zh-Hant','the guest resolves through the device preference');
  assert.deepEqual(f.storageWrites,[]);
});

test('a manual selection saves exactly once through read-then-write CAS and reports saved',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  const saveRead=await f.takeRead();
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-a']],'the save first reads the current revision');
  saveRead.resolve({revision:4,updatedAt:stamp,uiLocale:'en'});
  const write=await f.takeWrite();
  assert.deepEqual(write.input,{baseRevision:4,uiLocale:'ja'},'exactly one write with the read revision');
  assert.equal(write.owner,'owner-a');
  write.resolve({revision:5,updatedAt:stamp,uiLocale:'ja'});
  await until(()=>f.bridge.getState().phase==='saved');
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-a'],['write','owner-a',{baseRevision:4,uiLocale:'ja'}]],'bounded read/write only: no polling, no model, no reading records');
  assert.deepEqual(f.phases(),['reading','idle','saving','saved']);
});

test('late reads and writes for an old owner never apply after adopting another owner',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  const readA=await f.takeRead();
  const second=f.bridge.adoptOwner('owner-b');
  const readB=await f.takeRead();
  readA.resolve({revision:9,updatedAt:stamp,uiLocale:'ja'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.runtime.getUiLocale(),'en','a late read for the old owner never activates a language');
  readB.resolve(emptyView());
  await second;
  assert.deepEqual(await adoption,{applied:false},'the fenced read result can never apply');
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-b']],'the stale read never writes');
  // A manual selection under owner-b has its write in flight when owner-c arrives.
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:null});
  const writeB=await f.takeWrite();
  assert.equal(writeB.owner,'owner-b','every request captures its own owner');
  const third=f.bridge.adoptOwner('owner-c');
  const readC=await f.takeRead();
  writeB.resolve({revision:2,updatedAt:stamp,uiLocale:'ja'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(f.bridge.getState().phase,'saved','an old owner response never reports the new selection as saved');
  readC.resolve(emptyView());
  await third;
  assert.equal(f.bridge.getState().phase,'idle');
  assert.deepEqual(f.calls.map(entry=>entry[0]+':'+entry[1]),['read:owner-a','read:owner-b','read:owner-b','write:owner-b','read:owner-c']);
});

test('leaving disposes every late result and issues nothing further',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  const readA=await f.takeRead();
  f.bridge.dispose();
  assert.equal(f.bridge.getState().phase,'disposed');
  readA.resolve({revision:3,updatedAt:stamp,uiLocale:'ja'});
  await adoption;
  assert.equal(f.bridge.getState().phase,'disposed','a late read cannot revive a disposed bridge');
  assert.equal(f.runtime.getUiLocale(),'en','a disposed bridge never activates late results');
  await f.runtime.setUiLocale('ja');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,[['read','owner-a']],'a disposed bridge saves no manual selection');
  f.bridge.adoptOwner('owner-b');
  await f.bridge.retry();
  assert.deepEqual(f.calls,[['read','owner-a']],'after dispose neither adoption nor retry issues IO');
  assert.deepEqual(f.phases(),['reading','disposed']);
});

test('manual intent outranks account restore and a failed catalogue never saves',async()=>{
  {
    const f=fixture();
    await f.runtime.initializeOnce();
    const adoption=f.bridge.adoptOwner('owner-a');
    const read=await f.takeRead();
    await f.runtime.setUiLocale('zh-Hant');
    const saveRead=await f.takeRead();
    saveRead.resolve(emptyView());
    const saveWrite=await f.takeWrite();
    saveWrite.resolve({revision:1,updatedAt:stamp,uiLocale:'zh-Hant'});
    await until(()=>f.bridge.getState().phase==='saved');
    // The owner adoption GET resolves late with a different account choice.
    read.resolve({revision:1,updatedAt:stamp,uiLocale:'ja'});
    await adoption;
    assert.equal(f.runtime.getUiLocale(),'zh-Hant','the manual choice outranks the late account restore');
    assert.deepEqual({phase:f.bridge.getState().phase,reason:f.bridge.getState().reason},{phase:'saved',reason:null},'the late GET result never erases the newer manual saved state');
    assert.deepEqual(f.calls.map(entry=>entry[0]),['read','read','write'],'the late GET never triggers another read or write');
    const writes=f.calls.filter(entry=>entry[0]==='write');
    assert.equal(writes.length,1,'the manual choice is written once');
    assert.equal(writes[0][2].uiLocale,'zh-Hant');
  }
  {
    const f=fixture({loader:()=>Promise.reject(Error('catalogue down'))});
    await f.runtime.initializeOnce();
    const adoption=f.bridge.adoptOwner('owner-a');
    (await f.takeRead()).resolve(emptyView());
    await adoption;
    const before=f.calls.length;
    await f.runtime.setUiLocale('ja');
    assert.equal(f.runtime.getUiLocaleState().phase,'error','the failed catalogue is disclosed by the runtime');
    assert.deepEqual(f.calls.slice(before),[],'a failed picker catalogue never reads or writes the account record');
  }
});

test('switching owners during account loading never activates the late language',async()=>{
  const jaGate=deferred();
  const f=fixture({loader:code=>code==='ja'?jaGate.promise:Promise.resolve(catalogues[code])});
  await f.runtime.initializeOnce();
  const first=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:'ja'});
  await until(()=>f.loaderCalls.some(entry=>entry[0]==='ja'),'the account restore must start loading its catalogue');
  const second=f.bridge.adoptOwner('owner-b');
  const readB=await f.takeRead();
  jaGate.resolve(ja);
  await first;
  assert.equal(f.runtime.getUiLocale(),'en','the late account catalogue never activates after the owner changed');
  assert.equal(f.runtime.getUiLocaleState().phase,'ready');
  readB.resolve({revision:5,updatedAt:stamp,uiLocale:'zh-Hans'});
  await second;
  await until(()=>f.runtime.getUiLocale()==='zh-Hans');
  assert.equal(f.runtime.getUiLocale(),'zh-Hans','the new owner activates its own language');
  assert.deepEqual(f.storageWrites,[]);
  assert.deepEqual(f.historyWrites,[]);
});

test('valid ui deep links and explicit authored paths stay authoritative over account recovery',async()=>{
  {
    const f=fixture({href:'https://leafhour.com/library?ui=ja'});
    await f.runtime.initializeOnce();
    assert.equal(f.runtime.getUiLocale(),'ja');
    const adoption=f.bridge.adoptOwner('owner-a');
    (await f.takeRead()).resolve({revision:3,updatedAt:stamp,uiLocale:'zh-Hans'});
    await adoption;
    assert.equal(f.runtime.getUiLocale(),'ja','a valid ui deep link is preserved');
    assert.deepEqual(f.loaderCalls,[['ja',false]],'no account catalogue is even loaded');
  }
  {
    const f=fixture({href:'https://leafhour.com/ja/privacy'});
    await f.runtime.initializeOnce();
    assert.equal(f.runtime.getUiLocale(),'ja');
    const adoption=f.bridge.adoptOwner('owner-a');
    (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:'en'});
    await adoption;
    assert.equal(f.runtime.getUiLocale(),'ja','an explicit authored path is preserved');
    assert.deepEqual(f.historyWrites,[],'an authored route still writes no history');
    assert.deepEqual(f.storageWrites,[],'authored activation and account recovery remain read-only without an actual manual handoff');
  }
});

test('account restore keeps the reading URL, source context, drafts and the physical DOM untouched',async()=>{
  const f=fixture({href:'https://leafhour.com/read?book=alice&source=zh&passage=p3#note'});
  await f.runtime.initializeOnce();
  const node={textContent:''};
  const input={value:'my draft 中文'};
  const labels=f.runtime.createUiLabels();
  labels.text(node,'ui.language.label');
  f.runtime.onUiLocaleChange(()=>labels.refresh());
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:'ja'});
  await adoption;
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.equal(f.location.href,'https://leafhour.com/read?book=alice&source=zh&passage=p3#note','no history write touches the reading URL');
  assert.deepEqual(f.historyWrites,[]);
  assert.deepEqual(f.storageWrites,[]);
  assert.equal(node.textContent,ja['ui.language.label'],'the same physical node is re-translated in place');
  assert.equal(input.value,'my draft 中文','drafts and inputs are never remounted');
});

test('an intent followed by an owner change never saves to the new owner',async()=>{
  const jaGate=deferred();
  const f=fixture({loader:code=>code==='ja'?jaGate.promise:Promise.resolve(catalogues[code])});
  await f.runtime.initializeOnce();
  const first=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await first;
  // A manual intent starts under owner-a while its catalogue is still loading.
  const picker=f.runtime.setUiLocale('ja');
  await until(()=>f.loaderCalls.some(entry=>entry[0]==='ja'));
  const second=f.bridge.adoptOwner('owner-b');
  const readB=await f.takeRead();
  jaGate.resolve(ja);
  await picker;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.runtime.getUiLocale(),'en','the old identity picker is revoked before it can activate');
  assert.deepEqual(f.storageWrites,[]);assert.deepEqual(f.historyWrites,[]);
  assert.deepEqual(f.calls.map(entry=>entry[0]+':'+entry[1]),['read:owner-a','read:owner-b'],'the stale intent never reads or writes for the new owner');
  assert.notEqual(f.bridge.getState().phase,'saved');
  readB.resolve(emptyView());
  await second;
  assert.equal(f.calls.filter(entry=>entry[0]==='write').length,0,'a mid-flight owner change can never mis-save to the new owner');
});

test('consecutive selections are fenced by intent and merge into one save',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  const staleRead=await f.takeRead();
  await f.runtime.setUiLocale('zh-Hant');
  staleRead.resolve({revision:1,updatedAt:stamp,uiLocale:null});
  const mergedRead=await f.takeRead();
  mergedRead.resolve({revision:1,updatedAt:stamp,uiLocale:null});
  const merged=await f.takeWrite();
  assert.equal(f.calls.filter(entry=>entry[0]==='write').length,1,'a superseded selection merges into the newer save');
  assert.deepEqual(merged.input,{baseRevision:1,uiLocale:'zh-Hant'});
  merged.resolve({revision:2,updatedAt:stamp,uiLocale:'zh-Hant'});
  await until(()=>f.bridge.getState().phase==='saved');
  assert.equal(f.statuses.filter(entry=>entry.phase==='saved').length,1);
});

test('a late old response never marks the newer selection saved and writes stay serialized',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:null});
  const firstWrite=await f.takeWrite();
  await f.runtime.setUiLocale('zh-Hant');
  firstWrite.resolve({revision:2,updatedAt:stamp,uiLocale:'ja'});
  await until(()=>f.readQueue.length>0);
  assert.notEqual(f.bridge.getState().phase,'saved','the old response cannot report the new selection as saved');
  const secondRead=f.readQueue.shift();
  secondRead.resolve({revision:2,updatedAt:stamp,uiLocale:'ja'});
  const secondWrite=await f.takeWrite();
  assert.deepEqual(secondWrite.input,{baseRevision:2,uiLocale:'zh-Hant'},'the newer save reads the newest revision and writes its own choice');
  secondWrite.resolve({revision:3,updatedAt:stamp,uiLocale:'zh-Hant'});
  await until(()=>f.bridge.getState().phase==='saved');
  assert.equal(f.calls.filter(entry=>entry[0]==='write').at(-1)[2].uiLocale,'zh-Hant');
});

test('a CAS conflict keeps the local choice, reports conflict and writes again only on explicit retry',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:2,updatedAt:stamp,uiLocale:'en'});
  const write=await f.takeWrite();
  write.reject(Object.assign(Error('conflict'),{status:409}));
  const back=await f.takeRead();
  assert.equal(f.calls.filter(entry=>entry[0]==='write').length,1,'a conflict never auto-overwrites another device');
  back.resolve({revision:7,updatedAt:stamp,uiLocale:'zh-Hant'});
  await until(()=>f.bridge.getState().phase==='conflict');
  assert.equal(f.runtime.getUiLocale(),'ja','the local selection is kept');
  assert.equal(f.calls.filter(entry=>entry[0]==='write').length,1);
  const retry=f.bridge.retry();
  const retried=await f.takeWrite();
  assert.deepEqual(retried.input,{baseRevision:7,uiLocale:'ja'},'the explicit retry writes once with the read-back revision');
  retried.resolve({revision:8,updatedAt:stamp,uiLocale:'ja'});
  await retry;
  await until(()=>f.bridge.getState().phase==='saved');
  assert.equal(f.calls.filter(entry=>entry[0]==='write').length,2,'exactly one explicit retry write');
});

test('a conflict retry is fenced by owner and intent',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:2,updatedAt:stamp,uiLocale:null});
  (await f.takeWrite()).reject(Object.assign(Error('conflict'),{status:409}));
  (await f.takeRead()).resolve({revision:6,updatedAt:stamp,uiLocale:null});
  await until(()=>f.bridge.getState().phase==='conflict');
  const second=f.bridge.adoptOwner('owner-b');
  (await f.takeRead()).resolve(emptyView());
  await second;
  const before=f.calls.length;
  await f.bridge.retry();
  assert.equal(f.calls.length,before,'an owner change invalidates the conflict retry');
  // A newer manual intent fences the old conflict away as well.
  const third=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await third;
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:null});
  (await f.takeWrite()).reject(Object.assign(Error('conflict'),{status:409}));
  (await f.takeRead()).resolve({revision:4,updatedAt:stamp,uiLocale:null});
  await until(()=>f.bridge.getState().phase==='conflict');
  await f.runtime.setUiLocale('zh-Hant');
  const newerRead=await f.takeRead();
  const after=f.calls.length;
  await f.bridge.retry();
  assert.equal(f.calls.length,after,'a stale conflict never writes behind a newer intent');
  newerRead.resolve({revision:5,updatedAt:stamp,uiLocale:null});
  (await f.takeWrite()).resolve({revision:6,updatedAt:stamp,uiLocale:'zh-Hant'});
  await until(()=>f.bridge.getState().phase==='saved');
  assert.equal(f.calls.filter(entry=>entry[0]==='write').at(-1)[2].uiLocale,'zh-Hant','the newer intent saves its own choice');
});

test('corrupt snapshots are rejected safely and never open a CAS window',async()=>{
  const corrupt=[
    {revision:0,updatedAt:null,uiLocale:'ja'},
    {revision:1,updatedAt:stamp},
    {revision:1,updatedAt:stamp,uiLocale:'ja',owner:'owner-x'},
    {revision:'1',updatedAt:stamp,uiLocale:'ja'},
    {revision:1.5,updatedAt:stamp,uiLocale:'ja'},
    {revision:-1,updatedAt:stamp,uiLocale:'ja'},
    {revision:1,updatedAt:null,uiLocale:'ja'},
    {revision:1,updatedAt:stamp,uiLocale:'zh'},
    null,'record',[],{}
  ];
  for(const snapshot of corrupt)assert.equal(isAccountUiSnapshot(snapshot),false,JSON.stringify(snapshot));
  assert.equal(isAccountUiSnapshot(emptyView()),true);
  assert.equal(isAccountUiSnapshot({revision:3,updatedAt:stamp,uiLocale:'ja'}),true);
  assert.equal(isAccountUiSnapshot({revision:3,updatedAt:stamp,uiLocale:null}),true,'an explicit clear is a valid saved state');
  for(const snapshot of corrupt){
    const f=fixture();
    await f.runtime.initializeOnce();
    const adoption=f.bridge.adoptOwner('owner-a');
    const read=await f.takeRead();
    read.resolve(snapshot);
    await adoption;
    assert.equal(f.bridge.getState().phase,'error',JSON.stringify(snapshot));
    assert.equal(f.bridge.getState().reason,'record');
    assert.deepEqual(f.calls,[['read','owner-a']],JSON.stringify(snapshot)+' must never open a write window');
    assert.equal(f.runtime.getUiLocaleState().phase,'ready');
  }
  // A corrupt write result is rejected without claiming saved or rewriting.
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:null});
  (await f.takeWrite()).resolve({revision:2,updatedAt:undefined,uiLocale:'ja'});
  await until(()=>f.bridge.getState().phase==='error');
  assert.equal(f.bridge.getState().reason,'record');
  assert.equal(f.calls.filter(entry=>entry[0]==='write').length,1,'a corrupt confirmation never claims saved and never rewrites');
});

test('network failures report an honest error, never claim saved and rewrite only on explicit retry',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  await f.runtime.setUiLocale('ja');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:null});
  (await f.takeWrite()).reject(Object.assign(Error('offline: private upstream detail'),{status:0}));
  await until(()=>f.bridge.getState().phase==='error');
  assert.equal(f.bridge.getState().reason,'network');
  assert.deepEqual(f.calls.map(entry=>entry[0]),['read','read','write'],'no automatic rewrite happens');
  // The exposed state and status carry no raw backend error text or account data.
  const exposed=JSON.stringify([f.bridge.getState(),...f.statuses]);
  assert.doesNotMatch(exposed,/offline|owner-a|private upstream/);
  const retry=f.bridge.retry();
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:null});
  (await f.takeWrite()).resolve({revision:2,updatedAt:stamp,uiLocale:'ja'});
  await retry;
  await until(()=>f.bridge.getState().phase==='saved');
  assert.deepEqual(f.calls.map(entry=>entry[0]),['read','read','write','read','write'],'one bounded explicit retry only');
});

test('phase values are a fixed set with fixed reasons, independent of catalogue loading',async()=>{
  const f=fixture({loader:code=>code==='ja'?new Promise(()=>{}):Promise.resolve(catalogues[code])});
  await f.runtime.initializeOnce();
  const adoption=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve(emptyView());
  await adoption;
  void f.runtime.setUiLocale('ja'); // a permanently pending catalogue load
  await until(()=>f.runtime.getUiLocaleState().phase==='pending');
  for(const phase of [...f.phases(),f.bridge.getState().phase])assert.ok(ACCOUNT_UI_PHASES.includes(phase),phase+' is a documented phase');
  for(const entry of f.statuses)if(entry.reason!==null)assert.ok(ACCOUNT_UI_REASONS.includes(entry.reason),entry.reason+' is a documented reason');
  assert.deepEqual(ACCOUNT_UI_PHASES,['idle','reading','saving','saved','conflict','error','disposed'],'the phase vocabulary stays fixed');
  assert.deepEqual(ACCOUNT_UI_REASONS,[null,'network','auth','record'],'the reason vocabulary stays fixed');
  assert.equal(f.bridge.getState().phase,'idle','bridge phases never mirror or wait for the catalogue load state');
  assert.deepEqual(Object.keys(f.bridge.getState()),['phase','reason'],'the state shape is fixed and carries no account data');
});

// ---------------------------------------------------------------------------
// Review counterexamples C1/C2/C3/C5 transcribed permanently against the real
// runtime + bridge with synthetic deferred IO.

test('C1: a new owner clears the old owner language even when its own read fails',async()=>{
  const f=fixture({readImpl:owner=>owner==='owner-b'?Promise.reject(Object.assign(Error('offline'),{status:0})):{revision:1,updatedAt:stamp,uiLocale:'ja'}});
  await f.runtime.initializeOnce();
  await f.bridge.adoptOwner('owner-a');
  assert.equal(f.runtime.getUiLocale(),'ja');
  await f.bridge.adoptOwner('owner-b');
  assert.equal(f.runtime.getUiLocale(),'en','the old owner language is cleared before the new owner read settles');
  assert.deepEqual({phase:f.bridge.getState().phase,reason:f.bridge.getState().reason},{phase:'error',reason:'network'});
  assert.deepEqual(f.storageWrites,[],'the clearing uses the write-free device/browser/route path');
  assert.deepEqual(f.historyWrites,[]);
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-b']],'the clearing itself issues no account IO');
});

test('C1: a new owner clears the old owner language while its own read is still pending',async()=>{
  const gate=deferred();
  const f=fixture({readImpl:owner=>owner==='owner-a'?{revision:1,updatedAt:stamp,uiLocale:'ja'}:gate.promise});
  await f.runtime.initializeOnce();
  await f.bridge.adoptOwner('owner-a');
  assert.equal(f.runtime.getUiLocale(),'ja');
  const second=f.bridge.adoptOwner('owner-b');
  await until(()=>f.runtime.getUiLocale()==='en','the old owner language must clear without waiting for the new read');
  assert.equal(f.bridge.getState().phase,'reading','the new owner read is still in flight');
  gate.resolve(emptyView());
  await second;
  assert.equal(f.runtime.getUiLocale(),'en','the cleared default survives the empty new record');
});

test('C1: first adoption and same-owner refresh add no extra catalogue work',async()=>{
  const f=fixture();
  await f.runtime.initializeOnce();
  const first=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:'ja'});
  await first;
  assert.deepEqual(f.loaderCalls,[['ja',false]],'the account restore loads its catalogue exactly once');
  let publishes=0;
  f.runtime.onUiLocaleChange(()=>publishes++);
  const refresh=f.bridge.adoptOwner('owner-a');
  (await f.takeRead()).resolve({revision:1,updatedAt:stamp,uiLocale:'ja'});
  await refresh;
  assert.deepEqual(f.loaderCalls,[['ja',false]],'a same-owner refresh reloads nothing');
  assert.equal(publishes,0,'a same-owner refresh never republishes labels');
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.deepEqual(f.storageWrites,[],'adoption and refresh never write the device preference');
  assert.deepEqual(f.historyWrites,[]);
});

test('C2: a mismatched write ACK is a record error and never claims saved',async()=>{
  const cases=[
    ['wrong language',3,{revision:4,updatedAt:stamp,uiLocale:'en'}],
    ['same revision',3,{revision:3,updatedAt:stamp,uiLocale:'ja'}],
    ['skipped revision',3,{revision:20,updatedAt:stamp,uiLocale:'ja'}],
    ['overflowed revision',Number.MAX_SAFE_INTEGER,{revision:Number.MAX_SAFE_INTEGER,updatedAt:stamp,uiLocale:'ja'}]
  ];
  for(const [label,base,ack]of cases){
    const f=fixture({readImpl:async()=>({revision:base,updatedAt:stamp,uiLocale:null}),writeImpl:async()=>ack});
    await f.runtime.initializeOnce();
    await f.bridge.adoptOwner('owner-a');
    await f.runtime.setUiLocale('ja');
    await until(()=>f.bridge.getState().phase==='error');
    assert.deepEqual({phase:f.bridge.getState().phase,reason:f.bridge.getState().reason},{phase:'error',reason:'record'},label);
    assert.deepEqual(f.calls.map(entry=>entry[0]),['read','read','write'],label+' issues exactly one write and no automatic rewrite');
    assert.equal(f.runtime.getUiLocale(),'ja',label+' keeps the local choice');
  }
});

test('C3: an adoption read error offers one bounded read-only explicit retry',async()=>{
  let reads=0;
  const f=fixture({readImpl:async()=>{if(++reads===1)throw Object.assign(Error('offline'),{status:0});return {revision:2,updatedAt:stamp,uiLocale:'ja'};}});
  await f.runtime.initializeOnce();
  await f.bridge.adoptOwner('owner-a');
  assert.deepEqual({phase:f.bridge.getState().phase,reason:f.bridge.getState().reason},{phase:'error',reason:'network'});
  assert.deepEqual(f.calls,[['read','owner-a']]);
  await f.bridge.retry();
  assert.equal(reads,2,'the explicit retry performs exactly one bounded read');
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-a']],'read-only recovery: never a write');
  assert.equal(f.runtime.getUiLocale(),'ja');
  assert.equal(f.bridge.getState().phase,'idle');
});

test('C3: a read-only recovery of a corrupt record never manufactures a CAS write',async()=>{
  let reads=0;
  const f=fixture({readImpl:async()=>{if(++reads===1)throw Object.assign(Error('offline'),{status:0});return {revision:0,updatedAt:null,uiLocale:'ja'};}});
  await f.runtime.initializeOnce();
  await f.bridge.adoptOwner('owner-a');
  await f.bridge.retry();
  assert.deepEqual({phase:f.bridge.getState().phase,reason:f.bridge.getState().reason},{phase:'error',reason:'record'});
  assert.deepEqual(f.calls,[['read','owner-a'],['read','owner-a']],'a corrupt record is rejected without any write');
});

test('C3: the read-only recovery never overrides a newer manual intent',async()=>{
  const catalogueGate=deferred();let reads=0;
  const f=fixture({
    readImpl:async()=>{if(++reads===1)throw Object.assign(Error('offline'),{status:0});return emptyView();},
    writeImpl:async(owner,input)=>({revision:1,updatedAt:stamp,uiLocale:input.uiLocale}),
    loader:code=>code==='ja'?catalogueGate.promise:Promise.resolve(catalogues[code])
  });
  await f.runtime.initializeOnce();
  await f.bridge.adoptOwner('owner-a');
  assert.equal(f.bridge.getState().phase,'error');
  const picker=f.runtime.setUiLocale('ja');
  const before=f.calls.length;
  assert.deepEqual(await f.bridge.retry(),{retried:false},'the old read error retry yields to the newer manual intent');
  assert.equal(f.calls.length,before,'no recovery read is issued behind a newer manual intent');
  catalogueGate.resolve(ja);
  assert.equal((await picker).kind,'committed+saved');
  await until(()=>f.bridge.getState().phase==='saved');
  assert.equal(f.runtime.getUiLocale(),'ja');
});

test('C5: a late adoption read result never erases a newer manual saved state',async()=>{
  for(const outcome of ['failure','corrupt','success']){
    const gate=deferred();let reads=0;
    const f=fixture({readImpl:()=>++reads===1?gate.promise:Promise.resolve(emptyView()),writeImpl:async(owner,input)=>({revision:1,updatedAt:stamp,uiLocale:input.uiLocale})});
    await f.runtime.initializeOnce();
    const adoption=f.bridge.adoptOwner('owner-a');
    await f.runtime.setUiLocale('ja');
    await until(()=>f.bridge.getState().phase==='saved');
    if(outcome==='failure')gate.reject(Object.assign(Error('old read'),{status:0}));
    else if(outcome==='corrupt')gate.resolve({revision:0,updatedAt:null,uiLocale:'ja'});
    else gate.resolve({revision:9,updatedAt:stamp,uiLocale:'zh-Hant'});
    await adoption;
    assert.deepEqual({phase:f.bridge.getState().phase,reason:f.bridge.getState().reason},{phase:'saved',reason:null},outcome);
    assert.equal(f.runtime.getUiLocale(),'ja',outcome+' must never activate a stale account language');
  }
});

// Invalidation between the fulfilled GET and scheduled POST must stop IO itself.
const emptySnapshot={revision:0,updatedAt:null,uiLocale:null};
for(const aba of [false,true])test(`C6 invalidate at read/write microtask boundary prevents stale dispatch ${aba?'A-B-A':'A-B'}`,async()=>{const loc={href:'https://example.invalid/library'},runtime=createUiLocale({loadCatalogue:async()=>ja,languages:['en'],storage:{getItem:()=>null,setItem(){}},history:{replaceState(_s,_t,url){loc.href=url}},getLocation:()=>loc});let reads=0,bridge;const writes=[],order=[];bridge=createAccountUiPreferencesBridge({runtime,getLocation:()=>loc,read:async owner=>{order.push('read:'+owner);if(++reads===2)queueMicrotask(()=>queueMicrotask(()=>{order.push('adopt:B');void bridge.adoptOwner('B');if(aba){order.push('adopt:A');void bridge.adoptOwner('A')}}));return emptySnapshot;},write:async(owner,body)=>{order.push('write:'+owner);writes.push({owner,body});return {revision:1,updatedAt:'2026-10-20T00:00:00Z',uiLocale:'ja'}}});try{await runtime.initializeOnce();await bridge.adoptOwner('A');await runtime.setUiLocale('ja');for(let i=0;i<10;i++)await new Promise(setImmediate);assert.deepEqual(writes,[],JSON.stringify(order));}finally{bridge.dispose()}});

// Queued recovery is canceled before its GET is dispatched.
for(const action of ['dispose','ABA','new-intent'])test('C7 queued adoption retry rechecks capture before read after '+action,async()=>{
 const location={href:'https://example.invalid/library'},runtime=createUiLocale({loadCatalogue:async()=>ja,languages:['en'],getLocation:()=>location,storage:{getItem:()=>null,setItem(){}},history:{replaceState(_s,_t,url){location.href=url}}});let n=0;const reads=[];const bridge=createAccountUiPreferencesBridge({runtime,getLocation:()=>location,read:async owner=>{reads.push(owner);if(++n===1)throw Error('offline');return emptySnapshot},write:async(_o,b)=>({revision:1,updatedAt:'2026-10-20T00:00:00Z',uiLocale:b.uiLocale})});
 try{await runtime.initializeOnce();await bridge.adoptOwner('A');assert.equal(bridge.getState().phase,'error');const retry=bridge.retry();let expected;if(action==='dispose'){bridge.dispose();expected=1;}else if(action==='ABA'){void bridge.adoptOwner('B');void bridge.adoptOwner('A');expected=3;}else{await runtime.setUiLocale('ja');expected=2;}await retry;for(let i=0;i<8;i++)await new Promise(setImmediate);assert.equal(reads.length,expected,JSON.stringify(reads));}finally{bridge.dispose()}
});
