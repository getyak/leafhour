// GET-195 backend: the child chat.annotations service. One private atomic
// wrapper per owner and book at users/<owner-digest>/annotations/<book-digest>.json
// holds {archive,runs} so claims, cancellation fences and late publications
// share one lock/transaction. It reuses the parent chat service's read/mutate
// primitives, owner quota and global reservations; it never creates its own
// locking or billing subsystem and keeps its own active map because parent
// close assumes chat.finish. Only the pure archive leaves through export;
// runtime requests, run authority, leases and identity never do.
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createAnnotationArchive,validateAnnotationArchive,createAnnotationThread,appendAnnotationMessage,removeAnnotationThread,mergeAnnotationArchives} from '../app/reader-annotation-records.mjs';
import {normalizeReadingChatQuote,validateCurrentReadingChatQuote} from '../app/reading-chat-quote.mjs';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
import {findHighlight} from '../app/highlights.mjs';
import {createReadingAgentTools} from './reading-agent-tools.mjs';
import {createAnnotationReadTools,readAnnotationPage,validateAnnotationReadArgs} from './reader-annotation-tools.mjs';

const RUN_MS=90000,CANCEL_POLL_MS=500,MAX_RUNS=100;
const FAILED='这次解释未通过生成或来源核验，你的输入已保留。';
const EXPIRED='上次解释已中断或超时，你的输入已保留。';
const EXPLAIN_REQUESTS={en:'Please explain the selected words in English.', 'zh-Hans':'请用简体中文解释这段选中的文字。', 'zh-Hant':'請用繁體中文解釋這段選取的文字。', ja:'選択した文章を日本語で説明してください。'};
const PROVENANCE={source:'site-agent',label:'Leafhour reading agent'};
const EXTERNAL_PROVENANCE={source:'external-agent',label:'External Agent'};
const READ_STATUS={INVALID_ARGUMENTS:400,SNAPSHOT_CHANGED:409,UNAVAILABLE:503};
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&value.isWellFormed();
const recordId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
// JSONB object key order is not part of immutable request or quote identity.
const equal=isDeepStrictEqual;
// JSON storage canonicalizes signed zero. Normalize valid offset zeros before
// recording or comparing immutable requests, without weakening other values.
const normalizeQuote=value=>{
 const quote=normalizeReadingChatQuote(value);
 for(const part of quote.parts){if(part.start===0)part.start=0;if(part.end===0)part.end=0;}
 return quote;
};
const safeActivity=value=>(Array.isArray(value)?value:[]).slice(-48).map(item=>Object.fromEntries(['tool','label','status','bookId','chapterId'].filter(key=>typeof item[key]==='string'&&item[key].length<=200).map(key=>[key,item[key]])));
const safeRequest=run=>({id:run.id,threadId:run.threadId,status:run.status,createdAt:run.createdAt,...(run.error?{error:run.error}:{}),...(Array.isArray(run.activity)&&run.activity.length?{activity:safeActivity(run.activity)}:{})});
const emptyState=bookId=>({archive:createAnnotationArchive(bookId),runs:[]});

