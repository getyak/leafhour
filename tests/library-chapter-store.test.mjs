import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryService} from '../server/library-service.mjs';
import {authFixture} from './auth-fixture.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
import {readingView as projectView} from '../server/reading-view.mjs';
import {digest} from '../server/document-import.mjs';

const owner={id:'chapter-owner'},other={id:'chapter-other'};
const backup=book=>({kind:'marginalia-library',schemaVersion:1,books:[{book,records:{...readingRecords(),bookId:book.bookId,contentVersion:book.contentVersion}}]});
const largeBook=()=>{const book=structuredClone(readingBook);book.sections[0].paragraphs[0].original='Long source. '.repeat(6000);for(let i=0;i<4;i++)book.sections[0].paragraphs.push({id:'long-'+i,original:'More long source. '.repeat(5000),translations:{},annotationIds:[],termIds:[]});return book;};
async function fixture({catalogDir=null,translator=null}={}){
 const database=authFixture(),reads=[],writes=[];let interrupt=null,readInterrupt=null;
 const create=async()=>{const durable=database.store(),store={...durable,async read(file,fallback){reads.push(file);if(readInterrupt)await readInterrupt(file);return durable.read(file,fallback);},async mutate(file,fallback,fn){writes.push(file);if(interrupt)await interrupt(file);return durable.mutate(file,fallback,fn);}};return createLibraryService({dataDir:'chapter-store-test',catalogDir,dataStore:store,translator});};
 return {database,reads,writes,create,setInterrupt:fn=>{interrupt=fn;},setReadInterrupt:fn=>{readInterrupt=fn;},library:await create()};
}
const canonicalReads=reads=>reads.filter(file=>/\/(?:books|translations)\/[a-f0-9]{64}\.json$/.test(file));

test('a fresh service serves an independently stored chapter without full book or overlay reads',async()=>{
 const f=await fixture(),book=largeBook();await f.library.restoreLibrary(owner,backup(book));
 const fresh=await f.create();f.reads.length=0;
 const chapter=await fresh.readingChapter(owner,book.bookId,'ch02',book.contentVersion);
 assert.equal(chapter.sections[0].paragraphs[0].original,'Continue from here.');assert.equal(chapter.bookId,book.bookId);
 assert.deepEqual(canonicalReads(f.reads),[]);assert.ok(!JSON.stringify(chapter).includes('Long source.'));
 const view=await fresh.readingView(owner,book.bookId,{passageId:'p3'});
 const expected=projectView(await f.library.getBook(owner,book.bookId),{passageId:'p3'});assert.deepEqual(view,expected);
 f.reads.length=0;await (await f.create()).readingView(owner,book.bookId,{chapterId:'ch02'});assert.deepEqual(canonicalReads(f.reads),[]);
});

test('small reading responses retain the full payload and owner/version checks reject unauthorized chapters',async()=>{
 const f=await fixture();await f.library.restoreLibrary(owner,backup(readingBook));const expected=await f.library.getBook(owner,readingBook.bookId);
 assert.deepEqual(await f.library.readingView(owner,readingBook.bookId),expected);
 await assert.rejects(f.library.readingChapter(other,readingBook.bookId,'ch01','edition-1'),e=>e.status===404);
 await assert.rejects(f.library.readingChapter(null,readingBook.bookId,'ch01','edition-1'),e=>e.status===404);
 await assert.rejects(f.library.readingChapter(owner,readingBook.bookId,'ch01','old'),e=>e.status===409);
 await assert.rejects(f.library.readingChapter(owner,readingBook.bookId,'missing','edition-1'),e=>e.status===404);
});

test('legacy private books project once and later independent services do not load their full source',async()=>{
 const f=await fixture(),raw=f.database.store(),book=largeBook(),root='chapter-store-test/users/'+digest(owner.id);
 await raw.mutate(root+'/books/'+digest(book.bookId)+'.json',{},row=>Object.assign(row,book));
 await raw.mutate(root+'/translations/'+digest(book.bookId)+'.json',{},row=>{row.p3={contentVersion:book.contentVersion,translations:{literal:{text:'Existing personal translation'}}};});
 const first=await f.library.readingChapter(owner,book.bookId,'ch02',book.contentVersion);assert.equal(first.sections[0].paragraphs[0].translations.literal.text,'Existing personal translation');assert.ok(canonicalReads(f.reads).length);
 f.reads.length=0;const next=await (await f.create()).readingChapter(owner,book.bookId,'ch02',book.contentVersion);assert.deepEqual(next,first);assert.deepEqual(canonicalReads(f.reads),[]);
});

