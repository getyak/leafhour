import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createReadingAgentTools} from '../server/reading-agent-tools.mjs';
import {createLibraryChatState} from '../app/library-chat-state.mjs';

async function fixture(t,{generator}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'reading-chat-scope-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'scope-synthetic-owner'},other={id:'scope-synthetic-other'},library=await createLibraryService({dataDir:path.join(dir,'library'),catalogDir:null,translator:null});
  const book=await library.importDocument(user,{filename:'scope-current.txt',bytes:Buffer.from('CurrentBookNeedle belongs to the selected book.')}),second=await library.importDocument(user,{filename:'scope-other.txt',bytes:Buffer.from('OtherBookOnlyNeedle belongs to another private book.')});
  const calls=[],make=()=>createReaderChatService({library,dataDir:path.join(dir,'chat'),generator:async job=>{calls.push(job);return generator?generator(job):{kind:'conversation',summary:'A deterministic synthetic answer.'};}}),service=await make();t.after(()=>service.close());
  const input=(id,scopeRevision)=>({id,passageId:book.sections[0].paragraphs[0].id,text:'Explain this selected paragraph.',contentVersion:book.contentVersion,...(scopeRevision===undefined?{}:{scopeRevision})});
  return {dir,user,other,library,book,second,calls,make,service,input};
}

test('a default chat searches only its selected book instead of reading another private book',async t=>{
  let result;const f=await fixture(t,{generator:async job=>{result=await job.tools.execute('reader_search',{query:'OtherBookOnlyNeedle'});return {kind:'conversation',summary:'Synthetic response.'};}});
  const answer=await f.service.send(f.user,f.book.bookId,f.input('default-book'));
  assert.equal(answer.status,'completed');assert.deepEqual(result.results,[]);assert.deepEqual(answer.answer.sourceRefs,[]);
  assert.deepEqual((await f.service.view(f.user,f.book.bookId)).scope,{mode:'book',revision:0});
});

test('default tool scope rejects cross-book and external tools before any out-of-scope access',async t=>{
  const f=await fixture(t),accessed=[],counts={list:0,external:0},library={...f.library,list:async user=>{counts.list++;return f.library.list(user);},getBook:async(user,id)=>{accessed.push(id);return f.library.getBook(user,id);}};
  const tools=createReadingAgentTools({library,user:f.user,bookId:f.book.bookId,passageId:f.input('x').passageId,searchWeb:async()=>{counts.external++;return {sources:[]};},searchBooks:async()=>{counts.external++;return [];}});
  const found=await tools.execute('reader_search',{query:'CurrentBookNeedle'});assert.equal(found.results.length,1);
  for(const [name,args] of [['reader_get_outline',{bookId:f.second.bookId}],['reader_read_chapter',{bookId:f.second.bookId,chapterId:f.second.chapters[0].id}],['reader_search',{query:'Needle',bookIds:[f.second.bookId]}],['reader_search_web',{query:'synthetic'}],['reader_recommend_books',{query:'synthetic'}]])assert.ok((await tools.execute(name,args)).error,name);
  assert.equal(counts.list,0);assert.equal(counts.external,0);assert.ok(accessed.every(id=>id===f.book.bookId));assert.equal(tools.definitions.some(d=>['reader_search_web','reader_recommend_books'].includes(d.name)),false);
});

test('explicit library scope survives service reopen while stale settings cannot overwrite it',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.service.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0}),{mode:'library',revision:1});
  await assert.rejects(f.service.configureScope(f.user,f.book.bookId,{mode:'book',baseRevision:0}),error=>error.status===412);
  await f.service.close();const reopened=await f.make();t.after(()=>reopened.close());assert.deepEqual((await reopened.view(f.user,f.book.bookId)).scope,{mode:'library',revision:1});assert.equal(f.calls.length,0);
  assert.deepEqual((await reopened.view(f.user,f.second.bookId)).scope,{mode:'book',revision:0});
  await assert.rejects(reopened.configureScope(f.other,f.book.bookId,{mode:'library',baseRevision:0}),error=>[401,404].includes(error.status));
});

test('separate services serialize simultaneous scope changes without overwriting a newer choice',async t=>{
  const f=await fixture(t),peer=await f.make();t.after(()=>peer.close());
  const results=await Promise.allSettled([f.service.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0}),peer.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,412);
  assert.deepEqual((await peer.view(f.user,f.book.bookId)).scope,{mode:'library',revision:1});
  assert.deepEqual(await peer.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:1}),{mode:'library',revision:1});assert.equal(f.calls.length,0);
});

