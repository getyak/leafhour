import {withBackendExecutionAuthority} from '../packages/domain/execution-authority.mjs';
import {normalizeReadingGuideContext} from '../packages/contracts/reading-guide-context.mjs';
export {normalizeReadingGuideContext} from '../packages/contracts/reading-guide-context.mjs';
import {withCandidateDelivery} from '../packages/domain/execution-delivery.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,fail} from './document-import.mjs';
import {createLockedJsonStore} from './locked-json-store.mjs';
import {introductionContext} from '../app/book-introduction.mjs';
import {createBookIntroductionStore} from './book-introduction-store.mjs';
import {normalizeChatGuideTarget,normalizeChatGuideContext} from '../app/chat-guide-context.mjs';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
const text=(x,max)=>typeof x==='string'&&x.isWellFormed()&&x.trim().length>0&&[...x].length<=max;
const id=x=>text(x,256)&&!/[\u0000-\u001f]/u.test(x);
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const title=x=>typeof x==='string'?x:x?.zh||x?.en||'';


function cloudContext(book){
 const opening=introductionContext(book),byPassage=new Map((book.sections||[]).flatMap(s=>(s.paragraphs||[]).map(p=>[p.id,s.chapterId])));
 const context={title:title(opening.title)||title(book.title)||'未命名书籍',author:opening.author||'',chapters:opening.chapters.map(c=>({id:c.id,title:title(c.title)})),passages:opening.passages.map(p=>({...p,chapterId:byPassage.get(p.id)}))};
 while(bytes(context)>18000&&context.chapters.length)context.chapters.pop();
 while(bytes(context)>18000&&context.passages.length){const p=context.passages.at(-1);p.original=[...p.original].slice(0,-128).join('');if(!p.original)context.passages.pop();}
 return normalizeReadingGuideContext(context);
}

