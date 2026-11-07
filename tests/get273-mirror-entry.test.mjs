import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Run the exact construction used by actual adapter main. No onCleanStop is
// supplied by the test, and no CLI test flag or authorization bypass exists.
for(const mode of ['clean','startup-failed','blocked-close','blocked-receipt','pending-close']){
 test('actual adapter entry wiring: '+mode,()=>{
  const root=mkdtempSync(join(tmpdir(),'get273-actual-entry-')),receipt=join(root,'receipt.json');
  const url=new URL('../tools/get273-mirror-adapter.mjs',import.meta.url).href;
  const script=`import {createAdapterRuntime} from ${JSON.stringify(url)};
   import {writeFileSync} from 'node:fs';
   const runtime=createAdapterRuntime({
    assertOwner:async()=>{},
    createNative:r=>{
     r.hid={isFoldable:async()=>false,close:async()=>{${mode==='blocked-close'?'throw Error("fake close")':mode==='pending-close'?'await new Promise(()=>{})':''}}};
     r.capture={start:async()=>{setInterval(()=>{},1000);${mode==='startup-failed'?'throw Error("fake start")':''}},stop:async()=>{}};
    },
    createServer:()=>({listen:async()=>"http://127.0.0.1:1234",close:async()=>{}}),
    writeReceipt:(kind,value)=>{if(${mode==='blocked-receipt'}&&kind==="stopped")throw Error("fake receipt");writeFileSync(${JSON.stringify(receipt)},JSON.stringify({kind,...value}));},
    hold:()=>{},setTimer:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),
   });
   // Test-only watchdog terminates the fake host child. A production blocked
   // adapter has no such watchdog or forced exit.
   setTimeout(()=>{console.log(JSON.stringify(runtime.status()));process.exit(73);},250);
   await runtime.start();await runtime.stop();`;
  try{
   const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:2000});
   const blocked=mode.startsWith('blocked')||mode==='pending-close';
   assert.equal(result.status,blocked?73:mode==='startup-failed'?1:0,result.stderr);
   const proof=JSON.parse(readFileSync(receipt,'utf8'));
   if(blocked){assert.equal(proof.kind,'blocked');assert.equal(JSON.parse(result.stdout).phase,'blocked');}
   else{assert.equal(proof.kind,'stopped');assert.equal(proof.cleanupComplete,true);assert.equal(proof.operationsQuiescent,true);}
  }finally{rmSync(root,{recursive:true,force:true});}
 });
}
