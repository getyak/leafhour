import {randomUUID} from 'node:crypto';
import {sourceIndex,invalid} from './experience-validation.mjs';

const WARMUP=90000,INTERVAL=300000,SEEN=8000,CHAPTER=45000,IDLE=1800000;
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id);
const clip=(text,max)=>{let result='',bytes=0;for(const char of String(text||'')){bytes+=Buffer.byteLength(char);if(bytes>max)break;result+=char;}return result;};

export function createReaderCompanionService({bookFor,mutateBook,clock,generator,quota,reserveGlobal,releaseGlobal,watchRun,active,publicTurn,conversationHistory,cancel,getClosed,onOutcome=()=>{}}){
  const available=()=>!getClosed()&&typeof generator==='function';
  function state(data,book){
    let m=data.companion;
    const preference=['on','off','default'].includes(m?.preference)?m.preference:m?.enabled===false&&m.revision>1?'off':m?.enabled===true?'on':'default';
    if(!m||m.contentVersion!==book.contentVersion){m=data.companion={enabled:preference!=='off',preference,revision:(m?.revision||0)+1,contentVersion:book.contentVersion,recent:[],activeMs:0,chapterMs:0,chapterId:null,seenCount:0,lastAttemptCount:0,lastAttemptMs:null,attempts:0,sessionId:randomUUID(),lastAt:null,lastActiveAt:null};}
    if(!m.preference){m.preference=preference;if(!m.enabled&&preference!=='off'){m.enabled=true;m.revision++;m.lastAt=null;}}
    return m;
  }
  const meta=m=>({enabled:m.enabled,revision:m.revision,contentVersion:m.contentVersion,available:available(),sessionId:m.sessionId,activeMs:m.activeMs,chapterMs:m.chapterMs,attempts:m.attempts,observedIds:m.recent.filter(p=>p.ms>=SEEN).map(p=>p.id)});
  const check=(m,input)=>{if(!m.enabled||m.revision!==input?.revision||m.contentVersion!==input?.contentVersion||m.sessionId!==input?.sessionId)throw invalid('陪读状态已变化，请重新读取设置',409);};
  const eligible=m=>m.chapterMs>=CHAPTER&&m.attempts<3&&(m.lastAttemptMs===null?m.activeMs>=WARMUP&&m.seenCount>=2:m.activeMs-m.lastAttemptMs>=INTERVAL&&m.seenCount-m.lastAttemptCount>=3);
  const validPassage=(index,id)=>{const p=index.byId.get(id);if(!p||p.kind==='source_heading')throw invalid('找不到可陪读的正文段落',400);return p;};
  async function view(user,bookId){const book=await bookFor(user,bookId);return mutateBook(user,bookId,data=>meta(state(data,book)));}
  async function pause(user,bookId){
    const ids=await mutateBook(user,bookId,data=>data.turns.filter(t=>t.kind==='companion'&&t.status==='running').map(t=>t.id));
    for(const id of ids)await cancel(user,bookId,id);
  }
  async function configure(user,bookId,input){
    const book=await bookFor(user,bookId);if(typeof input?.enabled!=='boolean'||input.contentVersion!==book.contentVersion)throw invalid('请确认当前书籍与陪读设置',409);
    const result=await mutateBook(user,bookId,data=>{
      const m=state(data,book);if(input.enabled&&!available())throw invalid('阅读伙伴暂时不可用',503);
      m.preference=input.enabled?'on':'off';
      if(m.enabled!==input.enabled){m.enabled=input.enabled;m.revision++;m.lastAt=null;}
      if(!m.enabled)for(const t of data.turns)if(t.kind==='companion'&&t.status==='running'){t.status='cancelled';t.answer=null;}
      return meta(m);
    });
    if(!input.enabled)for(const run of active.values())if(run.companion&&run.user.id===user.id&&run.bookId===bookId)run.controller.abort();
    return result;
  }
  async function observe(user,bookId,input){
    const book=await bookFor(user,bookId),index=sourceIndex(book),p=validPassage(index,input?.passageId),now=clock();
    if(typeof input.active!=='boolean')throw invalid('阅读观察格式不正确');
    return mutateBook(user,bookId,data=>{
      const m=state(data,book);check(m,input);
      if(m.lastActiveAt!=null&&now-m.lastActiveAt>=IDLE){Object.assign(m,{activeMs:0,chapterMs:0,seenCount:0,lastAttemptCount:0,lastAttemptMs:null,attempts:0,sessionId:randomUUID(),lastAt:null,lastActiveAt:null});}
      const elapsed=input.active&&m.wasActive&&m.lastAt!==null?Math.max(0,Math.min(10000,now-m.lastAt)):0;
      m.activeMs+=elapsed;if(m.chapterId!==p.chapterId){m.chapterId=p.chapterId;m.chapterMs=0;}else m.chapterMs+=elapsed;
      if(input.active){
        let row=m.recent.find(r=>r.id===p.id);if(!row){row={id:p.id,ms:0,sessionMs:0,sessionId:m.sessionId,at:now};m.recent.push(row);}
        if(row.sessionId!==m.sessionId){row.sessionId=m.sessionId;row.sessionMs=0;}
        const before=row.sessionMs||0;if(m.lastPassageId===p.id){row.ms=Math.min(SEEN,row.ms+elapsed);row.sessionMs=before+elapsed;}row.at=now;m.lastActiveAt=now;
        if(before<SEEN&&row.sessionMs>=SEEN)m.seenCount++;
        m.recent=m.recent.slice(-48);
      }
      m.lastAt=now;m.wasActive=input.active;m.lastPassageId=p.id;
      return {...meta(m),eligible:input.active&&eligible(m)};
    });
  }
  function contextFor(book,m,passageId,history){
    const index=sourceIndex(book),ids=[passageId,...m.recent.filter(r=>r.ms>=SEEN&&r.id!==passageId).sort((a,b)=>b.at-a.at).slice(0,23).map(r=>r.id)];
    const passages=ids.map(id=>{const p=validPassage(index,id);return {id,chapterId:p.chapterId,original:clip(p.original, id===passageId?4096:1536),literal:clip(p.translations?.literal?.text,1024)||null,interpretive:clip(p.translations?.interpretive?.text,1024)||null};});
    const context={currentPassageId:passageId,observation:'foreground-visible, not evidence of comprehension',passages};
    while(Buffer.byteLength(JSON.stringify(context))>18000&&passages.length>1)passages.pop();
    while(Buffer.byteLength(JSON.stringify(history))>3000&&history.length)history.shift();
    return {context,history};
  }
  function answerFor(candidate,context,bookId){
    if(candidate?.kind==='silence')return null;
    if(candidate?.kind!=='message'||typeof candidate.text!=='string'||!candidate.text.trim()||!candidate.text.isWellFormed()||[...candidate.text].length>180||!Array.isArray(candidate.sourcePassageIds)||!candidate.sourcePassageIds.length||candidate.sourcePassageIds.length>8)throw invalid('陪读消息格式不正确');
    const rows=candidate.sourcePassageIds.map(id=>context.passages.find(p=>p.id===id));if(rows.some(p=>!p))throw invalid('陪读引用不在本次阅读范围');
    const texts=context.passages.flatMap(p=>[p.original,p.literal,p.interpretive].filter(Boolean));
    for(const [,quote]of candidate.text.matchAll(/[“「]([^”」]+)[”」]/gu))if(!texts.some(text=>text.includes(quote)))throw invalid('陪读引文无法核对');
    return {kind:'companion',summary:candidate.text.trim(),origin:'ai',sourceRefs:rows.map(p=>({bookId,passageId:p.id,layer:'original',quote:clip(p.original,300),url:'/read?book='+encodeURIComponent(bookId)+'&passage='+encodeURIComponent(p.id)})),recommendations:[]};
  }
  async function generate(user,bookId,input,{authorize=async()=>true,operationId}={}){
    const book=await bookFor(user,bookId),index=sourceIndex(book),now=clock(),runId=randomUUID();
    if(!safeId(input?.id)||!safeId(input?.passageId))throw invalid('陪读消息标识不正确');validPassage(index,input.passageId);
    const claimed=await mutateBook(user,bookId,data=>{
      const m=state(data,book);check(m,input);const old=data.turns.find(t=>t.id===input.id);
      if(old){if(old.kind!=='companion'||old.passageId!==input.passageId||old.contentVersion!==input.contentVersion)throw invalid('重复消息标识不一致',409);if(old.status==='running')throw invalid('陪读消息正在准备',409);return {created:false,turn:publicTurn(old)};}
      if(!available())throw invalid('阅读伙伴暂时不可用',503);
      if(!eligible(m)||!m.wasActive||now-m.lastAt>15000||m.lastPassageId!==input.passageId||!m.recent.some(p=>p.id===input.passageId&&p.ms>=SEEN))throw invalid('先继续读一会儿，陪读会在合适时出现',409);
      if(data.turns.some(t=>t.status==='running'))throw invalid('这本书还有对话正在处理',409);
      if(data.turns.length>=100)throw invalid('请先导出保存这本书的对话',413);
      m.attempts++;m.lastAttemptMs=m.activeMs;m.lastAttemptCount=m.seenCount;
      const turn={id:input.id,kind:'companion',scope:'book',origin:'ai',text:null,passageId:input.passageId,contentVersion:book.contentVersion,createdAt:new Date(now).toISOString(),status:'running',answer:null,activity:[],runId,expiresAt:now+90000,consentRevision:m.revision,sessionId:m.sessionId};
      const payload=contextFor(book,m,input.passageId,conversationHistory(data.turns,{mode:'book'},book.contentVersion));data.turns.push(turn);return {created:true,turn:publicTurn(turn),...payload};
    });
    if(!claimed.created)return claimed.turn;
    const controller=new AbortController();active.set(runId,{controller,user,bookId,id:input.id,runId,companion:true});let ticket,timer,stopWatching=()=>{},phase='admission',timedOut=false;
    const finish=changes=>mutateBook(user,bookId,data=>{const m=state(data,book),t=data.turns.find(t=>t.id===input.id);if(!t)throw invalid('找不到陪读消息',404);if(t.status==='running'&&t.runId===runId){if(!m.enabled||m.revision!==input.revision||m.sessionId!==input.sessionId||controller.signal.aborted)Object.assign(t,{status:'cancelled',answer:null});else Object.assign(t,changes);}return publicTurn(t);});
    try{
      await quota(user,runId,{kind:'companion'});ticket=await reserveGlobal(runId);
      phase='authorization';
      if(!await authorize())return await finish({status:'cancelled',answer:null});
      const mayStart=await mutateBook(user,bookId,data=>{const m=state(data,book),t=data.turns.find(t=>t.id===input.id);return m.enabled&&m.revision===input.revision&&m.sessionId===input.sessionId&&t?.status==='running'&&t.runId===runId&&t.expiresAt>clock()&&!getClosed();});
      if(!mayStart||controller.signal.aborted)return await finish({status:'cancelled',answer:null});
      const interrupted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(invalid('陪读已停止',408)),{once:true}));
      phase='generation';timer=setTimeout(()=>{timedOut=true;controller.abort();},90000);timer.unref?.();stopWatching=watchRun(user,bookId,input.id,runId,controller);
      const candidate=await Promise.race([Promise.resolve().then(()=>generator({kind:'companion',book:{bookId:book.bookId,contentVersion:book.contentVersion,title:book.title},passageId:input.passageId,chapterId:index.byId.get(input.passageId).chapterId,context:claimed.context,history:claimed.history,signal:controller.signal,runId})),interrupted]);
      phase='authorization';if(!await authorize())return await finish({status:'cancelled',answer:null});
      phase='validation';const answer=answerFor(candidate,claimed.context,bookId);
      phase='source';const fresh=await bookFor(user,bookId),freshIndex=sourceIndex(fresh);
      if(fresh.contentVersion!==book.contentVersion||claimed.context.passages.some(p=>freshIndex.byId.get(p.id)?.original!==index.byId.get(p.id)?.original))throw invalid('原文版本已变化',409);
      phase='commit';return await finish({status:answer?'completed':'silent',answer});
    }catch(error){
      // A rejected provider still crosses the authorization boundary: the
      // request may have been revoked while that provider was pending.
      let authorized=false;try{authorized=await authorize();}catch{}
      const result=await finish({status:authorized?'failed':'cancelled',answer:null});
      const expectedLimit=['admission','authorization','source'].includes(phase)&&Number.isInteger(error?.status)&&error.status>=400&&error.status<500;
      const cancelled=!timedOut&&(controller.signal.aborted||error?.name==='AbortError'||error?.code==='ABORT_ERR');
      if(authorized&&result.status==='failed'&&!expectedLimit&&!cancelled){
        const errorKind=timedOut||error?.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)?'timeout':phase==='validation'?'parse':phase==='commit'?'storage':['ECONNRESET','ECONNREFUSED','ENOTFOUND'].includes(error?.code)?'network':'internal';
        // Only a persisted outcome and fixed categories reach the observer.
        // Run IDs provide private-free deduplication; no turn/context/error is copied.
        const event={name:'companion_failed',properties:{page:'reader',stage:'companion',outcome:'failure',errorKind}};
        try{Promise.resolve(onOutcome({id:user.id},event,{operationId:operationId||runId,dedupKey:'companion-failed:'+runId})).catch(()=>{});}catch{}
      }
      return result;
    }
    finally{stopWatching();clearTimeout(timer);controller.abort();active.delete(runId);if(ticket)await releaseGlobal(ticket).catch(()=>{});}
  }
  return {view,configure,observe,generate,pause};
}
