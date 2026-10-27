import {createHash} from 'node:crypto';
import {fail} from './document-import.mjs';
import {withProviderMeter} from './provider-metering.mjs';
const allowed={translation:['id','passageId','contentVersion'],conversation:['id','text','passageId','contentVersion','scopeRevision','quote','preferenceWrites','peopleWrites'],annotation:['id','threadId','quote','highlightId','text','responseLocale']};
const stable=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const paragraphs=book=>book.sections.flatMap(s=>s.paragraphs);
const operationId=(user,action,bookId,id)=>'credit-'+hash([user.id,action,bookId,id]);
function cleanInput(input,action){
 if(!input||typeof input!=='object'||Array.isArray(input)||!allowed[action]||Object.keys(input).some(k=>k!=='billing'&&!allowed[action].includes(k)))throw fail('收费请求格式不正确',400);
 if(action==='conversation'&&input.peopleWrites!==undefined&&typeof input.peopleWrites!=='boolean')throw fail('收费请求格式不正确',400);
 if(action==='conversation'&&input.preferenceWrites!==undefined&&typeof input.preferenceWrites!=='boolean')throw fail('收费请求格式不正确',400);
 const {billing,...body}=input;return body;
}
export function createCreditGate({billing,library,chat,record,clock=Date.now}={}){
 const enabled=()=>billing?.enabled===true;
 async function scopeFor(user,{action,bookId,input}){
  if(!user?.id)throw fail('请先进入自己的书房',401);
  const body=cleanInput(input,action),book=await library.getBook(user,bookId),rows=paragraphs(book);
  let sourceQuote=body.quote;
  if(action==='annotation'&&!sourceQuote&&body.threadId&&chat?.annotations){const view=await chat.annotations.view(user,bookId);sourceQuote=view.archive.threads.find(t=>t.id===body.threadId&&!t.deletedAt)?.quote;}
  const passageId=body.passageId||sourceQuote?.parts?.[0]?.passageId;
  const source=rows.find(p=>p.id===passageId);if(!source)throw fail('找不到这段原文',404);
  const expected=body.contentVersion||sourceQuote?.contentVersion;
  if(expected&&expected!==book.contentVersion)throw fail('原文版本已变化，请重新请求',409);
  if(typeof body.id!=='string'||!body.id||body.id.length>128)throw fail('请为这次请求保留唯一标识',400);
  if(action==='translation'){
   const i=rows.indexOf(source),context=rows.slice(Math.max(0,i-1),i+2).map(p=>({id:p.id,original:p.original}));
   if([...source.original].length>4000||Buffer.byteLength(JSON.stringify(context))>24576)throw fail('这一段或邻近上下文超过单段处理范围，原文仍可阅读',413);
  }
  return {body,book,scope:{bookId:book.bookId,contentVersion:book.contentVersion,passageId,requestId:body.id,requestHash:hash(body),contextPolicy:'reading-v1',costLimitMicrousd:action==='translation'?15000:120000}};
 }
 async function cache(user,action,bookId,body){
  if(action==='translation'){const book=await library.getBook(user,bookId),p=paragraphs(book).find(p=>p.id===body.passageId);return p?.translations?.literal?.text&&p?.translations?.interpretive?.text?p:null;}
  if(action==='conversation'&&chat)return (await chat.view(user,bookId)).turns.find(t=>t.id===body.id)||null;
  if(action==='annotation'&&chat){const view=await chat.annotations.view(user,bookId),request=view.requests.find(r=>r.id===body.id);return request?{request,thread:view.archive.threads.find(t=>t.id===request.threadId)||null}:null;}
  return null;
 }
 async function saved(user,action,bookId,scope){
  const current=await library.getBook(user,bookId);if(current.contentVersion!==scope.contentVersion)throw fail('原文版本已变化，本次结果不能结算',409);
  if(action==='translation')return paragraphs(current).find(p=>p.id===scope.passageId&&p.translations?.literal?.text&&p.translations?.interpretive?.text)||null;
  if(action==='conversation'&&chat)return (await chat.view(user,bookId)).turns.find(t=>t.id===scope.requestId)||null;
  if(action==='annotation'&&chat){const view=await chat.annotations.view(user,bookId),request=view.requests.find(t=>t.id===scope.requestId);return request?{request,thread:view.archive.threads.find(t=>t.id===request.threadId)||null}:null;}
  return null;
 }
 const statusOf=(action,value)=>action==='annotation'?value?.request?.status:value?.status;
 function completed(action,value,scope,id){
  if(action==='translation')return value?.id===scope.passageId&&value?.translations?.literal?.text&&value?.translations?.interpretive?.text&&['literal','interpretive'].every(k=>value.translations[k].sourceVersion===scope.contentVersion&&value.translations[k].generationReceipt?.operationId===id&&value.translations[k].generationReceipt?.requestId===scope.requestId);
  if(action==='conversation')return value?.id===scope.requestId&&value.contentVersion===scope.contentVersion&&value.passageId===scope.passageId&&value.status==='completed'&&value.answer;
  return value?.request?.id===scope.requestId&&value.request.status==='completed'&&!value.thread?.deletedAt&&value.thread?.quote?.contentVersion===scope.contentVersion&&value.thread.quote.parts?.some(p=>p.passageId===scope.passageId);
 }
 const receipt=(user,action,scope,id)=>({ownerId:user.id,bookId:scope.bookId,contentVersion:scope.contentVersion,passageId:scope.passageId,resultId:scope.requestId,kind:action,operationId:id});
 async function reconcile(user,op,previous){
  if(!op||['released','cancelled','reversed'].includes(op.status))return;
  const action=op.action;
  if(['failed','cancelled'].includes(statusOf(action,previous))){if(op.status==='settled')await billing.reverse({ownerId:user.id,operationId:op.id,reason:'undeliverable'});else await billing.cancel({ownerId:user.id,operationId:op.id});return;}
  if(!completed(action,previous,op.scope,op.id))return;
  const settled=await billing.complete({ownerId:user.id,operationId:op.id,receipt:receipt(user,action,op.scope,op.id)});
  if(settled.status==='settled')await billing.ackPublished({ownerId:user.id,operationId:op.id});
 }
 async function quote(user,request){
  if(!enabled())throw fail('此实例尚未开启付费服务',503);
  const {scope}=await scopeFor(user,request);return billing.quote({ownerId:user.id,action:request.action,scope});
 }
 async function run({user,action,bookId,input,execute,signal}){
  if(!enabled())return execute(input);
  const body=cleanInput(input,action);
  const cached=await cache(user,action,bookId,body);
  if(cached){
   const op=body.id&&user?.id?await billing.operation({ownerId:user.id,operationId:operationId(user,action,bookId,body.id)}):null;
   if(op){
    if(op.scope.requestHash!==hash(body))throw fail('重复提交标识与原请求不一致',409);
    const previous=await saved(user,action,bookId,op.scope);
    await reconcile(user,op,previous);return previous||cached;
   }
   // Existing terminals are read as receipts. A failed/cancelled request must
   // never enter the generation path simply because a fresh quote was supplied.
   if(action!=='translation')return cached;
   return execute(body);
  }
  const meta=input.billing;
  if(!meta||typeof meta.quoteId!=='string'||typeof meta.idempotencyKey!=='string'||Object.keys(meta).some(k=>!['quoteId','idempotencyKey'].includes(k)))throw fail('请先查看本次阅读点数并确认使用',402);
  const {scope}=await scopeFor(user,{action,bookId,input:body});
  const opId=operationId(user,action,bookId,body.id);let result;
  let operation;
  try{operation=await billing.run({ownerId:user.id,quoteId:meta.quoteId,operationId:opId,idempotencyKey:meta.idempotencyKey,scope,signal,execute:async({operationId:id})=>{
   const generate=()=>execute(body,{operationId:id,requestId:scope.requestId});
   result=typeof record==='function'?await withProviderMeter({ownerId:user.id,operationId:id,feature:action,funding:'credits',maxCostUsd:action==='translation'?.015:.12,record},generate):await generate();
   const ok=completed(action,result,scope,id);
   if(!ok)throw fail('这次处理未完成，没有扣除阅读点',502);
   return {receipt:receipt(user,action,scope,id)};
  }});}catch(error){
   // A transport or persistence failure is ambiguous until the trusted ledger
   // confirms its terminal state. Only that tiny receipt can authorize a fresh
   // explicit request ID in the browser; running work keeps its original ID.
   try{const op=await billing.operation({ownerId:user.id,operationId:opId,consistent:true});
    if(op&&['released','cancelled','reversed'].includes(op.status)&&error&&typeof error==='object')Object.defineProperty(error,'billingOperation',{value:{id:op.id,status:op.status},enumerable:true,configurable:true});
    else if(op===null&&error&&typeof error==='object'&&(error.code==='stale_quote'&&error.status===409||error.code==='insufficient_credits'&&error.status===402))Object.defineProperty(error,'billingOperation',{value:{id:opId,status:'not_started'},enumerable:true,configurable:true});
   }catch{}
   throw error;
  }
  if(result){if(operation.status==='settled'&&billing.ackPublished)await billing.ackPublished({ownerId:user.id,operationId:opId});return result;}
  const previous=await saved(user,action,bookId,scope);
  if(previous){await reconcile(user,operation,previous);return previous;}
  if(operation.status==='settled')operation=await billing.reverse({ownerId:user.id,operationId:opId,reason:'undeliverable'});
  const pending=fail('结果仍在核对，请稍后查看本次任务',409);
  if(['released','cancelled','reversed'].includes(operation.status))pending.billingOperation={id:operation.id,status:operation.status};
  throw pending;
 }
 async function cancel(user,action,bookId,requestId){
  if(!enabled()||!user?.id)return;
  const id=operationId(user,action,bookId,requestId),op=await billing.operation({ownerId:user.id,operationId:id});
  if(op&&['reserved','running'].includes(op.status))await billing.cancel({ownerId:user.id,operationId:id});
 }
 async function recover(user){
  if(!enabled()||!user?.id)return;
  const recovery=await billing.recover({ownerId:user.id}),operations=recovery?.operations||[];
  for(const op of operations){
   try{const previous=await saved(user,op.action,op.scope.bookId,op.scope);await reconcile(user,op,previous);
    if(!previous&&op.status==='settled')await billing.reverse({ownerId:user.id,operationId:op.id,reason:'undeliverable'});
    if(!previous&&op.status==='result_saved')await billing.cancel({ownerId:user.id,operationId:op.id});
    const startedAt=Date.parse(op.startedAt||op.createdAt),expired=Number.isFinite(startedAt)&&clock()-startedAt>=15*60000;
    if(expired&&!completed(op.action,previous,op.scope,op.id)){
     if(op.status==='reserved')await billing.cancel({ownerId:user.id,operationId:op.id,expectedStatus:'reserved'});
     // The translation caller also fences its final save with the same 15-minute
     // authority. Native chat/annotation view() supplies their terminal lease.
     if(op.status==='running'&&op.action==='translation')await billing.cancel({ownerId:user.id,operationId:op.id,expectedStatus:'running'});
    }
   }catch(error){
    if([403,404,409].includes(error.status)){if(op.status==='settled')await billing.reverse({ownerId:user.id,operationId:op.id,reason:'source_or_authorization_changed'});else await billing.cancel({ownerId:user.id,operationId:op.id});}
    else throw error;
   }
  }
  return recovery;
 }
 return {quote,run,cancel,recover,enabled};
}
