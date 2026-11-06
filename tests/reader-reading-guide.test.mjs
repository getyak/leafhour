import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderGuideController,readerGuideTarget} from '../app/reader-reading-guide.mjs';
const target={ownerId:'owner-a',bookId:'book-a',contentVersion:'v1',sourceKind:'cloud',locale:'en'};
const guide={kind:'leafhour-reading-guide',schemaVersion:1,origin:'ai',status:'draft',scope:'opening-sample',...target,opening:'A bounded welcome.',method:'Read at your own pace.',readingQuestion:'What draws you in?'};
test('first opening reads then prepares, a refreshed reader uses the saved result without generating',async()=>{
 const calls=[],storage=new Map(),cache={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
 const create=()=>createReaderGuideController({getTarget:()=>target,storage:cache,api:async(_,body)=>{calls.push(body.action);return body.action==='view'?{state:'missing'}:{state:'ready',guide};}});
 const first=create();await first.prepare();assert.deepEqual(calls,['view','ensure']);first.dispose();const reopened=create();await reopened.prepare();assert.equal(reopened.view().guide.opening,guide.opening);assert.deepEqual(calls,['view','ensure']);
});
test('unknown attempts and offline recovery only check existing results; safe failures require an explicit retry',async()=>{
 const actions=[];let state='unknown';const c=createReaderGuideController({getTarget:()=>target,api:async(_,body)=>{actions.push(body.action);return {state};}});
 await c.prepare();await c.retry();assert.deepEqual(actions,['view','view']);state='failed';await c.prepare();assert.deepEqual(actions,['view','view','view']);await c.retry();assert.deepEqual(actions,['view','view','view','view','retry']);
});
test('in-flight generation polls read-only and stale account/book completion never publishes or caches',async()=>{
 let current=target,release,poll;const states=[],writes=[];
 const c=createReaderGuideController({getTarget:()=>current,onChange:v=>states.push(v),storage:{getItem:()=>null,setItem:(...v)=>writes.push(v)},schedule:fn=>{poll=fn;return 1;},unschedule:()=>{},api:async()=>({state:'preparing'})});
 await c.prepare();assert.equal(c.view().state,'preparing');assert.equal(typeof poll,'function');c.dispose();
 const late=createReaderGuideController({getTarget:()=>current,onChange:v=>states.push(v),storage:{getItem:()=>null,setItem:(...v)=>writes.push(v)},api:()=>new Promise(r=>release=r)});
 const pending=late.prepare();current={...target,ownerId:'other-owner',bookId:'book-b'};release({state:'ready',guide});await pending;assert.equal(writes.length,0);assert.equal(states.some(v=>v.state==='ready'),false);
 assert.equal(readerGuideTarget({reader:{getBook:()=>({bookId:'other',contentVersion:'v'})},ownerId:'a',bookId:'book-a'}),null);
});

test('cached account data stays hidden when the current cookie identity cannot be confirmed',async()=>{
 const values=[];let calls=0;const c=createReaderGuideController({getTarget:()=>target,storage:{getItem:()=>JSON.stringify(guide)},verifyOwner:async()=>{calls++;return false;},onChange:v=>values.push(v),api:async()=>{throw Error('must not run');}});
 await c.prepare();assert.equal(calls,1);assert.equal(c.view().state,'unknown');assert.equal(values.some(v=>v.guide),false);
});
