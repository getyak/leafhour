import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createBookGifts} from '../server/book-gifts.mjs';
import {authFixture} from './auth-fixture.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';

const user={id:'gift-receive-fixture'};
const backupOf=book=>({kind:'marginalia-library',schemaVersion:1,books:[{book,records:{...readingRecords(),bookId:book.bookId,contentVersion:book.contentVersion}}]});
const translation=text=>({text,variant:'literal',origin:'ai',status:'draft'});
async function hosted(){const fixture=authFixture(),create=()=>createLibraryService({dataDir:'gift-receive-test',catalogDir:null,dataStore:fixture.store()});return {fixture,create,library:await create()};}

test('gift reception separates a readable original and translations into bounded hosted documents',async()=>{
  const {fixture,library}=await hosted(),book=structuredClone(readingBook);
  for(let i=0;i<60;i++)book.sections[0].paragraphs.push({id:'large-'+i,original:'x'.repeat(20000),translations:{literal:translation('l'.repeat(10000)),interpretive:{...translation('i'.repeat(10000)),variant:'interpretive'}},annotationIds:[],termIds:[]});
  assert.ok(Buffer.byteLength(JSON.stringify(book))>2000000);
  const received=await library.receiveGift(user,backupOf(book));assert.equal(received.bookId,book.bookId);assert.equal(received.alreadyOwned,false);
  const saved=await library.getBook(user,book.bookId);assert.equal(saved.sections[0].paragraphs.at(-1).original,'x'.repeat(20000));assert.equal(saved.sections[0].paragraphs.at(-1).translations.literal.text,'l'.repeat(10000));
  assert.ok([...fixture.rows.values()].every(row=>Buffer.byteLength(JSON.stringify(row.value))<=3500000));
  const raw=[...fixture.rows.entries()].find(([key])=>key.includes('/books/'))[1].value;assert.deepEqual(raw.sections[0].paragraphs.at(-1).translations,{});
});

test('hosted gifts exceeding readable combined size are refused before any original or overlay write',async()=>{
  const {fixture,library}=await hosted(),book=structuredClone(readingBook);
  for(let i=0;i<110;i++)book.sections[0].paragraphs.push({id:'combined-'+i,original:'x'.repeat(20000),translations:{literal:translation('l'.repeat(10000)),interpretive:{...translation('i'.repeat(10000)),variant:'interpretive'}},annotationIds:[],termIds:[]});
  await assert.rejects(library.receiveGift(user,backupOf(book)),error=>error.status===413&&/云端|容量/.test(error.message));
  assert.equal(fixture.rows.size,0);assert.deepEqual(await library.list(user),[]);assert.equal((await library.shelfState(user)).revision,0);
});

test('local gift reception retains larger books without the hosted response limit',async t=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'gift-local-large-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir,catalogDir:null}),book=structuredClone(readingBook);
  for(let i=0;i<110;i++)book.sections[0].paragraphs.push({id:'local-'+i,original:'x'.repeat(20000),translations:{literal:translation('l'.repeat(10000)),interpretive:{...translation('i'.repeat(10000)),variant:'interpretive'}},annotationIds:[],termIds:[]});
  await library.receiveGift(user,backupOf(book));assert.equal((await library.getBook(user,book.bookId)).sections[0].paragraphs.at(-1).translations.literal.text,'l'.repeat(10000));
});

