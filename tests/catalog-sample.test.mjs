import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {passagePresentation} from '../app/passage-layers.mjs';
import {createReaderServer} from '../server/server.mjs';

test('the local trial serves its imported module and both Chinese drafts over HTTP to guests',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sample-http-'));const server=await createReaderServer({bookPath:path.join(dir,'missing.json'),recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null,allowLocal:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,module=await fetch(base+'/catalog-sample.mjs');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
  const response=await fetch(base+'/api/library/books/gutenberg-alice'),book=await response.json();assert.equal(response.status,200);assert.equal(book.chineseSample.paragraphs,6);assert.ok(book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===book.readingStart.passageId).translations.interpretive.text);
});

test('guests can read independent Chinese openings without an account or model call; later text stays untranslated',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-sample-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
  const service=await createLibraryService({dataDir:dir,translator:async()=>{calls++;throw Error('Unexpected generation');}});
  const expected={'gutenberg-alice':6,'gutenberg-meditations':4,'gutenberg-walden':4};
  for(const row of await service.list(null)){
    const book=await service.getBook(null,row.bookId),rows=book.sections.flatMap(s=>s.paragraphs),start=rows.findIndex(p=>p.id===book.readingStart.passageId);
    assert.equal(book.chineseSample.paragraphs,expected[book.bookId]);assert.deepEqual(row.chineseSample,book.chineseSample);
    for(const p of rows.slice(start,start+expected[book.bookId])){
      assert.notEqual(p.translations.literal.text,p.translations.interpretive.text);
      for(const variant of ['literal','interpretive']){const draft=p.translations[variant];assert.equal(draft.status,'draft');assert.equal(draft.origin,'ai');assert.equal(draft.variant,variant);assert.equal(draft.sourceVersion,book.contentVersion);assert.ok(draft.translator);assert.equal(passagePresentation(p,{variant}).layers[0].kind,'translation');}
    }
    const next=rows[start+expected[book.bookId]];assert.deepEqual(next.translations,{});assert.match(passagePresentation(next).notice,/尚未翻译/);
    await assert.rejects(service.translate(null,book.bookId,rows[start].id),{status:401});
    const changed=await service.getBook(null,book.bookId);changed.sections.flatMap(s=>s.paragraphs)[start].translations.literal.text='Changed';assert.notEqual((await service.getBook(null,book.bookId)).sections.flatMap(s=>s.paragraphs)[start].translations.literal.text,'Changed');
  }
  assert.equal(calls,0);
});

test('published samples refuse another source version and preserve personal translation overrides',async t=>{
  const {applyCatalogSample}=await import('../server/catalog-sample.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'sample-isolation-'));t.after(()=>rm(dir,{recursive:true,force:true}));const service=await createLibraryService({dataDir:dir}),user={id:'sample-owner'};
  const book=await service.getBook(null,'gutenberg-alice'),asset=JSON.parse(await readFile('catalog/translations/gutenberg-alice.zh.json','utf8'));
  const bare=structuredClone(book);delete bare.chineseSample;for(const p of bare.sections.flatMap(s=>s.paragraphs))p.translations={};
  assert.equal(applyCatalogSample(bare,{...asset,contentVersion:'different'}).chineseSample,undefined);
  assert.throws(()=>applyCatalogSample(bare,{...asset,passages:[{...asset.passages[0],id:'unknown'}]}));
  const personal=structuredClone(book),p=personal.sections.flatMap(s=>s.paragraphs).find(p=>p.id===personal.readingStart.passageId);p.translations.literal.text='自己的直译草稿';
  await service.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book:personal,records:await service.records(user,book.bookId)}]});
  assert.equal((await service.getBook(user,book.bookId)).sections.flatMap(s=>s.paragraphs).find(r=>r.id===p.id).translations.literal.text,'自己的直译草稿');
  assert.notEqual((await service.getBook(null,book.bookId)).sections.flatMap(s=>s.paragraphs).find(r=>r.id===p.id).translations.literal.text,'自己的直译草稿');
  const imported=await service.importDocument(user,{filename:'my-alice.txt',bytes:Buffer.from('Alice was beginning to read a book of her own.')});assert.equal(imported.chineseSample,undefined);assert.deepEqual(imported.sections[0].paragraphs[0].translations,{});
});

test('Chinese trial links explicitly open the prepared start while ordinary reading keeps saved preferences',async()=>{
  const {catalogReadingMode,chineseSampleEntry}=await import('../app/catalog-sample.mjs');
  const book={bookId:'b1',visibility:'public',readingStart:{chapterId:'ch01',passageId:'p1'},chineseSample:{paragraphs:4,startPassageId:'p1'}};
  assert.equal(catalogReadingMode(book),'zh');assert.equal(catalogReadingMode({...book,chineseSample:undefined}),'en');
  assert.deepEqual(chineseSampleEntry(book,new URLSearchParams('book=b1&sample=zh')),{chapterId:'ch01',passageId:'p1',mode:'zh',variant:'interpretive',offset:160});
  assert.equal(chineseSampleEntry(book,new URLSearchParams('book=b1')),null);assert.equal(chineseSampleEntry(book,new URLSearchParams('book=other&sample=zh')),null);
});
