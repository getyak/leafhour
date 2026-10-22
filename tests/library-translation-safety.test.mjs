import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';

const stamp='2026-10-18T00:00:00.000Z';
const generated={literal:{text:'生成直译',status:'draft',variant:'literal',origin:'ai',model:'synthetic',sourceVersion:'',createdAt:stamp},interpretive:{text:'生成意译',status:'draft',variant:'interpretive',origin:'ai',model:'synthetic',sourceVersion:'',createdAt:stamp}};
test('an expected content version is rejected before any provider request while unversioned callers stay compatible',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'translation-version-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let calls=0,context=null;
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async input=>{calls++;context=input;return {literal:'新的直译',interpretive:'新的意译',model:'synthetic'};}});
  const user={id:'reader'},book=await library.importDocument(user,{filename:'source.txt',bytes:Buffer.from('One paragraph.\n\nTwo paragraph.')});
  const paragraphs=book.sections[0].paragraphs;
  await assert.rejects(library.translate(user,book.bookId,paragraphs[0].id,{expectedContentVersion:'stale-version'}),e=>e.status===409);
  assert.equal(calls,0,'a stale version is refused before any charged provider request');
  await assert.rejects(library.translate(user,book.bookId,paragraphs[0].id,{expectedContentVersion:42}),e=>e.status===400);
  assert.equal(calls,0);
  const saved=await library.translate(user,book.bookId,paragraphs[0].id,{expectedContentVersion:book.contentVersion});
  assert.equal(saved.translations.literal.text,'新的直译');assert.equal(calls,1);
  assert.equal(context.sourceVersion,book.contentVersion);
  const legacy=await library.translate(user,book.bookId,paragraphs[1].id);
  assert.equal(legacy.translations.interpretive.text,'新的意译','existing unversioned callers keep working');
  assert.equal(calls,2);
});

test('a source update during generation cannot recreate the old book or publish the old overlay',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'translation-source-race-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'reader'};
  let bookFile;
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{
    const current=JSON.parse(await readFile(bookFile,'utf8'));
    current.contentVersion='edition-2';
    current.sections[0].paragraphs[0].original='One revised paragraph.';
    await writeFile(bookFile,JSON.stringify(current));
    return {literal:'过期直译',interpretive:'过期意译'};
  }});
  const book=await library.importDocument(user,{filename:'source.txt',bytes:Buffer.from('One paragraph.\n\nTwo paragraph.')});
  bookFile=path.join(dir,'users',digest(user.id),'books',digest(book.bookId)+'.json');
  const overlayFile=path.join(dir,'users',digest(user.id),'translations',digest(book.bookId)+'.json');
  const passage=book.sections[0].paragraphs[0];
  await assert.rejects(library.translate(user,book.bookId,passage.id),e=>e.status===409);
  const latest=await library.getBook(user,book.bookId);
  assert.equal(latest.contentVersion,'edition-2');
  assert.equal(latest.sections[0].paragraphs[0].original,'One revised paragraph.');
  assert.deepEqual(latest.sections[0].paragraphs[0].translations,{},'the old overlay never publishes onto the new source');
  const overlay=JSON.parse(await readFile(overlayFile,'utf8').catch(()=>'{}'));
  assert.equal(overlay[passage.id],undefined);
});

test('a book deleted during generation is not recreated and keeps its overlay unwritten',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'translation-delete-race-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'reader'};
  let bookFile;
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{await unlink(bookFile);return {literal:'生成直译',interpretive:'生成意译'};}});
  const book=await library.importDocument(user,{filename:'source.txt',bytes:Buffer.from('One paragraph.\n\nTwo paragraph.')});
  bookFile=path.join(dir,'users',digest(user.id),'books',digest(book.bookId)+'.json');
  const overlayFile=path.join(dir,'users',digest(user.id),'translations',digest(book.bookId)+'.json');
  await assert.rejects(library.translate(user,book.bookId,book.sections[0].paragraphs[0].id),e=>e.status===404);
  await assert.rejects(readFile(bookFile,'utf8'),e=>e.code==='ENOENT','a deleted book stays deleted');
  const overlay=JSON.parse(await readFile(overlayFile,'utf8').catch(()=>'{}'));
  assert.deepEqual(overlay,{},'no stale translation overlay survives a deleted source');
});

