import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createLibraryService} from '../server/library-service.mjs';

const module = await import('../server/reader-chat.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const alice={id:'chat-reader-a'},bob={id:'chat-reader-b'},charlie={id:'chat-reader-c'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const paragraph=(id,original)=>({id,original,translations:{},annotationIds:[],termIds:[]});
const bookFixture=()=>({
  bookId:'chat-book',contentVersion:'edition-1',visibility:'private',title:{zh:'阅读样本',en:'Reading fixture'},author:'Test author',
  source:{format:'txt',sha256:'edition-1'},
  chapters:[{id:'front',kind:'front_matter',number:0,title:{zh:'扉页'}},{id:'ch1',kind:'body',number:1,title:{zh:'第一章'}},{id:'ch2',kind:'body',number:2,title:{zh:'第二章'}}],
  sections:[
    {number:0,chapterId:'front',paragraphs:[paragraph('front-p','A title page.')]},
    {number:1,chapterId:'ch1',paragraphs:[{...paragraph('p1','First source sentence.'),translations:{literal:{text:'第一句。',status:'draft',origin:'ai'},interpretive:{text:'开头提出这个意思。',status:'reviewed',origin:'ai'}}},paragraph('p2','Second source sentence.')]},
    {number:2,chapterId:'ch1',paragraphs:[paragraph('p3','Third source sentence.')]},
    {number:3,chapterId:'ch2',paragraphs:[paragraph('p4','Another chapter begins.'),paragraph('p5','A separate final sentence.')]}
  ],annotations:[{text:'PRIVATE OUTSIDE CONTEXT'}],glossary:[{text:'PRIVATE GLOSSARY'}],privateMetadata:'DO NOT SEND THIS'
});
const validAnswer=(passageId='p1',quote='First source sentence.',summary='这里解释当前原文的意思。')=>({verdict:'consistent',summary,segments:[],sourceRefs:[{passageId,quote}]});
const input=(patch={})=>({id:'question-1',passageId:'p1',text:'  这里为什么这样说？  ',contentVersion:'edition-1',...patch});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const status=n=>error=>error.status===n;
const sharedStore=({replay=false}={})=>{
  const values=new Map(),queues=new Map();
  return {
    async read(file,fallback){return structuredClone(values.has(file)?values.get(file):fallback);},
    async mutate(file,fallback,operation){
      const prior=queues.get(file)||Promise.resolve();
      const work=prior.catch(()=>{}).then(async()=>{const data=await this.read(file,fallback);if(replay)await operation(structuredClone(data));const result=await operation(data);values.set(file,structuredClone(data));return structuredClone(result);});
      queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
    }
  };
};
async function within(promise,ms,message){
  let timer;try{return await Promise.race([promise,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}
}

async function fixture(t,{generator=async()=>validAnswer(),clock=Date.now,dataStore=null,book=bookFixture()}={}){
  assert.equal(typeof module.createReaderChatService,'function','Reading chat domain service is not implemented');
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'marginalia-chat-'));
  const library=await createLibraryService({dataDir,catalogDir:null});
  const services=[];
  const seed=async(user,content=book)=>{const file=path.join(dataDir,'users',hash(user.id),'books',hash(content.bookId)+'.json');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(content));};
  await seed(alice);
  const create=async(options={})=>{const service=await module.createReaderChatService({library,dataDir,generator,clock,dataStore,...options});services.push(service);return service;};
  const service=await create();
  t.after(async()=>{for(const s of services)await s.close();await rm(dataDir,{recursive:true,force:true});});
  return {dataDir,library,service,create,seed,book};
}

