import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
import {normalizePaddlePage,PADDLE_MODEL} from './paddleocr.mjs';
const userId=user=>{if(!user?.id)throw fail('请先进入自己的书房',401);return digest(user.id);};
export function createBookIngestion({store,library,provider,batchPages=30,maxBatchBytes=20*1024*1024,now=Date.now}={}){
 let cachedDocument=null;
 const key=(user,id)=>{if(typeof id!=='string'||!/^[-a-z0-9]{36}$/.test(id))throw fail('找不到解析任务',404);return 'ingestion/'+userId(user)+'/'+id;};
 const index=user=>'ingestion/'+userId(user)+'/index';
 const viewOf=j=>({id:j.id,filename:j.filename,state:j.state,totalPages:j.totalPages,completedPages:j.batches.filter(b=>b.state==='done').reduce((n,b)=>n+b.count,0),bookId:j.bookId||null,error:j.error||null,model:PADDLE_MODEL,createdAt:j.createdAt});
 const get=async(user,id)=>{const j=await store.read(key(user,id),null);if(!j)throw fail('找不到解析任务',404);return j;};
 const batchKey=(b,i)=>b.storageKey??String(i);
 async function prepare(user,{filename,bytes,consent,sourceParts}){
  userId(user);if(consent!==true)throw fail('请先允许将本书发送给 PaddleOCR 官方服务识别',403);if(!provider)throw fail('文字识别服务尚未配置',503);
  if(typeof filename!=='string'||!/^.+\.pdf$/i.test(filename)||filename.length>240||!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE_BYTES||bytes.subarray(0,5).toString()!=='%PDF-')throw fail('请选择 256 MB 内的有效 PDF',413);
  const hash=digest(bytes),prior=await store.read(index(user),{jobs:[]});
  for(const id of prior.jobs){const old=await get(user,id);if(old.sourceHash===hash&&(old.state!=='cancelled'||old.batches.some(b=>b.state==='submitting')))return viewOf(old);}
  let doc;try{doc=await PDFDocument.load(bytes,{updateMetadata:false});}catch{throw fail('PDF 无法读取，请检查是否加密或损坏',422);}
  const totalPages=doc.getPageCount();if(totalPages<1||totalPages>1200)throw fail('PDF 最多支持 1200 页',413);
  const id=randomUUID(),base=key(user,id),batches=[];
  const reservation='ingestion/'+userId(user)+'/source-'+hash;
  const claim=await store.mutate(reservation,{},r=>{if(r.id&&r.expiresAt>now())return {id:r.id};r.id=id;r.expiresAt=now()+120000;return {id,mine:true};});
  if(!claim.mine){const existing=await store.read(key(user,claim.id),null);if(existing)return viewOf(existing);throw fail('同一文件正在建立任务，请稍后重试',409);}

  const day=new Date(now()).toISOString().slice(0,10);await store.mutate('ingestion-budget/'+day,{pages:0,owners:{}},r=>{const owner=userId(user);if(r.pages+totalPages>15000||(r.owners[owner]||0)+totalPages>3000)throw fail('今日识别额度已用完，原文件仍可保留，明天可继续',429);r.pages+=totalPages;r.owners[owner]=(r.owners[owner]||0)+totalPages;});
  if(sourceParts&&store.adoptBlob)await store.adoptBlob(base+'/source',sourceParts,{size:bytes.length,sha256:hash});else await store.putBlob(base+'/source',bytes);
  for(let start=0;start<totalPages;start+=batchPages)batches.push({start:start+1,count:Math.min(batchPages,totalPages-start),state:'new'});
  const job={id,filename,sourceHash:hash,totalPages,batches,state:'preparing',createdAt:new Date(now()).toISOString(),consent:{recipient:'PaddleOCR official',purpose:'document_parsing',scope:'whole_pdf',sha256:hash,version:1,acceptedAt:now()},lease:null};
  await store.mutate(base,{},j=>Object.assign(j,job));await store.mutate(index(user),{jobs:[]},j=>{j.jobs.push(id);});return viewOf(job);
 }
 async function advance(user,id){
  const base=key(user,id),token=randomUUID();
  const acquired=await store.mutate(base,null,j=>{if(!j)throw fail('找不到解析任务',404);if(['done','cancelled','failed','needs_review'].includes(j.state))return false;if(j.lease&&j.lease.expiresAt>now())return false;j.lease={token,expiresAt:now()+115000};return true;});
  if(!acquired)return viewOf(await get(user,id));
  const current=async()=>{const j=await get(user,id);if(j.state==='cancelled'||j.lease?.token!==token)throw fail('解析已取消或由另一任务接管',409);return j;};
  const save=async fn=>store.mutate(base,null,j=>{if(j.state==='cancelled'||j.lease?.token!==token)throw fail('解析已取消或已过期',409);return fn(j);});
  let stage='load_job';
  try{
   let job=await current();
   const sourceDocument=async()=>{if(cachedDocument?.base!==base){const bytes=await store.blob(base+'/source');if(digest(bytes)!==job.sourceHash)throw fail('原文件校验失败',409);cachedDocument={base,doc:await PDFDocument.load(bytes,{updateMetadata:false})};}return cachedDocument.doc;};
   if(job.state==='preparing'){
    const doc=await sourceDocument();if(doc.getPageCount()!==job.totalPages)throw fail('PDF 页数发生变化',409);
    await save(j=>{j.state='running';j.prepared=true;});return viewOf(await get(user,id));
   }
   const active=job.batches.filter(b=>b.state==='submitted').length,newIndex=job.batches.findIndex(b=>b.state==='new');
   const uncertain=job.batches.findIndex(b=>b.state==='submitting');
   const i=uncertain>=0?uncertain:active<3&&newIndex>=0?newIndex:job.batches.findIndex(b=>b.state!=='done');
   if(i<0){
    const pages=[];for(let n=0;n<job.batches.length;n++){const result=JSON.parse(await store.blob(base+'/result-'+batchKey(job.batches[n],n)));pages.push(...result.normalized);}
    if(pages.length!==job.totalPages||pages.some((p,n)=>p.page!==n+1))throw fail('页码覆盖不完整，未加入书房',422);
    const extracted={format:'pdf',review:'extracted_unreviewed',processor:PADDLE_MODEL,pages,contentVersion:digest(JSON.stringify(pages.map(p=>p.blocks.map(b=>[b.id,b.text,b.type])))),quality:{totalPages:pages.length,blankPages:pages.filter(p=>p.blank).map(p=>p.page),review:'extracted_unreviewed'}};
    const bytes=await store.blob(base+'/source');await current();
    // The publication fence is held across the library commit; cancel is refused
    // during this short phase, so it cannot report cancellation after publishing.
    await save(j=>{j.state='publishing';});
    const book=await library.importExtracted(user,{filename:job.filename,bytes,extracted});
    await save(j=>{j.state='done';j.bookId=book.bookId;});return viewOf(await get(user,id));
   }
   const batch=job.batches[i];
   if(batch.state==='submitting'){stage='provider_recover';if(batch.requestId&&provider.recover){const handle=await provider.recover(batch.requestId);if(handle){await save(j=>{j.batches[i].handle=handle;j.batches[i].state='submitted';j.state='running';j.error=null;});return viewOf(await get(user,id));}}await save(j=>{j.state='needs_review';j.error='上次请求未确认是否提交成功，为避免重复计费已暂停，请保留任务并联系管理员。';});return viewOf(await get(user,id));}
   if(!batch.handle){
    stage='split_batch';const doc=await sourceDocument(),part=await PDFDocument.create();const selected=await part.copyPages(doc,Array.from({length:batch.count},(_,n)=>batch.start-1+n));selected.forEach(p=>part.addPage(p));const bytes=Buffer.from(await part.save());let fileUrl;
    if(bytes.length>maxBatchBytes){if(batch.count===1)throw fail('单页扫描文件超过 20 MB，请减小页面图片后重试',413);const left=Math.floor(batch.count/2);await save(j=>{j.batches.forEach((b,n)=>{b.storageKey??=String(n);});j.batches.splice(i,1,{start:batch.start,count:left,state:'new',storageKey:randomUUID()},{start:batch.start+left,count:batch.count-left,state:'new',storageKey:randomUUID()});});return viewOf(await get(user,id));}
    if(store.putSingleBlob&&store.signedBlob){stage='stage_batch';const target=base+'/input-'+batchKey(batch,i);await store.putSingleBlob(target,bytes);fileUrl=await store.signedBlob(target,{expiresIn:3600});}
    await current();const requestId=randomUUID();await save(j=>{j.batches[i].state='submitting';j.batches[i].requestId=requestId;});
    stage='provider_submit';const handle=await provider.submit(bytes,{batchId:requestId,fileUrl});stage='save_provider_handle';await save(j=>{j.batches[i].handle=handle;j.batches[i].state='submitted';});
   }else{
    const state=await provider.status(batch.handle);if(state.state==='failed'){await save(j=>{j.batches[i].state='failed';j.batches[i].confirmedFailed=true;});throw fail('PaddleOCR 未能完成这一批页面，请保留任务后重试',502);}
    if(state.state==='done'){
     const raw=await provider.result(batch.handle);await store.putBlob(base+'/raw-'+batchKey(batch,i),Buffer.from(JSON.stringify(raw)));if(raw.pages?.length!==batch.count)throw fail('识别返回页数不完整，未加入书房',422);
     const normalized=raw.pages.map((p,n)=>normalizePaddlePage(p,batch.start+n));await store.putBlob(base+'/result-'+batchKey(batch,i),Buffer.from(JSON.stringify({normalized})));await save(j=>{j.batches[i].state='done';});
    }
   }
   return viewOf(await get(user,id));
  }catch(error){
   await save(j=>{j.failure={stage,name:/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name||'')?error.name:'Error',status:Number.isInteger(error.statusCode||error.status)?error.statusCode||error.status:null,code:/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code||'')?error.code:null};if(j.state==='publishing'){j.error='入库结果正在核对，请继续处理任务。';return;}const pending=j.batches.some(b=>b.state==='submitting');j.state=pending?'needs_review':'failed';j.error=pending?'请求结果未确认，为避免重复提交已暂停。':'解析未完成，原文件和已完成页面已保留。';}).catch(()=>{});throw fail('解析暂未完成，已保存进度。可重新打开上传窗口查看。',error.status||503);
  }finally{await store.mutate(base,null,j=>{if(j?.lease?.token===token)j.lease=null;});}
 }
 async function resume(u,id){await store.mutate(key(u,id),null,j=>{if(!j)throw fail('找不到解析任务',404);if(j.state==='needs_review'&&j.batches.some(b=>b.state==='submitting'&&b.requestId)&&provider.recover){j.state='running';j.error=null;}else if(j.state==='failed'){for(const b of j.batches)if(b.confirmedFailed){delete b.handle;delete b.confirmedFailed;b.state='new';}j.state=j.prepared?'running':'preparing';j.error=null;}});return viewOf(await get(u,id));}
 return {prepare,advance,resume,view:async(u,id)=>viewOf(await get(u,id)),list:async u=>{const ids=(await store.read(index(u),{jobs:[]})).jobs;return Promise.all(ids.slice(-20).map(id=>get(u,id).then(viewOf)));},cancel:async(u,id)=>{await store.mutate(key(u,id),null,j=>{if(!j)throw fail('找不到解析任务',404);if(j.state==='publishing')throw fail('正在完成入库，请稍后查看',409);if(j.state!=='done'){j.state='cancelled';j.lease=null;}});return viewOf(await get(u,id));}};
}
