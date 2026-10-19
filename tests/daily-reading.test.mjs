import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLibraryService} from '../server/library-service.mjs';

const dailyModule=await import('../server/daily-reading.mjs').catch(()=>({}));
const storeModule=await import('../server/locked-json-store.mjs').catch(()=>({}));
const {createDailyReadingService,dailyEventId,dailyTestEventId,localCalendarDate,zonedDueAt,DAILY_GRANT_TTL_DAYS,DAILY_SCOPE,MAX_MESSAGE_CODEPOINTS,MAX_QUOTE_CODEPOINTS,PRESENCE_TTL_MS}=dailyModule;

const owner={id:'daily-owner'},other={id:'daily-other'};
// Keep the simulated morning and its real-library sessions in the past even
// when CI runs just after Shanghai midnight; the library rejects future time.
const today=localCalendarDate?localCalendarDate('Asia/Shanghai',Date.now()-86400000):'2026-10-18';
const dueAt=zonedDueAt?zonedDueAt(today,'09:00','Asia/Shanghai'):Date.now();
const baseNow=dueAt+5*60000;
const configureInput=(bookId,patch={})=>({baseRevision:0,bookId,time:'09:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true},...patch});

const createLockedJsonStoreReady=storeModule.createLockedJsonStore;
let configureToken=null;

async function buildFixture(t,options){
  configureToken=null;
  assert.equal(typeof createDailyReadingService,'function','daily reading service is required');
  assert.equal(typeof createLockedJsonStoreReady,'function','locked json store is required');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-daily-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:path.join(dir,'library'),catalogDir:null});
  const book=await library.importDocument(owner,{filename:'Daily.txt',bytes:Buffer.from('Read slowly and keep a question.\n\nReturn to the source with your own thought.')});
  const chapterId=book.sections[0].chapterId,passageId=book.sections[0].paragraphs[0].id;
  await library.saveProgress(owner,book.bookId,{chapterId,passageId,offset:0,mode:'en',variant:'literal'});
  let now=baseNow;
  const daily=createDailyReadingService({library,dataDir:path.join(dir,'daily'),clock:()=>now});
  const issued=await daily.configure(owner,configureInput(book.bookId));
  configureToken=issued.token;
  let activeGrant={...issued.grant,ownerId:owner.id};
  const extra=options?.secondInstance?createDailyReadingService({library,dataDir:path.join(dir,'daily'),clock:()=>now}):null;
  const pick=args=>args[0]&&typeof args[0].finish==='function'?[args[0],args[1]]:[daily,args[0]];
  const claims=new Map();
  return {
    dir,library,book,chapterId,passageId,daily,extra,plan:issued.plan,
    get grant(){return activeGrant;},
    useGrant:grant=>{activeGrant={...grant,ownerId:owner.id};},
    advance:ms=>{now+=ms;},setNow:value=>{now=value;},now:()=>now,
    connect:(...args)=>{const [ref,input]=pick(args);return ref.connect({id:owner.id},{schedulerId:'scheduler-codex-1',hostLabel:'codex-heartbeat',hostInstallId:typeof input==='string'?input:'host-install-a'},activeGrant);},
    claim:async(...args)=>{const [ref,input]=pick(args),result=await ref.claim({id:owner.id},{hostInstallId:'host-install-a',...(input||{})},activeGrant);if(result.status==='claimed')claims.set(result.event.id,{claimNonce:result.claimNonce,quote:result.context.original.slice(0,9)});return result;},
    finish:(...args)=>{const [ref,input]=pick(args),claim=claims.get(input.eventId);return ref.finish({id:owner.id},{hostInstallId:'host-install-a',claimNonce:claim?.claimNonce,...(input.kind==='message'&&!Object.hasOwn(input,'quote')?{quote:claim?.quote}:{}),...input},activeGrant);}
  };
}
const session=(f,{id='session-1',startedAt=today+'T00:10:00.000Z',endedAt=today+'T00:40:00.000Z',patch={}}={})=>({id,source:'reader_focus',sequence:1,status:'finished',startedAt,endedAt,timeZone:'Asia/Shanghai',start:{chapterId:f.chapterId,passageId:f.passageId},end:{chapterId:f.chapterId,passageId:f.passageId},segments:[{startedAt,endedAt}],...patch});

