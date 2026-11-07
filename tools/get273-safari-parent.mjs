// Actual GET-273 parent entrypoint, prepared offline. Imports do not operate UI,
// load native code, acquire a lease, start a server or spawn a child.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,existsSync,realpathSync,statSync,statfsSync} from 'node:fs';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSafariFixture} from './get273-safari-fixture.mjs';
import {createSafariParent,installSafariParentSignals} from './get273-safari-parent-control.mjs';

const UDID='02B4F0C1-A92F-469D-9DCC-5ED13F119507';
const SOURCE='d302393d4ed01a82af6828d7200969be3b8addc9';
const GUARD='/Users/cubxxw/.local/bin/dev-ios-session';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let admittedParent=null;
export function parseParentCommand(line){
  if(typeof line!=='string'||Buffer.byteLength(line)>1024)throw Error('Command');
  const p=JSON.parse(line);if(!p||Array.isArray(p)||Object.keys(p).length!==1||typeof p.op!=='string'||
    !['status','open-owned-context','finish-owned-context','abort'].includes(p.op))throw Error('Command');return p.op;
}
export function inheritedMirrorEnvironment(env){
  const keys=['PATH','HOME','TMPDIR','LANG','LC_ALL','DEV_IOS_PROFILE','DEV_IOS_REASON','DEV_IOS_SESSION_PID','DEV_IOS_SESSION_ID','DEV_IOS_BORROWED',
    'IOS_AUTOMATION_LOCK_HELD','IOS_AUTOMATION_LOCK_FILE','IOS_SIMULATOR_ID','SIMULATOR_UDID'];
  return {...Object.fromEntries(keys.filter(key=>Object.hasOwn(env,key)).map(key=>[key,env[key]])),SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD:'1'};
}
export function ownedMirrorChild(child,{waitMs=12000}={}){
  let exit=null,transportUncertain=false;
  const done=new Promise(resolve=>{
    child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);});
    // Error can describe a failed signal/transport while the process is alive.
    // Only the OS exit event establishes exit; keep handling repeated errors.
    child.on('error',()=>{transportUncertain=true;});
  });
  return {pid:child.pid,status:()=>exit??(transportUncertain?{uncertain:true}:null),
    signalTerm:()=>{if(!exit)child.kill('SIGTERM');},
    waitExit:async()=>{if(exit)return exit;let timer;try{return await Promise.race([done,new Promise(resolve=>{timer=setTimeout(()=>resolve({pending:true}),waitMs);})]);}finally{clearTimeout(timer);}},
  };
}
export async function contextProof(root,kind,notBefore){
  if(!['entry','restored'].includes(kind))throw Error('Context proof');
  root=await realpath(root);
  const file=join(root,'screenshots',kind==='entry'?'entry-blank.png':'restored-blank.png');
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size<16||info.size>15*1024*1024||info.mtimeMs<notBefore||info.uid!==process.getuid())throw Error('Context proof');
  if(await realpath(file)!==file)throw Error('Context proof');
  const bytes=await readFile(file);if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Context proof');
  // This hashes a fixed task-owned screenshot, not its semantic/OS contents.
  // The fixed stdin operation is an explicit operator attestation, audited with CUA.
  return {kind,file:'screenshots/'+(kind==='entry'?'entry-blank.png':'restored-blank.png'),sha256:sha(bytes),attestation:'operator-owned-private-blank'};
}
async function main(){
  assert.equal(process.argv.length,6);assert.equal(process.argv[2],'--artifact');assert.equal(process.argv[4],'--freeze-sha');assert(/^[a-f0-9]{64}$/.test(process.argv[5]));
  const root=realpathSync(process.argv[3]),freezeBytes=readFileSync(join(root,'execution-freeze.json'));assert.equal(sha(freezeBytes),process.argv[5]);
  const freeze=JSON.parse(freezeBytes);assert.equal(process.version,freeze.nodeVersion);
  assert.equal(freeze.sourceCommit,SOURCE);assert.equal(freeze.kind,'GET-273-Safari-parent-execution');
  assert.equal(realpathSync(fileURLToPath(import.meta.url)),join(root,'frozen-inputs/get273-safari-parent.mjs'));
  for(const [relative,expected]of Object.entries(freeze.files)){
    assert(/^(?:frozen-inputs|app|server|native|build)\/[A-Za-z0-9_./-]+$/.test(relative)&&!relative.split('/').includes('..'));
    const file=realpathSync(join(root,relative));assert(file.startsWith(root+sep));assert.equal(sha(readFileSync(file)),expected);
  }
  assert.equal(sha(readFileSync(GUARD)),freeze.externalToolHashes['dev-ios-session']);
  assert(['true','false'].includes(process.env.DEV_IOS_BORROWED));assert.equal(process.env.DEV_IOS_PROFILE,'primary');
  assert.equal(process.env.SIMULATOR_UDID,UDID);assert.equal(process.env.IOS_SIMULATOR_ID,UDID);
  // No state or device query until the genuine inherited owner check succeeds.
  const exec=promisify(execFile);
  const owner=async()=>{
    assert(!existsSync('/Users/cubxxw/.agent-pause'));
    const disk=statfsSync('/System/Volumes/Data');assert(disk.bavail*disk.bsize>=10*1024**3);
    const {stdout}=await exec(GUARD,['is-owner','--profile','primary','--udid',UDID],{encoding:'utf8',timeout:1000,maxBuffer:512});assert.equal(stdout.trim(),'true');
  };
  const sim=async(args,timeout=10000)=>{await owner();return exec('/usr/bin/xcrun',['simctl',...args],{encoding:'utf8',timeout,maxBuffer:1024*1024});};
  const device={
    state:async()=>{const {stdout}=await sim(['list','devices','--json']);const all=JSON.parse(stdout);const selected=Object.values(all.devices??{}).flat().find(d=>d.udid===UDID);assert(selected&&['Booted','Shutdown'].includes(selected.state));return selected.state;},
    boot:async()=>{await sim(['boot',UDID],30000);await sim(['bootstatus',UDID,'-b'],60000);},
    shutdown:async()=>{await sim(['shutdown',UDID],30000);},
  };
  const startedAt=Date.now();let restoreNotBefore=Infinity,holdTimer=null,monitor=null,deadline=null,child=null;
  for(const name of ['parent-awaiting-context.json','parent-ready.json','parent-stopped.json','parent-blocked.json','mirror-ready.json','mirror-stopped.json','mirror-blocked.json'])assert(!existsSync(join(root,name)));
  function readReceipt(kind){
    const file=join(root,'mirror-'+kind+'.json');if(!existsSync(file))return null;
    const info=statSync(file);assert(info.isFile()&&info.size<65536&&info.mtimeMs>=startedAt&&realpathSync(file)===file&&info.uid===process.getuid());
    const value=JSON.parse(readFileSync(file,'utf8'));assert(value&&typeof value==='object'&&!Array.isArray(value));return value;
  }
  let parent;
  parent=createSafariParent({entryExpected:process.env.DEV_IOS_BORROWED==='true'?'Booted':'Shutdown',assertOwner:owner,device,
    createFixture:()=>createSafariFixture({buildRoot:join(root,'build'),template:readFileSync(join(root,'build/read-template.html'),'utf8'),sourceCommit:SOURCE}),
    spawnMirror:()=>{
      assert(!child);child=ownedMirrorChild(spawn(process.execPath,[join(root,'frozen-inputs/get273-mirror-adapter.mjs'),'--artifact',root],{
        cwd:root,env:inheritedMirrorEnvironment(process.env),stdio:'ignore',detached:false,
      }));return child;
    },
    waitReady:async handle=>{
      const until=Date.now()+15000;
      while(Date.now()<until){
        if(handle.status()||readReceipt('blocked'))throw Error('Mirror failed');
        const ready=readReceipt('ready');if(ready)return ready;
        await new Promise(resolve=>setTimeout(resolve,100));
      }throw Error('Mirror readiness unconfirmed');
    },readMirrorReceipt:readReceipt,
    contextEvidence:kind=>contextProof(root,kind,kind==='entry'?startedAt:restoreNotBefore),
    writeReceipt:(kind,value)=>{
      assert(['awaiting-context','ready','blocked','stopped','fixture-observations'].includes(kind));
      if(kind==='ready'||kind==='awaiting-context')restoreNotBefore=Date.now();
      writeFileSync(join(root,'parent-'+kind+'.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...value})+'\n',{flag:'wx',mode:0o600});
    },
    hold:value=>{
      if(value&&holdTimer===null)holdTimer=setInterval(()=>{},60000);
      if(!value){clearInterval(holdTimer);holdTimer=null;clearInterval(monitor);clearTimeout(deadline);process.stdin.pause();}
    },
  });
  installSafariParentSignals(parent);
  admittedParent=parent;
  process.stdout.on('error',()=>{parent.childFault();});
  process.stdin.on('error',()=>{parent.childFault();});
  const print=value=>console.log(JSON.stringify(value));
  const initial=await parent.start();print(initial);
  if(initial.phase==='stopped'){process.exitCode=1;return;}
  monitor=setInterval(()=>{if(['ready','awaiting-context'].includes(parent.status().phase)){
    void owner().then(()=>{
      if(!['ready','awaiting-context'].includes(parent.status().phase))return;
      if(child&&(child.status()||readReceipt('blocked')))parent.childFault();
    }).catch(()=>{if(['ready','awaiting-context'].includes(parent.status().phase))parent.childFault();});
  }},5000);
  deadline=setTimeout(()=>{void parent.stop('window-ended');},40*60*1000);
  let input='',working=false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    input+=chunk;if(Buffer.byteLength(input)>1024||working){input='';parent.childFault();return;}
    const end=input.indexOf('\n');if(end<0)return;
    const line=input.slice(0,end);input=input.slice(end+1);if(input.trim()){input='';parent.childFault();return;}input='';
    working=true;
    void(async()=>{
      try{
        const op=parseParentCommand(line);
        if(op==='open-owned-context')print(await parent.openMirror());
        else if(op==='finish-owned-context'){
          await parent.confirmRestored();print(await parent.stop());
        }else if(op==='abort')print(await parent.stop('operator-abort'));
        else print(parent.status());
      }catch{print(parent.childFault());}
      finally{working=false;}
    })();
  });
  process.stdin.on('end',()=>{void parent.stop('stdin-closed');});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{if(admittedParent)admittedParent.childFault();else{console.error('GET-273 parent rejected before admission.');process.exitCode=64;}});
}
