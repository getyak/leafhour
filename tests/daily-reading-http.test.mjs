import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

const dailyModule=await import('../server/daily-reading.mjs').catch(()=>({}));
const {localCalendarDate,zonedDueAt}=dailyModule;
const currentTime=()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());

async function fixture(t){
  assert.equal(typeof dailyModule.createDailyReadingService,'function','daily reading service is required');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-daily-http-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession();
  const book=await server.portal.library.importDocument(session.user,{filename:'Daily.txt',bytes:Buffer.from('Read slowly and keep a question.')});
  await server.portal.library.saveProgress(session.user,book.bookId,{chapterId:book.sections[0].chapterId,passageId:book.sections[0].paragraphs[0].id,offset:0,mode:'en',variant:'literal'});
  const headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
  return {dir,server,base,session,book,headers};
}

test('daily owner routes keep the owner, origin, no-store and read-only boundaries',async t=>{
  const f=await fixture(t),url=f.base+'/api/library/daily-reading';
  const grantsBefore=await f.server.portal.library.grants(f.session.user);
  const read=await fetch(url,{headers:f.headers});
  assert.equal(read.status,200);
  assert.match(read.headers.get('cache-control'),/no-store/);
  const empty=await read.json();
  assert.deepEqual(empty.plan,null);
  assert.deepEqual(empty.inbox,[]);
  assert.deepEqual(await f.server.portal.library.grants(f.session.user),grantsBefore,'reading the plan never issues a grant');
  assert.deepEqual(await f.server.portal.library.grants(f.session.user),grantsBefore);
  assert.equal((await fetch(url,{headers:{...f.headers,Cookie:''}})).status,409);
  assert.equal((await fetch(url,{headers:{...f.headers,Origin:'https://unrelated.invalid'}})).status,403);
  assert.equal((await fetch(url,{headers:{...f.headers,'X-Reader-Owner':'someone-else'}})).status,409);
  assert.equal((await fetch(url,{headers:{Cookie:f.headers.Cookie}})).status,409);
  assert.equal((await fetch(url,{method:'PUT',headers:f.headers})).status,405);
  const oversized=JSON.stringify({baseRevision:0,bookId:f.book.bookId,time:'20:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true},pad:'x'.repeat(9000)});
  assert.equal((await fetch(url,{method:'POST',headers:f.headers,body:oversized})).status,413);
});

test('configure issues one visible 30-day narrow token, then the plan and inbox stay honest',async t=>{
  const f=await fixture(t),url=f.base+'/api/library/daily-reading';
  const configured=await fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:0,bookId:f.book.bookId,time:'20:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}})});
  assert.equal(configured.status,200);assert.match(configured.headers.get('cache-control'),/no-store/);
  const first=await configured.json();
  assert.equal(typeof first.token,'string');
  assert.equal(first.grant.durationDays,30);
  assert.deepEqual(first.grant.scopes,['daily:deliver']);
  assert.equal(first.plan.status,'awaiting-host');
  assert.ok(!JSON.stringify(first.plan).includes(first.token),'the plan never repeats the token');
  const view=await (await fetch(url,{headers:f.headers})).json();
  assert.ok(!JSON.stringify(view).includes(first.token),'later reads never repeat the token');
  assert.equal(view.plan.grantId,first.grant.id);
  const bad=await fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:99,bookId:f.book.bookId,time:'20:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}})});
  assert.equal(bad.status,409);
  const noConsent=await fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:first.plan.revision,bookId:f.book.bookId,time:'20:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:false}})});
  assert.equal(noConsent.status,400);
});

test('pause, resume, presence and the one-per-day owner test event stay direct and visible',async t=>{
  const f=await fixture(t),url=f.base+'/api/library/daily-reading';
  const configured=await (await fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:0,bookId:f.book.bookId,time:'20:00',timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}})})).json();
  const paused=await (await fetch(url+'/pause',{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:configured.plan.revision})})).json();
  assert.equal(paused.plan.status,'paused');
  const resumed=await (await fetch(url+'/resume',{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:paused.plan.revision})})).json();
  assert.equal(resumed.plan.status,'awaiting-host');
  const presence=await fetch(url+'/presence',{method:'POST',headers:f.headers,body:JSON.stringify({tabId:'tab-http',active:true,sequence:1})});
  assert.equal(presence.status,200);assert.equal((await presence.json()).active,true);
  assert.equal((await fetch(url+'/presence',{method:'POST',headers:f.headers,body:JSON.stringify({tabId:'tab-http',active:false,sequence:2})})).status,200);
  assert.equal((await fetch(url+'/presence',{method:'POST',headers:f.headers,body:JSON.stringify({tabId:'../evil',active:true,sequence:1})})).status,400);
  const testEvent=await fetch(url+'/test',{method:'POST',headers:f.headers,body:'{}'});
  assert.equal(testEvent.status,200);assert.equal((await testEvent.json()).event.kind,'test');
  assert.equal((await fetch(url+'/test',{method:'POST',headers:f.headers,body:'{}'})).status,409);
  assert.equal((await fetch(url+'/test',{method:'POST',headers:f.headers,body:'{"ownerId":"forged"}'})).status,400);
});

