import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
const owner={id:'get147-synthetic-owner'},restoredOwner={id:'get147-clean-target'};
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'get147-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:path.join(dir,'source'),catalogDir:null,translator:null}),book=await library.importDocument(owner,{filename:'get147-test.txt',bytes:Buffer.from('Synthetic source for exact reading time.\n\nA second anchor for recovery.')});return {dir,library,book};}
function row(book,source,start,end){const iso=minute=>new Date(Date.parse('2026-10-14T12:00:00Z')+minute*60000).toISOString(),anchor={chapterId:book.sections[0].chapterId,passageId:book.sections[0].paragraphs[0].id};return {id:source,source,bookId:book.bookId,contentVersion:book.contentVersion,status:'finished',sequence:1,startedAt:iso(start),endedAt:iso(end),timeZone:'UTC',start:anchor,end:anchor,segments:[{startedAt:iso(start),endedAt:iso(end)}]};}
test('real library keeps three sources and exact idempotency through a clean restore and rejects source conflicts',async t=>{
 const {dir,library,book}=await setup(t);for(const [source,a,b]of [['reader_focus',0,10],['reader_estimate',5,15],['manual',10,20]])await library.saveReadingSession(owner,book.bookId,row(book,source,a,b));
 const manual=row(book,'manual',10,20),first=await library.saveReadingSession(owner,book.bookId,manual);assert.equal(first.durationSeconds,600);assert.deepEqual(await library.saveReadingSession(owner,book.bookId,manual),first);
 await assert.rejects(library.saveReadingSession(owner,book.bookId,{...row(book,'manual',10,25)}),{status:409});
 const before=await library.readingActivity(owner,{month:'2026-10',timeZone:'UTC'});assert.equal(before.durationSeconds,1200);assert.deepEqual(before.sourceDurationSeconds,{reader_focus:600,reader_estimate:600,manual:600});
 const backup=await library.exportLibrary(owner),fresh=await createLibraryService({dataDir:path.join(dir,'clean'),catalogDir:null,translator:null});await fresh.restoreLibrary(restoredOwner,backup);await fresh.restoreLibrary(restoredOwner,backup);
 assert.deepEqual(await fresh.readingActivity(restoredOwner,{month:'2026-10',timeZone:'UTC'}),before);const result=await fresh.records(restoredOwner,book.bookId);assert.equal(result.readingSessions.length,3);assert.deepEqual(new Set(result.readingSessions.map(s=>s.source)),new Set(['reader_focus','reader_estimate','manual']));assert.equal(result.position,null);assert.equal(result.readingMilestones.length,0);
 const conflict=structuredClone(backup);conflict.books[0].records.readingSessions.find(s=>s.source==='manual').source='reader_estimate';await assert.rejects(fresh.restoreLibrary(restoredOwner,conflict),{status:409});assert.deepEqual(await fresh.records(restoredOwner,book.bookId),result);
 await assert.rejects(library.saveReadingSession(restoredOwner,book.bookId,manual),{status:404});assert.equal((await library.readingActivity(restoredOwner,{month:'2026-10',timeZone:'UTC'})).durationSeconds,0);
});
test('a bad manual source in the later book aborts the complete backup before any book is restored',async t=>{
 const {dir,library,book}=await setup(t);await library.saveReadingSession(owner,book.bookId,row(book,'manual',0,10));const second=await library.importDocument(owner,{filename:'second.txt',bytes:Buffer.from('Another independent synthetic source.')});await library.saveReadingSession(owner,second.bookId,row(second,'reader_estimate',0,10));const backup=await library.exportLibrary(owner);backup.books[1].records.readingSessions[0].source='agent';const fresh=await createLibraryService({dataDir:path.join(dir,'reject'),catalogDir:null,translator:null});await assert.rejects(fresh.restoreLibrary(restoredOwner,backup),{status:400});assert.deepEqual(await fresh.list(restoredOwner),[]);
});
