import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('introduction HTTP uses the existing authenticated owner, CSRF, version and no-store boundaries',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-http-'));let calls=0,quoteCalls=0;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:async()=>{calls++;return {text:'开头描绘了留意当下、保留问题的阅读方式。'};},giftQuoteGenerator:async job=>{quoteCalls++;const entry=job.pool[0],text='Read slowly and keep a question.';return {bookId:job.bookId,contentVersion:job.contentVersion,passageId:entry.passageId,chapterId:entry.chapterId,start:0,end:[...text].length,text};}});
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
  const quoted=await fetch(base+'/api/library/books/'+book.bookId+'/gift-quote',{method:'POST',headers,body:'{}'});assert.equal(quoted.status,200);const quote=await quoted.json();
  assert.equal(quote.quote.selection,'ai-selected');assert.equal(quote.quote.text,'Read slowly and keep a question.');assert.equal(quoteCalls,1);assert.equal(calls,1,'quote preparation does not regenerate the introduction');assert.deepEqual(await server.portal.gifts.list(session.user,book.bookId),[],'neither private preparation publishes a gift');
  await server.portal.auth.logout(session.token);assert.notEqual((await fetch(url,{headers})).status,200);
});

test('disconnect cancels generation and never saves a late result',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-disconnect-'));let started,finish;const began=new Promise(r=>started=r);
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:async job=>{started(job.signal);return new Promise(r=>finish=r);}});
  let settled;const completed=new Promise(resolve=>settled=resolve),generate=server.portal.bookIntroductions.generate;
  server.portal.bookIntroductions.generate=async(...args)=>{try{return await generate(...args);}finally{settled();}};
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'Cancel.txt',bytes:Buffer.from('Cancel this opening.')}),url=base+'/api/library/books/'+book.bookId+'/introduction',controller=new AbortController();
  const pending=fetch(url,{method:'POST',signal:controller.signal,headers:{Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,'Content-Type':'application/json',Origin:base},body:JSON.stringify({contentVersion:book.contentVersion})});
  const signal=await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(Error('generator never started')),1000))]);controller.abort();await assert.rejects(pending);
  if(!signal.aborted)await new Promise(r=>signal.addEventListener('abort',r,{once:true}));finish({text:'断开后不该保存的简介。'});await completed;
  assert.equal((await server.portal.library.getBook(session.user,book.bookId)).introduction,undefined);
});

test('preserving an existing book rejects incompatible introduction provenance before restore writes',async t=>{
  const {createLibraryService}=await import('../server/library-service.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-restore-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'isolated-restore-owner'},source=await createLibraryService({dataDir:path.join(dir,'source'),catalogDir:null});
  await source.importDocument(user,{filename:'opening.txt',bytes:Buffer.from('Preface material.\n\nBody opening.\n\nMore body.')});
  const backup=await source.exportLibrary(user),book=backup.books[0].book,paragraphs=book.sections.flatMap(s=>s.paragraphs);
  book.chapters=[{id:'front',number:0,kind:'frontmatter',title:{zh:'前言',en:''}},{id:'body',number:1,kind:'body',title:{zh:'正文',en:''}}];
  book.sections=[{number:1,chapterId:'front',paragraphs:[paragraphs[0]]},{number:2,chapterId:'body',paragraphs:paragraphs.slice(1)}];
  const target=await createLibraryService({dataDir:path.join(dir,'target'),catalogDir:null});await target.restoreLibrary(user,backup);
  const before=await target.exportLibrary(user),incoming=structuredClone(backup),entry=incoming.books[0].book;
  entry.chapters[0].kind='body';entry.chapters[0].number=1;
  entry.introduction={kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text:'An opening introduction.',contentVersion:book.contentVersion,createdAt:'2026-10-18T00:00:00Z',model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:[paragraphs[0].id]};
  await target.validateRestore(user,incoming);
  await assert.rejects(target.restoreLibrary(user,incoming,{preserveExisting:true}),e=>e.status===409);
  await assert.rejects(target.previewRestoreBooks(user,incoming),e=>e.status===409);
  assert.deepEqual((await target.exportLibrary(user)).books,before.books);
});

test('default public-book restore validates the introduction against retained catalog metadata',async t=>{
  const {createLibraryService}=await import('../server/library-service.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-public-restore-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'isolated-public-restore-owner'},catalogDir=path.join(dir,'catalog');await mkdir(catalogDir);
  await writeFile(path.join(catalogDir,'opening.txt'),Array.from({length:7},(_,i)=>'Original paragraph '+i+'.').join('\n\n'));
  await writeFile(path.join(catalogDir,'manifest.json'),JSON.stringify([{id:'isolated-public-opening',file:'opening.txt',title:'目录原书',originalTitle:'Catalog opening',author:'Fixture',sourceUrl:'https://example.org/book',description:'Provided catalog description.'}]));
  const target=await createLibraryService({dataDir:path.join(dir,'target'),catalogDir}),before=await target.exportLibrary(user),incoming=structuredClone(before),book=incoming.books[0].book,paragraphs=book.sections.flatMap(s=>s.paragraphs);
  book.chapters=[{id:'front',number:0,kind:'frontmatter',title:{zh:'前言',en:''}},{id:'body',number:1,kind:'body',title:{zh:'正文',en:''}}];
  book.sections=[{number:1,chapterId:'front',paragraphs:paragraphs.slice(0,6)},{number:2,chapterId:'body',paragraphs:paragraphs.slice(6)}];
  book.introduction={kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text:'Incoming opening introduction.',contentVersion:book.contentVersion,createdAt:'2026-10-18T00:00:00Z',model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:[paragraphs[6].id]};
  await target.validateRestore(user,incoming);
  await assert.rejects(target.restoreLibrary(user,incoming),e=>e.status===409);
  assert.deepEqual((await target.exportLibrary(user)).books,before.books);
});

test('default private-book restore validates a retained introduction when an older backup omits it',async t=>{
  const {createLibraryService}=await import('../server/library-service.mjs'),{createBookIntroductionService}=await import('../server/book-introduction.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-intro-private-restore-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'isolated-private-restore-owner'},target=await createLibraryService({dataDir:path.join(dir,'target'),catalogDir:null});
  const original=await target.importDocument(user,{filename:'opening.txt',bytes:Buffer.from(Array.from({length:7},(_,i)=>'Original paragraph '+i+'.').join('\n\n'))}),incoming=await target.exportLibrary(user);
  await createBookIntroductionService({library:target,generator:async()=>({text:'Saved original opening introduction.'})}).generate(user,original.bookId,{contentVersion:original.contentVersion});
  const before=await target.exportLibrary(user),book=incoming.books[0].book,paragraphs=book.sections.flatMap(s=>s.paragraphs);
  assert.equal(Object.hasOwn(book,'introduction'),false);
  book.chapters=[{id:'front',number:0,kind:'frontmatter',title:{zh:'前言',en:''}},{id:'body',number:1,kind:'body',title:{zh:'正文',en:''}}];
  book.sections=[{number:1,chapterId:'front',paragraphs:paragraphs.slice(0,6)},{number:2,chapterId:'body',paragraphs:paragraphs.slice(6)}];
  await target.validateRestore(user,incoming);
  await assert.rejects(target.restoreLibrary(user,incoming),e=>e.status===409);
  assert.deepEqual((await target.exportLibrary(user)).books,before.books);
});
