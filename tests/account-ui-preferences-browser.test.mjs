import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import en from '../app/ui-catalogs/en.mjs';import ja from '../app/ui-catalogs/ja.mjs';
const module=await import('../app/account-ui-preferences-browser.mjs').catch(()=>({}));
const tick=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};
function fixture(request,{loader=async code=>code==='ja'?ja:en,href='https://leafhour.test/library'}={}){assert.equal(typeof module.createBrowserAccountUiPreferences,'function');const view=new EventTarget(),document=new EventTarget(),location={href},storage=new Map(),writes=[];
 const runtime=createUiLocale({loadCatalogue:loader,languages:['en'],storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{storage.set(key,value);writes.push([key,value]);}},history:{replaceState(_s,_t,url){location.href=url;}},getLocation:()=>location});
 const bridge=module.createBrowserAccountUiPreferences({runtime,request,document,view,getLocation:()=>location,storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});return {runtime,bridge,document,view,location,writes,storage};}
test('verified owner adoption and manual choice reach only the fixed preference API and the existing notice state',async()=>{
 const calls=[];let snapshot={revision:0,updatedAt:null,uiLocale:null};const f=fixture(async(url,options)=>{calls.push({url,options});if(options.method==='POST'){const body=JSON.parse(options.body);snapshot={revision:body.baseRevision+1,updatedAt:'2026-10-20T00:00:00Z',uiLocale:body.uiLocale};}return Response.json(snapshot);});
 await f.runtime.initializeOnce();await tick();assert.equal(calls.length,0,'no authentication or account guessing');await f.bridge.adoptOwner('A');assert.equal(calls.length,1);await f.bridge.adoptOwner('A');assert.equal(calls.length,1,'verified same-owner refresh reuses adoption');
 const states=[];f.bridge.onUiLocaleStateChange(state=>states.push(state));await f.runtime.setUiLocale('ja');await tick();assert.equal(f.bridge.getUiLocaleState().account.phase,'saved');assert.equal(states.at(-1).effective,'ja');assert.equal(states.at(-1).account.phase,'saved');assert.equal(calls.filter(row=>row.options.method==='POST').length,1);assert.ok(calls.every(row=>row.url==='/api/account/ui-preferences'&&row.options.headers['X-Reader-Owner']==='A'));f.bridge.dispose();
});
test('an old owner session-changed response cannot invalidate the current verified owner',async()=>{
 let resolve;const first=new Promise(r=>resolve=r);const f=fixture(async(_url,options)=>options.headers['X-Reader-Owner']==='A'?first:Response.json({revision:0,updatedAt:null,uiLocale:null}));await f.runtime.initializeOnce();const a=f.bridge.adoptOwner('A');await tick();await f.bridge.adoptOwner('B');resolve(new Response('',{status:401,headers:{'X-Reader-Session-Changed':'1'}}));await a;assert.equal(f.bridge.getUiLocaleState().account.phase,'idle');await f.bridge.adoptOwner('B');assert.equal(f.bridge.getUiLocaleState().account.phase,'idle');f.bridge.dispose();
});
test('leaving invalidates pending IO and a BFCache return waits for a fresh host identity verification',async()=>{
 let reads=0,resolve;const f=fixture(async()=>{reads++;if(reads===1)return new Promise(r=>resolve=r);return Response.json({revision:0,updatedAt:null,uiLocale:null});});await f.runtime.initializeOnce();const adoption=f.bridge.adoptOwner('A');await tick();const event=new Event('pagehide');Object.defineProperty(event,'persisted',{value:true});f.view.dispatchEvent(event);resolve(Response.json({revision:1,updatedAt:'2026-10-20T00:00:00Z',uiLocale:'ja'}));await adoption;assert.equal(f.runtime.getUiLocale(),'en');await f.bridge.adoptOwner('A');assert.equal(reads,2);assert.equal(f.bridge.getUiLocaleState().account.phase,'idle');f.bridge.dispose();
});
test('public support pages verify identity once before receiving an authored choice and never guess it from storage',async()=>{
 const calls=[],f=fixture(async(url,options)=>{calls.push({url,options});return Response.json(url==='/api/auth/session'?{user:{id:'A'}}:{revision:0,updatedAt:null,uiLocale:null});});await f.runtime.initializeOnce();assert.deepEqual(await f.bridge.verifySupportOwner(),{verified:false});assert.equal(calls.length,0,'library keeps its existing auth owner');f.location.href='https://leafhour.test/en/mcp';assert.equal((await f.bridge.verifySupportOwner()).verified,true);assert.deepEqual(calls.map(row=>row.url),['/api/auth/session','/api/account/ui-preferences']);assert.ok(calls.every(row=>row.options.method==='GET'));f.bridge.dispose();
});
test('a delayed support identity cannot adopt an owner after the host has already verified a newer one',async()=>{
 let resolve;const identity=new Promise(r=>resolve=r),calls=[],f=fixture(async(url,options)=>{calls.push([url,options]);return url==='/api/auth/session'?identity:Response.json({revision:0,updatedAt:null,uiLocale:null});});await f.runtime.initializeOnce();f.location.href='https://leafhour.test/en/privacy';const old=f.bridge.verifySupportOwner();await tick();await f.bridge.adoptOwner('B');resolve(Response.json({user:{id:'A'}}));assert.deepEqual(await old,{verified:false});assert.ok(calls.filter(([url])=>url==='/api/account/ui-preferences').every(([,options])=>options.headers['X-Reader-Owner']==='B'));f.bridge.dispose();
});