export function createReadingGuideService({dataDir,dataStore=null,library,generator=null,clock=Date.now,timeoutMs=60000}){
 const store=dataStore||createLockedJsonStore({dataDir,busyMessage:'阅读前导正在保存，请稍后重试'});
 const quota=library?.introductions||createBookIntroductionStore({dataDir:path.join(dataDir,'sponsored-capacity'),dataStore});
 const identity=user=>{if(!user?.id||user.is_anonymous)throw fail('登录后可以准备阅读前导，原书仍可阅读',401);};
 const input=raw=>{if(!only(raw,['bookId','contentVersion','sourceKind','locale','context'])||!id(raw.bookId)||!id(raw.contentVersion)||!['cloud','local-device'].includes(raw.sourceKind)||!['zh-Hans','zh-Hant','en','ja'].includes(raw.locale)||raw.sourceKind==='cloud'&&raw.context!==undefined)throw fail('阅读前导的书籍版本或来源不正确');return raw;};
 const key=(user,value)=>path.join(dataDir,'users',digest(user.id),'reading-guides',digest(JSON.stringify([value.sourceKind,value.bookId,value.contentVersion,value.locale,1])));
 async function resolve(user,raw){identity(user);const value=input(raw);if(value.sourceKind==='cloud'){const book=await library.getBook(user,value.bookId);if(book.contentVersion!==value.contentVersion)throw fail('原文已更新，请重新打开阅读前导',409);return {...value,context:cloudContext(book)};}return {...value,context:normalizeReadingGuideContext(value.context)};}
 // A durable attempt is never reclaimed automatically: an expired provider
 // request may already have been billed, even if this process lost its result.
 const snapshot=row=>({guide:row.value||null,available:typeof generator==='function',state:row.value?'ready':row.attempt?.state==='preparing'?(row.attempt.expiresAt>clock()?'preparing':'unknown'):row.attempt?.state|| (row.lease?'unknown':'missing')});
 const view=async(user,raw)=>{const value=await resolve(user,raw);return snapshot(await store.read(key(user,value),{}));};
 async function ensure(user,raw,{signal,authorize=async()=>true,retry=false}={}){
  const value=await resolve(user,raw);signal?.throwIfAborted();if(!await authorize())throw fail('登录已变化，未生成阅读前导',401);
  const location=key(user,value),existing=snapshot(await store.read(location,{}));
  if(existing.state!=='missing'&&!(retry&&existing.state==='failed'))return existing;
  if(typeof generator!=='function')throw fail('AI 阅读前导暂不可用，可以继续阅读',503);
  const nonce=randomUUID(),now=clock();
  const claim=await store.mutate(location,{},row=>{
   const current=snapshot(row);
   if(current.state!=='missing'&&!(retry&&current.state==='failed'))return {current};
   row.attempt={nonce,state:'preparing',expiresAt:now+timeoutMs};return {claimed:true};
  });
  if(claim.current)return claim.current;
  const controller=new AbortController();let timer,abortReject,reserved=false,dispatched=false,completed=false;
  const interrupted=new Promise((_,reject)=>abortReject=reject);interrupted.catch(()=>{});
  const abort=()=>{const error=fail('阅读前导结果待确认，没有重新生成。原书仍可阅读',409);controller.abort(error);abortReject(error);};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  timer=setTimeout(abort,timeoutMs);timer.unref?.();
  try{
   await quota.reserve(user,nonce,clock(),timeoutMs);reserved=true;controller.signal.throwIfAborted();
   dispatched=true;
   const generated=await Promise.race([withBackendExecutionAuthority(user,authorize,()=>generator({book:{bookId:value.bookId,contentVersion:value.contentVersion,source:value.sourceKind},context:value.context,locale:value.locale,signal:controller.signal})),interrupted]);
   controller.signal.throwIfAborted();completed=true;
   if(!await authorize())throw fail('登录已变化，未保存阅读前导',401);
   if(value.sourceKind==='cloud'&&(await library.getBook(user,value.bookId)).contentVersion!==value.contentVersion)throw fail('原文已变化，未保存旧导览',409);
   if(!generated||!text(generated.opening,1200)||!text(generated.method,1200)||!text(generated.readingQuestion,300)||!text(generated.model,200))throw fail('阅读前导未通过格式核验，可以稍后重试',502);
   const guide={kind:'leafhour-reading-guide',schemaVersion:1,id:'guide-'+digest(location).slice(0,32),bookId:value.bookId,contentVersion:value.contentVersion,sourceKind:value.sourceKind,locale:value.locale,origin:'ai',status:'draft',scope:'opening-sample',opening:generated.opening.trim(),method:generated.method.trim(),readingQuestion:generated.readingQuestion.trim(),sampleRanges:value.context.passages.map(p=>({passageId:p.id,chapterId:p.chapterId,charOffset:0,charEnd:[...p.original].length})),model:generated.model,createdAt:new Date(clock()).toISOString()};
   await withCandidateDelivery(generated,()=>store.mutate(location,{},row=>{controller.signal.throwIfAborted();if(row.attempt?.nonce!==nonce||row.attempt.expiresAt<=clock())throw fail('阅读前导结果待确认，请稍后查看',409);row.value=guide;row.attempt.state='ready';}));
   return {guide,available:true,state:'ready'};
  }catch(error){
   if(error?.readingGuideCompleted===true||['preparation','initialize'].includes(error?.readerStage))completed=true;
   await store.mutate(location,{},row=>{if(row.attempt?.nonce===nonce&&!row.value)row.attempt.state=!dispatched||completed?'failed':'unknown';});
   throw fail(error?.status===429?'阅读前导的生成额度暂时用完，请稍后再试':!dispatched||completed?'阅读前导暂未完成，可以稍后重试':'阅读前导结果待确认，没有重新生成。可以继续阅读',error?.status||502);

  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   try{if(reserved)await quota.releaseQuota(nonce);}finally{controller.abort();}
  }
 }
 async function resolveReference(user,raw,{bookId,contentVersion,sourceKind}){
  identity(user);const target=normalizeChatGuideTarget(raw);
  if(target.bookId!==bookId||target.contentVersion!==contentVersion||target.sourceKind!==sourceKind)throw fail('阅读前导不属于当前书籍来源或版本',409);
  if(sourceKind==='cloud'&&(await library.getBook(user,bookId)).contentVersion!==contentVersion)throw fail('阅读前导的原文版本已变化',409);
  const guide=(await store.read(key(user,target),{})).value;
  if(!guide||guide.id!==target.guideId||guide.bookId!==bookId||guide.contentVersion!==contentVersion||guide.sourceKind!==sourceKind||guide.locale!==target.locale)throw fail('找不到当前账号已保存的阅读前导，请重新准备',404);
  return normalizeChatGuideContext({...target,opening:guide.opening,method:guide.method,readingQuestion:guide.readingQuestion});
 }
 return {view,ensure,resolveReference};
}