test('a running turn freezes its scope until cancellation, including changes through another service',async t=>{
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const f=await fixture(t,{generator:async()=>{entered();await gate;return {kind:'conversation',summary:'Late synthetic answer.'};}}),peer=await f.make();t.after(()=>peer.close());
  const pending=f.service.send(f.user,f.book.bookId,f.input('running'));
  try{
    await started;await assert.rejects(peer.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0}),error=>error.status===409);
    assert.deepEqual((await peer.view(f.user,f.book.bookId)).scope,{mode:'book',revision:0});
    await peer.cancel(f.user,f.book.bookId,'running');assert.deepEqual(await peer.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0}),{mode:'library',revision:1});
  }finally{release();}
  assert.equal((await pending).status,'cancelled');assert.equal((await peer.view(f.user,f.book.bookId)).turns[0].answer,null);
});

test('legacy answers stay readable but unscoped history and invalid saved permissions fail closed',async t=>{
  const f=await fixture(t),hash=value=>createHash('sha256').update(value).digest('hex'),file=path.join(f.dir,'chat','users',hash(f.user.id),'chat',hash(f.book.bookId)+'.json');
  await f.service.view(f.user,f.book.bookId);const saved=JSON.parse(await readFile(file,'utf8'));
  saved.turns.push({id:'legacy',text:'Historic user question.',contentVersion:f.book.contentVersion,passageId:f.input('x').passageId,status:'completed',answer:{kind:'conversation',summary:'UnknownLegacyScopeWords',sourceRefs:[],origin:'ai'}},{id:'legacy-companion',kind:'companion',text:null,contentVersion:f.book.contentVersion,passageId:f.input('x').passageId,status:'completed',answer:{kind:'companion',summary:'OtherBookPrivateDetail in an unscoped historic companion.',sourceRefs:[],origin:'ai'}});await writeFile(file,JSON.stringify(saved));
  assert.equal((await f.service.view(f.user,f.book.bookId)).turns[0].answer.summary,'UnknownLegacyScopeWords');await f.service.send(f.user,f.book.bookId,f.input('fresh'));assert.deepEqual(f.calls[0].history,[]);
  const bad=JSON.parse(await readFile(file,'utf8'));bad.scope={mode:'all',revision:4};await writeFile(file,JSON.stringify(bad));const bytes=await readFile(file,'utf8');
  await assert.rejects(f.service.view(f.user,f.book.bookId),error=>error.status===409);await assert.rejects(f.service.send(f.user,f.book.bookId,f.input('denied')),error=>error.status===409);await assert.rejects(f.service.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:4}),error=>error.status===409);
  assert.equal(await readFile(file,'utf8'),bytes);assert.equal(f.calls.length,1);
});

test('stale send permission versions consume no question, generator or hourly request slots',async t=>{
  const f=await fixture(t);await f.service.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0});
  const before=await f.library.records(f.user,f.book.bookId);
  for(let n=0;n<11;n++)await assert.rejects(f.service.send(f.user,f.book.bookId,f.input('stale-'+n,0)),error=>error.status===412);
  assert.deepEqual((await f.library.records(f.user,f.book.bookId)).questions,before.questions);assert.equal(f.calls.length,0);
  for(let n=0;n<10;n++)assert.equal((await f.service.send(f.user,f.book.bookId,f.input('valid-'+n,1))).status,'completed');
  assert.equal(f.calls.length,10);
});

test('narrowing scope preserves saved answers but excludes wide-scope words from model history',async t=>{
  const histories=[];const f=await fixture(t,{generator:async job=>{histories.push(job.history);return {kind:'conversation',summary:histories.length===1?'WideScopeOnlyWords from another book.':'Only current-book response.'};}});
  await f.service.configureScope(f.user,f.book.bookId,{mode:'library',baseRevision:0});await f.service.send(f.user,f.book.bookId,f.input('wide-answer',1));
  await f.service.configureScope(f.user,f.book.bookId,{mode:'book',baseRevision:1});await f.service.send(f.user,f.book.bookId,f.input('narrow-answer',2));
  assert.equal(JSON.stringify(histories[1]).includes('WideScopeOnlyWords'),false);
  const view=await f.service.view(f.user,f.book.bookId);assert.equal(view.turns.length,2);assert.equal(view.turns[0].answer.summary,'WideScopeOnlyWords from another book.');
  await f.service.send(f.user,f.book.bookId,f.input('second-narrow',2));assert.ok(JSON.stringify(histories[2]).includes('Only current-book response.'));assert.equal(JSON.stringify(histories[2]).includes('WideScopeOnlyWords'),false);
});

