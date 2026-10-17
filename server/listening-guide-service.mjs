import {randomUUID} from 'node:crypto';
import {audioError,audioHash,audioPassages} from './audio-content.mjs';
import {guideScope,guideBatches,validateGuide,guideLimits,guideTextLimits} from './listening-guide-content.mjs';
import {createGuideGenerator,guideInputSize} from './listening-guide-generator.mjs';

const leaseMs=90000;
const identity=owner=>{if(!owner?.id)throw audioError('请先进入自己的书房。',401,'authentication_required');return owner.id;};
const hidden=()=>audioError('找不到这次导听。',404,'not_found');
const equal=(a,b)=>audioHash(a)===audioHash(b);
const interrupted=()=>({code:'interrupted',message:'上次请求的结果尚不确定，已停止自动生成。你可以明确重新开始。'});
const jobs=data=>(data.guideJobs??=[]);
const safeError=error=>({code:typeof error.code==='string'&&/^[a-z_]+$/.test(error.code)?error.code:'guide_failed',message:error.status&&error.code?error.message:'导听未能准备完成，已有讲稿已保留。'});

function verifiedOutline(batch,candidate){
 if(!equal(candidate?.passageIds,batch.map(p=>p.id)))throw audioError('本批原文尚未完整阅读，未把部分内容标记为全书。',502,'incomplete_coverage');
 if(typeof candidate.summary!=='string'||!candidate.summary.trim()||candidate.summary.length>180||!Array.isArray(candidate.claims)||!candidate.claims.length||candidate.claims.length>3)throw audioError('导听要点格式未通过检查。',502,'invalid_guide');
 const index=new Map(batch.map(p=>[p.id,p]));
 const claims=candidate.claims.map(claim=>{
  if(typeof claim.text!=='string'||!claim.text.trim()||claim.text.length>180||!Array.isArray(claim.sourceRefs)||!claim.sourceRefs.length||claim.sourceRefs.length>2)throw audioError('导听要点格式未通过检查。',502,'invalid_guide');
  return {text:claim.text,sourceRefs:claim.sourceRefs.map(ref=>{
   const p=index.get(ref?.passageId);
   if(!p||ref.chapterId!==undefined&&ref.chapterId!==p.chapterId||typeof ref.quote!=='string'||!ref.quote.trim()||ref.quote.length>180||!p.original.includes(ref.quote))throw audioError('导听要点的出处不匹配。',502,'invalid_citation');
   return {chapterId:p.chapterId,passageId:p.id,quote:ref.quote};
  })};
 });
 const result={passageIds:batch.map(p=>p.id),summary:candidate.summary,claims};
 if(JSON.stringify(result).length>1800)throw audioError('单批导听要点过长。',502,'invalid_guide');
 return result;
}

function verificationBatches(book,script){
 const index=new Map(audioPassages(book).map(p=>[p.id,p])),batches=[];
 let turnIds=[],passageIds=new Set();
 const fits=(ids,turns)=>ids.size<=guideLimits.batchPassages&&[...ids].reduce((n,id)=>n+index.get(id).original.length,0)<=guideLimits.verificationCharacters&&guideInputSize({stage:'verify',bookId:book.bookId,contentVersion:book.contentVersion,intent:script.intent,passages:[...ids].map(id=>index.get(id)),turns})<=guideLimits.requestCharacters;
 for(const turn of script.turns){
  const own=new Set(turn.sourceRefs.map(r=>r.passageId));
  if(!fits(own,[turn]))throw audioError('这一轮讲稿引用了过多原文，未通过完整核验；候选文字已保留。',502,'invalid_guide');
  const next=new Set([...passageIds,...own]);
  if(turnIds.length&&!fits(next,script.turns.filter(t=>turnIds.includes(t.id)||t.id===turn.id))){batches.push({turnIds,passageIds:[...passageIds]});turnIds=[];passageIds=new Set();}
  turnIds.push(turn.id);for(const id of own)passageIds.add(id);
 }
 if(turnIds.length)batches.push({turnIds,passageIds:[...passageIds]});
 return batches;
}

