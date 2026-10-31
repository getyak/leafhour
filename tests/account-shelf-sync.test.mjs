import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';

const owner={id:'account-snapshot-owner'},other={id:'account-snapshot-other'};
const status=code=>error=>error.status===code;
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-account-snapshot-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const rows=new Map(),blobs=new Map();let blockCanonical=false;
 const store={read:async(file,fallback)=>{if(blockCanonical&&/\/(?:books|translations)\/[a-f0-9]{64}\.json$/.test(file))throw Error('A metadata snapshot must not read canonical book/translation bodies');return structuredClone(rows.has(file)?rows.get(file):fallback);},mutate:async(file,fallback,operation)=>{const value=structuredClone(rows.has(file)?rows.get(file):fallback),result=await operation(value);rows.set(file,value);return result;},putBlob:async(file,bytes)=>{blobs.set(file,Buffer.from(bytes));}};
 const library=await createLibraryService({dataDir:dir,catalogDir:null,dataStore:store});
 const upload=(user,text)=>library.importDocument(user,{filename:'synthetic.txt',bytes:Buffer.from(text)});
 return {library,upload,block:()=>{blockCanonical=true;}};
}
const progress=(book,observedAt)=>({chapterId:book.chapters[0].id,passageId:book.sections[0].paragraphs[0].id,contentVersion:book.contentVersion,offset:0,mode:'en',variant:'literal',...(observedAt?{observedAt}:{})});

test('account shelf is authoritative and reads personal state without canonical source or private note text',async t=>{
 const {library,upload,block}=await fixture(t),book=await upload(owner,'A synthetic source for account metadata.');
 await library.addComment(owner,book.bookId,{id:'metadata-private-note',passageId:book.sections[0].paragraphs[0].id,text:'Private note text must not enter a shelf response.'});
 await library.saveProgress(owner,book.bookId,progress(book,new Date(Date.now()-60000).toISOString()));
 assert.equal(typeof library.accountShelf,'function');block();
 const snapshot=await library.accountShelf(owner),row=snapshot.books[0];
 assert.equal(snapshot.kind,'leafhour-account-shelf-v1');assert.equal(snapshot.shelfRevision,0);
 assert.deepEqual(snapshot.shelf.archived,{});assert.deepEqual(snapshot.shelf.pinned,[]);assert.equal(snapshot.shelf.pinsInitialized,false);
 assert.equal(row.bookId,book.bookId);assert.equal(row.readingStateReady,true);assert.equal(row.resume.passageId,book.sections[0].paragraphs[0].id);
 assert.ok(row.resume.chapterTitle);assert.equal(row.sections,undefined);assert.equal(row.comments,undefined);
 assert.ok(!JSON.stringify(snapshot).includes('Private note text must not enter'));
 await assert.rejects(library.accountShelf(null),status(401));
 assert.equal((await library.accountShelf(other)).books.length,0);
});

test('delayed offline progress retains event time instead of becoming the most recent upload',async t=>{
 const {library,upload}=await fixture(t),a=await upload(owner,'Older offline reading.'),b=await upload(owner,'Newer reading on another device.');
 const older=new Date(Date.now()-300000).toISOString(),newer=new Date(Date.now()-60000).toISOString();
 await library.saveProgress(owner,b.bookId,progress(b,newer));
 const saved=await library.saveProgress(owner,a.bookId,progress(a,older));
 assert.equal(saved.observedAt,older);assert.ok(Date.parse(saved.updatedAt)>Date.parse(saved.observedAt));
 assert.equal(typeof library.accountShelf,'function');
 const snapshot=await library.accountShelf(owner),byID=new Map(snapshot.books.map(row=>[row.bookId,row]));
 assert.equal(byID.get(a.bookId).lastReadAt,older);assert.equal(byID.get(b.bookId).lastReadAt,newer);
 assert.ok(Date.parse(byID.get(a.bookId).lastReadAt)<Date.parse(byID.get(b.bookId).lastReadAt));
 await assert.rejects(library.saveProgress(owner,a.bookId,{...progress(a),observedAt:'not-a-date'}),status(400));
 await assert.rejects(library.saveProgress(owner,a.bookId,{...progress(a),observedAt:new Date(Date.now()+360000).toISOString()}),status(400));
 await assert.rejects(library.saveProgress(owner,a.bookId,{...progress(a),contentVersion:'another-source'}),status(409));
});