test('narrow daily tokens only reach the daily agent actions, with strict schemas and no caller owner',async t=>{
  const f=await fixture(t),url=f.base+'/api/library/daily-reading';
  const configured=await (await fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:0,bookId:f.book.bookId,time:currentTime(),timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}})})).json();
  const dailyHeaders={Authorization:'Bearer '+configured.token,'Content-Type':'application/json'};
  const ordinary=await f.server.portal.library.createGrant(f.session.user,{bookId:f.book.bookId,scopes:['content']});
  const ordinaryHeaders={Authorization:'Bearer '+ordinary.token,'Content-Type':'application/json'};
  const connectBody=JSON.stringify({schedulerId:'scheduler-http-1',hostLabel:'codex-heartbeat',hostInstallId:'host-http'});
  const connected=await fetch(f.base+'/api/agent/daily-connect',{method:'POST',headers:dailyHeaders,body:connectBody});
  assert.equal(connected.status,200,JSON.stringify(await connected.clone().json()));
  const connection=await connected.json();
  assert.equal(connection.status,'connected');
  assert.equal(connection.plan.status,'active');
  assert.ok(connection.context&&connection.activity);
  const claimed=await (await fetch(f.base+'/api/agent/daily-claim',{method:'POST',headers:dailyHeaders,body:JSON.stringify({hostInstallId:'host-http'})})).json();
  assert.ok(['claimed','quiet'].includes(claimed.status),claimed.quiet?.reason);
  if(claimed.status==='claimed'){
    const finished=await (await fetch(f.base+'/api/agent/daily-finish',{method:'POST',headers:dailyHeaders,body:JSON.stringify({hostInstallId:'host-http',eventId:claimed.event.id,claimNonce:claimed.claimNonce,kind:'message',message:'从原文继续。',quote:claimed.context.original.slice(0,9)})})).json();
    assert.equal(finished.status,'delivered');
    const view=await (await fetch(url,{headers:f.headers})).json();
    assert.equal(view.inbox[0].id,claimed.event.id);
    assert.equal(view.inbox[0].attribution,'AI · 每日陪读');
    assert.equal(view.inbox[0].link,'/read?book='+f.book.bookId+'&passage='+f.book.sections[0].paragraphs[0].id+'&contentVersion='+f.book.contentVersion+'&layer=original');
  }
  for(const [body,expected]of [[JSON.stringify({hostInstallId:'host-http',ownerId:'someone-else'}),400],[JSON.stringify({hostInstallId:'host-http',scopes:['notes']}),400],[JSON.stringify({}),400]]){
    assert.equal((await fetch(f.base+'/api/agent/daily-claim',{method:'POST',headers:dailyHeaders,body})).status,expected);
  }
  assert.equal((await fetch(f.base+'/api/agent/daily-claim',{method:'GET',headers:dailyHeaders})).status,405);
  assert.equal((await fetch(f.base+'/api/agent/manifest?bookId='+f.book.bookId,{headers:dailyHeaders})).status,403);
  assert.equal((await fetch(f.base+'/api/agent/notes?bookId='+f.book.bookId,{headers:dailyHeaders})).status,403);
  assert.equal((await fetch(f.base+'/api/agent/activity?bookId='+f.book.bookId,{headers:dailyHeaders})).status,403);
  assert.equal((await fetch(f.base+'/api/agent/comment?bookId='+f.book.bookId,{method:'POST',headers:dailyHeaders,body:JSON.stringify({id:'x',passageId:'p',text:'t',origin:'user'})})).status,403);
  assert.equal((await fetch(f.base+'/api/agent/daily-connect',{method:'POST',headers:ordinaryHeaders,body:connectBody})).status,403);
  assert.equal((await fetch(f.base+'/api/agent/daily-claim',{method:'POST',headers:ordinaryHeaders,body:JSON.stringify({hostInstallId:'host-http'})})).status,403);
});

test('revoking the daily grant invalidates the plan before the owner API acknowledges it',async t=>{
  const f=await fixture(t),url=f.base+'/api/library/daily-reading';
  const configured=await (await fetch(url,{method:'POST',headers:f.headers,body:JSON.stringify({baseRevision:0,bookId:f.book.bookId,time:currentTime(),timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}})})).json();
  const dailyHeaders={Authorization:'Bearer '+configured.token,'Content-Type':'application/json'};
  await fetch(f.base+'/api/agent/daily-connect',{method:'POST',headers:dailyHeaders,body:JSON.stringify({schedulerId:'scheduler-http-2',hostLabel:'codex-heartbeat',hostInstallId:'host-http'})});
  const claimed=await (await fetch(f.base+'/api/agent/daily-claim',{method:'POST',headers:dailyHeaders,body:JSON.stringify({hostInstallId:'host-http'})})).json();
  const revoked=await fetch(f.base+'/api/library/grants/'+configured.grant.id+'/revoke',{method:'POST',headers:f.headers,body:'{}'});
  assert.equal(revoked.status,200);
  const view=await (await fetch(url,{headers:f.headers})).json();
  assert.equal(view.plan.status,'revoked');
  if(claimed.status==='claimed'){
    const late=await fetch(f.base+'/api/agent/daily-finish',{method:'POST',headers:dailyHeaders,body:JSON.stringify({hostInstallId:'host-http',eventId:claimed.event.id,claimNonce:claimed.claimNonce,kind:'message',message:'撤回后不该送达。',quote:claimed.context.original.slice(0,9)})});
    assert.equal(late.status,403,'a revoked token can never publish a late finish');
  }
  assert.deepEqual((await (await fetch(url,{headers:f.headers})).json()).inbox,[]);
  assert.equal((await fetch(f.base+'/api/agent/daily-claim',{method:'POST',headers:dailyHeaders,body:JSON.stringify({hostInstallId:'host-http'})})).status,403);
});
