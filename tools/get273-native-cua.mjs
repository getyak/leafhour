// Actual native-only GET-273 entry. Import is inert; runtime requires the frozen
// file path plus genuine dev-ios-session ownership. No mirror/addon/exec RPC.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,existsSync,realpathSync,statfsSync} from 'node:fs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createNativeSession} from './get273-native-cua-control.mjs';
import {createSafariFixture} from './get273-safari-fixture.mjs';
const UDID='02B4F0C1-A92F-469D-9DCC-5ED13F119507',SOURCE='d302393d4ed01a82af6828d7200969be3b8addc9';
const GUARD='/Users/cubxxw/.local/bin/dev-ios-session',sha=x=>createHash('sha256').update(x).digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
export function parseNativeCommand(line){
 assert(typeof line==='string'&&Buffer.byteLength(line)<=8192);const p=JSON.parse(line);
 const keys={status:[],admit:['action','payload'],'method-ok':['result'],closed:['result'],observed:['result'],'observation-error':['id'],'input-error':['id'],view:['value'],entry:[],ready:[],restore:[],restored:[],closeout:[],observe:[]};
 assert(p&&Object.hasOwn(keys,p.op)&&exact(p,['op',...keys[p.op]])&&keys[p.op].every(k=>Object.hasOwn(p,k)));return p;
}
export async function dispatchNativeCommand(session,p){
 if(p.op==='status')return session.status();
 if(p.op==='admit')return session.admit(p.action,p.payload);
 if(p.op==='method-ok')return session.methodOK(p.result);
 if(p.op==='closed')return session.closed(p.result);
 if(p.op==='observed')return session.observed(p.result);
 if(p.op==='observation-error')return session.observationError({id:p.id});
 if(p.op==='input-error')return session.inputError({id:p.id});
 if(p.op==='view')return session.view(p.value);
 if(p.op==='closeout')return session.finish();
 assert(['entry','ready','restore','restored','observe'].includes(p.op));return session[p.op]();
}
export async function nativeContextProof(root,kind,notBefore){
 assert(['entry','restored'].includes(kind));root=await realpath(root);const relative='screenshots/'+(kind==='entry'?'entry-blank.png':'restored-blank.png'),file=join(root,relative),s=await lstat(file);
 assert(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&s.size>=16&&s.size<=15*1024*1024&&s.mtimeMs>=notBefore&&await realpath(file)===file);
 const bytes=await readFile(file);assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 return {kind,file:relative,sha256:sha(bytes),semanticProof:'operator-owned-private-blank; verify actual CUA transcript and PNG'};
}
export function analyzeNativeTrace(report){
 const docs=new Set(report.events.filter(e=>e.kind==='observer-ready'&&e.seq===0).map(e=>e.documentId));
 const selections=report.events.filter(e=>docs.has(e.documentId)&&e.kind==='selection'&&!e.collapsed&&e.parts?.length===1&&e.parts[0].passageId==='fixture-p0'&&e.parts[0].layer==='original').sort((a,b)=>a.seq-b.seq);
 const first=selections[0]??null,word=first?.parts[0].start===7&&first.parts[0].end===12;
 const later=word&&report.events.some(e=>e.documentId===first.documentId&&e.seq>first.seq&&e.kind==='app-selection'&&e.parts?.length===1&&e.parts[0].passageId==='fixture-p0'&&e.parts[0].layer==='original'&&e.parts[0].start===0&&e.parts[0].end===20);
 return {firstRawTargetWord:word,laterAppSentence:Boolean(later),firstRawRange:first?{documentId:first.documentId,seq:first.seq,start:first.parts[0].start,end:first.parts[0].end}:null,
  nativeAcceptance:'unrun',osReleaseVerified:false,limitations:['Passive trace is not OS attestation.','Combine the real CUA click result and actual handles/Copy screenshot.','A sentence selected initially does not prove application expansion.']};
}
export function verifyNativePack(root,expected,self=fileURLToPath(import.meta.url)){
 const bytes=readFileSync(join(root,'execution-freeze.json'));assert.equal(sha(bytes),expected);const f=JSON.parse(bytes);
 assert.equal(f.kind,'GET-273-native-CUA-single-hold');assert.equal(f.sourceCommit,SOURCE);assert.equal(f.nodeVersion,process.version);
 assert.equal(realpathSync(self),join(root,'tools/get273-native-cua.mjs'));
 for(const [relative,hash]of Object.entries(f.files)){
  assert(/^(?:tools|tests|docs|app|server|build)\/[A-Za-z0-9_./-]+$/.test(relative)&&!relative.split('/').includes('..'));const file=realpathSync(join(root,relative));assert(file.startsWith(root+sep));assert.equal(sha(readFileSync(file)),hash);
 }
 assert.equal(sha(readFileSync(GUARD)),f.externalToolHashes['dev-ios-session']);return f;
}
let admitted=null;
async function main(){
 assert.equal(process.argv.length,6);assert.equal(process.argv[2],'--artifact');assert.equal(process.argv[4],'--freeze-sha');assert(/^[a-f0-9]{64}$/.test(process.argv[5]));
 const root=realpathSync(process.argv[3]),expected=process.argv[5];verifyNativePack(root,expected);
 assert.equal(process.env.DEV_IOS_PROFILE,'primary');assert(['true','false'].includes(process.env.DEV_IOS_BORROWED));
 assert.equal(process.env.SIMULATOR_UDID,UDID);assert.equal(process.env.IOS_SIMULATOR_ID,UDID);
 assert.equal(process.env.IOS_AUTOMATION_LOCK_FILE,'/tmp/ios-automation.xcodebuild.lock');assert(!process.env.DEV_IOS_ALLOWLIST);
 assert(!existsSync(join(root,'native-journal-0001.json'))&&!existsSync(join(root,'native-stopped.json')));
 const exec=promisify(execFile),startAt=Date.now();let restoreAt=Infinity,journalSeq=0,holdTimer=null,deadline=null;
 const owner=async()=>{
  verifyNativePack(root,expected);const {stdout}=await exec(GUARD,['is-owner','--profile','primary','--udid',UDID],{encoding:'utf8',timeout:1500,maxBuffer:512});assert.equal(stdout.trim(),'true');
 };
 const admission=async()=>{assert(!existsSync('/Users/cubxxw/.agent-pause'));const d=statfsSync('/System/Volumes/Data');assert(d.bavail*d.bsize>=10*1024**3);};
 const sim=async(args,timeout=10000)=>{await owner();return exec('/usr/bin/xcrun',['simctl',...args],{encoding:'utf8',timeout,maxBuffer:1024*1024});};
 const state=async()=>{
  const {stdout}=await sim(['list','devices','--json']);const all=Object.values(JSON.parse(stdout).devices??{}).flat(),d=all.find(x=>x.udid===UDID);
  assert(d&&['Booted','Shutdown'].includes(d.state));assert(all.every(x=>x.udid===UDID||x.state==='Shutdown'));return d.state;
 };
 let fixture;
 const session=createNativeSession({entryExpected:process.env.DEV_IOS_BORROWED==='true'?'Booted':'Shutdown',assertOwner:owner,assertAdmission:admission,
  device:{state,boot:async()=>{await sim(['boot',UDID],30000);await sim(['bootstatus',UDID,'-b'],60000);},shutdown:async()=>{await sim(['shutdown',UDID],30000);}},
  createFixture:async()=>fixture=await createSafariFixture({buildRoot:join(root,'build'),template:readFileSync(join(root,'build/read-template.html'),'utf8'),sourceCommit:SOURCE}),
  contextProof:kind=>nativeContextProof(root,kind,kind==='entry'?startAt:restoreAt),
  persist:value=>{
   const bytes=JSON.stringify({at:new Date().toISOString(),pid:process.pid,udid:UDID,...value})+'\n';
   writeFileSync(join(root,'native-journal-'+String(++journalSeq).padStart(4,'0')+'.json'),bytes,{flag:'wx',mode:0o600});
   if(value.kind==='fixture-observations')writeFileSync(join(root,'native-observations.json'),JSON.stringify({report:value.report,analysis:analyzeNativeTrace(value.report)})+'\n',{flag:'wx',mode:0o600});
   if(['blocked','stopped'].includes(value.kind)&&!existsSync(join(root,'native-'+value.kind+'.json')))writeFileSync(join(root,'native-'+value.kind+'.json'),bytes,{flag:'wx',mode:0o600});
  },
  hold:value=>{
   if(value&&holdTimer===null)holdTimer=setInterval(()=>{},60000);
   if(!value){clearInterval(holdTimer);clearTimeout(deadline);holdTimer=null;process.stdin.pause();}
  },
 });admitted=session;
 const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{session.block('signal-hold-no-automatic-release');});
 for(const stream of [process.stdin,process.stdout])stream.on('error',()=>session.block('stdio-failure'));
 print(await session.start());if(session.status().phase==='blocked')return;
 deadline=setTimeout(()=>{void session.expire();},600000);
 let input='',working=false;process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{
  input+=chunk;if(working||Buffer.byteLength(input)>8192){input='';session.block('concurrent-or-oversize-command');return;}
  const end=input.indexOf('\n');if(end<0)return;const line=input.slice(0,end);input=input.slice(end+1);if(input.trim()){input='';session.block('queued-command');return;}input='';working=true;
  void(async()=>{try{
   const p=parseNativeCommand(line);if(p.op==='restore')restoreAt=Date.now();
   const value=await dispatchNativeCommand(session,p);
   print(value);if(session.status().phase==='stopped')process.exit(0);
  }catch{session.block('command-failed');}finally{working=false;}})();
 });process.stdin.on('end',()=>session.block('stdin-closed-hold'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
 if(admitted)admitted.block('entry-failure-after-admission');else{process.stderr.write('GET-273 native entry rejected before admission.\n');process.exitCode=64;}
});