test('the shared locked JSON store keeps exactly one writer per key across independent processes',async t=>{
  assert.equal(typeof createLockedJsonStoreReady,'function');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-daily-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const module=new URL('../server/locked-json-store.mjs',import.meta.url).href;
  const script=`import {createLockedJsonStore} from ${JSON.stringify(module)};const s=createLockedJsonStore({dataDir:process.argv[1]});try{await s.mutate('shared-key',{},row=>{if(row.locked)throw Object.assign(Error('held'),{code:'HELD'});row.locked=true;});console.log('claimed');}catch(e){console.log('denied:'+(e.code||e.status));}`;
  const run=promisify(execFile),results=await Promise.all(['one','two'].map(()=>run(process.execPath,['--input-type=module','-e',script,dir])));
  assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),['claimed','denied:HELD']);
});

test('configure needs the owner, a fixed book and explicit consent, and issues one narrow 30-day grant whose token is never stored',async t=>{
  const f=await buildFixture(t);
  assert.equal(f.plan.status,'awaiting-host');
  assert.equal(f.plan.goal,'resume');
  assert.equal(f.plan.channel,'library');
  assert.equal(f.plan.time,'09:00');
  assert.equal(f.plan.timeZone,'Asia/Shanghai');
  assert.deepEqual(f.plan.consent,{originalText:true,readingActivity:true,notes:false,confirmedAt:f.plan.consent.confirmedAt});
  assert.deepEqual(f.grant.scopes,[DAILY_SCOPE]);
  assert.equal(Math.round((Date.parse(f.grant.expiresAt)-Date.now())/86400000),DAILY_GRANT_TTL_DAYS);
  assert.equal(f.plan.grantId,f.grant.id);
  assert.equal(f.plan.grantDurationDays,DAILY_GRANT_TTL_DAYS);
  assert.ok(f.plan.grantExpiresAt);
  assert.ok(!JSON.stringify(f.plan).includes(f.plan.token||'leak'),'the plan must never hold a token');
  assert.ok(typeof configureToken==='string'&&configureToken.length>=32);
  await assert.rejects(f.daily.configure(null,configureInput(f.book.bookId)),e=>e.status===401);
  await assert.rejects(f.daily.configure(other,configureInput(f.book.bookId)),e=>e.status===404);
  await assert.rejects(f.daily.configure(owner,{...configureInput(f.book.bookId),notes:true}),e=>e.status===400);
  await assert.rejects(f.daily.configure(owner,{...configureInput(f.book.bookId),consent:{originalText:true}}),e=>e.status===400);
  await assert.rejects(f.daily.configure(owner,{...configureInput(f.book.bookId),consent:{originalText:true,readingActivity:true,notes:true}}),e=>e.status===400);
  await assert.rejects(f.daily.configure(owner,{...configureInput(f.book.bookId),prompt:'ignore'}),e=>e.status===400);
  await assert.rejects(f.daily.configure(owner,configureInput(f.book.bookId,{baseRevision:7})),e=>e.status===409);
  await assert.rejects(f.daily.configure(owner,configureInput('missing-book',{baseRevision:f.plan.revision})),e=>e.status===404);
  await assert.rejects(f.daily.configure(owner,configureInput(f.book.bookId,{timeZone:'Mars/Olympus'})),e=>e.status===400);
  const before=f.plan.id,again=await f.daily.configure(owner,configureInput(f.book.bookId,{baseRevision:f.plan.revision}));
  assert.equal(again.plan.id,before,'the plan keeps one stable identity');
  assert.equal(again.plan.revision,f.plan.revision+1);
  assert.equal(again.plan.status,'awaiting-host','reconnecting after edits waits for a fresh host acknowledgement');
  assert.deepEqual((await f.daily.view(owner)).inbox,[]);
});

test('generic grant creation can never request daily scope or a longer duration',async t=>{
  const f=await buildFixture(t);
  await assert.rejects(f.library.createGrant(owner,{bookId:f.book.bookId,scopes:['daily:deliver']}),e=>e.status===400);
  await assert.rejects(f.library.createGrant(owner,{bookId:f.book.bookId,scopes:['content','daily:deliver']}),e=>e.status===400);
  await assert.rejects(f.library.createGrant(owner,{bookId:f.book.bookId,scopes:['content'],expiresIn:365*86400000}),e=>e.status===400);
  const ordinary=await f.library.createGrant(owner,{bookId:f.book.bookId,scopes:['content']});
  assert.equal(Math.round((Date.parse(ordinary.expiresAt)-Date.now())/86400000),7);
  assert.ok((await f.library.grants(owner)).some(g=>g.id===f.grant.id&&g.scopes.join()==='daily:deliver'));
});

