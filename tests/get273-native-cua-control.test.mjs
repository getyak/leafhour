import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSession} from '../tools/get273-native-cua-control.mjs';

function rig(overrides={}){
 let owner=true,state=overrides.entryExpected??'Booted',now=1000,ioError=false;
 const log=[],receipts=[],events=[];
 const fixture={listen:async()=>{log.push('listen');return 'http://127.0.0.1:64200';},close:async()=>log.push('fixture-close'),report:()=>({events,violations:[]})};
 const session=createNativeSession({entryExpected:state,assertOwner:async()=>{log.push('owner');if(!owner)throw Error('lost');},assertAdmission:async()=>log.push('resources'),
  device:{state:async()=>state,boot:async()=>{log.push('boot');state='Booted';},shutdown:async()=>{log.push('shutdown');state='Shutdown';}},
  createFixture:async()=>fixture,contextProof:async kind=>({kind,sha256:'a'.repeat(64)}),
  persist:value=>{if(ioError)throw Error('disk');receipts.push(structuredClone(value));},hold:value=>log.push('hold:'+value),now:()=>now,...overrides});
 return {session,log,receipts,events,owner:v=>owner=v,advance:ms=>now+=ms,ioError:()=>ioError=true};
}
const result=(ticket,stage)=>({session:ticket.session,id:ticket.id,sequence:ticket.sequence,action:ticket.action,stage,...(stage==='closed'?{sdkResourcesClosed:false}:{}),methodReturned:true,osReleaseVerified:false});
async function method(r,action,payload={}){const t=await r.session.admit(action,payload);assert.equal(t.stage,'method-inflight');return r.session.methodOK(result(t,'method-returned'));}
async function observed(r,t,view='owned-private-blank'){
 const o=await r.session.observed({...result(t,'observed'),observationReturned:true});
 await r.session.view({id:o.id,primaryWindow:true,desktopFocus:true,view,privateContext:true,targetVisible:view==='owned-reader'});return o;
}
async function entry(r){await r.session.start();let t=await method(r,'bind');await observed(r,t);await r.session.entry();}
async function ready(r){await entry(r);r.events.push({kind:'observer-ready',seq:0,documentId:'a'.repeat(32)},{kind:'reader-ready',seq:1,documentId:'a'.repeat(32)});let t=await r.session.observe();await observed(r,t,'owned-reader');await r.session.ready();}
async function restored(r){await r.session.restore();const t=await r.session.observe();await observed(r,t);await r.session.restored();const c=await r.session.admit('close');await r.session.closed(result(c,'closed'));}

