// Bounded, resumable translation batch planning and checkpointing (GET-151).
// This module never talks to a provider: it only orchestrates the existing
// authenticated Leafhour HTTP translation API, serially, from stable IDs.
// Checkpoints and logs keep stable IDs and reason codes only — never session
// tokens, original text, translations, notes or personal records.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,unlink,lstat,writeFile,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {inferSourceLanguage} from '../../app/source-language.mjs';
import {digest} from '../../server/document-import.mjs';

export const MAX_BATCH_REQUESTS=20;
const UNITS_PER_POINT=1_000_000;
const validPointBudget=value=>Number.isSafeInteger(value)&&value>=0&&Number.isSafeInteger(value*UNITS_PER_POINT);
export const SESSION_ENV='LEAFHOUR_SESSION';
export const CHECKPOINT_KIND='leafhour-translation-batch-checkpoint';
export const CHECKPOINT_SCHEMA_VERSION=1;

export class BatchError extends Error{
  constructor(message,{code='batch-error',usage=false,unknown=false}={}){
    super(message);this.name='BatchError';this.code=code;this.usage=usage;this.unknown=unknown;
  }
}
const error=(message,code,extra)=>new BatchError(message,{code,...extra});

// --- service address -------------------------------------------------------
export function validateServiceOrigin(value){
  let url;
  try{url=new URL(value);}catch{throw error('服务地址必须是完整 URL，例如 https://leafhour.com','bad-origin',{usage:true});}
  const loopback=url.hostname==='localhost'||url.hostname==='::1'||url.hostname==='[::1]'||/^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw error('服务地址只允许 HTTPS，或本机回环 HTTP','bad-origin',{usage:true});
  if(url.username||url.password)throw error('服务地址不能包含账号或口令信息','bad-origin',{usage:true});
  if(url.pathname!=='/'||url.search||url.hash)throw error('服务地址只能是来源，不能带路径、查询或片段','bad-origin',{usage:true});
  return url.origin;
}

// --- command line ----------------------------------------------------------
export function parseBatchArgs(argv){
  const out={origin:null,bookId:null,checkpoint:null,execute:false,maxRequests:null,maxPoints:null,help:false};
  const take=flag=>{const value=argv[++position];if(value===undefined)throw error('缺少参数：'+flag,'usage',{usage:true});return value;};
  let position=0;
  for(;position<argv.length;position++){
    const arg=argv[position];
    if(arg==='--help'||arg==='-h'){out.help=true;continue;}
    if(arg==='--origin'){out.origin=take(arg);continue;}
    if(arg==='--book'){out.bookId=take(arg);continue;}
    if(arg==='--checkpoint'){out.checkpoint=take(arg);continue;}
    if(arg==='--execute'){out.execute=true;continue;}
    if(arg==='--max-requests'){out.maxRequests=take(arg);continue;}
    if(arg==='--max-points'){out.maxPoints=take(arg);continue;}
    // Session tokens and passwords are never accepted as arguments.
    throw error('包含未支持的参数；会话与密码只允许通过指定安全入口提供','usage',{usage:true});
  }
  if(out.help)return out;
  if(out.origin===null)throw error('请用 --origin 指定 Leafhour 服务来源','usage',{usage:true});
  out.origin=validateServiceOrigin(out.origin);
  if(out.bookId===null||!/^[A-Za-z0-9_-]{1,128}$/.test(out.bookId))throw error('请用 --book 指定书籍 ID','usage',{usage:true});
  if(out.checkpoint!==null&&(typeof out.checkpoint!=='string'||!out.checkpoint.trim()))throw error('--checkpoint 路径不正确','usage',{usage:true});
  if(out.maxRequests!==null){
    if(!out.execute)throw error('--max-requests 只能与 --execute 一起使用；当前仍是演练','usage',{usage:true});
    if(!/^\d{1,3}$/.test(out.maxRequests))throw error('--max-requests 必须是 1 到 '+MAX_BATCH_REQUESTS+' 的整数','usage',{usage:true});
    out.maxRequests=Number(out.maxRequests);
    if(!Number.isInteger(out.maxRequests)||out.maxRequests<1||out.maxRequests>MAX_BATCH_REQUESTS)throw error('--max-requests 必须是 1 到 '+MAX_BATCH_REQUESTS+' 的整数','usage',{usage:true});
  }
  if(out.execute&&out.maxRequests===null)throw error('实际执行需要同时给出 --execute 与 --max-requests 1..'+MAX_BATCH_REQUESTS,'usage',{usage:true});
  if(out.maxPoints!==null){
    if(!out.execute||!/^\d{1,10}$/.test(out.maxPoints)||!validPointBudget(Number(out.maxPoints)))throw error('--max-points 必须与 --execute 一起使用，并且是可安全计量的非负整数','usage',{usage:true});
    out.maxPoints=Number(out.maxPoints);
  }
  return out;
}