test('accepting a public Alice gift imports missing translations and leaves recipient notes intact on repeat',async()=>{
  const fixture=authFixture(),dataStore=fixture.store(),library=await createLibraryService({dataDir:'public-gift-alice',dataStore,translator:async()=>({literal:'SENT TRANSLATION',interpretive:'SENT INTERPRETIVE'})}),sender={id:'public-gift-sender'},book=await library.getBook(sender,'gutenberg-alice'),paragraph=book.sections.flatMap(section=>section.paragraphs).find(paragraph=>!paragraph.translations.literal&&!paragraph.translations.interpretive);
  assert.ok(paragraph);await library.translate(sender,book.bookId,paragraph.id);
  await library.addComment(user,book.bookId,{id:'catalog-note',passageId:paragraph.id,text:'My public-book note stays private.'});
  const gifts=createBookGifts({library,dataDir:'public-gift-alice',dataStore}),gift=await gifts.create(sender,book.bookId,{includeTranslations:true});
  const find=book=>book.sections.flatMap(section=>section.paragraphs).find(row=>row.id===paragraph.id);
  assert.deepEqual(find(await library.getBook(user,book.bookId)).translations,{});
  assert.equal((await gifts.accept(user,gift.token)).alreadyOwned,true);
  const received=find(await library.getBook(user,book.bookId)).translations;
  assert.equal(received.literal?.text,'SENT TRANSLATION');assert.equal(received.interpretive?.text,'SENT INTERPRETIVE');
  assert.deepEqual(received,find(await library.getBook(sender,book.bookId)).translations);
  const before=await library.records(user,book.bookId);await gifts.accept(user,gift.token);
  assert.deepEqual(find(await library.getBook(user,book.bookId)).translations,received);assert.deepEqual(await library.records(user,book.bookId),before);
});

test('public gift overlays merge missing variants through owner CAS without replacing existing draft metadata',async()=>{
  const fixture=authFixture(),create=()=>createLibraryService({dataDir:'public-gift-cas',dataStore:fixture.store()}),a=await create(),b=await create(),book=await a.getBook(user,'gutenberg-alice'),paragraph=book.sections.flatMap(section=>section.paragraphs).find(paragraph=>!Object.keys(paragraph.translations).length),literal=structuredClone(book),interpretive=structuredClone(book),find=book=>book.sections.flatMap(section=>section.paragraphs).find(row=>row.id===paragraph.id);
  const kept={...translation('KEEP RECIPIENT DRAFT'),createdAt:'2026-10-15T00:00:00Z',model:'recipient-draft-model',sourceVersion:book.contentVersion};
  find(literal).translations={literal:kept};find(interpretive).translations={interpretive:{...translation('FILL MISSING INTERPRETIVE'),variant:'interpretive'}};
  await Promise.all([a.receiveGift(user,backupOf(literal)),b.receiveGift(user,backupOf(interpretive))]);
  let received=find(await a.getBook(user,book.bookId)).translations;assert.deepEqual(received.literal,kept);assert.equal(received.interpretive?.text,'FILL MISSING INTERPRETIVE');
  find(literal).translations.literal=translation('DO NOT REPLACE');await b.receiveGift(user,backupOf(literal));
  received=find(await a.getBook(user,book.bookId)).translations;assert.deepEqual(received.literal,kept);
  const another={id:'public-gift-other-owner'};assert.deepEqual(find(await a.getBook(another,book.bookId)).translations,{});
  await a.receiveGift(another,backupOf(literal));assert.equal(find(await a.getBook(another,book.bookId)).translations.literal.text,'DO NOT REPLACE');assert.deepEqual(find(await a.getBook(user,book.bookId)).translations.literal,kept);
});

test('public gift translation writes retry after an outage without touching reading records',async()=>{
  const fixture=authFixture(),store=fixture.store();let failOnce=true;
  const dataStore={...store,async mutate(file,fallback,operation){if(failOnce&&file.includes('/translations/')){failOnce=false;throw Object.assign(Error('fixture outage'),{status:503});}return store.mutate(file,fallback,operation);}},library=await createLibraryService({dataDir:'public-gift-retry',dataStore}),book=await library.getBook(user,'gutenberg-alice'),paragraph=book.sections.flatMap(section=>section.paragraphs).find(paragraph=>!Object.keys(paragraph.translations).length);
  paragraph.translations.literal=translation('RECOVER PUBLIC GIFT');await library.addComment(user,book.bookId,{id:'retry-note',passageId:paragraph.id,text:'Keep this note.'});
  await assert.rejects(library.receiveGift(user,backupOf(book)),error=>error.status===503);await library.receiveGift(user,backupOf(book));
  const saved=await library.getBook(user,book.bookId);assert.equal(saved.sections.flatMap(section=>section.paragraphs).find(row=>row.id===paragraph.id).translations.literal?.text,'RECOVER PUBLIC GIFT');assert.equal((await library.records(user,book.bookId)).comments[0].id,'retry-note');
});