test('chat opens on body text, resumes the saved anchor, and keeps independent translation states',async t=>{
  const {service,library}=await fixture(t);
  const first=await service.view(alice,'chat-book');
  assert.equal(first.available,true);assert.deepEqual(first.title,{zh:'阅读样本',en:'Reading fixture'});
  assert.deepEqual(first.context,{passageId:'p1',chapterId:'ch1',chapterTitle:{zh:'第一章'},original:'First source sentence.',literal:'第一句。',interpretive:'开头提出这个意思。',translationStatus:{literal:'draft',interpretive:'reviewed'}});
  assert.deepEqual(first.turns,[]);
  await library.saveProgress(alice,'chat-book',{passageId:'p4',chapterId:'ch2',offset:0,mode:'en',variant:'literal'});
  assert.equal((await service.view(alice,'chat-book')).context.passageId,'p4');
  const selected=await service.view(alice,'chat-book',{passageId:'p2'});
  assert.equal(selected.context.passageId,'p2');assert.equal(selected.context.literal,null);assert.equal(selected.context.interpretive,null);
  assert.deepEqual(selected.context.translationStatus,{literal:'missing',interpretive:'missing'});
  await assert.rejects(service.view(alice,'chat-book',{passageId:'invented'}),status(400));
});

test('default chat context skips the catalog source heading using the actual reading start',async t=>{
  const book=bookFixture();book.sections[1].paragraphs[0].kind='source_heading';book.chapters[1].startPassageId='p2';book.readingStart={chapterId:'ch1',passageId:'p2'};
  const {service}=await fixture(t,{book});assert.equal((await service.view(alice,'chat-book')).context.passageId,'p2');
  assert.equal((await service.view(alice,'chat-book',{passageId:'p1'})).context.passageId,'p1');
});

test('every chat operation rejects guests and anonymous identities before opening a book',async t=>{
  const {service}=await fixture(t);
  for(const user of [null,{}, {id:''},{id:'  '},{id:'anonymous',is_anonymous:true}]){
    await assert.rejects(service.view(user,'chat-book'),status(401));
    await assert.rejects(service.send(user,'chat-book',input()),status(401));
    await assert.rejects(service.cancel(user,'chat-book','question-1'),status(401));
  }
});

test('existing authenticated local sessions can use the same isolated chat service',async t=>{
  const {service,seed}=await fixture(t);const local={id:'local-owner',kind:'local'};await seed(local);
  assert.equal((await service.send(local,'chat-book',input())).status,'completed');
});

test('private access and chat history stay within the authenticated account',async t=>{
  const {service,seed,library,dataDir}=await fixture(t);
  await assert.rejects(service.view(bob,'chat-book'),status(404));
  await assert.rejects(service.send(bob,'chat-book',input()),status(404));
  await assert.rejects(service.cancel(bob,'chat-book','question-1'),status(404));
  await service.send(alice,'chat-book',input());await seed(bob);
  assert.deepEqual((await service.view(bob,'chat-book')).turns,[]);
  await service.send(bob,'chat-book',input({text:'另一位读者的原话'}));
  assert.equal((await service.view(alice,'chat-book')).turns[0].text,'  这里为什么这样说？  ');
  assert.equal((await library.records(bob,'chat-book')).questions[0].text,'另一位读者的原话');
  const saved=JSON.parse(await readFile(path.join(dataDir,'users',hash(alice.id),'chat',hash('chat-book')+'.json'),'utf8'));
  assert.equal(saved.turns[0].text,'  这里为什么这样说？  ');
});

test('the original question is durable and exportable before generation starts, with AI attribution separate',async t=>{
  let service,library,calls=0;
  const setup=await fixture(t,{generator:async job=>{
    calls++;assert.equal(job.kind,'explain');assert.ok(job.runId);assert.ok(job.signal instanceof AbortSignal);
    const view=await service.view(alice,'chat-book');assert.equal(view.turns[0].status,'running');assert.equal(view.turns[0].answer,null);
    const records=await library.records(alice,'chat-book');assert.equal(records.questions[0].id,'chat-question-1');assert.equal(records.questions[0].origin,'user');assert.equal(records.questions[0].text,'  这里为什么这样说？  ');
    return validAnswer();
  }});({service,library}=setup);
  const turn=await service.send(alice,'chat-book',input());
  assert.equal(calls,1);assert.equal(turn.origin,'user');assert.equal(turn.text,'  这里为什么这样说？  ');assert.equal(turn.status,'completed');
  assert.deepEqual(turn.answer,{summary:'这里解释当前原文的意思。',sourceRefs:[{passageId:'p1',quote:'First source sentence.'}],origin:'ai'});
  assert.ok(Number.isFinite(Date.parse(turn.createdAt)));assert.equal(turn.contentVersion,'edition-1');
  assert.equal((await library.records(alice,'chat-book')).questions.length,1);
});

