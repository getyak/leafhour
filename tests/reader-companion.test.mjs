import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createReaderCompanionService} from '../server/reader-companion.mjs';
const user={id:'reader'},other={id:'other'};
const book={bookId:'one',contentVersion:'v1',title:{en:'Fixture'},chapters:[{id:'ch1',kind:'body',title:'One'},{id:'ch2',kind:'body',title:'Two'}],sections:[{chapterId:'ch1',number:1,paragraphs:Array.from({length:8},(_,i)=>({id:'p'+(i+1),original:'Source sentence '+(i+1)+'.',translations:{},annotationIds:[],termIds:[]}))},{chapterId:'ch2',number:2,paragraphs:[{id:'future',original:'SECRET ENDING',translations:{}}]}],glossary:[],annotations:[],privateMetadata:'PRIVATE'};
async function fixture(t,generate=async()=>({kind:'message',text:'前面那段和这里放在一起，倒多了一种理解。',sourcePassageIds:['p1','p2']})){
  const dataDir=await mkdtemp(path.join(tmpdir(),'squirrel-domain-'));let now=1700000000000;const jobs=[],questions=[];
  const library={async getBook(u,id){if(u.id!==user.id||id!=='one')throw Object.assign(Error('missing'),{status:404});return structuredClone(book);},async records(){return {questions,position:null};},async addComment(u,id,value){questions.push(value);}};
  const options={library,dataDir,clock:()=>now,generator:async job=>{jobs.push(job);return {kind:'conversation',summary:'继续聊。'};},companionGenerator:async job=>{jobs.push(job);return generate(job);}};
  const services=[await createReaderChatService(options)],service=services[0];
  t.after(async()=>{for(const s of services)await s.close();await rm(dataDir,{recursive:true,force:true});});
  const config=()=>service.companion.configure(user,'one',{enabled:true,contentVersion:'v1'});
  let meta;
  const start=async()=>meta=await config();
  const observe=async(p,active=true)=>{now+=8000;meta=await service.companion.observe(user,'one',{revision:meta.revision,contentVersion:'v1',sessionId:meta.sessionId,passageId:p,active});return meta;};
  const read=async(p,n=7)=>{let value;for(let i=0;i<n;i++)value=await observe(p);return value;};
  const ready=async()=>{await start();await read('p1');await read('p2');};
  const send=(id='companion-1',p='p2')=>service.companion.generate(user,'one',{id,revision:meta.revision,contentVersion:'v1',sessionId:meta.sessionId,passageId:p});
  return {service,options,services,jobs,questions,start,read,ready,send,observe,advance:ms=>now+=ms,meta:()=>meta};
}
test('companion is opt-in and rejects anonymous other-account stale and unobserved source access',async t=>{
  const f=await fixture(t);assert.equal((await f.service.companion.view(user,'one')).enabled,false);
  await assert.rejects(f.service.companion.view(other,'one'),e=>e.status===404);
  await assert.rejects(f.service.companion.view({id:'anon',is_anonymous:true},'one'),e=>e.status===401);
  await f.start();await assert.rejects(f.send(),e=>e.status===409);assert.equal(f.jobs.length,0);
  await assert.rejects(f.service.companion.observe(user,'one',{revision:0,contentVersion:'v1',passageId:'future',active:true}),e=>e.status===409);
});
test('canonical bounded observed context produces one AI message without user questions or private notes',async t=>{
  const f=await fixture(t);await f.ready();const message=await f.send();assert.equal(message.kind,'companion');assert.equal(message.origin,'ai');assert.equal(message.text,null);assert.equal(message.status,'completed');
  assert.equal(f.questions.length,0);assert.equal(f.jobs.length,1);const encoded=JSON.stringify(f.jobs[0]);assert.ok(!encoded.includes('SECRET ENDING'));assert.ok(!encoded.includes('PRIVATE'));assert.ok(encoded.includes('Source sentence 1.'));
  assert.equal((await f.send()).id,message.id);assert.equal(f.jobs.length,1);
  const view=await f.service.view(user,'one');assert.equal(view.turns.length,1);assert.equal(view.turns[0].origin,'ai');
  await f.service.send(user,'one',{id:'reply',passageId:'p2',contentVersion:'v1',text:'接着说说'});
  assert.deepEqual(f.jobs[1].history,[{role:'assistant',content:message.answer.summary}]);assert.equal(f.questions.length,1);
});
test('five minute server cooldown and new observed material cannot be bypassed by reopening',async t=>{
  const f=await fixture(t);await f.ready();await f.send();await f.start();await f.read('p3');await f.read('p4');await f.read('p5');
  await assert.rejects(f.send('second','p5'),e=>e.status===409||e.status===429);assert.equal(f.jobs.length,1);
  await f.read('p5',17);assert.equal((await f.send('second','p5')).status,'completed');assert.equal(f.jobs.length,2);
});
test('silence consumes an opportunity without creating a visible fake answer',async t=>{
  const f=await fixture(t,async()=>({kind:'silence'}));await f.ready();assert.equal((await f.send()).status,'silent');
  assert.equal((await f.service.view(user,'one')).turns.length,0);assert.equal(f.questions.length,0);await assert.rejects(f.send('again'),e=>e.status===409||e.status===429);
});
test('disable in another service instance invalidates a late result across the shared store',async t=>{
  let resolve;const pending=new Promise(r=>resolve=r);const f=await fixture(t,()=>pending);await f.ready();
  const second=await createReaderChatService(f.options);f.services.push(second);const generated=f.send();while(!f.jobs.length)await new Promise(r=>setTimeout(r,5));
  await second.companion.configure(user,'one',{enabled:false,contentVersion:'v1'});resolve({kind:'message',text:'迟到的消息',sourcePassageIds:['p1']});
  const result=await generated;assert.notEqual(result.status,'completed');assert.equal((await f.service.view(user,'one')).turns.length,0);
});
test('invalid source references and invented quotations never publish a bubble',async t=>{
  for(const answer of [{kind:'message',text:'后面的结局。',sourcePassageIds:['future']},{kind:'message',text:'作者写了“根本不存在的引文”。',sourcePassageIds:['p1']}]){
    const f=await fixture(t,async()=>answer);await f.ready();assert.equal((await f.send()).status,'failed');assert.equal((await f.service.view(user,'one')).turns.length,0);
  }
});
test('two service instances cannot generate the same candidate twice',async t=>{
  let resolve;const pending=new Promise(r=>resolve=r),f=await fixture(t,()=>pending);await f.ready();const second=await createReaderChatService(f.options);f.services.push(second);
  const a=f.send();while(!f.jobs.length)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(second.companion.generate(user,'one',{id:'companion-1',passageId:'p2',contentVersion:'v1',revision:f.meta().revision,sessionId:f.meta().sessionId}),e=>e.status===409);
  resolve({kind:'silence'});await a;assert.equal(f.jobs.length,1);
});
test('inactive heartbeats do not prevent a new reading session after thirty minutes',async t=>{
  const f=await fixture(t,async()=>({kind:'silence'}));await f.ready();await f.send();
  for(const [id,passages]of [['second',['p3','p4','p5']],['third',['p6','p7','p8']]]){for(const p of passages)await f.read(p,13);await f.send(id,passages.at(-1));}
  const previous=f.meta().sessionId;assert.equal((await f.service.companion.view(user,'one')).attempts,3);
  for(let i=0;i<230;i++)await f.observe('p8',false);
  const next=await f.service.companion.view(user,'one');assert.notEqual(next.sessionId,previous);assert.equal(next.attempts,0);assert.ok(next.observedIds.includes('p1'),'recent prior context survives a new session');
});
for(const gateAt of ['quota','authorization'])test('a persisted close during '+gateAt+' admission prevents dispatch on another instance',async()=>{
  let now=1700000000000,release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);let calls=0;const data={turns:[]};
  const options={bookFor:async()=>structuredClone(book),mutateBook:async(u,b,operation)=>structuredClone(await operation(data)),clock:()=>now,generator:async()=>{calls++;return {kind:'silence'};},quota:async()=>{if(gateAt==='quota'){entered();await waiting;}},reserveGlobal:async()=>({nonce:'fixture'}),releaseGlobal:async()=>{},watchRun:()=>()=>{},active:new Map(),publicTurn:t=>structuredClone(t),conversationHistory:()=>[],cancel:async()=>{},getClosed:()=>false};
  const first=createReaderCompanionService(options),second=createReaderCompanionService({...options,active:new Map()});let meta=await first.configure(user,'one',{enabled:true,contentVersion:'v1'});
  for(const passageId of ['p1','p2'])for(let i=0;i<7;i++){now+=8000;meta=await first.observe(user,'one',{revision:meta.revision,sessionId:meta.sessionId,contentVersion:'v1',passageId,active:true});}
  const pending=first.generate(user,'one',{id:'admission-race',revision:meta.revision,sessionId:meta.sessionId,contentVersion:'v1',passageId:'p2'},{authorize:async()=>{if(gateAt==='authorization'){entered();await waiting;}return true;}});await started;
  await second.configure(user,'one',{enabled:false,contentVersion:'v1'});release();assert.equal((await pending).status,'cancelled');assert.equal(calls,0);
});
test('revoked request authorization cancels a model result instead of publishing it',async t=>{
  let finish,allowed=true;const pending=new Promise(r=>finish=r),f=await fixture(t,()=>pending);await f.ready();
  const m=f.meta(),generated=f.service.companion.generate(user,'one',{id:'auth-revoked',revision:m.revision,sessionId:m.sessionId,contentVersion:'v1',passageId:'p2'},{authorize:async()=>allowed});
  while(!f.jobs.length)await new Promise(r=>setTimeout(r,5));allowed=false;finish({kind:'message',text:'这条不应发布。',sourcePassageIds:['p1']});
  assert.equal((await generated).status,'cancelled');assert.equal((await f.service.view(user,'one')).turns.length,0);
});
