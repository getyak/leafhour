import test from 'node:test';
import assert from 'node:assert/strict';
import {createDailyReadingService,CLAIM_LEASE_MS,zonedDueAt} from '../server/daily-reading.mjs';
import {readingJourney} from '../server/reading-activity.mjs';
const owner={id:'synthetic-race-owner'},date='2026-10-18',start=Date.parse(date+'T12:05:00Z');
const book=id=>({bookId:id,contentVersion:'v1',title:{en:id},source:{format:'text',sha256:'synthetic'},chapters:[{id:'chapter1',kind:'body',title:{en:'Opening'}}],sections:[{chapterId:'chapter1',paragraphs:[{id:'passage1',original:'Synthetic original for '+id,translations:{literal:{text:'literal'},interpretive:{text:'interpretive'}},source:{},annotationIds:[],termIds:[]}]}]});
function fixture(){
 let now=start,seconds=0,nextGrant=1,before=null,after=null,tail=Promise.resolve();
 const books=new Map(['book-a','book-b'].map(id=>[id,book(id)])),records={position:{chapterId:'chapter1',passageId:'passage1'},readingSessions:[],readingMilestones:[]},presence={tabs:{}};
 const grants=[{id:'g1',ownerId:owner.id,bookId:'book-a',scopes:['daily:deliver'],createdAt:new Date(start).toISOString(),expiresAt:new Date(start+86400000).toISOString(),revoked:false,token:'synthetic-1'}];
 let doc={kind:'leafhour-daily-reading',schemaVersion:1,plan:{id:'plan1',revision:1,bookId:'book-a',bookTitle:'book-a',contentVersion:'v1',goal:'resume',time:'20:00',timeZone:'Asia/Shanghai',channel:'library',consent:{originalText:true,readingActivity:true},grantId:'g1',grantExpiresAt:grants[0].expiresAt,grantRevoked:false,paused:false,hostLabel:'host',schedulerId:'scheduler',hostInstallId:'host1',connectedAt:new Date(start).toISOString(),configuredAt:new Date(start).toISOString(),updatedAt:new Date(start).toISOString()},events:[],inbox:[]};
 const store={read:async(key)=>structuredClone(key.startsWith('daily-presence:')?presence:doc),mutate(key,fallback,fn){
  const post=after;after=null;const task=tail.then(async()=>{if(before){const hook=before;before=null;await hook();}const isPresence=key.startsWith('daily-presence:'),row=structuredClone(isPresence?presence:doc),result=await fn(row);if(isPresence)presence.tabs=row.tabs;else doc=row;return structuredClone(result);});tail=task.catch(()=>{});
  return task.then(async result=>{if(post)await post();return result;});
 }};
 const library={getBook:async(user,id)=>{assert.equal(user.id,owner.id);const b=books.get(id);if(!b)throw Object.assign(Error('missing'),{status:404});return structuredClone(b);},records:async()=>structuredClone(records),isGrantActive:async id=>grants.some(g=>g.id===id&&!g.revoked&&Date.parse(g.expiresAt)>now),readingActivity:async()=>({days:[{date,books:[{bookId:'book-a',durationSeconds:seconds}]}]}),createDailyGrant:async(user,{bookId})=>{const grant={id:'g'+(++nextGrant),ownerId:owner.id,bookId,scopes:['daily:deliver'],createdAt:new Date(now).toISOString(),expiresAt:new Date(now+30*86400000).toISOString(),revoked:false,token:'synthetic-'+nextGrant};grants.push(grant);return structuredClone(grant);},grants:async()=>structuredClone(grants),revokeGrant:async(user,id)=>{const g=grants.find(g=>g.id===id);if(g)g.revoked=true;}};
 const daily=createDailyReadingService({library,dataStore:store,dataDir:'/unused',clock:()=>now}),grant=structuredClone(grants[0]);
 const claim=()=>daily.claim(owner,{hostInstallId:'host1'},grant),input=(claim,patch={})=>({hostInstallId:'host1',eventId:claim.event.id,...(claim.claimNonce?{claimNonce:claim.claimNonce}:{}),kind:'message',message:'从这一段接着读。',quote:claim.context.original.slice(0,9),...patch});
 return {daily,library,books,records,grants,grant,store,claim,input,finish:(claimed,patch)=>daily.finish(owner,input(claimed,patch),grant),get doc(){return doc;},setBefore:hook=>{before=hook;},setAfter:hook=>{after=hook;},advance:ms=>{now+=ms;},setSeconds:x=>{seconds=x;},present:()=>{doc.presence={tabs:{tab:{expiresAt:now+90000}}};},now:()=>now};
}
const configure=revision=>({baseRevision:revision,bookId:'book-a',time:'20:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}});
test('a revoked old-book connection cannot adopt or read a concurrently replaced book plan',async()=>{
 const f=fixture();f.setBefore(()=>{Object.assign(f.doc.plan,{bookId:'book-b',bookTitle:'book-b',grantId:'g2',revision:2});f.grants[0].revoked=true;f.grants.push({...f.grant,id:'g2',bookId:'book-b'});});
 await assert.rejects(f.daily.connect(owner,{hostInstallId:'old-host',hostLabel:'host',schedulerId:'old-scheduler'},f.grant),e=>[403,409].includes(e.status));
});
test('claim rechecks the input grant and configuration after entering CAS',async()=>{
 const f=fixture();f.setBefore(()=>{Object.assign(f.doc.plan,{grantId:'g2',revision:2});f.grants[0].revoked=true;f.grants.push({...f.grant,id:'g2'});});
 try{const result=await f.claim();assert.notEqual(result.status,'claimed');assert.equal(result.context,null);}catch(error){assert.ok([403,409].includes(error.status));}
});
test('overlapping successful configure cleanup cannot revoke the newer bound grant or return its plan with an older token',async()=>{
 const f=fixture();let entered,release;const seen=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});f.setAfter(async()=>{entered();await gate;});
 const first=f.daily.configure(owner,configure(1));await seen;const second=await f.daily.configure(owner,configure(2));release();const older=await first;
 assert.equal(f.doc.plan.grantId,second.grant.id);assert.equal(await f.library.isGrantActive(second.grant.id),true);assert.equal(older.plan.grantId,older.grant.id);
});
for(const mode of ['presence','goal','finished'])test('finish rechecks '+mode+' after preflight and inside CAS',async()=>{
 const f=fixture(),a=await f.claim();let changed=false;f.setBefore(()=>{changed=true;if(mode==='presence')f.present();if(mode==='goal'){f.records.readingGoal={minutes:5};f.setSeconds(300);}if(mode==='finished'){f.records.readingMilestones.push({origin:'user',type:'book_finished',bookId:'book-a',contentVersion:'v1',createdAt:new Date(f.now()).toISOString()});assert.equal(readingJourney(f.books.get('book-a'),f.records).status,'finished');}});
 try{const result=await f.finish(a);assert.notEqual(result.status,'delivered');}catch(error){assert.equal(error.status,409);}assert.equal(changed,true);assert.equal(f.doc.inbox.length,0);
});
for(const mode of ['clock','source'])test('finish rejects '+mode+' changes while waiting for CAS',async()=>{
 const f=fixture(),a=await f.claim();let changed=false;f.setBefore(()=>{changed=true;if(mode==='clock')f.advance(40*60000);else f.books.get('book-a').contentVersion='v2';});
 try{const result=await f.finish(a);assert.notEqual(result.status,'delivered');}catch(error){assert.equal(error.status,409);}assert.equal(changed,true);assert.equal(f.doc.inbox.length,0);
});
test('expired and failed attempts cannot complete or release a newer lease owned by the same host',async()=>{
 for(const mode of ['expired','failed']){
  const f=fixture(),a=await f.claim();assert.equal(typeof a.claimNonce,'string');
  if(mode==='expired')f.advance(CLAIM_LEASE_MS+1);else await f.finish(a,{kind:'failed',message:undefined,quote:undefined});
  const b=await f.claim();assert.equal(b.status,'claimed');assert.notEqual(a.claimNonce,b.claimNonce);
  await assert.rejects(f.finish(a),e=>e.status===409);await assert.rejects(f.finish(a,{kind:'failed',message:undefined,quote:undefined}),e=>e.status===409);
  assert.equal((await f.finish(b)).status,'delivered');assert.equal(f.doc.inbox.length,1);
 }
});
test('a lost committed response accepts only its completed nonce and identical submission digest',async()=>{
 const f=fixture(),a=await f.claim(),mutate=f.store.mutate;let lose=true;f.store.mutate=async(...args)=>{const result=await mutate(...args);if(lose){lose=false;throw Object.assign(Error('lost response'),{status:503});}return result;};
 await assert.rejects(f.finish(a),e=>e.status===503);const retry=await f.finish(a);assert.equal(retry.status,'delivered');assert.equal(retry.duplicate,true);assert.equal(f.doc.inbox.length,1);
 await assert.rejects(f.finish(a,{message:'different message'}),e=>e.status===409);await assert.rejects(f.finish(a,{claimNonce:'different-claim-nonce'}),e=>e.status===409);
});
test('message requires an exact quote inside the actually claimed fragment, including for long passages',async()=>{
 const f=fixture();f.books.get('book-a').sections[0].paragraphs[0].original='A'.repeat(1300)+' UNRETURNED-TAIL';const a=await f.claim();assert.equal(a.context.original.includes('UNRETURNED-TAIL'),false);
 await assert.rejects(f.finish(a,{quote:'UNRETURNED-TAIL'}),e=>e.status===400);await assert.rejects(f.finish(a,{quote:undefined}),e=>e.status===400);assert.equal((await f.finish(a,{quote:'AAA'})).status,'delivered');
});
test('message length uses Unicode codepoints, and expiry has its own honest display state',async()=>{
 const f=fixture(),a=await f.claim();assert.equal((await f.finish(a,{message:'🦊'.repeat(600)})).status,'delivered');
 const expired=fixture();expired.doc.plan.grantExpiresAt=new Date(expired.now()-1).toISOString();expired.library.isGrantActive=async()=>false;assert.equal((await expired.daily.view(owner)).plan.status,'expired');
});
test('connection is not activated when the source read is unavailable',async()=>{
 const f=fixture();f.doc.plan.connectedAt=null;f.books.delete('book-a');await assert.rejects(f.daily.connect(owner,{hostInstallId:'host1',hostLabel:'host',schedulerId:'scheduler'},f.grant));assert.notEqual((await f.daily.view(owner)).plan.status,'active');
});
for(const mode of ['source','finished','goal'])test('finish probes current '+mode+' after its asynchronous calendar read',async()=>{
 const f=fixture();if(mode==='goal'){f.setSeconds(300);f.records.bookId='book-a';f.records.readingSessions.push({id:'read-1',bookId:'book-a',contentVersion:'v1',source:'reader_focus',startedAt:date+'T12:00:00Z',endedAt:date+'T12:05:00Z',segments:[{startedAt:date+'T12:00:00Z',endedAt:date+'T12:05:00Z'}],end:{chapterId:'chapter1',passageId:'passage1'}});}
 const a=await f.claim(),read=f.library.readingActivity;let changed=false;f.library.readingActivity=async(...args)=>{const result=await read(...args);changed=true;if(mode==='source')f.books.get('book-a').contentVersion='v2';if(mode==='finished')f.records.readingMilestones.push({origin:'user',type:'book_finished',bookId:'book-a',contentVersion:'v1',createdAt:new Date(f.now()).toISOString()});if(mode==='goal')f.records.readingGoal={minutes:5};return result;};
 const result=await f.finish(a);assert.equal(changed,true);assert.equal(result.status,'quiet');assert.equal(f.doc.inbox.length,0);
});
test('IANA schedule conversion handles DST offsets, a repeated hour and a skipped hour explicitly',()=>{
 assert.equal(new Date(zonedDueAt('2026-03-08','03:30','America/New_York')).toISOString(),'2026-03-08T07:30:00.000Z');
 assert.equal(new Date(zonedDueAt('2026-03-08','02:30','America/New_York')).toISOString(),'2026-03-08T07:30:00.000Z');
 assert.equal(new Date(zonedDueAt('2026-11-01','01:30','America/New_York')).toISOString(),'2026-11-01T05:30:00.000Z');
 assert.equal(new Date(zonedDueAt('2026-10-25','02:30','Europe/Berlin')).toISOString(),'2026-10-25T00:30:00.000Z');
 assert.equal(new Date(zonedDueAt('2026-04-05','02:30','Australia/Sydney')).toISOString(),'2026-04-04T15:30:00.000Z');
 assert.equal(new Date(zonedDueAt('2026-10-18','20:00','Asia/Shanghai')).toISOString(),'2026-10-18T12:00:00.000Z');
});
for(const active of [true,false])test('presence ignores an older '+(active?'inactive release':'active heartbeat')+' even when its server handler resumes after the newer state',async()=>{
 const f=fixture(),tabId='reordered-tab';
 await f.daily.reportPresence(owner,{tabId,active,sequence:2});
 await f.daily.reportPresence(owner,{tabId,active:!active,sequence:1});
 assert.equal(await f.daily.hasActivePresence(owner),active);
 const again=await f.daily.reportPresence(owner,{tabId,active:!active,sequence:2});assert.equal(again.ignored,true);assert.equal(await f.daily.hasActivePresence(owner),active);
});
test('presence requires an increasing safe sequence and bounded server tombstone retention',async()=>{
 const f=fixture();for(const sequence of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(f.daily.reportPresence(owner,{tabId:'tab',active:true,sequence}),e=>e.status===400);
 await f.daily.reportPresence(owner,{tabId:'tab',active:false,sequence:3});assert.equal(await f.daily.hasActivePresence(owner),false);
 f.advance(90001);await f.daily.reportPresence(owner,{tabId:'new-tab',active:true,sequence:1});assert.equal(Object.hasOwn(f.doc.presence.tabs,'tab'),false);
});

test('a handler older than the tombstone retention cannot commit after CAS wait or retry',async()=>{
 const f=fixture();await f.daily.reportPresence(owner,{tabId:'tab',active:false,sequence:3});
 f.setBefore(()=>{f.advance(90000);delete f.doc.presence.tabs.tab;});
 await assert.rejects(f.daily.reportPresence(owner,{tabId:'tab',active:true,sequence:1}),e=>e.status===408);assert.equal(await f.daily.hasActivePresence(owner),false);
});
test('presence lease expiry uses request reception rather than delayed mutation time',async()=>{
 const f=fixture(),receivedAt=f.now();f.setBefore(()=>f.advance(30000));const result=await f.daily.reportPresence(owner,{tabId:'tab',active:true,sequence:1});assert.equal(result.expiresAt,receivedAt+90000);
});
