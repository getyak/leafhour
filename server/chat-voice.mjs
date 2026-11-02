import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const PART_BYTES=2*1024*1024,MAX_BYTES=256*1024*1024;
const fields=['id','mimeType','bytes','sha256','durationMs'];

/** Original recordings are private assets; transcripts remain ordinary chat text. */
export function createChatVoice({store}){
 const root=user=>{if(!user?.id||user.is_anonymous)throw fail('请先进入自己的书房',401);return 'chat-voice/'+hash(user.id)+'/';};
 const key=(user,id)=>{const base=root(user);if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw fail('找不到这条语音',404);return base+id.toLowerCase();};
 const receipt=row=>Object.fromEntries(fields.map(field=>[field,row[field]]));
 const load=async(user,id)=>{const row=await store.read(key(user,id),null);if(!row)throw fail('找不到这条语音',404);return row;};
 async function start(user,id,input){
  const target=key(user,id);
  if(!Number.isSafeInteger(input?.bytes)||input.bytes<8||input.bytes>MAX_BYTES||!validHash(input.sha256)||!['audio/x-caf','audio/mp4','audio/wav'].includes(input.mimeType)||!Number.isSafeInteger(input.durationMs)||input.durationMs<1)throw fail('语音文件信息无法核对');
  return store.mutate(target,{},row=>{
   const next={id:id.toLowerCase(),...Object.fromEntries(fields.slice(1).map(field=>[field,input[field]]))};
   if(row.id&&fields.some(field=>row[field]!==next[field]))throw fail('这次语音与原上传不一致，录音仍保留',409);
   if(!row.id)Object.assign(row,next,{parts:{},count:Math.ceil(input.bytes/PART_BYTES),complete:false});
   return {...receipt(row),partBytes:PART_BYTES,count:row.count,received:Object.keys(row.parts).map(Number),complete:row.complete};
  });
 }
 async function part(user,id,input){
  const target=key(user,id),row=await load(user,id),index=input?.index;
  if(!Number.isSafeInteger(index)||index<0||index>=row.count||!validHash(input.sha256)||typeof input.base64!=='string'||input.base64.length>Math.ceil(PART_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw fail('语音分段格式无效');
  const bytes=Buffer.from(input.base64,'base64'),size=Math.min(PART_BYTES,row.bytes-index*PART_BYTES);
  if(bytes.length!==size||hash(bytes)!==input.sha256)throw fail('语音分段校验失败，录音仍保留',422);
  const blob=target+'/part-'+index+'-'+input.sha256;
  await store.putBlob(blob,bytes);
  return store.mutate(target,null,current=>{if(current.parts[index]&&current.parts[index].sha256!==input.sha256)throw fail('语音分段冲突，原录音未覆盖',409);current.parts[index]={sha256:input.sha256,target:blob};return {accepted:true,index};});
 }
 async function complete(user,id){
  const row=await load(user,id);if(row.complete)return receipt(row);
  const digest=createHash('sha256');let first;
  for(let index=0;index<row.count;index++){
   const ref=row.parts[index];if(!ref)throw fail('语音尚未上传完整，录音仍保留',422);
   const bytes=await store.blob(ref.target);if(bytes.length!==Math.min(PART_BYTES,row.bytes-index*PART_BYTES)||hash(bytes)!==ref.sha256)throw fail('语音分段校验失败',422);
   if(index===0)first=bytes;digest.update(bytes);
  }
  if(digest.digest('hex')!==row.sha256)throw fail('语音原件校验失败',422);
  const signature=row.mimeType==='audio/x-caf'?first.subarray(0,4).toString()==='caff':row.mimeType==='audio/mp4'?first.subarray(4,8).toString()==='ftyp':first.subarray(0,4).toString()==='RIFF'&&first.subarray(8,12).toString()==='WAVE';
  if(!signature)throw fail('语音文件格式无法识别',422);
  return store.mutate(key(user,id),null,current=>{current.complete=true;return receipt(current);});
 }
 async function view(user,id){const row=await load(user,id);if(!row.complete)throw fail('找不到完整的语音',404);return {...receipt(row),partBytes:PART_BYTES,count:row.count};}
 async function bytes(user,id,index){const row=await load(user,id);if(!row.complete||!Number.isSafeInteger(index)||index<0||index>=row.count)throw fail('找不到这段语音',404);const ref=row.parts[index],value=await store.blob(ref.target);if(hash(value)!==ref.sha256)throw fail('语音文件校验失败',422);return value;}
 async function validate(user,input){const row=await load(user,input?.id);if(!row.complete)throw fail('语音尚未上传完整',422);if(fields.some(field=>input[field]!==row[field])||Object.keys(input).some(field=>!fields.includes(field)))throw fail('语音回执与原件不一致',409);return receipt(row);}
 async function exportVoice(user,input){const trusted=await validate(user,input),row=await load(user,trusted.id),parts=[];for(let index=0;index<row.count;index++)parts.push((await bytes(user,row.id,index)).toString('base64'));return {receipt:trusted,parts};}
 async function restoreVoice(user,asset,{validateOnly=true}={}){
  const input=asset?.receipt,target=key(user,input?.id);
  if(!input||Object.keys(input).some(field=>!fields.includes(field))||!Number.isSafeInteger(input.bytes)||input.bytes<8||input.bytes>MAX_BYTES||!validHash(input.sha256)||!['audio/x-caf','audio/mp4','audio/wav'].includes(input.mimeType)||!Number.isSafeInteger(input.durationMs)||input.durationMs<1||!Array.isArray(asset.parts)||asset.parts.length!==Math.ceil(input.bytes/PART_BYTES))throw fail('备份语音信息无效',422);
  const buffers=[],digest=createHash('sha256');
  for(let index=0;index<asset.parts.length;index++){
   const base64=asset.parts[index];if(typeof base64!=='string'||base64.length>Math.ceil(PART_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw fail('备份语音分段无效',422);
   const value=Buffer.from(base64,'base64');if(value.length!==Math.min(PART_BYTES,input.bytes-index*PART_BYTES))throw fail('备份语音大小不完整',422);buffers.push(value);digest.update(value);
  }
  if(digest.digest('hex')!==input.sha256)throw fail('备份语音原件校验失败',422);
  const first=buffers[0],signature=input.mimeType==='audio/x-caf'?first.subarray(0,4).toString()==='caff':input.mimeType==='audio/mp4'?first.subarray(4,8).toString()==='ftyp':first.subarray(0,4).toString()==='RIFF'&&first.subarray(8,12).toString()==='WAVE';
  if(!signature)throw fail('备份语音格式无效',422);
  const existing=await store.read(target,null);if(existing&&fields.some(field=>existing[field]!==input[field]))throw fail('备份语音与已有原件冲突，未覆盖',409);
  if(validateOnly)return receipt(input);
  await start(user,input.id,input);
  for(let index=0;index<buffers.length;index++)await part(user,input.id,{index,base64:asset.parts[index],sha256:hash(buffers[index])});
  return complete(user,input.id);
 }
 return {start,part,complete,view,bytes,validate,exportVoice,restoreVoice};
}