// --- planning --------------------------------------------------------------
const BODY_CHAPTER_KINDS=new Set(['body','source-section','chapter']);
const FRONT_MATTER_KINDS=new Set(['frontmatter','front_matter','front-matter']);
const hasVariant=(translations,variant)=>!!(translations?.[variant]&&typeof translations[variant].text==='string'&&translations[variant].text.length);
// Existing body/source-section semantics: front matter, appendices and metadata
// headings stay out of translation batches.
export function passageSkipReason(passage,chapterKind){
  if(FRONT_MATTER_KINDS.has(chapterKind))return 'front-matter';
  if(chapterKind==='appendix')return 'appendix';
  if(chapterKind!==undefined&&!BODY_CHAPTER_KINDS.has(chapterKind))return 'excluded-chapter';
  if(passage?.kind==='source_heading')return 'metadata';
  const translations=passage?.translations||{};
  if(['literal','interpretive'].some(variant=>hasVariant(translations,variant)&&translations[variant].status==='reviewed'))return 'reviewed';
  if(hasVariant(translations,'literal')&&hasVariant(translations,'interpretive'))return 'complete';
  if(hasVariant(translations,'literal')||hasVariant(translations,'interpretive'))return 'partial';
  if(inferSourceLanguage(passage?.original||'')==='zh')return 'chinese-source';
  return null;
}
export function allBookPassages(book){
  return (book?.sections||[]).flatMap(section=>(section?.paragraphs||[]).map(p=>({passage:p,chapterId:section.chapterId})));
}
export function planPassages(book){
  if(!book||!Array.isArray(book.sections)||!Array.isArray(book.chapters))throw error('书籍内容不完整，无法排批','bad-book');
  const chapterKinds=new Map(book.chapters.map(chapter=>[chapter.id,chapter.kind]));
  const eligible=[],skipped=[],counts={eligible:0};
  for(const {passage,chapterId}of allBookPassages(book)){
    const reason=passageSkipReason(passage,chapterKinds.get(chapterId));
    if(reason===null){eligible.push({id:passage.id,chapterId});counts.eligible++;}
    else{skipped.push({id:passage.id,chapterId,reason});counts[reason]=(counts[reason]||0)+1;}
  }
  return {eligible,skipped,counts};
}

