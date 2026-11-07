import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {ownedMirrorChild,contextProof,parseParentCommand,inheritedMirrorEnvironment}=await import('../tools/get273-safari-parent.mjs');
test('only fixed task operations are accepted, with no arguments, paths, URLs or shell',()=>{
 assert.equal(parseParentCommand('{"op":"status"}'),'status');
 for(const value of ['{"op":"exec"}','{"op":"status","env":"private"}','{"op":"finish-owned-context","url":"https://elsewhere.invalid"}','[]','null','x'.repeat(1025)])assert.throws(()=>parseParentCommand(value));
});
test('child environment retains genuine ownership values unchanged and excludes unrelated credentials',()=>{
 const e={PATH:'/bin',HOME:'/synthetic',DEV_IOS_SESSION_ID:'fake-session',DEV_IOS_SESSION_PID:'111',DEV_IOS_BORROWED:'true',IOS_AUTOMATION_LOCK_HELD:'true',IOS_AUTOMATION_LOCK_FILE:'/fake-lock',SIMULATOR_UDID:'fake-udid',SOME_API_KEY:'synthetic-secret'};
 const inherited=inheritedMirrorEnvironment(e);
 for(const key of ['DEV_IOS_SESSION_ID','DEV_IOS_SESSION_PID','DEV_IOS_BORROWED','IOS_AUTOMATION_LOCK_HELD','IOS_AUTOMATION_LOCK_FILE'])assert.equal(inherited[key],e[key]);
 assert.equal(inherited.SOME_API_KEY,undefined);assert.equal(inherited.SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD,'1');
});
test('an actual host child ignoring repeated TERM remains pending, without escalation',{timeout:2000},async()=>{
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);process.stdin.on('data',()=>process.exit(0));"],{stdio:['pipe','pipe','ignore']});
 try{
  await new Promise(r=>child.stdout.once('data',r));const handle=ownedMirrorChild(child,{waitMs:20});
  handle.signalTerm();assert.deepEqual(await handle.waitExit(),{pending:true});handle.signalTerm();assert.deepEqual(await handle.waitExit(),{pending:true});
  child.stdin.end('finish');assert.deepEqual(await handle.waitExit(),{code:0,signal:null});
 }finally{if(child.exitCode===null){child.stdin.end('finish');await new Promise(r=>child.once('exit',r));}}
});
test('child transport errors never impersonate an observed OS exit and repeated errors stay handled',{timeout:2000},async()=>{
 const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000);process.stdin.on('data',()=>process.exit(0));"],{stdio:['pipe','pipe','ignore']});
 try{
  await new Promise(r=>child.stdout.once('data',r));const handle=ownedMirrorChild(child,{waitMs:15});
  child.emit('error',Error('synthetic transport error'));assert.deepEqual(await handle.waitExit(),{pending:true});
  assert.doesNotThrow(()=>child.emit('error',Error('second synthetic transport error')));
  child.stdin.end('finish');assert.deepEqual(await handle.waitExit(),{code:0,signal:null});
 }finally{if(child.exitCode===null){child.stdin.end('finish');await new Promise(r=>child.once('exit',r));}}
});
test('only fresh fixed own-context screenshot files can support an explicit operator attestation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'get273-parent-proof-'));await mkdir(join(root,'screenshots'));
 try{
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]);
  await writeFile(join(root,'screenshots','entry-blank.png'),png);
  const proof=await contextProof(root,'entry',Date.now()-1000);assert.equal(proof.attestation,'operator-owned-private-blank');assert.equal(proof.sha256.length,64);
  await assert.rejects(contextProof(root,'entry',Date.now()+1000));await assert.rejects(contextProof(root,'other',0));await assert.rejects(contextProof(root,'restored',0));
 }finally{await rm(root,{recursive:true,force:true});}
});