test('unconfigured generation remains readable and never creates a phantom question',async t=>{
  const {service,library}=await fixture(t,{generator:null});assert.equal(service.available,false);
  assert.equal((await service.view(alice,'chat-book')).available,false);
  await assert.rejects(service.send(alice,'chat-book',input()),status(503));
  assert.deepEqual((await library.records(alice,'chat-book')).questions,[]);
});

test('public-domain text is still readable by guests while personal chat requires a session',async t=>{
  const {dataDir,create}=await fixture(t),catalogDir=path.join(dataDir,'catalog');
  await mkdir(catalogDir);await writeFile(path.join(catalogDir,'public.txt'),'A public reading example.\n\nAnother public paragraph.');
  await writeFile(path.join(catalogDir,'manifest.json'),JSON.stringify([{id:'public-chat',file:'public.txt',title:'Public fixture',originalTitle:'Public fixture',author:'Test fixture',sourceUrl:'https://example.invalid/public'}]));
  const library=await createLibraryService({dataDir,catalogDir}),service=await create({library});
  const book=await library.getBook(null,'public-chat');assert.equal(book.visibility,'public');
  await assert.rejects(service.view(null,'public-chat'),status(401));
  await assert.rejects(service.send(null,'public-chat',input()),status(401));
  assert.equal((await service.view(alice,'public-chat')).turns.length,0);
});

test('idempotent finished submissions return the existing answer and reject changed question or anchor',async t=>{
  let calls=0;const {service,create}=await fixture(t,{generator:async()=>{calls++;return validAnswer();}});
  const first=await service.send(alice,'chat-book',input());assert.deepEqual(await service.send(alice,'chat-book',input()),first);
  const offline=await create({generator:null});assert.deepEqual(await offline.send(alice,'chat-book',input()),first);
  for(const patch of [{text:'different'},{passageId:'p2'},{contentVersion:'old-edition'}])await assert.rejects(service.send(alice,'chat-book',input(patch)),status(409));
  assert.equal(calls,1);
});

test('a second service cannot launch a duplicate or another turn while a book is running',async t=>{
  const entered=deferred(),finish=deferred();let calls=0;
  const {service,create}=await fixture(t,{generator:async()=>{calls++;entered.resolve();await finish.promise;return validAnswer();}});
  const pending=service.send(alice,'chat-book',input());await entered.promise;const other=await create();
  await assert.rejects(other.send(alice,'chat-book',input()),status(409));
  await assert.rejects(other.send(alice,'chat-book',input({id:'question-2'})),status(409));
  finish.resolve();assert.equal((await pending).status,'completed');assert.equal(calls,1);
});

test('generation receives only the selected paragraph and adjacent paragraphs of its own chapter',async t=>{
  let job;const {service}=await fixture(t,{generator:async value=>{job=value;return validAnswer('p2','Second source sentence.');}});
  await service.send(alice,'chat-book',input({passageId:'p2'}));
  assert.deepEqual(job.book.sections.flatMap(s=>s.paragraphs.map(p=>p.id)),['p1','p2','p3']);
  assert.deepEqual(job.book.chapters.map(c=>c.id),['ch1']);assert.equal(job.book.bookId,'chat-book');
  assert.ok(!JSON.stringify(job.book).includes('PRIVATE'));assert.ok(!JSON.stringify(job.book).includes('DO NOT SEND'));
  assert.ok(!JSON.stringify(job.book).includes('Another chapter'));
  let edge;const second=await fixture(t,{generator:async value=>{edge=value;return validAnswer('p3','Third source sentence.');}});
  await second.service.send(alice,'chat-book',input({passageId:'p3'}));
  assert.deepEqual(edge.book.sections.flatMap(s=>s.paragraphs.map(p=>p.id)),['p2','p3']);
});