test('generated translations replace the saved chapter snapshot for fresh services',async()=>{
 const f=await fixture({translator:async()=>({literal:'New literal',interpretive:'New interpretation'})}),book=largeBook();await f.library.restoreLibrary(owner,backup(book));
 await f.library.readingChapter(owner,book.bookId,'ch02',book.contentVersion);await f.library.translate(owner,book.bookId,'p3');
 f.reads.length=0;const chapter=await (await f.create()).readingChapter(owner,book.bookId,'ch02',book.contentVersion);
 assert.equal(chapter.sections[0].paragraphs[0].translations.literal.text,'New literal');assert.deepEqual(canonicalReads(f.reads),[]);
});

test('restoring changed personal translations invalidates an already published chapter snapshot',async()=>{
 const f=await fixture(),book=largeBook();await f.library.restoreLibrary(owner,backup(book));await f.library.readingView(owner,book.bookId);
 book.sections[1].paragraphs[0].translations={literal:{text:'Restored translation',variant:'literal',origin:'ai',status:'draft'}};await f.library.restoreLibrary(owner,backup(book));
 f.reads.length=0;const chapter=await (await f.create()).readingChapter(owner,book.bookId,'ch02',book.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].translations.literal.text,'Restored translation');assert.deepEqual(canonicalReads(f.reads),[]);
});

test('a partial restore failure cannot keep serving an old projection after canonical translations changed',async()=>{
 const f=await fixture(),book=largeBook();await f.library.restoreLibrary(owner,backup(book));await f.library.readingView(owner,book.bookId);
 book.sections[1].paragraphs[0].translations={literal:{text:'Saved before interruption',variant:'literal',origin:'ai',status:'draft'}};
 f.setInterrupt(file=>{if(file.includes('/records/'))throw Error('record save interrupted');});await assert.rejects(f.library.restoreLibrary(owner,backup(book)),/record save interrupted/);f.setInterrupt(null);
 const chapter=await (await f.create()).readingChapter(owner,book.bookId,'ch02',book.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].translations.literal.text,'Saved before interruption');
});

test('public anonymous and account chapter projections keep personal translations isolated',async()=>{
 const f=await fixture({catalogDir:'catalog',translator:async()=>({literal:'Personal literal',interpretive:'Personal interpretation'})}),book=await f.library.getBook(owner,'gutenberg-alice'),p=book.sections.flatMap(s=>s.paragraphs).find(p=>!Object.keys(p.translations).length),chapterId=book.sections.find(s=>s.paragraphs.includes(p)).chapterId;
 await f.library.translate(owner,book.bookId,p.id);const fresh=await f.create();f.reads.length=0;
 const own=await fresh.readingChapter(owner,book.bookId,chapterId,book.contentVersion);assert.equal(own.sections.flatMap(s=>s.paragraphs).find(row=>row.id===p.id).translations.literal.text,'Personal literal');assert.deepEqual(canonicalReads(f.reads),[]);
 for(const user of [null,other]){const chapter=await fresh.readingChapter(user,book.bookId,chapterId,book.contentVersion);assert.deepEqual(chapter.sections.flatMap(s=>s.paragraphs).find(row=>row.id===p.id).translations,{});}
});

test('JSONB object key ordering does not change an immutable chapter identity',async()=>{
 const f=await fixture();await f.library.restoreLibrary(owner,backup(readingBook));
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,row])=>[key,reorder(row)])):value;
 for(const row of f.database.rows.values())row.value=reorder(row.value);
 const chapter=await (await f.create()).readingChapter(owner,readingBook.bookId,'ch02',readingBook.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].original,'Continue from here.');
});

test('independent concurrent legacy migrations load the canonical source only once',async()=>{
 const f=await fixture(),raw=f.database.store(),book=largeBook();await raw.mutate('chapter-store-test/users/'+digest(owner.id)+'/books/'+digest(book.bookId)+'.json',{},row=>Object.assign(row,book));
 const second=await f.create();f.reads.length=0;
 const [first,next]=await Promise.all([f.library.readingChapter(owner,book.bookId,'ch01',book.contentVersion),second.readingChapter(owner,book.bookId,'ch02',book.contentVersion)]);
 assert.equal(first.sections[0].paragraphs[0].id,'p1');assert.equal(next.sections[0].paragraphs[0].id,'p3');assert.equal(canonicalReads(f.reads).filter(file=>file.includes('/books/')).length,1);
});

