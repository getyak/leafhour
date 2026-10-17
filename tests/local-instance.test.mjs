import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm,stat,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {exportRelease} from '../tools/release-policy.mjs';

const entry=fileURLToPath(new URL('../server/server.mjs',import.meta.url));
async function fixture(t){
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'leafhour-instance-')));
 const cleanup=[];t.after(async()=>{for(const stop of cleanup.reverse())await stop();await rm(directory,{recursive:true,force:true});});
 const cwd=path.join(directory,'checkout');await mkdir(cwd);
 return {directory,cwd,dataDir:path.join(directory,'instance data'),cleanup};
}
async function launch({directory,cwd,dataDir,cleanup,host,bookPath,script=entry}){
 // A regression must fail instead of writing the checkout's default real data.
 const child=spawn(process.execPath,['--permission','--allow-fs-read=*','--allow-fs-write='+directory,script],{
  cwd,env:{PATH:process.env.PATH||'',TMPDIR:directory,READER_PORT:'0',...(dataDir===undefined?{}:{READER_DATA_DIR:dataDir}),...(host?{READER_HOST:host}:{}),...(bookPath?{READER_BOOK_PATH:bookPath}:{})},stdio:['ignore','pipe','pipe']
 });
 let output='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const stop=async()=>{
  if(child.exitCode!==null||child.signalCode!==null)return closed;
  child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),5000);force.unref();
  try{return await closed;}finally{clearTimeout(force);}
 };
 cleanup.push(stop);
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');},20000);timer.unref();
  const finish=value=>{clearTimeout(timer);resolve(value);};
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Leafhour 已启动：(http:\/\/127\.0\.0\.1:\d+)/);if(match)finish({base:match[1]});});
  child.stderr.on('data',chunk=>{errors+=chunk;});
  closed.then(status=>finish({...status,output,errors}));
 });
 return {...result,stop};
}
const post=(base,route,body,cookie='',origin=base)=>fetch(base+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
async function body(response,status=200){assert.equal(response.status,status);return response.json();}
const read=(base,route,cookie='')=>fetch(base+route,{headers:{Cookie:cookie}}).then(response=>body(response));
async function login(base){const response=await post(base,'/api/auth/local',{});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly/);return response.headers.get('set-cookie').split(';')[0];}

test('standard local startup honors a relative instance directory containing spaces', {timeout:30000},async t=>{
 const f=await fixture(t),app=await launch({...f,dataDir:'../instance data'});
 assert.ok(app.base,'Configured instance must start without writing outside its directory: '+JSON.stringify(app));
 const response=await post(app.base,'/api/auth/local',{});assert.equal(response.status,200);
 assert.equal((await response.json()).user.id,'local-owner');
 assert.ok((await stat(path.join(f.dataDir,'portal','auth'))).isDirectory());
});

test('unset and empty instance options retain the source-relative default across working directories', {timeout:30000},async t=>{
 const f=await fixture(t),snapshot=path.join(f.directory,'software');
 // The real default must be exercised in a disposable public release, never in a user's checkout.
 await exportRelease(fileURLToPath(new URL('..',import.meta.url)),snapshot,{commit:'1'.repeat(40)});
 await symlink(await realpath(new URL('../node_modules',import.meta.url)),path.join(snapshot,'node_modules'),'dir');
 const script=path.join(snapshot,'server/server.mjs'),first=await launch({...f,script,dataDir:undefined});assert.ok(first.base,JSON.stringify(first));
 const cookie=await login(first.base),upload={filename:'default-instance.txt',base64:Buffer.from('A synthetic default-instance source.').toString('base64')};
 const book=await body(await post(first.base,'/api/library/upload',upload,cookie),201),root='/api/library/books/'+book.bookId;
 await body(await post(first.base,root+'/comments',{id:'default-note',passageId:book.sections[0].paragraphs[0].id,text:'Keep this default-room note.',origin:'user'},cookie),201);
 const saved=await read(first.base,root+'/records',cookie);assert.ok((await stat(path.join(snapshot,'local/service/portal/auth'))).isDirectory());await first.stop();
 const cwd=path.join(f.directory,'elsewhere');await mkdir(cwd);
 const restarted=await launch({...f,script,cwd,dataDir:''});assert.ok(restarted.base,JSON.stringify(restarted));
 assert.equal((await read(restarted.base,'/api/auth/session',cookie)).user.id,'local-owner');
 assert.deepEqual(await read(restarted.base,root+'/records',cookie),saved);
 await assert.rejects(stat(path.join(cwd,'local')),error=>error.code==='ENOENT');
});

