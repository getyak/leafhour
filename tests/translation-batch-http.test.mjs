import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {realpathSync} from 'node:fs';
const testTmpdir=()=>realpathSync(tmpdir());
import path from 'node:path';
import http from 'node:http';
import {createReaderServer} from '../server/server.mjs';
import {fail,digest} from '../server/document-import.mjs';
import {runBatch,createTransport} from '../tools/lib/translation-batch.mjs';

const stamp='2026-10-18T00:00:00.000Z';
async function start(t,{translator}={}){
  const dir=await mkdtemp(path.join(testTmpdir(),'translation-batch-http-'));
  const codes=new Map(),calls=[];
  const provider=translator||(async context=>{calls.push(context.passageId);return {literal:'合成直译 '+context.passageId,interpretive:'合成意译 '+context.passageId,model:'synthetic'};});
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:async(email,code)=>{codes.set(email,code);},translator:provider,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const account=async email=>{await server.portal.auth.requestCode(email);return server.portal.auth.verifyCode(email,codes.get(email));};
  return {dir,server,base,account,calls};
}
const importBook=(server,user,paragraphs)=>server.portal.library.importDocument(user,{filename:'batch.txt',bytes:Buffer.from(paragraphs.join('\n\n'))});
const bookFile=(dir,user,bookId)=>path.join(dir,'portal','library','users',digest(user.id),'books',digest(bookId)+'.json');
const overlayFile=(dir,user,bookId)=>path.join(dir,'portal','library','users',digest(user.id),'translations',digest(bookId)+'.json');

test('a dry run plans from the real local HTTP library, generates nothing and writes no checkpoint',async t=>{
  const {base,account,server,calls,dir}=await start(t),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['First source paragraph.','Second source paragraph.','Third source paragraph.']);
  const checkpoint=path.join(dir,'checkpoint','batch.json');
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:false,checkpointFile:checkpoint});
  assert.equal(summary.mode,'dry-run');assert.equal(summary.requests,0);
  assert.deepEqual(summary.eligible,book.sections[0].paragraphs.map(p=>p.id),'the plan follows source order');
  assert.equal(summary.remaining,3);
  assert.deepEqual(calls,[],'a dry run never generates');
  await assert.rejects(stat(checkpoint),e=>e.code==='ENOENT','no checkpoint file');
  await assert.rejects(stat(path.dirname(checkpoint)),e=>e.code==='ENOENT','no checkpoint directory');
});

test('explicit bounded serial execution follows source order, stops at the bound and records a private non-secret checkpoint',async t=>{
  let inFlight=0,maxInFlight=0;
  const provider=async context=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(resolve=>setTimeout(resolve,5));inFlight--;return {literal:'合成直译 '+context.passageId,interpretive:'合成意译 '+context.passageId,model:'synthetic'};};
  const {base,account,server,dir}=await start(t,{translator:provider}),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.','Three source paragraph.','Four source paragraph.']);
  const ids=book.sections[0].paragraphs.map(p=>p.id),checkpoint=path.join(dir,'checkpoint','batch.json');
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:2,checkpointFile:checkpoint});
  assert.equal(summary.requests,2);assert.equal(summary.stopped,'limit');assert.equal(summary.remaining,2);
  assert.deepEqual(summary.entries.map(e=>[e.id,e.state]),[[ids[0],'saved'],[ids[1],'saved']]);
  assert.equal(maxInFlight,1,'requests stay serial');
  const reread=await server.portal.library.getBook(session.user,book.bookId);
  assert.deepEqual(reread.sections[0].paragraphs.slice(0,2).map(p=>p.translations.literal.text),['合成直译 '+ids[0],'合成直译 '+ids[1]]);
  assert.deepEqual(reread.sections[0].paragraphs[2].translations,{},'the bound is never silently exceeded');
  const stored=JSON.parse(await readFile(checkpoint,'utf8')),raw=await readFile(checkpoint,'utf8');
  assert.equal(stored.entries[ids[0]].state,'saved');
  assert.ok(!raw.includes(session.token),'the session token never enters the checkpoint');
  assert.ok(!raw.includes('One source paragraph.'),'original text never enters the checkpoint');
  assert.ok(!raw.includes('合成直译'),'translations never enter the checkpoint');
  assert.equal((await stat(checkpoint)).mode&0o777,0o600);
  assert.equal((await stat(path.dirname(checkpoint))).mode&0o777,0o700);
});