test('an interrupted projection save repairs canonical translations on retry without returning stale content',async()=>{
 const f=await fixture({translator:async()=>({literal:'Saved despite projection outage',interpretive:'Another saved variant'})});await f.library.restoreLibrary(owner,backup(readingBook));
 f.setInterrupt(file=>{if(file.includes('/chapters/'))throw Error('chapter projection outage');});
 await assert.rejects(f.library.translate(owner,readingBook.bookId,'p3'),/chapter projection outage/);f.setInterrupt(null);
 const chapter=await (await f.create()).readingChapter(owner,readingBook.bookId,'ch02',readingBook.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].translations.literal.text,'Saved despite projection outage');
});

test('changing one translated chapter reuses the unchanged immutable chapter document',async()=>{
 const f=await fixture({translator:async()=>({literal:'Only chapter two changes',interpretive:'Interpretation'})});await f.library.restoreLibrary(owner,backup(readingBook));f.writes.length=0;
 await f.library.translate(owner,readingBook.bookId,'p3');assert.equal(f.writes.filter(file=>file.includes('/chapters/')).length,1);
});

test('a chapter named __proto__ remains an independently addressable source chapter',async()=>{
 const f=await fixture(),book=structuredClone(readingBook);book.chapters[1].id='__proto__';book.sections[1].chapterId='__proto__';await f.library.restoreLibrary(owner,backup(book));
 const chapter=await f.library.readingChapter(owner,book.bookId,'__proto__',book.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].id,'p3');
});

test('local imported and revised books survive a service restart through chapter storage',async t=>{
 const {mkdtemp,rm,rename}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-local-chapters-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const create=()=>createLibraryService({dataDir:dir,catalogDir:null}),library=await create(),book=await library.importDocument(owner,{filename:'source.txt',bytes:Buffer.from('Original source.\n\nAnother original paragraph.')}),passage=book.sections[0].paragraphs[0];
 const revision=(await library.createSourceRevision(owner,book.bookId,{baseContentVersion:book.contentVersion,operation:'correct',changes:[{passageId:passage.id,before:passage.original,replacement:['Corrected source.'],reason:'Source correction',evidence:{sha256:book.source.sha256,href:'source.txt'}}]})).book;
 // Removing canonical files proves the restarted reader uses its durable
 // projections. Originals stay present, and this test only uses a tempdir.
 const canonical=path.join(dir,'users',digest(owner.id),'books');await rename(canonical,canonical+'-held');
 const fresh=await create(),old=await fresh.readingChapter(owner,book.bookId,book.chapters[0].id,book.contentVersion),next=await fresh.readingChapter(owner,revision.bookId,revision.chapters[0].id,revision.contentVersion);
 assert.equal(old.sections[0].paragraphs[0].original,'Original source.');assert.equal(next.sections[0].paragraphs[0].original,'Corrected source.');assert.equal(next.sections[0].paragraphs[0].id,passage.id);
 await assert.rejects(fresh.readingChapter(owner,revision.bookId,revision.chapters[0].id,book.contentVersion),e=>e.status===409);
});

test('a private gift and a later public gift refresh independently stored personal translations',async()=>{
 const f=await fixture(),book=structuredClone(readingBook);book.sections[1].paragraphs[0].translations={literal:{text:'Gift translation',variant:'literal',origin:'ai',status:'draft'}};
 await f.library.receiveGift(owner,backup(book));f.reads.length=0;
 const chapter=await (await f.create()).readingChapter(owner,book.bookId,'ch02',book.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].translations.literal.text,'Gift translation');assert.deepEqual(canonicalReads(f.reads),[]);
 const publicFixture=await fixture({catalogDir:'catalog'}),catalog=await publicFixture.library.getBook(owner,'gutenberg-alice'),p=catalog.sections.flatMap(s=>s.paragraphs).find(p=>!Object.keys(p.translations).length),id=catalog.sections.find(s=>s.paragraphs.includes(p)).chapterId;
 await publicFixture.library.readingChapter(owner,catalog.bookId,id,catalog.contentVersion);p.translations={literal:{text:'New public gift translation',variant:'literal',origin:'ai',status:'draft'}};await publicFixture.library.receiveGift(owner,backup(catalog));publicFixture.reads.length=0;
 const saved=await (await publicFixture.create()).readingChapter(owner,catalog.bookId,id,catalog.contentVersion);assert.equal(saved.sections.flatMap(s=>s.paragraphs).find(row=>row.id===p.id).translations.literal.text,'New public gift translation');assert.deepEqual(canonicalReads(publicFixture.reads),[]);
});

