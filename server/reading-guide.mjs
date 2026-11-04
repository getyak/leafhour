import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,fail} from './document-import.mjs';
import {createLockedJsonStore} from './locked-json-store.mjs';
import {introductionContext} from '../app/book-introduction.mjs';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
const text=(x,max)=>typeof x==='string'&&x.isWellFormed()&&x.trim().length>0&&[...x].length<=max;
const id=x=>text(x,256)&&!/[\u0000-\u001f]/u.test(x);
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const title=x=>typeof x==='string'?x:x?.zh||x?.en||'';

export function normalizeReadingGuideContext(value){
 if(!only(value,['title','author','chapters','passages'])||!text(value.title,500)||typeof value.author!=='string'||!value.author.isWellFormed()||[...value.author].length>500||!Array.isArray(value.chapters)||value.chapters.length>24||!Array.isArray(value.passages)||value.passages.length>6||!value.passages.length||bytes(value)>18000)throw fail('阅读前导的开篇取样不完整或超过范围');
 if(value.chapters.some(c=>!only(c,['id','title'])||!id(c.id)||typeof c.title!=='string'||!c.title.isWellFormed()||[...c.title].length>200)||value.passages.some(p=>!only(p,['id','chapterId','original'])||!id(p.id)||!id(p.chapterId)||!text(p.original,6000))||value.passages.reduce((n,p)=>n+[...p.original].length,0)>6000||new Set(value.passages.map(p=>p.id)).size!==value.passages.length)throw fail('阅读前导只使用当前书的目录与有限原文');
 return structuredClone(value);
}

function cloudContext(book){
 const opening=introductionContext(book),byPassage=new Map((book.sections||[]).flatMap(s=>(s.paragraphs||[]).map(p=>[p.id,s.chapterId])));
 const context={title:title(opening.title)||title(book.title)||'未命名书籍',author:opening.author||'',chapters:opening.chapters.map(c=>({id:c.id,title:title(c.title)})),passages:opening.passages.map(p=>({...p,chapterId:byPassage.get(p.id)}))};
 while(bytes(context)>18000&&context.chapters.length)context.chapters.pop();
 while(bytes(context)>18000&&context.passages.length){const p=context.passages.at(-1);p.original=[...p.original].slice(0,-128).join('');if(!p.original)context.passages.pop();}
 return normalizeReadingGuideContext(context);
}

export function createReadingGuideService({dataDir,dataStore=null,library,generator=null,clock=Date.now,timeoutMs=60000}){
 const store=dataStore||createLockedJsonStore({dataDir,busyMessage:'阅读前导正在保存，请稍后重试'});
 const identity=user=>{if(!user?.id||user.is_anonymous)throw fail('登录后可以准备阅读前导，原书仍可阅读',401);};
 const input=raw=>{if(!only(raw,['bookId','contentVersion','sourceKind','locale','context'])||!id(raw.bookId)||!id(raw.contentVersion)||!['cloud','local-device'].includes(raw.sourceKind)||!['zh-Hans','zh-Hant','en','ja'].includes(raw.locale)||raw.sourceKind==='cloud'&&raw.context!==undefined)throw fail('阅读前导的书籍版本或来源不正确');return raw;};
 const key=(user,value)=>path.join(dataDir,'users',digest(user.id),'reading-guides',digest(JSON.stringify([value.sourceKind,value.bookId,value.contentVersion,value.locale,1])));
 async function resolve(user,raw){identity(user);const value=input(raw);if(value.sourceKind==='cloud'){const book=await library.getBook(user,value.bookId);if(book.contentVersion!==value.contentVersion)throw fail('原文已更新，请重新打开阅读前导',409);return {...value,context:cloudContext(book)};}return {...value,context:normalizeReadingGuideContext(value.context)};}
 const view=async(user,raw)=>{const value=await resolve(user,raw),row=await store.read(key(user,value),{});return {guide:row.value||null,available:typeof generator==='function'};};
 async function ensure(user,raw,{signal,authorize=async()=>true}={}){
  const value=await resolve(user,raw);signal?.throwIfAborted();if(!await authorize())throw fail('登录已变化，未生成阅读前导',401);
  const location=key(user,value),existing=await store.read(location,{});
  if(existing.value)return {guide:existing.value,available:typeof generator==='function'};
  if(typeof generator!=='function')throw fail('AI 阅读前导暂不可用，可以继续阅读',503);
  const nonce=randomUUID(),now=clock();
  const claim=await store.mutate(location,{},row=>{if(row.value)return {value:row.value};if(row.lease?.expiresAt>now)throw fail('阅读前导正在准备，请稍后查看',409);row.lease={nonce,expiresAt:now+timeoutMs};return {};});
  if(claim.value)return {guide:claim.value,available:true};
  const controller=new AbortController();let timer,abortReject;
  const interrupted=new Promise((_,reject)=>abortReject=reject);interrupted.catch(()=>{});
  const abort=()=>{const error=fail('阅读前导已取消，原书仍可阅读',409);controller.abort(error);abortReject(error);};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  timer=setTimeout(abort,timeoutMs);timer.unref?.();
  try{
   let generated;
   try{generated=await Promise.race([generator({book:{bookId:value.bookId,contentVersion:value.contentVersion},context:value.context,locale:value.locale,signal:controller.signal}),interrupted]);}
   catch{controller.signal.throwIfAborted();throw fail('AI 阅读前导暂未完成，可以继续阅读并稍后重试',502);}
   controller.signal.throwIfAborted();if(!await authorize())throw fail('登录已变化，未保存阅读前导',401);
   if(value.sourceKind==='cloud'&&(await library.getBook(user,value.bookId)).contentVersion!==value.contentVersion)throw fail('原文已变化，未保存旧导览',409);
   if(!generated||!text(generated.opening,1200)||!text(generated.method,1200)||!text(generated.readingQuestion,300)||!text(generated.model,200))throw fail('阅读前导未通过格式核验，可以稍后重试',502);
   const guide={kind:'leafhour-reading-guide',schemaVersion:1,id:'guide-'+digest(location).slice(0,32),bookId:value.bookId,contentVersion:value.contentVersion,sourceKind:value.sourceKind,locale:value.locale,origin:'ai',status:'draft',scope:'opening-sample',opening:generated.opening.trim(),method:generated.method.trim(),readingQuestion:generated.readingQuestion.trim(),sampleRanges:value.context.passages.map(p=>({passageId:p.id,chapterId:p.chapterId,charOffset:0,charEnd:[...p.original].length})),model:generated.model,createdAt:new Date(clock()).toISOString()};
   await store.mutate(location,{},row=>{controller.signal.throwIfAborted();if(row.lease?.nonce!==nonce||row.lease.expiresAt<=clock())throw fail('阅读前导任务已过期，请重试',409);row.value=guide;row.completedBy=nonce;delete row.lease;});
   controller.signal.throwIfAborted();return {guide,available:true};
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   // A durable CAS can finish after local cancellation. Remove only this run's value.
   await store.mutate(location,{},row=>{if(controller.signal.aborted&&row.completedBy===nonce){delete row.value;delete row.completedBy;}if(row.lease?.nonce===nonce)delete row.lease;});
   controller.abort();
  }
 }
 return {view,ensure};
}
