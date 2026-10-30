import {createHash} from 'node:crypto';
import {fail} from './document-import.mjs';
import {CREDIT_UNITS} from './billing-service.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows=(book,chapterId)=>book.sections.filter(s=>s.chapterId===chapterId).flatMap(s=>s.paragraphs);
const present=p=>['literal','interpretive'].filter(k=>typeof p.translations?.[k]?.text==='string'&&p.translations[k].text.trim());
// Every saved nonempty variant survives automatic completion of the other one.
const eligible=p=>p.kind!=='source_heading'&&typeof p.original==='string'&&p.original.trim()&&/[\p{L}\p{N}]/u.test(p.original)&&inferSourceLanguage(p.original)!=='zh'&&present(p).length<2;
export function createReadingTranslation({library,billing,creditGate,clock=Date.now}={}){
 const pending=new Map(),freeAttempts=new Map();
 async function step(user,bookId,input,{signal,authorize=async()=>true}={}){
  if(!user?.id)throw fail('请先进入自己的书房',401);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['chapterId','contentVersion','phase','passageId'].includes(k))||!['current','next'].includes(input.phase)||typeof input.chapterId!=='string'||!input.chapterId||typeof input.contentVersion!=='string'||!input.contentVersion||input.passageId!==undefined&&(typeof input.passageId!=='string'||!input.passageId))throw fail('阅读翻译范围不正确',400);
  const guard=async()=>{if(signal?.aborted)throw signal.reason||fail('本次准备已暂停',409);if(!await authorize())throw fail('阅读身份已变化，请重新打开这本书',401);};
  await guard();const book=await library.getBook(user,bookId);
  if(book.contentVersion!==input.contentVersion)throw fail('原文版本已变化，请重新打开这本书',409);
  const index=book.chapters.findIndex(c=>c.id===input.chapterId);if(index<0)throw fail('找不到当前章节',404);
  const target=book.chapters[index+(input.phase==='next'?1:0)]?.id||null;
  const result=passage=>({contentVersion:book.contentVersion,chapterId:target,phase:input.phase,done:!rows(book,target).some(eligible),...(passage?{passage}:{})});
  if(!target)return result();
  const passages=rows(book,target),priority=input.passageId&&passages.find(p=>p.id===input.passageId);
  if(input.passageId&&!priority)throw fail('段落不属于本次准备章节',400);
  // A retry with a named, already saved passage returns that receipt without
  // advancing to another passage or reserving more points.
  if(priority&&present(priority).length===2){
   const baseId='reading-'+hash([user.id,bookId,book.contentVersion,priority.id,priority.original]);
   const requestId=['literal','interpretive'].map(k=>priority.translations[k].generationReceipt?.requestId).filter(id=>id===baseId||typeof id==='string'&&id.startsWith(baseId+'-')).sort((a,b)=>Number(b.slice(baseId.length+1)||0)-Number(a.slice(baseId.length+1)||0))[0]||baseId;
   const cached=await creditGate.run({user,action:'translation',bookId,input:{id:requestId,passageId:priority.id,contentVersion:book.contentVersion},execute:async()=>priority});
   await guard();return result(cached);
  }
  const passage=priority&&eligible(priority)?priority:passages.find(eligible);
  if(!passage)return result();
  if(!library.translationAvailable)throw fail('翻译服务尚未配置，原文仍可继续阅读',503);
  const allowedChapterIds=book.chapters.slice(index,index+2).map(c=>c.id);
  const all=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId}))),position=all.findIndex(p=>p.id===passage.id),context=all.slice(Math.max(0,position-1),position+2).filter(p=>allowedChapterIds.includes(p.chapterId)).map(p=>({id:p.id,original:p.original}));
  if([...passage.original].length>4000||Buffer.byteLength(JSON.stringify(context))>24576)throw fail('这一段或邻近上下文超过单段处理范围，原文仍可阅读',413);
  const body={id:'reading-'+hash([user.id,bookId,book.contentVersion,passage.id,passage.original]),passageId:passage.id,contentVersion:book.contentVersion},key=body.id;
  const finish=async saved=>{
   await guard();const latest=await library.getBook(user,bookId);
   if(latest.contentVersion!==book.contentVersion)throw fail('原文版本已变化，请重新打开这本书',409);
   return {contentVersion:book.contentVersion,chapterId:target,phase:input.phase,done:!rows(latest,target).some(eligible),passage:saved};
  };
  if(pending.has(key))return finish(await pending.get(key));
  const work=(async()=>{
   await guard();let inputBody=body;
   if(billing?.enabled===true){
    // Only a trusted terminal release permits a new attempt. Unknown/running
    // work retains its exact original ID and quote across clients/restarts.
    const firstId=body.id;let existing;
    for(let attempt=0;attempt<3;attempt++){
     body.id=attempt?firstId+'-'+attempt:firstId;
     existing=await billing.operation({ownerId:user.id,operationId:'credit-'+hash([user.id,'translation',bookId,body.id])});
     if(!existing||!['released','cancelled','reversed'].includes(existing.status))break;
     if(attempt===2)throw fail('本段准备已多次中止，请使用单段翻译重试',409);
    }
    let quoteId;
    if(existing){
     if(existing.ownerId!==user.id||existing.mode!==billing.mode||existing.action!=='translation'||existing.units!==CREDIT_UNITS||existing.scope.bookId!==bookId||existing.scope.contentVersion!==book.contentVersion||existing.scope.passageId!==passage.id||existing.scope.requestId!==body.id)throw fail('阅读点数任务范围无法核对',409);
     quoteId=existing.quoteId;
    }else{
     const quote=await creditGate.quote(user,{action:'translation',bookId,input:body,preserveExistingTranslations:true});
     if(typeof quote.id!=='string'||!quote.id||quote.ownerId!==user.id||quote.mode!==billing.mode||quote.action!=='translation'||quote.units!==CREDIT_UNITS||Date.parse(quote.expiresAt)<=clock()||!Number.isFinite(Date.parse(quote.expiresAt))||quote.scope?.bookId!==bookId||quote.scope?.contentVersion!==book.contentVersion||quote.scope?.passageId!==passage.id||quote.scope?.requestId!==body.id)throw fail('阅读点数报价已变化，请稍后重试',409);
     quoteId=quote.id;
    }
    inputBody={...body,billing:{quoteId,idempotencyKey:body.id}};
   }
   await guard();
   if(billing?.enabled!==true){const attempts=freeAttempts.get(key)||0;if(attempts>=3)throw fail('本段准备已多次中止，请使用单段翻译重试',409);freeAttempts.set(key,attempts+1);}
   const saved=await creditGate.run({user,action:'translation',bookId,input:inputBody,signal,preserveExistingTranslations:true,execute:(request,generationReceipt)=>library.translate(user,bookId,request.passageId,{expectedContentVersion:book.contentVersion,allowedChapterIds,preserveExistingTranslations:true,...(generationReceipt?{generationReceipt}:{}),authorizeGeneration:async()=>{
    if(signal?.aborted||!await authorize())return false;
    if(!generationReceipt)return true;
    const operation=await billing.operation({ownerId:user.id,operationId:generationReceipt.operationId});
    return operation?.status==='running'&&clock()-Date.parse(operation.startedAt||operation.createdAt)<15*60*1000;
   }})});
   freeAttempts.delete(key);return saved;
  })();
  pending.set(key,work);try{return await finish(await work);}finally{if(pending.get(key)===work)pending.delete(key);}
 }
 return {step};
}