test('resuming reconciles saved translations from the server and never duplicates generation',async t=>{
  const {base,account,server,dir,calls}=await start(t),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.','Three source paragraph.','Four source paragraph.']);
  const ids=book.sections[0].paragraphs.map(p=>p.id),checkpoint=path.join(dir,'checkpoint','batch.json');
  await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:2,checkpointFile:checkpoint});
  assert.equal(calls.length,2,'the first bounded run generated exactly two passages');
  const stored=JSON.parse(await readFile(checkpoint,'utf8'));
  // A crash after server success loses the acknowledgement of the first requests.
  stored.entries[ids[0]]={state:'unknown',reason:'timeout',attempts:1,updatedAt:stamp};
  stored.entries[ids[1]]={state:'failed',reason:'http-502',attempts:1,updatedAt:stamp};
  await writeFile(checkpoint,JSON.stringify(stored));
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:20,checkpointFile:checkpoint});
  assert.equal(summary.requests,2,'reconciled entries are not regenerated');
  assert.deepEqual(summary.entries.map(e=>e.id),[ids[2],ids[3]]);
  assert.equal(summary.stopped,null);
  assert.equal(calls.length,4,'no passage is ever generated twice');
  const after=JSON.parse(await readFile(checkpoint,'utf8'));
  assert.deepEqual([after.entries[ids[0]].state,after.entries[ids[0]].reason],['saved','reconciled']);
  assert.deepEqual([after.entries[ids[1]].state,after.entries[ids[1]].reason],['saved','reconciled']);
});

test('a failed request records its stable ID and reason, stops without looping and stays retryable',async t=>{
  let broken=true;
  const provider=async context=>{if(broken&&context.passageId.endsWith('2'))throw fail('合成失败',502);return {literal:'合成直译 '+context.passageId,interpretive:'合成意译 '+context.passageId,model:'synthetic'};};
  const {base,account,server,dir}=await start(t,{translator:provider}),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.','Three source paragraph.']);
  const ids=book.sections[0].paragraphs.map(p=>p.id),checkpoint=path.join(dir,'checkpoint','batch.json');
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:checkpoint});
  assert.equal(summary.requests,2,'the run stops at the first failure and never auto-loops');
  assert.deepEqual(summary.entries,[{id:ids[0],state:'saved'},{id:ids[1],state:'failed',reason:'http-502'}]);
  assert.equal(summary.stopped,'failure');assert.equal(summary.remaining,2);
  const stored=JSON.parse(await readFile(checkpoint,'utf8'));
  assert.deepEqual([stored.entries[ids[1]].state,stored.entries[ids[1]].reason,stored.entries[ids[1]].attempts],['failed','http-502',1]);
  broken=false;
  const retried=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:checkpoint});
  assert.equal(retried.requests,2,'the failed passage is retried, the saved one is not');
  assert.deepEqual(retried.entries.map(e=>e.id),[ids[1],ids[2]]);
  assert.equal(retried.stopped,null);
  assert.equal(JSON.parse(await readFile(checkpoint,'utf8')).entries[ids[1]].attempts,2);
});

test('checkpoints stay bound to the account, origin and source version that created them',async t=>{
  const first=await start(t),sessionA=await first.account('reader-a@example.test'),sessionB=await first.account('reader-b@example.test');
  const book=await importBook(first.server,sessionA.user,['One source paragraph.','Two source paragraph.']);
  const ids=book.sections[0].paragraphs.map(p=>p.id),checkpoint=path.join(first.dir,'checkpoint','batch.json');
  await runBatch({origin:first.base,bookId:book.bookId,session:sessionA.token,execute:true,maxRequests:1,checkpointFile:checkpoint});
  await assert.rejects(runBatch({origin:first.base,bookId:book.bookId,session:sessionB.token,execute:true,maxRequests:1,checkpointFile:checkpoint}),{code:'binding-mismatch'},'another account never continues a foreign checkpoint');
  const second=await start(t),sessionA2=await second.account('reader-a@example.test');
  await assert.rejects(runBatch({origin:second.base,bookId:book.bookId,session:sessionA2.token,execute:true,maxRequests:1,checkpointFile:checkpoint}),{code:'binding-mismatch'},'another origin never continues a foreign checkpoint');
  // A source revision invalidates the binding before any further generation.
  const file=bookFile(first.dir,sessionA.user,book.bookId),current=JSON.parse(await readFile(file,'utf8'));
  current.contentVersion='edition-2';current.sections[0].paragraphs[0].original='One revised source paragraph.';
  await writeFile(file,JSON.stringify(current));
  await assert.rejects(runBatch({origin:first.base,bookId:book.bookId,session:sessionA.token,execute:true,maxRequests:1,checkpointFile:checkpoint}),{code:'binding-mismatch'});
  assert.equal(first.calls.length+second.calls.length,1,'every refusal happens without a provider request');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(checkpoint,'utf8')).entries),[ids[0]]);
});

