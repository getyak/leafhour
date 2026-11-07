import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
const {createSafariParent,installSafariParentSignals}=await import('../tools/get273-safari-parent-control.mjs');
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function rig(options={}){
 const calls=[],receipts=[];let held=false,state=options.entry??'Booted',exit=options.exit??{code:0,signal:null};
 let ready={pid:42,udid:'02B4F0C1-A92F-469D-9DCC-5ED13F119507',origin:'http://127.0.0.1:12345',scope:['frame','touch']};
 const stopped={pid:42,udid:ready.udid,phase:'stopped',cleanupComplete:true,activeTouch:false,nativePending:false,framePending:false,commandPending:false,startupPending:false,nativeCleanupPending:false,operationsQuiescent:true,osReleaseVerified:false};
 const mirror={pid:42,signalTerm:()=>{calls.push('term');if(options.termFail)throw Error();},waitExit:async()=>{calls.push('wait-exit');if(options.exitGate)await options.exitGate.promise;return exit;}};
 const parent=createSafariParent({entryExpected:state,
  assertOwner:async()=>{calls.push('owner');if(options.ownerFail)throw Error();},
  device:{state:async()=>{calls.push('state');return state;},boot:async()=>{calls.push('boot');state='Booted';if(options.bootFail)throw Error();},shutdown:async()=>{calls.push('shutdown');if(options.shutdownFail)throw Error();state='Shutdown';}},
  createFixture:async()=>{calls.push('fixture-create');return{listen:async()=>{calls.push('fixture-listen');if(options.fixtureGate)await options.fixtureGate.promise;if(options.fixtureFail)throw Error();return'http://127.0.0.1:22222';},close:async()=>{calls.push('fixture-close');if(options.fixtureCloseFail)throw Error();},report:()=>({nativeAcceptance:'unrun',events:[],violations:[]})};},
  spawnMirror:()=>{calls.push('spawn');if(options.spawnFail)throw Error();return mirror;},
  waitReady:async()=>{calls.push('ready');if(options.readyGate)await options.readyGate.promise;if(options.readyFail)throw Error();return ready;},
  readMirrorReceipt:kind=>{if(kind==='blocked')return options.blocked?{pid:42,cleanupComplete:false}:null;return options.missing?null:options.badReceipt?{...stopped,activeTouch:true}:stopped;},
  contextEvidence:async kind=>{calls.push('context-'+kind);if(options.contextFail===kind)throw Error();return{kind,sha256:'a'.repeat(64),attestation:'operator-owned-private-blank'};},
  writeReceipt:(kind,value)=>{if(options.writeFail===kind)throw Error();receipts.push({kind,...value});},hold:value=>{held=value;},
 });
 return{parent,calls,receipts,get held(){return held;},setExit:value=>{exit=value;},setReady:value=>{ready=value;}};
}
async function ready(r){await r.parent.start();await r.parent.openMirror();}
test('normal borrowed Booted exit restores only the attested own context and never shuts down Primary',async()=>{
 const r=rig();await ready(r);await r.parent.confirmRestored();await r.parent.stop();
 assert.equal(r.held,false);assert.equal(r.receipts.at(-1).cleanupComplete,true);assert(!r.calls.includes('shutdown'));
 assert(r.calls.indexOf('context-restored')<r.calls.indexOf('term'));assert(r.calls.indexOf('wait-exit')<r.calls.indexOf('fixture-close'));
});
test('entry Shutdown boots only the selected existing device and restores Shutdown after confirmed child exit',async()=>{
 const r=rig({entry:'Shutdown'});await ready(r);await r.parent.confirmRestored();await r.parent.stop();
 assert.equal(r.calls.filter(x=>x==='boot').length,1);assert.equal(r.calls.filter(x=>x==='shutdown').length,1);assert.equal(r.held,false);
 assert(r.calls.indexOf('fixture-close')<r.calls.indexOf('shutdown'));
});
for(const failure of ['blocked','missing','badReceipt'])test('child '+failure+' prevents handoff and device restoration',async()=>{
 const r=rig({entry:'Shutdown',[failure]:true});await ready(r);await r.parent.confirmRestored();await r.parent.stop();
 assert.equal(r.held,true);assert.equal(r.parent.status().phase,'blocked');assert(!r.calls.includes('shutdown'));assert(!r.calls.includes('fixture-close'));
});
test('pending child gets one TERM, no escalation, and repeated signals retain isolation',async()=>{
 const r=rig({entry:'Shutdown',exit:{pending:true}});const signals=new EventEmitter();installSafariParentSignals(r.parent,signals);
 await ready(r);await r.parent.confirmRestored();signals.emit('SIGTERM');await flush();signals.emit('SIGTERM');signals.emit('SIGINT');await flush();
 assert.equal(r.held,true);assert.equal(r.calls.filter(x=>x==='term').length,1);assert(!r.calls.includes('shutdown'));
});
test('missing restored context cannot release a live UI session',async()=>{
 const r=rig();await ready(r);await r.parent.stop();assert.equal(r.held,true);assert.equal(r.parent.status().phase,'blocked');
 assert(!r.calls.includes('fixture-close'));assert.equal(r.calls.filter(x=>x==='term').length,1);
});
test('initial fixture failure can close its own resource and restore its own boot without opening Safari',async()=>{
 const r=rig({entry:'Shutdown',fixtureFail:true});await r.parent.start();assert.equal(r.held,false);
 assert(!r.calls.includes('spawn'));assert(r.calls.includes('fixture-close'));assert(r.calls.includes('shutdown'));
});
test('fixture close failure stays held after confirmed child exit',async()=>{
 const r=rig({fixtureCloseFail:true});await ready(r);await r.parent.confirmRestored();await r.parent.stop();assert.equal(r.held,true);
});
test('shutdown failure and receipt write failure cannot report clean handoff',async()=>{
 for(const options of [{entry:'Shutdown',shutdownFail:true},{writeFail:'stopped'}]){
  const r=rig(options);await ready(r);await r.parent.confirmRestored();await r.parent.stop();assert.equal(r.held,true);assert.equal(r.parent.status().phase,'blocked');
 }
});
test('signal during initialization retains pending state and cannot continue to mirror startup',async()=>{
 const gate=deferred(),r=rig({fixtureGate:gate});const start=r.parent.start();await flush();await r.parent.stop();
 assert.equal(r.held,true);assert.equal(r.parent.status().phase,'blocked');gate.resolve();await start;assert(!r.calls.includes('spawn'));
});
test('owner and own-context failures prevent mirror creation',async()=>{
 const a=rig({ownerFail:true});await a.parent.start();assert(!a.calls.includes('fixture-create'));assert(!a.calls.includes('boot'));
 const b=rig({contextFail:'entry'});await b.parent.start();await b.parent.openMirror();assert(!b.calls.includes('spawn'));
});
test('foreign child PID/origin readiness is rejected rather than exposed',async()=>{
 const r=rig();await r.parent.start();r.setReady({pid:99,origin:'https://example.invalid',scope:['frame','touch']});await r.parent.openMirror();
 assert.notEqual(r.parent.status().phase,'ready');
});
test('repeated normal stop signals await the same confirmed exit without extra TERM',async()=>{
 const gate=deferred(),r=rig({exitGate:gate}),signals=new EventEmitter();installSafariParentSignals(r.parent,signals);
 await ready(r);await r.parent.confirmRestored();const stop=r.parent.stop();await flush();signals.emit('SIGTERM');signals.emit('SIGINT');await flush();
 assert.equal(r.held,true);assert.equal(r.calls.filter(x=>x==='term').length,1);gate.resolve();await stop;
 assert.equal(r.held,false);assert.equal(r.parent.status().handoffReady,true);
});
test('uncertain own boot stays isolated without attempting another device transition',async()=>{
 const r=rig({entry:'Shutdown',bootFail:true});await r.parent.start();assert.equal(r.held,true);assert.equal(r.parent.status().phase,'blocked');
 assert(!r.calls.includes('shutdown'));assert(!r.calls.includes('fixture-create'));
});
test('failure after own-context entry cannot hand off merely because mirror UI readiness was never advertised',async()=>{
 const r=rig({entry:'Shutdown',readyFail:true,exit:{code:1,signal:null}});await r.parent.start();await r.parent.openMirror();
 assert.equal(r.held,true);assert(!r.calls.includes('shutdown'));assert(!r.calls.includes('fixture-close'));assert.equal(r.parent.status().uiAdvertised,false);
});
test('stopping while context setup is available requires fresh restoration even before a mirror exists',async()=>{
 const r=rig({entry:'Shutdown'});await r.parent.start();await r.parent.stop();
 assert.equal(r.held,true);assert(!r.calls.includes('shutdown'));
});
test('own blank context can be attested and finished without ever opening the mirror',async()=>{
 const r=rig({entry:'Shutdown'});await r.parent.start();await r.parent.confirmRestored();await r.parent.stop();
 assert.equal(r.held,false);assert(!r.calls.includes('spawn'));assert(r.calls.includes('shutdown'));
});