export function createReaderAnnotationsService({library,bookFor,identity,dataDir,read,mutate,quota,reserveGlobal,releaseGlobal,clock=Date.now,generator=null,onError=()=>{},getClosed=()=>false}){
 if(!library?.records||typeof bookFor!=='function'||typeof read!=='function'||typeof mutate!=='function'||typeof quota!=='function'||typeof reserveGlobal!=='function'||typeof releaseGlobal!=='function'||!dataDir)throw TypeError('Annotation service requires the parent chat closures');
 let closed=false;
 const active=new Map();
 const isClosed=()=>closed||getClosed();
 const stateFile=(user,bookId)=>path.join(dataDir,'users',digest(identity(user).id),'annotations',digest(bookId)+'.json');
 const mutateState=(user,bookId,operation)=>mutate(stateFile(user,bookId),emptyState(bookId),operation);
 const readState=(user,bookId)=>read(stateFile(user,bookId),emptyState(bookId));
 // An external grant closure may answer with the canonical grant owner or just
 // true; any other identity is a wrong-owner authorization and must fail closed.
 const allowedBy=async(authorize,user)=>{const result=await Promise.resolve(authorize());return result===true||!!result&&typeof result==='object'&&result.id===user.id;};
 const expire=(data,now)=>{for(const run of data.runs)if(run.status==='running'&&(!Number.isFinite(run.expiresAt)||run.expiresAt<=now))Object.assign(run,{status:'failed',error:EXPIRED});};
 const threadOf=(data,book,threadId)=>{
  const archive=validateAnnotationArchive(data.archive,book,{historical:true});
  return structuredClone(archive.threads.find(row=>row.id===threadId)||null);
 };
 const bookMeta=book=>({bookId:book.bookId,contentVersion:book.contentVersion,title:book.title});
 const chapterFor=(book,chapterId)=>book.chapters?.find(row=>row.id===chapterId)||null;
 const historyFor=(messages,runs)=>{
  const unanswered=new Set(runs.filter(run=>run.status!=='completed').map(run=>run.userMessageId).filter(Boolean));
  const groups=[];let pending=null;
  for(const message of messages){
   if(unanswered.has(message.id))continue;
   if(message.origin==='user'){pending=message;continue;}
   if(pending){groups.push([{role:'user',content:pending.body},{role:'assistant',content:message.body}]);pending=null;}
   else groups.push([{role:'assistant',content:message.body}]);
  }
  return groups.slice(-6).flat();
 };
 function normalizeInput(input,book){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('注解请求格式不正确');
  const allowed=['id','threadId','quote','highlightId','text','responseLocale'];
  if(!Object.keys(input).every(key=>allowed.includes(key))||!['id','threadId','quote'].every(key=>Object.hasOwn(input,key)))fail('注解请求格式不正确');
  if(!recordId(input.id)||!recordId(input.threadId))fail('注解请求标识不正确');
  const quote=normalizeQuote(input.quote);
  if(quote.bookId!==book.bookId)fail('所选文字不属于这本书',409);
  // Project only immutable fields; persistence may reorder object keys.
  const responseLocale=input.responseLocale??'zh-Hans';
  if(!Object.hasOwn(EXPLAIN_REQUESTS,responseLocale))fail('回答语言不正确');
  const payload={id:input.id,threadId:input.threadId,quote,responseLocale};
  if(input.highlightId!==undefined){if(!recordId(input.highlightId))fail('高亮标识不正确');payload.highlightId=input.highlightId;}
  if(input.text!==undefined){if(!text(input.text,2000))fail('追问请提交不超过 2,000 字的实际内容');payload.text=input.text;}
  return payload;
 }
 // The highlight must be this owner's live record with the same source offsets,
 // layer and current content as the selected quote; aliases resolve canonically.
 async function resolveHighlight(user,book,payload,thread){
  const records=await library.records(user,book.bookId);
  const row=findHighlight(records?.highlights||[],payload.highlightId);
  if(!row||row.deletedAt)fail('找不到这条高亮',404);
  if(row.bookId!==book.bookId||row.contentVersion!==book.contentVersion)fail('高亮不属于当前原文',409);
  const parts=row.parts||[],quote=payload.quote.parts;
  if(quote.length!==parts.length)fail('高亮与所选文字不一致',409);
  for(let i=0;i<parts.length;i++){
   const held=parts[i],selected=quote[i],layer=held.language==='en'?'original':held.variant;
   if(selected.passageId!==held.passageId||selected.layer!==layer||selected.start!==held.start||selected.end!==held.end||selected.text!==held.text)fail('高亮与所选文字不一致',409);
  }
  // The thread's highlight binding is immutable once created.
  if(thread&&thread.highlightId!==row.id)fail('高亮标识与线程不一致',409);
  return row;
 }
 // Worst-case allowed answer bytes are validated by the pure model against a
 // temporary clone before paid dispatch; the reserved words are never saved.
 function reservePendingCapacity(archive,runs,stamp){
  const reserved=structuredClone(archive);
  // JSON control escapes use six bytes per UTF-16 unit, bounding ALL allowed
  // bodies and citation texts independently of the selected anchor. These
  // synthetic placeholders never become source claims or stored content.
  const worst={origin:'ai',body:'\u0001'.repeat(12000),createdAt:stamp,provenance:PROVENANCE};
  for(const run of runs.filter(run=>run.status==='running')){
   const thread=reserved.threads.find(row=>row.id===run.threadId);
   if(!thread||thread.deletedAt)continue;
   let message=thread.messages.find(row=>row.id===run.aiMessageId);
   if(message)fail('正在生成的回答标识与导入消息冲突',409);
   if(!message){
    if(thread.messages.length>=20)fail('注解线程已没有回答空间',413);
    message={...worst,id:run.aiMessageId};thread.messages.push(message);
   }
   message.sourceRefs=Array.from({length:20},()=>({passageId:'x'.repeat(128),layer:'interpretive',quote:'\u0001'.repeat(2000)}));
  }
  reserved.revision=Number.MAX_SAFE_INTEGER;
  if(Buffer.byteLength(JSON.stringify(reserved))>1048576)fail('注解归档已没有完整回答空间，请先导出保存',413);
 }
 function reserveCapacity(archive,book,payload,aiMessageId,stamp,runs=[]){
  // The real model validates the new slot/current source. Other live requests
  // also hold reservations, so independent threads cannot overbook the archive.
  appendAnnotationMessage(archive,book,payload.threadId,{id:aiMessageId,origin:'ai',body:'reserved',createdAt:stamp,provenance:PROVENANCE});
  reservePendingCapacity(archive,[...runs,{threadId:payload.threadId,aiMessageId,status:'running'}],stamp);
 }
 function jobFor(book,payload,thread,history,nonce,signal,tools){
  const first=payload.quote.parts[0],chapter=chapterFor(book,payload.quote.chapterId);
  return {kind:'annotation',book:bookMeta(book),passageId:first.passageId,chapterId:payload.quote.chapterId,chapterTitle:chapter?.title||null,text:payload.text??EXPLAIN_REQUESTS[payload.responseLocale],quote:payload.quote,history,runId:nonce,signal,tools};
 }
 function watchRun(user,bookId,id,nonce,controller){
  let stopped=false,timer;
  const stop=()=>{stopped=true;clearTimeout(timer);controller.signal.removeEventListener('abort',stop);};
  const schedule=()=>{timer=setTimeout(check,CANCEL_POLL_MS);timer.unref?.();};
  async function check(){
   if(stopped||controller.signal.aborted)return;
   try{
    // Shared run authority: another process may cancel or fence this request.
    const data=await readState(user,bookId);
    if(stopped||controller.signal.aborted)return;
    const run=data.runs.find(row=>row.id===id);
    if(isClosed()||!run||run.nonce!==nonce||run.status!=='running'||!Number.isFinite(run.expiresAt)||run.expiresAt<=clock()){controller.abort();return;}
   }catch{if(!stopped)controller.abort();return;}
   if(!stopped)schedule();
  }
  controller.signal.addEventListener('abort',stop,{once:true});
  schedule();return stop;
 }
 async function finishRun(user,bookId,id,nonce,changes,book){
  return mutateState(user,bookId,async data=>{
   const now=clock();expire(data,now);
   const run=data.runs.find(row=>row.id===id);
   if(!run)fail('找不到这次注解请求',404);
   if(run.status==='running'&&run.nonce===nonce)Object.assign(run,changes);
   return {thread:threadOf(data,book||await bookFor(user,bookId),run.threadId),request:safeRequest(run)};
  });
 }
 async function receiptOf(user,bookId,payload,book){
  const data=await readState(user,bookId),now=clock();expire(data,now);
  const run=data.runs.find(row=>row.id===payload.id);
  if(!run||!equal(run.payload,payload))fail('重复提交标识与原请求不一致',409);
  return {thread:threadOf(data,book,run.threadId),request:safeRequest(run)};
 }
 async function view(user,bookId){
  const book=await bookFor(user,bookId);
  return mutateState(user,bookId,data=>{
   expire(data,clock());
   return {available:!isClosed()&&typeof generator==='function',archive:validateAnnotationArchive(data.archive,book,{historical:true}),requests:data.runs.map(safeRequest)};
  });
 }
 async function explain(user,bookId,input,{authorize=async()=>true,signal}={}){
  identity(user);
  if(!text(bookId,128))fail('找不到这本书',404);
  const book=await bookFor(user,bookId);
  const payload=normalizeInput(input,book);
  // Exact terminal or running retries are historical receipts: compare the
  // normalized immutable payload before any current-source new-write check.
  const prior=await readState(user,bookId),now=clock();expire(prior,now);
  if(prior.runs.some(run=>run.id===payload.id))return receiptOf(user,bookId,payload,book);
  // Authorization is checked before any claim or side effect. A denied path
  // returns a cancelled safe request and never publishes or charges.
  if(signal?.aborted||!(await authorize())||signal?.aborted)return {thread:threadOf(prior,book,payload.threadId),request:{id:payload.id,threadId:payload.threadId,status:'cancelled',createdAt:new Date(now).toISOString()}};
  // Current book, stale quote, highlight ownership and encoder preflight all
  // happen before run claim, quota or provider dispatch.
  try{validateCurrentReadingChatQuote(payload.quote,book);}catch{fail('所选文字已变化，请移除或重新选择后再解释。',422);}
  const thread=prior.archive.threads.find(row=>row.id===payload.threadId);
  if(thread&&thread.deletedAt)fail('这条注解线程已删除',409);
  if(thread&&!equal(thread.quote,payload.quote))fail('注解锚点创建后不可更改',409);
  const highlightRow=payload.highlightId!==undefined?await resolveHighlight(user,book,payload,thread):null;
  const boundHighlight=payload.highlightId!==undefined?payload.highlightId:thread?.highlightId;
  const history=thread?historyFor(thread.messages,prior.runs):[];
  const jobProbe=jobFor(book,payload,thread,history,'probe',null,null);
  encodeReadingChatInput(jobProbe);
  const nonce=randomUUID(),stamp=new Date(now).toISOString();
  const aiMessageId='ai-'+digest(payload.id).slice(0,32),userMessageId=payload.text!==undefined?'um-'+digest(payload.id).slice(0,32):null;
  const claim=await mutateState(user,bookId,async data=>{
   expire(data,clock());
   const old=data.runs.find(run=>run.id===payload.id);
   if(old){
    if(!equal(old.payload,payload))fail('重复提交标识与原请求不一致',409);
    return {created:false,run:old,thread:threadOf(data,book,old.threadId)};
   }
   // One thread serializes requests: a different running request id conflicts.
   if(data.runs.some(run=>run.threadId===payload.threadId&&run.status==='running'))fail('这个注解线程已有一条请求正在处理',409);
   if(signal?.aborted)fail('请求已取消',408);
   if(isClosed()||typeof generator!=='function')fail('注解服务尚未配置',503);
   if(data.runs.length>=MAX_RUNS)fail('这本书的注解请求记录已达上限，请先保留导出备份',413);
   const existing=data.archive.threads.find(row=>row.id===payload.threadId);
   if(existing?.deletedAt)fail('这条注解线程已删除',409);
   if(existing&&!equal(existing.quote,payload.quote))fail('注解锚点创建后不可更改',409);
   if(existing&&highlightRow&&existing.highlightId!==undefined&&existing.highlightId!==highlightRow.id)fail('高亮标识与线程不一致',409);
   // Source checks repeat inside the shared-key transaction. A source ACK
   // touching this key before commit forces hosted CAS retries to see new text.
   const live=await bookFor(user,bookId);
   try{validateCurrentReadingChatQuote(payload.quote,live);}catch{fail('所选文字已变化，请重新选择',422);}
   if(boundHighlight!==undefined)await resolveHighlight(user,live,{...payload,highlightId:boundHighlight},existing);
   const currentHistory=existing?historyFor(existing.messages,data.runs):[];
   encodeReadingChatInput(jobFor(live,payload,existing,currentHistory,'probe',null,null));
   if(signal?.aborted)fail('请求已取消',408);
   let archive=data.archive;
   if(!existing)archive=createAnnotationThread(archive,book,{id:payload.threadId,quote:payload.quote,...(highlightRow?{highlightId:highlightRow.id}:{})},{now:stamp});
   if(userMessageId)archive=appendAnnotationMessage(archive,book,payload.threadId,{id:userMessageId,origin:'user',body:payload.text,createdAt:stamp});
   // Reserve the AI slot and worst-case answer bytes so a charged answer can
   // never become unpersistable; the reserved clone is discarded, never saved.
   reserveCapacity(archive,book,payload,aiMessageId,stamp,data.runs);
   const run={id:payload.id,nonce,threadId:payload.threadId,status:'running',createdAt:stamp,expiresAt:now+RUN_MS,payload,aiMessageId,...(userMessageId?{userMessageId}:{}),activity:[]};
   data.archive=archive;data.runs.push(run);
   return {created:true,run,thread:threadOf(data,book,payload.threadId),history:currentHistory};
  });
  if(!claim.created)return {thread:claim.thread,request:safeRequest(claim.run)};
  const controller=new AbortController();
  const forward=()=>controller.abort();signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)controller.abort();
  const running={controller,user,bookId,id:payload.id,nonce};active.set(nonce,running);
  let timer,stopWatching=()=>{},ticket=null,phase='record-request';
  try{
   if(isClosed()||controller.signal.aborted)return await finishRun(user,bookId,payload.id,nonce,{status:'cancelled'},book);
   phase='quota';await quota(user,nonce);
   ticket=await reserveGlobal(nonce);
   // Cancellation may already be shared state from another process.
   const current=await readState(user,bookId),runningNow=current.runs.find(run=>run.id===payload.id);
   if(!runningNow||runningNow.nonce!==nonce||runningNow.status!=='running'||runningNow.expiresAt<=clock()||controller.signal.aborted)return {thread:threadOf(current,book,payload.threadId),request:safeRequest(runningNow||claim.run)};
   const abort=new Promise((resolve,reject)=>{
    controller.signal.addEventListener('abort',()=>reject(Object.assign(Error('回答已取消或超时'),{status:408})),{once:true});
   });
   abort.catch(()=>{}); // cancellation may arrive while authorization still awaits
   timer=setTimeout(()=>controller.abort(),Math.max(0,now+RUN_MS-clock()));timer.unref?.();
   stopWatching=watchRun(user,bookId,payload.id,nonce,controller);
   const onActivity=async activity=>{
    if(controller.signal.aborted)return;
    await mutateState(user,bookId,data=>{
     const run=data.runs.find(row=>row.id===payload.id);
     if(controller.signal.aborted||!run||run.nonce!==nonce||run.status!=='running'||run.expiresAt<=clock())return null;
     const item=safeActivity([activity])[0];if(!item)return null;
     const items=run.activity||[];
     const priorIndex=items.findLastIndex(row=>row.tool===item.tool&&row.status==='running');
     if(item.status!=='running'&&priorIndex>=0)items[priorIndex]=item;else items.push(item);
     run.activity=safeActivity(items);return null;
    });
   };
   const sourceTools=createReadingAgentTools({library,user,preferenceAccess:false,bookId,passageId:payload.quote.parts[0].passageId,scope:'book',signal:controller.signal,onActivity});
   const tools=createAnnotationReadTools({tools:sourceTools,readView:async()=>{const data=await readState(user,bookId);return {bookId,contentVersion:book.contentVersion,archive:data.archive};}});
   // Authorization is checked again immediately before provider dispatch.
   if(!(await authorize()))return await finishRun(user,bookId,payload.id,nonce,{status:'cancelled'},book);
   phase='generation';
   const dispatchState=await readState(user,bookId),dispatchRun=dispatchState.runs.find(run=>run.id===payload.id);
   if(!dispatchRun||dispatchRun.nonce!==nonce||dispatchRun.status!=='running')return await receiptOf(user,bookId,payload,book);
   const candidate=await Promise.race([Promise.resolve().then(()=>{
    if(controller.signal.aborted||signal?.aborted||isClosed()||clock()>=dispatchRun.expiresAt)throw Object.assign(Error('请求已取消或超时'),{status:408});
    return generator(jobFor(book,payload,thread,claim.history,nonce,controller.signal,tools));
   }),abort]);
   phase='verify-source';
   const body=candidate&&['annotation','conversation'].includes(candidate.kind)&&typeof candidate.text==='string'?candidate.text:candidate?.summary;
   if(!text(body,12000))fail('解释内容无效');
   await tools.verify();
   const sourceRefs=tools.sources().map(ref=>({passageId:ref.passageId,layer:ref.layer,quote:ref.quote}));
   if(sourceRefs.length>20||sourceRefs.some(ref=>!recordId(ref.passageId)||!['original','literal','interpretive'].includes(ref.layer)||!text(ref.quote,2000)))fail('回答引用超过注解存储限制');
   const message={id:aiMessageId,origin:'ai',body,createdAt:new Date(clock()).toISOString(),provenance:PROVENANCE,...(sourceRefs.length?{sourceRefs}:{})};
   phase='verify-version';
   const fresh=await bookFor(user,bookId);
   if(fresh.contentVersion!==book.contentVersion)fail('原文版本已变化',409);
   try{validateCurrentReadingChatQuote(payload.quote,fresh);}catch{fail('所选文字已变化，解释未保存',409);}
   phase='publish';
   const published=await mutateState(user,bookId,async data=>{
    const now2=clock();expire(data,now2);
    const run=data.runs.find(row=>row.id===payload.id);
    if(!run||run.nonce!==nonce)return {done:true,thread:threadOf(data,book,payload.threadId),request:safeRequest(data.runs.find(row=>row.id===payload.id)||claim.run)};
    if(run.status!=='running')return {done:true,thread:threadOf(data,book,run.threadId),request:safeRequest(run)};
    // Bounded read-only rechecks after the publication's own awaits; the
    // callback is retried by CAS and holds no quota, provider call or timer.
    const live=await bookFor(user,bookId);
    if(live.contentVersion!==book.contentVersion){run.status='failed';run.error=FAILED;return {done:true,thread:threadOf(data,book,run.threadId),request:safeRequest(run)};}
    try{validateCurrentReadingChatQuote(run.payload.quote,live);}catch{run.status='failed';run.error=FAILED;return {done:true,thread:threadOf(data,book,run.threadId),request:safeRequest(run)};}
    const held=boundHighlight!==undefined?findHighlight((await library.records(user,bookId))?.highlights||[],boundHighlight):null;
    if(boundHighlight!==undefined&&(!held||held.deletedAt)){run.status='cancelled';return {done:true,thread:threadOf(data,book,run.threadId),request:safeRequest(run)};}
    if(!(await authorize())){run.status='cancelled';return {done:true,thread:threadOf(data,book,run.threadId),request:safeRequest(run)};}
    // Final run/deletion/clock/closed/abort check comes after the awaits.
    expire(data,clock());
    const last=data.runs.find(row=>row.id===payload.id);
    if(!last||last.nonce!==nonce||last.status!=='running'||clock()>=last.expiresAt||isClosed()||controller.signal.aborted||data.archive.threads.find(row=>row.id===payload.threadId)?.deletedAt){
     if(last&&last.status==='running')last.status='cancelled';
     return {done:true,thread:threadOf(data,book,payload.threadId),request:safeRequest(last||claim.run)};
    }
    // A fence that won earlier made this run terminal; only a live run publishes.
    data.archive=appendAnnotationMessage(data.archive,live,payload.threadId,message);
    last.status='completed';last.error=undefined;
    return {done:true,published:true,thread:threadOf(data,book,payload.threadId),request:safeRequest(last)};
   });
   return {thread:published.thread,request:published.request};
  }catch(error){
   if(!controller.signal.aborted&&error?.status!==429)try{onError(error,{phase});}catch{}
   const changes=controller.signal.aborted?{status:'cancelled'}:{status:'failed',error:FAILED};
   let result;
   try{result=await finishRun(user,bookId,payload.id,nonce,changes,book);}catch{fail('请求结果暂时无法确认，请使用原请求标识重试查询',503);}
   if(error?.status===429)throw error;
   return result;
  }finally{
   stopWatching();clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',forward);active.delete(nonce);
   if(ticket)await releaseGlobal(ticket).catch(()=>{});
  }
 }
 async function cancel(user,bookId,requestId){
  const book=await bookFor(user,bookId);
  if(!recordId(requestId))fail('请求标识不正确');
  const result=await mutateState(user,bookId,data=>{
   expire(data,clock());
   const run=data.runs.find(row=>row.id===requestId);
   if(!run)fail('找不到这次注解请求',404);
   if(run.status==='running')run.status='cancelled';
   return {thread:threadOf(data,book,run.threadId),request:safeRequest(run)};
  });
  for(const run of active.values())if(run.user.id===user.id&&run.bookId===bookId&&run.id===requestId)run.controller.abort();
  return result;
 }
 async function remove(user,bookId,threadId){
  const book=await bookFor(user,bookId);
  if(!recordId(threadId))fail('线程标识不正确');
  const result=await mutateState(user,bookId,data=>{
   expire(data,clock());
   const thread=data.archive.threads.find(row=>row.id===threadId);
   if(!thread)fail('找不到这条注解线程',404);
   data.archive=removeAnnotationThread(data.archive,book,threadId,{now:new Date(clock()).toISOString()});
   const cancelled=[];
   for(const run of data.runs)if(run.threadId===threadId&&run.status==='running'){run.status='cancelled';cancelled.push(run.id);}
   return {thread:threadOf(data,book,threadId),cancelled};
  });
  for(const id of result.cancelled)for(const run of active.values())if(run.user.id===user.id&&run.bookId===bookId&&run.id===id)run.controller.abort();
  return result.thread;
 }
 async function exportArchive(user,bookId){
  const book=await bookFor(user,bookId),data=await readState(user,bookId);
  return validateAnnotationArchive(data.archive,book,{historical:true});
 }
 // GET-195 external write: an explicitly granted agent stores one free AI
 // explanation through the same owner/book wrapper, parent lock and CAS as the
 // site service. No model call, quota or reservation ticket is involved; the
 // server forces the attribution and the first timestamp and answers with a
 // narrow receipt only, never the Web thread or anyone's private words.
 async function putExternal(user,bookId,input,{authorize=async()=>true}={}){
  identity(user);
  if(!text(bookId,128))fail('找不到这本书',404);
  if(!input||typeof input!=='object'||Array.isArray(input))fail('注解请求格式不正确');
  const allowed=['bookId','threadId','messageId','quote','body','highlightId'];
  if(!Object.keys(input).every(key=>allowed.includes(key))||!['bookId','threadId','messageId','quote','body'].every(key=>Object.hasOwn(input,key)))fail('注解请求格式不正确');
  if(input.bookId!==bookId)fail('所选文字不属于这本书',409);
  if(!recordId(input.threadId)||!recordId(input.messageId))fail('注解请求标识不正确');
  if(!text(input.body,12000))fail('注解内容请提交不超过 12,000 字的实际内容');
  const quote=normalizeQuote(input.quote);
  if(quote.bookId!==bookId)fail('所选文字不属于这本书',409);
  if(input.highlightId!==undefined&&!recordId(input.highlightId))fail('高亮标识不正确');
  const payload={quote,body:input.body,...(input.highlightId!==undefined?{highlightId:input.highlightId}:{})};
  // Strict current grant before any lookup or history; the same closure is
  // re-checked inside the shared-key transaction after every CAS retry.
  if(!(await allowedBy(authorize,user)))fail('Agent 授权无效或范围不足',403);
  // The first timestamp is generated once and reused across CAS retries, so an
  // exact retry can never look like a conflicting second message.
  const stamp=new Date(clock()).toISOString();
  return mutateState(user,bookId,async data=>{
   expire(data,clock());
   if(!(await allowedBy(authorize,user)))fail('Agent 授权无效或范围不足',403);
   const thread=data.archive.threads.find(row=>row.id===input.threadId);
   // Canonicalize only the highlight identity, without current-source checks.
   // Historical exact receipts also accept an originally supplied request alias.
   const highlightIdentity=payload.highlightId===undefined||thread?.highlightId===payload.highlightId?payload.highlightId:findHighlight((await library.records(user,bookId))?.highlights||[],payload.highlightId)?.id||payload.highlightId;
   const stored=thread?.messages.find(row=>row.id===input.messageId);
   if(stored){
    // An exact immutable receipt survives later source edits as history while
    // the current grant is still required; any other payload conflicts.
    if(stored.origin==='ai'&&equal(stored.provenance,EXTERNAL_PROVENANCE)&&stored.body===payload.body&&equal(thread.quote,payload.quote)&&thread.highlightId===highlightIdentity)return {threadId:thread.id,messageId:stored.id,status:'stored',createdAt:stored.createdAt};
    fail('重复提交标识与原注解不一致',409);
   }
   if(thread?.deletedAt)fail('这条注解线程已删除',409);
   if(thread&&(!equal(thread.quote,payload.quote)||thread.highlightId!==highlightIdentity))fail('注解锚点创建后不可更改',409);
   if(data.runs.some(run=>run.aiMessageId===input.messageId||run.userMessageId===input.messageId))fail('这条消息标识已属于正在生成的回答',409);
   // Read-only current checks for a NEW message only, repeated after retries.
   const live=await bookFor(user,bookId);
   try{validateCurrentReadingChatQuote(payload.quote,live);}catch{fail('所选文字已变化，注解未保存',422);}
   const highlightRow=payload.highlightId!==undefined?await resolveHighlight(user,live,{...payload,highlightId:highlightIdentity},thread):null;
   const message={id:input.messageId,origin:'ai',body:payload.body,createdAt:stamp,provenance:EXTERNAL_PROVENANCE};
   let archive=data.archive;
   if(!thread)archive=createAnnotationThread(archive,live,{id:input.threadId,quote:payload.quote,...(highlightRow?{highlightId:highlightRow.id}:{})},{now:stamp});
   archive=appendAnnotationMessage(archive,live,input.threadId,message);
   // Pending paid answers keep their message slots and worst-case bytes before
   // this external message may commit; the projected clone is discarded.
   reservePendingCapacity(archive,data.runs,stamp);
   data.archive=archive;
   return {threadId:input.threadId,messageId:input.messageId,status:'stored',createdAt:stamp};
  });
 }
 // GET-195 external read: the same bounded AI-only pagination the reading job
 // tool serves, projected for a fresh current grant. It never serializes the
 // owner's Web archive view and never reaches other books, notes or activity.
 async function readExternal(user,bookId,args,{authorize=async()=>true}={}){
  identity(user);
  if(!text(bookId,128))fail('找不到这本书',404);
  const query=validateAnnotationReadArgs(args,{withBookId:true});
  if(query.bookId!==bookId)fail('注解读取参数无效');
  if(!(await allowedBy(authorize,user)))fail('Agent 授权无效或范围不足',403);
  const book=await bookFor(user,bookId);
  const page=await readAnnotationPage(query,async()=>{const data=await readState(user,bookId);return {bookId,contentVersion:book.contentVersion,archive:data.archive};});
  if(page?.error)fail(page.error.message,READ_STATUS[page.error.code]||400);
  return page;
 }
 // Grant-revocation ACK fence: a revoked grant's book gets one real same-key
 // commit even with empty runs and unchanged JSON, so an external put whose CAS
 // is still in flight must retry, re-authorize and fail. A failed touch fails
 // the revocation ACK honestly; an exact retry touches again.
 async function grantRevoked(ownerId,grantId){
  if(typeof ownerId!=='string'||!ownerId||typeof grantId!=='string'||!grantId)fail('撤回授权标识不正确');
  const rows=await library.grants({id:ownerId});
  const grant=rows.find(row=>row.id===grantId);
  if(!grant||!text(grant.bookId,128))fail('找不到这条授权',404);
  return mutateState({id:ownerId},grant.bookId,()=>null);
 }
 async function validateArchive(user,book,archive){
  identity(user);if(!book?.bookId)fail('找不到这本书',404);
  const incoming=validateAnnotationArchive(archive,book,{historical:true});
  const current=await readState(user,book.bookId);
  const projected=mergeAnnotationArchives(current.archive,incoming,book);
  expire(current,clock());reservePendingCapacity(projected,current.runs,new Date(clock()).toISOString());
  return incoming;
 }
 async function restoreArchive(user,book,archive){
  identity(user);if(!book?.bookId)fail('找不到这本书',404);
  await bookFor(user,book.bookId);
  return mutateState(user,book.bookId,async data=>{
   const applied=await bookFor(user,book.bookId);
   const merged=mergeAnnotationArchives(data.archive,archive,applied);
   expire(data,clock());reservePendingCapacity(merged,data.runs,new Date(clock()).toISOString());
   data.archive=merged;
   return validateAnnotationArchive(data.archive,applied,{historical:true});
  });
 }
 // Source-mutation ACK fence: read-only cross-key revalidation, then one CAS
 // write on this same wrapper. Cancellation targets the exact run nonce so a
 // fresh generation survives a late duplicate invalidation. This persists the
 // cancellation; local controller aborts are only an optimization.
 async function fence(user,bookId,event){
  if(!user?.id||user.is_anonymous||!text(bookId,128))return {cancelled:[]};
  // Read-only cross-key revalidation first; a read failure here must fail the
  // source-mutation ACK honestly instead of silently skipping the fence.
  await bookFor(user,bookId);await library.records(user,bookId);
  const ids=Array.isArray(event?.ids)?event.ids:[];
  const result=await mutateState(user,bookId,async data=>{
   const book=await bookFor(user,bookId),records=await library.records(user,bookId);
   expire(data,clock());
   const cancelled=[];
   for(const run of data.runs){
    if(run.status!=='running')continue;
    const thread=data.archive.threads.find(row=>row.id===run.threadId);
    const bound=run.payload.highlightId??thread?.highlightId;
    let affected=false;
    if(event?.type==='highlight-deleted'&&bound!==undefined&&ids.includes(bound))affected=true;
    else{
     try{validateCurrentReadingChatQuote(run.payload.quote,book);}catch{affected=true;}
     if(!affected&&bound!==undefined){const row=findHighlight(records?.highlights||[],bound);if(!row||row.deletedAt)affected=true;}
    }
    if(affected){run.status='cancelled';run.error=undefined;cancelled.push(run.id);}
   }
   return {cancelled};
  });
  for(const id of result.cancelled)for(const run of active.values())if(run.user.id===user.id&&run.bookId===bookId&&run.id===id)run.controller.abort();
  return result;
 }
 async function close(){
  closed=true;
  await Promise.all([...active.values()].map(async run=>{
   await finishRun(run.user,run.bookId,run.id,run.nonce,{status:'cancelled'},null).catch(()=>{});
   run.controller.abort();
  }));
  await delay(0);
 }
 return {get available(){return !isClosed()&&typeof generator==='function';},view,explain,cancel,remove,exportArchive,validateArchive,restoreArchive,putExternal,readExternal,grantRevoked,fence,close};
}