test('oversized context cannot reach generation and an oversized neighbor is omitted whole',async t=>{
  const book=bookFixture();book.sections[1].paragraphs[0].original='界'.repeat(4000);let calls=0;
  const {service}=await fixture(t,{book,generator:async()=>{calls++;return validAnswer();}});
  await assert.rejects(service.send(alice,'chat-book',input()),status(413));assert.equal(calls,0);
  let job;const other=await fixture(t,{book,generator:async value=>{job=value;return validAnswer('p2','Second source sentence.');}});
  assert.equal((await other.service.send(alice,'chat-book',input({passageId:'p2'}))).status,'completed');
  assert.deepEqual(job.book.sections.flatMap(s=>s.paragraphs.map(p=>p.id)),['p2','p3']);
  assert.ok(Buffer.byteLength(JSON.stringify(job.book))<10000);
});

test('follow-ups carry only a small same-passage history marked as data and preserve exact user text',async t=>{
  const jobs=[];const {service}=await fixture(t,{generator:async job=>{jobs.push(job);return job.passageId==='p1'?validAnswer('p1','First source sentence.','第一个锚点的回答'):validAnswer('p2','Second source sentence.','另一段私有回答');}});
  await service.send(alice,'chat-book',input({id:'first',text:'第一个锚点的提问'}));
  await service.send(alice,'chat-book',input({id:'other',passageId:'p2',text:'另一段私有提问'}));
  const original='  继续解释这个限定。  ';const turn=await service.send(alice,'chat-book',input({id:'follow-up',text:original}));
  assert.equal(turn.text,original);const prompt=jobs[2].text;
  assert.ok(prompt.includes('第一个锚点的提问'));assert.ok(prompt.includes('第一个锚点的回答'));assert.ok(prompt.includes(original));
  assert.ok(!prompt.includes('另一段私有'));assert.ok(/资料|data/i.test(prompt));assert.ok(prompt.length<=6000);
});

test('fabricated, out-of-scope and oversized answer citations fail without exposing generator output',async t=>{
  const bad=[validAnswer('p1','invented original'),validAnswer('p4','Another chapter begins.'),{...validAnswer(),summary:'界'.repeat(4001)}, {...validAnswer(),sourceRefs:Array.from({length:20},()=>({passageId:'p1',quote:'First source sentence.'.repeat(1)})),segments:[{start:0,end:1,reason:'not allowed',sourceRef:{passageId:'p1',quote:'First'}}]}];
  for(let i=0;i<bad.length;i++){
    const {service}=await fixture(t,{generator:async()=>bad[i]});const turn=await service.send(alice,'chat-book',input());
    assert.equal(turn.status,'failed');assert.equal(turn.answer,null);assert.equal(turn.text,'  这里为什么这样说？  ');assert.ok(turn.error);assert.ok(!turn.error.includes('invented'));
  }
});

test('cancellation from another service defeats a late model answer durably',async t=>{
  const entered=deferred(),finish=deferred();const {service,create}=await fixture(t,{generator:async()=>{entered.resolve();await finish.promise;return validAnswer();}});
  const pending=service.send(alice,'chat-book',input());await entered.promise;const other=await create();
  assert.equal((await other.cancel(alice,'chat-book','question-1')).status,'cancelled');finish.resolve();
  assert.equal((await pending).status,'cancelled');const stored=(await other.view(alice,'chat-book')).turns[0];assert.equal(stored.status,'cancelled');assert.equal(stored.answer,null);
  await assert.rejects(other.cancel(alice,'chat-book','missing'),status(404));
});

