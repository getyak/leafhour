import {digest,fail,MAX_FILE_BYTES} from '../server/document-import.mjs';
import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

export const BLOB_CHUNK_BYTES=8*1024*1024;
const BLOB_MAGIC=Buffer.from('\0LEAFHOUR_CHUNKS_V1\n');
async function boundedMap(rows,fn){const result=[];for(let n=0;n<rows.length;n+=6)result.push(...await Promise.all(rows.slice(n,n+6).map(fn)));return result;}

export function createHostedStore({env=process.env,fetcher=fetch}={}){
  const base=env.SUPABASE_URL?.replace(/\/$/,''),secret=env.SUPABASE_SECRET_KEY;
  if(!base?.startsWith('https://')||!secret)throw fail('云端书房尚未配置',503);
  const headers={apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})};
  async function request(route,options={}){
    const response=await fetcher(base+route,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(45000)});
    if(!response.ok){
      await response.arrayBuffer();
      const error=fail('云端书房暂时无法完成操作，请重试',response.status===404?404:503);
      // Preserve the upstream classification for internal retry decisions without
      // changing the public status or exposing the storage response body.
      Object.defineProperty(error,'upstreamStatus',{value:response.status});
      throw error;
    }
    return response;
  }
  const json=async(route,options)=> (await request(route,options)).json();
  const keyOf=file=>String(file).replaceAll('\\','/');
  async function snapshot(file,fallback){const rows=await json('/rest/v1/reader_documents?key=eq.'+encodeURIComponent(keyOf(file))+'&select=value,version');if(!rows[0])return {data:structuredClone(fallback),version:0};let data=rows[0].value;if(data?.kind==='leafhour-json-blob-v1'){if(typeof data.file!=='string'||!data.file.startsWith('json/'+digest(keyOf(file))+'/'))throw fail('书籍内容引用无效',409);const bytes=await blob(data.file);if(digest(bytes)!==data.sha256)throw fail('书籍内容校验失败',409);data=JSON.parse(gunzipSync(bytes,{maxOutputLength:100*1024*1024}));}return {data,version:rows[0].version};}
  async function mutate(file,fallback,operation){
    for(let attempt=0;attempt<12;attempt++){
      const {data,version}=await snapshot(file,fallback),result=await operation(data);
      let value=data;const encoded=Buffer.from(JSON.stringify(data));if(encoded.length>3500000){const packed=gzipSync(encoded),target='json/'+digest(keyOf(file))+'/'+randomUUID();await putBlob(target,packed);value={kind:'leafhour-json-blob-v1',file:target,sha256:digest(packed)};}
      const saved=await json('/rest/v1/rpc/reader_document_cas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document_key:keyOf(file),expected_version:version,document_value:value})});
      if(saved)return result;
    }
    throw fail('书房正在另一处更新，请重试',409);
  }
  const objectPath=file=>'originals/'+digest(keyOf(file));
  const objectRoute=key=>'/storage/v1/object/reader-originals/'+key;
  const readObject=async key=>Buffer.from(await (await request(objectRoute(key))).arrayBuffer());
  const writeObject=(key,bytes)=>request(objectRoute(key),{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upsert':'true'},body:bytes});
  const manifestOf=bytes=>{if(bytes.length>65536||!bytes.subarray(0,BLOB_MAGIC.length).equals(BLOB_MAGIC))return null;try{const m=JSON.parse(bytes.subarray(BLOB_MAGIC.length));return m.kind==='leafhour-blob-chunks-v1'?m:null;}catch{throw fail('原文件分块信息无效',409);}};
  async function blob(file){const bytes=await readObject(objectPath(file)),m=manifestOf(bytes);if(!m)return bytes;if(!Number.isSafeInteger(m.size)||m.size>MAX_FILE_BYTES||!Array.isArray(m.parts)||m.parts.length>128)throw fail('原文件分块信息无效',409);const parts=await boundedMap(m.parts,async p=>{const b=await readObject(p.key);if(b.length!==p.size||digest(b)!==p.sha256)throw fail('原文件分块校验失败',409);return b;});const out=Buffer.concat(parts);if(out.length!==m.size||digest(out)!==m.sha256)throw fail('原文件校验失败',409);return out;}
  async function blobInfo(file){try{const r=await request(objectRoute(objectPath(file)),{method:'HEAD'});let size=Number(r.headers.get('content-length'));if(size<65536){const m=manifestOf(await readObject(objectPath(file)));if(m)size=m.size;}if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES)throw fail('原文件信息无法核验',409);return {size};}catch(e){if(e.status===404)return null;throw e;}}
  const writeManifest=(file,manifest)=>writeObject(objectPath(file),Buffer.concat([BLOB_MAGIC,Buffer.from(JSON.stringify(manifest))]));
  async function adoptBlob(file,parts,{size,sha256}){if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES||parts.length>128)throw fail('原文件分块信息无效',409);await writeManifest(file,{kind:'leafhour-blob-chunks-v1',size,sha256,parts:parts.map(p=>({key:objectPath(p.target),size:p.size,sha256:p.sha256}))});}
  async function putBlob(file,bytes){if(bytes.length>MAX_FILE_BYTES)throw fail('文件超过 256 MB',413);const key=objectPath(file);if(bytes.length<=BLOB_CHUNK_BYTES){await writeObject(key,bytes);return;}const slices=[];for(let offset=0;offset<bytes.length;offset+=BLOB_CHUNK_BYTES)slices.push(bytes.subarray(offset,offset+BLOB_CHUNK_BYTES));const parts=await boundedMap(slices,async b=>{const partKey=key+'/parts/'+digest(b);await writeObject(partKey,b);return {key:partKey,size:b.length,sha256:digest(b)};});await writeManifest(file,{kind:'leafhour-blob-chunks-v1',size:bytes.length,sha256:digest(bytes),parts});}
  async function putSingleBlob(file,bytes){if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>20*1024*1024)throw fail('这一批扫描文件超过 20 MB，请减小页面图片后重试',413);await writeObject(objectPath(file),bytes);}

  async function downloadLayout(file,expected={}){
    const head=await request(objectRoute(objectPath(file)),{method:'HEAD'}),size=Number(head.headers.get('content-length'));
    const m=size<65536?manifestOf(await readObject(objectPath(file))):null;
    // Bind the trusted server-generated manifest to the authorized book before
    // signing any part. User file bytes that imitate a manifest cannot substitute
    // another source. Full byte/hash verification remains in the downloader.
    if(m){
      const validParts=Array.isArray(m.parts)&&m.parts.length>0&&m.parts.length<=128&&m.parts.every(p=>p&&typeof p.key==='string'&&/^originals\/[a-f0-9]{64}(?:\/parts\/[a-f0-9]{64})?$/.test(p.key)&&Number.isSafeInteger(p.size)&&p.size>0&&typeof p.sha256==='string'&&/^[a-f0-9]{64}$/.test(p.sha256));
      const validSize=Number.isSafeInteger(m.size)&&m.size>0&&m.size<=MAX_FILE_BYTES;
      const sourceMatches=(expected.size===undefined||m.size===expected.size)&&(expected.sha256===undefined||m.sha256===expected.sha256);
      if(!validParts||!validSize||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||m.parts.reduce((n,p)=>n+p.size,0)!==m.size||!sourceMatches)throw fail('原文件分块信息无法核验',409);
    }
    else if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES||expected.size!==undefined&&size!==expected.size)throw fail('原文件大小无法核验',409);
    return {size:m?.size||size,parts:m?.parts||[{key:objectPath(file),size,sha256:null}]};
  }
  async function blobDownloads(file,expected={}){const layout=await downloadLayout(file,expected);
    return boundedMap(layout.parts,async part=>{const signed=await json('/storage/v1/object/sign/reader-originals/'+part.key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})});const target=new URL(signed.signedURL.startsWith('/object/')?'/storage/v1'+signed.signedURL:signed.signedURL,base+'/storage/v1/');if(target.origin!==new URL(base).origin||!target.pathname.startsWith('/storage/v1/object/sign/'))throw fail('原文件地址无效',503);return {url:target.href,sha256:part.sha256||null,size:part.size};});
  }
  const rangeLayouts=new Map();
  async function blobRange(file,{offset,length,sha256}){
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>1048576)throw fail('原文件分段位置无效');
    const key=file+'|'+sha256;let cached=rangeLayouts.get(key);
    if(!cached||cached.until<Date.now()){const layout=await downloadLayout(file,{sha256});cached={layout,until:Date.now()+300000};if(rangeLayouts.size>=64)rangeLayouts.delete(rangeLayouts.keys().next().value);rangeLayouts.set(key,cached);}
    const {size,parts}=cached.layout;if(offset>=size||offset+length>size)throw fail('原文件分段超出范围');
    const chunks=[];let base=0;
    for(const part of parts){const start=Math.max(0,offset-base),end=Math.min(part.size,offset+length-base);base+=part.size;if(start>=end)continue;
      const response=await request(objectRoute(part.key),{headers:{Range:'bytes='+start+'-'+(end-1)}}),expected=end-start;
      if(response.status!==206||response.headers.get('content-range')!=='bytes '+start+'-'+(end-1)+'/'+part.size||Number(response.headers.get('content-length'))!==expected){await response.body?.cancel();throw fail('原文件分段响应无法核验',409);}
      const buffer=Buffer.alloc(expected),reader=response.body.getReader();let received=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;if(received+value.length>expected)throw fail('原文件分段大小不正确',409);buffer.set(value,received);received+=value.length;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(received!==expected)throw fail('原文件分段未完整取回',503);chunks.push(buffer);
    }
    const bytes=Buffer.concat(chunks);if(bytes.length!==length)throw fail('原文件分段不完整',409);return {bytes,offset,total:size};
  }
  async function signedBlob(file,{expiresIn=60}={}){
    if(!Number.isInteger(expiresIn)||expiresIn<60||expiresIn>3600)throw fail('下载链接有效期无效',400);
    const signed=await json('/storage/v1/object/sign/reader-originals/'+objectPath(file),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn})});
    if(typeof signed.signedURL!=='string')throw fail('原文件下载地址未准备好',503);
    const target=new URL(signed.signedURL.startsWith('/object/')?'/storage/v1'+signed.signedURL:signed.signedURL,base+'/storage/v1/');
    if(target.origin!==new URL(base).origin||!target.pathname.startsWith('/storage/v1/object/sign/'))throw fail('原文件下载地址无效',503);
    return target.href;
  }
  async function beginUpload(user,input){
    if(!user?.id)throw fail('请先进入自己的书房',401);
    if(typeof input.filename!=='string'||input.filename.length>240||!/^.+\.(pdf|epub|txt|md)$/i.test(input.filename)||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>20*1024*1024)throw fail('请选择 20 MB 内的 PDF、EPUB 或文本文件');
    await mutate('limits/uploads/'+digest(user.id),{requests:[]},data=>{data.requests=data.requests.filter(time=>Date.now()-time<86400000);if(data.requests.length>=20||data.requests.filter(time=>Date.now()-time<3600000).length>=6)throw fail('这段时间上传较多，请稍后再试',429);data.requests.push(Date.now());});
    const id=randomUUID(),key='uploads/'+digest(user.id)+'/'+id,document='uploads/'+digest(user.id)+'/'+id;
    await mutate(document,{},data=>Object.assign(data,{key,filename:input.filename,bytes:input.bytes,expiresAt:Date.now()+3600000}));
    const signed=await json('/storage/v1/object/upload/sign/reader-originals/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(typeof signed.url!=='string')throw fail('上传地址未准备好',503);
    const target=new URL(signed.url.startsWith('/object/')?'/storage/v1'+signed.url:signed.url,base+'/storage/v1/');
    if(target.origin!==new URL(base).origin||!target.pathname.startsWith('/storage/v1/object/upload/sign/'))throw fail('上传地址无效',503);
    return {id,url:target.href};
  }
  async function completeUpload(user,id,library){
    if(!user?.id)throw fail('请先进入自己的书房',401);if(typeof id!=='string'||!/^[-a-z0-9]{36}$/.test(id))throw fail('上传标识无效');
    const document='uploads/'+digest(user.id)+'/'+id,{data}=await snapshot(document,null);
    if(!data||data.expiresAt<=Date.now())throw fail('上传已过期，请重新选择文件',410);
    if(data.bookId)return library.getBook(user,data.bookId);
    const bytes=Buffer.from(await (await request(objectRoute(data.key))).arrayBuffer());
    if(bytes.length!==data.bytes||bytes.length>MAX_FILE_BYTES)throw fail('上传文件不完整，请重新上传',422);
    const book=await library.importDocument(user,{filename:data.filename,bytes});
    await mutate(document,{},row=>{row.bookId=book.bookId;});
    // Staging copies expire; the verified original is in its separate hash-addressed object.
    await request('/storage/v1/object/reader-originals',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[data.key]})}).catch(()=>{});
    return book;
  }
  async function reserveTranslation(user,bookId,passageId){
    const id=randomUUID(),key=digest(user.id+'|'+bookId+'|'+passageId),owner=digest(user.id),book=digest(user.id+'|'+bookId),now=Date.now();
    await mutate('limits/translation',{requests:[],active:{}},data=>{
      data.requests=data.requests.filter(r=>now-r.time<86400000);for(const [key,row]of Object.entries(data.active))if(row.expiresAt<=now)delete data.active[key];
      if(Object.values(data.active).some(row=>row.book===book))throw fail('这本书正在保存另一段译文，请稍后再试；当前段落尚未提交翻译。',409);
      if(data.active[key])throw fail('这一段正在翻译，请稍后查看',409);
      if(Object.keys(data.active).length>=2)throw fail('翻译服务正在处理其他段落，请稍后再试',429);
      const hour=data.requests.filter(r=>now-r.time<3600000);if(hour.filter(r=>r.owner===owner).length>=10||hour.length>=100||data.requests.filter(r=>r.owner===owner).length>=50||data.requests.length>=500)throw fail('今天的翻译请求较多，请稍后再试；原文仍可阅读',429);
      data.requests.push({owner,time:now});data.active[key]={id,book,expiresAt:now+180000};
    });return {key,id};
  }
  async function releaseTranslation(ticket){await mutate('limits/translation',{requests:[],active:{}},data=>{if(data.active[ticket.key]?.id===ticket.id)delete data.active[ticket.key];});}
  const configureIngestionWake=(origin,token)=>json('/rest/v1/rpc/reader_configure_ingestion_wake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wake_origin:origin,derived_token:token})});
  return {configureIngestionWake,read:async(file,fallback)=>(await snapshot(file,fallback)).data,mutate,putBlob,putSingleBlob,adoptBlob,blob,blobInfo,signedBlob,blobDownloads,blobRange,beginUpload,completeUpload,reserveTranslation,releaseTranslation};
}
