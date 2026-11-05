import {withCandidateDelivery} from '../packages/domain/execution-delivery.mjs';
import {normalizeChatGuideTarget,normalizeChatGuideContext} from '../app/chat-guide-context.mjs';
import {normalizeChatReactionTargets,resolveChatReactions} from '../app/chat-reactions.mjs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {invalid} from './experience-validation.mjs';
import {normalizeChatVoiceReceipt,normalizeChatReplyTarget,resolveChatReplyReference} from '../app/portable-chat.mjs';
import {normalizeReadingChatQuote} from '../app/reading-chat-quote.mjs';
import {localReadingToolDefinitions,validateLocalReadingAgentToolCall} from './reading-agent-tools.mjs';

export const LOCAL_CHAT_ID='__leafhour_local_chat__';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stable=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
const same=(a,b)=>hash(stable(a))===hash(stable(b));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const str=(value,max=Number.MAX_SAFE_INTEGER)=>typeof value==='string'&&value.isWellFormed()&&value.trim().length>0&&value.length<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(k=>keys.includes(k));
const title=value=>str(value,1000)||object(value)&&Object.keys(value).length>0&&Object.values(value).every(v=>str(v,1000));
const failure=(code,message='无法读取这项本机资料')=>({error:{code,message}});
const bytes=value=>Buffer.byteLength(JSON.stringify(value));

// This envelope identifies a device snapshot, never a cloud book or grant.
export function normalizeLocalChatInput(input){
 if(!only(input,['id','text','contentVersion','passageId','localBook','history','quote','replyTo','reactions','voice','billing','guideContext'])||!id(input.id)||!str(input.text)||!str(input.contentVersion,200)||!id(input.passageId))throw invalid('请提交有效的本机阅读消息');
 const book=input.localBook;
 if(!only(book,['bookId','title','author','contentVersion','chapterId','chapterTitle','passageId','original'])||!id(book.bookId)||book.bookId===LOCAL_CHAT_ID||!title(book.title)||book.author!==undefined&&typeof book.author!=='string'||book.author?.length>1000||!str(book.contentVersion,200)||!id(book.chapterId)||book.chapterTitle!==undefined&&!title(book.chapterTitle)||!id(book.passageId)||typeof book.original!=='string'||!book.original.isWellFormed()||book.original.length>24000)throw invalid('本机书籍上下文不正确');
 if(book.contentVersion!==input.contentVersion||book.passageId!==input.passageId)throw invalid('本机原文版本或位置不一致',409);
 if(input.history!==undefined&&(!Array.isArray(input.history)||input.history.some(m=>!only(m,['role','content','guideContext'])||!['user','assistant'].includes(m.role)||!str(m.content))))throw invalid('本机对话历史不正确');
 const quote=input.quote===undefined?undefined:normalizeReadingChatQuote(input.quote,{bounded:false});
 if(quote&&(quote.bookId!==book.bookId||quote.contentVersion!==book.contentVersion||quote.chapterId!==book.chapterId||quote.parts[0].passageId!==input.passageId))throw invalid('所选本机文字与当前版本不一致',409);
 if(input.history)for(const m of input.history)if(m.guideContext){const g=normalizeChatGuideContext(m.guideContext);if(m.role!=='user'||g.bookId!==book.bookId||g.contentVersion!==book.contentVersion||g.sourceKind!=='local-device')throw invalid('本机历史前导不属于当前书籍版本',409);}
 const {billing,...body}=input;
 return structuredClone({...body,...(input.guideContext!==undefined?{guideContext:normalizeChatGuideTarget(input.guideContext)}:{}),...(input.reactions!==undefined?{reactions:normalizeChatReactionTargets(input.reactions)}:{}),...(quote?{quote}:{}),...(input.replyTo!==undefined?{replyTo:normalizeChatReplyTarget(input.replyTo)}:{}),...(body.voice!==undefined?{voice:normalizeChatVoiceReceipt(body.voice)}:{})});
}

