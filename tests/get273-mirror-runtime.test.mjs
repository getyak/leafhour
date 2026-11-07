import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
const {createMirrorRuntime,installMirrorSignals}=await import('../tools/get273-mirror-runtime.mjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
function rig(fault={}){
 const events=[],receipts=[],timers=[];let held=false,exitAttempts=0;
 const runtime=createMirrorRuntime({
  assertOwner:async()=>{events.push('owner');if(fault.owner)throw Error();},
  createNative:r=>{events.push('native');r.hid={isFoldable:async()=>{if(fault.setup)await fault.setup.promise;return false;},close:async()=>{events.push('hid-close');if(fault.close)await fault.close.promise;}};r.capture={start:async()=>{events.push('capture-start');if(fault.start)throw Error();},stop:async()=>events.push('capture-stop'),snapshotJpeg:async()=>Buffer.from('jpeg')};},
  createServer:()=>({listen:async()=>{events.push('listen');return 'http://127.0.0.1:1234';},close:async()=>{events.push('server-close');if(fault.serverClose)throw Error();}}),
  writeReceipt:(kind,value)=>{if(fault.receipt)throw Error();receipts.push({kind,...value});},
  hold:value=>{held=value;},setTimer:fn=>{timers.push(fn);return fn;},clearTimer:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},
  onCleanStop:code=>{exitAttempts++;assert.equal(receipts.at(-1).kind,'stopped');assert.equal(held,false);events.push('exit-'+code);},
  setWatch:()=>1,clearWatch:()=>{},
 });
 return{runtime,events,receipts,get held(){return held;},get exitAttempts(){return exitAttempts;},tick:async()=>{for(const fn of [...timers])fn();await flush();}};
}
test('startup failure closes only constructed handles before dropping its owned hold',async()=>{
 const r=rig({start:true});await r.runtime.start();assert.equal(r.held,false);
 assert.deepEqual(r.events,['owner','native','owner','capture-start','hid-close','capture-stop','exit-1']);
 assert.equal(r.receipts.at(-1).kind,'stopped');assert.equal(r.receipts.at(-1).cleanupComplete,true);
});
test('signal during native setup holds blocked state and never starts capture after setup settles',async()=>{
 const setup=deferred(),r=rig({setup});const start=r.runtime.start();await flush();
 await r.runtime.stop();assert.equal(r.held,true);assert.equal(r.receipts.at(-1).kind,'blocked');
 setup.resolve();await start;assert(!r.events.includes('capture-start'));assert.equal(r.held,true);
 assert.equal(r.exitAttempts,0);
});
test('cleanup rejection is retained as blocked without an unhandled rejection',async()=>{
 const r=rig({serverClose:true});await r.runtime.start();await r.runtime.stop();
 assert.equal(r.held,true);assert.equal(r.receipts.at(-1).kind,'blocked');assert.equal(r.receipts.at(-1).cleanupComplete,false);
 assert.equal(r.exitAttempts,0);
});
test('a hanging native close gets a blocked receipt and remains held after its deadline',async()=>{
 const close=deferred(),r=rig({close});await r.runtime.start();const stop=r.runtime.stop();await flush();await r.tick();await stop;
 assert.equal(r.held,true);assert.equal(r.receipts.at(-1).nativeCleanupPending,true);assert(!r.events.includes('capture-stop'));
 close.resolve();await flush();assert.equal(r.held,true);
 assert.equal(r.exitAttempts,0);
});
test('receipt write failure retains the hold even when all handles closed',async()=>{
 const r=rig({receipt:true});await r.runtime.start();assert.equal(r.held,true);assert.equal(r.runtime.status().phase,'blocked');
 assert.equal(r.exitAttempts,0);
});
test('ordinary stop closes handles and records only native completion, with no OS attestation',async()=>{
 const r=rig();await r.runtime.start();await r.runtime.stop();
 assert.equal(r.held,false);assert.equal(r.receipts.at(-1).cleanupComplete,true);assert.equal(r.receipts.at(-1).osReleaseVerified,false);
 assert.equal(r.events.at(-1),'exit-0');
});
test('repeated stop signals remain handled while native startup is blocked',async()=>{
 const setup=deferred(),r=rig({setup}),signals=new EventEmitter();installMirrorSignals(r.runtime,signals);
 const start=r.runtime.start();await flush();
 assert.equal(signals.emit('SIGTERM'),true);await flush();assert.equal(r.held,true);
 assert.equal(signals.emit('SIGTERM'),true);assert.equal(signals.emit('SIGINT'),true);await flush();
 assert.equal(r.runtime.status().phase,'blocked');assert.equal(r.held,true);
 setup.resolve();await start;assert.equal(r.held,true);
 assert(!r.events.some(e=>e.startsWith('exit-')));
});

for(const mode of ['clean','blocked-close','startup-failed','blocked-receipt','pending-close'])test('actual host child '+mode+' with a retained external event-loop reference',()=>{
 const url=new URL('../tools/get273-mirror-runtime.mjs',import.meta.url).href;
 const script=`import {createMirrorRuntime} from ${JSON.stringify(url)};
 let last=null;const runtime=createMirrorRuntime({assertOwner:async()=>{},
 createNative:r=>{r.hid={isFoldable:async()=>false,close:async()=>{${mode==='blocked-close'?'throw Error("fake close failure")':mode==='pending-close'?'await new Promise(()=>{})':''}}};r.capture={start:async()=>{setInterval(()=>{},1000);${mode==='startup-failed'?'throw Error("fake startup failure")':''}},stop:async()=>{}};},
 createServer:()=>({listen:async()=>"http://127.0.0.1:1234",close:async()=>{}}),
 writeReceipt:(kind,value)=>{if(${mode==='blocked-receipt'}&&kind==="stopped")throw Error("fake receipt failure");last={kind,...value};},hold:()=>{},
 setTimer:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),
 onCleanStop:code=>{if(last.kind!=="stopped"||last.cleanupComplete!==true)process.exit(92);process.exit(code);},
 });
 setTimeout(()=>{console.log(JSON.stringify({phase:runtime.status().phase,last:last?.kind}));process.exit(73);},250);
 await runtime.start();await runtime.stop();`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:2000});
 const blocked=mode.startsWith('blocked')||mode==='pending-close';
 assert.equal(result.status,blocked?73:mode==='startup-failed'?1:0);if(blocked)assert.equal(JSON.parse(result.stdout).phase,'blocked');
});
