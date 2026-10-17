import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('introduction HTTP uses the existing authenticated owner, CSRF, version and no-store boundaries',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-http-'));let calls=0;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:async()=>{calls++;return {text:'开头描绘了留意当下、保留问题的阅读方式。'};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'Opening.txt',bytes:Buffer.from('Read slowly and keep a question.')}),url=base+'/api/library/books/'+book.bookId+'/introduction';
  const headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
  const body=JSON.stringify({contentVersion:book.contentVersion});
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Cookie:''},body})).status,409);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://unrelated.invalid'},body})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Reader-Owner':'other'},body})).status,409);
  const view=await fetch(url,{headers});assert.equal(view.status,200);assert.match(view.headers.get('cache-control'),/no-store/);assert.equal((await view.json()).source,'missing');assert.equal(calls,0);
  const generated=await fetch(url,{method:'POST',headers,body});assert.equal(generated.status,200);const saved=await generated.json();assert.equal(saved.source,'ai');assert.equal(saved.introduction.status,'draft');assert.equal(calls,1);
  assert.equal((await fetch(url,{method:'POST',headers,body})).status,200);assert.equal(calls,1);
  await server.portal.auth.logout(session.token);assert.notEqual((await fetch(url,{headers})).status,200);
});

test('disconnect cancels generation and never saves a late result',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-disconnect-'));let started,finish;const began=new Promise(r=>started=r);
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:async job=>{started(job.signal);return new Promise(r=>finish=r);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'Cancel.txt',bytes:Buffer.from('Cancel this opening.')}),url=base+'/api/library/books/'+book.bookId+'/introduction',controller=new AbortController();
  const pending=fetch(url,{method:'POST',signal:controller.signal,headers:{Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base},body:JSON.stringify({contentVersion:book.contentVersion})});
  const signal=await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(Error('generator never started')),1000))]);controller.abort();await assert.rejects(pending);
  if(!signal.aborted)await new Promise(r=>signal.addEventListener('abort',r,{once:true}));finish({text:'断开后不该保存的简介。'});await new Promise(r=>setTimeout(r,10));
  assert.equal((await server.portal.library.getBook(session.user,book.bookId)).introduction,undefined);
});