test('pins, archive and restore share account CAS while retaining originals and note ownership',async t=>{
 const {library,upload}=await fixture(t),a=await upload(owner,'Keep this source after archiving.'),foreign=await upload(other,'A different owner source.');
 assert.equal(typeof library.setShelfPins,'function');assert.equal(typeof library.accountShelf,'function');
 let shelf=await library.setShelfPins(owner,{bookIds:[a.bookId],pinned:true,baseRevision:0});
 assert.equal(shelf.revision,1);assert.deepEqual(shelf.pinned,[a.bookId]);assert.equal(shelf.pinsInitialized,true);
 await assert.rejects(library.setShelfPins(owner,{bookIds:[foreign.bookId],pinned:true,baseRevision:1}),status(404));
 await assert.rejects(library.setShelfPins(owner,{bookIds:[a.bookId],pinned:false,baseRevision:0}),status(409));
 await assert.rejects(library.setShelfPins(null,{bookIds:[a.bookId],pinned:true,baseRevision:1}),status(401));
 await library.archiveBook(owner,a.bookId,{baseRevision:1});
 let snapshot=await library.accountShelf(owner);assert.equal(snapshot.books.length,0);assert.equal(snapshot.archivedBooks[0].bookId,a.bookId);assert.deepEqual(snapshot.shelf.pinned,[a.bookId]);
 assert.equal((await library.getBook(owner,a.bookId)).contentVersion,a.contentVersion);
 await library.restoreBook(owner,a.bookId,{baseRevision:2});snapshot=await library.accountShelf(owner);assert.equal(snapshot.books[0].pinned,true);assert.equal(snapshot.archivedBooks.length,0);
 assert.deepEqual((await library.accountShelf(other)).shelf.pinned,[]);
});

test('importing the same archived original restores visibility without duplicating source or records',async t=>{
 const {library,upload}=await fixture(t),text='A synthetic original explicitly re-added.',book=await upload(owner,text);
 await library.addComment(owner,book.bookId,{id:'retained-note',passageId:book.sections[0].paragraphs[0].id,text:'Retain the existing authored note.'});
 await library.archiveBook(owner,book.bookId,{baseRevision:0});
 const again=await upload(owner,text);assert.equal(again.bookId,book.bookId);
 assert.equal((await library.list(owner)).length,1);assert.equal((await library.records(owner,book.bookId)).comments[0].id,'retained-note');
 assert.equal((await library.shelfState(owner)).revision,2);
});

test('account pins survive a normal library backup and restore without changing record identity',async t=>{
 const source=await fixture(t),book=await source.upload(owner,'An original with a portable account pin.');
 assert.equal(typeof source.library.setShelfPins,'function');
 await source.library.setShelfPins(owner,{bookIds:[book.bookId],pinned:true,baseRevision:0});
 const backup=await source.library.exportLibrary(owner);assert.equal(backup.books[0].shelf.pinned,true);
 const target=await fixture(t);await target.library.restoreLibrary(owner,backup);
 const snapshot=await target.library.accountShelf(owner);assert.equal(snapshot.books[0].bookId,book.bookId);assert.equal(snapshot.books[0].pinned,true);
});

test('an explicitly empty cloud pin state survives backup so legacy device pins cannot revive',async t=>{
 const source=await fixture(t),book=await source.upload(owner,'An account whose cloud pins were explicitly cleared.');
 await source.library.setShelfPins(owner,{bookIds:[book.bookId],pinned:false,baseRevision:0});
 const backup=await source.library.exportLibrary(owner);assert.equal(backup.books[0].shelf?.pinned,false);
 const target=await fixture(t);await target.library.restoreLibrary(owner,backup);
 const snapshot=await target.library.accountShelf(owner);assert.equal(snapshot.shelf.pinsInitialized,true);assert.deepEqual(snapshot.shelf.pinned,[]);
});

test('repeated reading checkpoints validate cached source anchors without reopening the original model',async t=>{
 const {library,upload,block}=await fixture(t),book=await upload(owner,'A source whose chapter snapshot is already published.'),anchor={chapterId:book.chapters[0].id,passageId:book.sections[0].paragraphs[0].id};
 const start=Date.now()-120000,stamp=n=>new Date(start+n*1000).toISOString();block();
 assert.equal((await library.records(owner,book.bookId)).bookId,book.bookId);
 const saved=await library.saveReadingSession(owner,book.bookId,{id:'cached-anchor-reading',bookId:book.bookId,contentVersion:book.contentVersion,source:'reader_estimate',sequence:1,status:'finished',startedAt:stamp(0),endedAt:stamp(30),timeZone:'UTC',start:anchor,end:anchor,segments:[{startedAt:stamp(0),endedAt:stamp(30)}]});
 assert.equal(saved.durationSeconds,30);
 assert.equal((await library.saveProgress(owner,book.bookId,progress(book,stamp(30)))).observedAt,stamp(30));
 assert.equal((await library.recordReadingMilestone(owner,book.bookId,{id:'cached-anchor-finished',bookId:book.bookId,contentVersion:book.contentVersion,type:'book_finished',createdAt:stamp(30)})).type,'book_finished');
});
