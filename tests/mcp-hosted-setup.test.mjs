import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPortal} from '../server/portal.mjs';

test('hosted setup returns only authenticated current deployment provenance and fails closed without it',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mcp-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const [index,sourceCommit]of ['b'.repeat(40),undefined,'main'].entries()){
  const portal=await createPortal({dataDir:path.join(dir,String(index)),catalogDir:null,publicOrigin:'https://reader.example.invalid',hostedMcp:true,allowLocal:false,authService:{userFor:async token=>token==='synthetic-cookie'?{id:'setup-owner',email:'setup@example.invalid'}:null},translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{VERCEL_GIT_COMMIT_SHA:sourceCommit}});
  const call=async(cookie,owner='setup-owner')=>{let result;try{await portal.handle({req:{method:'GET',headers:{cookie:cookie?'marginalia_session='+cookie:'',...(cookie?{'x-reader-owner':owner}:{})},socket:{localAddress:'127.0.0.1'}},res:{setHeader(){}},url:new URL('https://reader.example.invalid/api/library/mcp-setup'),send:(status,data)=>{result={status,data};}});}catch(error){result={status:error.status,message:error.message};}return result;};
  try{assert.equal((await call(null)).status,401);assert.equal((await call('synthetic-cookie','other')).status,409);const r=await call('synthetic-cookie');if(index===0)assert.deepEqual(r,{status:200,data:{hosted:true,serviceUrl:'https://reader.example.invalid',sourceCommit}});else assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes('synthetic-cookie'));}
  finally{await portal.chat.close();}
 }
});
