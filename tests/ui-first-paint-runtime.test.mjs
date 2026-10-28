import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
const location=()=>({href:'https://leafhour.com/library'});
test('a verified server account seed resolves the first locale before device fallback can paint',async()=>{
 let writes=0;const runtime=createUiLocale({initialAccountPreference:'ja',getLocation:location,storage:{getItem:()=> 'en',setItem(){writes++;}},languages:['en'],loadCatalogue:async()=>ja});
 await runtime.initializeOnce();assert.equal(runtime.getUiLocale(),'ja');assert.equal(runtime.getUiLocaleState().preferenceSource,'account');assert.equal(writes,0);
 await runtime.requestAccountUiLocale(null);assert.equal(runtime.getUiLocale(),'en');
});
test('a server device seed survives unavailable storage while URL language stays authoritative',async()=>{
 const runtime=createUiLocale({initialDevicePreference:'ja',getLocation:location,storage:{getItem(){throw Error('denied');}},languages:['en'],loadCatalogue:async()=>ja});
 await runtime.initializeOnce();assert.equal(runtime.getUiLocale(),'ja');
 const explicit=createUiLocale({initialAccountPreference:'ja',initialDevicePreference:'ja',getLocation:()=>({href:'https://leafhour.com/library?ui=en'}),loadCatalogue:async()=>ja});await explicit.initializeOnce();assert.equal(explicit.getUiLocale(),'en');
});

test('a stale server device seed does not defeat clearing the saved device preference',async()=>{
 let saved='ja';const runtime=createUiLocale({initialDevicePreference:'ja',getLocation:location,storage:{getItem:()=>saved},languages:['en'],loadCatalogue:async()=>ja});await runtime.initializeOnce();assert.equal(runtime.getUiLocale(),'ja');saved=null;await runtime.handleStorage();assert.equal(runtime.getUiLocale(),'en');
});
test('a server account seed is discarded before a different verified owner can recover preferences',async()=>{
 const {createBrowserAccountUiPreferences}=await import('../app/account-ui-preferences-browser.mjs');
 const runtime=createUiLocale({initialAccountPreference:'ja',getLocation:location,languages:['en'],loadCatalogue:async()=>ja});await runtime.initializeOnce();assert.equal(runtime.getUiLocale(),'ja');
 const bridge=createBrowserAccountUiPreferences({runtime,initialDecision:{source:'account',ownerId:'A'},document:new EventTarget(),view:new EventTarget(),getLocation:location,request:async()=>Response.json({revision:0,updatedAt:null,uiLocale:null})});
 await bridge.adoptOwner(null);assert.equal(runtime.getUiLocale(),'en');bridge.dispose();
});

test('a valid cleared first account response removes the server seed for that same owner',async()=>{
 const {createBrowserAccountUiPreferences}=await import('../app/account-ui-preferences-browser.mjs');
 const runtime=createUiLocale({initialAccountPreference:'ja',getLocation:location,languages:['en'],loadCatalogue:async()=>ja});await runtime.initializeOnce();
 const bridge=createBrowserAccountUiPreferences({runtime,initialDecision:{source:'account',ownerId:'A',preference:'ja'},document:new EventTarget(),view:new EventTarget(),getLocation:location,request:async()=>Response.json({revision:2,updatedAt:'2026-10-28T00:00:00Z',uiLocale:null})});
 await bridge.adoptOwner('A');assert.equal(runtime.getUiLocale(),'en');assert.equal(runtime.getUiLocaleState().preferenceSource,'default');bridge.dispose();
});
test('the legacy reader never declares an unverified guest to the UI owner bridge',async()=>{
 const {readFile}=await import('node:fs/promises');const {parse}=await import('acorn');const vm=await import('node:vm');
 const source=await readFile(new URL('../app/reader-api.mjs',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const statement=ast.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='UnaryExpression'&&n.expression.argument?.callee?.name==='adoptUiOwner');
 let captured;vm.runInNewContext(source.slice(statement.start,statement.end),{readerOwner:null,selectedBookId:null,readerSession:null,liveSession:null,offlineContext:{verified:false},adoptUiOwner:(owner,options)=>captured={owner,options}});assert.equal(captured.options?.verified,false);
});

test('only a successful valid session response can declare a guest or account',async()=>{
 const {readVerifiedUiSession}=await import('../app/ui-first-paint-bootstrap.mjs');assert.equal(typeof readVerifiedUiSession,'function');
 for(const request of [async()=>{throw Error('network');},async()=>Response.json({user:null},{status:503}),async()=>Response.json({}),async()=>Response.json({user:{id:''}}),async()=>new Response('not JSON')])assert.equal(await readVerifiedUiSession({request}),null);
 assert.deepEqual(await readVerifiedUiSession({request:async()=>Response.json({user:null})}),{user:null});
 assert.deepEqual(await readVerifiedUiSession({request:async()=>Response.json({user:{id:'A'},billing:{enabled:false}})}),{user:{id:'A'},billing:{enabled:false}});
});
