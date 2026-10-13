import {digest,fail,MAX_FILE_BYTES} from '../server/document-import.mjs';
import {randomUUID} from 'node:crypto';

export function createHostedStore({env=process.env,fetcher=fetch}={}){
  const base=env.SUPABASE_URL?.replace(/\/$/,''),secret=env.SUPABASE_SECRET_KEY;
  if(!base?.startsWith('https://')||!secret)throw fail('云端书房尚未配置',503);
  const headers={apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})};
  async function request(route,options={}){
    const response=await fetcher(base+route,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(45000)});
    if(!response.ok){await response.arrayBuffer();throw fail('云端书房暂时无法完成操作，请重试',response.status===404?404:503);}
    return response;
  }
  const json=async(route,options)=> (await request(route,options)).json();
  const keyOf=file=>String(file).replaceAll('\\','/');
  async function snapshot(file,fallback){const rows=await json('/rest/v1/reader_documents?key=eq.'+encodeURIComponent(keyOf(file))+'&select=value,version');return rows[0]?{data:rows[0].value,version:rows[0].version}:{data:structuredClone(fallback),version:0};}
  async function mutate(file,fallback,operation){
    for(let attempt=0;attempt<12;attempt++){
      const {data,version}=await snapshot(file,fallback),result=await operation(data);
      const saved=await json('/rest/v1/rpc/reader_document_cas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document_key:keyOf(file),expected_version:version,document_value:data})});
      if(saved)return result;
    }
    throw fail('书房正在另一处更新，请重试',409);
  }
  const objectPath=file=>'originals/'+digest(keyOf(file));
  const objectRoute=key=>'/storage/v1/object/reader-originals/'+key;
  async function blob(file){return Buffer.from(await (await request(objectRoute(objectPath(file)))).arrayBuffer());}
  async function blobInfo(file){try{const r=await request(objectRoute(objectPath(file)),{method:'HEAD'});const size=Number(r.headers.get('content-length'));if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES)throw fail('原文件信息无法核验',409);return {size};}catch(e){if(e.status===404)return null;throw e;}}
  async function putBlob(file,bytes){if(bytes.length>MAX_FILE_BYTES)throw fail('文件超过 20 MB',413);await request(objectRoute(objectPath(file)),{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upsert':'true'},body:bytes});}
  async function signedBlob(file){
    const signed=await json('/storage/v1/object/sign/reader-originals/'+objectPath(file),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
    if(typeof signed.signedURL!=='string')throw fail('原文件下载地址未准备好',503);
    const target=new URL(signed.signedURL.startsWith('/object/')?'/storage/v1'+signed.signedURL:signed.signedURL,base+'/storage/v1/');
    if(target.origin!==new URL(base).origin||!target.pathname.startsWith('/storage/v1/object/sign/'))throw fail('原文件下载地址无效',503);
    return target.href;
  }
  async function beginUpload(user,input){
    if(!user?.id)throw fail('请先进入自己的书房',401);
    if(typeof input.filename!=='string'||input.filename.length>240||!/^.+\.(pdf|txt|md)$/i.test(input.filename)||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>MAX_FILE_BYTES)throw fail('请选择 20 MB 内的 PDF 或文本文件');
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
    const id=randomUUID(),key=digest(user.id+'|'+bookId+'|'+passageId),owner=digest(user.id),now=Date.now();
    await mutate('limits/translation',{requests:[],active:{}},data=>{
      data.requests=data.requests.filter(r=>now-r.time<86400000);for(const [key,row]of Object.entries(data.active))if(row.expiresAt<=now)delete data.active[key];
      if(data.active[key])throw fail('这一段正在翻译，请稍后查看',409);
      if(Object.keys(data.active).length>=2)throw fail('翻译服务正在处理其他段落，请稍后再试',429);
      const hour=data.requests.filter(r=>now-r.time<3600000);if(hour.filter(r=>r.owner===owner).length>=10||hour.length>=100||data.requests.filter(r=>r.owner===owner).length>=50||data.requests.length>=500)throw fail('今天的翻译请求较多，请稍后再试；原文仍可阅读',429);
      data.requests.push({owner,time:now});data.active[key]={id,expiresAt:now+90000};
    });return {key,id};
  }
  async function releaseTranslation(ticket){await mutate('limits/translation',{requests:[],active:{}},data=>{if(data.active[ticket.key]?.id===ticket.id)delete data.active[ticket.key];});}
  return {read:async(file,fallback)=>(await snapshot(file,fallback)).data,mutate,putBlob,blob,blobInfo,signedBlob,beginUpload,completeUpload,reserveTranslation,releaseTranslation};
}