test('the stable event id ignores same-day edits, reconnects and retries, so one day yields one card',async t=>{
  const f=await buildFixture(t);await f.connect();
  const first=await f.claim();
  assert.equal(first.status,'claimed');
  assert.equal(first.event.id,dailyEventId(f.plan.id,today));
  const updated=await f.daily.configure(owner,configureInput(f.book.bookId,{baseRevision:f.plan.revision}));
  f.useGrant(updated.grant);
  await f.connect();
  const retry=await f.claim();
  assert.ok(['claimed','delivered'].includes(retry.status));
  assert.equal(retry.event.id,first.event.id,'a same-day edit must not fork the daily event');
  const finished=await f.finish({eventId:retry.event.id,kind:'message',message:'从上次停下的地方继续。'});
  assert.equal(finished.status,'delivered');
  const again=await f.daily.claim({id:owner.id},{hostInstallId:'host-install-a'},f.grant);
  assert.equal(again.status,'delivered');
  assert.equal(again.duplicate,true);
  assert.equal(again.card.id,first.event.id);
  assert.equal(finished.card.id,first.event.id);
  assert.equal((await f.daily.view(owner)).inbox.length,1,'same-day retries must not create a second daily card');
});

test('claim returns bounded original-layer context with provenance and an honest activity summary',async t=>{
  const f=await buildFixture(t);await f.connect();
  const result=await f.claim();
  assert.equal(result.status,'claimed');
  assert.equal(result.event.kind,'scheduled');
  const context=result.context;
  assert.equal(context.bookId,f.book.bookId);
  assert.equal(context.contentVersion,f.book.contentVersion);
  assert.equal(context.passageId,f.passageId);
  assert.equal(context.original,f.book.sections[0].paragraphs[0].original);
  assert.equal(context.translations,undefined,'the narrow context exposes only the original layer');
  assert.equal(context.notes,undefined);
  assert.equal(context.citation.url,'/read?book='+f.book.bookId+'&passage='+f.passageId+'&contentVersion='+f.book.contentVersion+'&layer=original');
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=24576);
  assert.equal(result.activity.position.passageId,f.passageId);
  assert.equal(typeof result.activity.todayReadingSeconds,'number');
  assert.match(result.activity.meaning,/不证明/);
  assert.ok(!JSON.stringify(result).includes('private-note'));
  await f.library.addComment(owner,f.book.bookId,{id:'private-note',passageId:f.passageId,text:'PRIVATE NOTE TEXT'});
  const second=await f.claim();
  assert.ok(!JSON.stringify(second).includes('PRIVATE NOTE TEXT'),'notes never reach the daily context');
});

test('finish computes exact Unicode quote offsets and commits the card with its delivered event in one CAS',async t=>{
  const f=await buildFixture(t);await f.connect();
  const claimed=await f.claim();
  const quote=f.book.sections[0].paragraphs[0].original.slice(6,20);
  const done=await f.finish({eventId:claimed.event.id,kind:'message',message:'🦊'.repeat(10)+'继续读。',quote});
  assert.equal(done.status,'delivered');
  assert.equal(done.card.attribution,'AI · 每日陪读');
  assert.equal(done.card.label,'每日陪读');
  assert.equal(done.card.quote.text,quote);
  assert.equal(done.card.quote.start,6);
  assert.equal(done.card.quote.end,20);
  assert.equal(done.card.quote.passageId,f.passageId);
  assert.equal(done.card.quote.contentVersion,f.book.contentVersion);
  assert.equal(done.card.link,'/read?book='+f.book.bookId+'&passage='+f.passageId+'&contentVersion='+f.book.contentVersion+'&layer=original');
  assert.equal(done.event.state,'delivered');
  const view=await f.daily.view(owner);
  assert.equal(view.inbox.length,1);
  assert.equal(view.inbox[0].id,done.card.id);
  assert.equal(view.plan.lastDelivery.eventId,claimed.event.id);
  const lost=await f.finish({eventId:claimed.event.id,kind:'message',message:'🦊'.repeat(10)+'继续读。',quote});
  assert.equal(lost.duplicate,true,'a lost finish response retries to the same delivered card');
  assert.equal(lost.card.id,done.card.id);
  assert.equal((await f.daily.view(owner)).inbox.length,1);
});

