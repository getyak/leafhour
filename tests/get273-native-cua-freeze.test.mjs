import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyNativePack} from '../tools/get273-native-cua.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('offline pack builder refuses unspecified sources before doing work',()=>{const r=spawnSync(process.execPath,['tools/prepare-get273-native-cua.mjs'],{encoding:'utf8'});assert.equal(r.status,64);assert.equal(r.stdout,'');});
test('actual freeze verifier detects changed source, wrong entry and manifest before admission',async t=>{
 const guardPath='/Users/cubxxw/.local/bin/dev-ios-session',guard=Buffer.from('// synthetic guard fixture; never executed\n');
 const read=fs.readFileSync;let guardReads=0;
 const mockedRead=t.mock.method(fs,'readFileSync',function(path,...args){
  if(path===guardPath){guardReads++;return guard;}
  return read.call(this,path,...args);
 });
 syncBuiltinESMExports();
 t.after(()=>{mockedRead.mock.restore();syncBuiltinESMExports();});
 const root=await realpath(await mkdtemp(join(tmpdir(),'get273-freeze-')));try{
  await mkdir(join(root,'tools'));const file=join(root,'tools/get273-native-cua.mjs'),entry=Buffer.from('// inert test input\n');await writeFile(file,entry);
  const f={kind:'GET-273-native-CUA-single-hold',sourceCommit:'d302393d4ed01a82af6828d7200969be3b8addc9',nodeVersion:process.version,files:{'tools/get273-native-cua.mjs':sha(entry)},externalToolHashes:{'dev-ios-session':sha(guard)}};
  const bytes=Buffer.from(JSON.stringify(f));await writeFile(join(root,'execution-freeze.json'),bytes);assert.equal(verifyNativePack(root,sha(bytes),file).sourceCommit,'d302393d4ed01a82af6828d7200969be3b8addc9');
  assert.equal(guardReads,1);
  const changedGuard=Buffer.from(JSON.stringify({...f,externalToolHashes:{'dev-ios-session':'0'.repeat(64)}}));
  await writeFile(join(root,'execution-freeze.json'),changedGuard);assert.throws(()=>verifyNativePack(root,sha(changedGuard),file));assert.equal(guardReads,2);
  await writeFile(join(root,'execution-freeze.json'),bytes);
  assert.throws(()=>verifyNativePack(root,'0'.repeat(64),file));assert.throws(()=>verifyNativePack(root,sha(bytes),import.meta.filename));await writeFile(file,'changed');assert.throws(()=>verifyNativePack(root,sha(bytes),file));
  assert.equal(guardReads,2);
 }finally{await rm(root,{recursive:true});}
});
