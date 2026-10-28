import {normalizeReadingChatQuote,validateCurrentReadingChatQuote} from '../app/reading-chat-quote.mjs';
import {encodeReadingChatInput} from '../app/reading-chat-input.mjs';
import {mkdir,readFile,writeFile,rename,stat,unlink,rmdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {sourceIndex,invalid} from './experience-validation.mjs';
import {portableChatTurns,valueEqual,exportChatTurn} from '../app/portable-chat.mjs';

import {createReaderCompanionService} from './reader-companion.mjs';
import {createReaderAnnotationsService} from './reader-annotations.mjs';
import {createReadingAgentTools} from './reading-agent-tools.mjs';
import {readChatScope,changeChatScope,checkChatScopeRevision} from '../app/reading-chat-scope.mjs';

const MAX_TURNS=100,RUN_MS=90000,HOUR_MS=3600000,DAY_MS=86400000,CANCEL_POLL_MS=500;
const FAILED='这次回答未通过生成或来源核验，你的提问已保留。';
const FAILURE_CODES=new Set(['generation_failed','pricing_unavailable','save_failed','result_invalid','context_changed','interrupted']);
const EXPIRED='上次回答已中断或超时，你的提问已保留。';
const digest=value=>createHash('sha256').update(value).digest('hex');
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&value.isWellFormed();
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
const identity=user=>{if(!text(user?.id,256)||user.is_anonymous)throw invalid('请先进入自己的书房',401);return user;};
const publicTurn=turn=>structuredClone({id:turn.id,passageId:turn.passageId,contentVersion:turn.contentVersion,...(turn.scopeRevision!==undefined?{scopeRevision:turn.scopeRevision}:{}),text:turn.text,...(turn.peopleWrites===true?{peopleWrites:true}:{}),...(turn.preferenceWrites===true?{preferenceWrites:true}:{}),...(turn.quote!==undefined?{quote:turn.quote}:{}),origin:turn.kind==='companion'?'ai':'user',...(turn.kind==='companion'?{kind:'companion'}:{}),createdAt:turn.createdAt,status:turn.status,answer:turn.answer,activity:safeActivity(turn.activity),...(turn.error?{error:turn.error}:{}),...(turn.status==='failed'&&FAILURE_CODES.has(turn.failureCode)?{failureCode:turn.failureCode}:{})});
const safeActivity=value=>(Array.isArray(value)?value:[]).slice(-48).map(item=>Object.fromEntries(['tool','label','status','bookId','chapterId'].filter(key=>typeof item[key]==='string'&&item[key].length<=200).map(key=>[key,item[key]])));
const empty=bookId=>({kind:'marginalia-reader-chat',schemaVersion:1,bookId,turns:[]});

function contextFor(book,index,passageId,position){
  if(passageId!==undefined&&!index.byId.has(passageId))throw invalid('这段原文不存在');
  const front=new Set(book.chapters.filter(c=>['frontmatter','front_matter','title'].includes(c.kind)).map(c=>c.id));
  const firstBody=book.chapters.find(c=>c.kind==='body')||book.chapters.find(c=>!front.has(c.id));
  const readable=p=>p&&p.kind!=='source_heading'&&!front.has(p.chapterId);
  const preferred=[index.byId.get(book.readingStart?.passageId),index.byId.get(firstBody?.startPassageId),...index.rows].find(p=>readable(p)&&(!firstBody||p.chapterId===firstBody.id));
  const selected=index.byId.get(passageId)||index.byId.get(position?.passageId)||preferred||index.rows.find(readable)||index.rows[0];
  if(!selected)throw invalid('这本书还没有可提问的正文',409);
  const translation=variant=>text(selected.translations?.[variant]?.text,1000000)?selected.translations[variant]:null;
  const literal=translation('literal'),interpretive=translation('interpretive');
  return {passageId:selected.id,chapterId:selected.chapterId,chapterTitle:book.chapters.find(c=>c.id===selected.chapterId)?.title||null,original:selected.original,literal:literal?.text||null,interpretive:interpretive?.text||null,translationStatus:{literal:literal?.status||'missing',interpretive:interpretive?.status||'missing'}};
}

function conversationHistory(turns,scope={mode:'book'},contentVersion){
  const pairs=turns.filter(t=>t.status==='completed'&&typeof t.answer?.summary==='string'&&(!contentVersion||t.contentVersion===contentVersion)&&(scope.mode==='library'||t.scope==='book')).slice(-6).map(t=>t.kind==='companion'?[{role:'assistant',content:t.answer.summary}]:[{role:'user',content:t.text,...(t.quote?{quote:t.quote}:{})},{role:'assistant',content:t.answer.summary}]);
  while(pairs.length&&bytes(pairs.flat())>24576)pairs.shift();
  return pairs.flat();
}

export async function createReaderChatService({library,people=null,dataDir,dataStore=null,generator=null,clock=Date.now,onError=()=>{},companionGenerator=null,annotationGenerator=null,onCompanionOutcome=()=>{}}){
  if(!library?.getBook||!library?.records||!library?.addComment||!dataDir)throw new TypeError('Reader chat requires a library and data directory');
  let closed=false;const queues=new Map(),active=new Map();
  const ownerDir=user=>path.join(dataDir,'users',digest(identity(user).id),'chat');
  const filename=(user,bookId)=>path.join(ownerDir(user),digest(bookId)+'.json');
  const budgetFile=dataStore?'limits/reader-chat':path.join(dataDir,'limits','reader-chat.json');
  const emptyBudget=()=>({requests:[],active:{}});
  const read=async(file,fallback)=>{if(dataStore)return dataStore.read(file,fallback);try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return structuredClone(fallback);throw error;}};

  // Local atomic renames alone do not prevent two Node processes from both
  // claiming a running turn. The short exclusive lock guards each read/write.
  const removeEmpty=async dir=>{try{await rmdir(dir);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code))throw error;}};
  async function recoverLock(dir){
    try{
      if(Date.now()-(await stat(dir)).mtimeMs<=30000)return;
      const owners=await readdir(dir);
      if(!owners.length){await removeEmpty(dir);return;}
      if(owners.length!==1||!/^\d+-[a-f0-9-]+$/.test(owners[0]))return;
      const pid=Number(owners[0].split('-')[0]);let alive=Number.isSafeInteger(pid)&&pid>0;
      if(alive)try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive)return;
      // Only the process that removes this specific dead owner's file may
      // remove the directory. A second reaper cannot remove a new owner's lock.
      try{await unlink(path.join(dir,owners[0]));}catch(error){if(error.code==='ENOENT')return;throw error;}
      await removeEmpty(dir);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async function lock(file){
    const dir=file+'.lock',owner=path.join(dir,process.pid+'-'+randomUUID()),started=Date.now();
    await mkdir(path.dirname(file),{recursive:true,mode:0o700});
    for(;;){
      try{
        await mkdir(dir,{mode:0o700});
        try{await writeFile(owner,'',{flag:'wx',mode:0o600});}catch(error){if(error.code==='ENOENT')continue;await removeEmpty(dir);throw error;}
        return async()=>{await unlink(owner).catch(error=>{if(error.code!=='ENOENT')throw error;});await removeEmpty(dir);};
      }catch(error){if(error.code!=='EEXIST')throw error;await recoverLock(dir);}
      if(Date.now()-started>5000)throw invalid('记录正在保存，请稍后重试',503);
      await delay(10);
    }
  }
  async function mutate(file,fallback,operation){
    if(dataStore)return dataStore.mutate(file,fallback,operation);
    const prior=queues.get(file)||Promise.resolve();
    const work=prior.catch(()=>{}).then(async()=>{
      const release=await lock(file);let pending;
      try{const data=await read(file,fallback),result=await operation(data);pending=file+'.'+randomUUID()+'.pending';await writeFile(pending,JSON.stringify(data),{mode:0o600});await rename(pending,file);pending=null;return structuredClone(result);}
      finally{if(pending)await unlink(pending).catch(()=>{});await release();}
    });
    queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
  }
  function expire(data,now){
    for(const turn of data.turns)if(turn.status==='running'&&(!Number.isFinite(turn.expiresAt)||turn.expiresAt<=now))Object.assign(turn,{status:'failed',answer:null,error:EXPIRED,failureCode:'interrupted'});
  }
  const mutateBook=(user,bookId,operation)=>{const now=clock();return mutate(filename(user,bookId),empty(bookId),data=>{expire(data,now);return operation(data);});};
  function watchRun(user,bookId,id,runId,controller){
    let stopped=false,timer;
    const stop=()=>{stopped=true;clearTimeout(timer);controller.signal.removeEventListener('abort',stop);};
    const schedule=()=>{timer=setTimeout(check,CANCEL_POLL_MS);timer.unref?.();};
    async function check(){
      if(stopped||controller.signal.aborted)return;
      try{
        // Cancellation can be handled by another process or hosted instance.
        // Read the shared authority while generating, without extending its lease.
        const data=await read(filename(user,bookId),empty(bookId));
        if(stopped||controller.signal.aborted)return;
        const turn=data.turns.find(t=>t.id===id);
        if(closed||!turn||turn.runId!==runId||turn.status!=='running'||!Number.isFinite(turn.expiresAt)||turn.expiresAt<=clock()){controller.abort();return;}
      }catch{if(!stopped)controller.abort();return;}
      if(!stopped)schedule();
    }
    controller.signal.addEventListener('abort',stop,{once:true});
    schedule();return stop;
  }
  async function bookFor(user,bookId){identity(user);if(!text(bookId,128))throw invalid('找不到这本书',404);return library.getBook(user,bookId);}
  async function view(user,bookId,{passageId}={}){
    const book=await bookFor(user,bookId),index=sourceIndex(book),records=await library.records(user,bookId),context=contextFor(book,index,passageId,records.position);
    const saved=await mutateBook(user,bookId,data=>({scope:readChatScope(data.scope),turns:data.turns.filter(t=>t.kind!=='companion'||t.status==='completed'&&t.answer).map(publicTurn)}));
    return {available:!closed&&typeof generator==='function',bookId,title:book.title,contentVersion:book.contentVersion,context,...saved};
  }
  async function configureScope(user,bookId,input){
    await bookFor(user,bookId);
    return mutateBook(user,bookId,data=>{data.scope=changeChatScope(readChatScope(data.scope),input,{running:data.turns.some(t=>t.status==='running')});return data.scope;});
  }
  async function quota(user,runId,{kind='conversation'}={}){
    const now=clock();
    await mutate(path.join(ownerDir(user),'requests.json'),{requests:[]},data=>{
      data.requests=data.requests.filter(r=>Number.isFinite(r.at)&&r.at>now-HOUR_MS);
      if(data.requests.some(r=>r.id===runId))return null;
      if(data.requests.length>=10)throw invalid('这一小时的提问次数已用完，请稍后继续',429);
      if(kind==='companion'){const prior=data.requests.filter(r=>r.kind==='companion');if(prior.length>=3||prior.some(r=>now-r.at<300000))throw invalid('陪读稍后再来，先继续阅读',429);}
      data.requests.push({id:runId,at:now,kind});return null;
    });
  }
  async function reserveGlobal(nonce){
    const now=clock();
    return mutate(budgetFile,emptyBudget(),data=>{
      data.requests=data.requests.filter(r=>Number.isFinite(r.at)&&r.at>now-DAY_MS);
      for(const [key,lease]of Object.entries(data.active))if(!Number.isFinite(lease.expiresAt)||lease.expiresAt<=now)delete data.active[key];
      if(data.active[nonce]?.nonce===nonce)return {nonce};
      if(Object.keys(data.active).length>=2)throw invalid('阅读对话正在处理其他提问，请稍后再试',429);
      if(data.requests.filter(r=>r.at>now-HOUR_MS).length>=100||data.requests.length>=500)throw invalid('阅读对话的共享请求额度已用完，请稍后继续',429);
      data.requests.push({nonce,at:now});data.active[nonce]={nonce,expiresAt:now+RUN_MS};return {nonce};
    });
  }
  async function releaseGlobal(ticket){
    await mutate(budgetFile,emptyBudget(),data=>{if(data.active[ticket.nonce]?.nonce===ticket.nonce)delete data.active[ticket.nonce];return null;});
  }
  async function finish(user,bookId,id,runId,changes){
    return mutateBook(user,bookId,data=>{const turn=data.turns.find(t=>t.id===id);if(!turn)throw invalid('找不到这次提问',404);if(turn.status==='running'&&turn.runId===runId)Object.assign(turn,changes);return publicTurn(turn);});
  }
  async function send(user,bookId,input,{onProgress,authorizePeople}={}){
    const book=await bookFor(user,bookId);
    if(!input||!safeId(input.id)||!text(input.text,2000)||!text(input.contentVersion,256)||!text(input.passageId,128))throw invalid('请提交当前段落中不超过 2,000 字的提问');
    // Normalize without current-source validation: exact terminal retries are
    // historical receipts and survive later account translation edits.
    if(input.peopleWrites!==undefined&&typeof input.peopleWrites!=='boolean')throw invalid('人物资料授权格式不正确');
    if(input.preferenceWrites!==undefined&&typeof input.preferenceWrites!=='boolean')throw invalid('阅读偏好授权格式不正确');
    input={...input,...(input.quote!==undefined?{quote:normalizeReadingChatQuote(input.quote)}:{})};
    const index=sourceIndex(book);
    const runId=randomUUID(),now=clock();
    const claimed=await mutateBook(user,bookId,data=>{
      const old=data.turns.find(t=>t.id===input.id);
      if(old){if(!!old.peopleWrites!==!!input.peopleWrites||!!old.preferenceWrites!==!!input.preferenceWrites||old.passageId!==input.passageId||old.text!==input.text||old.contentVersion!==input.contentVersion||(old.scopeRevision??0)!==(input.scopeRevision??0)||!valueEqual(old.quote??null,input.quote??null))throw invalid('重复提交标识与原提问或查阅范围不一致',409);if(old.status==='running')throw invalid('这次提问正在回答，请稍后查看',409);return {created:false,turn:publicTurn(old)};}
      if(!index.byId.has(input.passageId))throw invalid('这段原文不存在');
      if(input.contentVersion!==book.contentVersion)throw invalid('原文版本已变化，请重新打开这一段',input.quote?422:409);
      if(input.quote!==undefined){try{validateCurrentReadingChatQuote(input.quote,book);if(input.quote.parts[0].passageId!==input.passageId)throw Error('context');}catch{throw invalid('所选文字已变化，请移除或重新选择后再提问。',422);}}
      const scope=readChatScope(data.scope);checkChatScopeRevision(scope,input);
      const selected=index.byId.get(input.passageId),location={book:{bookId:book.bookId,contentVersion:book.contentVersion,title:book.title},passageId:input.passageId,chapterId:selected.chapterId,chapterTitle:book.chapters.find(c=>c.id===selected.chapterId)?.title||null,text:input.text,...(input.quote?{quote:input.quote}:{})};
      // Preflight the actual shared encoder before claim/comment/quota/pause.
      encodeReadingChatInput(location);

      if(closed||typeof generator!=='function')throw invalid('阅读对话服务尚未配置',503);
      if(data.turns.some(t=>t.status==='running'&&t.kind!=='companion'))throw invalid('这本书还有一条提问正在回答',409);
      if(data.turns.length>=MAX_TURNS)throw invalid('这本书的对话记录已达上限，请先保留导出备份',413);
      const turn={...(input.peopleWrites===true?{peopleWrites:true}:{}),...(input.preferenceWrites===true?{preferenceWrites:true}:{}),id:input.id,passageId:input.passageId,contentVersion:input.contentVersion,text:input.text,...(input.quote?{quote:input.quote}:{}),origin:'user',createdAt:new Date(now).toISOString(),status:'running',answer:null,activity:[],runId,expiresAt:now+RUN_MS,scope:scope.mode,scopeRevision:scope.revision};
      const history=conversationHistory(data.turns,scope,book.contentVersion);
      const paused=data.turns.filter(t=>t.kind==='companion'&&t.status==='running').map(t=>{t.status='cancelled';t.answer=null;return t.id;});
      data.turns.push(turn);return {created:true,turn:publicTurn(turn),history,scope,paused};
    });
    if(!claimed.created)return claimed.turn;
    for(const run of active.values())if(run.user.id===user.id&&run.bookId===bookId&&claimed.paused.includes(run.id))run.controller.abort();
    const controller=new AbortController(),key=runId;
    const running={controller,user,bookId,id:input.id,runId};active.set(key,running);
    let timer,ticket=null,stopWatching=()=>{},phase='record-question';
    try{
      if(closed)return await finish(user,bookId,input.id,runId,{status:'cancelled',answer:null});
      await library.addComment(user,bookId,{id:'chat-'+input.id,passageId:input.passageId,text:input.text,origin:'user',contentVersion:input.contentVersion},'questions');
      phase='quota';await quota(user,runId);
      ticket=await reserveGlobal(runId);
      // Cancellation may have been persisted by another process while the
      // original question was entering the library or waiting for its quota.
      const current=await mutateBook(user,bookId,data=>publicTurn(data.turns.find(t=>t.id===input.id)));
      if(current.status!=='running'||controller.signal.aborted)return current;
      const abort=new Promise((resolve,reject)=>{
        controller.signal.addEventListener('abort',()=>reject(invalid('回答已取消或超时',408)),{once:true});
      });
      timer=setTimeout(()=>controller.abort(),Math.max(0,now+RUN_MS-clock()));timer.unref?.();
      stopWatching=watchRun(user,bookId,input.id,runId,controller);
      const onActivity=async activity=>{
        if(controller.signal.aborted)return;
        await mutateBook(user,bookId,data=>{
          const turn=data.turns.find(t=>t.id===input.id);
          if(controller.signal.aborted||!turn||turn.runId!==runId||turn.status!=='running'||turn.expiresAt<=clock())return null;
          const item=safeActivity([activity])[0];if(!item)return null;
          const activities=turn.activity||[];
          const prior=activities.findLastIndex(a=>a.tool===item.tool&&a.status==='running');
          if(item.status!=='running'&&prior>=0)activities[prior]=item;else activities.push(item);
          turn.activity=activities.slice(-48);return null;
        });
      };
      const tools=createReadingAgentTools({library,user,people,allowPersonWrites:input.peopleWrites===true,authorizePeople,currentBook:book,bookId,passageId:input.passageId,scope:claimed.scope.mode,allowPreferenceWrites:input.preferenceWrites===true,signal:controller.signal,onActivity});
      const selected=index.byId.get(input.passageId);
      let sequence=0;
      const progress=typeof onProgress==='function'?async value=>{
        if(controller.signal.aborted||!Number.isSafeInteger(value?.sequence)||value.sequence<=sequence||typeof value.text!=='string'||value.text.length>12000||!value.text.isWellFormed())return;
        // watchRun checks shared cancellation every 500ms. Token delivery must
        // not add a cloud-storage read per chunk or persist provisional text.
        sequence=value.sequence;await onProgress({type:'progress',id:input.id,sequence,text:value.text});
      }:undefined;
      phase='generation';const candidate=await Promise.race([Promise.resolve().then(()=>generator({kind:'conversation',book:{bookId:book.bookId,contentVersion:book.contentVersion,title:book.title},passageId:input.passageId,chapterId:selected.chapterId,chapterTitle:book.chapters.find(c=>c.id===selected.chapterId)?.title||null,text:input.text,...(input.quote?{quote:input.quote}:{}),history:claimed.history,runId,requestId:input.id,signal:controller.signal,tools,...(progress?{onProgress:progress}:{})})),abort]);
      phase='verify-source';
      if(candidate?.kind!=='conversation'||!text(candidate.summary,12000))throw invalid('回答内容无效');
      await tools.verify();
      const answer={kind:'conversation',summary:candidate.summary,sourceRefs:tools.sources(),recommendations:tools.recommendations(),...(tools.peopleSources?.().length?{personSources:tools.peopleSources()}:{}),origin:'ai'};
      if(bytes(answer)>96000||bytes(answer.sourceRefs)>32000)throw invalid('回答引用过长');
      phase='verify-version';const fresh=await bookFor(user,bookId);
      if(fresh.contentVersion!==book.contentVersion||sourceIndex(fresh).byId.get(input.passageId)?.original!==index.byId.get(input.passageId)?.original)throw invalid('原文版本已变化',409);
      if(input.quote)validateCurrentReadingChatQuote(input.quote,fresh);
      if(controller.signal.aborted)throw invalid('回答已取消',408);
      phase='save-answer';return await finish(user,bookId,input.id,runId,{status:'completed',answer});
    }catch(error){
      if(!controller.signal.aborted&&error?.status!==429)try{onError(error,{phase,requestId:input.id});}catch{}
      const code=Object.getOwnPropertyDescriptor(error||{},'code')?.value;
      const failureCode=phase==='save-answer'?'save_failed':code==='PRICING_REFERENCE_UNAVAILABLE'?'pricing_unavailable':phase==='verify-source'?'result_invalid':phase==='verify-version'?'context_changed':'generation_failed';
      const turn=await finish(user,bookId,input.id,runId,{status:'failed',answer:null,error:FAILED,failureCode});
      if(error?.status===429)throw error;
      return turn;
    }finally{stopWatching();clearTimeout(timer);controller.abort();active.delete(key);if(ticket)await releaseGlobal(ticket).catch(()=>{});}
  }
  async function cancel(user,bookId,id){
    await bookFor(user,bookId);if(!safeId(id))throw invalid('提问标识不正确');
    const turn=await mutateBook(user,bookId,data=>{const turn=data.turns.find(t=>t.id===id);if(!turn)throw invalid('找不到这次提问',404);if(turn.status==='running'){turn.status='cancelled';turn.answer=null;}return publicTurn(turn);});
    for(const run of active.values())if(run.user.id===user.id&&run.bookId===bookId&&run.id===id)run.controller.abort();
    return turn;
  }
  async function close(){
    closed=true;
    // The annotation child closes first with its own active map; parent close
    // then finishes conversation runs and queues as before.
    await annotations.close().catch(()=>{});
    unregisterGrantRevocation?.();
    unregisterSourceMutation?.();
    await Promise.all([...active.values()].map(async run=>{await finish(run.user,run.bookId,run.id,run.runId,{status:'cancelled',answer:null});run.controller.abort();}));
    await Promise.allSettled([...queues.values()]);
  }
  async function exportHistory(user,bookId){
    const book=await bookFor(user,bookId),data=await read(filename(user,bookId),empty(bookId));
    return {...empty(bookId),turns:data.turns.filter(t=>t.kind!=='companion'||t.status==='completed'&&t.answer).map(t=>exportChatTurn(publicTurn(t),book))};
  }
  function mergeHistory(data,turns,book,books,storedBook){
    for(const incoming of turns){const existing=data.turns.find(t=>t.id===incoming.id);
      if(existing){if(existing.passageId!==incoming.passageId||existing.contentVersion!==incoming.contentVersion||existing.text!==incoming.text||!valueEqual(existing.quote??null,incoming.quote??null)||(existing.kind==='companion')!==(incoming.kind==='companion')||incoming.status==='completed'&&(existing.status!=='completed'||!valueEqual(portableChatTurns({...empty(book.bookId),turns:[exportChatTurn(publicTurn(existing),storedBook)]},book,books)[0].answer,incoming.answer)))throw invalid('备份对话标识与已有历史冲突，未覆盖记录',409);}
    }
    const missing=turns.filter(t=>!data.turns.some(old=>old.id===t.id));if(data.turns.length+missing.length>MAX_TURNS)throw invalid('恢复后对话超过 100 条，请在本机整理',413);
    // Imported history cannot silently become context for the narrower book scope.
    return missing.map(t=>({...t,scope:'library'}));
  }
  async function validateHistory(user,book,history,books){
    identity(user);const turns=portableChatTurns(history,book,books),data=await read(filename(user,book.bookId),empty(book.bookId)),storedBook=data.turns.length?await bookFor(user,book.bookId):book;mergeHistory(data,turns,book,books,storedBook);return turns;
  }
  async function restoreHistory(user,book,history,books){
    const turns=await validateHistory(user,book,history,books),storedBook=await bookFor(user,book.bookId);
    return mutateBook(user,book.bookId,data=>{const added=mergeHistory(data,turns,book,books,storedBook);data.turns.push(...added);return {restored:added.length};});
  }
  const companion=createReaderCompanionService({bookFor,mutateBook,clock,generator:companionGenerator,quota,reserveGlobal,releaseGlobal,watchRun,active,publicTurn,conversationHistory,cancel,getClosed:()=>closed,onOutcome:onCompanionOutcome});
  // GET-195: the child chat.annotations service reuses these exact closures for
  // identity, paths, transactions and quotas; it keeps its own active map.
  const annotations=createReaderAnnotationsService({library,bookFor,identity,dataDir,read,mutate,quota,reserveGlobal,releaseGlobal,clock,generator:annotationGenerator,onError,getClosed:()=>closed});
  const unregisterSourceMutation=typeof library.registerSourceMutation==='function'?library.registerSourceMutation((user,bookId,event)=>annotations.fence(user,bookId,event)):null;
  // GET-195: a revoked external grant must touch the same annotations wrapper
  // before the revocation is acknowledged, so a held external put CAS retries,
  // re-authorizes and fails instead of writing after the ACK.
  const unregisterGrantRevocation=typeof library.registerGrantRevocation==='function'?library.registerGrantRevocation((ownerId,grantId)=>annotations.grantRevoked(ownerId,grantId)):null;
  return {get available(){return !closed&&typeof generator==='function';},view,configureScope,send,cancel,close,companion,annotations,exportHistory,validateHistory,restoreHistory};
}
