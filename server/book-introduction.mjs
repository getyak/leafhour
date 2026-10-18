import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fail} from './document-import.mjs';
import {introductionFor,introductionContext,validateBookIntroduction} from '../app/book-introduction.mjs';

const DISCARD_ATTEMPTS=3,DISCARD_RETRY_DELAY_MS=20;
const temporaryNetworkCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','EPIPE','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const transientDiscardError=error=>{
  const codes=[error?.code,error?.cause?.code];
  if(Number.isInteger(error?.upstreamStatus)&&error.upstreamStatus>=400&&error.upstreamStatus<500)return false;
  if(error?.name==='SyntaxError'||codes.some(code=>['EACCES','EPERM'].includes(code)))return false;
  return Number.isInteger(error?.status)?error.status>=500:error?.name==='TimeoutError'||codes.some(code=>temporaryNetworkCodes.has(code));
};

export function createBookIntroductionService({library,store=library.introductions,generator=null,clock=Date.now,timeoutMs=60000}){
  const identity=user=>{if(!user?.id||user.is_anonymous)throw fail('请先进入自己的书房',401);};
  const result=book=>({...introductionFor(book),introduction:book.introduction||null,available:typeof generator==='function'});
  async function discardCancelled(user,book,nonce){
    for(let attempt=1;;attempt++)try{await store.discard(user,book,nonce);return;}catch(error){
      if(attempt>=DISCARD_ATTEMPTS||!transientDiscardError(error))throw error;
      await delay(DISCARD_RETRY_DELAY_MS);
    }
  }
  async function view(user,id){const book=await library.getBook(user,id);return result(book);}
  async function generate(user,id,input,{authorize=async()=>true,signal}={}){
    identity(user);
    if(signal?.aborted)throw fail('这次简介已取消，尚未保存',409);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof input.contentVersion!=='string')throw fail('请使用当前原文版本生成简介');
    let book=await library.getBook(user,id);
    if(book.contentVersion!==input.contentVersion)throw fail('原文已更新，请重新打开后生成简介',409);
    if(!await authorize())throw fail('登录已失效，请重新进入书房',401);
    if(introductionFor(book).source!=='missing')return result(book);
    if(typeof generator!=='function')throw fail('AI 简介暂未配置，原文仍可继续阅读',503);
    const context=introductionContext(book);if(!context.passages.length)throw fail('这本书还没有可用于简介的正文',409);
    const nonce=randomUUID(),ttl=Math.min(60000,Math.max(1,timeoutMs)),claim=await store.claim(user,book,nonce,clock(),ttl);
    if(claim.value)return result({...book,introduction:claim.value});
    const controller=new AbortController();let timer,reserved=false,rejectInterrupted;
    const interrupted=new Promise((_,reject)=>rejectInterrupted=reject);interrupted.catch(()=>{});
    const abort=()=>{const error=fail('这次简介已取消，尚未保存',409);controller.abort(error);rejectInterrupted(error);};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
    try{
      await store.reserve(user,nonce,clock(),ttl);reserved=true;
      check();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=fail('AI 简介生成超时，尚未保存。可以稍后重试',504);controller.abort(error);reject(error);},ttl);});
      const job={book:{bookId:book.bookId,contentVersion:book.contentVersion,title:context.title},context,signal:controller.signal};
      let generated;
      try{generated=await Promise.race([generator(job),timeout,interrupted]);}catch(error){check();throw fail('AI 简介未能生成，尚未保存。可以稍后重试',502);}
      check();
      if(!await authorize())throw fail('登录已失效，未保存这次简介',401);
      book=await library.getBook(user,id);
      check();
      if(book.contentVersion!==input.contentVersion)throw fail('原文已更新，未保存旧版本的简介',409);
      let value;
      try{value=validateBookIntroduction({kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text:generated?.text,contentVersion:book.contentVersion,createdAt:new Date(clock()).toISOString(),model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:context.passages.map(p=>p.id)},book);}catch{throw fail('AI 简介未通过格式核验，尚未保存。可以稍后重试',502);}
      const saved=await store.complete(user,book,nonce,value,clock(),()=>!controller.signal.aborted);check();return result({...book,introduction:saved});
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);let cleanupError;
      try{if(controller.signal.aborted)await discardCancelled(user,book,nonce);}catch(error){cleanupError=error;}
      controller.abort();
      try{await store.release(user,book,nonce);}catch(error){cleanupError??=error;}
      try{if(reserved)await store.releaseQuota(nonce);}catch(error){cleanupError??=error;}
      if(cleanupError)throw cleanupError;
    }
  }
  return {view,generate};
}
