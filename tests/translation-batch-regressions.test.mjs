import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,stat,readFile,writeFile,rm,symlink,link,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runBatch,createTransport,openCheckpoint,acquireCheckpointLock,bindingFor,reconcileEntries} from '../tools/lib/translation-batch.mjs';
import {mergeGeneratedTranslations} from '../server/translation-batch.mjs';
import {authFixture} from './auth-fixture.mjs';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';
const origin='https://fixture.invalid',session='synthetic-private-session';
const book=()=>({bookId:'b',contentVersion:'v',chapters:[{id:'c',kind:'body'}],sections:[{chapterId:'c',paragraphs:[{id:'p',original:'One source paragraph.',translations:{}}]}]});
const fixture=async t=>{const dir=await mkdtemp(path.join(await realpath(tmpdir()),'batch-regression-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};
const fakeBook=(b,onRequest=()=>{})=>async(url,options={})=>{const value=await onRequest(url,options);return value||new Response(JSON.stringify(String(url).endsWith('/api/auth/session')?{user:{id:'u'}}:b));};

test('another process cannot reclaim a lock while its creator has not yet written ownership',async t=>{
 const dir=await fixture(t),file=path.join(dir,'cp.json');
 const child=spawn(process.execPath,['--input-type=module','-e',"import {open} from 'node:fs/promises'; const h=await open(process.argv[1],'wx',0o600);process.send('opened');process.on('message',async()=>{await h.close();process.exit(0)});",file+'.lock'],{stdio:['ignore','ignore','inherit','ipc']});
 t.after(()=>child.kill());await once(child,'message');
 await assert.rejects(acquireCheckpointLock(file),{code:'locked'});
 child.send('finish');await once(child,'exit');
});
test('an old release cannot unlink a replacement lock, and a dead valid owner is recoverable',async t=>{
 const dir=await fixture(t),file=path.join(dir,'cp.json');const release=await acquireCheckpointLock(file);
 await rm(file+'.lock');const dead=spawn(process.execPath,['-e','']);await once(dead,'exit');
 await writeFile(file+'.lock',JSON.stringify({pid:dead.pid,nonce:'replacement',startedAt:new Date().toISOString()}),{mode:0o600});
 await release();assert.equal(JSON.parse(await readFile(file+'.lock','utf8')).nonce,'replacement');
 const recovered=await acquireCheckpointLock(file);await recovered();await assert.rejects(stat(file+'.lock'),{code:'ENOENT'});
});
test('checkpoint paths reject shared parents, ancestor symlinks and hard links without changing them',async t=>{
 const dir=await fixture(t),b=book(),binding=bindingFor({userId:'u',origin,book:b});
 const shared=path.join(dir,'shared');await mkdir(shared,{mode:0o755});await chmod(shared,0o755);
 await assert.rejects(openCheckpoint({file:path.join(shared,'cp.json'),binding,create:true}),{code:'checkpoint-permissions'});
 assert.equal((await stat(shared)).mode&0o777,0o755);
 await mkdir(path.join(dir,'outside','nested'),{recursive:true,mode:0o700});await symlink(path.join(dir,'outside'),path.join(dir,'alias'));
 await assert.rejects(openCheckpoint({file:path.join(dir,'alias','nested','cp.json'),binding,create:true}),{code:'symlink'});
 await assert.rejects(stat(path.join(dir,'outside','nested','cp.json')),{code:'ENOENT'});
 const file=path.join(dir,'cp.json');await openCheckpoint({file,binding,create:true});await link(file,path.join(dir,'alias.json'));
 await assert.rejects(openCheckpoint({file,binding,create:false}),{code:'checkpoint-path'});
});
test('saved checkpoints reconcile against actual server state including lost and partial translations',()=>{
 const b=book(),entries={p:{state:'saved',attempts:1}};
 assert.notEqual(reconcileEntries(entries,b).p.state,'saved');
 b.sections[0].paragraphs[0].translations.literal={text:'preserved draft',status:'draft'};
 assert.notEqual(reconcileEntries(entries,b).p.state,'saved');
});
test('saved checkpoint with an empty server passage remains eligible for a real saved receipt',async t=>{
 const dir=await fixture(t),b=book(),file=path.join(dir,'cp.json');
 const store=await openCheckpoint({file,binding:bindingFor({userId:'u',origin,book:b}),create:true});store.record('p',{state:'saved'});await store.save();
 let posts=0;const fetchImpl=fakeBook(b,async(_url,o)=>{if(o.method==='POST'){posts++;return new Response(JSON.stringify({id:'p',original:'One source paragraph.',translations:{literal:{text:'literal',status:'draft',sourceVersion:'v'},interpretive:{text:'interpretive',status:'draft',sourceVersion:'v'}}}));}});
 const result=await runBatch({origin,bookId:'b',session,execute:true,maxRequests:1,checkpointFile:file,fetchImpl});assert.equal(posts,1);assert.equal(result.entries[0].state,'saved');
});
test('abort received during the awaited preflight book read dispatches no paid POST',async t=>{
 const dir=await fixture(t),b=book(),controller=new AbortController();let gets=0,posts=0;
 const fetchImpl=fakeBook(b,async(url,o)=>{if(o.method==='POST')posts++;else if(!String(url).endsWith('/api/auth/session')&&++gets===2)controller.abort();});
 const result=await runBatch({origin,bookId:'b',session,execute:true,maxRequests:1,checkpointFile:path.join(dir,'cp.json'),fetchImpl,signal:controller.signal});
 assert.equal(posts,0);assert.equal(result.requests,0);assert.equal(result.stopped,'aborted');
});
test('invalid or unreadable 2xx translation acknowledgements remain unknown, never saved',async t=>{
 const dir=await fixture(t),b=book();
 for(const [name,response]of [['empty',()=>new Response('{}')],['html',()=>new Response('<html>proxy</html>')],['broken',()=>new Response(new ReadableStream({start(c){c.error(Error('private-body-marker'));}}))]]){
  const fetchImpl=fakeBook(b,async(_url,o)=>o.method==='POST'?response():null);
  const result=await runBatch({origin,bookId:'b',session,execute:true,maxRequests:1,checkpointFile:path.join(dir,name,'cp.json'),fetchImpl});
  assert.equal(result.entries[0].state,'unknown',name);assert.equal(result.remaining,1);assert.equal(result.stopped,'unknown');
 }
});
test('transfer validates cumulative decoded bytes, canonical base64, total/snapshot and exact progress',async()=>{
 const snapshot='0'.repeat(64);
 const cases=[{data:Buffer.from('abcdef').toString('base64'),nextOffset:1},{data:Buffer.from('abcdefghijk').toString('base64'),nextOffset:null},{data:'!!!!',nextOffset:null},{data:Buffer.from('abc').toString('base64'),nextOffset:null},{data:Buffer.from('abc').toString('base64'),nextOffset:3,totalBytes:99},{data:Buffer.from('abc').toString('base64'),nextOffset:3,snapshot:'1'.repeat(64)}];
 for(const patch of cases){let parts=0;const transport=createTransport({origin,session,limits:{transfer:1024,part:512},fetchImpl:async url=>{
  if(!String(url).includes('content-part'))return new Response(JSON.stringify({kind:'leafhour-book-transfer-v1',bookId:'b',totalBytes:10,partBytes:6,snapshot}),{headers:{'x-reader-book-transfer':'parts'}});
  parts++;if(parts>2)throw Error('test-only stop');return new Response(JSON.stringify({kind:'leafhour-book-part-v1',offset:0,totalBytes:10,snapshot,...patch}));
 }});await assert.rejects(transport.getBook('b'),{code:'invalid-response'});assert.equal(parts,1);}
});
test('versioned POST protects partial drafts before charging, including a change during reservation',async t=>{
 const dir=await fixture(t),user={id:'u'};let calls=0;
 const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{calls++;return {literal:'new literal',interpretive:'new interpretive'};}});
 const b=await library.importDocument(user,{filename:'x.txt',bytes:Buffer.from('One source paragraph.')}),p=b.sections[0].paragraphs[0];
 const file=path.join(dir,'users',digest(user.id),'translations',digest(b.bookId)+'.json');await mkdir(path.dirname(file),{recursive:true});
 await writeFile(file,JSON.stringify({[p.id]:{contentVersion:b.contentVersion,translations:{literal:{text:'saved partial draft',status:'draft',revision:7}}}}));
 await assert.rejects(library.translate(user,b.bookId,p.id,{expectedContentVersion:b.contentVersion}),e=>e.status===409);assert.equal(calls,0);
 assert.equal((await library.getBook(user,b.bookId)).sections[0].paragraphs[0].translations.literal.revision,7);
 const legacy=await library.translate(user,b.bookId,p.id);assert.equal(calls,1);assert.equal(legacy.translations.interpretive.text,'new interpretive');
});

test('a partial variant added while awaiting a shared reservation is rejected before the provider',async()=>{
 const f=authFixture(),store=f.store(),root='reservation-regression',user={id:'u'};let b,calls=0,releases=0;
 const library=await createLibraryService({dataDir:root,catalogDir:null,dataStore:{...store,async putBlob(){},async reserveTranslation(){
  const p=b.sections[0].paragraphs[0];await store.mutate(path.join(root,'users',digest(user.id),'translations',digest(b.bookId)+'.json'),{},data=>{data[p.id]={contentVersion:b.contentVersion,translations:{interpretive:{text:'concurrent partial',status:'draft'}}};});return 'ticket';
 },async releaseTranslation(){releases++;}},translator:async()=>{calls++;return {literal:'new literal',interpretive:'new interpretive'};}});
 b=await library.importDocument(user,{filename:'x.txt',bytes:Buffer.from('One original paragraph.')});
 await assert.rejects(library.translate(user,b.bookId,b.sections[0].paragraphs[0].id,{expectedContentVersion:b.contentVersion}),e=>e.status===409);
 assert.equal(calls,0);assert.equal(releases,1);assert.equal((await library.getBook(user,b.bookId)).sections[0].paragraphs[0].translations.interpretive.text,'concurrent partial');
});
test('a concurrent metadata-only translation change survives the generation save',()=>{
 const before={literal:{text:'unchanged text',status:'draft',model:'before',revision:1}},existing={literal:{...before.literal,model:'human-corrected-metadata',revision:2}},generated={literal:{text:'replacement'},interpretive:{text:'new second'}};
 assert.deepEqual(mergeGeneratedTranslations({before,existing,generated}).literal,existing.literal);
});
test('a spawned CLI never reflects unknown argument values, upstream error bodies or malformed JSON',async t=>{
 const dir=await fixture(t),cli=fileURLToPath(new URL('../tools/translation-batch.mjs',import.meta.url)),marker='SYNTHETIC-PRIVATE-ORIGINAL';
 const run=args=>new Promise(resolve=>{const child=spawn(process.execPath,[cli,...args],{cwd:dir,env:{PATH:process.env.PATH,LEAFHOUR_SESSION:session},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>{output+=x});child.stderr.on('data',x=>{output+=x});child.on('close',code=>resolve({code,output}));});
 let result=await run(['--session='+session]);assert.equal(result.code,2);assert.ok(!result.output.includes(session));
 for(const malformed of [false,true]){
  const server=http.createServer((req,res)=>{res.statusCode=malformed?200:503;res.end(malformed?'invalid-json-'+marker:JSON.stringify({error:marker+' '+req.headers.cookie}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{result=await run(['--origin','http://127.0.0.1:'+server.address().port,'--book','b']);assert.equal(result.code,1);assert.ok(!result.output.includes(session));assert.ok(!result.output.includes(marker));}finally{await new Promise(r=>server.close(r));}
 }
});

test('a pair completed concurrently before preflight is skipped with zero remaining and zero POST',async t=>{
 const dir=await fixture(t),b=book();let gets=0,posts=0;
 const fetchImpl=async(url,o={})=>{
  if(String(url).endsWith('/api/auth/session'))return Response.json({user:{id:'u'}});
  if(o.method==='POST')posts++;
  const current=structuredClone(b);if(++gets>=2)current.sections[0].paragraphs[0].translations={literal:{text:'saved literal'},interpretive:{text:'saved interpretive'}};
  return Response.json(current);
 };
 const result=await runBatch({origin,bookId:'b',session,execute:true,maxRequests:1,checkpointFile:path.join(dir,'cp.json'),fetchImpl});
 assert.equal(posts,0);assert.equal(result.requests,0);assert.equal(result.remaining,0);assert.equal(result.skipped.at(-1).reason,'complete');
});
