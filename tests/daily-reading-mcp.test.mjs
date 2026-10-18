import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createReaderServer} from '../server/server.mjs';
import {runDailyHost} from '../tools/daily-reading-host.mjs';

const dailyModule=await import('../server/daily-reading.mjs').catch(()=>({}));
const size=value=>Buffer.byteLength(JSON.stringify(value));
const currentTime=()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());

async function fixture(t){
  assert.equal(typeof dailyModule.createDailyReadingService,'function','daily reading service is required');
  const dir=await mkdtemp(path.join(os.tmpdir(),'daily-mcp-')),server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const session=await server.portal.auth.localSession();
  const book=await server.portal.library.importDocument(session.user,{filename:'Daily.txt',bytes:Buffer.from('🦊 Read slowly and keep a question.')});
  await server.portal.library.saveProgress(session.user,book.bookId,{chapterId:book.sections[0].chapterId,passageId:book.sections[0].paragraphs[0].id,offset:0,mode:'en',variant:'literal'});
  const configured=await server.portal.dailyReading.configure(session.user,{baseRevision:0,bookId:book.bookId,time:currentTime(),timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}});
  const clients=[];t.after(async()=>{await Promise.all(clients.map(c=>c.close()));await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function connect(token=configured.token){const client=new Client({name:'daily-reader-test',version:'1.0.0'});clients.push(client);await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('server/mcp.mjs')],env:{PATH:process.env.PATH,READER_SERVICE_URL:base,READER_AGENT_TOKEN:token},stderr:'pipe'}));return client;}
  return {dir,server,base,session,book,configured,connect};
}
async function tool(client,name,args){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);assert.ok(size(r)<=98304,'MCP tool envelope exceeds byte bound');assert.ok(size(r.structuredContent)<=24576,'daily reply exceeds the bounded context size');return r.structuredContent;}
async function denied(run){try{const r=await run();assert.equal(r.isError,true,'access unexpectedly succeeded');}catch(e){if(e.code==='ERR_ASSERTION')throw e;}}
const headers=session=>({Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json'});

test('real stdio connect, claim and finish deliver one labelled station card',async t=>{
  const f=await fixture(t),client=await f.connect();
  const connected=await tool(client,'reader_daily_connect',{schedulerId:'scheduler-mcp-1',hostLabel:'codex-heartbeat',hostInstallId:'host-mcp'});
  assert.equal(connected.status,'connected');
  assert.equal(connected.plan.status,'active');
  assert.ok(connected.context&&connected.activity);
  assert.ok(!JSON.stringify(connected).includes(f.configured.token),'the narrow host reply never echoes the token');
  const event=await f.server.portal.dailyReading.requestTest(f.session.user);
  const claimed=await tool(client,'reader_daily_claim',{hostInstallId:'host-mcp',eventId:event.event.id});
  assert.equal(claimed.status,'claimed',claimed.quiet?.reason);assert.equal(typeof claimed.claimNonce,'string');
  assert.equal(claimed.context.contentVersion,f.book.contentVersion);
  assert.equal(claimed.context.translations,undefined);
  const quote='Read slowly';
  const finished=await tool(client,'reader_daily_finish',{hostInstallId:'host-mcp',eventId:claimed.event.id,claimNonce:claimed.claimNonce,kind:'message',message:'🦊'.repeat(600),quote});
  assert.equal(finished.status,'delivered');
  assert.equal(finished.card.attribution,'AI · 每日陪读');
  assert.equal(finished.card.quote.text,quote);
  assert.equal(finished.card.quote.start,2);assert.equal([...finished.card.message].length,600);
  const view=await (await fetch(f.base+'/api/library/daily-reading',{headers:headers(f.session)})).json();
  assert.equal(view.inbox.length,1);
  assert.equal(view.inbox[0].id,claimed.event.id);
  assert.equal(view.inbox[0].link,'/read?book='+f.book.bookId+'&passage='+f.book.sections[0].paragraphs[0].id+'&contentVersion='+f.book.contentVersion+'&layer=original');
});

test('the daily token cannot reach generic tools and generic tokens cannot reach daily tools',async t=>{
  const f=await fixture(t),client=await f.connect(),bookId=f.book.bookId;
  for(const [name,args]of [['reader_get_manifest',{bookId}],['reader_get_context',{bookId}],['reader_get_notes',{bookId}],['reader_get_reading_activity',{bookId}],['reader_search',{bookId,query:'slowly'}]])await denied(()=>client.callTool({name,arguments:args}));
  await denied(()=>client.callTool({name:'reader_add_comment',arguments:{bookId,id:'forged',passageId:'p1',text:'Generated',origin:'user'}}));
  const ordinary=await f.server.portal.library.createGrant(f.session.user,{bookId,scopes:['content']});
  const ordinaryClient=await f.connect(ordinary.token);
  await denied(()=>ordinaryClient.callTool({name:'reader_daily_connect',arguments:{schedulerId:'s-1',hostLabel:'h',hostInstallId:'i-1'}}));
  await denied(()=>ordinaryClient.callTool({name:'reader_daily_claim',arguments:{hostInstallId:'i-1'}}));
  await denied(()=>client.callTool({name:'reader_daily_connect',arguments:{schedulerId:'s-1',hostLabel:'h',hostInstallId:'i-1',ownerId:'someone-else'}}));
  await denied(()=>client.callTool({name:'reader_daily_claim',arguments:{hostInstallId:'i-1',scopes:['notes']}}));
  await denied(()=>client.callTool({name:'reader_daily_finish',arguments:{hostInstallId:'i-1',eventId:'forged',kind:'message',message:'x'}}));
  const tools=await client.listTools();
  assert.ok(tools.tools.some(toolRow=>toolRow.name==='reader_daily_claim'));
  assert.ok(!tools.tools.some(toolRow=>/grant|delete|backup|share/.test(toolRow.name)));
});

test('an owner-created test event id selects only its test card through the narrow tools',async t=>{
  const f=await fixture(t),client=await f.connect();
  await tool(client,'reader_daily_connect',{schedulerId:'scheduler-mcp-2',hostLabel:'codex-heartbeat',hostInstallId:'host-mcp'});
  const testEvent=await f.server.portal.dailyReading.requestTest(f.session.user);
  const claimed=await tool(client,'reader_daily_claim',{hostInstallId:'host-mcp',eventId:testEvent.event.id});
  assert.equal(claimed.status,'claimed',claimed.quiet?.reason);
  await denied(()=>client.callTool({name:'reader_daily_claim',arguments:{hostInstallId:'host-mcp',eventId:'forged-test-id'}}));
  const scheduled=await tool(client,'reader_daily_claim',{hostInstallId:'host-mcp'});
  assert.ok(['claimed','quiet','delivered'].includes(scheduled.status));
  if(claimed.status==='claimed'){
    const finished=await tool(client,'reader_daily_finish',{hostInstallId:'host-mcp',eventId:claimed.event.id,claimNonce:claimed.claimNonce,kind:'silence'});
    assert.equal(finished.status,'silenced');
  }
  assert.equal((await (await fetch(f.base+'/api/library/daily-reading',{headers:headers(f.session)})).json()).inbox.length,0);
});

test('the private host CLI completes a real SDK child and HTTP owner test without writing reading records',async t=>{
  const f=await fixture(t),dir=await realpath(f.dir),file=path.join(dir,'private-host.json'),input=path.join(dir,'private-finish.json');
  await writeFile(file,JSON.stringify({version:1,serviceUrl:f.base,token:f.configured.token,hostInstallId:'host-cli',hostLabel:'fixture-host',schedulerId:'actual-fixture-scheduler'}),{mode:0o600});
  const before=await f.server.portal.library.records(f.session.user,f.book.bookId);
  assert.equal((await runDailyHost(['--config',file,'connect'])).status,'connected');
  const requested=await fetch(f.base+'/api/library/daily-reading/test',{method:'POST',headers:{...headers(f.session),Origin:f.base},body:'{}'});assert.equal(requested.status,200);
  const event=await requested.json(),claim=await runDailyHost(['--config',file,'claim','--event',event.event.id]);assert.equal(claim.status,'claimed');
  await writeFile(input,JSON.stringify({eventId:claim.event.id,claimNonce:claim.claimNonce,kind:'message',message:'从原文接着读。',quote:'Read slowly'}),{mode:0o600});
  const done=await runDailyHost(['--config',file,'finish','--input',input]);assert.equal(done.status,'delivered');assert.equal(done.card.label,'连接测试');
  const retried=await runDailyHost(['--config',file,'finish','--input',input]);assert.equal(retried.duplicate,true);assert.equal((await f.server.portal.dailyReading.view(f.session.user)).inbox.length,1);
  assert.deepEqual(await f.server.portal.library.records(f.session.user,f.book.bookId),before);
});
