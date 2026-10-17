import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {createEmailAuth} from '../server/email-auth.mjs';
import {textPdf} from './pdf-fixture.mjs';

test('MCP setup remains reachable when localhost resolves to an IPv6 listener',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-localhost-setup-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null});await new Promise(r=>server.listen(0,'localhost',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token};
  const response=await fetch('http://localhost:'+server.address().port+'/api/library/mcp-setup',{headers});assert.equal(response.status,200);const setup=await response.json();
  const target=new URL(setup.serviceUrl);assert.ok(['127.0.0.1','[::1]'].includes(target.hostname));const reachable=await fetch(setup.serviceUrl+'/api/auth/session',{headers});assert.equal(reachable.status,200);assert.equal((await reachable.json()).user.id,session.user.id);
});

test('local MCP setup is authenticated, uses the actual runtime and port, and is absent from hosted mode',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-setup-'));
  const start=async(publicOrigin=null)=>{const server=await createReaderServer({recordsPath:path.join(dir,publicOrigin?'hosted/records.json':'records.json'),publicOrigin,sendCode:null,translator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return server;};
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const local=await start(),base='http://127.0.0.1:'+local.address().port;
  assert.equal((await fetch(base+'/api/library/mcp-setup')).status,401);
  const session=await local.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id};
  const response=await fetch(base+'/api/library/mcp-setup',{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const setup=await response.json();assert.equal(setup.command,process.execPath);assert.deepEqual(setup.args,[path.resolve('server/mcp.mjs')]);assert.equal(setup.serviceUrl,base);assert.ok(!JSON.stringify(setup).includes(session.token));
  assert.equal((await fetch(base+'/api/library/mcp-setup',{headers:{...headers,'X-Reader-Owner':'other'}})).status,409);
  const hosted=await start('https://reader.example.com'),hostedSession=await hosted.portal.auth.localSession();
  const denied=await fetch('http://127.0.0.1:'+hosted.address().port+'/api/library/mcp-setup',{headers:{Cookie:'marginalia_session='+hostedSession.token}});assert.equal(denied.status,403);assert.ok(!JSON.stringify(await denied.json()).includes(process.execPath));
});

test('email codes must be delivered, expire, cannot be replayed and sessions revoke',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-auth-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let code,now=Date.now();const auth=await createEmailAuth({dataDir:dir,sendCode:async(_,value)=>{code=value;},clock:()=>now});
  await auth.requestCode('reader@example.com');
  await assert.rejects(auth.verifyCode('reader@example.com','wrong'),e=>e.status===400);
  const session=await auth.verifyCode('reader@example.com',code);
  assert.equal((await auth.userFor(session.token)).email,'reader@example.com');
  await assert.rejects(auth.verifyCode('reader@example.com',code));
  await auth.logout(session.token);assert.equal(await auth.userFor(session.token),null);
  now+=61000;await auth.requestCode('reader@example.com');now+=11*60000;
  await assert.rejects(auth.verifyCode('reader@example.com',code));
  const unavailable=await createEmailAuth({dataDir:path.join(dir,'unconfigured')});
  await assert.rejects(unavailable.requestCode('reader@example.com'),e=>e.status===503);
});

test('SMTP-only hosting rejects password setup purposes before sending or verifying mail',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-auth-capability-'));let delivered=0;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:async()=>{delivered++;}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['code','verify'])for(const purpose of ['signup','recovery']){
    const response=await fetch(base+'/api/auth/'+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'reader@example.com',code:'123456',purpose})});
    assert.equal(response.status,503);
  }
  assert.equal(delivered,0);
});

test('original downloads keep exact bytes private and restored books can reattach their original',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-original-'));let code;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:async(_,value)=>{code=value;},translator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,{library,auth}=server.portal,session=await auth.localSession(),user=session.user,cookie='marginalia_session='+session.token,bytes=textPdf();
  const b=await library.importDocument(user,{filename:'original.pdf',bytes}),url=base+'/api/library/books/'+b.bookId+'/original',headers={Cookie:cookie,'X-Reader-Owner':user.id};
  const download=await fetch(url,{headers});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.match(download.headers.get('cache-control'),/no-store/);
  assert.equal((await fetch(url)).status,401);
  await auth.requestCode('other@example.com');const other=await auth.verifyCode('other@example.com',code);
  assert.equal((await fetch(url,{headers:{Cookie:'marginalia_session='+other.token}})).status,404);
  assert.equal((await fetch(url,{headers:{Cookie:cookie,'X-Reader-Owner':other.user.id}})).status,409);
  const backup=await library.exportLibrary(user),fresh=await createReaderServer({recordsPath:path.join(dir,'fresh/records.json'),translator:null,sendCode:null});t.after(()=>fresh.close());
  await fresh.portal.library.restoreLibrary(user,backup);assert.equal((await fresh.portal.library.originalInfo(user,b.bookId)).available,false);
  await fresh.portal.library.importDocument(user,{filename:'original.pdf',bytes});assert.equal((await fresh.portal.library.originalInfo(user,b.bookId)).available,true);assert.deepEqual((await fresh.portal.library.getOriginal(user,b.bookId)).bytes,bytes);
});

