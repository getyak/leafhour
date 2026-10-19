import test from 'node:test';
import assert from 'node:assert/strict';
import * as preview from '../app/gift-preview.mjs';
import * as giftPage from '../app/book-gift.mjs';
import {createUiLocale} from '../app/ui-locale.mjs';
import english from '../app/ui-catalogs/en.mjs';
const origin='https://leafhour.example';
const event=(source,data,otherOrigin=origin)=>{const e=new Event('message');Object.assign(e,{source,data,origin:otherOrigin});return e;};
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('gift interface envelopes accept only exact canonical locale, parent, origin and keys',()=>{
 assert.equal(typeof preview.giftUiLocaleMessage,'function');assert.equal(typeof preview.readGiftUiLocale,'function');const source={},other={};
 for(const code of ['en','zh-Hans','zh-Hant','ja']){const data=preview.giftUiLocaleMessage(code);assert.deepEqual(data,{kind:'leafhour-gift-ui-locale',version:1,locale:code});assert.equal(preview.readGiftUiLocale(event(source,data),{origin,source}),code);assert.equal(preview.readGiftUiLocale(event(other,data),{origin,source}),null);assert.equal(preview.readGiftUiLocale(event(source,data,'https://other.example'),{origin,source}),null);}
 for(const locale of ['zh','en-US','JA',' ja ',{},null])assert.equal(preview.giftUiLocaleMessage(locale),null);
 const valid={kind:'leafhour-gift-ui-locale',version:1,locale:'ja'};
 for(const data of [null,[],{...valid,version:2},{...valid,version:'1'},{...valid,kind:'marginalia-gift-preview'},{...valid,gift:{}},{...valid,extra:true},{kind:valid.kind,locale:'ja'}])assert.equal(preview.readGiftUiLocale(event(source,data),{origin,source}),null);
});
function fixture(){
 const pending=deferred(),calls=[],writes=[],history=[],win=new EventTarget(),parent={};win.parent=parent;
 const runtime=createUiLocale({loadCatalogue:async(code,options)=>{calls.push({code,options});return pending.promise;},storage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},history:{replaceState:(...args)=>history.push(args)},getLocation:()=>({href:origin+'/gift-preview?ui=en'})});
 return {pending,calls,writes,history,win,parent,runtime,location:{origin,pathname:'/gift-preview'}};
}
test('preview receiver queues before shared readiness and activates only the latest target through the route actor',async()=>{
 assert.equal(typeof giftPage.mountGiftPreviewUiLocale,'function');const f=fixture(),controller=giftPage.mountGiftPreviewUiLocale({window:f.win,location:f.location,runtime:f.runtime});
 f.win.dispatchEvent(event(f.parent,{kind:'leafhour-gift-ui-locale',version:1,locale:'ja'}));f.win.dispatchEvent(event(f.parent,{kind:'leafhour-gift-ui-locale',version:1,locale:'zh-Hant'}));assert.equal(f.calls.length,0);
 await f.runtime.requestUiRoute('en');await flush();assert.equal(f.calls.length,1);assert.equal(f.calls[0].code,'zh-Hant');f.pending.resolve(english);await flush();assert.equal(f.runtime.getUiLocale(),'zh-Hant');assert.deepEqual(f.writes,[]);assert.deepEqual(f.history,[]);controller.dispose();
});
test('same requested pending or failed target does not consume a retry, while an effective target cancels different pending work',async()=>{
 assert.equal(typeof giftPage.mountGiftPreviewUiLocale,'function');const f=fixture();await f.runtime.requestUiRoute('en');const controller=giftPage.mountGiftPreviewUiLocale({window:f.win,location:f.location,runtime:f.runtime});await flush();
 const attempt=f.runtime.requestUiRoute('ja');await flush();const data={kind:'leafhour-gift-ui-locale',version:1,locale:'ja'},before=f.runtime.getUiLocaleState();f.win.dispatchEvent(event(f.parent,data));await flush();assert.equal(f.calls.length,1);assert.deepEqual(f.runtime.getUiLocaleState(),before);
 f.pending.reject(Error('Catalogue failure'));await attempt;const failed=f.runtime.getUiLocaleState();f.win.dispatchEvent(event(f.parent,data));await flush();assert.equal(f.calls.length,1);assert.deepEqual(f.runtime.getUiLocaleState(),failed,'Failure remains available to the explicit shared retry notice');controller.dispose();
 const next=fixture();await next.runtime.requestUiRoute('en');const nextController=giftPage.mountGiftPreviewUiLocale({window:next.win,location:next.location,runtime:next.runtime});await flush();
 const waiting=next.runtime.requestUiRoute('ja');await flush();next.win.dispatchEvent(event(next.parent,{kind:'leafhour-gift-ui-locale',version:1,locale:'en'}));await flush();assert.equal((await waiting).kind,'stale');assert.equal(next.runtime.getRequestedUiLocale(),'en');assert.equal(next.runtime.getUiLocale(),'en');next.pending.resolve(english);await flush();assert.equal(next.runtime.getUiLocale(),'en');assert.deepEqual(next.writes,[]);assert.deepEqual(next.history,[]);nextController.dispose();
});
test('receiver is preview-only, requires a real parent, and consumes queued work after disposal',async()=>{
 assert.equal(typeof giftPage.mountGiftPreviewUiLocale,'function');const f=fixture();assert.equal(giftPage.mountGiftPreviewUiLocale({window:f.win,location:{...f.location,pathname:'/gift/'+'A'.repeat(43)},runtime:f.runtime}),null);const top=new EventTarget();top.parent=top;assert.equal(giftPage.mountGiftPreviewUiLocale({window:top,location:f.location,runtime:f.runtime}),null);
 const controller=giftPage.mountGiftPreviewUiLocale({window:f.win,location:f.location,runtime:f.runtime});f.win.dispatchEvent(event(f.parent,{kind:'leafhour-gift-ui-locale',version:1,locale:'ja'}));controller.dispose();await f.runtime.requestUiRoute('en');await flush();assert.equal(f.calls.length,0);f.win.dispatchEvent(event(f.parent,{kind:'leafhour-gift-ui-locale',version:1,locale:'zh-Hant'}));await flush();assert.equal(f.calls.length,0);
});

test('a duplicate initial failed target preserves its explicit retry budget and rejects unrelated window messages',async()=>{
 const f=fixture(),initial=f.runtime.requestUiRoute('ja'),controller=giftPage.mountGiftPreviewUiLocale({window:f.win,location:f.location,runtime:f.runtime});
 const valid={kind:'leafhour-gift-ui-locale',version:1,locale:'ja'};f.win.dispatchEvent(event(f.parent,valid));assert.equal(f.calls.length,1);f.pending.reject(Error('Initial catalogue failure'));await initial;await flush();assert.equal(f.calls.length,1);assert.equal(f.runtime.getUiLocaleState().initialFallback,true);assert.equal(f.runtime.getUiLocaleState().offerReload,false);
 const state=f.runtime.getUiLocaleState();for(const bad of [event({}, {...valid,locale:'en'}),event(f.parent,{...valid,locale:'en'},'https://other.example'),event(f.parent,{...valid,locale:'en',extra:true})])f.win.dispatchEvent(bad);await flush();assert.deepEqual(f.runtime.getUiLocaleState(),state);assert.equal(f.calls.length,1);controller.dispose();
});