test('stale source versions are rejected before generation and old overlays never publish',async t=>{
  const {base,account,server}=await start(t),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.']);
  const ids=book.sections[0].paragraphs.map(p=>p.id);
  const headers={Cookie:'marginalia_session='+session.token,Origin:base,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/library/books/'+book.bookId+'/translate',{method:'POST',headers,body:JSON.stringify({passageId:ids[0],contentVersion:'stale-version'})})).status,409);
  assert.deepEqual((await server.portal.library.getBook(session.user,book.bookId)).sections[0].paragraphs[0].translations,{},'a stale version is rejected before any provider request');
  // A dedicated server whose provider updates the source while generation is in flight.
  let target=null;
  const provider=async context=>{
    const current=JSON.parse(await readFile(target,'utf8'));current.contentVersion='edition-2';current.sections[0].paragraphs[0].original='One revised source paragraph.';await writeFile(target,JSON.stringify(current));
    return {literal:'过期直译',interpretive:'过期意译'};
  };
  const dedicated=await start(t,{translator:provider}),session2=await dedicated.account('reader-c@example.test');
  const book2=await importBook(dedicated.server,session2.user,['One source paragraph.','Two source paragraph.']);
  const ids2=book2.sections[0].paragraphs.map(p=>p.id);target=bookFile(dedicated.dir,session2.user,book2.bookId);
  const headers2={Cookie:'marginalia_session='+session2.token,Origin:dedicated.base,'Content-Type':'application/json'};
  const response=await fetch(dedicated.base+'/api/library/books/'+book2.bookId+'/translate',{method:'POST',headers:headers2,body:JSON.stringify({passageId:ids2[0],contentVersion:book2.contentVersion})});
  assert.equal(response.status,409,'a source update during generation is refused at save time');
  const latest=await dedicated.server.portal.library.getBook(session2.user,book2.bookId);
  assert.equal(latest.contentVersion,'edition-2');
  assert.deepEqual(latest.sections[0].paragraphs[0].translations,{},'the old overlay never publishes onto the new source');
  assert.deepEqual(JSON.parse(await readFile(overlayFile(dedicated.dir,session2.user,book2.bookId),'utf8').catch(()=>'{}')),{},'nothing stale is written');
});

test('a source change between requests stops the batch before the next request',async t=>{
  let target=null;
  const {base,account,server,dir}=await start(t),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.']);
  target=bookFile(dir,session.user,book.bookId);
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:path.join(dir,'checkpoint','batch.json'),log:async message=>{
    if(message.startsWith('saved ')){const current=JSON.parse(await readFile(target,'utf8'));current.contentVersion='edition-2';await writeFile(target,JSON.stringify(current));}
  }});
  assert.equal(summary.requests,1);
  assert.equal(summary.stopped,'source-changed');
  const latest=await server.portal.library.getBook(session.user,book.bookId);
  assert.equal(latest.contentVersion,'edition-2');
  assert.deepEqual(latest.sections[0].paragraphs[0].translations,{},'a result saved for the old source never publishes onto the new one');
});

test('partial and reviewed translations are reported and never overwritten or completed',async t=>{
  const {base,account,server,dir}=await start(t),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.','Three source paragraph.']);
  const ids=book.sections[0].paragraphs.map(p=>p.id),overlay=overlayFile(dir,session.user,book.bookId);
  const version=book.contentVersion;
  const saved=(text,status)=>({text,status,origin:'ai',sourceVersion:version,createdAt:stamp});
  await mkdir(path.dirname(overlay),{recursive:true,mode:0o700});
  await writeFile(overlay,JSON.stringify({
    [ids[0]]:{contentVersion:version,translations:{literal:{...saved('只有直译草稿','draft'),variant:'literal'}}},
    [ids[1]]:{contentVersion:version,translations:{literal:{...saved('人工复核直译','reviewed'),variant:'literal'},interpretive:{...saved('人工复核意译','reviewed'),variant:'interpretive'}}}
  }));
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:path.join(dir,'checkpoint','batch.json')});
  assert.equal(summary.requests,1,'only fully untranslated paragraphs are generated');
  assert.deepEqual(summary.skipped.map(row=>[row.id,row.reason]),[[ids[0],'partial'],[ids[1],'reviewed']]);
  const reread=await server.portal.library.getBook(session.user,book.bookId);
  assert.deepEqual(reread.sections[0].paragraphs[0].translations.literal,{...saved('只有直译草稿','draft'),variant:'literal'},'the saved draft is untouched');
  assert.equal(reread.sections[0].paragraphs[0].translations.interpretive,undefined,'a missing version is never filled by replacing the other');
  assert.equal(reread.sections[0].paragraphs[1].translations.literal.text,'人工复核直译');
  assert.equal(reread.sections[0].paragraphs[1].translations.interpretive.text,'人工复核意译');
});

