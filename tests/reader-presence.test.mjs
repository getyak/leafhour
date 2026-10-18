import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderPresence} from '../app/reader-presence.mjs';
function fixture(api=async()=>{}){
 const document=new EventTarget(),window=new EventTarget();document.hidden=false;let focused=true,user='owner',enabled=true,tick;
 document.hasFocus=()=>focused;const calls=[];
 const presence=mountReaderPresence({document,window,getUserId:()=>user,enabled:()=>enabled,api:async(...args)=>{calls.push(args);return api(...args);},crypto:{randomUUID:()=> '56c74eb3-d203-441e-a518-fdf210887f0e'},setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{tick=null;}});
 return {presence,document,window,calls,focus:value=>{focused=value;window.dispatchEvent(new Event(value?'focus':'blur'));},user:value=>{user=value;},enable:value=>{enabled=value;},tick:()=>tick?.()};
}
test('foreground owner heartbeats contain only per-tab identity and presence, never reading content/time',async()=>{
 const f=fixture();await f.presence.refresh();f.calls.length=0;await f.tick();
 assert.equal(f.calls.length,1);const [route,body,options]=f.calls[0];assert.equal(route,'/api/library/daily-reading/presence');assert.deepEqual(Object.keys(body).sort(),['active','sequence','tabId']);assert.equal(body.tabId,'56c74eb3-d203-441e-a518-fdf210887f0e');assert.equal(body.active,true);assert.ok(Number.isSafeInteger(body.sequence));assert.equal(options.headers['X-Reader-Owner'],'owner');assert.equal(options.keepalive,true);await f.presence.close();
});
test('hidden, blurred and pagehide states release presence; pageshow resumes it',async()=>{
 const f=fixture();await f.presence.refresh();f.calls.length=0;
 f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));await f.presence.refresh();assert.equal(f.calls.at(-1)[1].active,false);
 f.document.hidden=false;f.focus(false);await f.presence.refresh();assert.equal(f.calls.at(-1)[1].active,false);
 f.focus(true);await f.presence.refresh();assert.equal(f.calls.at(-1)[1].active,true);
 f.window.dispatchEvent(new Event('pagehide'));await f.presence.refresh();assert.equal(f.calls.at(-1)[1].active,false);
 f.window.dispatchEvent(new Event('pageshow'));await f.presence.refresh();assert.equal(f.calls.at(-1)[1].active,true);await f.presence.close();
});
test('an unready book or guest never creates active presence; leaving an owner does not write into the next account',async()=>{
 const f=fixture();await f.presence.refresh();f.enable(false);await f.presence.refresh();assert.equal(f.calls.at(-1)[1].active,false);
 f.calls.length=0;f.user(null);f.enable(true);await f.presence.refresh();await f.tick();assert.equal(f.calls.length,0);await f.presence.close();
});
test('serial writes coalesce rapid visibility changes so an old inactive write cannot overtake active',async()=>{
 let release,entered=0,notify;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{notify=resolve;});const f=fixture(async()=>{if(++entered===1){notify();await held;}});
 await started;f.focus(false);f.focus(true);const settled=f.presence.refresh();assert.equal(f.calls.length,1);release();await settled;assert.equal(f.calls.at(-1)[1].active,true);assert.equal(f.calls.filter(x=>x[1].active===false).length,0);await f.presence.close();
});
test('a failed heartbeat is contained and retried only on a later explicit refresh/tick',async()=>{
 let fail=true;const f=fixture(async()=>{if(fail)throw Error('synthetic outage');});await f.presence.refresh();const count=f.calls.length;assert.ok(count<=2);fail=false;await f.tick();assert.equal(f.calls.length,count+1);await f.presence.close();const closedCount=f.calls.length;f.focus(true);await f.presence.refresh();assert.equal(f.calls.length,closedCount);
});

test('close synchronously fences pageshow while an active request is in flight',async()=>{
 let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let first=true;
 const f=fixture(async()=>{if(first){first=false;entered();await held;}});await started;
 const closing=f.presence.close();f.window.dispatchEvent(new Event('pageshow'));release();await closing;
 assert.deepEqual(f.calls.map(row=>row[1].active),[true,false]);const count=f.calls.length;f.focus(true);await f.presence.refresh();assert.equal(f.calls.length,count);
});
test('every dispatched presence request advances sequence even after a lost response',async()=>{
 let calls=0;const f=fixture(async()=>{if(++calls===2)throw Error('synthetic response lost while server keeps running');});await f.presence.refresh();f.focus(false);await f.presence.refresh();f.focus(true);await f.presence.refresh();await f.presence.close();
 const sequences=f.calls.map(row=>row[1].sequence);assert.ok(sequences.every(n=>Number.isSafeInteger(n)&&n>0));assert.equal(new Set(sequences).size,sequences.length);assert.deepEqual([...sequences].sort((a,b)=>a-b),sequences);
});
