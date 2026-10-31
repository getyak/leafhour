import test from 'node:test';
import {MAX_BOOK_BYTES} from '../server/book-capacity.mjs';

test('a book is listed only after its chapter projection is readable, and publication retries are idempotent',async()=>{
 const rows=new Map(),blobs=new Map();let failChapters=true;
 const store={read:async(k,d)=>structuredClone(rows.get(k)??d),mutate:async(k,d,fn)=>{if(failChapters&&k.includes('/reading/')&&k.includes('/chapters/'))throw Object.assign(Error('temporary chapter storage failure'),{status:503});const value=structuredClone(rows.get(k)??d),result=await fn(value);rows.set(k,value);return result;},putBlob:async(k,b)=>{blobs.set(k,Buffer.from(b));},blob:async k=>blobs.get(k)};
 const library=await createLibraryService({dataDir:'synthetic-import-publication',catalogDir:null,dataStore:store}),user={id:'synthetic-owner'},input={filename:'publication.txt',bytes:Buffer.from('An original synthetic paragraph.')};await assert.rejects(library.importDocument(user,input),{status:503});assert.deepEqual(await library.list(user,{metadataOnly:true}),[]);failChapters=false;const book=await library.importDocument(user,input);assert.equal((await library.list(user,{metadataOnly:true}))[0].bookId,book.bookId);
});
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {extractDocument} from '../server/document-import.mjs';
import {textPdf} from './pdf-fixture.mjs';

test('extracts an actual PDF and preserves its page source; refuses a page without readable text',async()=>{
  const extracted=await extractDocument({filename:'reading.pdf',bytes:textPdf()});
  assert.equal(extracted.pages[0].page,1);assert.match(extracted.pages[0].text,/Reading is a conversation/);
  await assert.rejects(extractDocument({filename:'scan.pdf',bytes:textPdf('')}),e=>e.status===422);
});

test('invalid restored private book and conflicting source versions cannot erase existing comments',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-conflict-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'owner'};
  const book=await library.importDocument(user,{filename:'book.txt',bytes:Buffer.from('Original text.')});
  await library.addComment(user,book.bookId,{id:'old',passageId:book.sections[0].paragraphs[0].id,text:'Keep this.'});
  const backup=await library.exportLibrary(user);backup.books[0].book.contentVersion='different';
  await assert.rejects(library.restoreLibrary(user,backup),e=>e.status===409);
  assert.equal((await library.records(user,book.bookId)).comments[0].text,'Keep this.');
});

test('malformed backup metadata and records are rejected before any book is written',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-backup-validation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=await createLibraryService({dataDir:path.join(dir,'source'),catalogDir:null}),user={id:'owner'};
  const book=await source.importDocument(user,{filename:'one.txt',bytes:Buffer.from('Source one.')});
  await source.importDocument(user,{filename:'two.txt',bytes:Buffer.from('Source two.')});
  await source.addComment(user,book.bookId,{id:'note',passageId:book.sections[0].paragraphs[0].id,text:'My thought.'});
  const valid=await source.exportLibrary(user);
  const cases=[
    b=>{b.books[1].book.chapters[0].title=null;},
    b=>{b.books[1].book.sections[0].paragraphs[0]=null;},
    b=>{b.books[0].records.comments[0].createdAt='not-a-date';},
    b=>{delete b.books[0].records.comments[0].id;},
    b=>{b.books[0].book.sections[0].paragraphs[0].translations={literal:{text:'Wrong authorship',origin:'user',status:'draft'}};},
    b=>{b.books[0].records.position={passageId:book.sections[0].paragraphs[0].id,chapterId:'ch01',mode:'en',variant:'literal',offset:'bad'};},
    b=>{b.books[0].records.readingSessions=[{id:'session',startedAt:'bad',durationSeconds:42}];},
    b=>{b.books.push(structuredClone(b.books[0]));},
    b=>{b.books[1].book.annotations=[null];},
    b=>{b.books[1].book.glossary=[null];},
    b=>{b.books[1].book.source.url='javascript:alert(1)';},
    b=>{b.books[1].book.readingStart={chapterId:'missing',passageId:b.books[1].book.sections[0].paragraphs[0].id};}
  ];
  for(let i=0;i<cases.length;i++){
    const backup=structuredClone(valid);cases[i](backup);
    const target=await createLibraryService({dataDir:path.join(dir,'target-'+i),catalogDir:null});
    await assert.rejects(target.restoreLibrary(user,backup),e=>e.status===400,'invalid case '+i);
    assert.equal((await target.list(user)).length,0,'no partial write for invalid case '+i);
  }
});

