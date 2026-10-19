import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
test('the reading window uses authenticated chat routes, real source references and account guarded requests',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-chat-http-'));let calls=0;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null,chatGenerator:async job=>{calls++;assert.equal(job.kind,'conversation');const context=await job.tools.execute('reader_get_context',{});const p=context.passages[0];await job.tools.execute('reader_cite',{bookId:job.book.bookId,passageId:p.passageId,layer:'original',quote:p.original.slice(0,24)});return {kind:'conversation',summary:'这是依据当前原文的回答。'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,url=base+'/api/library/books/gutenberg-alice/chat';
  assert.equal((await fetch(url)).status,401);
  const session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
  const response=await fetch(url,{headers});assert.equal(response.status,200);const view=await response.json();assert.equal(view.available,true);assert.notEqual(view.context.original.slice(0,8),'CHAPTER ');assert.equal(calls,0);
  const input={id:'window-question-1',passageId:view.context.passageId,contentVersion:view.contentVersion,text:'这句话是什么意思？'};
  const denied=await fetch(url,{method:'POST',headers:{...headers,'X-Reader-Owner':'another-account'},body:JSON.stringify(input)});assert.equal(denied.status,409);assert.equal(calls,0);
  const answer=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(answer.status,200);const turn=await answer.json();assert.equal(turn.status,'completed');assert.equal(turn.answer.origin,'ai');assert.equal(turn.text,input.text);assert.equal(calls,1);
  const repeat=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(repeat.status,200);assert.equal(calls,1);
  const records=await server.portal.library.records(session.user,'gutenberg-alice');assert.equal(records.questions.at(-1).text,input.text);
  const markdown=await fetch(base+'/library-chat-markdown.mjs');assert.equal(markdown.status,200);assert.match(await markdown.text(),/renderChatMarkdown/);
  for(const file of ['reading-chat-quote.mjs','reading-chat-input.mjs','reader-chat-workspace.mjs','reader-chat-workspace.css']){const response=await fetch(base+'/'+file);assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),file.endsWith('.css')?/css/:/javascript/);}
  assert.equal(turn.answer.sourceRefs[0].bookId,'gutenberg-alice');
  const quote={kind:'leafhour-reading-quote',schemaVersion:1,bookId:'gutenberg-alice',contentVersion:view.contentVersion,chapterId:view.context.chapterId,parts:[{passageId:view.context.passageId,layer:'original',start:0,end:5,text:view.context.original.slice(0,5)}]};
  const quoted=await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,id:'window-quoted-2',quote})});assert.equal(quoted.status,200);assert.deepEqual((await quoted.json()).quote,quote);assert.equal(calls,2);

  const assets=await fetch(base+'/library-shell.mjs');assert.equal(assets.status,200);assert.match(assets.headers.get('content-type'),/javascript/);
});

test('scope selection is authenticated, persisted and checked before dispatching a model request',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-chat-scope-http-'));let calls=0;
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null,chatGenerator:async()=>{calls++;return {kind:'conversation',summary:'Synthetic bounded answer.'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'scope-http-synthetic.txt',bytes:Buffer.from('A synthetic current-book source.')}),url=base+'/api/library/books/'+book.bookId+'/chat',headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base};
  const post=(suffix,body,extra=headers)=>fetch(url+suffix,{method:'POST',headers:extra,body:JSON.stringify(body)});
  assert.deepEqual((await (await fetch(url,{headers})).json()).scope,{mode:'book',revision:0});
  assert.equal((await post('/scope',{mode:'library',baseRevision:0},{'Content-Type':'application/json',Origin:base})).status,401);
  assert.equal((await post('/scope',{mode:'library',baseRevision:0},{...headers,'X-Reader-Owner':'stale-account'})).status,409);
  const saved=await post('/scope',{mode:'library',baseRevision:0});assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{mode:'library',revision:1});assert.equal(calls,0);
  assert.equal((await post('/scope',{mode:'book',baseRevision:0})).status,412);
  for(const body of [{mode:'all',baseRevision:1},{mode:'book',baseRevision:-1},{mode:'book',baseRevision:1,userId:'other'}])assert.equal((await post('/scope',body)).status,400);
  const question={id:'scope-http-question',passageId:book.sections[0].paragraphs[0].id,contentVersion:book.contentVersion,text:'A synthetic question.',scopeRevision:0};
  assert.equal((await post('',question)).status,412);assert.equal(calls,0);assert.equal((await server.portal.library.records(session.user,book.bookId)).questions.length,0);
  const answer=await post('',{...question,scopeRevision:1});assert.equal(answer.status,200);const turn=await answer.json();assert.equal(turn.scopeRevision,1);assert.equal(turn.status,'completed');assert.equal(calls,1);
  const confirmed=await post('',{...question,scopeRevision:1});assert.equal(confirmed.status,200);assert.equal(calls,1);
  assert.equal((await post('',{...question,scopeRevision:0})).status,409);
  assert.deepEqual((await (await fetch(url,{headers})).json()).scope,{mode:'library',revision:1});
  const module=await fetch(base+'/reading-chat-scope.mjs');assert.equal(module.status,200);assert.match(await module.text(),/checkChatScopeRevision/);
});