test('the selected instance preserves private books and personal state across real process restart', {timeout:30000},async t=>{
 const f=await fixture(t),first=await launch(f);assert.ok(first.base,JSON.stringify(first));
 const upload={filename:'get-143-synthetic.txt',base64:Buffer.from('GET-143 synthetic first source.\n\nA second unchanged source paragraph.').toString('base64')};
 assert.equal((await post(first.base,'/api/library/upload',upload)).status,401);
 const cookie=await login(first.base),book=await body(await post(first.base,'/api/library/upload',upload,cookie),201);
 const root='/api/library/books/'+book.bookId,paragraphs=book.sections[0].paragraphs,chapterId=book.sections[0].chapterId;
 const note={id:'instance-note',passageId:paragraphs[0].id,text:'My own <em>words</em>.',origin:'user'};
 const question={id:'instance-question',passageId:paragraphs[1].id,text:'What limits this sentence?',origin:'user'};
 await body(await post(first.base,root+'/comments',note,cookie),201);
 await body(await post(first.base,root+'/questions',question,cookie),201);
 await body(await post(first.base,root+'/progress',{baseRevision:0,chapterId,passageId:paragraphs[1].id,offset:12,mode:'parallel',variant:'literal',font:22,theme:'paper'},cookie));
 const startedAt=new Date(Date.now()-60000).toISOString(),endedAt=new Date(Date.now()-30000).toISOString();
 await body(await post(first.base,root+'/reading-sessions',{id:'instance-session',source:'reader_focus',sequence:1,status:'finished',startedAt,endedAt,timeZone:'Asia/Shanghai',start:{chapterId,passageId:paragraphs[0].id,offset:0},end:{chapterId,passageId:paragraphs[1].id,offset:12},segments:[{startedAt,endedAt}]},cookie),201);
 const sourceBefore=await read(first.base,root,cookie);
 const recordsBefore=await read(first.base,root+'/records',cookie);
 const pack={kind:'marginalia-library',schemaVersion:1,books:[{book:sourceBefore,records:recordsBefore}]};
 const again=await body(await post(first.base,'/api/library/upload',upload,cookie),201);assert.equal(again.bookId,book.bookId);
 for(let i=0;i<2;i++)await body(await post(first.base,'/api/library/import',pack,cookie));
 const saved=await read(first.base,root+'/records',cookie);
 assert.equal(saved.comments.length,1);assert.equal(saved.questions.length,1);assert.equal(saved.readingSessions.length,1);
 assert.equal(saved.comments[0].text,note.text);assert.equal(saved.comments[0].origin,'user');assert.equal(saved.questions[0].status,'open');
 assert.equal(saved.readingSessions[0].durationSeconds,30);assert.equal(saved.position.passageId,paragraphs[1].id);
 const bad=structuredClone(pack);bad.books[0].records.comments[0].passageId='unknown-anchor';
 assert.equal((await post(first.base,'/api/library/import',bad,cookie)).status,400);
 assert.equal((await post(first.base,root+'/comments',{...note,id:'foreign-origin'},cookie,'https://untrusted.invalid')).status,403);
 assert.deepEqual(await read(first.base,root+'/records',cookie),saved);
 assert.deepEqual(await read(first.base,root,cookie),sourceBefore);
 const privateBooks=(await read(first.base,'/api/library',cookie)).books.filter(item=>item.visibility==='private');
 assert.deepEqual(privateBooks.map(item=>item.bookId),[book.bookId]);
 await first.stop();

 const foreign=await launch({...f,dataDir:path.join(f.directory,'another instance')});assert.ok(foreign.base,JSON.stringify(foreign));
 assert.equal((await read(foreign.base,'/api/auth/session',cookie)).user,null);
 assert.equal((await fetch(foreign.base+root,{headers:{Cookie:cookie}})).status,404);
 await foreign.stop();

 const newCwd=path.join(f.directory,'new checkout');await mkdir(newCwd);
 const restarted=await launch({...f,cwd:newCwd});assert.ok(restarted.base,JSON.stringify(restarted));
 assert.equal((await read(restarted.base,'/api/auth/session',cookie)).user.id,'local-owner');
 assert.deepEqual(await read(restarted.base,root,cookie),sourceBefore);
 assert.deepEqual(await read(restarted.base,root+'/records',cookie),saved);
});

test('an explicit source package stays separate from the selected personal instance', {timeout:30000},async t=>{
 const f=await fixture(t),sourceDir=path.join(f.directory,'source');await mkdir(sourceDir);
 const bookPath=path.join(sourceDir,'book.json'),book={bookId:'get-143-source',contentVersion:'synthetic-source-v1',chapters:[{id:'ch1'}],sections:[{chapterId:'ch1',number:1,paragraphs:[{id:'source-p1',original:'A fixed synthetic source.',translations:{literal:{text:'合成直译。',origin:'ai',status:'draft'}},annotationIds:[],termIds:[]}]}]};
 const raw=JSON.stringify(book);await writeFile(bookPath,raw,{mode:0o400});
 const first=await launch({...f,bookPath});assert.ok(first.base,JSON.stringify(first));
 assert.deepEqual(await read(first.base,'/api/book'),book);
 await body(await post(first.base,'/api/comments',{id:'source-note',passageId:'source-p1',text:'My source note.',origin:'user'}),201);
 const saved=await read(first.base,'/api/records');await first.stop();
 const restarted=await launch({...f,bookPath});assert.ok(restarted.base,JSON.stringify(restarted));
 assert.deepEqual(await read(restarted.base,'/api/records'),saved);
 assert.equal(await readFile(bookPath,'utf8'),raw);
 assert.equal((await stat(path.join(f.dataDir,'records.json'))).isFile(),true);
 await assert.rejects(stat(path.join(sourceDir,'records.json')),error=>error.code==='ENOENT');
});

test('invalid instance paths and external listeners fail without falling back to another room', {timeout:30000},async t=>{
 const f=await fixture(t),blocked=path.join(f.directory,'not-a-directory');await writeFile(blocked,'keep this file');
 const invalid=await launch({...f,dataDir:blocked});assert.equal(invalid.code,1);assert.match(invalid.errors,/ENOTDIR/);assert.equal(invalid.base,undefined);
 assert.equal(await readFile(blocked,'utf8'),'keep this file');
 await assert.rejects(stat(f.dataDir),error=>error.code==='ENOENT');
 const external=await launch({...f,host:'0.0.0.0'});assert.equal(external.code,1);assert.match(external.errors,/private local service/);assert.equal(external.base,undefined);
 const recovered=await launch(f);assert.ok(recovered.base,JSON.stringify(recovered));assert.equal((await post(recovered.base,'/api/auth/local',{})).status,200);
});