export function createLocalReaderChatService({read,mutate,ownerDir,identity,generator,clock=Date.now,timeoutMs,onError=()=>{},validateVoice=null,resolveGuide=null}){
 const active=new Map();let closed=false;
 const key=(user,requestId)=>{identity(user);if(!id(requestId))throw invalid('提问标识不正确');return path.join(ownerDir(user),'local',hash(requestId)+'.json');};
 const empty=()=>({kind:'leafhour-local-chat',schemaVersion:1,turn:null,calls:[]});
 const publicTurn=turn=>turn?structuredClone(Object.fromEntries(Object.entries(turn).filter(([key])=>!['runId','expiresAt','inputHash','history'].includes(key)))):null;
 const expire=row=>{if(row.turn?.status==='running'&&row.turn.expiresAt<=clock()){Object.assign(row.turn,{status:'failed',answer:null,error:'上次回答已中断或超时，你的提问已保留。',failureCode:'interrupted'});row.calls=[];}};
 const change=(user,requestId,fn)=>mutate(key(user,requestId),empty(),row=>{expire(row);return fn(row);});
 const callFrame=(turn,call)=>({type:'tool_request',id:turn.id,callId:call.callId,name:call.name,args:call.args,bookId:turn.localBook.bookId,contentVersion:turn.contentVersion});
 async function findTurn(user,requestId){return change(user,requestId,row=>publicTurn(row.turn));}
 async function view(user,requestId){return change(user,requestId,row=>{if(!row.turn)throw invalid('找不到这次本机提问',404);return {turn:publicTurn(row.turn),pendingTools:row.turn.status==='running'?row.calls.filter(c=>!c.delivered).map(c=>callFrame(row.turn,c)):[]};});}
 function requireRun(row,runId){if(!row.turn||row.turn.status!=='running'||row.turn.runId!==runId)throw invalid('这次本机回答已结束或中断',409);}
 function checkResult(value,book){
  if(!object(value)||bytes(value)>24576)throw invalid('本机工具结果格式或大小不正确',413);
  const walk=(node,depth=0)=>{if(depth>32)throw invalid('本机工具结果结构过深');if(!node||typeof node!=='object')return;for(const [key,value]of Object.entries(node)){if((key==='bookId'&&value!==book.bookId)||(['contentVersion','sourceVersion'].includes(key)&&value!==book.contentVersion)||(key==='bookIds'&&(!Array.isArray(value)||value.some(id=>id!==book.bookId))))throw invalid('本机工具结果超出当前书籍版本',409);walk(value,depth+1);}};walk(value);
 }
 async function submitTool(user,requestId,callId,input){
  if(!id(callId)||!only(input,['bookId','contentVersion','result']))throw invalid('本机工具回执不正确');
  return change(user,requestId,row=>{
   if(!row.turn)throw invalid('找不到这次本机提问',404);
   requireRun(row,row.turn.runId);const call=row.calls.find(c=>c.callId===callId&&c.runId===row.turn.runId);if(!call)throw invalid('找不到这次本机工具请求',404);
   const book=row.turn.localBook;
   if(input.bookId!==book.bookId||input.contentVersion!==book.contentVersion)throw invalid('本机工具回执版本已变化',409);
   checkResult(input.result,book);
   if(!input.result.error){
    if(['reader_get_context','reader_read_chapter','reader_get_outline'].includes(call.name)&&input.result.bookId!==book.bookId)throw invalid('本机工具结果缺少当前书籍',409);
    if(call.args.chapterId&&input.result.chapterId!==call.args.chapterId)throw invalid('本机工具结果章节不一致',409);
    if(call.name==='reader_get_context'&&!input.result.passages?.some(p=>p.passageId===book.passageId))throw invalid('本机工具结果位置不一致',409);
   }
   if(call.delivered&&!same(call.result,input.result))throw invalid('本机工具回执与原结果不一致',409);
   call.result=structuredClone(input.result);call.delivered=true;return {accepted:true};
  });
 }
 async function cancel(user,requestId){
  const turn=await change(user,requestId,row=>{if(!row.turn)throw invalid('找不到这次本机提问',404);if(row.turn.status==='running'){Object.assign(row.turn,{status:'cancelled',answer:null});row.calls=[];}return publicTurn(row.turn);});
  for(const run of active.values())if(run.user.id===user.id&&run.id===requestId)run.controller.abort();return turn;
 }
 function toolsFor(user,input,runId,signal,onToolRequest){
  const book=input.localBook,visible=new Map(),refs=[];let sourceInvalid=false;
  const addRange=(passageId,layer,value,start,end,metadata)=>{
   if(!id(passageId)||typeof value!=='string'||!value.isWellFormed()||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end-start!==Array.from(value).length)throw invalid('本机文字范围不正确',409);
   const key=JSON.stringify([passageId,layer]),ranges=visible.get(key)||[];
   for(const old of ranges){const begin=Math.max(old.start,start),stop=Math.min(old.end,end);if(begin<stop&&Array.from(old.text).slice(begin-old.start,stop-old.start).join('')!==Array.from(value).slice(begin-start,stop-start).join(''))throw invalid('本机已读文字发生变化',409);}
   ranges.push({start,end,text:value,...metadata});ranges.sort((a,b)=>a.start-b.start);
   const merged=[];for(const item of ranges){const old=merged.at(-1);if(old&&item.start<=old.end){old.text+=Array.from(item.text).slice(Math.max(0,old.end-item.start)).join('');old.end=Math.max(old.end,item.end);}else merged.push({...item});}visible.set(key,merged);
  };
  const remember=result=>{
   for(const p of result.passages||[])for(const layer of ['original','literal','interpretive'])if(typeof p[layer]==='string'){const range=p.visibleRanges?.[layer];addRange(p.passageId,layer,p[layer],range?.charOffset??0,range?.charEnd??Array.from(p[layer]).length,{chapterId:result.chapterId,chapterTitle:result.chapterTitle,translationStatus:p.translationStatus?.[layer]});}
   for(const r of result.results||[])if(['original','literal','interpretive'].includes(r.layer)&&typeof r.excerpt==='string')addRange(r.passageId,r.layer,r.excerpt,r.charOffset??0,r.charEnd??Array.from(r.excerpt).length,{chapterId:r.chapterId});
  };
  return {definitions:localReadingToolDefinitions(),async execute(name,args={},internal={}){
   const activeSignal=internal.signal?AbortSignal.any([signal,internal.signal]):signal;activeSignal.throwIfAborted();
   if(!localReadingToolDefinitions().some(d=>d.name===name))return failure('SCOPE_DENIED');
   if(!validateLocalReadingAgentToolCall(name,args))return failure('INVALID_ARGUMENTS');
   if(args.bookId!==undefined&&args.bookId!==book.bookId||args.bookIds?.some(id=>id!==book.bookId)||args.sourceVersion!==undefined&&args.sourceVersion!==book.contentVersion)return failure('SCOPE_DENIED');
   if(name==='reader_cite'){
    const layer=args.layer||'original',entry=visible.get(JSON.stringify([args.passageId,layer]))?.find(r=>r.text.includes(args.quote));
    if(!entry)return failure('UNREAD_SOURCE','引用必须精确对应本轮已读的本机文字');
    const ref={bookId:book.bookId,contentVersion:book.contentVersion,sourceVersion:book.contentVersion,passageId:args.passageId,...(entry.chapterId?{chapterId:entry.chapterId}:{}),...(entry.chapterTitle?{chapterTitle:entry.chapterTitle}:{}),layer,quote:args.quote,source:'local-device',url:'leafhour://local/read?book='+encodeURIComponent(book.bookId)+'&sourceVersion='+encodeURIComponent(book.contentVersion)+'&passage='+encodeURIComponent(args.passageId),...(layer!=='original'?{translationStatus:entry.translationStatus||'draft'}:{})};
    if(!refs.some(r=>same(r,ref)))refs.push(ref);return structuredClone(ref);
   }
   const call={callId:randomUUID(),runId,name,args:structuredClone(args),delivered:false};
   const frame=await change(user,input.id,row=>{requireRun(row,runId);row.calls.push(call);return callFrame(row.turn,call);});
   await onToolRequest?.(frame);
   for(;;){
    activeSignal.throwIfAborted();const result=await read(key(user,input.id),empty());
    if(result.turn?.expiresAt<=clock()||result.turn?.status!=='running'||result.turn?.runId!==runId)throw invalid('本机工具请求已结束',409);
    const value=result.calls.find(c=>c.callId===call.callId&&c.runId===runId);
    if(value?.delivered){if(!value.result.error)try{remember(value.result);}catch(error){sourceInvalid=true;throw error;}return value.result;}
    await delay(300,undefined,{signal:activeSignal});
   }
  },async verify(){signal.throwIfAborted();if(sourceInvalid)throw invalid('本机原文在本轮读取中发生变化',409);await change(user,input.id,row=>{requireRun(row,runId);return null;});},sources:()=>structuredClone(refs),recommendations:()=>[]};
 }
 async function send(user,raw,{onProgress,onToolRequest}={}){
  identity(user);const input=normalizeLocalChatInput(raw),inputHash=hash(stable(input)),runId=randomUUID(),now=clock();
  const claimed=await change(user,input.id,async row=>{
   if(row.turn){if(row.turn.inputHash!==inputHash)throw invalid('重复提交标识与原本机提问不一致',409);if(row.turn.status==='running')throw invalid('这次本机提问正在回答，请稍后查看',409);return {created:false,turn:publicTurn(row.turn)};}
   if(closed||typeof generator!=='function')throw invalid('阅读对话服务尚未配置',503);
   let voice;if(input.voice!==undefined){if(typeof validateVoice!=='function')throw invalid('语音服务尚未配置',503);voice=await validateVoice(user,input.voice);}
   let replyTo;if(input.replyTo){const source=await read(key(user,input.replyTo.turnId),empty());if(source.turn&&source.turn.localBook?.bookId!==input.localBook.bookId)throw invalid('所引用消息属于其他本机书籍，请重新选择',409);replyTo=resolveChatReplyReference(input.replyTo,source.turn,input.contentVersion);}
   const reactions=input.reactions?.length?await resolveChatReactions(input.reactions,async id=>{const source=await read(key(user,id),empty());if(source.turn?.localBook?.bookId!==input.localBook.bookId)return null;return source.turn;},input.contentVersion):undefined;
   const guideContext=input.guideContext?(typeof resolveGuide==='function'?await resolveGuide(user,input.guideContext,{bookId:input.localBook.bookId,contentVersion:input.contentVersion,sourceKind:'local-device'}):(()=>{throw invalid('阅读前导引用暂不可核验',503);})()):undefined;
   row.turn={...(reactions?.length?{reactions,reactionTargets:input.reactions}:{}),id:input.id,text:input.text,...(guideContext?{guideContext}:{}),contentVersion:input.contentVersion,passageId:input.passageId,requestHash:inputHash,...(voice?{voice}:{}),localBook:{...input.localBook,source:'local-device'},...(input.quote?{quote:input.quote}:{}),...(replyTo?{replyTo}:{}),history:input.history||[],inputHash,runId,expiresAt:now+timeoutMs,origin:'user',createdAt:new Date(now).toISOString(),status:'running',answer:null,activity:[]};return {created:true,voice,replyTo,reactions,guideContext};
  });
  if(!claimed.created)return claimed.turn;
  const controller=new AbortController(),run={user,id:input.id,controller};active.set(runId,run);
  let poll,timer,sequence=0;
  const finish=changes=>change(user,input.id,row=>{if(row.turn?.runId===runId&&row.turn.status==='running'){Object.assign(row.turn,changes);row.calls=[];}return publicTurn(row.turn);});
  try{
   timer=setTimeout(()=>controller.abort(),Math.max(0,now+timeoutMs-clock()));timer.unref?.();
   poll=setInterval(async()=>{try{const current=await read(key(user,input.id),empty());if(current.turn?.runId!==runId||current.turn.status!=='running'||current.turn.expiresAt<=clock())controller.abort();}catch{controller.abort();}},500);poll.unref?.();
   const tools=toolsFor(user,input,runId,controller.signal,onToolRequest),book=input.localBook;
   const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(invalid('本机回答已取消或超时',408)),{once:true}));
   const progress=async value=>{if(!controller.signal.aborted&&Number.isSafeInteger(value?.sequence)&&value.sequence>sequence&&typeof value.text==='string'&&value.text.isWellFormed()){sequence=value.sequence;await onProgress?.({type:'progress',id:input.id,sequence,text:value.text});}};
   const candidate=await Promise.race([Promise.resolve().then(()=>generator({kind:'conversation',book:{bookId:book.bookId,title:book.title,contentVersion:book.contentVersion,source:'local-device'},passageId:book.passageId,chapterId:book.chapterId,chapterTitle:book.chapterTitle,text:input.text,...(claimed.guideContext?{guideContext:claimed.guideContext}:{}),...(claimed.reactions?.length?{reactions:claimed.reactions}:{}),...(input.quote?{quote:input.quote}:{}),...(claimed.voice?{voice:claimed.voice}:{}),...(claimed.replyTo?{replyTo:claimed.replyTo}:{}),history:input.history||[],requestId:input.id,runId,signal:controller.signal,tools,onProgress:progress})),aborted]);
   if(candidate?.kind!=='conversation'||!str(candidate.summary))throw invalid('回答内容无效');await tools.verify();
   const sourceRefs=tools.sources();if(bytes(sourceRefs)>32000)throw invalid('回答引用过长');
   return await withCandidateDelivery(candidate,()=>finish({status:'completed',answer:{kind:'conversation',summary:candidate.summary,sourceRefs,recommendations:[],origin:'ai'}}),{accept:value=>value?.status==='completed'});
  }catch(error){
   if(!controller.signal.aborted)try{onError(error,{phase:'generation',requestId:input.id,runId});}catch{}
   return await finish({status:'failed',answer:null,error:'这次本机回答未完成，你的提问已保留。',failureCode:'generation_failed'});
  }finally{clearTimeout(timer);clearInterval(poll);controller.abort();active.delete(runId);}
 }
 async function close(){closed=true;await Promise.all([...active.values()].map(run=>cancel(run.user,run.id)));}
 return {send,findTurn,view,submitTool,cancel,close,get available(){return !closed&&typeof generator==='function';}};
}