// Keep the three-call reservation for ordinary short sources. If exact quotes
// contain heavy JSON escaping, a legal script can need multiple support calls
// even though its original fits one reading batch. Size the worst legal script
// with the adapter's own serializer before promising a one-call verification.
function singleVerificationFits(book,scope,passages){
 let ref=null,refSize=-1;
 for(const p of passages){
  let window=0,maximum=0;const widths=[];
  for(let i=0;i<p.original.length;i++){
   const width=JSON.stringify(p.original[i]).length-2;widths.push(width);window+=width;
   if(i>=500)window-=widths[i-500];maximum=Math.max(maximum,window);
  }
  const candidate={chapterId:p.chapterId,passageId:p.id,quote:'x'.repeat(maximum)},size=JSON.stringify(candidate).length;
  if(size>refSize){ref=candidate;refSize=size;}
 }
 const turns=Array.from({length:24},(_,i)=>({id:'turn-24',speaker:'questioner',kind:'explanation',text:'\0'.repeat(i===0?guideTextLimits[scope.intent]-23:1),sourceRefs:[ref,ref,ref,ref]}));
 return guideInputSize({stage:'verify',bookId:book.bookId,contentVersion:book.contentVersion,intent:scope.intent,passages,turns})<=guideLimits.requestCharacters;
}

function checkSupport(batch,candidate){
 const checks=candidate?.checks;
 if(!Array.isArray(checks)||checks.length!==batch.turnIds.length||new Set(checks.map(c=>c.turnId)).size!==checks.length||checks.some(c=>!batch.turnIds.includes(c.turnId)||typeof c.supported!=='boolean'))throw audioError('讲稿的重要主张尚未完整核验。',502,'unsupported_claim');
 if(checks.some(c=>!c.supported))throw audioError('讲稿中有原文尚未支持的主张，已保留候选文字供你查看。',502,'unsupported_claim');
 return checks.map(c=>({turnId:c.turnId,supported:true}));
}