test('concurrent gift receives never replace the winner or its subsequent personal records',async()=>{
  const {create,library}=await hosted(),other=await create(),first=structuredClone(readingBook),second=structuredClone(readingBook);
  first.sections[0].paragraphs[0].translations.literal=translation('FIRST GIFT');second.sections[0].paragraphs[0].translations.literal=translation('SECOND GIFT');
  const results=await Promise.allSettled([library.receiveGift(user,backupOf(first)),other.receiveGift(user,backupOf(second))]);
  assert.equal(results.filter(result=>result.status==='fulfilled'&&!result.value.alreadyOwned).length,1);
  for(const result of results)if(result.status==='rejected')assert.equal(result.reason.status,409);
  const saved=await library.getBook(user,first.bookId),text=saved.sections[0].paragraphs[0].translations.literal.text;assert.equal(text,results[0].status==='fulfilled'&&!results[0].value.alreadyOwned?'FIRST GIFT':'SECOND GIFT');
  await library.addComment(user,first.bookId,{id:'my-note',passageId:'p1',text:'My own note stays.'});
  const before=await library.exportLibrary(user);await library.receiveGift(user,backupOf(text==='FIRST GIFT'?second:first));
  assert.deepEqual((await library.exportLibrary(user)).books,before.books);
  const conflict=structuredClone(first);conflict.sections[0].paragraphs[0].original='A changed original.';
  await assert.rejects(library.receiveGift(user,backupOf(conflict)),error=>error.status===409);
});

test('an interrupted translation write resumes the same gift without losing records or claiming another gift',async()=>{
  const fixture=authFixture(),store=fixture.store(),book=structuredClone(readingBook);book.sections[0].paragraphs[0].translations.literal=translation('RECOVERED TRANSLATION');let failOverlay=true;
  const dataStore={...store,async mutate(file,fallback,operation){if(failOverlay&&file.includes('/translations/')){failOverlay=false;throw Object.assign(Error('transient fixture outage'),{status:503});}return store.mutate(file,fallback,operation);}};
  const library=await createLibraryService({dataDir:'gift-interrupted',catalogDir:null,dataStore});
  await assert.rejects(library.receiveGift(user,backupOf(book)),error=>error.status===503);
  await library.addComment(user,book.bookId,{id:'written-during-retry',passageId:'p1',text:'Keep my note during recovery.'});
  const another=structuredClone(book);another.sections[0].paragraphs[0].translations.literal=translation('OTHER GIFT');
  await assert.rejects(library.receiveGift(user,backupOf(another)),error=>error.status===409);
  await library.receiveGift(user,backupOf(book));const recovered=await library.getBook(user,book.bookId);
  assert.equal(recovered.sections[0].paragraphs[0].translations.literal?.text,'RECOVERED TRANSLATION');assert.equal((await library.records(user,book.bookId)).comments[0].id,'written-during-retry');
  assert.ok(!Object.hasOwn(recovered,'_giftReceive'));
});

test('gift reception rejects personal records and oversized documents before any content writes',async()=>{
  const {fixture,library}=await hosted(),packageWithNotes=backupOf(structuredClone(readingBook));
  packageWithNotes.books[0].records.comments.push({id:'private',passageId:'p1',text:'Do not receive this private note.',origin:'user',createdAt:'2026-10-15T00:00:00Z'});
  await assert.rejects(library.receiveGift(user,packageWithNotes),error=>error.status===400);assert.equal(fixture.rows.size,0);
  const book=structuredClone(readingBook);for(let i=0;i<36;i++)book.sections[0].paragraphs.push({id:'too-large-'+i,original:'x'.repeat(100000),translations:{},annotationIds:[],termIds:[]});
  await assert.rejects(library.receiveGift(user,backupOf(book)),error=>error.status===413);assert.equal(fixture.rows.size,0);
});