test('normal single hold persists before ticket; returned input and later observation settle separately',async()=>{
 const r=rig();await ready(r);const t=await r.session.admit('hold',{point:[133,290]});
 assert.equal(r.receipts.at(-1).pending.id,t.id);assert.equal(r.receipts.at(-1).inputState,'inflight');assert.equal(r.session.status().holdAttempts,1);
 const ot=await r.session.methodOK(result(t,'method-returned'));assert.equal(r.session.status().inputState,'returned');assert.equal(r.session.status().pending.kind,'observation');
 await observed(r,ot,'owned-reader');await restored(r);await r.session.finish();assert.equal(r.session.status().phase,'stopped');assert.equal(r.session.status().osReleaseVerified,false);assert.equal(r.log.filter(x=>x==='fixture-close').length,1);
});
test('observation failure never rewrites fulfilled input as HID pending; retry is same bound read only',async()=>{
 const r=rig();await ready(r);const t=await method(r,'hold',{point:[133,290]});await r.session.observationError({id:t.id});
 assert.equal(r.session.status().inputState,'returned');assert.equal(r.session.status().phase,'observing');
 const retry=await r.session.observe();assert.equal(retry.action,'observe');await observed(r,retry,'owned-reader');
 assert.equal(r.session.status().holdAttempts,1);assert.equal(r.session.status().phase,'reader');
});
for(const problem of ['input-error','pending-stop','deadline','owner-loss','receipt-failure'])test(problem+' retains lease and prevents automatic cleanup',async()=>{
 const r=rig({entryExpected:'Shutdown'});await ready(r);const t=await r.session.admit('hold',{point:[133,290]});
 if(problem==='input-error')await r.session.inputError({id:t.id});
 if(problem==='pending-stop')await r.session.finish();
 if(problem==='deadline'){r.advance(600001);await r.session.expire();}
 if(problem==='owner-loss'){r.owner(false);await r.session.methodOK(result(t,'method-returned'));}
 if(problem==='receipt-failure'){r.ioError();await r.session.methodOK(result(t,'method-returned'));}
 assert.equal(r.session.status().phase,'blocked');assert.equal(r.session.status().cleanupComplete,false);assert(!r.log.includes('fixture-close'));assert(!r.log.includes('shutdown'));assert(!r.log.includes('hold:false'));
});
test('duplicate/stale completion and concurrent admission absorb late continuations',async()=>{
 const r=rig();await ready(r);const t=await r.session.admit('hold',{point:[133,290]});await r.session.admit('restore-focus-address',{target:2});
 assert.equal(r.session.status().phase,'blocked');await r.session.methodOK(result(t,'method-returned'));assert.equal(r.session.status().phase,'blocked');assert.notEqual(r.session.status().inputState,'returned');
});
test('second long press and generic command are rejected without another ticket',async()=>{
 const r=rig();await ready(r);const t=await method(r,'hold',{point:[133,290]});await observed(r,t,'owned-reader');
 assert.equal((await r.session.admit('hold',{point:[133,290]})).phase,'blocked');assert.equal(r.session.status().holdAttempts,1);
 const s=rig();await entry(s);assert.equal((await s.session.admit('exec',{command:'anything'})).phase,'blocked');
});
test('missing restoration blocks cleanup even after method fulfilled and no range was observed',async()=>{
 const r=rig();await ready(r);await observed(r,await method(r,'hold',{point:[133,290]}),'owned-reader');await r.session.finish();
 assert.equal(r.session.status().phase,'blocked');assert(!r.log.includes('fixture-close'));
});
for(const entryExpected of ['Booted','Shutdown'])test('normal '+entryExpected+' cleanup restores only own entry lifecycle',async()=>{
 const r=rig({entryExpected});await entry(r);await restored(r);await r.session.finish();
 assert.equal(r.session.status().phase,'stopped');assert.equal(r.log.includes('shutdown'),entryExpected==='Shutdown');assert.equal(r.log.includes('boot'),entryExpected==='Shutdown');
});
test('resource decline after admission does not prevent verified own context restoration',async()=>{
 let reject=false;const r=rig({assertAdmission:async()=>{if(reject)throw Error('floor');}});await entry(r);reject=true;
 await restored(r);await r.session.finish();assert.equal(r.session.status().phase,'stopped');
});
test('post-setup initialization failure and signals cannot erase context obligation',async()=>{
 const r=rig({contextProof:async()=>{throw Error('no png');}});await r.session.start();await observed(r,await method(r,'bind'));await r.session.entry();
 await r.session.finish();await r.session.finish();assert.equal(r.session.status().phase,'blocked');assert(!r.log.includes('fixture-close'));
});
test('late owner await cannot overwrite concurrent block or issue an input ticket',async()=>{
 let release,delay=false;const r=rig({assertOwner:async()=>{if(delay)await new Promise(resolve=>release=resolve);}});await ready(r);delay=true;
 const pending=r.session.admit('hold',{point:[133,290]});await new Promise(resolve=>setImmediate(resolve));await r.session.finish();release();await pending;
 assert.equal(r.session.status().phase,'blocked');assert.equal(r.session.status().holdAttempts,0);
});
test('a newly returned observation invalidates old focus and coordinates until its own view is attested',async()=>{
 const r=rig();await ready(r);const t=await r.session.observe();await r.session.observed({...result(t,'observed'),observationReturned:true});
 const attempt=await r.session.admit('hold',{point:[133,290]});assert.equal(attempt.phase,'blocked');assert.equal(r.session.status().holdAttempts,0);
});