test('concurrent execution on one checkpoint is refused while the first run is working',async t=>{
  let release,entered;
  const hold=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const provider=async context=>{entered();await hold;return {literal:'合成直译 '+context.passageId,interpretive:'合成意译 '+context.passageId,model:'synthetic'};};
  const {base,account,server,dir}=await start(t,{translator:provider}),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.']);
  const checkpoint=path.join(dir,'checkpoint','batch.json');
  const first=runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:checkpoint});
  await started;
  await assert.rejects(runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:checkpoint}),{code:'locked'});
  release();
  const summary=await first;
  assert.equal(summary.requests,2);
  assert.deepEqual(Object.values(JSON.parse(await readFile(checkpoint,'utf8')).entries).map(e=>e.state),['saved','saved']);
});

test('redirects, oversized responses and timeouts are refused honestly',async t=>{
  const redirect=http.createServer((req,res)=>{res.statusCode=302;res.setHeader('Location','http://127.0.0.1:1/steal');res.end();});
  const oversized=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({user:{id:'x'},pad:'甲'.repeat(1024*1024)}));});
  const silent=http.createServer(()=>{});
  const missing=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({user:null}));});
  for(const server of [redirect,oversized,silent,missing])await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const server of [redirect,oversized,silent,missing])await new Promise(r=>server.close(r));});
  const origin=server=>'http://127.0.0.1:'+server.address().port;
  await assert.rejects(createTransport({origin:origin(redirect),session:'token'}).sessionUser(),{code:'redirect-refused'});
  await assert.rejects(createTransport({origin:origin(oversized),session:'token'}).sessionUser(),{code:'oversized-response'});
  await assert.rejects(createTransport({origin:origin(silent),session:'token',timeoutMs:150}).sessionUser(),{code:'timeout'});
  await assert.rejects(createTransport({origin:origin(missing),session:'token'}).sessionUser(),{code:'session'});
});

test('large books arrive through the bounded transfer parts and still plan correctly',async t=>{
  const {base,account,server,dir}=await start(t),session=await account('reader-a@example.test');
  const paragraphs=Array.from({length:700},(_,i)=>'Paragraph '+i+' '+String.fromCharCode(97+(i%26)).repeat(5000));
  const book=await importBook(server,session.user,paragraphs);
  assert.ok(Buffer.byteLength(JSON.stringify(book))>3000000,'this fixture must exceed the single-response threshold');
  let partRequests=0;
  const transport=createTransport({origin:base,session:session.token,fetchImpl:(url,options)=>{if(String(url).includes('content-part'))partRequests++;return fetch(url,options);}});
  await transport.sessionUser();
  const assembled=await transport.getBook(book.bookId);
  assert.ok(partRequests>=2,'the bounded transfer parts protocol is actually used');
  assert.equal(assembled.contentVersion,book.contentVersion);
  assert.deepEqual(assembled.sections[0].paragraphs.slice(0,3).map(p=>p.original),book.sections[0].paragraphs.slice(0,3).map(p=>p.original));
  const unused=path.join(dir,'unused-checkpoint.json');
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:false,checkpointFile:unused});
  const total=book.sections.reduce((n,section)=>n+section.paragraphs.length,0);
  assert.equal(summary.eligible.length,total);
  assert.equal(summary.remaining,total);
  await assert.rejects(stat(unused),e=>e.code==='ENOENT');
});

test('aborting the run stops future requests and never claims an in-flight refund',async t=>{
  const controller=new AbortController();
  let generation=0;
  const provider=async context=>{
    generation++;
    if(generation===1)controller.abort();
    return {literal:'合成直译 '+context.passageId,interpretive:'合成意译 '+context.passageId,model:'synthetic'};
  };
  const {base,account,server,dir}=await start(t,{translator:provider}),session=await account('reader-a@example.test');
  const book=await importBook(server,session.user,['One source paragraph.','Two source paragraph.','Three source paragraph.']);
  const summary=await runBatch({origin:base,bookId:book.bookId,session:session.token,execute:true,maxRequests:10,checkpointFile:path.join(dir,'checkpoint','batch.json'),signal:controller.signal});
  assert.equal(summary.requests,1,'no request is issued after the abort');
  assert.equal(summary.stopped,'aborted');
  assert.equal(summary.entries[0].state,'saved','the in-flight request keeps its real outcome');
  assert.equal(generation,1);
});
