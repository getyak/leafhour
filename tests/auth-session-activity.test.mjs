import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSessionActivity} from '../app/auth-session-activity.mjs';

function target(){const listeners=new Map();return {addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},fire(type,event={isTrusted:true}){for(const fn of listeners.get(type)||[])fn(event);}};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(request){
  const document=Object.assign(target(),{hidden:false}),window=target(),calls=[];let now=0,owner='account-a';
  const activity=mountSessionActivity({document,window,getOwner:()=>owner,clock:()=>now,request:async(url,options)=>{calls.push({url,options});return request?request(url,options):Response.json({user:{id:owner}});}});
  return {document,window,activity,calls,tick:ms=>{now+=ms;},owner:value=>{owner=value;}};
}

test('visible account entry and trusted input renew, without a timer or idle refresh heartbeat',async()=>{
  const f=fixture();await settle();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'/api/auth/session/activity');
  assert.equal(f.calls[0].options.headers['X-Reader-Owner'],'account-a');
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{client:'web'});
  f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,1);
  f.tick(300000);await f.activity.update();await settle();assert.equal(f.calls.length,1,'ordinary refresh must not renew an unattended tab');
  f.document.fire('keydown');await settle();assert.equal(f.calls.length,2);
  f.activity.dispose();f.tick(300000);f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,2);
});

test('hidden tabs, synthetic input and anonymous visitors never renew',async()=>{
  const f=fixture();await settle();f.tick(300000);f.document.hidden=true;
  f.document.fire('pointerdown');f.window.fire('focus');await settle();assert.equal(f.calls.length,1);
  f.document.hidden=false;f.document.fire('keydown',{isTrusted:false});await settle();assert.equal(f.calls.length,1);
  f.document.fire('visibilitychange');await settle();assert.equal(f.calls.length,2);
  f.owner(null);await f.activity.update();f.tick(300000);f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,2);
});

test('account changes send the new owner and stale failures cannot block it',async()=>{
  let release;const held=new Promise(r=>{release=r;});
  const f=fixture(async(_url,options)=>options.headers['X-Reader-Owner']==='account-a'?held:Response.json({user:{id:'account-b'}}));
  f.owner('account-b');await f.activity.update();await settle();assert.equal(f.calls.length,2);
  release(new Response('{}',{status:401}));await settle();
  f.tick(300000);f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1).options.headers['X-Reader-Owner'],'account-b');
});

test('invalid credentials stop activity attempts until an explicit sign-in reset',async()=>{
  const f=fixture(async()=>new Response('{}',{status:401}));await settle();
  f.tick(300000);f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,1);
  await f.activity.update({reset:true});await settle();assert.equal(f.calls.length,2);
});

test('temporary failures retain the account and allow the next bounded foreground attempt',async()=>{
  const f=fixture(async()=>{throw new TypeError('offline');});await settle();
  f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,1);
  f.tick(300000);f.document.fire('pointerdown');await settle();assert.equal(f.calls.length,2);
});

test('programmatic scroll or focus does not extend an unattended session',async()=>{
  const f=fixture();await settle();f.tick(300000);
  f.document.fire('scroll');f.window.fire('focus');await settle();assert.equal(f.calls.length,1);
  f.document.fire('wheel');await settle();assert.equal(f.calls.length,2);
});
