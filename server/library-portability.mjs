import {randomUUID,createHash} from 'node:crypto';
import {MAX_ARCHIVE_BYTES,PART_BYTES,readLibraryArchive,assertPortableContent} from '../app/library-portability.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
const replace=(row,next)=>{for(const k of Object.keys(row))delete row[k];Object.assign(row,next);};
const validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const HOUR=3600000,LEASE=600000;

// One reusable owner slot, <=512 fixed part keys. Staged bytes never become books
// until the complete immutable package has passed all domain/conflict checks.
export function createLibraryPortability({library,chat,store,clock=Date.now}){
 const key=user=>{if(!user?.id||user.is_anonymous)fail('请先进入自己的书房',401);return 'portability/'+hash(user.id);};
 const partKey=(user,n)=>key(user)+'/parts/'+n;
 const metadata=user=>key(user)+'/operation';
 async function purge(user,id,count){for(let base=0;base<count;base+=8)await Promise.all(Array.from({length:Math.min(8,count-base)},(_,i)=>store.mutate(partKey(user,base+i),{},row=>{if(row.operationId===id)replace(row,{});return null;})));}
 function check(row,id){if(row.id!==id||row.expiresAt<=clock())fail('恢复操作已过期，请重新选择备份',410);}
 async function start(user,input){
  key(user);if(!Number.isSafeInteger(input?.bytes)||input.bytes<22||input.bytes>MAX_ARCHIVE_BYTES||!validHash(input.sha256))fail('备份大小或校验值不正确');
  const result=await store.mutate(metadata(user),{},row=>{
   if(row.id&&row.expiresAt>clock()&&!['done','cancelled','rejected'].includes(row.state)){
    if(row.bytes===input.bytes&&row.sha256===input.sha256&&row.state==='uploading')return {operation:{...row},previous:null};
    fail('还有一份恢复正在处理，请先完成或取消',409);
   }
   const previous={id:row.id,count:row.parts||0},next={id:randomUUID(),bytes:input.bytes,sha256:input.sha256,parts:Math.ceil(input.bytes/PART_BYTES),state:'uploading',expiresAt:clock()+HOUR};replace(row,next);return {operation:next,previous};
  });
  if(result.previous?.id)await purge(user,result.previous.id,result.previous.count);
  return {id:result.operation.id,partBytes:PART_BYTES,bytes:result.operation.bytes};
 }
 async function part(user,id,input){
  key(user);if(!Number.isSafeInteger(input?.offset)||input.offset<0||input.offset%PART_BYTES||typeof input.data!=='string'||input.data.length>Math.ceil(PART_BYTES/3)*4||input.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail('恢复分段格式不正确');
  const bytes=Buffer.from(input.data,'base64'),nonce=randomUUID();
  const meta=await store.mutate(metadata(user),{},row=>{check(row,id);if(row.state!=='uploading'&&!(row.state==='receiving'&&row.leaseUntil<clock()))fail('恢复正在校验或写入，请稍后',409);if(input.offset>=row.bytes||bytes.length!==Math.min(PART_BYTES,row.bytes-input.offset))fail('恢复分段大小不正确');row.state='receiving';row.lease=nonce;row.leaseUntil=clock()+LEASE;return {...row};});
  try{await store.mutate(partKey(user,input.offset/PART_BYTES),{},row=>{if(row.operationId===id&&row.data!==input.data)fail('重复分段与已上传内容冲突',409);replace(row,{operationId:id,data:input.data});return null;});return {received:input.offset+bytes.length,total:meta.bytes};}
  finally{await store.mutate(metadata(user),{},row=>{if(row.id===id&&row.lease===nonce){row.state='uploading';row.expiresAt=clock()+HOUR;delete row.lease;delete row.leaseUntil;}return null;});}
 }
 async function cancel(user,id){
  const previous=await store.mutate(metadata(user),{},row=>{if(row.id!==id)fail('找不到恢复操作',404);if(['validating','applying','receiving'].includes(row.state)&&row.leaseUntil>clock())fail('恢复请求尚在处理，请等待结果后取消',409);const previous={...row};row.state='cancelled';delete row.lease;return previous;});
  await purge(user,id,previous.parts);return {cancelled:true};
 }
 async function commit(user,id){
  const nonce=randomUUID(),meta=await store.mutate(metadata(user),{},row=>{check(row,id);if(row.state==='done')return {...row};if(row.state!=='uploading'&&!(row.leaseUntil<clock()&&['receiving','validating','applying'].includes(row.state)))fail('恢复仍在处理，请稍后查看',409);row.state='validating';row.lease=nonce;row.leaseUntil=clock()+LEASE;return {...row};});
  if(meta.state==='done'){await purge(user,id,meta.parts);return meta.receipt;}
  let validated=false;
  try{
   const archive=Buffer.alloc(meta.bytes);
   for(let base=0;base<meta.parts;base+=8)await Promise.all(Array.from({length:Math.min(8,meta.parts-base)},async(_,i)=>{const n=base+i,row=await store.read(partKey(user,n),{});if(row.operationId!==id||typeof row.data!=='string')fail('备份尚未上传完整，请重试');const part=Buffer.from(row.data,'base64'),expected=Math.min(PART_BYTES,meta.bytes-n*PART_BYTES);if(part.length!==expected)fail('恢复分段校验失败');part.copy(archive,n*PART_BYTES);}));
   if(hash(archive)!==meta.sha256)fail('备份整体校验失败');
   const {backup,originals}=await readLibraryArchive(archive),books=backup.books.map(e=>e.book);
   await library.validateRestore(user,backup);
   for(const entry of backup.books)if(entry.chat)await chat.validateHistory(user,entry.book,entry.chat,books);
   for(const original of originals){const book=books.find(b=>b.bookId===original.bookId);if(book.visibility==='public'||book.source.sha256!==book.contentVersion&&!['PaddleOCR-VL-1.6','pdfjs-native','native+paddle-auto-v1'].includes(book.source.processor))fail('备份原文件无法对应自己的来源版本');let existing;try{existing=await library.getBook(user,book.bookId);}catch(error){if(error.status!==404)throw error;}if(existing&&(existing.visibility!=='private'||existing.source.sha256!==book.source.sha256))fail('备份原文件与目标书籍的来源冲突，未开始恢复',409);}
   await store.mutate(metadata(user),{},row=>{check(row,id);if(row.lease!==nonce)fail('恢复操作已变化，请重新校验',409);row.state='applying';row.leaseUntil=clock()+LEASE;return null;});validated=true;
   await library.restoreLibrary(user,backup,{preserveExisting:true});
   for(const entry of backup.books)if(entry.chat)await chat.restoreHistory(user,entry.book,entry.chat,books);
   for(const original of originals)await library.restoreOriginal(user,original.bookId,Buffer.from(original.bytes.buffer,original.bytes.byteOffset,original.bytes.byteLength));
   const receipt={restored:backup.books.length,originals:originals.length,sha256:meta.sha256};
   await store.mutate(metadata(user),{},row=>{if(row.id!==id||row.lease!==nonce)fail('恢复回执尚未保存，请重试',503);row.state='done';row.receipt=receipt;delete row.lease;delete row.leaseUntil;return null;});
   await purge(user,id,meta.parts);return receipt;
  }catch(error){
   await store.mutate(metadata(user),{},row=>{if(row.id===id&&row.lease===nonce){row.state=validated?'uploading':'rejected';delete row.lease;delete row.leaseUntil;}return null;});
   if(!validated)await purge(user,id,meta.parts);
   throw error;
  }
 }
 async function exportPart(user,id,{offset=0,snapshot=null}={}){
  key(user);if(!Number.isSafeInteger(offset)||offset<0||offset>MAX_ARCHIVE_BYTES||snapshot!==null&&!validHash(snapshot)||offset>0&&!snapshot)fail('备份分段范围不正确');
  const entry={...await library.exportBookEntry(user,id),chat:await chat.exportHistory(user,id)};assertPortableContent(entry);
  const bytes=Buffer.from(JSON.stringify(entry)),digest=hash(bytes);if(bytes.length>MAX_ARCHIVE_BYTES)fail('单书备份超过 512 MiB',413);if(snapshot&&snapshot!==digest)fail('记录正在更新，请重试备份',409);if(offset>=bytes.length)fail('备份分段超出范围');
  const next=Math.min(bytes.length,offset+PART_BYTES);return {kind:'marginalia-book-export-part',schemaVersion:1,bookId:entry.book.bookId,contentVersion:entry.book.contentVersion,offset,totalBytes:bytes.length,nextOffset:next<bytes.length?next:null,snapshot:digest,data:bytes.subarray(offset,next).toString('base64')};
 }
 async function originalPart(user,id,{offset=0,sha256}={}){
  key(user);const info=await library.originalInfo(user,id);if(!info.available)fail(info.reason,404);if(!Number.isSafeInteger(offset)||offset<0||offset>=info.bytes||sha256!==info.sha256)fail('原文件分段或版本不正确');const length=Math.min(PART_BYTES,info.bytes-offset),range=await library.originalRange(user,id,{offset,length,sha256});return {offset,totalBytes:info.bytes,sha256:info.sha256,nextOffset:offset+length<info.bytes?offset+length:null,data:range.bytes.toString('base64')};
 }
 return {start,part,commit,cancel,exportPart,originalPart};
}