test('late introduction generation is visible without rebuilding or reading the canonical source',async()=>{
 const f=await fixture(),book=largeBook();await f.library.restoreLibrary(owner,backup(book));
 const intro={kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',model:'deepseek-flash',scope:'opening-sample',contentVersion:book.contentVersion,text:'An introduction saved after the reader snapshot.',createdAt:new Date().toISOString(),sourcePassageIds:['p1']};
 await f.library.introductions.restore(owner,{...book,introduction:intro});f.reads.length=0;
 const view=await (await f.create()).readingView(owner,book.bookId,{chapterId:'ch02'});assert.deepEqual(view.introduction,intro);assert.deepEqual(canonicalReads(f.reads),[]);
});

test('library import adopts a verified account source without byte reads and persists chapter projections',async()=>{
 const f=await fixture(),{createVerifiedSource}=await import('../server/verified-source.mjs'),bytes=Buffer.from('Adopted source paragraph.'),adoptions=[];
 const source=createVerifiedSource(owner,{sha256:digest(bytes),size:bytes.length,adopt:async(target,store)=>{assert.equal(typeof store.read,'function');adoptions.push(target);}});
 const input={filename:'adopted.txt',verifiedSource:source,extracted:{format:'txt',pages:[{number:1,text:'Adopted source paragraph.'}]}};
 await assert.rejects(f.library.importExtracted(other,input),e=>e.status===403);await assert.rejects(f.library.importExtracted(owner,{...input,verifiedSource:{}}),e=>e.status===403);assert.equal(adoptions.length,0);
 const book=await f.library.importExtracted(owner,input);assert.equal(book.source.sha256,digest(bytes));assert.equal(adoptions.length,1);assert.equal(adoptions[0],'chapter-store-test/users/'+digest(owner.id)+'/originals/'+digest(bytes));
 f.reads.length=0;const chapter=await (await f.create()).readingChapter(owner,book.bookId,book.chapters[0].id,book.contentVersion);assert.equal(chapter.sections[0].paragraphs[0].original,'Adopted source paragraph.');assert.deepEqual(canonicalReads(f.reads),[]);
});

test('an in-flight old chapter response cannot cross a completed translation mutation',async()=>{
 const f=await fixture({translator:async()=>({literal:'Current translation',interpretive:'Current interpretation'})});await f.library.restoreLibrary(owner,backup(readingBook));
 let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
 f.setReadInterrupt(file=>{if(file.includes('/chapters/')){f.setReadInterrupt(null);enter();return blocked;}});
 const pending=f.library.readingChapter(owner,readingBook.bookId,'ch02',readingBook.contentVersion);await entered;await f.library.translate(owner,readingBook.bookId,'p3');release();
 await assert.rejects(pending,e=>e.status===409);const current=await f.library.readingChapter(owner,readingBook.bookId,'ch02',readingBook.contentVersion);assert.equal(current.sections[0].paragraphs[0].translations.literal.text,'Current translation');
});

const manyChapterBook=()=>{const book=structuredClone(readingBook);book.chapters=Array.from({length:14},(_,i)=>({id:'ch'+String(i+1).padStart(2,'0'),number:i+1,kind:'body',title:{zh:'Chapter '+(i+1)}}));book.sections=book.chapters.map((chapter,i)=>({number:i+1,chapterId:chapter.id,paragraphs:[{id:'batch-p'+i,original:'Source paragraph in chapter '+i,translations:{},annotationIds:[],termIds:[]}]}));book.readingStart={chapterId:'ch01',passageId:'batch-p0'};return book;};

test('cold migration writes independent chapters concurrently with at most six storage operations in flight',async()=>{
 const f=await fixture(),book=manyChapterBook(),durable=f.database.store();await durable.mutate('chapter-store-test/users/'+digest(owner.id)+'/books/'+digest(book.bookId)+'.json',{},row=>Object.assign(row,book));
 let release,active=0,maximum=0,started=0;const blocked=new Promise(resolve=>{release=resolve;});
 f.setInterrupt(async file=>{if(!file.includes('/chapters/'))return;started++;active++;maximum=Math.max(maximum,active);try{await blocked;}finally{active--;}});
 const reading=f.library.readingChapter(owner,book.bookId,'ch14',book.contentVersion);
 try{
  await new Promise(setImmediate);assert.equal(started,6,'the first six independent chapter writes should start before any finishes');assert.equal(active,6);
  assert.equal([...f.database.rows.values()].some(row=>row.value.snapshot),false,'the manifest must stay unpublished while chapter writes are pending');
 }finally{release();}
 const result=await reading;assert.equal(result.sections[0].paragraphs[0].original,'Source paragraph in chapter 13');assert.equal(started,14);assert.equal(maximum,6);assert.equal(active,0);
});

test('a failed parallel chapter write drains its batch and never publishes an incomplete manifest',async()=>{
 const f=await fixture(),book=manyChapterBook(),durable=f.database.store();await durable.mutate('chapter-store-test/users/'+digest(owner.id)+'/books/'+digest(book.bookId)+'.json',{},row=>Object.assign(row,book));
 let release,started=0,finished=0;const blocked=new Promise(resolve=>{release=resolve;});
 f.setInterrupt(async file=>{if(!file.includes('/chapters/'))return;const number=++started;try{if(number===1)throw Error('parallel chapter outage');await blocked;}finally{finished++;}});
 // Attach rejection handling immediately while the remaining writes are held.
 const reading=f.library.readingChapter(owner,book.bookId,'ch14',book.contentVersion),outcome=reading.then(()=>null,error=>error);
 try{await new Promise(setImmediate);assert.equal(started,6);assert.equal(finished,1);assert.equal([...f.database.rows.values()].some(row=>row.value.snapshot),false);}
 finally{release();}
 const error=await outcome;assert.match(error.message,/parallel chapter outage/);assert.equal(finished,started,'no storage writes should outlive failed migration completion');assert.equal(started,6,'a failed batch must stop later chapter writes');
 assert.equal([...f.database.rows.values()].some(row=>row.value.snapshot),false,'partially saved chapters must never become a published manifest');
 f.setInterrupt(null);const retried=await (await f.create()).readingChapter(owner,book.bookId,'ch14',book.contentVersion);assert.equal(retried.sections[0].paragraphs[0].original,'Source paragraph in chapter 13');
});

test('an 81-chapter public book opens from one small-book aggregate while chapter reads stay independent',async()=>{
 const f=await fixture({catalogDir:'catalog'}),id='gutenberg-tao-te-ching';
 const initial=await f.library.readingView(null,id);assert.equal(initial.chapters.length,81);assert.equal(initial.reading,undefined);
 const fresh=await f.create();f.reads.length=0;const opened=await fresh.readingView(null,id);assert.deepEqual(opened,initial);
 assert.equal(f.reads.filter(file=>file.includes('/complete/')).length,1,'small-book opening should fetch one immutable aggregate');assert.equal(f.reads.filter(file=>file.includes('/chapters/')).length,0,'small-book opening must not fetch 81 individual chapters');assert.deepEqual(canonicalReads(f.reads),[]);
 const manifest=[...f.database.rows.values()].find(row=>row.value.snapshot?.book.bookId===id).value.snapshot;assert.ok(manifest.aggregate);assert.equal(manifest.book.sections.every(s=>s.paragraphs.every(p=>p.unloaded&&!Object.hasOwn(p,'original'))),true);
 f.reads.length=0;const chapter=await fresh.readingChapter(null,id,initial.chapters[80].id,initial.contentVersion);assert.ok(chapter.sections.length);assert.equal(f.reads.filter(file=>file.includes('/chapters/')).length,1);assert.equal(f.reads.filter(file=>file.includes('/complete/')).length,0);
});

test('small-book aggregate publication reflects translations and recovers after a failed aggregate save',async()=>{
 const f=await fixture({translator:async()=>({literal:'Aggregate current literal',interpretive:'Aggregate current interpretation'})});await f.library.restoreLibrary(owner,backup(readingBook));await f.library.readingView(owner,readingBook.bookId);
 f.setInterrupt(file=>{if(file.includes('/complete/'))throw Error('aggregate write outage');});await assert.rejects(f.library.translate(owner,readingBook.bookId,'p3'),/aggregate write outage/);
 assert.equal([...f.database.rows.values()].some(row=>row.value.snapshot),false,'failed aggregate publication must not advertise either old or incomplete contents');
 f.setInterrupt(null);const current=await (await f.create()).readingView(owner,readingBook.bookId);assert.equal(current.sections[1].paragraphs[0].translations.literal.text,'Aggregate current literal');assert.equal(current.sections[1].paragraphs[0].original,'Continue from here.');
 await assert.rejects(f.library.readingView(other,readingBook.bookId),e=>e.status===404);
});

test('small-book aggregates reject changed source text or a substituted content version',async()=>{
 for(const corrupt of [value=>value.book.sections[1].paragraphs[0].original='Unexpected changed original.',value=>value.contentVersion='stale-version']){
  const f=await fixture();await f.library.restoreLibrary(owner,backup(readingBook));const aggregate=[...f.database.rows.entries()].find(([key])=>key.includes('/complete/'));assert.ok(aggregate,'a small source should have an independent aggregate document');corrupt(aggregate[1].value);
  await assert.rejects((await f.create()).readingView(owner,readingBook.bookId),e=>e.status===409);
 }
});