for(const persistence of ['local files','shared dataStore'])test('cancelling from another service promptly aborts the generating signal with '+persistence,async t=>{
  const entered=deferred(),aborted=deferred();let signal;
  const {service,create}=await fixture(t,{dataStore:persistence==='shared dataStore'?sharedStore():null,generator:async job=>{
    signal=job.signal;entered.resolve();await new Promise(resolve=>job.signal.addEventListener('abort',()=>{aborted.resolve();resolve();},{once:true}));return validAnswer();
  }});
  const pending=service.send(alice,'chat-book',input());await entered.promise;const other=await create();
  assert.equal((await other.cancel(alice,'chat-book','question-1')).status,'cancelled');
  await within(aborted.promise,2000,'The executing service kept generating after another service persisted cancellation');
  assert.equal(signal.aborted,true);assert.equal((await pending).status,'cancelled');
  const stored=(await service.view(alice,'chat-book')).turns[0];assert.equal(stored.status,'cancelled');assert.equal(stored.answer,null);
});

test('successful generation stops cancellation polling instead of reading storage after completion',async t=>{
  const dataStore=sharedStore(),read=dataStore.read;let reads=0,signal;
  dataStore.read=async function(...args){reads++;return read.apply(this,args);};
  const {service}=await fixture(t,{dataStore,generator:async job=>{signal=job.signal;return validAnswer();}});
  assert.equal((await service.send(alice,'chat-book',input())).status,'completed');const settledReads=reads;
  await delay(1100);assert.equal(reads,settledReads);assert.equal(signal.aborted,false);
});

test('generator failure retains the original exportable question with a safe error',async t=>{
  const {service,library}=await fixture(t,{generator:async()=>{throw new Error('SECRET PROVIDER TOKEN /private/path');}});
  const turn=await service.send(alice,'chat-book',input());assert.equal(turn.status,'failed');assert.equal(turn.answer,null);
  assert.ok(!JSON.stringify(turn).includes('SECRET'));assert.ok(!JSON.stringify(turn).includes('/private/path'));
  assert.equal((await library.records(alice,'chat-book')).questions[0].text,'  这里为什么这样说？  ');
});

test('completed conversations survive restart and expired running leases release the book without accepting late answers',async t=>{
  let now=Date.parse('2026-10-15T08:00:00Z');const entered=deferred(),finish=deferred();let calls=0;
  const {service,create}=await fixture(t,{clock:()=>now,generator:async()=>{if(++calls===1)return validAnswer();entered.resolve();await finish.promise;return validAnswer();}});
  await service.send(alice,'chat-book',input());const restarted=await create();assert.equal((await restarted.view(alice,'chat-book')).turns[0].status,'completed');
  const pending=service.send(alice,'chat-book',input({id:'interrupted'}));await entered.promise;now+=91000;
  assert.equal((await restarted.view(alice,'chat-book')).turns[1].status,'failed');finish.resolve();assert.equal((await pending).status,'failed');
  const fresh=await create({generator:async()=>validAnswer()});assert.equal((await fresh.send(alice,'chat-book',input({id:'after-expiry'}))).status,'completed');
});

test('closing the service aborts its own in-flight generation and retains a cancelled question',async t=>{
  const entered=deferred();let signal;const {service}=await fixture(t,{generator:async job=>{signal=job.signal;entered.resolve();await new Promise((resolve,reject)=>job.signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true}));}});
  const pending=service.send(alice,'chat-book',input());await entered.promise;await service.close();
  assert.equal(signal.aborted,true);assert.equal((await pending).status,'cancelled');assert.equal((await service.view(alice,'chat-book')).turns[0].status,'cancelled');
});