test('silence is terminal and can never be rewritten into a delivered card',async t=>{
  const f=await buildFixture(t);await f.connect();const claimed=await f.claim();
  const silent=await f.finish({eventId:claimed.event.id,kind:'silence'});
  assert.equal(silent.status,'silenced');
  assert.equal(silent.card,null);
  await assert.rejects(f.finish({eventId:claimed.event.id,kind:'message',message:'不该出现的卡片。'}),e=>e.status===409,'a different payload cannot reuse a completed silence receipt');
  assert.equal((await f.daily.view(owner)).inbox.length,0);
  const retry=await f.claim();
  assert.equal(retry.status,'silenced');
});

test('a failed finish releases the lease for retry, and three claims exhaust the daily window',async t=>{
  const f=await buildFixture(t);await f.connect();
  for(let attempt=1;attempt<=3;attempt++){
    const claimed=await f.claim();
    assert.equal(claimed.status,'claimed',String(attempt));
    assert.equal(claimed.event.attempts,attempt);
    const failed=await f.finish({eventId:claimed.event.id,kind:'failed'});
    assert.equal(failed.status,'failed');
  }
  assert.equal((await f.claim()).status,'quiet');
  assert.equal((await f.claim()).quiet.reason,'attempts-exhausted');
  assert.equal((await f.daily.view(owner)).inbox.length,0);
});

test('claim only ever considers today: too early, too late and yesterday are quiet without replay',async t=>{
  const f=await buildFixture(t);await f.connect();
  f.setNow(dueAt-5*60000);
  assert.equal((await f.claim()).quiet.reason,'not-due');
  f.setNow(dueAt+31*60000);
  assert.equal((await f.claim()).quiet.reason,'window-closed');
  assert.equal((await f.daily.view(owner)).inbox.length,0,'missed days are never replayed');
  f.setNow(dueAt+24*3600000+5*60000);
  assert.equal((await f.claim()).status,'claimed','a new day has its own window and yesterday is never replayed');
});

test('pause invalidates a held lease atomically and finish cannot publish after pausing',async t=>{
  const f=await buildFixture(t);await f.connect();const claimed=await f.claim();
  const paused=await f.daily.pause(owner,{baseRevision:f.plan.revision});
  assert.equal(paused.plan.status,'paused');
  const late=await f.finish({eventId:claimed.event.id,kind:'message',message:'暂停后不该送达。'});
  assert.ok(['quiet'].includes(late.status));
  assert.equal(late.card,null);
  assert.equal((await f.daily.view(owner)).inbox.length,0);
  assert.equal((await f.claim()).quiet.reason,'paused');
  const resumed=await f.daily.resume(owner,{baseRevision:paused.plan.revision});
  assert.equal(resumed.plan.status,'active','resume preserves the matching schedule and connection');
  await f.connect();
  const again=await f.claim();
  assert.equal(again.status,'claimed');
  assert.equal(again.event.attempts,2,'a pause keeps the daily attempt budget honest');
});

test('generic grant revocation invalidates the bound plan before it acknowledges success',async t=>{
  const f=await buildFixture(t);await f.connect();const claimed=await f.claim();
  await f.library.revokeGrant(owner,f.grant.id);
  const plan=(await f.daily.view(owner)).plan;
  assert.ok(['revoked','awaiting-host'].includes(plan.status),'revocation must already be reflected in the plan');
  const late=await f.finish({eventId:claimed.event.id,kind:'message',message:'撤回后不该送达。'});
  assert.equal(late.status,'quiet');
  assert.equal(late.card,null);
  assert.equal((await f.daily.view(owner)).inbox.length,0);
  assert.equal((await f.claim()).quiet.reason,'grant-invalid');
});