test('a late session-changed response from the first A epoch cannot dispose a later A epoch',async()=>{
 let firstA,reads=0;const first=new Promise(resolve=>firstA=resolve),f=fixture(async(_url,options)=>options.headers['X-Reader-Owner']==='A'&&++reads===1?first:Response.json({revision:0,updatedAt:null,uiLocale:null}));await f.runtime.initializeOnce();const old=f.bridge.adoptOwner('A');await tick();await f.bridge.adoptOwner('B');await f.bridge.adoptOwner('A');firstA(new Response('',{status:401,headers:{'X-Reader-Session-Changed':'1'}}));await old;assert.equal(f.bridge.getUiLocaleState().account.phase,'idle');f.bridge.dispose();
});
test('a support BFCache return explicitly re-verifies its owner before resuming the bridge',async()=>{
 let identities=0;const f=fixture(async url=>{if(url==='/api/auth/session'){identities++;return Response.json({user:{id:'A'}});}return Response.json({revision:0,updatedAt:null,uiLocale:null});},{href:'https://leafhour.test/en/mcp'});await f.runtime.initializeOnce();await f.bridge.verifySupportOwner();for(const type of ['pagehide','pageshow']){const event=new Event(type);Object.defineProperty(event,'persisted',{value:true});f.view.dispatchEvent(event);}await tick();assert.equal(identities,2);assert.equal(f.bridge.getUiLocaleState().account.phase,'idle');f.bridge.dispose();
});
test('the actual reader session invalidation event prevents any new old-owner account save',async()=>{
 let posts=0;const f=fixture(async(_url,options)=>{if(options.method==='POST')posts++;return Response.json({revision:0,updatedAt:null,uiLocale:null});});await f.runtime.initializeOnce();await f.bridge.adoptOwner('A');f.document.dispatchEvent(new Event('reader:session-changed'));await f.runtime.setUiLocale('ja');await tick();assert.equal(posts,0);assert.equal(f.bridge.getUiLocaleState().account.phase,'disposed');f.bridge.dispose();
});
test('a failed authored catalogue never spends its explicit retry or persists a handoff automatically',async()=>{
 let loads=0,down=true;const f=fixture(async()=>Response.json({revision:0,updatedAt:null,uiLocale:null}),{href:'https://leafhour.test/ja',loader:async()=>{loads++;if(down)throw Error('offline');return ja;}});f.storage.set('leafhour.ui.locale.navigation.v1',JSON.stringify({version:1,code:'ja',path:'/ja',owner:null,verified:true,createdAt:Date.now()}));await f.runtime.initializeOnce();await tick();assert.equal(loads,1);assert.equal(f.runtime.getUiLocaleState().phase,'error');assert.deepEqual(f.writes,[]);down=false;await f.runtime.retryUiLocale();await tick();assert.equal(loads,2,'only the explicit user retry loads the fixed retry variant');assert.equal(f.storage.get('leafhour.ui.locale.v1'),'ja');f.bridge.dispose();
});

test('a newer manual intent discards a failed incoming handoff before another document can replay it',async()=>{
 const key='leafhour.ui.locale.navigation.v1';let down=true;
 const f=fixture(async()=>Response.json({revision:0,updatedAt:null,uiLocale:null}),{href:'https://leafhour.test/ja',loader:async code=>{if(code==='ja'&&down)throw Error('offline');return code==='ja'?ja:en;}});
 f.storage.set(key,JSON.stringify({version:1,code:'ja',path:'/ja',owner:'A',verified:true,createdAt:Date.now()}));
 await f.runtime.initializeOnce();await tick();assert.equal(f.runtime.getUiLocaleState().phase,'error');
 const choice=f.runtime.setUiLocale('en');assert.equal(f.storage.has(key),false,'discard is synchronous at the newer intent');await choice;await f.bridge.adoptOwner('A');f.bridge.dispose();
 down=false;let posts=0;const next=fixture(async(_url,options)=>{if(options.method==='POST')posts++;return Response.json({revision:0,updatedAt:null,uiLocale:null});},{href:'https://leafhour.test/ja'});
 for(const [key,value] of f.storage)next.storage.set(key,value);
 await next.runtime.initializeOnce();await next.bridge.adoptOwner('A');await tick();assert.equal(posts,0,'an authored route is not a new manual account choice');next.bridge.dispose();
});
