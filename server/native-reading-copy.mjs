import {mkdir,open,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {digest,fail} from './document-import.mjs';
import {createLockedJsonStore} from './locked-json-store.mjs';

export const NATIVE_COPY_PART_BYTES=1048576;
export const NATIVE_COPY_TTL_MS=24*60*60*1000;
export const NATIVE_COPY_MAX_BYTES=96*1024*1024;
export const NATIVE_COPY_MAX_COMPRESSED_BYTES=32*1024*1024;
const compress=promisify(gzip),hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stale=()=>fail('书籍内容已更新，请重新下载阅读副本',409);
const corrupt=()=>fail('阅读副本无法核验，请重新下载',409);
const planKeys=['kind','bookId','contentVersion','snapshotId','sha256','compressedBytes','uncompressedBytes','partBytes','encoding'];
const publicPlan=row=>Object.fromEntries(planKeys.map(key=>[key,row[key]]));

// Only the plan build loads the normal book model. Range requests read a small
// owner/book receipt and one bounded blob range, never a chapter manifest.
export function createNativeReadingCopy({dataDir,dataStore=null,assertAccess,captureSnapshot,loadBook,clock=Date.now}){
 const store=dataStore||createLockedJsonStore({dataDir:path.join(dataDir,'native-copy-state')}),builds=new Map();
 const base=(user,id)=>path.join(dataDir,'users',digest(user.id),'native-copies',digest(id));
 const receiptKey=(root,archive)=>path.join(root,archive+'.json');
 const blobKey=(root,archive)=>path.join(root,archive+'.gzip');
 const ownerHash=user=>digest(user.id);
 function supported(){if(dataStore&&['read','mutate','putBlob','blobRange'].some(key=>typeof dataStore[key]!=='function'))throw fail('云端阅读副本暂时不可用',503);}
 function validate(row,user,id,archive){
  if(!row||!row.kind)throw fail('找不到这份阅读副本',404);
  if(row.owner!==ownerHash(user)||row.bookId!==id||row.sha256!==archive)throw fail('找不到这份阅读副本',404);
  if(row.kind!=='leafhour-native-copy-v1'||row.encoding!=='gzip'||row.partBytes!==NATIVE_COPY_PART_BYTES||typeof row.contentVersion!=='string'||!row.contentVersion||typeof row.snapshotId!=='string'||!row.snapshotId||!hash(row.sha256)||!Number.isSafeInteger(row.compressedBytes)||row.compressedBytes<1||row.compressedBytes>NATIVE_COPY_MAX_COMPRESSED_BYTES||!Number.isSafeInteger(row.uncompressedBytes)||row.uncompressedBytes<1||row.uncompressedBytes>NATIVE_COPY_MAX_BYTES||!Number.isSafeInteger(row.expiresAt)||!Array.isArray(row.partHashes)||row.partHashes.length!==Math.ceil(row.compressedBytes/NATIVE_COPY_PART_BYTES)||!row.partHashes.every(hash))throw corrupt();
  if(row.expiresAt<=clock())throw fail('阅读副本已过期，请重新下载',410);
  return row;
 }
 async function receipt(user,id,archive){
  await assertAccess(user,id);supported();if(!hash(archive))throw fail('阅读副本标识无效');
  return validate(await store.read(receiptKey(base(user,id),archive),null),user,id,archive);
 }
 async function assertSnapshot(user,id,expected){const current=await captureSnapshot(user,id);if(current.snapshotId!==expected.snapshotId||current.contentVersion!==expected.contentVersion)throw stale();}
 async function putArchive(root,sha256,bytes){
  const file=blobKey(root,sha256);if(dataStore){await dataStore.putBlob(file,bytes);return;}
  await mkdir(root,{recursive:true,mode:0o700});const pending=file+'.'+randomUUID()+'.pending';
  try{await writeFile(pending,bytes,{flag:'wx',mode:0o600});await rename(pending,file);}finally{await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 async function build(user,id){
  const root=base(user,id),snapshot=await captureSnapshot(user,id),latest=await store.read(path.join(root,'latest.json'),{});
  if(hash(latest.sha256)&&latest.snapshotId===snapshot.snapshotId){
   try{const old=validate(await store.read(receiptKey(root,latest.sha256),null),user,id,latest.sha256);await assertSnapshot(user,id,snapshot);return publicPlan(old);}catch(error){if(![404,410].includes(error.status))throw error;}
  }
  const book=await loadBook(user,id);if(book?.bookId!==id||book.contentVersion!==snapshot.contentVersion)throw stale();
  const bytes=Buffer.from(JSON.stringify(book));if(bytes.length>NATIVE_COPY_MAX_BYTES)throw fail('这本书超过本机完整阅读副本容量，请按章阅读',413);
  const packed=await compress(bytes);if(packed.length>NATIVE_COPY_MAX_COMPRESSED_BYTES)throw fail('这本书超过压缩阅读副本容量，请按章阅读',413);
  await assertSnapshot(user,id,snapshot);
  const sha256=digest(packed),row={kind:'leafhour-native-copy-v1',bookId:id,contentVersion:book.contentVersion,snapshotId:snapshot.snapshotId,sha256,compressedBytes:packed.length,uncompressedBytes:bytes.length,partBytes:NATIVE_COPY_PART_BYTES,encoding:'gzip',owner:ownerHash(user),expiresAt:clock()+NATIVE_COPY_TTL_MS,partHashes:[]};
  for(let offset=0;offset<packed.length;offset+=NATIVE_COPY_PART_BYTES)row.partHashes.push(digest(packed.subarray(offset,offset+NATIVE_COPY_PART_BYTES)));
  await putArchive(root,sha256,packed);await assertSnapshot(user,id,snapshot);
  await store.mutate(receiptKey(root,sha256),{},value=>{Object.assign(value,row);});
  await store.mutate(path.join(root,'latest.json'),{},value=>{value.sha256=sha256;value.snapshotId=snapshot.snapshotId;});
  await assertSnapshot(user,id,snapshot);return publicPlan(row);
 }
 async function prepare(user,id){
  await assertAccess(user,id);supported();const key=base(user,id);let work=builds.get(key);if(!work){work=build(user,id);builds.set(key,work);}
  try{return await work;}finally{if(builds.get(key)===work)builds.delete(key);}
 }
 async function part(user,id,{archive,offset}){
  const row=await receipt(user,id,archive);
  if(!Number.isSafeInteger(offset)||offset<0||offset%NATIVE_COPY_PART_BYTES!==0||offset>=row.compressedBytes)throw fail('阅读副本分段位置无效');
  const length=Math.min(NATIVE_COPY_PART_BYTES,row.compressedBytes-offset),file=blobKey(base(user,id),archive);let result;
  try{
   if(dataStore)result=await dataStore.blobRange(file,{offset,length,sha256:archive});
   else{const handle=await open(file,'r');try{const info=await handle.stat();if(!info.isFile()||info.size!==row.compressedBytes)throw corrupt();const bytes=Buffer.alloc(length),read=await handle.read(bytes,0,length,offset);if(read.bytesRead!==length)throw corrupt();result={bytes,offset,total:info.size};}finally{await handle.close();}}
  }catch(error){if(error.code==='ENOENT'||error.status===404)throw corrupt();throw error;}
  if(!Buffer.isBuffer(result?.bytes)||result.offset!==offset||result.total!==row.compressedBytes||result.bytes.length!==length||digest(result.bytes)!==row.partHashes[offset/NATIVE_COPY_PART_BYTES])throw corrupt();
  if(row.expiresAt<=clock())throw fail('阅读副本已过期，请重新下载',410);
  return result;
 }
 async function verify(user,id,{archive}){
  const row=await receipt(user,id,archive);await assertSnapshot(user,id,row);
  if(row.expiresAt<=clock())throw fail('阅读副本已过期，请重新下载',410);
  return {valid:true,bookId:id,contentVersion:row.contentVersion,snapshotId:row.snapshotId,sha256:archive};
 }
 return {prepare,part,verify};
}