// All durable transitions happen in store.mutate. Its callback may rerun after
// a CAS conflict, so callbacks contain no provider calls or other side effects.
export function createListeningGuideService({audio,library,generator=createGuideGenerator(),schedule,sliceDurationMs=80000}={}){
 if(!audio?.store||typeof library?.getBook!=='function')throw new TypeError('Guide service requires the shared audio store and library.');
 if(!Number.isFinite(sliceDurationMs)||sliceDurationMs<=0||sliceDurationMs>80000)throw new TypeError('Guide background slices must be bounded to 80 seconds.');
 const active=new Map(),attach=schedule||audio.schedule||(()=>{}),store=audio.store;
 const key=(owner,book,id)=>audioHash([owner.id,book,id]);
 const mutate=(owner,book,fn)=>store.mutate(identity(owner),book,fn);
 const publicJob=job=>({id:job.id,status:job.status,scope:structuredClone(job.scope),coverage:{...structuredClone(job.scope.coverage),covered:job.readPassageIds.length,complete:job.readPassageIds.length===job.scope.passageIds.length&&job.scope.coverage.complete},progress:{stage:job.stage,completedBatches:job.outlines.length,totalBatches:job.batchCount},...(job.sessionId?{sessionId:job.sessionId}:{}),...(job.dialogueId?{dialogueId:job.dialogueId}:{}),...(job.candidate?{transcript:{...structuredClone(job.candidate),verified:job.verification?.length===job.candidate.turns.length}}:{}),...(job.error?{error:structuredClone(job.error)}:{})});
 async function prepare(owner,bookId,input){
  identity(owner);const book=await library.getBook(owner,bookId),scope=guideScope(book,input),batches=guideBatches(book,scope),characters=batches.flat().reduce((n,p)=>n+p.original.length,0);
  // A script can require one bounded check per turn, never more than 24.
  const maxCalls=batches.length+1+(batches.length===1&&singleVerificationFits(book,scope,batches[0])?1:24),target=scope.intent==='book'?180:scope.intent==='intro'?90:300,max=Math.min(target,Math.max(45,Math.round(characters/8)));
  return {scope,sourceCount:scope.passageIds.length,coverage:scope.coverage,estimatedDurationSeconds:{min:Math.min(max,120,Math.max(20,Math.round(characters/15))),max},externalProcessing:{provider:'DeepSeek',stages:['outline','script','verify'],maxCalls,sourceBatches:batches.length,sourceCharacters:characters,privateNotes:false,available:typeof generator==='function'}};
 }
 async function snapshot(owner,bookId,id){
  const data=await store.read(identity(owner),bookId),job=jobs(data).find(j=>j.id===id);if(!job)throw hidden();return job;
 }
 async function current(owner,bookId,scope){const book=await library.getBook(owner,bookId);guideScope(book,scope);return book;}
 async function recover(owner,bookId,id){
  return mutate(owner,bookId,data=>{
   const job=jobs(data).find(j=>j.id===id);if(!job)throw hidden();
   if(job.status==='preparing'&&job.lease&&job.lease.expiresAt<=Date.now()){
    if(job.lease.inFlight){job.status='interrupted';job.error=interrupted();}job.lease=null;
   }
   return job;
  });
 }
 async function claim(owner,bookId,id){
  const token=randomUUID();return mutate(owner,bookId,data=>{
   const job=jobs(data).find(j=>j.id===id);if(!job||job.status!=='preparing')return null;
   if(job.lease?.expiresAt>Date.now())return null;
   if(job.lease?.inFlight){job.status='interrupted';job.error=interrupted();job.lease=null;return null;}
   job.lease={token,expiresAt:Date.now()+leaseMs,inFlight:false};return job;
  });
 }
 async function transition(owner,bookId,id,token,fn){
  return mutate(owner,bookId,data=>{
   const job=jobs(data).find(j=>j.id===id);if(job?.status!=='preparing'||job.lease?.token!==token)return null;
   fn(job);job.updatedAt=new Date().toISOString();return job;
  });
 }
 async function run(owner,bookId,id,controller){
  let submitted=0,token;
  try{
   while(!controller.signal.aborted){
    if(store.durable&&submitted>=1)return;
    const job=await claim(owner,bookId,id);if(!job)return;token=job.lease.token;
    const book=await current(owner,bookId,job.scope),batches=guideBatches(book,job.scope);
    if(controller.signal.aborted)return;
    if(job.stage==='budget'){
     if(store.durable&&typeof store.reserveGuideBudget!=='function')throw audioError('导听额度暂时无法核验。',503,'quota_unavailable');
     await store.reserveGuideBudget?.(owner.id,job.id,job.maxCalls);
     const next=await transition(owner,bookId,id,token,j=>{j.stage='outline';j.lease=null;});if(!next)return;continue;
    }
    if(job.stage==='publish'){
     const candidate=validateGuide(book,job.scope,job.candidate);
     if(job.verification.length!==candidate.turns.length||job.readPassageIds.length!==job.scope.passageIds.length)throw audioError('导听的阅读与主张核验尚未完成。',502,'incomplete_coverage');
     const live=await snapshot(owner,bookId,id);if(controller.signal.aborted||live.status!=='preparing'||live.lease?.token!==token)return;
     const dialogue=await audio.registerDialogue(owner,bookId,{...candidate,idempotencyKey:'guide:'+id});
     const next=await transition(owner,bookId,id,token,j=>{j.dialogueId=dialogue.id;j.dialogueRevision=dialogue.revision;j.stage='audio';j.lease=null;});if(!next)return;continue;
    }
    if(job.stage==='plan-verification'){
     const checks=verificationBatches(book,job.candidate);
     const next=await transition(owner,bookId,id,token,j=>{j.verifyBatches=checks;j.verifyIndex=0;j.verification=[];j.stage='verify';j.lease=null;});if(!next)return;continue;
    }
    if(job.stage==='audio'){
     validateGuide(book,job.scope,job.candidate);
     const live=await snapshot(owner,bookId,id);if(controller.signal.aborted||live.status!=='preparing'||live.lease?.token!==token)return;
     const authorize=async()=>{const guide=await snapshot(owner,bookId,id);if(!['preparing','ready'].includes(guide.status))throw audioError('这次导听已经停止。',409,'guide_inactive');};
     const session=await audio.createSession(owner,bookId,{mode:'dialogue',guideJobId:id,dialogueId:job.dialogueId,revision:job.dialogueRevision,idempotencyKey:'guide:'+id},{authorize});
     if(controller.signal.aborted){await audio.cancelSession(owner,bookId,session.id);return;}
     const next=await transition(owner,bookId,id,token,j=>{j.sessionId=session.id;j.status='ready';j.stage='ready';j.lease=null;});
     if(!next)await audio.cancelSession(owner,bookId,session.id);return;
    }
    const stageId='guide:'+id+':'+job.stage+':'+(job.stage==='outline'?job.outlines.length:job.stage==='verify'?job.verifyIndex:0);
    if(store.durable&&typeof store.reserveGeneration!=='function')throw audioError('导听额度暂时无法核验。',503,'quota_unavailable');
    await store.reserveGeneration?.(owner.id,stageId,{guideJobId:id});
    const inFlight=await transition(owner,bookId,id,token,j=>{j.lease.inFlight=true;j.lease.expiresAt=Date.now()+leaseMs;});if(!inFlight||controller.signal.aborted)return;
    let input={stage:job.stage,bookId,contentVersion:job.scope.contentVersion,intent:job.scope.intent,signal:controller.signal};
    if(job.stage==='outline')input={...input,batchIndex:job.outlines.length,passages:batches[job.outlines.length]};
    else if(job.stage==='script')input={...input,outlines:job.outlines};
    else if(job.stage==='verify'){
     const batch=job.verifyBatches[job.verifyIndex],index=new Map(audioPassages(book).map(p=>[p.id,p]));
     input={...input,turns:job.candidate.turns.filter(t=>batch.turnIds.includes(t.id)),passages:batch.passageIds.map(id=>{const p=index.get(id);return {id:p.id,chapterId:p.chapterId,original:p.original};})};
    }else throw audioError('导听阶段记录无效。',409,'invalid_guide');
    const liveBeforeCall=await snapshot(owner,bookId,id);
    if(controller.signal.aborted||liveBeforeCall.status!=='preparing'||liveBeforeCall.lease?.token!==token)return;
    const result=await generator(input);submitted++;
    if(controller.signal.aborted)return;
    const fresh=await current(owner,bookId,job.scope);
    if(job.stage==='outline'){
     const outline=verifiedOutline(batches[job.outlines.length],result);
     if(!await transition(owner,bookId,id,token,j=>{j.outlines.push(outline);j.readPassageIds.push(...outline.passageIds);j.stage=j.outlines.length===batches.length?'script':'outline';j.lease=null;}))return;
    }else if(job.stage==='script'){
     const candidate=validateGuide(fresh,job.scope,result);
     if(!await transition(owner,bookId,id,token,j=>{j.candidate=candidate;j.stage='plan-verification';j.lease=null;}))return;
    }else{
     const checks=checkSupport(job.verifyBatches[job.verifyIndex],result);
     if(!await transition(owner,bookId,id,token,j=>{j.verification.push(...checks);j.verifyIndex++;j.stage=j.verifyIndex===j.verifyBatches.length?'publish':'verify';j.lease=null;}))return;
    }
   }
  }catch(error){
   if(controller.signal.aborted)return;
   await transition(owner,bookId,id,token,j=>{j.status=error.code==='already_submitted'?'interrupted':'failed';j.error=error.code==='already_submitted'?interrupted():safeError(error);j.lease=null;}).catch(()=>{});
  }
 }
 function kick(owner,bookId,id){
  if(typeof generator!=='function')throw audioError('导听讲稿服务尚未配置。',503,'not_configured');
  const idKey=key(owner,bookId,id);if(active.has(idKey))return;
  const controller=new AbortController();active.set(idKey,controller);
  let timer;
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve();},sliceDurationMs);});
  const work=Promise.resolve().then(()=>run(owner,bookId,id,controller));
  const bounded=Promise.race([work,deadline]).finally(()=>{clearTimeout(timer);if(active.get(idKey)===controller)active.delete(idKey);});
  try{attach(bounded);}catch{
   controller.abort();
   throw audioError('导听后台任务暂时无法启动，尚未提交生成。',503,'scheduler_unavailable');
  }
 }
 async function create(owner,bookId,input){
  identity(owner);
  if(input?.confirmProcessing!==true)throw audioError('请先确认这次导听的原文范围与外部处理。');
  if(typeof input.idempotencyKey!=='string'||!input.idempotencyKey||input.idempotencyKey.length>128)throw audioError('请求标识无效。');
  const preview=await prepare(owner,bookId,input),requestHash=audioHash(preview.scope);
  const job=await mutate(owner,bookId,data=>{
   const list=jobs(data),old=list.find(j=>j.idempotencyKey===input.idempotencyKey);
   if(old){if(old.requestHash!==requestHash)throw audioError('请求标识已经用于另一段原文或范围。',409,'idempotency_conflict');return old;}
   const cancelled=data.guideCancelledRequests?.some(r=>r.key===input.idempotencyKey);
   if(!cancelled&&typeof generator!=='function')throw audioError('导听讲稿服务尚未配置。',503,'not_configured');
   if(!cancelled&&list.some(j=>j.status==='preparing'))throw audioError('这本书已有导听正在准备，可先取消或等它完成。',429,'already_generating');
   if(list.length>=100)throw audioError('导听记录较多，请先导出并在本机继续。',413,'record_limit');
   const created={id:randomUUID(),idempotencyKey:input.idempotencyKey,requestHash,status:'preparing',scope:preview.scope,maxCalls:preview.externalProcessing.maxCalls,batchCount:preview.externalProcessing.sourceBatches};
   Object.assign(created,{stage:'budget',lease:null,outlines:[],readPassageIds:[],verification:[],createdAt:new Date().toISOString()});list.push(created);
   if(cancelled){
    created.status='cancelled';created.stage='cancelled';
    data.guideCancelledRequests=data.guideCancelledRequests.filter(r=>r.key!==input.idempotencyKey);
   }
   if(Buffer.byteLength(JSON.stringify(data))>2800000)throw audioError('导听记录已接近书房容量，请先导出并在本机继续。',413,'record_limit');
   return created;
  });
  const recovered=await recover(owner,bookId,job.id);if(recovered.status==='preparing')kick(owner,bookId,recovered.id);return publicJob(recovered);
 }
 async function get(owner,bookId,id){
  identity(owner);await library.getBook(owner,bookId);const job=await recover(owner,bookId,id);
  if(job.status==='ready')await current(owner,bookId,job.scope);
  if(job.status==='preparing')kick(owner,bookId,id);return publicJob(job);
 }
 async function cancel(owner,bookId,id){
  identity(owner);await library.getBook(owner,bookId);await snapshot(owner,bookId,id);
  const job=await mutate(owner,bookId,data=>{const job=jobs(data).find(j=>j.id===id);if(!job)throw hidden();job.status='cancelled';job.lease=null;return job;});
  active.get(key(owner,bookId,id))?.abort();if(job.sessionId)await audio.cancelSession(owner,bookId,job.sessionId);return publicJob(job);
 }
 async function cancelRequest(owner,bookId,requestKey){
  identity(owner);await library.getBook(owner,bookId);
  if(typeof requestKey!=='string'||!requestKey||requestKey.length>128)throw audioError('请求标识无效。');
  const job=await mutate(owner,bookId,data=>{
   const job=jobs(data).find(j=>j.idempotencyKey===requestKey);
   if(job){job.status='cancelled';job.lease=null;return job;}
   const cancelled=(data.guideCancelledRequests??=[]);
   if(!cancelled.some(r=>r.key===requestKey)){
    if(cancelled.length>=1000)throw audioError('取消请求记录较多，请在本机继续。',413,'record_limit');
    cancelled.push({key:requestKey,createdAt:new Date().toISOString()});
   }
   return null;
  });
  if(!job)return {status:'cancelled',idempotencyKey:requestKey};
  active.get(key(owner,bookId,job.id))?.abort();if(job.sessionId)await audio.cancelSession(owner,bookId,job.sessionId);return publicJob(job);
 }
 return {prepare,create,get,cancel,cancelRequest};
}
