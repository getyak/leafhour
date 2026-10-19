import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import en from '../app/ui-catalogs/en.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(loader){const location={href:'https://leafhour.com/library?ui=en'},timers=new Map(),calls=[],faults=[];let id=0,historyFails=false;const rt=createUiLocale({loadCatalogue:async(c,o)=>{calls.push(['load',c,o.retry]);return loader(c,o);},getLocation:()=>location,storage:{getItem:()=>null,setItem:(...x)=>calls.push(['pref',...x])},history:{replaceState(...x){calls.push(['history',...x]);if(historyFails)throw Error('denied');location.href=x[2];}},timers:{setTimeout(f){const n=++id;timers.set(n,f);return n;},clearTimeout:n=>timers.delete(n)},reportFault:x=>faults.push(x)});return {rt,location,timers,calls,faults,setHistoryFailure:x=>historyFails=x,fire(){for(const [id,f]of [...timers]){timers.delete(id);f();}}};}
const rows=[];
for(const outcome of ['success','reject','timeout'])for(const change of ['/read?book=other&ui=en','/library?book=other&ui=en','/library?source=other&ui=en'])test(`stale ${outcome} settles after canonical context changes to ${change}`,async()=>{
 let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b}),f=fixture(()=>pending);await f.rt.initialize();const result=f.rt.setUiLocale('ja');await flush();f.location.href='https://leafhour.com'+change;
 if(outcome==='success')resolve(ja);else if(outcome==='reject')reject(Error('late'));else f.fire();
 assert.deepEqual(await result,{kind:'stale',reason:'navigated'});const state=f.rt.getUiLocaleState();assert.equal(state.phase,'ready');assert.equal(state.retryTarget,null);assert.equal(state.retryActor,null);assert.equal(state.requested,'en');assert.equal(f.timers.size,0);assert.equal(f.calls.filter(x=>x[0]!=='load').length,0);
 await f.rt.retryUiLocale();assert.equal(f.rt.getUiLocale(),'en');assert.equal(f.calls.filter(x=>x[0]==='load').length,1);if(outcome==='timeout'){resolve(ja);await flush();assert.equal(f.rt.getUiLocale(),'en');}rows.push({outcome,change,state});
});
test('cached catalogue remains retryable after local history failure without a third import',async()=>{
 let failed=true;const f=fixture(async()=>{if(failed)throw Error('503');return ja;});await f.rt.initialize();await f.rt.setUiLocale('ja');failed=false;f.setHistoryFailure(true);assert.equal((await f.rt.retryUiLocale()).reason,'history');assert.equal(f.rt.getUiLocaleState().offerReload,false);f.setHistoryFailure(false);assert.equal((await f.rt.retryUiLocale()).kind,'committed+saved');assert.deepEqual(f.calls.filter(x=>x[0]==='load').map(x=>x[2]),[false,true]);rows.push({outcome:'cached-history-retry',calls:f.calls});
});
test('owned label faults report to the same runtime and isolate other labels',async()=>{
 const f=fixture(async()=>ja);await f.rt.initialize();const bad={textContent:''},good={textContent:''};const labels=f.rt.createUiLabels((id,params)=>{if(id==='bad'&&f.rt.getUiLocale()==='ja')throw Error('formatter');return f.rt.t(id==='bad'?'ui.language.label':id,params);});labels.text(bad,'bad');labels.text(good,'ui.language.label');f.rt.onUiLocaleChange(()=>labels.refresh());await f.rt.setUiLocale('ja');assert.equal(f.faults.length,1);assert.equal(f.faults[0].kind,'label');assert.equal(good.textContent,ja['ui.language.label']);assert.equal(bad.textContent,en['ui.language.label']);labels.clear();await f.rt.setUiLocale('en');assert.equal(good.textContent,ja['ui.language.label']);rows.push({outcome:'isolated-helper-fault',faultCount:f.faults.length});
});

for(const mode of ['load-failed','timeout','history'])for(const path of ['/read?book=other&ui=en','/library?book=other&ui=en','/library?source=other&ui=en'])test(`old ${mode} retry cannot act after navigation to ${path}`,async()=>{
 const f=fixture(async()=>{if(mode==='load-failed')throw Error('503');if(mode==='timeout')return new Promise(()=>{});return ja;});
 await f.rt.initialize();if(mode==='history')f.setHistoryFailure(true);
 const pending=f.rt.setUiLocale('ja');if(mode==='timeout'){await flush();f.fire();}await pending;
 assert.equal(f.rt.getUiLocaleState().phase,'error');const callCount=f.calls.length;
 f.location.href='https://leafhour.com'+path;assert.deepEqual(await f.rt.retryUiLocale(),{kind:'stale',reason:'navigated'});
 const state=f.rt.getUiLocaleState();assert.equal(state.phase,'ready');assert.equal(state.retryTarget,null);assert.equal(state.retryActor,null);assert.equal(f.calls.length,callCount);assert.equal(f.rt.getUiLocale(),'en');assert.equal(f.timers.size,0);
});