test('expired daily grants stay honest and quiet instead of claiming indefinite service',async t=>{
  const f=await buildFixture(t);await f.connect();
  // The library issues grants with the real clock; the reading fixture starts
  // yesterday at 09:05. Advancing that fixture by 31 days can still precede the
  // grant's actual expiry when CI runs after 09:05. Use its authoritative date.
  const expiresAt=Date.parse(f.grant.expiresAt);assert.ok(Number.isFinite(expiresAt));
  f.setNow(expiresAt-1);assert.equal((await f.daily.view(owner)).plan.status,'active');
  for(const offset of [0,1,86400000]){
    f.setNow(expiresAt+offset);const result=await f.claim();
    assert.equal(result.status,'quiet');assert.equal(result.quiet.reason,'expired');
    assert.equal(result.context,null);assert.equal(result.activity,null);assert.equal(result.card,null);
    assert.equal((await f.daily.view(owner)).plan.status,'expired');
  }
  const final=await f.daily.view(owner);assert.deepEqual(final.events,[]);assert.deepEqual(final.inbox,[]);
});

test('an active reader anywhere suppresses the card and the host learns only the quiet reason',async t=>{
  const f=await buildFixture(t);await f.connect();
  await f.daily.reportPresence(owner,{tabId:'tab-desktop',active:true,sequence:1});
  const quiet=await f.claim();
  assert.equal(quiet.status,'quiet');
  assert.equal(quiet.quiet.reason,'reader-present');
  assert.ok(!JSON.stringify(quiet).includes(f.book.bookId),'the quiet reply must not reveal another book');
  assert.ok(!JSON.stringify(quiet).includes(f.book.title.zh||'Daily'));
  await f.daily.reportPresence(owner,{tabId:'tab-desktop',active:false,sequence:2});
  assert.equal((await f.claim()).status,'claimed');
});

test('presence leases expire after 90 seconds, work across devices and never count as reading time',async t=>{
  const f=await buildFixture(t);
  const before=await f.library.readingActivity(owner,{month:today.slice(0,7),timeZone:'Asia/Shanghai'});
  await f.daily.reportPresence(owner,{tabId:'tab-a',active:true,sequence:1});
  await f.daily.reportPresence(owner,{tabId:'tab-b',active:true,sequence:1});
  assert.equal(await f.daily.hasActivePresence(owner),true);
  await f.daily.reportPresence(owner,{tabId:'tab-b',active:false,sequence:2});
  assert.equal(await f.daily.hasActivePresence(owner),true,'one active device is enough to stay quiet');
  f.advance(PRESENCE_TTL_MS+1000);
  assert.equal(await f.daily.hasActivePresence(owner),false,'a lease covers at most 90 seconds of server-observed presence');
  const after=await f.library.readingActivity(owner,{month:today.slice(0,7),timeZone:'Asia/Shanghai'});
  assert.equal(after.durationSeconds,before.durationSeconds,'presence never contributes reading time');
  await assert.rejects(f.daily.reportPresence(owner,{tabId:'tab-x',active:'yes',sequence:1}),e=>e.status===400);
  await assert.rejects(f.daily.reportPresence(owner,{tabId:'../evil',active:true,sequence:1}),e=>e.status===400);
  await assert.rejects(f.daily.reportPresence(null,{tabId:'tab-x',active:true,sequence:1}),e=>e.status===401);
});

test('a user-marked finished book and a reached explicit daily goal keep the host quiet',async t=>{
  const f=await buildFixture(t);await f.connect();
  await f.library.saveReadingSession(owner,f.book.bookId,session(f));
  await f.library.setReadingGoal(owner,f.book.bookId,{minutes:5});
  assert.equal((await f.claim()).quiet.reason,'goal-complete');
  await f.library.recordReadingMilestone(owner,f.book.bookId,{id:'finished-1',type:'book_finished'});
  assert.equal((await f.claim()).quiet.reason,'book-finished');
});

test('an untouched goal without an explicit one does not silence the card',async t=>{
  const f=await buildFixture(t);await f.connect();
  await f.library.saveReadingSession(owner,f.book.bookId,session(f));
  assert.equal((await f.claim()).status,'claimed','without an explicit reading-time goal there is nothing to complete');
});