test('actual default catalog exports including front matter and appendices restore successfully',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-catalog-backup-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=await createLibraryService({dataDir:path.join(dir,'source')}),user={id:'owner'};
  const backup=await source.exportLibrary(user),target=await createLibraryService({dataDir:path.join(dir,'target')});
  assert.equal(backup.books.length,64);assert.ok(backup.books.some(e=>e.book.chapters.some(c=>c.number===0)));
  assert.equal((await target.restoreLibrary(user,backup)).restored,64);
  assert.equal((await target.getBook(user,'gutenberg-alice')).readingStart.chapterId,'ch01');
});

test('restoring an old position advances the local revision so stale tabs cannot overwrite it',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-restore-revision-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'owner'},book=await library.importDocument(user,{filename:'two.txt',bytes:Buffer.from('First.\n\nSecond.')});
  const input={chapterId:'ch01',passageId:book.sections[0].paragraphs[0].id,offset:100,mode:'en',variant:'literal'};
  await library.saveProgress(user,book.bookId,{...input,baseRevision:0});const backup=await library.exportLibrary(user);
  await library.saveProgress(user,book.bookId,{...input,passageId:book.sections[0].paragraphs[1].id,baseRevision:1});
  await library.restoreLibrary(user,backup);
  const position=(await library.records(user,book.bookId)).position;assert.equal(position.revision,3);assert.equal(position.passageId,input.passageId);
  await assert.rejects(library.saveProgress(user,book.bookId,{...input,baseRevision:1}),e=>e.status===409);
});

test('imports real text, isolates private books and records, supports scoped revocable grants and restore',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-library-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null});
  const alice={id:'alice'},bob={id:'bob'};
  const book=await library.importDocument(alice,{filename:'my-book.txt',bytes:Buffer.from('First passage.\n\nSecond passage.\n\nThird passage.')});
  assert.equal(book.sections[0].paragraphs.length,3);
  assert.equal(book.sections[0].paragraphs[0].original,'First passage.');
  assert.deepEqual(book.sections[0].paragraphs[0].translations,{});
  await assert.rejects(library.getBook(bob,book.bookId),e=>e.status===404);
  await assert.rejects(library.getBook(null,book.bookId),e=>e.status===404);
  const p=book.sections[0].paragraphs[0].id;
  const note={id:'comment-1',passageId:p,text:'My own thought',origin:'user'};
  await library.addComment(alice,book.bookId,note);await library.addComment(alice,book.bookId,note);
  assert.equal((await library.records(alice,book.bookId)).comments.length,1);
  await assert.rejects(library.addComment(alice,book.bookId,{...note,text:'conflicting'}),e=>e.status===409);
  await assert.rejects(library.addComment(alice,book.bookId,{...note,id:'bad',origin:'ai'}));
  const grant=await library.createGrant(alice,{bookId:book.bookId,scopes:['content']});
  assert.equal((await library.authorize(grant.token,book.bookId,'content')).id,'alice');
  await assert.rejects(library.authorize(grant.token,book.bookId,'notes'),e=>e.status===403);
  await library.revokeGrant(alice,grant.id);
  await assert.rejects(library.authorize(grant.token,book.bookId,'content'),e=>e.status===403);
  const backup=await library.exportLibrary(alice);
  assert.ok(!JSON.stringify(backup).includes(grant.token));
  const restored=await createLibraryService({dataDir:path.join(dir,'fresh'),catalogDir:null});
  await restored.restoreLibrary(bob,backup);
  const books=await restored.list(bob);assert.equal(books.length,1);
  assert.equal((await restored.records(bob,books[0].bookId)).comments[0].text,note.text);
  assert.equal((await restored.getBook(bob,books[0].bookId)).sections[0].paragraphs[0].id,p);
});

test('rejects disguised PDFs, binary text, empty and oversized files',async()=>{
  await assert.rejects(extractDocument({filename:'fake.pdf',bytes:Buffer.from('not a PDF')}),/PDF/);
  await assert.rejects(extractDocument({filename:'empty.txt',bytes:Buffer.alloc(0)}));
  await assert.rejects(extractDocument({filename:'binary.txt',bytes:Buffer.from([0,1,2,3])}));
  await assert.rejects(extractDocument({filename:'book.exe',bytes:Buffer.from('book')}));
  await assert.rejects(extractDocument({filename:'huge.txt',bytes:Buffer.alloc(20*1024*1024+1)}),e=>e.status===413);
});

test('translation only uses adjacent passages, saves independent draft versions and never pretends failure is translation',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-translation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let received;
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async context=>{received=context;return {literal:'第一段。',interpretive:'开篇的这一段。',model:'test-provider'};}});
  const user={id:'reader'},book=await library.importDocument(user,{filename:'source.txt',bytes:Buffer.from('One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.')});
  const paragraphs=book.sections[0].paragraphs;
  await library.translate(user,book.bookId,paragraphs[2].id);
  assert.deepEqual(received.passages.map(p=>p.original),['Two.','Three.','Four.']);
  const updated=await library.getBook(user,book.bookId);
  assert.equal(updated.sections[0].paragraphs[2].translations.literal.text,'第一段。');
  assert.equal(updated.sections[0].paragraphs[2].translations.interpretive.status,'draft');
  assert.deepEqual(updated.sections[0].paragraphs[0].translations,{});
});