// --- source fingerprint and binding ---------------------------------------
export function sourcePassagesHash(book){
  const rows=allBookPassages(book).map(({passage})=>[passage.id,passage.original]);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
export function bindingFor({userId,origin,book}){
  if(typeof userId!=='string'||!userId||typeof book?.bookId!=='string'||!book.bookId||typeof book?.contentVersion!=='string'||!book.contentVersion)throw error('缺少绑定所需的账号或书籍信息','bad-binding');
  return {userId,origin:validateServiceOrigin(origin),bookId:book.bookId,contentVersion:book.contentVersion,passagesHash:sourcePassagesHash(book)};
}
export function sameBinding(left,right){
  return !!left&&!!right&&['userId','origin','bookId','contentVersion','passagesHash'].every(key=>left[key]===right[key]);
}

// --- reconciliation --------------------------------------------------------
// Failed/unknown outcomes stay retryable; when the server already holds both
// translations (or a human review), the entry is reconciled instead of paying
// for a duplicate generation.
export function reconcileEntries(entries,book){
  const byId=new Map(allBookPassages(book).map(({passage})=>[passage.id,passage]));
  const merged={};
  for(const [id,entry]of Object.entries(entries||{})){
    const passage=byId.get(id);
    const reason=passage?passageSkipReason(passage):null;
    const settled=reason==='complete'||reason==='reviewed';
    merged[id]=settled?{...entry,state:'saved',reason:'reconciled'}:entry.state==='saved'?{...entry,state:'unknown',reason:'server-state-missing'}:{...entry};
  }
  return merged;
}

// --- private atomic checkpoint --------------------------------------------
async function pathLstat(target){try{return await lstat(target);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
// Reject aliases in every existing ancestor. These checks are defensive local
// filesystem checks, not a sandbox against another process with the same UID.
async function checkAncestors(dir,{create=false}={}){
  let cursor=path.parse(path.resolve(dir)).root;
  for(const part of path.resolve(dir).slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);let row=await pathLstat(cursor);
    if(!row&&create){try{await mkdir(cursor,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}row=await pathLstat(cursor);}
    if(!row)return;
    if(row.isSymbolicLink())throw error('检查点路径的祖先不能是符号链接','symlink');
    if(!row.isDirectory())throw error('检查点目录路径不正确','checkpoint-path');
  }
}
async function ensurePrivateDir(dir){
  await checkAncestors(dir,{create:true});
  const row=await lstat(dir);
  if((row.mode&0o077)!==0)throw error('请使用独立的私有检查点目录（0700）；未修改现有目录权限','checkpoint-permissions');
}
async function refuseSymlink(target){
  await checkAncestors(path.dirname(target));
  const row=await pathLstat(target);
  if(row?.isSymbolicLink())throw error('检查点不能使用符号链接','symlink');
  if(row&&(!row.isFile()||row.nlink!==1))throw error('检查点必须是独立的普通文件','checkpoint-path');
  return row;
}
async function readPrivateFile(file){
  await refuseSymlink(file);
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const row=await handle.stat();if(!row.isFile()||row.nlink!==1)throw error('检查点必须是独立的普通文件','checkpoint-path');return await handle.readFile('utf8');}finally{await handle.close();}
}
async function writePrivateJson(file,data){
  const dir=path.dirname(file);
  await ensurePrivateDir(dir);await refuseSymlink(file);
  const temporary=path.join(dir,'.'+path.basename(file)+'.'+randomUUID()+'.pending');
  try{
    await writeFile(temporary,JSON.stringify(data),{mode:0o600,flag:'wx'});
    await checkAncestors(dir);await refuseSymlink(file);
    await rename(temporary,file);
  }catch(e){await unlink(temporary).catch(()=>{});throw e;}
}
export function defaultCheckpointPath(bookId,{cwd=process.cwd()}={}){
  if(typeof bookId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(bookId))throw error('请用 --checkpoint 指定检查点路径','usage',{usage:true});
  return path.join(cwd,'local','translation-batches',bookId+'.json');
}
export async function openCheckpoint({file,binding,create=false}){
  if(typeof file!=='string'||!file)throw error('检查点路径不正确','checkpoint-path');
  const existing=await refuseSymlink(file);
  let data=null;
  if(existing){
    let parsed;try{parsed=JSON.parse(await readPrivateFile(file));}catch{throw error('检查点文件无法解析，未覆盖任何状态','checkpoint-schema');}
    if(parsed?.kind!==CHECKPOINT_KIND||parsed?.schemaVersion!==CHECKPOINT_SCHEMA_VERSION||!parsed?.binding||typeof parsed.entries!=='object'||!parsed.entries)throw error('检查点格式不正确，未覆盖任何状态','checkpoint-schema');
    data=parsed;
    if(!sameBinding(data.binding,binding))throw error('检查点绑定的账号、来源、书籍或原文版本已变化，拒绝继续使用','binding-mismatch');
  }else{
    if(!create)throw error('找不到检查点，实际执行前请先确认路径','missing-checkpoint');
    data={kind:CHECKPOINT_KIND,schemaVersion:CHECKPOINT_SCHEMA_VERSION,binding:{...binding},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),entries:{}};
    await writePrivateJson(file,data);
  }
  return {
    data,
    record(id,outcome){
      if(typeof id!=='string'||!id||!['saved','failed','unknown'].includes(outcome?.state))throw error('检查点记录不正确','checkpoint-schema');
      const previous=data.entries[id]||{};
      const entry={state:outcome.state,attempts:(Number.isInteger(previous.attempts)?previous.attempts:0)+1,updatedAt:new Date().toISOString()};
      if(outcome.reason!==undefined&&outcome.reason!==null)entry.reason=String(outcome.reason).slice(0,120);
      data.entries[id]=entry;data.updatedAt=entry.updatedAt;return entry;
    },
    async save(){await writePrivateJson(file,data);}
  };
}
// A binding peek lets the runner refuse a foreign checkpoint before touching
// any account book.
export async function readCheckpointBinding(file){
  const existing=await refuseSymlink(file);
  if(!existing)return null;
  try{const data=JSON.parse(await readPrivateFile(file));return data?.binding||null;}catch{return null;}
}
const bindingMismatch=()=>error('检查点绑定的账号、来源、书籍或原文版本已变化，拒绝继续使用','binding-mismatch');

// --- bounded HTTP transport ----------------------------------------------
const REDIRECTS=new Set([301,302,303,307,308]);
async function readBounded(response,limit){
  const chunks=[];let total=0;
  if(response.body?.getReader){
    const reader=response.body.getReader();let completed=false;
    try{
      for(;;){
        const {done,value}=await reader.read();if(done){completed=true;break;}
        total+=value.length;
        if(total>limit)throw error('响应超过限制，未采信','oversized-response');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }finally{if(!completed)await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>limit)throw error('响应超过限制，未采信','oversized-response');
  return bytes;
}
const parseResponseJson=bytes=>{try{return JSON.parse(bytes.toString('utf8'));}catch{throw error('服务响应不是有效 JSON','invalid-response');}};
export function createTransport({origin,session,fetchImpl=fetch,limits={},timeoutMs=45000}={}){
  const base=validateServiceOrigin(origin);
  if(typeof session!=='string'||!session.length||session.length>4096)throw error('缺少已登录会话，请通过环境变量 '+SESSION_ENV+' 提供','session',{usage:true});
  const max={session:256*1024,transfer:48*1024*1024,part:2*1024*1024,translate:1024*1024,...limits};
  let owner=null;
  async function request(pathname,{method='GET',body,headers={},limit=max.transfer}={}){
    let response;
    try{
      response=await fetchImpl(base+pathname,{method,redirect:'manual',signal:AbortSignal.timeout(timeoutMs),
        headers:{Cookie:'marginalia_session='+session,Origin:base,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(owner?{'X-Reader-Owner':owner}:{}),...headers},
        ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    }catch(e){
      if(e?.name==='TimeoutError')throw error('请求超时，本次结果未知，未记为成功','timeout',{unknown:true});
      if(e?.name==='AbortError')throw error('请求中止，本次结果未知，未记为成功','aborted',{unknown:true});
      throw error('网络请求失败，本次结果未知，未记为成功','network-error',{unknown:true});
    }
    if(REDIRECTS.has(response.status)){await response.body?.cancel?.().catch?.(()=>{});throw error('拒绝跟随重定向，未采信该响应','redirect-refused');}
    let bytes;
    try{bytes=await readBounded(response,limit);}catch(e){
      if(method==='POST')throw error('请求已提交，但未能确认保存结果','response-unknown',{unknown:true});
      if(e instanceof BatchError)throw e;
      throw error('无法读取服务响应','invalid-response');
    }
    if(!response.ok)throw error('服务返回 HTTP '+response.status,'http-'+response.status);
    return {status:response.status,headers:response.headers,body:bytes};
  }
  const json=async(pathname,options)=>{const {body}=await request(pathname,options);return parseResponseJson(body);};
  return {
    origin:base,
    get userId(){return owner;},
    async sessionUser(){
      const data=await json('/api/auth/session',{limit:max.session});
      if(!data?.user||typeof data.user.id!=='string'||!data.user.id)throw error('会话无效或未登录，请提供已登录的 '+SESSION_ENV+' 会话','session');
      owner=data.user.id;return {id:owner,billing:{enabled:data.billing?.enabled===true}};
    },
    // The existing per-book GET response/transfer protocol keeps responses bounded.
    async getBook(bookId){
      const first=await request('/api/library/books/'+encodeURIComponent(bookId),{headers:{'X-Reader-Book-Transfer':'1'},limit:max.transfer});
      let book;
      if(first.headers.get('x-reader-book-transfer')==='parts'){
        const manifest=parseResponseJson(first.body);
        if(manifest?.kind!=='leafhour-book-transfer-v1'||manifest.bookId!==bookId||!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes<1||manifest.totalBytes>max.transfer||!Number.isSafeInteger(manifest.partBytes)||manifest.partBytes<1||manifest.partBytes>max.part||!/^[a-f0-9]{64}$/.test(manifest.snapshot||''))throw error('书籍分段清单不正确','invalid-response');
        const chunks=[];let offset=0;
        const partCount=Math.ceil(manifest.totalBytes/manifest.partBytes);
        for(let part=0;part<partCount;part++){
          const payload=await json('/api/library/books/'+encodeURIComponent(bookId)+'/content-part?offset='+offset+'&snapshot='+manifest.snapshot,{limit:max.part});
          if(payload?.kind!=='leafhour-book-part-v1'||payload.offset!==offset||payload.totalBytes!==manifest.totalBytes||payload.snapshot!==manifest.snapshot||typeof payload.data!=='string'||!payload.data.length||payload.data.length>4*Math.ceil(manifest.partBytes/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.data))throw error('书籍分段不正确','invalid-response');
          const chunk=Buffer.from(payload.data,'base64'),end=offset+chunk.length;
          if(chunk.toString('base64')!==payload.data||chunk.length!==Math.min(manifest.partBytes,manifest.totalBytes-offset)||end>manifest.totalBytes||end>max.transfer||payload.nextOffset!==(end===manifest.totalBytes?null:end))throw error('书籍分段位置或容量不正确','invalid-response');
          chunks.push(chunk);offset=end;
        }
        const bytes=Buffer.concat(chunks,offset);
        if(offset!==manifest.totalBytes||digest(bytes)!==manifest.snapshot)throw error('书籍内容校验失败，未采信','invalid-response');
        book=parseResponseJson(bytes);
      }else book=parseResponseJson(first.body);
      if(!book||book.bookId!==bookId)throw error('书籍响应不正确','invalid-response');
      return book;
    },
    // Only a complete passage acknowledgement establishes a saved draft. Once
    // POST is dispatched, an unreadable/invalid 2xx acknowledgement is unknown.
    async quoteTranslation(bookId,passageId,contentVersion,requestId){
      const quote=await json('/api/billing/quotes',{method:'POST',body:{action:'translation',bookId,input:{id:requestId,passageId,contentVersion}},limit:max.session});
      if(typeof quote?.id!=='string'||!quote.id||quote.id.length>200||quote.ownerId!==owner||quote.action!=='translation'||!Number.isSafeInteger(quote.units)||quote.units<0||!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=Date.now()||quote.scope?.bookId!==bookId||quote.scope?.passageId!==passageId||quote.scope?.contentVersion!==contentVersion||quote.scope?.requestId!==requestId)throw error('翻译报价未通过账号、来源和额度检查，未提交生成','invalid-quote');
      return {id:quote.id,units:quote.units};
    },
    async translate(bookId,passageId,expectedVersion,expectedOriginal,paid){
      const response=await request('/api/library/books/'+encodeURIComponent(bookId)+'/translate',{method:'POST',body:{passageId,...(expectedVersion!==undefined?{contentVersion:expectedVersion}:{}),...(paid?{id:paid.requestId,billing:{quoteId:paid.quoteId,idempotencyKey:paid.requestId}}:{})},limit:max.translate});
      let saved;try{saved=parseResponseJson(response.body);}catch{throw error('翻译提交后未收到有效保存确认','response-unknown',{unknown:true});}
      if(saved?.id!==passageId||saved.original!==expectedOriginal||!['literal','interpretive'].every(variant=>typeof saved.translations?.[variant]?.text==='string'&&saved.translations[variant].text.trim()&&saved.translations[variant].sourceVersion===expectedVersion&&['draft','reviewed'].includes(saved.translations[variant].status)))throw error('翻译提交后未收到完整保存确认','response-unknown',{unknown:true});
      return true;
    }
  };
}

// --- bounded serial runner ------------------------------------------------
export async function runBatch({origin,bookId,session,execute=false,maxRequests=null,maxPoints=null,checkpointFile,fetchImpl,limits,timeoutMs,signal=null,log=()=>{}}={}){
  if(!execute&&maxRequests!==null)throw error('--max-requests 只能与 --execute 一起使用；当前仍是演练','usage',{usage:true});
  if(execute&&(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>MAX_BATCH_REQUESTS))throw error('实际执行需要 --max-requests 1..'+MAX_BATCH_REQUESTS,'usage',{usage:true});
  if(maxPoints!==null&&(!execute||!validPointBudget(maxPoints)))throw error('--max-points 必须与 --execute 一起使用，并且是可安全计量的非负整数','usage',{usage:true});
  const transport=createTransport({origin,session,fetchImpl,limits,timeoutMs});
  const user=await transport.sessionUser();
  const file=execute?(checkpointFile||defaultCheckpointPath(bookId)):null;
  if(file){
    // A foreign checkpoint is refused before any of its books are read.
    const prior=await readCheckpointBinding(file);
    if(prior&&(prior.userId!==user.id||prior.origin!==transport.origin||prior.bookId!==bookId))throw bindingMismatch();
  }
  const book=await transport.getBook(bookId);
  const plan=planPassages(book);
  const summary={mode:execute?'execute':'dry-run',bookId:book.bookId,contentVersion:book.contentVersion,requests:0,maxRequests:execute?maxRequests:null,counts:plan.counts,eligible:plan.eligible.map(row=>row.id),skipped:[...plan.skipped],entries:[],stopped:null,remaining:plan.eligible.length,checkpoint:file};
  if(user.billing.enabled)summary.billing={enabled:true,maxPoints,reservedUnits:0,quotedUnits:0};
  if(!execute)return summary;
  const binding=bindingFor({userId:user.id,origin:transport.origin,book});
  const release=await acquireCheckpointLock(file);
  try{
    const store=await openCheckpoint({file,binding,create:true});
    store.data.entries=reconcileEntries(store.data.entries,book);
    await store.save();
    const done=new Set(Object.entries(store.data.entries).filter(([,entry])=>entry.state==='saved').map(([id])=>id));
    for(const row of plan.eligible){
      if(signal?.aborted){summary.stopped='aborted';break;}
      if(done.has(row.id))continue;
      if(summary.requests>=maxRequests){summary.stopped='limit';break;}
      // Actual source and translation states are re-read before every request.
      const current=await transport.getBook(bookId);
      if(current.contentVersion!==binding.contentVersion){summary.stopped='source-changed';break;}
      const freshSkip=new Map(planPassages(current).skipped.map(entry=>[entry.id,entry.reason]));
      if(freshSkip.has(row.id)){summary.skipped.push({id:row.id,reason:freshSkip.get(row.id)});done.add(row.id);continue;}
      if(signal?.aborted){summary.stopped='aborted';break;}
      let paid;
      if(user.billing.enabled){
        if(maxPoints===null)throw error('付费模式实际生成还需要显式 --max-points 整数预算；未提交生成','usage',{usage:true});
        const requestId=randomUUID(),quote=await transport.quoteTranslation(bookId,row.id,binding.contentVersion,requestId);
        if(!Number.isSafeInteger(summary.billing.quotedUnits+quote.units))throw error('报价累计额度超过安全计量范围，未提交生成','invalid-quote');
        summary.billing.quotedUnits+=quote.units;
        await log('quote '+row.id+' '+quote.units/UNITS_PER_POINT+' points; budget '+summary.billing.reservedUnits/UNITS_PER_POINT+' / '+maxPoints+' points');
        if(signal?.aborted){summary.stopped='aborted';break;}
        if(quote.units>maxPoints*UNITS_PER_POINT-summary.billing.reservedUnits){summary.stopped='points-limit';break;}
        // Reserve locally before dispatch, including unknown/failed requests.
        // Only the server ledger determines actual settlement or release.
        summary.billing.reservedUnits+=quote.units;paid={requestId,quoteId:quote.id};
      }
      summary.requests++;
      let outcome;
      try{await transport.translate(bookId,row.id,binding.contentVersion,allBookPassages(current).find(({passage})=>passage.id===row.id)?.passage.original,paid);outcome={state:'saved'};}
      catch(e){outcome={state:e?.unknown?'unknown':'failed',reason:e?.code||'batch-error'};}
      store.record(row.id,outcome);
      await store.save();
      summary.entries.push({id:row.id,...outcome});
      await log(outcome.state==='saved'?'saved '+row.id:'stopped '+row.id+' ('+outcome.reason+')');
      if(outcome.state==='saved'){done.add(row.id);continue;}
      // A failed or unknown request stops the run; nothing auto-loops.
      summary.stopped=outcome.state==='unknown'?'unknown':'failure';
      break;
    }
    summary.remaining=plan.eligible.filter(row=>!done.has(row.id)).length;
    return summary;
  }finally{await release();}
}

// Every acquisition, stale-owner recovery and release uses one short guard.
// A crash inside this guard fails closed; an operator must inspect/remove that
// guard after proving no process is active. No model request runs under it.
async function withLockGuard(file,action,{release=false}={}){
  const guard=file+'.lock.guard';await ensurePrivateDir(path.dirname(file));
  let held=false;
  for(let attempt=0;attempt<(release?20:1);attempt++){
    try{await mkdir(guard,{mode:0o700});held=true;break;}
    catch(e){if(e.code!=='EEXIST')throw e;if(release)await new Promise(resolve=>setTimeout(resolve,5));}
  }
  if(!held)throw error('检查点锁正在变更；若发生崩溃，请核对运行进程后恢复','locked');
  try{return await action();}finally{await rmdir(guard);}
}
export async function acquireCheckpointLock(file){
  const lock=file+'.lock',nonce=randomUUID();let identity;
  await withLockGuard(file,async()=>{
    const existing=await refuseSymlink(lock);
    if(existing){
      let owner;try{owner=JSON.parse(await readPrivateFile(lock));}catch{throw error('检查点锁尚未初始化或已损坏；拒绝抢占，请先核对运行进程','locked');}
      if(!Number.isInteger(owner?.pid)||owner.pid<=0)throw error('检查点锁缺少有效归属，拒绝抢占','locked');
      try{process.kill(owner.pid,0);throw error('同一检查点已有批处理在运行，本次不并行执行','locked');}
      catch(e){if(e.code!=='ESRCH')throw e;}
      const current=await lstat(lock);
      if(current.dev!==existing.dev||current.ino!==existing.ino)throw error('检查点锁已变化，拒绝抢占','locked');
      await unlink(lock);
    }
    const handle=await open(lock,'wx',0o600);
    try{await handle.writeFile(JSON.stringify({pid:process.pid,nonce,startedAt:new Date().toISOString()}));identity=await handle.stat();}finally{await handle.close();}
  });
  return async()=>withLockGuard(file,async()=>{
    const current=await refuseSymlink(lock);if(!current||current.dev!==identity.dev||current.ino!==identity.ino)return;
    let owner;try{owner=JSON.parse(await readPrivateFile(lock));}catch{return;}
    if(owner.nonce===nonce&&owner.pid===process.pid)await unlink(lock);
  },{release:true});
}