test('an uncertain restored pending request keeps its original scope version until an explicit new send',()=>{
  let saved=null,serial=0;const draft='Keep this question.';const options={readDraft:()=>draft,readPending:()=>saved,writePending:(_owner,_book,value)=>{saved=value;},makeId:()=> 'scope-question-'+(++serial)};
  const data=revision=>({bookId:'selected',contentVersion:'v1',available:true,context:{passageId:'p1'},scope:{mode:revision?'library':'book',revision},turns:[]});
  const first=createLibraryChatState(options);first.setContext('owner','selected');first.resolveLoad(first.beginLoad(),data(0));const pending=first.beginSend();assert.equal(pending.payload.scopeRevision,0);first.rejectSend(pending.ticket,Error('Lost response'),{uncertain:true});assert.equal(saved.payload.scopeRevision,0);
  const reopened=createLibraryChatState(options);reopened.setContext('owner','selected');reopened.resolveLoad(reopened.beginLoad(),data(1));const retry=reopened.beginSend();assert.equal(retry.payload.id,pending.payload.id);assert.equal(retry.payload.scopeRevision,0);
  reopened.rejectSend(retry.ticket,Object.assign(Error('Confirm changed scope'),{status:412}),{uncertain:false});reopened.resolveLoad(reopened.beginLoad(),data(1));assert.equal(reopened.view().draft,draft);
  const explicit=reopened.beginSend();assert.notEqual(explicit.payload.id,pending.payload.id);assert.equal(explicit.payload.scopeRevision,1);
});

test('a confirmed scope change preserves new typing and supersedes an older scope GET',()=>{
  const state=createLibraryChatState();state.setContext('owner','selected');const data={bookId:'selected',available:true,contentVersion:'v1',context:{passageId:'p1'},scope:{mode:'book',revision:0},turns:[]};state.resolveLoad(state.beginLoad(),data);state.setDraft('Original question.');
  const change=state.beginScopeChange('library');assert.deepEqual(change.payload,{mode:'library',baseRevision:0});assert.equal(state.beginSend(),null);state.setDraft('New typing during scope save.');const old=state.beginLoad();
  assert.equal(state.resolveScopeChange(change.ticket,{mode:'library',revision:1}),true);assert.equal(state.resolveLoad(old,data),false);assert.equal(state.view().data.scope.mode,'library');assert.equal(state.view().draft,'New typing during scope save.');assert.equal(state.beginSend().payload.scopeRevision,1);
});

test('an unconfirmed scope response blocks generation until authoritative scope is read',()=>{
  const state=createLibraryChatState();state.setContext('owner','selected');const data={bookId:'selected',available:true,contentVersion:'v1',context:{passageId:'p1'},scope:{mode:'book',revision:0},turns:[]};state.resolveLoad(state.beginLoad(),data);state.setDraft('Keep my question.');
  const change=state.beginScopeChange('library');assert.equal(state.resolveScopeChange(change.ticket,{mode:'library',revision:8}),false);assert.equal(state.view().scopeUnconfirmed,true);assert.equal(state.beginSend(),null);
  state.resolveLoad(state.beginLoad(),{...data,scope:{mode:'library',revision:1}});assert.equal(state.view().scopeUnconfirmed,false);assert.equal(state.view().draft,'Keep my question.');assert.equal(state.view().canSend,true);
});

test('a scope response from another account or book cannot replace the current draft or setting',()=>{
  const state=createLibraryChatState();const data=bookId=>({bookId,available:true,contentVersion:'v1',context:{passageId:'p1'},scope:{mode:'book',revision:0},turns:[]});state.setContext('owner','first');state.resolveLoad(state.beginLoad(),data('first'));const old=state.beginScopeChange('library');
  state.setContext('another-owner','second');state.resolveLoad(state.beginLoad(),data('second'));state.setDraft('Second owner question.');assert.equal(state.resolveScopeChange(old.ticket,{mode:'library',revision:1}),false);assert.equal(state.view().draft,'Second owner question.');assert.deepEqual(state.view().data.scope,{mode:'book',revision:0});
});
