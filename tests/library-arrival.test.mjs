import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';
const build=async(entries,options)=>(await import('../server/library-arrival.mjs')).buildLibraryArrival(entries,options);
const options={timeZone:'Asia/Singapore',now:Date.parse('2026-10-15T03:00:00Z')};
test('arrival clips yesterday at local midnight, merges overlaps and excludes private prose',async()=>{
 const records=readingRecords();records.readingSessions=[focusSession({startedAt:'2026-10-14T15:55:00Z',endedAt:'2026-10-14T16:05:00Z',segments:[{startedAt:'2026-10-14T15:55:00Z',endedAt:'2026-10-14T16:05:00Z'}]}),focusSession({id:'second',segments:[{startedAt:'2026-10-14T15:57:00Z',endedAt:'2026-10-14T16:00:00Z'}]})];
 records.comments=[{id:'n',origin:'user',text:'PRIVATE NOTE CONTENT',createdAt:'2026-10-14T12:00:00Z'}];
 const result=await build([{book:readingBook,records}],options);
 assert.equal(result.date,'2026-10-15');assert.equal(result.yesterday.date,'2026-10-14');assert.equal(result.yesterday.durationSeconds,300);assert.equal(result.yesterday.notes,1);
 assert.equal(result.lastRead.at,'2026-10-14T16:05:00.000Z');assert.equal(result.lastRead.passageId,'p2');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|segments|comments|"questions":\[/);
});
test('arrival uses actual elapsed DST intervals and the previous calendar date across years',async()=>{
 const records=readingRecords();records.readingSessions=[focusSession({segments:[{startedAt:'2026-11-01T05:30:00Z',endedAt:'2026-11-01T06:30:00Z'}]})];
 const result=await build([{book:readingBook,records}],{timeZone:'America/New_York',now:Date.parse('2026-11-02T15:00:00Z')});assert.equal(result.yesterday.durationSeconds,3600);
 assert.equal((await build([],{timeZone:'UTC',now:Date.parse('2027-01-01T01:00:00Z')})).yesterday.date,'2026-12-31');
 await assert.rejects(build([],{...options,timeZone:'invalid'}),e=>e.status===400);
});
test('arrival has honest empty history and ignores stale versions, agent time and future intervals',async()=>{
 const records=readingRecords();records.readingSessions=[focusSession({contentVersion:'old'}),focusSession({source:'agent'}),focusSession({segments:[{startedAt:'2026-10-16T12:00:00Z',endedAt:'2026-10-16T13:00:00Z'}]})];
 const result=await build([{book:readingBook,records}],options);assert.equal(result.lastRead,null);assert.equal(result.yesterday.durationSeconds,0);
});
test('the first book list avoids book/translation/record reads and arrival is owner-scoped',async t=>{
 const {createLibraryService}=await import('../server/library-service.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-arrival-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,catalogDir:null}),owner={id:'arrival-owner'},other={id:'arrival-other'};
 const book=await library.importDocument(owner,{filename:'fixture.txt',bytes:Buffer.from('First paragraph.\n\nSecond paragraph.')});
 const reads=[],dataStore={async read(file,fallback){reads.push(file);const {readFile}=await import('node:fs/promises');try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw e;}}};
 const service=await createLibraryService({dataDir:dir,catalogDir:null,dataStore});
 assert.equal((await service.list(owner,{metadataOnly:true}))[0].bookId,book.bookId);assert.equal(reads.some(x=>/\/(records|translations|books)\//.test(x)),false);
 assert.equal((await service.arrival(owner,options)).lastRead,null);assert.equal((await service.arrival(other,options)).yesterday.books.length,0);
 await assert.rejects(service.arrival(null,options),e=>e.status===401);
});
test('metadata-first delivery preserves the saved shelf order through personalization',async t=>{
 const {createLibraryService}=await import('../server/library-service.mjs');const dir=await mkdtemp(path.join(tmpdir(),'leafhour-arrival-order-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'order-owner'};
 const a=await library.importDocument(user,{filename:'a.txt',bytes:Buffer.from('First fixture.')}),b=await library.importDocument(user,{filename:'b.txt',bytes:Buffer.from('Second fixture.')});await library.reorderShelf(user,{baseRevision:0,bookIds:[b.bookId,a.bookId]});
 const rows=await library.list(user,{metadataOnly:true});assert.deepEqual(rows.map(x=>[x.bookId,x.shelfPosition]),[[b.bookId,0],[a.bookId,1]]);
});
