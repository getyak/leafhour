import test from 'node:test';
import assert from 'node:assert/strict';

// Only the external HID/capture/lease boundary is fake. No addon or device is loaded.
const { createMirrorControl } = await import('../tools/get273-mirror-control.mjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = async () => { for(let n=0;n<15;n++) await Promise.resolve(); };
function rig() {
  let owned=true, clock=0, serial=0;
  const timers=new Map(), calls=[], gates=new Map();
  const control=createMirrorControl({
    assertOwner: async()=>{ calls.push('owner'); if(!owned) throw Error('lost'); },
    hid:{touch:async(phase)=>{ calls.push(phase); if(gates.has(phase)) await gates.get(phase).promise; }},
    capture:{snapshotJpeg:async()=>{calls.push('frame');if(gates.has('frame'))await gates.get('frame').promise;return Buffer.from('jpeg');}},
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;},
    clearTimer:id=>timers.delete(id),
  });
  return {control,calls,gates,lose:()=>{owned=false;},tick:async ms=>{clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}await flush();}};
}

test('each move and both sides of a frame require the live owner; own end survives lease loss',async()=>{
  const r=rig();await r.control.touch('begin',.4,.4);await r.control.touch('move',.5,.5);
  assert.deepEqual(r.calls,['owner','begin','owner','move']);
  await r.control.frame();assert.deepEqual(r.calls.slice(-3),['owner','frame','owner']);
  r.lose();await assert.rejects(r.control.touch('move',.6,.6));await flush();
  assert.equal(r.calls.filter(x=>x==='move').length,1);assert.equal(r.calls.at(-1),'end');
  assert.equal(r.control.receipt().activeTouch,false);
});

test('a frame obtained across lease loss is never returned',async()=>{
  const r=rig(),gate=deferred();r.gates.set('frame',gate);
  const frame=r.control.frame();await flush();r.lose();gate.resolve();await assert.rejects(frame);
  assert.equal(r.control.receipt().frames,0);
});

test('end state stays active until the native end has actually completed',async()=>{
  const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('end',gate);
  const end=r.control.touch('end',.3,.3);await flush();
  assert.equal(r.control.receipt().activeTouch,true);assert.equal(r.control.receipt().operationsQuiescent,false);
  gate.resolve();await end;assert.equal(r.control.receipt().activeTouch,false);
});

test('failed end retains uncertainty and stop never reports a safe handoff',async()=>{
  const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('end',gate);
  const end=r.control.touch('end',.3,.3);await flush();gate.reject(Error('end failed'));await assert.rejects(end);
  const stopped=await r.control.stop();assert.equal(stopped.activeTouch,true);assert.equal(stopped.operationsQuiescent,false);
  assert.equal(r.calls.filter(x=>x==='end').length,1);
});

test('moves never form a queue and a timeout waits for in-flight HID before sending own end',async()=>{
  const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('move',gate);
  const move=r.control.touch('move',.4,.4);await flush();
  const extra=await Promise.allSettled(Array.from({length:100},()=>r.control.touch('move',.5,.5)));
  assert(extra.every(x=>x.status==='rejected'));assert.equal(r.calls.filter(x=>x==='move').length,1);
  await r.tick(2000);await assert.rejects(move);
  assert.equal(r.control.receipt().activeTouch,true);assert.equal(r.control.receipt().nativePending,true);
  assert.equal(r.calls.filter(x=>x==='end').length,0);
  gate.resolve();await flush();assert.equal(r.calls.at(-1),'end');assert.equal(r.control.receipt().activeTouch,false);
});

test('five-second hold watchdog releases without another request',async()=>{
  const r=rig();await r.control.touch('begin',.3,.3);await r.tick(5000);
  assert.equal(r.calls.at(-1),'end');assert.equal(r.control.receipt().gestureTimeouts,1);
  await assert.rejects(r.control.touch('begin',.4,.4));
});

test('disconnect cancels further input and finally releases a started gesture',async()=>{
  const r=rig();await r.control.touch('begin',.3,.3);r.control.abort('client-disconnected');await flush();
  assert.equal(r.calls.at(-1),'end');await assert.rejects(r.control.touch('move',.4,.4));
  assert.equal((await r.control.stop()).operationsQuiescent,true);
});

test('stopping during a stuck end remains blocked rather than treating promise timeout as cancellation',async()=>{
  const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('end',gate);
  const stop=r.control.stop();await flush();await r.tick(2000);await r.tick(1000);
  const receipt=await stop;assert.equal(receipt.operationsQuiescent,false);assert.equal(receipt.nativePending,true);
  assert.equal(receipt.activeTouch,true);gate.resolve();await flush();
  assert.equal(r.control.receipt().activeTouch,false);
});

test('failed move triggers release in its failure path',async()=>{
  const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('move',gate);
  const move=r.control.touch('move',.4,.4);await flush();gate.reject(Error('move failed'));await assert.rejects(move);await flush();
  assert.equal(r.calls.at(-1),'end');assert.equal(r.control.receipt().activeTouch,false);
});

test('concurrent end and shutdown both settle once the single native up completes',async()=>{
  const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('end',gate);
  const end=r.control.touch('end',.3,.3);await flush();const stop=r.control.stop();await flush();
  gate.resolve();await flush();
  let ended=false,stopped=false;void end.then(()=>{ended=true;});void stop.then(()=>{stopped=true;});await flush();
  assert.equal(ended,true);assert.equal(stopped,true);assert.equal(r.calls.filter(x=>x==='end').length,1);
});
test('frame timeout releases input but keeps the unresolved capture recorded',async()=>{
 const r=rig(),gate=deferred();await r.control.touch('begin',.3,.3);r.gates.set('frame',gate);
 const frame=r.control.frame();await flush();await r.tick(2000);await assert.rejects(frame);await flush();
 assert.equal(r.calls.at(-1),'end');assert.equal(r.control.receipt().framePending,true);assert.equal(r.control.receipt().operationsQuiescent,false);
 gate.resolve();await flush();assert.equal(r.control.receipt().frames,0);assert.equal(r.control.receipt().framePending,false);
});
