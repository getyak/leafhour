#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {DailyHostError,readPrivateHostJson,validateHostOrigin,callDailyMcp} from './lib/daily-reading-host.mjs';
const bad=()=>new DailyHostError('host-config','每日陪读命令或私有配置不正确，请重新连接。');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=160)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const prose=(value,max)=>typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
export async function runDailyHost(argv,{read=readPrivateHostJson,call=callDailyMcp}={}){
 let configFile,inputFile,eventId,command;const seen=new Set();
 for(let i=0;i<argv.length;i++){
  const value=argv[i];
  if(['--config','--input','--event'].includes(value)){
   const next=argv[i+1];if(seen.has(value)||typeof next!=='string'||!next||next.startsWith('--'))throw bad();seen.add(value);i++;
   if(value==='--config')configFile=next;else if(value==='--input')inputFile=next;else eventId=next;
  }
  else if(['connect','claim','finish'].includes(value)&&!command)command=value;
  else throw bad();
 }
 if(!configFile||!command||(command==='finish'?!inputFile||eventId:!!inputFile)||(command!=='claim'&&eventId))throw bad();
 const config=await read(configFile);
 if(!object(config)||config.version!==1||!keys(config,['version','serviceUrl','token','hostInstallId','hostLabel','schedulerId'])||!text(config.hostInstallId)||!text(config.hostLabel,80)||typeof config.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(config.token))throw bad();
 validateHostOrigin(config.serviceUrl);
 let args={hostInstallId:config.hostInstallId};
 if(command==='connect'){if(!text(config.schedulerId,200))throw bad();args={...args,hostLabel:config.hostLabel,schedulerId:config.schedulerId};}
 if(command==='claim'&&eventId){if(!text(eventId,240))throw bad();args.eventId=eventId;}
 if(command==='finish'){
  const input=await read(inputFile);
  if(!object(input)||!keys(input,['eventId','claimNonce','kind','message','quote'])||!text(input.eventId,240)||!text(input.claimNonce)||input.claimNonce.length<16||!['message','silence','failed'].includes(input.kind))throw bad();
  if(input.kind==='message'){
   if(!prose(input.message,600)||!prose(input.quote,240))throw bad();
  }else if(input.message!==undefined||input.quote!==undefined)throw bad();
  args={...args,...input};
 }
 return call({config,toolName:'reader_daily_'+command,args});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length===3&&process.argv[2]==='--help')process.stdout.write('使用：node tools/daily-reading-host.mjs --config /absolute/private.json connect|claim [--event TEST_ID]|finish --input /absolute/private-result.json\n');
 else try{const result=await runDailyHost(process.argv.slice(2));process.stdout.write(JSON.stringify(result)+'\n');}catch(error){const safe=error instanceof DailyHostError?error:bad();process.stderr.write(safe.code+': '+safe.message+'\n');process.exitCode=1;}
}