test('portal serves home, imports private text after explicit local entry, guards origin and scoped Agent API',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-portal-'));
  const server=await createReaderServer({portalDataDir:path.join(dir,'portal'),recordsPath:path.join(dir,'records.json')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(url,data,cookie='',origin=base)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(data)});
  assert.match(await (await fetch(base+'/')).text(),/home-hero/);
  const privacy=await fetch(base+'/privacy');assert.equal(privacy.status,200);assert.match(privacy.headers.get('content-type'),/text\/html/);assert.match(await privacy.text(),/Sign-in and personal data/);
  assert.match(await (await fetch(base+'/zh-hans/privacy')).text(),/登录与个人数据/);
  assert.match(await (await fetch(base+'/ja/privacy')).text(),/ログインと個人データ/);
  assert.match(await (await fetch(base+'/')).text(),/href="\/privacy"/);
  const backupSchema=await fetch(base+'/reading-session-record.mjs');assert.equal(backupSchema.status,200);assert.match(backupSchema.headers.get('content-type'),/javascript/);
  assert.equal((await post('/api/library/upload',{filename:'test.txt',base64:Buffer.from('Private text.').toString('base64')})).status,401);
  assert.equal((await post('/api/auth/local',{},'','https://evil.example')).status,403);
  const login=await post('/api/auth/local',{});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const stale=await fetch(base+'/api/library/upload',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-Reader-Owner':'different-account'},body:JSON.stringify({filename:'cross-account.txt',base64:Buffer.from('Wrong owner').toString('base64')})});
  assert.equal(stale.status,409);assert.equal(stale.headers.get('X-Reader-Session-Changed'),'1');
  const imported=await post('/api/library/upload',{filename:'test.txt',base64:Buffer.from('Private text.\n\nMore text.').toString('base64')},cookie);assert.equal(imported.status,201);
  const book=await imported.json();
  assert.equal((await post('/api/agent/comment',{bookId:book.bookId},'',base)).status,403);
  assert.equal((await fetch(base+'/api/library/books/'+book.bookId)).status,404);
  assert.equal((await fetch(base+'/api/library/books/'+book.bookId,{headers:{Cookie:cookie}})).status,200);
  const grant=await (await post('/api/library/grants',{bookId:book.bookId,scopes:['content']},cookie)).json();
  await server.portal.library.saveProgress({id:'local-owner'},book.bookId,{chapterId:'ch01',passageId:book.sections[0].paragraphs[1].id,offset:100,mode:'en',variant:'literal',font:22,theme:'paper'});
  const agent=(scope)=>fetch(base+'/api/agent/'+scope+'?bookId='+book.bookId,{headers:{Authorization:'Bearer '+grant.token}});
  const context=await (await agent('context')).json();assert.equal(context.position,null);assert.equal(context.passages[0].id,book.sections[0].paragraphs[0].id);assert.equal((await agent('notes')).status,403);
  await post('/api/library/grants/'+grant.id+'/revoke',{},cookie);
  assert.equal((await agent('context')).status,403);
});

test('restores a backup larger than 29 MB through the real HTTP endpoint',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-backup-large-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,user={id:'local-owner'},source={id:'source-instance'};
  for(let i=0;i<3;i++)await server.portal.library.importDocument(source,{filename:'large-'+i+'.txt',bytes:Buffer.from(('Readable original '+i+'. ').repeat(600000))});
  const backup=await server.portal.library.exportLibrary(source),payload=JSON.stringify(backup);assert.ok(Buffer.byteLength(payload)>29*1024*1024);
  const login=await fetch(base+'/api/auth/local',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{}'}),cookie=login.headers.get('set-cookie').split(';')[0];
  const restore=await fetch(base+'/api/library/import',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:payload});assert.equal(restore.status,200);
  assert.equal((await server.portal.library.list(user)).filter(b=>b.visibility==='private').length,3);
});

test('an old reader tab cannot write its private draft into the new email account',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-two-accounts-'));let code;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:async(_,value)=>{code=value;}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,{auth,library}=server.portal;
  await auth.requestCode('a@example.com');const a=await auth.verifyCode('a@example.com',code);
  await auth.requestCode('b@example.com');const b=await auth.verifyCode('b@example.com',code);
  const book=await library.getBook(a.user,'gutenberg-alice'),passageId=book.sections[0].paragraphs[0].id;
  const response=await fetch(base+'/api/library/books/gutenberg-alice/comments',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:'marginalia_session='+b.token,'X-Reader-Owner':a.user.id},body:JSON.stringify({id:'stale-draft',passageId,text:'Private draft written by reader A'})});
  assert.equal(response.status,409);assert.equal((await library.records(b.user,book.bookId)).comments.length,0);assert.equal((await library.records(a.user,book.bookId)).comments.length,0);
});

test('pre-existing oversized local books keep their ordinary readable response',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reader-legacy-large-'));t.after(()=>rm(dir,{recursive:true,force:true}));const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'old.txt',bytes:Buffer.from('A pre-existing source.')});const get=server.portal.library.getBook;server.portal.library.getBook=async(user,id)=>{const b=await get(user,id);return {...b,padding:'x'.repeat(33*1024*1024)};};const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/library/books/'+book.bookId,{headers:{Cookie:'marginalia_session='+session.token,'X-Reader-Book-Transfer':'1'}});assert.equal(response.status,200);assert.equal(response.headers.get('X-Reader-Book-Transfer'),null);const actual=await response.json();assert.equal(actual.bookId,book.bookId);assert.equal(actual.sections[0].paragraphs[0].original,'A pre-existing source.');
});
