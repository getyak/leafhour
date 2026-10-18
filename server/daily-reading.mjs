import {createHash,randomUUID} from 'node:crypto';
import {fail,digest} from './document-import.mjs';
import {createLockedJsonStore} from './locked-json-store.mjs';
import {scopedAgentRead,AGENT_DATA_BYTES} from './scoped-agent-reading.mjs';
import {readingJourney,buildReadingCalendar} from './reading-activity.mjs';
import {validReadingTimeZone} from '../app/reading-session-record.mjs';
import {isReadingTimeSource} from '../app/reading-time-policy.mjs';

// GET-155 daily companion: one plan per account, a stable server-derived daily
// event, narrow daily:deliver host protocol and quiet gates. No generation, no
// schedule and no model call happens inside this service; the external host
// composes the card between claim and finish. Storage locks cover only short
// JSON mutations (local OS lock or hosted reader_document_cas), never a host
// model run. Tokens live only in the grants store, never in the plan.
export const DAILY_SCOPE='daily:deliver';
export const DAILY_GRANT_TTL_DAYS=30;
export const DAILY_GRANT_TTL_MS=DAILY_GRANT_TTL_DAYS*86400000;
export const PRESENCE_TTL_MS=90000;
export const CLAIM_LEASE_MS=10*60000;
export const DUE_WINDOW_MS=30*60000;
export const MAX_CLAIM_ATTEMPTS=3;
export const MAX_DAILY_CARDS=90;
export const MAX_MESSAGE_CODEPOINTS=600;
export const MAX_QUOTE_CODEPOINTS=240;
export const DAILY_CONTEXT_BYTES=AGENT_DATA_BYTES;
export const DAILY_CONSENT_KEYS=Object.freeze(['originalText','readingActivity']);

const hash=value=>createHash('sha256').update(value).digest('hex');
export const dailyEventId=(planId,date)=>hash('leafhour-daily|'+planId+'|'+date);
export const dailyTestEventId=(planId,date)=>hash('leafhour-daily-test|'+planId+'|'+date);
export const localCalendarDate=(timeZone,now)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export function zonedDueAt(date,time,timeZone){
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const guess=Date.UTC(year,month-1,day,hour,minute);
  const format=new Intl.DateTimeFormat('en-US',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const wallAt=at=>{
    const parts=Object.fromEntries(format.formatToParts(new Date(at)).map(part=>[part.type,part.value]));
    return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour)%24,Number(parts.minute));
  };
  // Sample both sides of a nearby offset transition. A fixed-point conversion
  // alone can choose either occurrence of a repeated hour depending on UTC sign.
  const offsets=new Set();for(let hours=-36;hours<=36;hours+=6){const at=guess+hours*3600000;offsets.add(wallAt(at)-at);}
  const candidates=[...offsets].map(offset=>guess-offset).filter(at=>wallAt(at)===guess);
  if(candidates.length)return Math.min(...candidates);
  // A nonexistent wall-clock time moves forward by the offset gap.
  let candidate=guess;const seen=new Set([candidate]);
  for(let attempt=0;attempt<6;attempt++){
    const next=candidate+(guess-wallAt(candidate));if(next===candidate)return candidate;
    if(seen.has(next))return Math.max(candidate,next);seen.add(next);candidate=next;
  }
  throw fail('无法解析当前时区的陪读时间');
}

const QUIET_MESSAGES={
  'no-plan':'还没有保存每日陪读设置。',
  'grant-invalid':'每日陪读授权已失效，请在书房重新连接。',
  'expired':'每日陪读授权已到期，请在书房重新连接。',
  'consent-missing':'还没有确认原文与阅读记录授权。',
  'paused':'每日陪读已暂停。',
  'awaiting-host':'还没有完成宿主连接。',
  'host-mismatch':'宿主连接与设置不一致，请重新连接。',
  'book-unavailable':'找不到这本固定的书。',
  'source-changed':'原书已更新，请在书房重新确认每日陪读。',
  'reading-position-changed':'阅读位置已变化，这次先不留旧片段的纸条。',
  'not-due':'还没有到今天的陪读时间。',
  'window-closed':'今天的陪读时间已过，不补发错过的消息。',
  'reader-present':'正在阅读，不打扰。',
  'book-finished':'这本书已标记读完。',
  'goal-complete':'今天的阅读目标已完成。',
  'no-useful-continuation':'与上次相同的进度，先不重复打扰。',
  'no-source':'当前没有可引用的原文。',
  'attempts-exhausted':'今天的陪读尝试已用完。',
  'lease-held':'这次陪读正在生成。',
  'silenced':'这次陪读选择保持安静。'
};
const quiet=reason=>({reason,message:QUIET_MESSAGES[reason]||'这次保持安静。'});
const codes=value=>[...String(value)].length;
const iso=now=>new Date(now).toISOString();
const exactKeys=(input,allowed)=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw fail('每日陪读请求包含未知字段');
};
const text=(value,min,max)=>typeof value==='string'&&value.isWellFormed()&&value.trim()===value&&value.length>=min&&value.length<=max;
const tabId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);

