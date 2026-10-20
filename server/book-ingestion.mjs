import {createVerifiedSource} from './verified-source.mjs';
import {inspectNativePdf,nativePdfOutline} from './pdf-native.mjs';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {digest,fail,MAX_FILE_BYTES} from './document-import.mjs';
import {normalizePaddlePage,PADDLE_MODEL} from './paddleocr.mjs';
const userId=user=>{if(!user?.id)throw fail('请先进入自己的书房',401);return digest(user.id);};
export function createBookIngestion({store,library,provider,batchPages=30,maxBatchBytes=20*1024*1024,now=Date.now,nativeInspector=inspectNativePdf}={}){
 let cachedDocument=null;
 const key=(user,id)=>{if(typeof id!=='string'||!/^[-a-z0-9]{36}$/.test(id))throw fail('找不到解析任务',404);return 'ingestion/'+userId(user)+'/'+id;};
 const index=user=>'ingestion/'+userId(user)+'/index';
 const viewOf=j=>({id:j.id,filename:j.filename,state:j.state,totalPages:j.totalPages,completedPages:j.batches.reduce((n,b)=>n+(b.state==='done'?b.count:b.nativeCount||0),0),bookId:j.bookId||null,error:j.error||null,model:PADDLE_MODEL,createdAt:j.createdAt,sourceHash:j.sourceHash,mode:j.mode||'ocr',recognitionPages:j.batches.reduce((n,b)=>n+(b.pageMap?.length??(j.mode==='auto'?0:b.count)),0),ocrAvailable:!!provider});
 const get=async(user,id)=>{const j=await store.read(key(user,id),null);if(!j)throw fail('找不到解析任务',404);return j;};
 const batchKey=(b,i)=>b.storageKey??String(i);
 async function findSource(user,hash){
  userId(user);if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return null;
  const claim=await store.read('ingestion/'+userId(user)+'/source-'+hash,null),ids=claim?.id?[claim.id]:(await store.read(index(user),{jobs:[]})).jobs;
  for(const id of ids){const old=await store.read(key(user,id),null);if(old?.sourceHash===hash&&(old.state!=='cancelled'||old.batches.some(b=>b.state==='submitting')))return viewOf(old);}
  return null;
 }
 async function reservePages(user,job){
  const pages=job.mode==='auto'?job.batches.reduce((n,b)=>n+(b.pageMap?.length||0),0):job.totalPages;
  const day=new Date(now()).toISOString().slice(0,10);
  await store.mutate('ingestion-budget/'+day,{pages:0,owners:{},jobs:{}},r=>{r.jobs??={};if(Object.hasOwn(r.jobs,job.id))return;const owner=userId(user);if(r.pages+pages>15000||(r.owners[owner]||0)+pages>3000)throw fail('今日识别额度已用完，原文件与进度保留，明天可以继续。',429);r.pages+=pages;r.owners[owner]=(r.owners[owner]||0)+pages;r.jobs[job.id]=pages;});
 }
 async function prepare(user,{filename,bytes,consent,sourceParts,mode,assertCurrent=async()=>{}}){
  userId(user);
  if(typeof filename!=='string'||!/^.+\.pdf$/i.test(filename)||filename.length>240||!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE_BYTES||bytes.subarray(0,5).toString()!=='%PDF-')throw fail('请选择 256 MB 内的有效 PDF',413);
  const hash=digest(bytes),existing=await findSource(user,hash);if(existing)return existing;
  mode=mode==='auto'?'auto':'ocr';
  if(mode==='ocr'&&consent!==true)throw fail('请先允许将本书发送给 PaddleOCR 官方服务识别',403);
  if(mode==='ocr'&&!provider)throw fail('文字识别服务尚未配置',503);
  let doc;try{doc=await PDFDocument.load(bytes,{updateMetadata:false});}catch{throw fail('PDF 无法读取，请检查是否加密或损坏',422);}
  const totalPages=doc.getPageCount();if(totalPages<1||totalPages>1200)throw fail('PDF 最多支持 1200 页',413);
  await assertCurrent();
  const id=randomUUID(),base=key(user,id),batches=[],reservation='ingestion/'+userId(user)+'/source-'+hash;
  const previous=await store.read(reservation,null),cancelled=previous?.id&&previous.expiresAt>now()?await store.read(key(user,previous.id),null):null;
  const restartId=cancelled?.state==='cancelled'&&!cancelled.batches.some(b=>b.state==='submitting')?previous.id:null;
  const claim=await store.mutate(reservation,{},r=>{if(r.id&&r.expiresAt>now()&&r.id!==restartId)return {id:r.id};r.id=id;r.expiresAt=now()+120000;return {id,mine:true};});
  if(!claim.mine){const old=await store.read(key(user,claim.id),null);if(old)return viewOf(old);throw fail('同一文件正在建立任务，请稍后重试',409);}
  const receipt=consent===true?{recipient:'PaddleOCR official',purpose:'document_parsing',scope:mode==='auto'?'unreadable_pages':'whole_pdf',sha256:hash,version:1,acceptedAt:now()}:null;
  const job={id,filename,sourceHash:hash,totalPages,batches,state:'preparing',mode,createdAt:new Date(now()).toISOString(),consent:receipt,lease:null};
  if(sourceParts&&store.adoptBlob){await store.adoptBlob(base+'/source',sourceParts,{size:bytes.length,sha256:hash});job.sourceParts=sourceParts;}else{const saved=await store.putBlob(base+'/source',bytes);if(saved?.parts)job.sourceParts=saved.parts;}
  job.sourceBytes=bytes.length;
  await assertCurrent();
  for(let start=0;start<totalPages;start+=batchPages)batches.push({start:start+1,count:Math.min(batchPages,totalPages-start),state:'new'});
  await store.mutate(base,{},j=>Object.assign(j,job));await store.mutate(index(user),{jobs:[]},j=>{j.jobs.push(id);});return viewOf(job);
 }
 async function consent(user,id,input){
  const j=await get(user,id);if(input?.confirm!==true)throw fail('请确认允许识别本书需要识别的页面。',403);if(input.sourceHash!==j.sourceHash)throw fail('原文件已变化，请重新核对。',409);
  if(!provider)throw fail('当前文字识别服务尚未配置，原文件与进度保留。',503);
  if(j.state!=='awaiting_consent')return viewOf(j);
  if(j.mode!=='auto'||j.batches.every(b=>b.inspected))await reservePages(user,j);await store.mutate(key(user,id),null,r=>{if(r.state==='awaiting_consent'){r.consent={recipient:'PaddleOCR official',purpose:'document_parsing',scope:'unreadable_pages',sha256:r.sourceHash,version:1,acceptedAt:now()};r.state='running';r.error=null;}});return viewOf(await get(user,id));
 }
 async function preview(user,id){
  const j=await get(user,id),base=key(user,id),pages=[];let characters=0,truncated=false;
  for(let i=0;i<j.batches.length&&pages.length<3;i++){const b=j.batches[i],target=b.state==='done'?base+'/result-'+batchKey(b,i):b.nativeResult;if(!target)continue;const result=JSON.parse(await store.blob(target));for(const p of result.normalized){if(pages.length>=3)break;const available=12000-characters;if(available<=0){truncated=true;break;}const text=p.text.slice(0,available);pages.push({page:p.page,text});characters+=text.length;if(text.length<p.text.length)truncated=true;}}
  return {id:j.id,pages,totalPages:j.totalPages,completedPages:viewOf(j).completedPages,complete:j.state==='done'&&pages.length===j.totalPages&&!truncated,sourceComplete:j.state==='done',review:'extracted_unreviewed'};
 }
 async function advance(user,id){
  const base=key(user,id),token=randomUUID();
  const acquired=await store.mutate(base,null,j=>{if(!j)throw fail('找不到解析任务',404);if(['done','cancelled','failed','needs_review','awaiting_consent'].includes(j.state))return false;if(j.lease&&j.lease.expiresAt>now())return false;j.lease={token,expiresAt:now()+115000};return true;});
  if(!acquired)return viewOf(await get(user,id));
  const current=async()=>{const j=await get(user,id);if(j.state==='cancelled'||j.lease?.token!==token)throw fail('解析已取消或由另一任务接管',409);return j;};
  const save=async fn=>store.mutate(base,null,j=>{if(j.state==='cancelled'||j.lease?.token!==token)throw fail('解析已取消或已过期',409);return fn(j);});
  let stage='load_job',readIndex=null;
  try{
   let job=await current();
   const sourceDocument=async()=>{if(cachedDocument?.base!==base){const bytes=await store.blob(base+'/source');if(digest(bytes)!==job.sourceHash)throw fail('原文件校验失败',409);cachedDocument={base,bytes,doc:await PDFDocument.load(bytes,{updateMetadata:false})};}return cachedDocument;};
   if(job.state==='preparing'){
    const {doc,bytes}=await sourceDocument();if(doc.getPageCount()!==job.totalPages)throw fail('PDF 页数发生变化',409);
    let outline=[];if(job.mode==='auto')outline=await nativePdfOutline(bytes).catch(()=>[]);
    await save(j=>{j.state='running';j.prepared=true;j.outline=outline;});return viewOf(await get(user,id));
   }
   const preflightIndex=job.mode==='auto'?job.batches.findIndex(b=>!b.inspected&&b.state==='new'):-1;
   const active=job.batches.filter(b=>b.state==='submitted').length,newIndex=job.batches.findIndex(b=>b.state==='new');
   const uncertain=job.batches.findIndex(b=>b.state==='submitting');
   const polling=job.batches.map((b,i)=>({b,i})).filter(x=>x.b.state==='submitted').sort((a,b)=>(a.b.pollOrder||0)-(b.b.pollOrder||0))[0]?.i;
   const i=uncertain>=0?uncertain:preflightIndex>=0?preflightIndex:active<3&&newIndex>=0?newIndex:polling??job.batches.findIndex(b=>b.state!=='done');
   if(i<0){
    const pages=[];for(let n=0;n<job.batches.length;n++){const result=JSON.parse(await store.blob(base+'/result-'+batchKey(job.batches[n],n)));pages.push(...result.normalized);}
    if(pages.length!==job.totalPages||pages.some((p,n)=>p.page!==n+1))throw fail('页码覆盖不完整，未加入书房',422);
    const extracted={format:'pdf',review:'extracted_unreviewed',processor:job.mode==='auto'&&!job.batches.some(b=>b.pageMap?.length)?'pdfjs-native':job.mode==='auto'?'native+paddle-auto-v1':PADDLE_MODEL,pages,outline:job.outline||[],contentVersion:digest(JSON.stringify(pages.map(p=>p.blocks?p.blocks.map(b=>[b.id,b.text,b.type]):p.text))),quality:{totalPages:pages.length,blankPages:pages.filter(p=>p.blank).map(p=>p.page),review:'extracted_unreviewed'}};
    await current();
    const sourceSize=job.sourceBytes??(await sourceDocument()).bytes.length;
    const verifiedSource=createVerifiedSource(user,{sha256:job.sourceHash,size:sourceSize,adopt:async(target,dataStore)=>{
     if(dataStore){if(dataStore!==store||!store.adoptBlob)throw fail('原文件引用无法核验',403);const parts=job.sourceParts??await store.blobReferences?.(base+'/source',{size:sourceSize,sha256:job.sourceHash});if(!parts)throw fail('原文件引用无法核验',403);await store.adoptBlob(target,parts,{size:sourceSize,sha256:job.sourceHash});}
     else if(store.adoptToFile)await store.adoptToFile(base+'/source',target);
     else throw fail('原文件引用存储尚未配置',503);
    }});
    // The publication fence is held across the library commit; cancel is refused
    // during this short phase, so it cannot report cancellation after publishing.
    await save(j=>{j.state='publishing';});
    const book=await library.importExtracted(user,{filename:job.filename,verifiedSource,extracted});
    await save(j=>{j.state='done';j.bookId=book.bookId;});return viewOf(await get(user,id));
   }
   const batch=job.batches[i];
   if(job.mode==='auto'&&!batch.inspected&&batch.state==='new'){
    stage='inspect_native';const {doc}=await sourceDocument(),part=await PDFDocument.create();(await part.copyPages(doc,Array.from({length:batch.count},(_,n)=>batch.start-1+n))).forEach(p=>part.addPage(p));const bytes=Buffer.from(await part.save());
    if(bytes.length>maxBatchBytes&&batch.count>1){const left=Math.floor(batch.count/2);await save(j=>{j.batches.forEach((b,n)=>{b.storageKey??=String(n);});j.batches.splice(i,1,{start:batch.start,count:left,state:'new',storageKey:randomUUID()},{start:batch.start+left,count:batch.count-left,state:'new',storageKey:randomUUID()});});return viewOf(await get(user,id));}
    const inspected=await nativeInspector(bytes,{start:batch.start});if(inspected.pages?.length!==batch.count)throw fail('逐页检查未完整返回，原文件仍保留。',422);
    const native=inspected.pages.map((p,n)=>({...p,page:batch.start+n})).filter(p=>!p.needsRecognition).map(({needsRecognition,...p})=>p),pageMap=inspected.pages.flatMap((p,n)=>p.needsRecognition?[batch.start+n]:[]),target=base+'/native-'+batchKey(batch,i);
    const nativeCharacters=job.batches.reduce((n,b)=>n+(b.nativeCharacters||0),0)+native.reduce((n,p)=>n+p.text.length,0);if(nativeCharacters>8000000)throw fail('这本书超过当前文字处理容量，原文件与已完成页保留。',413);
    await store.putBlob(target,Buffer.from(JSON.stringify({normalized:native})));
    if(!pageMap.length)await store.putBlob(base+'/result-'+batchKey(batch,i),Buffer.from(JSON.stringify({normalized:native})));
    await save(j=>{Object.assign(j.batches[i],{inspected:true,pageMap,nativeCount:native.length,nativeCharacters:native.reduce((n,p)=>n+p.text.length,0),nativeResult:target,...(!pageMap.length?{state:'done'}:{})});if(j.batches.every(b=>b.inspected)&&j.batches.some(b=>b.pageMap?.length)&&!j.consent)j.state='awaiting_consent';});return viewOf(await get(user,id));
   }
   if(batch.state==='submitting'){stage='provider_recover';if(batch.requestId&&provider.recover){const handle=await provider.recover(batch.requestId);if(handle){await save(j=>{j.batches[i].handle=handle;j.batches[i].state='submitted';j.state='running';j.error=null;});return viewOf(await get(user,id));}}await save(j=>{j.state='needs_review';j.error='上次请求未确认是否提交成功，为避免重复计费已暂停，请保留任务并联系管理员。';});return viewOf(await get(user,id));}
   if(!batch.handle){
    if(job.mode==='auto'&&job.batches.some(b=>!b.inspected))throw fail('原文件仍在检查',409);
    if(!job.consent)throw fail('请先允许识别本书',403);
    stage='split_batch';const {doc}=await sourceDocument(),part=await PDFDocument.create();const selected=await part.copyPages(doc,(batch.pageMap||Array.from({length:batch.count},(_,n)=>batch.start+n)).map(n=>n-1));selected.forEach(p=>part.addPage(p));const bytes=Buffer.from(await part.save());let fileUrl;
    if(bytes.length>maxBatchBytes){if(batch.count===1)throw fail('单页扫描文件超过 20 MB，请减小页面图片后重试',413);const left=Math.floor(batch.count/2);await save(j=>{j.batches.forEach((b,n)=>{b.storageKey??=String(n);});j.batches.splice(i,1,{start:batch.start,count:left,state:'new',storageKey:randomUUID()},{start:batch.start+left,count:batch.count-left,state:'new',storageKey:randomUUID()});});return viewOf(await get(user,id));}
    if(store.putSingleBlob&&store.signedBlob){stage='stage_batch';const target=base+'/input-'+batchKey(batch,i);await store.putSingleBlob(target,bytes);fileUrl=await store.signedBlob(target,{expiresIn:3600});}
    await reservePages(user,await current());const requestId=randomUUID();await save(j=>{j.batches[i].state='submitting';j.batches[i].requestId=requestId;});
    stage='provider_submit';const handle=await provider.submit(bytes,{batchId:requestId,fileUrl});stage='save_provider_handle';await save(j=>{j.batches[i].handle=handle;j.batches[i].state='submitted';});
   }else{
    readIndex=i;stage='provider_status';
    await save(j=>{j.pollSequence=(j.pollSequence||0)+1;j.batches[i].pollOrder=j.pollSequence;});
    const state=await provider.status(batch.handle);if(state.state==='failed'){await save(j=>{j.batches[i].state='failed';j.batches[i].confirmedFailed=true;});throw fail('PaddleOCR 未能完成这一批页面，请保留任务后重试',502);}
    if(state.state==='done'){
     stage='provider_result';const raw=await provider.result(batch.handle);stage='save_raw';await store.putBlob(base+'/raw-'+batchKey(batch,i),Buffer.from(JSON.stringify(raw)));if(raw.pages?.length!==(batch.pageMap?.length??batch.count))throw fail('识别返回页数不完整，未加入书房',422);
     const recognized=raw.pages.map((p,n)=>normalizePaddlePage(p,batch.pageMap?.[n]??batch.start+n)),native=batch.nativeResult?JSON.parse(await store.blob(batch.nativeResult)).normalized:[],normalized=[...native,...recognized].sort((a,b)=>a.page-b.page);if(normalized.length!==batch.count)throw fail('页面覆盖不完整，原文件与结果保留。',422);await store.putBlob(base+'/result-'+batchKey(batch,i),Buffer.from(JSON.stringify({normalized})));await save(j=>{j.batches[i].state='done';});
    }
    await save(j=>{j.batches[i].readFailures=0;});
   }
   return viewOf(await get(user,id));
  }catch(error){
   const readRetry=readIndex!==null&&['provider_status','provider_result'].includes(stage)&&['NetworkError','RequestTimeoutError','PollTimeoutError','ServiceUnavailableError'].includes(error.name);
   const connectionCode=typeof error.message==='string'?error.message.match(/^Connection failed: (PADDLE_TRANSPORT_(?:API|RESULT)_[A-Z][A-Z0-9_]{0,35})$/)?.[1]:null;
   const failureCode=error.code||connectionCode;
   const retry=await save(j=>{j.failure={stage,name:/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name||'')?error.name:'Error',status:Number.isInteger(error.statusCode||error.status)?error.statusCode||error.status:null,code:/^[A-Z][A-Z0-9_]{0,63}$/.test(failureCode||'')?failureCode:null};if(readRetry){const b=j.batches[readIndex];b.readFailures=(b.readFailures||0)+1;if(b.readFailures<=3){j.state='running';j.error=null;return true;}}if(j.state==='publishing'){if([400,413,422].includes(error.status)){j.state='failed';j.error=error.status===413?'已整理内容超过单本容量，原文件与识别结果保留，可取消整理。':'整理结果未通过正文校验，原文件与识别结果保留。';}else j.error='入库结果正在核对，请继续处理任务。';return false;}const pending=j.batches.some(b=>b.state==='submitting');j.state=pending?'needs_review':'failed';j.error=pending?'请求结果未确认，为避免重复提交已暂停。':'解析未完成，原文件和已完成页面已保留。';return false;}).catch(()=>false);if(retry)return viewOf(await get(user,id));throw fail('解析暂未完成，已保存进度。可重新打开上传窗口查看。',error.status||503);
  }finally{await store.mutate(base,null,j=>{if(j?.lease?.token===token)j.lease=null;});}
 }
 async function resume(u,id){await store.mutate(key(u,id),null,j=>{if(!j)throw fail('找不到解析任务',404);if(j.state==='needs_review'&&j.batches.some(b=>b.state==='submitting'&&b.requestId)&&provider.recover){j.state='running';j.error=null;}else if(j.state==='failed'){for(const b of j.batches){b.readFailures=0;if(b.confirmedFailed){delete b.handle;delete b.confirmedFailed;b.state='new';}}j.state=j.prepared?'running':'preparing';j.error=null;}});return viewOf(await get(u,id));}
 return {prepare,advance,resume,findSource,consent,preview,view:async(u,id)=>viewOf(await get(u,id)),list:async u=>{const ids=(await store.read(index(u),{jobs:[]})).jobs;return Promise.all(ids.slice(-20).map(id=>get(u,id).then(viewOf)));},cancel:async(u,id)=>{await store.mutate(key(u,id),null,j=>{if(!j)throw fail('找不到解析任务',404);if(j.state==='publishing')throw fail('正在完成入库，请稍后查看',409);if(j.state!=='done'){j.state='cancelled';j.lease=null;}});return viewOf(await get(u,id));}};
}