test('an incomplete model answer cannot publish one translation as a complete bilingual result',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-incomplete-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>({literal:'只有直译'})}),user={id:'reader'};
  const book=await library.importDocument(user,{filename:'text.txt',bytes:Buffer.from('Keep the original intact.')}),passage=book.sections[0].paragraphs[0];
  await assert.rejects(library.translate(user,book.bookId,passage.id),e=>e.status===502);
  const unchanged=(await library.getBook(user,book.bookId)).sections[0].paragraphs[0];assert.equal(unchanged.original,passage.original);assert.deepEqual(unchanged.translations,{});
});

test('Chinese originals remain originals and never invoke Chinese-to-Chinese translation',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-chinese-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let calls=0;const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{calls++;return {literal:'生成文字',interpretive:'另一份生成文字'};}}),user={id:'owner'};
  const book=await library.importDocument(user,{filename:'chinese.txt',bytes:Buffer.from('读一本书，可以先保留自己的问题。\n\n原文和个人想法，应当分别保存。')});
  assert.equal(book.sourceLanguage,'zh');const p=book.sections[0].paragraphs[0];
  await assert.rejects(library.translate(user,book.bookId,p.id),e=>e.status===400);assert.equal(calls,0);
  assert.equal((await library.getBook(user,book.bookId)).sections[0].paragraphs[0].original,'读一本书，可以先保留自己的问题。');
  assert.deepEqual((await library.getBook(user,book.bookId)).sections[0].paragraphs[0].translations,{});
});
test('an English source mentioning a Chinese term is still classified by its main text',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-main-language-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null});
  const book=await library.importDocument({id:'owner'},{filename:'english.txt',bytes:Buffer.from('The term 旁读 describes reading with your own thoughts in the margin. This paragraph remains an English original.')});
  assert.equal(book.sourceLanguage,'en');
  const backup=await library.exportLibrary({id:'owner'});backup.books[0].book.sourceLanguage='zh';
  const target=await createLibraryService({dataDir:path.join(dir,'legacy-target'),catalogDir:null});await target.restoreLibrary({id:'owner'},backup);
  assert.equal((await target.getBook({id:'owner'},book.bookId)).sourceLanguage,'en','old importer language metadata must not disable English originals');
});

test('reattaching an original after cross-account restore returns the existing book and notes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-original-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=await createLibraryService({dataDir:path.join(dir,'source'),catalogDir:null}),target=await createLibraryService({dataDir:path.join(dir,'target'),catalogDir:null}),alice={id:'alice'},bob={id:'bob'},bytes=Buffer.from('Keep this source and its own notes.');
  const book=await source.importDocument(alice,{filename:'original.txt',bytes});await source.addComment(alice,book.bookId,{id:'note',passageId:book.sections[0].paragraphs[0].id,text:'A thought that must stay with this book.'});
  await target.restoreLibrary(bob,await source.exportLibrary(alice));const attached=await target.importDocument(bob,{filename:'original.txt',bytes});
  assert.equal(attached.bookId,book.bookId);assert.equal((await target.list(bob)).length,1);assert.equal((await target.records(bob,attached.bookId)).comments[0].text,'A thought that must stay with this book.');assert.deepEqual((await target.getOriginal(bob,attached.bookId)).bytes,bytes);
});

test('automatic native and mixed PDF books retain source-checked original downloads',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reader-auto-original-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null}),user={id:'isolated-owner'},bytes=textPdf();
 for(const processor of ['pdfjs-native','native+paddle-auto-v1']){const source=Buffer.concat([bytes,Buffer.from('\n%'+processor)]),book=await library.importExtracted(user,{filename:'book.pdf',bytes:source,extracted:{format:'pdf',processor,contentVersion:'c'.repeat(64),review:'extracted_unreviewed',pages:[{page:1,text:'A source paragraph.'}]}});assert.equal((await library.originalInfo(user,book.bookId)).available,true);assert.deepEqual((await library.getOriginal(user,book.bookId)).bytes,source);}
});

test('local imports enforce logical capacity before saving a shelf entry',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reader-local-capacity-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null}),user={id:'capacity-fixture'};
 await assert.rejects(library.importExtracted(user,{filename:'large.pdf',bytes:Buffer.from('%PDF-synthetic'),extracted:{format:'pdf',review:'extracted_unreviewed',pages:[{page:1,text:'A'+'\0'.repeat(Math.ceil(MAX_BOOK_BYTES/6))}]}}),e=>e.status===413);assert.deepEqual(await library.list(user),[]);
});