export function createDailyReadingService({library,dataDir,dataStore=null,clock=Date.now}){
  const store=dataStore||createLockedJsonStore({dataDir,busyMessage:'每日陪读正在保存，请稍后重试'});
  const account=user=>{if(typeof user?.id!=='string'||!user.id||user.id.length>512||user.is_anonymous)throw fail('请先进入自己的书房',401);return digest(user.id);};
  const key=user=>'daily-reading:'+account(user);
  const empty=()=>({kind:'leafhour-daily-reading',schemaVersion:1,plan:null,events:[],inbox:[],presence:{tabs:{}}});
  const visibleEvent=e=>e?{id:e.id,date:e.date,kind:e.kind,label:e.kind==='test'?'连接测试':'每日陪读',state:e.state,attempts:e.attempts,createdAt:e.createdAt,claimedAt:e.claimedAt||null,finishedAt:e.finishedAt||null,result:e.result||null,fingerprint:e.fingerprint||null}:null;
  const clone=value=>value?structuredClone(value):null;
  const quietReply=(reason,event=null)=>({status:'quiet',event:visibleEvent(event),context:null,activity:null,card:null,quiet:typeof reason==='string'?quiet(reason):reason,duplicate:false});
  const trim=doc=>{doc.events=doc.events.slice(-MAX_DAILY_CARDS);doc.inbox=doc.inbox.slice(0,MAX_DAILY_CARDS);};
  const present=(doc,now)=>Object.values(doc.presence?.tabs||{}).some(lease=>lease.expiresAt>now);
  async function readBook(user,id){try{return await library.getBook(user,id);}catch(error){if(error.status===404)return null;throw error;}}
  async function visiblePlan(user,p,now){
    if(!p)return null;
    const active=await library.isGrantActive(p.grantId),book=await readBook(user,p.bookId);
    const status=p.paused?'paused':Date.parse(p.grantExpiresAt)<=now?'expired':p.grantRevoked||!active?'revoked':!book?'book-unavailable':book.contentVersion!==p.contentVersion?'source-changed':!p.connectedAt||!p.consent?.originalText||!p.consent?.readingActivity?'awaiting-host':'active';
    return {...structuredClone(p),status,goal:'resume',channel:'library',grantDurationDays:DAILY_GRANT_TTL_DAYS,consent:{originalText:!!p.consent?.originalText,readingActivity:!!p.consent?.readingActivity,notes:false,confirmedAt:p.consent?.confirmedAt||null}};
  }
  function checkAgent(user,grant){
    account(user);
    if(!grant||grant.ownerId!==user.id||!text(grant.id,1,128)||!text(grant.bookId,1,128)||grant.scopes?.length!==1||grant.scopes[0]!==DAILY_SCOPE)throw fail('Agent 授权无效或范围不足',403);
  }
  function bind(plan,grant){if(plan&&(plan.grantId!==grant.id||plan.bookId!==grant.bookId))throw fail('Agent 授权无效或范围不足',403);}
  async function planGate(plan,grant,hostInstallId,now,{connection=false}={}){
    if(!plan)return 'no-plan';bind(plan,grant);
    if(Date.parse(plan.grantExpiresAt)<=now)return 'expired';
    if(plan.grantRevoked||!await library.isGrantActive(grant.id))return 'grant-invalid';
    if(!plan.consent?.originalText||!plan.consent?.readingActivity)return 'consent-missing';
    if(!connection){if(plan.paused)return 'paused';if(!plan.connectedAt)return 'awaiting-host';if(plan.hostInstallId!==hostInstallId)return 'host-mismatch';}
    return null;
  }
  async function contextFor(book,records){
    const projection=await scopedAgentRead({action:'context',args:{bookId:book.bookId,...(records.position?.passageId?{passageId:records.position.passageId}:{})},book,records:async()=>records,activityAllowed:true});
    const p=projection.passages[0];if(!p||!p.original?.trim())return null;
    return {bookId:projection.bookId,contentVersion:projection.contentVersion,title:projection.title,chapterId:projection.chapterId,passageId:p.id,original:p.original,source:p.source,citation:p.citation};
  }
  async function sourceState(user,doc,grant,hostInstallId,{connection=false}={}){
    let now=clock();const plan=doc.plan,blocked=await planGate(plan,grant,hostInstallId,now,{connection});if(blocked)return {blocked};
    const book=await readBook(user,plan.bookId);if(!book)return {blocked:'book-unavailable'};if(book.contentVersion!==plan.contentVersion)return {blocked:'source-changed'};
    let records=await library.records(user,book.bookId);const date=localCalendarDate(plan.timeZone,now);
    let context;try{context=await contextFor(book,records);}catch(error){if(error.status===404)return {blocked:'no-source'};throw error;}if(!context)return {blocked:'no-source'};
    let calendar=await library.readingActivity(user,{month:date.slice(0,7),timeZone:plan.timeZone});
    // Book/records use different documents from the delivery ledger. Probe them
    // after calendar IO rather than publishing from the callback's initial view.
    const freshBook=await readBook(user,plan.bookId);if(!freshBook)return {blocked:'book-unavailable'};if(freshBook.contentVersion!==plan.contentVersion)return {blocked:'source-changed'};
    const freshPassage=freshBook.sections.flatMap(section=>section.paragraphs).find(p=>p.id===context.passageId);
    if(!freshPassage||[...freshPassage.original].slice(0,[...context.original].length).join('')!==context.original)return {blocked:'source-changed'};
    const currentRecords=await library.records(user,book.bookId),activityStamp=value=>digest(JSON.stringify({position:value.position,readingGoal:value.readingGoal,readingSessions:value.readingSessions,readingMilestones:value.readingMilestones}));
    if(currentRecords.position?.passageId&&currentRecords.position.passageId!==context.passageId)return {blocked:'reading-position-changed'};
    if(activityStamp(records)!==activityStamp(currentRecords))calendar=buildReadingCalendar([{book:freshBook,records:{bookId:freshBook.bookId,readingSessions:currentRecords.readingSessions||[],readingMilestones:currentRecords.readingMilestones||[]}}],{month:date.slice(0,7),timeZone:plan.timeZone});
    records=currentRecords;const journey=readingJourney(freshBook,records),day=calendar.days.find(row=>row.date===date);
    const activity={position:records.position?{chapterId:records.position.chapterId,passageId:records.position.passageId,offset:records.position.offset,withinParagraph:records.position.withinParagraph}:null,status:journey.status,completedChapters:journey.completedChapters,totalChapters:journey.totalChapters,lastReadAt:journey.lastReadAt,dailyGoalMinutes:records.readingGoal?.minutes??null,todayReadingSeconds:day?.books?.find(row=>row.bookId===book.bookId)?.durationSeconds??0,meaning:'阅读时间只记录投入和用户自己的标记，不证明理解程度。'};
    if(Buffer.byteLength(JSON.stringify({context,activity}))>DAILY_CONTEXT_BYTES)throw fail('当前资料超过每日陪读读取上限',413);
    const fingerprint=digest(JSON.stringify({bookId:book.bookId,contentVersion:book.contentVersion,chapterId:context.chapterId,passageId:context.passageId}));
    now=clock();const latest=await planGate(plan,grant,hostInstallId,now,{connection});if(latest)return {blocked:latest};
    if(!connection){
      if(present(doc,now))return {blocked:'reader-present'};
      if(journey.status==='finished')return {blocked:'book-finished'};
      if(records.readingGoal?.minutes&&activity.todayReadingSeconds>=records.readingGoal.minutes*60)return {blocked:'goal-complete'};
      const last=plan.lastDelivery;
      if(last&&last.date<localCalendarDate(plan.timeZone,now)&&last.fingerprint===fingerprint){
        const times=[...(records.readingSessions||[]).filter(s=>isReadingTimeSource(s.source)).map(s=>Date.parse(s.endedAt)),...(records.readingMilestones||[]).filter(m=>m.origin==='user').map(m=>Date.parse(m.createdAt))];
        if(!times.some(at=>Number.isFinite(at)&&at>Date.parse(last.at)))return {blocked:'no-useful-continuation'};
      }
    }
    return {book,records,context,activity,fingerprint,now};
  }
  const windowFor=(event,plan)=>{const start=event.kind==='test'?Date.parse(event.createdAt):zonedDueAt(event.date,plan.time,plan.timeZone);return {start,end:start+DUE_WINDOW_MS};};
  const inWindow=(event,plan,now)=>{const window=windowFor(event,plan);return now<window.start?'not-due':now>window.end?'window-closed':null;};
  function terminal(event,grant){
    return {status:event.state==='delivered'?'delivered':'silenced',event:visibleEvent(event),context:null,activity:null,card:event.grantId===grant.id&&event.bookId===grant.bookId?clone(event.card):null,quiet:event.state==='silenced'?quiet('silenced'):null,duplicate:true};
  }
  async function view(user){const doc=await store.read(key(user),empty());return {plan:await visiblePlan(user,doc.plan,clock()),inbox:doc.inbox.map(clone),events:doc.events.map(visibleEvent)};}
  async function configure(user,input){
    const documentKey=key(user);exactKeys(input,['baseRevision','bookId','time','timeZone','consent']);
    if(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0||!text(input.bookId,1,128)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||!validReadingTimeZone(input.timeZone))throw fail('请核对每日陪读的书籍、时间和版本');
    exactKeys(input.consent,DAILY_CONSENT_KEYS);if(input.consent.originalText!==true||input.consent.readingActivity!==true)throw fail('请明确授权原文与阅读记录；每日陪读不请求私人笔记');
    const before=await store.read(documentKey,empty());if((before.plan?.revision||0)!==input.baseRevision)throw fail('每日陪读设置已在另一处更新，请刷新后重新保存',409);
    const book=await library.getBook(user,input.bookId),grant=await library.createDailyGrant(user,{bookId:book.bookId});let saved;
    try{saved=await store.mutate(documentKey,empty(),async doc=>{
      const revision=doc.plan?.revision||0;if(revision!==input.baseRevision||revision>=Number.MAX_SAFE_INTEGER)throw fail('每日陪读设置已在另一处更新，请刷新后重新保存',409);
      const current=await library.getBook(user,input.bookId);if(current.contentVersion!==book.contentVersion)throw fail('原书已更新，请重新核对',409);
      const now=clock(),old=doc.plan,plan={id:old?.id||randomUUID(),configuredAt:old?.configuredAt||iso(now),revision:revision+1,bookId:book.bookId,bookTitle:book.title?.zh||book.title?.en||'',contentVersion:book.contentVersion,goal:'resume',time:input.time,timeZone:input.timeZone,channel:'library',consent:{originalText:true,readingActivity:true,notes:false,confirmedAt:iso(now)},grantId:grant.id,grantExpiresAt:grant.expiresAt,grantRevoked:false,paused:false,pausedAt:null,hostLabel:null,schedulerId:null,hostInstallId:null,connectedAt:null,updatedAt:iso(now),lastDelivery:old?.lastDelivery||null};
      for(const event of doc.events)event.lease=null;doc.plan=plan;
      return {plan:clone(plan),replacedGrantId:old?.grantId||null};
    });}catch(error){await library.revokeGrant(user,grant.id).catch(()=>{});throw error;}
    // Withdraw only the grant replaced by this successful CAS. Never enumerate
    // and revoke a newer grant committed by another configure while awaiting IO.
    if(saved.replacedGrantId&&saved.replacedGrantId!==grant.id)await library.revokeGrant(user,saved.replacedGrantId);
    return {plan:await visiblePlan(user,saved.plan,clock()),token:grant.token,grant:{id:grant.id,bookId:grant.bookId,scopes:[...grant.scopes],createdAt:grant.createdAt,expiresAt:grant.expiresAt,durationDays:DAILY_GRANT_TTL_DAYS}};
  }
  async function savePlan(user,input,change){
    exactKeys(input,['baseRevision']);return store.mutate(key(user),empty(),async doc=>{
      if(!doc.plan)throw fail('还没有保存每日陪读设置',404);if(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0||doc.plan.revision!==input.baseRevision||doc.plan.revision>=Number.MAX_SAFE_INTEGER)throw fail('每日陪读设置已在另一处更新，请刷新后重试',409);
      await change(doc.plan,clock());doc.plan.revision++;doc.plan.updatedAt=iso(clock());for(const event of doc.events)event.lease=null;
      return {plan:await visiblePlan(user,doc.plan,clock())};
    });
  }
  const pause=(user,input)=>savePlan(user,input,(plan,now)=>{plan.paused=true;plan.pausedAt=iso(now);});
  const resume=(user,input)=>savePlan(user,input,async plan=>{
    if(!plan.consent?.originalText||!plan.consent?.readingActivity||plan.grantRevoked||Date.parse(plan.grantExpiresAt)<=clock()||!await library.isGrantActive(plan.grantId))throw fail('每日陪读授权已失效，请重新连接',409);
    const book=await readBook(user,plan.bookId);if(!book||book.contentVersion!==plan.contentVersion)throw fail('原书已更新，请重新确认每日陪读设置',409);plan.paused=false;plan.pausedAt=null;
  });
  async function requestTest(user,input={}){
    exactKeys(input,[]);return store.mutate(key(user),empty(),async doc=>{
      const plan=doc.plan,now=clock();if(!plan||plan.grantRevoked||Date.parse(plan.grantExpiresAt)<=now||!await library.isGrantActive(plan.grantId))throw fail('请先保存有效的每日陪读设置',409);
      const date=localCalendarDate(plan.timeZone,now),id=dailyTestEventId(plan.id,date);if(doc.events.some(event=>event.id===id))throw fail('今天已经请求过连接测试，请查看站内卡片',409);
      const event={id,date,kind:'test',state:'pending',attempts:0,createdAt:iso(now),claimedAt:null,finishedAt:null,result:null,fingerprint:null,lease:null};doc.events.push(event);trim(doc);return {event:visibleEvent(event)};
    });
  }
  async function reportPresence(user,input,{receivedAt=clock()}={}){
    exactKeys(input,['tabId','active','sequence']);if(!tabId(input.tabId)||typeof input.active!=='boolean'||!Number.isSafeInteger(input.sequence)||input.sequence<1||!Number.isFinite(receivedAt))throw fail('阅读状态格式不正确');
    const acceptUntil=receivedAt+PRESENCE_TTL_MS;
    return store.mutate(key(user),empty(),doc=>{
      const now=clock();if(now>=acceptUntil||receivedAt>now)throw fail('阅读状态请求已过期，请重新报告',408);
      doc.presence??={tabs:{}};for(const [id,lease]of Object.entries(doc.presence.tabs))if((lease.retainedUntil??lease.expiresAt)<=now)delete doc.presence.tabs[id];
      const previous=doc.presence.tabs[input.tabId];
      if(previous&&input.sequence<=(previous.sequence||0))return {tabId:input.tabId,active:previous.expiresAt>now,sequence:previous.sequence,expiresAt:previous.expiresAt>now?previous.expiresAt:null,ignored:true};
      if(!previous&&Object.keys(doc.presence.tabs).length>=128)throw fail('打开的阅读窗口过多，请稍后重试',413);
      // Keep an inactive high-water mark for the complete request acceptance
      // window. A timed-out handler may still finish after a newer request.
      // Every CAS retry rechecks its fixed deadline; active TTL never renews
      // from a delayed commit. This is ordering, not client-supplied time.
      const expiresAt=input.active?acceptUntil:0;doc.presence.tabs[input.tabId]={sequence:input.sequence,expiresAt,retainedUntil:now+PRESENCE_TTL_MS};
      return {tabId:input.tabId,active:input.active,sequence:input.sequence,expiresAt:input.active?expiresAt:null,ignored:false};
    });
  }
  const hasActivePresence=async user=>present(await store.read(key(user),empty()),clock());
  async function connect(user,input,grant){
    checkAgent(user,grant);exactKeys(input,['schedulerId','hostLabel','hostInstallId']);if(!text(input.schedulerId,1,128)||!text(input.hostLabel,1,120)||!text(input.hostInstallId,1,128))throw fail('宿主连接信息不完整');
    return store.mutate(key(user),empty(),async doc=>{
      const state=await sourceState(user,doc,grant,input.hostInstallId,{connection:true});if(state.blocked)throw fail('宿主无法读取当前授权来源，请在书房重新核对',409);
      const plan=doc.plan;if(plan.hostInstallId&&(plan.hostInstallId!==input.hostInstallId||plan.schedulerId!==input.schedulerId)){if(plan.revision>=Number.MAX_SAFE_INTEGER)throw fail('设置版本超出范围',409);plan.revision++;for(const event of doc.events)event.lease=null;}
      Object.assign(plan,{hostLabel:input.hostLabel,schedulerId:input.schedulerId,hostInstallId:input.hostInstallId,connectedAt:iso(clock()),updatedAt:iso(clock())});
      return {status:'connected',plan:await visiblePlan(user,plan,clock()),context:state.context,activity:state.activity};
    });
  }
  async function claim(user,input,grant){
    checkAgent(user,grant);exactKeys(input,['hostInstallId','eventId']);if(!text(input.hostInstallId,1,128)||input.eventId!==undefined&&!text(input.eventId,1,128))throw fail('宿主领取信息不完整');
    return store.mutate(key(user),empty(),async doc=>{
      let now=clock();const plan=doc.plan,blocked=await planGate(plan,grant,input.hostInstallId,now);if(blocked)return quietReply(blocked);
      const date=localCalendarDate(plan.timeZone,now),id=input.eventId??dailyEventId(plan.id,date);let event=doc.events.find(e=>e.id===id);
      if(input.eventId!==undefined&&(!event||event.kind!=='test'))throw fail('找不到这次连接测试',404);
      if(event&&['delivered','silenced'].includes(event.state))return terminal(event,grant);
      event??={id,date,kind:'scheduled',state:'pending',attempts:0,createdAt:iso(now),claimedAt:null,finishedAt:null,result:null,fingerprint:null,lease:null};
      const outside=inWindow(event,plan,now);if(outside)return quietReply(outside,event);
      if(event.lease?.expiresAt>now)return quietReply('lease-held',event);if(event.attempts>=MAX_CLAIM_ATTEMPTS)return quietReply('attempts-exhausted',event);
      const state=await sourceState(user,doc,grant,input.hostInstallId);if(state.blocked)return quietReply(state.blocked,event);
      now=clock();if(Date.parse(plan.grantExpiresAt)<=now)return quietReply('expired',event);const late=inWindow(event,plan,now);if(late)return quietReply(late,event);
      if(!doc.events.some(e=>e.id===id))doc.events.push(event);
      const context=state.context;Object.assign(event,{attempts:event.attempts+1,state:'claimed',claimedAt:iso(now),fingerprint:state.fingerprint,planRevision:plan.revision,grantId:grant.id,hostInstallId:input.hostInstallId,bookId:plan.bookId,contentVersion:plan.contentVersion,passageId:context.passageId,chapterId:context.chapterId,sourceCharEnd:[...context.original].length,sourceHash:digest(context.original),lease:{nonce:randomUUID(),hostInstallId:input.hostInstallId,expiresAt:Math.min(now+CLAIM_LEASE_MS,windowFor(event,plan).end,Date.parse(plan.grantExpiresAt))}});
      trim(doc);return {status:'claimed',event:visibleEvent(event),claimNonce:event.lease.nonce,leaseExpiresAt:iso(event.lease.expiresAt),context,activity:state.activity,card:null,quiet:null,duplicate:false};
    });
  }
  async function finish(user,input,grant){
    checkAgent(user,grant);exactKeys(input,['hostInstallId','eventId','claimNonce','kind','message','quote']);
    if(!text(input.hostInstallId,1,128)||!text(input.eventId,1,128)||typeof input.claimNonce!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(input.claimNonce)||!['message','silence','failed'].includes(input.kind))throw fail('这次陪读回执格式不正确');
    const prose=(value,max)=>typeof value==='string'&&value.isWellFormed()&&value.trim().length>0&&codes(value)<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
    if(input.kind==='message'){if(!prose(input.message,MAX_MESSAGE_CODEPOINTS)||!prose(input.quote,MAX_QUOTE_CODEPOINTS))throw fail('陪读文字或原文引用超过范围，或缺少精确引用');}else if(input.message!==undefined||input.quote!==undefined)throw fail('安静或失败回执不能附带正文');
    const submissionHash=hash(JSON.stringify({kind:input.kind,...(input.kind==='message'?{message:input.message,quote:input.quote}:{})}));
    return store.mutate(key(user),empty(),async doc=>{
      const plan=doc.plan;bind(plan,grant);const event=doc.events.find(e=>e.id===input.eventId);if(!plan||!event)throw fail('找不到这次陪读事件',404);
      const receipt=event.lastReceipt;
      if(['delivered','silenced'].includes(event.state)||!event.lease&&receipt?.status==='failed'){
        if(!receipt||receipt.nonce!==input.claimNonce||receipt.digest!==submissionHash||receipt.grantId!==grant.id||receipt.hostInstallId!==input.hostInstallId)throw fail('这次回执与已保存的领取或提交不一致',409);
        if(receipt.status==='failed')return {status:'failed',event:visibleEvent(event),context:null,activity:null,card:null,quiet:null,duplicate:true};return terminal(event,grant);
      }
      let now=clock();const blocked=await planGate(plan,grant,input.hostInstallId,now);if(blocked)return quietReply(blocked,event);
      if(!event.lease||event.lease.nonce!==input.claimNonce||event.lease.hostInstallId!==input.hostInstallId||event.lease.expiresAt<=now||event.planRevision!==plan.revision||event.grantId!==grant.id)throw fail('这次领取已过期或被替换，请重新领取',409);
      const state=await sourceState(user,doc,grant,input.hostInstallId);if(state.blocked)return quietReply(state.blocked,event);
      now=clock();if(Date.parse(plan.grantExpiresAt)<=now)return quietReply('expired',event);if(event.lease.expiresAt<=now)throw fail('这次领取已过期，请重新领取',409);const outside=inWindow(event,plan,now);if(outside)return quietReply(outside,event);
      const context=state.context;if(event.contentVersion!==context.contentVersion||event.passageId!==context.passageId||event.sourceHash!==digest(context.original)||event.sourceCharEnd!==[...context.original].length)throw fail('领取的来源或阅读位置已变化，未保存旧回执',409);
      let quote=null;if(input.kind==='message'){
        const chars=[...context.original],needle=[...input.quote];let offset=-1;for(let i=0;i+needle.length<=chars.length&&offset<0;i++)if(chars.slice(i,i+needle.length).join('')===input.quote)offset=i;
        if(offset<0)throw fail('原文引用必须与实际领取的片段完全一致',400);quote={text:input.quote,start:offset,end:offset+needle.length,passageId:context.passageId,contentVersion:context.contentVersion};
      }
      event.lastReceipt={nonce:input.claimNonce,digest:submissionHash,grantId:grant.id,hostInstallId:input.hostInstallId,status:input.kind==='message'?'delivered':input.kind==='silence'?'silenced':'failed'};event.lease=null;
      if(input.kind==='failed'){event.state='pending';event.claimedAt=null;return {status:'failed',event:visibleEvent(event),context:null,activity:null,card:null,quiet:null,duplicate:false};}
      event.finishedAt=iso(now);event.result=input.kind;event.state=input.kind==='message'?'delivered':'silenced';
      if(input.kind==='message'){
        const chapter=state.book.chapters.find(ch=>ch.id===context.chapterId);event.card={id:event.id,date:event.date,kind:event.kind,label:event.kind==='test'?'连接测试':'每日陪读',bookId:plan.bookId,bookTitle:plan.bookTitle,contentVersion:context.contentVersion,chapterId:context.chapterId,chapterLabel:chapter?.title?.zh||chapter?.title?.en||'',passageId:context.passageId,message:input.message,quote,link:context.citation.url,attribution:'AI · 每日陪读',deliveredAt:iso(now)};doc.inbox.unshift(clone(event.card));
      }
      plan.lastDelivery={eventId:event.id,date:event.date,kind:event.kind,status:event.state,at:iso(now),fingerprint:event.fingerprint};trim(doc);
      return {status:event.state,event:visibleEvent(event),context:null,activity:null,card:clone(event.card),quiet:event.state==='silenced'?quiet('silenced'):null,duplicate:false};
    });
  }
  async function invalidateGrant(ownerId,grantId){
    if(typeof ownerId!=='string'||!ownerId)return;await store.mutate(key({id:ownerId}),empty(),doc=>{if(!doc.plan||doc.plan.grantId!==grantId)return null;doc.plan.grantRevoked=true;doc.plan.connectedAt=null;doc.plan.updatedAt=iso(clock());doc.plan.revision++;for(const event of doc.events)event.lease=null;return null;});
  }
  if(typeof library.registerGrantRevocation==='function')library.registerGrantRevocation((ownerId,grantId)=>invalidateGrant(ownerId,grantId));
  return {view,configure,pause,resume,requestTest,reportPresence,hasActivePresence,connect,claim,finish,invalidateGrant};
}