test('the same source position without new reading is no-useful-continuation, not a repeated card',async t=>{
  const f=await buildFixture(t);await f.connect();
  const first=await f.claim();
  assert.equal(first.status,'claimed');
  await f.finish({eventId:first.event.id,kind:'message',message:'今天的陪读。'});
  f.setNow(dueAt+24*3600000+5*60000);
  assert.equal((await f.claim()).quiet.reason,'no-useful-continuation');
  await f.library.saveReadingSession(owner,f.book.bookId,session(f,{id:'session-new',startedAt:today+'T01:10:00.000Z',endedAt:today+'T01:20:00.000Z'}));
  const resumed=await f.claim();
  assert.equal(resumed.status,'claimed','new reading makes the same position worth continuing');
});

test('source changes and empty sources never generate a card',async t=>{
  const f=await buildFixture(t);await f.connect();
  const original=f.library.getBook;
  f.library.getBook=async(user,id)=>({...await original(user,id),contentVersion:'changed-version'});
  assert.equal((await f.claim()).quiet.reason,'source-changed');
  f.library.getBook=async(user,id)=>{const book=structuredClone(await original(user,id));book.sections[0].paragraphs[0].original='   ';return book;};
  assert.equal((await f.claim()).quiet.reason,'no-source');
  f.library.getBook=original;
});

test('two service instances cannot both claim and deliver the same day',async t=>{
  const f=await buildFixture(t,{secondInstance:true});await f.connect();
  const results=await Promise.all([f.claim(),f.claim(f.extra)]);
  const claimed=results.filter(r=>r.status==='claimed');
  assert.equal(claimed.length,1,'exactly one instance may hold the daily lease');
  const held=results.find(r=>r.status!=='claimed');
  assert.ok(['quiet','claimed'].includes(held.status));
  const done=await f.finish({eventId:claimed[0].event.id,kind:'message',message:'只送达一次。'});
  assert.equal(done.status,'delivered');
  await assert.rejects(f.finish(f.extra,{eventId:claimed[0].event.id,kind:'message',message:'不该重复送达。'}),e=>e.status===409);
  assert.equal((await f.daily.view(owner)).inbox.length,1);
});

test('a failed storage operation is not a successful delivery',async t=>{
  const f=await buildFixture(t);await f.connect();const claimed=await f.claim();
  const inner=storeModule.createLockedJsonStore({dataDir:path.join(f.dir,'daily')});
  let failures=1;
  const failing={read:inner.read,mutate:(...args)=>{if(failures>0){failures--;return Promise.reject(Object.assign(Error('storage unavailable'),{status:503}));}return inner.mutate(...args);}};
  const broken=createDailyReadingService({library:f.library,dataDir:path.join(f.dir,'daily'),dataStore:failing,clock:f.now});
  await assert.rejects(broken.finish({id:owner.id},{hostInstallId:'host-install-a',eventId:claimed.event.id,claimNonce:claimed.claimNonce,kind:'message',message:'写入失败不该算送达。',quote:claimed.context.original.slice(0,9)},f.grant),e=>e.status===503);
  assert.equal((await f.daily.view(owner)).inbox.length,0);
});

test('the explicit test event is owner-created once per day and is never consumed by scheduled claims',async t=>{
  const f=await buildFixture(t);await f.connect();
  const test=await f.daily.requestTest(owner);
  assert.equal(test.event.kind,'test');
  assert.equal(test.event.id,dailyTestEventId(f.plan.id,today));
  assert.equal(test.event.label,'连接测试');
  await assert.rejects(f.daily.requestTest(owner),e=>e.status===409);
  const scheduled=await f.claim();
  assert.equal(scheduled.status,'claimed');
  assert.equal(scheduled.event.kind,'scheduled','a normal claim never consumes the test exception');
  const testClaim=await f.claim({eventId:test.event.id});
  assert.equal(testClaim.status,'claimed');
  assert.equal(testClaim.event.kind,'test');
  const done=await f.finish({eventId:test.event.id,kind:'message',message:'连接测试卡片。'});
  assert.equal(done.status,'delivered');
  assert.equal(done.card.label,'连接测试');
  assert.equal((await f.daily.view(owner)).inbox.length,1);
  assert.equal((await f.daily.view(owner)).inbox[0].id,test.event.id);
  await assert.rejects(f.claim({eventId:'forged-test-id'}),e=>e.status===404);
  const scheduledDone=await f.finish({eventId:scheduled.event.id,kind:'message',message:'正常卡片。'});
  assert.equal(scheduledDone.status,'delivered');
  assert.equal((await f.daily.view(owner)).inbox.length,2);
});