test('the hourly quota is shared across books, survives restart and resets after the hour',async t=>{
  let now=Date.parse('2026-10-15T08:00:00Z'),calls=0;const {service,create,seed,book}=await fixture(t,{clock:()=>now,generator:async()=>{calls++;return validAnswer();}});
  await seed(alice,{...book,bookId:'second-book'});
  for(let i=0;i<10;i++)assert.equal((await service.send(alice,i%2?'second-book':'chat-book',input({id:'quota-'+i}))).status,'completed');
  const restarted=await create();await assert.rejects(restarted.send(alice,'second-book',input({id:'quota-over'})),status(429));assert.equal(calls,10);
  now+=3600001;assert.equal((await restarted.send(alice,'second-book',input({id:'quota-new-hour'}))).status,'completed');assert.equal(calls,11);
});

for(const persistence of ['local files','shared dataStore'])test('the global two-run gate spans accounts and services and releases only completed or cancelled leases with '+persistence,{timeout:12000},async t=>{
  const enteredA=deferred(),enteredB=deferred(),enteredC=deferred(),finishA=deferred(),finishB=deferred(),finishC=deferred();let calls=0;
  const wait=async(job,entered,finish)=>{entered.resolve();await Promise.race([finish.promise,new Promise(resolve=>job.signal.addEventListener('abort',resolve,{once:true}))]);};
  const {service,create,seed}=await fixture(t,{dataStore:persistence==='shared dataStore'?sharedStore():null,generator:async job=>{
    calls++;if(calls===1)await wait(job,enteredA,finishA);else if(calls===2)await wait(job,enteredB,finishB);else if(job.text.includes('hold-c'))await wait(job,enteredC,finishC);return validAnswer();
  }});
  await seed(bob);await seed(charlie);const other=await create(),third=await create();
  const pendingA=service.send(alice,'chat-book',input({id:'hold-a'}));await enteredA.promise;
  const pendingB=other.send(bob,'chat-book',input({id:'hold-b'}));await enteredB.promise;
  await assert.rejects(third.send(charlie,'chat-book',input({id:'third-rejected'})),status(429));assert.equal(calls,2);
  finishA.resolve();assert.equal((await pendingA).status,'completed');
  const pendingC=third.send(charlie,'chat-book',input({id:'hold-c',text:'hold-c'}));await enteredC.promise;
  await assert.rejects(service.send(alice,'chat-book',input({id:'still-two-running'})),status(429));assert.equal(calls,3);
  await third.cancel(bob,'chat-book','hold-b');assert.equal((await within(pendingB,2000,'The cancelled run did not release its global lease')).status,'cancelled');
  assert.equal((await service.send(alice,'chat-book',input({id:'after-cancel'}))).status,'completed');assert.equal(calls,4);
  finishC.resolve();assert.equal((await pendingC).status,'completed');
});

test('global leases expire within ninety seconds even when their execution instances never release them',async t=>{
  const start=Date.parse('2026-10-15T08:00:00Z');let now=start,calls=0;const bothEntered=deferred();
  const {service,create,seed}=await fixture(t,{clock:()=>start,dataStore:sharedStore(),generator:async job=>{
    if(++calls<=2){if(calls===2)bothEntered.resolve();await new Promise(resolve=>job.signal.addEventListener('abort',resolve,{once:true}));}return validAnswer();
  }});
  await seed(bob);await seed(charlie);const second=await create(),recovering=await create({clock:()=>now});
  const pendingA=service.send(alice,'chat-book',input({id:'stuck-a'})),pendingB=second.send(bob,'chat-book',input({id:'stuck-b'}));await bothEntered.promise;
  now=start+89999;await assert.rejects(recovering.send(charlie,'chat-book',input({id:'not-expired'})),status(429));assert.equal(calls,2);
  now=start+90001;assert.equal((await recovering.send(charlie,'chat-book',input({id:'after-expiry'}))).status,'completed');assert.equal(calls,3);
  await service.close();await second.close();await Promise.all([pendingA,pendingB]);
});

