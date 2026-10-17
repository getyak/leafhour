import {randomUUID} from 'node:crypto';
import {digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
export const UPLOAD_PART_BYTES=2*1024*1024;
export function createIngestionUpload({store,ingestion}){
 const root=u=>{if(!u?.id)throw fail('请先进入自己的书房',401);return 'pdf-upload/'+digest(u.id)+'/';};
 const key=(u,id)=>{if(typeof id!=='string'||!/^[-a-z0-9]{36}$/.test(id))throw fail('找不到上传任务',404);return root(u)+id;};
 async function start(user,input){
  root(user);if(typeof input.filename!=='string'||!/^.+\.pdf$/i.test(input.filename)||input.filename.length>240||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>MAX_FILE_BYTES||!/^[a-f0-9]{64}$/.test(input.sha256))throw fail('请选择 256 MB 内的 PDF');
  const sourceJob=await ingestion.findSource?.(user,input.sha256);if(sourceJob)return {job:sourceJob,duplicate:true};
  if(input.mode!=='auto'&&input.consent!==true)throw fail('请允许 PaddleOCR 官方服务识别本书',403);
  const fingerprint=root(user)+'source-'+input.sha256,existing=await store.read(fingerprint,null);if(existing){const previous=await store.read(key(user,existing.id),null);if(previous&&previous.expiresAt>Date.now()){
   if(previous.ingestionId&&(await ingestion.view(user,previous.ingestionId)).state==='cancelled')await store.mutate(key(user,previous.id),null,row=>{if(row.ingestionId===previous.ingestionId){delete row.ingestionId;row.mode=input.mode==='auto'?'auto':'ocr';row.consent=input.consent===true;row.filename=input.filename;}});
   return {id:previous.id,partBytes:UPLOAD_PART_BYTES,count:previous.count,received:Object.keys(previous.parts).map(Number)};
  }}
  const now=Date.now();await store.mutate(root(user)+'limits',{times:[]},r=>{r.times=r.times.filter(t=>now-t<86400000);if(r.times.length>=20||r.times.filter(t=>now-t<3600000).length>=6)throw fail('这段时间上传较多，请稍后再试',429);r.times.push(now);});
  const id=randomUUID(),count=Math.ceil(input.bytes/UPLOAD_PART_BYTES);await store.mutate(key(user,id),{},j=>Object.assign(j,{id,filename:input.filename,bytes:input.bytes,sha256:input.sha256,count,parts:{},mode:input.mode==='auto'?'auto':'ocr',consent:input.consent===true,expiresAt:Date.now()+86400000}));await store.mutate(fingerprint,{},r=>{r.id=id;});return {id,partBytes:UPLOAD_PART_BYTES,count,received:[]};
 }
 const load=async(u,id)=>{const row=await store.read(key(u,id),null);if(!row||row.expiresAt<Date.now())throw fail('上传任务不存在或已过期',404);return row;};
 async function part(user,id,input){const row=await load(user,id),index=input.index;if(!Number.isSafeInteger(index)||index<0||index>=row.count||typeof input.base64!=='string'||input.base64.length>Math.ceil(UPLOAD_PART_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw fail('上传分块格式无效');const bytes=Buffer.from(input.base64,'base64'),expected=Math.min(UPLOAD_PART_BYTES,row.bytes-index*UPLOAD_PART_BYTES);if(bytes.length!==expected)throw fail('上传分块大小不完整',422);const hash=digest(bytes),target=key(user,id)+'/part-'+index+'-'+hash;await store.putBlob(target,bytes);await store.mutate(key(user,id),null,j=>{if(j.parts[index]&&j.parts[index].sha256!==hash)throw fail('上传分块冲突，原文件未覆盖',409);j.parts[index]={sha256:hash,target,size:bytes.length};});return {accepted:true,index};}
 async function complete(user,id){const row=await load(user,id);if(row.ingestionId)return ingestion.view(user,row.ingestionId);const refs=[];for(let i=0;i<row.count;i++){if(!row.parts[i])throw fail('原文件尚未上传完整',422);refs.push({...row.parts[i],size:Math.min(UPLOAD_PART_BYTES,row.bytes-i*UPLOAD_PART_BYTES)});}const parts=[];for(let i=0;i<refs.length;i+=6)parts.push(...await Promise.all(refs.slice(i,i+6).map(async p=>{const b=await store.blob(p.target);if(digest(b)!==p.sha256)throw fail('上传分块校验失败',422);return b;})));const bytes=Buffer.concat(parts);if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw fail('原文件校验失败',422);const job=await ingestion.prepare(user,{filename:row.filename,bytes,consent:row.consent,mode:row.mode,sourceParts:refs});await store.mutate(key(user,id),null,j=>{j.ingestionId=job.id;});return job;}
 return {start,part,complete};
}
