import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,mkdir,utimes,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseNativeCommand,nativeContextProof,analyzeNativeTrace,dispatchNativeCommand} from '../tools/get273-native-cua.mjs';

test('actual entry refuses missing arguments before runtime admission',()=>{const r=spawnSync(process.execPath,['tools/get273-native-cua.mjs'],{encoding:'utf8'});assert.equal(r.status,64);assert.equal(r.stdout,'');});
test('fixed command parser rejects generic exec, extra fields, oversize and array payloads',()=>{
 for(const x of ['{"op":"exec","command":"anything"}','{"op":"status","url":"https://example.com"}','[]','x'.repeat(8193)])assert.throws(()=>parseNativeCommand(x));
 assert.deepEqual(parseNativeCommand('{"op":"admit","action":"hold","payload":{"point":[1,2]}}'),{op:'admit',action:'hold',payload:{point:[1,2]}});
});
test('fresh exact screenshot proof rejects stale bytes and symlink replacements',async()=>{
 const root=await mkdtemp(join(tmpdir(),'get273-png-'));try{
  await mkdir(join(root,'screenshots'));const file=join(root,'screenshots/entry-blank.png'),bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(20)]);
  await writeFile(file,bytes);const p=await nativeContextProof(root,'entry',Date.now()-10000);assert.equal(p.file,'screenshots/entry-blank.png');assert.equal(p.semanticProof,'operator-owned-private-blank; verify actual CUA transcript and PNG');
  await utimes(file,new Date(0),new Date(0));await assert.rejects(nativeContextProof(root,'entry',Date.now()-1000));await rm(file);await writeFile(join(root,'copy.png'),bytes);await symlink(join(root,'copy.png'),file);await assert.rejects(nativeContextProof(root,'entry',0));
 }finally{await rm(root,{recursive:true});}
});
test('raw first range and app expansion are distinct; full sentence first is not credited to app',()=>{
 const part=(start,end)=>({passageId:'fixture-p0',layer:'original',start,end});
 const report={events:[{kind:'observer-ready',documentId:'d',seq:0},{kind:'selection',documentId:'d',seq:4,collapsed:false,parts:[part(7,12)]},{kind:'app-selection',documentId:'d',seq:5,collapsed:false,parts:[part(0,20)]}],violations:[]};
 const p=analyzeNativeTrace(report);assert.equal(p.firstRawTargetWord,true);assert.equal(p.laterAppSentence,true);assert.equal(p.nativeAcceptance,'unrun');
 report.events[1].parts=[part(0,20)];const q=analyzeNativeTrace(report);assert.equal(q.firstRawTargetWord,false);assert.equal(q.laterAppSentence,false);
});
test('actual frozen CUA receipts complete actual controller closeout without handwritten ACK fields',async()=>{
 const {default:vm}=await import('node:vm'),{readFileSync}=await import('node:fs'),{createNativeSession}=await import('../tools/get273-native-cua-control.mjs');
 const ctx=vm.createContext({URL,Uint8Array,cua:{getApp:async()=>({getAXStateAndScreenshot:async()=>({state:'iPhone 17 Pro',screenshot:new Uint8Array([1])})})},nodeRepl:{write:async()=>{},emitImage:async()=>{}}});
 vm.runInContext(readFileSync(new URL('../tools/get273-native-cua-route.js',import.meta.url),'utf8'),ctx);
 const s=createNativeSession({entryExpected:'Booted',assertOwner:async()=>{},assertAdmission:async()=>{},device:{state:async()=> 'Booted'},createFixture:async()=>({listen:async()=> 'http://127.0.0.1:64200',report:()=>({events:[],violations:[]}),close:async()=>{}}),contextProof:async()=>({}),persist:()=>{},hold:()=>{}});
 await s.start();const route=ctx.get273NativeRoute;
 async function see(t){const r=await route.observe(t);await s.observed(r);await s.view({id:r.id,primaryWindow:true,desktopFocus:true,view:'owned-private-blank',privateContext:true,targetVisible:false});}
 const b=await s.admit('bind');await see(await s.methodOK(await route.method(b)));await s.entry();await s.restore();await see(await s.observe());await s.restored();
 const c=await dispatchNativeCommand(s,parseNativeCommand(JSON.stringify({op:'admit',action:'close',payload:{}})));
 await dispatchNativeCommand(s,parseNativeCommand(JSON.stringify({op:'closed',result:await route.method(c)})));
 await dispatchNativeCommand(s,parseNativeCommand('{"op":"closeout"}'));assert.equal(s.status().phase,'stopped');
});