test('the shared global hourly budget stops request 101 across accounts and survives CAS callback replay',async t=>{
  let now=Date.parse('2026-10-15T08:00:00Z'),calls=0;const {service,create,seed}=await fixture(t,{clock:()=>now,dataStore:sharedStore({replay:true}),generator:async()=>{calls++;return validAnswer();}});
  const users=Array.from({length:11},(_,i)=>({id:'global-hour-reader-'+i}));for(const user of users)await seed(user);
  const other=await create();
  for(let i=0;i<100;i++)assert.equal((await (i%2?service:other).send(users[Math.floor(i/10)],'chat-book',input({id:'global-hour-'+i}))).status,'completed');
  const restarted=await create();await assert.rejects(restarted.send(users[10],'chat-book',input({id:'global-hour-over'})),status(429));assert.equal(calls,100);
  now+=3600001;assert.equal((await restarted.send(users[10],'chat-book',input({id:'global-new-hour'}))).status,'completed');assert.equal(calls,101);
});

test('the shared global daily budget stops request 501 while fresh hourly and owner budgets remain available',async t=>{
  const start=Date.parse('2026-10-15T08:00:00Z');let now=start,calls=0;const {service,create,seed}=await fixture(t,{clock:()=>now,dataStore:sharedStore(),generator:async()=>{calls++;return validAnswer();}});
  const users=Array.from({length:10},(_,i)=>({id:'global-day-reader-'+i}));for(const user of users)await seed(user);await seed(charlie);
  const other=await create();
  for(let hour=0;hour<5;hour++){now=start+hour*3600001;for(let i=0;i<100;i++)assert.equal((await (i%2?service:other).send(users[i%10],'chat-book',input({id:'global-day-'+hour+'-'+i}))).status,'completed');}
  now=start+5*3600001;const restarted=await create();await assert.rejects(restarted.send(charlie,'chat-book',input({id:'global-day-over'})),status(429));assert.equal(calls,500);
  now+=86400001;assert.equal((await restarted.send(charlie,'chat-book',input({id:'global-new-day'}))).status,'completed');assert.equal(calls,501);
});

test('invalid IDs, question sizes, anchors and versions never invoke the generator',async t=>{
  let calls=0;const {service}=await fixture(t,{generator:async()=>{calls++;return validAnswer();}});
  for(const patch of [{id:'../escape'},{id:'x'.repeat(121)},{id:''},{text:''},{text:' '},{text:'界'.repeat(2001)},{text:'\ud800'},{passageId:'missing'},{contentVersion:undefined}])await assert.rejects(service.send(alice,'chat-book',input(patch)),status(400));
  await assert.rejects(service.send(alice,'chat-book',input({contentVersion:'old'})),status(409));
  await assert.rejects(service.cancel(alice,'chat-book','../escape'),status(400));assert.equal(calls,0);
});

test('a full conversation keeps its original turns and refuses another paid run',async t=>{
  let calls=0;const {dataDir,service}=await fixture(t,{generator:async()=>{calls++;return validAnswer();}});
  const file=path.join(dataDir,'users',hash(alice.id),'chat',hash('chat-book')+'.json');await mkdir(path.dirname(file),{recursive:true});
  const turns=Array.from({length:100},(_,i)=>({id:'saved-'+i,passageId:'p1',contentVersion:'edition-1',text:'保留的提问 '+i,origin:'user',createdAt:'2026-10-15T08:00:00.000Z',status:'completed',answer:{summary:'保留的回答',origin:'ai',sourceRefs:[{passageId:'p1',quote:'First source sentence.'}]}}));
  await writeFile(file,JSON.stringify({kind:'marginalia-reader-chat',schemaVersion:1,bookId:'chat-book',turns}));
  await assert.rejects(service.send(alice,'chat-book',input()),status(413));assert.equal(calls,0);
  const retained=(await service.view(alice,'chat-book')).turns;assert.equal(retained.length,100);assert.equal(retained[0].text,'保留的提问 0');
});