test('the test event is short-lived like the scheduled window',async t=>{
  const f=await buildFixture(t);await f.connect();
  const test=await f.daily.requestTest(owner);
  f.advance(31*60000);
  assert.equal((await f.claim({eventId:test.event.id})).quiet.reason,'window-closed');
});

test('message and quote bounds are enforced in Unicode code points and quotes must be exact',async t=>{
  const f=await buildFixture(t);await f.connect();const claimed=await f.claim();
  await assert.rejects(f.finish({eventId:claimed.event.id,kind:'message',message:'🦊'.repeat(MAX_MESSAGE_CODEPOINTS+1)}),e=>e.status===400);
  await assert.rejects(f.finish({eventId:claimed.event.id,kind:'message',message:'ok',quote:'🦊'.repeat(MAX_QUOTE_CODEPOINTS+1)}),e=>e.status===400);
  await assert.rejects(f.finish({eventId:claimed.event.id,kind:'message',message:'ok',quote:'not in the source'}),e=>e.status===400);
  await assert.rejects(f.finish({eventId:claimed.event.id,kind:'message'}),e=>e.status===400);
  await assert.rejects(f.finish({eventId:claimed.event.id,kind:'silence',message:'quiet means quiet'}),e=>e.status===400);
  const long='中'.repeat(MAX_MESSAGE_CODEPOINTS);
  const done=await f.finish({eventId:claimed.event.id,kind:'message',message:long,quote:'Read slowly'});
  assert.equal(done.status,'delivered');
  assert.equal([...done.card.message].length,MAX_MESSAGE_CODEPOINTS);
});

test('owners are isolated: another account sees no plan, inbox or borrowed grant',async t=>{
  const f=await buildFixture(t);await f.connect();
  assert.deepEqual((await f.daily.view(other)).plan,null);
  assert.deepEqual((await f.daily.view(other)).inbox,[]);
  await assert.rejects(f.daily.claim(other,{hostInstallId:'host-install-a'},f.grant),e=>e.status===403);
  const claimed=await f.claim();
  assert.equal(claimed.status,'claimed');
  assert.ok(!JSON.stringify(await f.daily.view(other)).includes(claimed.event.id));
});

test('agent inputs are strict: unknown fields, caller owners and forged events are rejected',async t=>{
  const f=await buildFixture(t);
  await assert.rejects(f.daily.connect({id:owner.id},{schedulerId:'s-1',hostLabel:'host',hostInstallId:'i-1',ownerId:'someone-else'},f.grant),e=>e.status===400);
  await assert.rejects(f.daily.connect({id:owner.id},{schedulerId:'',hostLabel:'host',hostInstallId:'i-1'},f.grant),e=>e.status===400);
  await assert.rejects(f.daily.claim({id:owner.id},{hostInstallId:'i-1',scopes:['notes']},f.grant),e=>e.status===400);
  await assert.rejects(f.daily.finish({id:owner.id},{hostInstallId:'i-1',eventId:'x',kind:'nonsense'},f.grant),e=>e.status===400);
  await assert.rejects(f.daily.connect({id:owner.id},{schedulerId:'s-1',hostLabel:'host',hostInstallId:'i-1'},{...f.grant,id:'foreign-grant'}),e=>e.status===403);
});

test('host connection binds plan, grant and install identity and a host change invalidates pending leases',async t=>{
  const f=await buildFixture(t);
  assert.equal((await f.claim()).quiet.reason,'awaiting-host','nothing is deliverable before a real host connects');
  const connected=await f.connect();
  assert.equal(connected.status,'connected');
  assert.equal(connected.plan.status,'active');
  assert.equal(connected.plan.schedulerId,'scheduler-codex-1');
  assert.ok(connected.plan.connectedAt);
  assert.ok(connected.context&&connected.activity,'the connection performs the authorized bounded context read');
  const claimed=await f.claim();
  assert.equal(claimed.status,'claimed');
  await f.connect(f.daily,'host-install-b');
  const late=await f.finish({eventId:claimed.event.id,kind:'message',message:'换宿主后不该沿用旧租约。'});
  assert.ok(late.status!=='delivered');
  assert.equal((await f.daily.view(owner)).inbox.length,0);
  assert.equal((await f.daily.claim({id:owner.id},{hostInstallId:'host-install-b'},f.grant)).status,'claimed');
});
