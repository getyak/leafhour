import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {audioHash,audioError} from './audio-content.mjs';
export const emptyAudio=()=>({kind:'marginalia-audio',schemaVersion:1,sessions:[],dialogues:[],preferences:null});
export async function createAudioStore({dataDir,dataStore=null}){
 const durable=!!dataStore;
 if(durable&&['read','mutate','putBlob','blob'].some(k=>typeof dataStore[k]!=='function'))throw audioError('云端声音存储尚未配置。',503,'storage_unavailable');
 if(!durable)await mkdir(dataDir,{recursive:true,mode:0o700});
 const queues=new Map(),filename=(owner,book)=>durable?'audio/documents/'+audioHash([owner,book]):path.join(dataDir,audioHash([owner,book])+'.json');
 const read=async(owner,book)=>{if(durable)return dataStore.read(filename(owner,book),emptyAudio());try{return JSON.parse(await readFile(filename(owner,book),'utf8'));}catch(e){if(e.code==='ENOENT')return emptyAudio();throw e;}};
 const mutate=async(owner,book,operation)=>{
  if(durable)return structuredClone(await dataStore.mutate(filename(owner,book),emptyAudio(),operation));
  const file=filename(owner,book),prior=queues.get(file)||Promise.resolve(),work=prior.catch(()=>{}).then(async()=>{const data=await read(owner,book),result=await operation(data),temp=file+'.'+randomUUID()+'.pending';await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,file);return structuredClone(result);});queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
 };
 const clipPath=key=>{if(!/^[a-f0-9]{64}$/.test(key))throw audioError('声音标识无效。');return durable?'audio/clips/'+key:path.join(dataDir,key+'.audio');};
 // One shared CAS row makes global and per-owner budgets atomic across instances.
 async function reserveGeneration(owner,requestId,{guideJobId}={}){
  if(!durable)return null;
  if(typeof owner!=='string'||!owner||typeof requestId!=='string'||!requestId)throw audioError('声音额度无法核验。',503,'quota_unavailable');
  const now=Date.now(),ownerHash=audioHash(owner);
  try{if(guideJobId)return await dataStore.mutate('audio/limits/guides',{reservations:[]},data=>{const row=(data.reservations||[]).find(r=>r.owner===ownerHash&&r.id===guideJobId&&now-r.time<86400000);if(!row)throw audioError('导听额度尚未预留或已经过期。',503,'quota_unavailable');if(row.stages.includes(requestId))throw audioError('这次生成已提交，请明确重新发起。',409,'already_submitted');if(row.stages.length>=row.calls)throw audioError('导听预留额度已用完。',429,'rate_limited');row.stages.push(requestId);return {id:requestId};});return await dataStore.mutate('audio/limits/generation',{requests:[]},data=>{
   data.requests=(data.requests||[]).filter(r=>now-r.time<86400000);
   if(data.requests.some(r=>r.id===requestId))throw audioError('这次生成已提交，请重新发起。',409,'already_submitted');
   const hour=data.requests.filter(r=>now-r.time<3600000),user=data.requests.filter(r=>r.owner===ownerHash);
   if(data.requests.length>=500||hour.length>=100||user.length>=100||hour.filter(r=>r.owner===ownerHash).length>=20)throw audioError('声音生成已达到这段时间的额度，请稍后再试。',429,'rate_limited');
   data.requests.push({owner:ownerHash,id:requestId,time:now});return {id:requestId};
  });}catch(error){if(error.status)throw error;throw audioError('声音额度暂时无法核验，请稍后重试。',503,'quota_unavailable');}
 }
 async function reserveGuideBudget(owner,jobId,calls){
  if(!durable)return null;
  if(typeof owner!=='string'||!owner||typeof jobId!=='string'||!jobId||!Number.isSafeInteger(calls)||calls<1||calls>100)throw audioError('这次导听的生成范围超过额度，请缩小范围。',413,'scope_too_large');
  const now=Date.now(),ownerHash=audioHash(owner);
  try{return await dataStore.mutate('audio/limits/guides',{reservations:[]},data=>{data.reservations=(data.reservations||[]).filter(r=>now-r.time<86400000);const prior=data.reservations.find(r=>r.id===jobId&&r.owner===ownerHash);if(prior){if(prior.calls!==calls)throw audioError('导听额度不能用于其他范围。',409,'quota_conflict');return {id:jobId,calls:prior.calls};}const user=data.reservations.filter(r=>r.owner===ownerHash),sum=rows=>rows.reduce((n,r)=>n+r.calls,0);if(sum(data.reservations)+calls>200||sum(user)+calls>100||sum(user.filter(r=>now-r.time<3600000))+calls>100)throw audioError('今天的导听生成额度不足，请缩小范围或稍后再试。',429,'rate_limited');data.reservations.push({id:jobId,owner:ownerHash,calls,time:now,stages:[]});return {id:jobId,calls};});}catch(error){if(error.status)throw error;throw audioError('导听额度暂时无法核验，请稍后重试。',503,'quota_unavailable');}
 }
 return {durable,read,mutate,reserveGeneration,reserveGuideBudget,async putClip(key,bytes){const file=clipPath(key);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>4000000)throw audioError('声音格式无效。');if(durable)return dataStore.putBlob(file,bytes);const tmp=file+'.'+randomUUID()+'.pending';await writeFile(tmp,bytes,{mode:0o600});await rename(tmp,file);},async getClip(key){try{return durable?await dataStore.blob(clipPath(key)):await readFile(clipPath(key));}catch(e){if(e.code==='ENOENT'||e.status===404)throw audioError('声音文件尚未准备好。',404);throw e;}}};
}