test('a changed source during generation cannot publish an answer against the old edition',async t=>{
  const entered=deferred(),finish=deferred();const {service,seed,book}=await fixture(t,{generator:async()=>{entered.resolve();await finish.promise;return validAnswer();}});
  const pending=service.send(alice,'chat-book',input());await entered.promise;
  const changed=structuredClone(book);changed.sections[1].paragraphs[0].original='A corrected original with the same stable paragraph ID.';await seed(alice,changed);
  finish.resolve();const turn=await pending;assert.equal(turn.status,'failed');assert.equal(turn.answer,null);assert.equal(turn.passageId,'p1');
});

test('a process interrupted before writing its lock owner does not leave chat locked forever',async t=>{
  const {dataDir,service}=await fixture(t),file=path.join(dataDir,'users',hash(alice.id),'chat',hash('chat-book')+'.json.lock');
  await mkdir(file,{recursive:true});const old=new Date(Date.now()-40000);await utimes(file,old,old);
  assert.equal((await service.send(alice,'chat-book',input())).status,'completed');
});

test('CAS retries cannot repeat generation or duplicate the original question',async t=>{
  const values=new Map(),versions=new Map();let retried=false,calls=0;
  const dataStore={
    async read(file,fallback){return structuredClone(values.has(file)?values.get(file):fallback);},
    async mutate(file,fallback,operation){for(;;){const version=versions.get(file)||0,data=await this.read(file,fallback);if(!retried){retried=true;await operation(structuredClone(data));}const result=await operation(data);await Promise.resolve();if((versions.get(file)||0)!==version)continue;values.set(file,structuredClone(data));versions.set(file,version+1);return structuredClone(result);}}
  };
  const {service,library,create}=await fixture(t,{dataStore,generator:async()=>{calls++;return validAnswer();}});
  await service.send(alice,'chat-book',input());const other=await create();assert.equal((await other.send(alice,'chat-book',input())).status,'completed');
  assert.equal(calls,1);assert.equal((await library.records(alice,'chat-book')).questions.length,1);assert.equal((await other.view(alice,'chat-book')).turns.length,1);assert.equal(retried,true);
});

test('separate Node processes atomically claim one model run for the same owner and book',{timeout:12000},async t=>{
  const {dataDir}=await fixture(t);const serviceUrl=new URL('../server/reader-chat.mjs',import.meta.url).href,libraryUrl=new URL('../server/library-service.mjs',import.meta.url).href;
  const staleLock=path.join(dataDir,'users',hash(alice.id),'chat',hash('chat-book')+'.json.lock');await mkdir(staleLock,{recursive:true});const old=new Date(Date.now()-40000);await utimes(staleLock,old,old);
  const script=`import {appendFile} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';import {createReaderChatService} from ${JSON.stringify(serviceUrl)};import {createLibraryService} from ${JSON.stringify(libraryUrl)};const dataDir=process.env.CHAT_TEST_DIR;const library=await createLibraryService({dataDir,catalogDir:null});const service=await createReaderChatService({library,dataDir,generator:async()=>{await appendFile(dataDir+'/model-calls','called\\n');await delay(700);return ${JSON.stringify(validAnswer())};}});try{const turn=await service.send(${JSON.stringify(alice)},'chat-book',${JSON.stringify(input())});console.log(JSON.stringify({status:turn.status}));}catch(error){console.log(JSON.stringify({status:error.status}));}finally{await service.close();}`;
  const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','--eval',script],{env:{...process.env,CHAT_TEST_DIR:dataDir}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));});
  const results=await Promise.all([run(),run()]);assert.deepEqual(results.map(r=>r.status).sort((a,b)=>String(a).localeCompare(String(b))),[409,'completed']);
  assert.equal((await readFile(path.join(dataDir,'model-calls'),'utf8')).trim(),'called');
});