test('reviewed translations and concurrently added versions are preserved at save time',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'translation-preserve-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'reader'};
  let overlayFile;
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{
    const current=JSON.parse(await readFile(overlayFile,'utf8').catch(()=>'{}'));
    const savedBook=JSON.parse(await readFile(path.join(dir,'users',digest(user.id),'books',digest(book.bookId)+'.json'),'utf8'));
    current[savedBook.sections[0].paragraphs[0].id]={contentVersion:savedBook.contentVersion,translations:{
      literal:{...generated.literal,text:'人工复核直译',status:'reviewed',sourceVersion:savedBook.contentVersion},
      interpretive:{...generated.interpretive,text:'并发生成的意译草稿',sourceVersion:savedBook.contentVersion}
    }};
    await mkdir(path.dirname(overlayFile),{recursive:true,mode:0o700});
    await writeFile(overlayFile,JSON.stringify(current));
    return {literal:'本次生成直译',interpretive:'本次生成意译'};
  }});
  const book=await library.importDocument(user,{filename:'source.txt',bytes:Buffer.from('One paragraph.\n\nTwo paragraph.')});
  overlayFile=path.join(dir,'users',digest(user.id),'translations',digest(book.bookId)+'.json');
  const passage=book.sections[0].paragraphs[0];
  const saved=await library.translate(user,book.bookId,passage.id);
  assert.equal(saved.translations.literal.text,'人工复核直译','a reviewed translation is never overwritten by generation');
  assert.equal(saved.translations.interpretive.text,'并发生成的意译草稿','a version added during generation is never overwritten');
  const reread=await library.getBook(user,book.bookId);
  assert.equal(reread.sections[0].paragraphs[0].translations.literal.text,'人工复核直译');
  assert.equal(reread.sections[0].paragraphs[0].translations.interpretive.text,'并发生成的意译草稿');
});

test('saving translations keeps account ownership and never touches personal records',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'translation-owner-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>({literal:'生成直译',interpretive:'生成意译'})}),alice={id:'alice'},bob={id:'bob'};
  const book=await library.importDocument(alice,{filename:'source.txt',bytes:Buffer.from('One paragraph.\n\nTwo paragraph.')});
  await library.addComment(alice,book.bookId,{id:'note-1',passageId:book.sections[0].paragraphs[0].id,text:'我的原话'});
  await assert.rejects(library.translate(bob,book.bookId,book.sections[0].paragraphs[0].id),e=>e.status===404);
  await assert.rejects(library.translate(bob,book.bookId,book.sections[0].paragraphs[0].id,{expectedContentVersion:book.contentVersion}),e=>e.status===404);
  const records=await library.records(alice,book.bookId);
  assert.equal(records.comments.length,1);
  assert.equal(records.comments[0].text,'我的原话');
});

// A trusted internal receipt links saved variants to the financial operation.
test('translation keeps an operation receipt only on newly saved variants',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'translation-credit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let calls=0;const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{calls++;return {literal:'独立直译',interpretive:'独立意译'};}});
 const user={id:'u'},book=await library.importDocument(user,{filename:'receipt.txt',bytes:Buffer.from('Readable source paragraph.')}),passageId=book.sections[0].paragraphs[0].id;
 const generationReceipt={operationId:'credit-test',requestId:'request-test'};
 const result=await library.translate(user,book.bookId,passageId,{expectedContentVersion:book.contentVersion,generationReceipt});
 assert.deepEqual(result.translations.literal.generationReceipt,generationReceipt);
 assert.deepEqual(result.translations.interpretive.generationReceipt,generationReceipt);
 const cached=await library.translate(user,book.bookId,passageId,{generationReceipt:{operationId:'another',requestId:'other'}});
 assert.deepEqual(cached.translations.literal.generationReceipt,generationReceipt);assert.equal(calls,1);
});

test('revoked generation permission blocks saving a late translation',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'translation-revoked-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let active=true,calls=0;const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>{calls++;active=false;return {literal:'不应保存',interpretive:'不应保存'};}});
 const user={id:'u'},book=await library.importDocument(user,{filename:'fenced.txt',bytes:Buffer.from('An original sentence.')}),id=book.sections[0].paragraphs[0].id;
 await assert.rejects(library.translate(user,book.bookId,id,{authorizeGeneration:async()=>active}),e=>e.status===409);
 assert.equal(calls,1);assert.deepEqual((await library.getBook(user,book.bookId)).sections[0].paragraphs[0].translations,{});
 await assert.rejects(library.translate(user,book.bookId,id,{authorizeGeneration:async()=>false}),e=>e.status===409);assert.equal(calls,1);
});
