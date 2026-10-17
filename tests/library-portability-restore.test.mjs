import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createLibraryPortability} from '../server/library-portability.mjs';
import {createLibraryArchive,portableHash,PART_BYTES} from '../app/library-portability.mjs';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';

const owner={id:'synthetic-alice'},other={id:'synthetic-bob'};
function store(){const values=new Map(),queues=new Map();return {values,async read(k,d){return structuredClone(values.get(k)??d);},async mutate(k,d,fn){const prior=queues.get(k)||Promise.resolve(),p=prior.catch(()=>{}).then(async()=>{const row=await this.read(k,d);fn(structuredClone(row));const result=await fn(row);values.set(k,JSON.parse(JSON.stringify(row)));return structuredClone(result);});queues.set(k,p);try{return await p;}finally{if(queues.get(k)===p)queues.delete(k);}}};}
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'portability-')),services=[];let now=Date.now(),calls=0;const create=async(name,{catalogDir=null}={})=>{const dataDir=path.join(dir,name),library=await createLibraryService({dataDir,catalogDir,translator:null}),chat=await createReaderChatService({library,dataDir,generator:async job=>{calls++;await job.tools.execute('reader_get_context',{});await job.tools.execute('reader_cite',{bookId:job.book.bookId,passageId:job.passageId,quote:'First source.',layer:'original'});return {kind:'conversation',summary:'Synthetic AI answer.'};}});services.push(chat);return {library,chat,dataDir};};const source=await create('source'),target=await create('target'),staging=store(),portability=createLibraryPortability({...target,store:staging,clock:()=>now});t.after(async()=>{await Promise.all(services.map(s=>s.close()));await rm(dir,{recursive:true,force:true});});return {source,target,staging,portability,create,advance:ms=>now+=ms,calls:()=>calls};}
async function seed(source,filename='one.txt'){
 const book=await source.library.importDocument(owner,{filename,bytes:Buffer.from('First source.\n\nSecond source.'+(filename==='one.txt'?'':'\n\n'+filename))}),p=book.sections[0].paragraphs[0];
 await source.library.addComment(owner,book.bookId,{id:'note',passageId:p.id,text:'Own comment',contentVersion:book.contentVersion});
 await source.chat.send(owner,book.bookId,{id:'question',passageId:p.id,text:'Synthetic question',contentVersion:book.contentVersion});return book;
}
async function archive(source){const backup=await source.library.exportLibrary(owner);for(const e of backup.books)e.chat=await source.chat.exportHistory(owner,e.book.bookId);const originals=[];for(const e of backup.books)originals.push({bookId:e.book.bookId,bytes:(await source.library.getOriginal(owner,e.book.bookId)).bytes});return {backup,bytes:await createLibraryArchive(backup,{originals})};}
async function upload(p,bytes,user=owner){const operation=await p.start(user,{bytes:bytes.length,sha256:await portableHash(bytes)});for(let offset=0;offset<bytes.length;offset+=PART_BYTES)await p.part(user,operation.id,{offset,data:Buffer.from(bytes.subarray(offset,offset+PART_BYTES)).toString('base64')});return operation;}

test('fresh instance restores original, comments, exact cited AI history; retry across instances adds nothing and never generates',async t=>{
 const s=await setup(t),book=await seed(s.source),{bytes}=await archive(s.source),before=s.calls(),op=await upload(s.portability,bytes);
 const receipt=await s.portability.commit(owner,op.id);assert.deepEqual(await s.portability.commit(owner,op.id),receipt,'lost acknowledgement has an immutable receipt');
 assert.equal((await s.target.library.getOriginal(owner,book.bookId)).bytes.toString(),'First source.\n\nSecond source.');
 const history=await s.target.chat.exportHistory(owner,book.bookId);assert.equal(history.turns.length,1);assert.equal(history.turns[0].answer.origin,'ai');assert.equal(history.turns[0].answer.sourceRefs[0].quote,'First source.');assert.equal((await s.target.chat.view(owner,book.bookId)).scope.mode,'book');
 const target2=await s.create('target'),p2=createLibraryPortability({...target2,store:s.staging}),op2=await upload(p2,bytes);await p2.commit(owner,op2.id);assert.deepEqual(await target2.chat.exportHistory(owner,book.bookId),history);assert.equal((await target2.library.records(owner,book.bookId)).comments.length,1);assert.equal(s.calls(),before);
 assert.ok([...s.staging.values.entries()].filter(([k])=>k.includes('/parts/')).every(([,v])=>!v.data),'finished staging retains no private package bytes');
 await assert.rejects(s.target.library.getBook(other,book.bookId),{status:404});
});
test('invalid final chat and damaged inventory reject the entire package without writing the valid first book',async t=>{
 const s=await setup(t);await seed(s.source);await seed(s.source,'second.txt');const {bytes}=await archive(s.source),files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json'])),entry=JSON.parse(strFromU8(files['books/001.json']));entry.chat.turns[0].answer.sourceRefs[0].quote='NOT IN SOURCE';files['books/001.json']=strToU8(JSON.stringify(entry));manifest.files[1].bytes=files['books/001.json'].length;manifest.files[1].sha256=await portableHash(files['books/001.json']);files['manifest.json']=strToU8(JSON.stringify(manifest));
 const before=await s.target.library.exportLibrary(owner);for(const bad of [zipSync(files),Uint8Array.from(bytes,(b,i)=>i===100?b^1:b)]){const op=await upload(s.portability,bad);await assert.rejects(s.portability.commit(owner,op.id),/备份|校验|引用/);assert.deepEqual((await s.target.library.exportLibrary(owner)).books,before.books);}
});
test('staging is owner-scoped, bounded, expiring and explicitly cancellable; duplicate parts cannot change bytes',async t=>{
 const s=await setup(t);await seed(s.source);const {bytes}=await archive(s.source);await assert.rejects(s.portability.start(null,{bytes:bytes.length,sha256:await portableHash(bytes)}),{status:401});await assert.rejects(s.portability.start(owner,{bytes:513*1024*1024,sha256:'a'.repeat(64)}),{status:400});
 const op=await upload(s.portability,bytes);await assert.rejects(s.portability.commit(other,op.id),{status:410});await assert.rejects(s.portability.part(owner,op.id,{offset:0,data:Buffer.alloc(bytes.length).toString('base64')}),{status:409});await s.portability.cancel(owner,op.id);assert.ok([...s.staging.values.entries()].filter(([k])=>k.includes('/parts/')).every(([,v])=>!v.data));
 const next=await upload(s.portability,bytes);s.advance(3600001);await assert.rejects(s.portability.commit(owner,next.id),{status:410});const resumed=await s.portability.start(owner,{bytes:bytes.length,sha256:await portableHash(bytes)});assert.notEqual(resumed.id,next.id);assert.ok([...s.staging.values.entries()].filter(([k])=>k.includes('/parts/')).every(([,v])=>!v.data));
});

test('a target original-hash conflict rejects before any otherwise valid record is applied',async t=>{
 const s=await setup(t);await seed(s.source);const {backup,bytes}=await archive(s.source),existing=structuredClone(backup);existing.books[0].book.source.sha256='a'.repeat(64);existing.books[0].book.source.processor='pdfjs-native';existing.books[0].records.comments=[];existing.books[0].records.questions=[];
 await s.target.library.restoreLibrary(owner,existing);const before=(await s.target.library.exportLibrary(owner)).books,op=await upload(s.portability,bytes);await assert.rejects(s.portability.commit(owner,op.id),{status:409});assert.deepEqual((await s.target.library.exportLibrary(owner)).books,before);
});

test('a hash-consistent malformed recommendation is rejected before any library writes',async t=>{
 const s=await setup(t);await seed(s.source);const {bytes}=await archive(s.source),files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json'])),entry=JSON.parse(strFromU8(files['books/000.json']));entry.chat.turns[0].answer.recommendations=[null];files['books/000.json']=strToU8(JSON.stringify(entry));manifest.files[0].bytes=files['books/000.json'].length;manifest.files[0].sha256=await portableHash(files['books/000.json']);files['manifest.json']=strToU8(JSON.stringify(manifest));const op=await upload(s.portability,zipSync(files));await assert.rejects(s.portability.commit(owner,op.id),/推荐书目/);assert.equal((await s.target.library.exportLibrary(owner)).books.length,0);
});

test('an actual clean restore preserves independent translation states, editable note history, highlights, position and confirmed time',async t=>{
 const s=await setup(t),book=structuredClone(readingBook),records=readingRecords();
 book.sections[0].paragraphs[0].translations={literal:{text:'直译合成样本。',origin:'ai',status:'draft',sourceVersion:book.contentVersion},interpretive:{text:'意译合成样本。',origin:'ai',status:'reviewed',sourceVersion:book.contentVersion}};
 records.comments=[{id:'edited-note',passageId:'p1',contentVersion:book.contentVersion,text:'自己的最新原话',quote:'Read this first.',origin:'user',revision:2,lastEditId:'edit-two',createdAt:'2026-10-14T12:00:00.000Z',updatedAt:'2026-10-14T12:05:00.000Z'}];
 records.questions=[{id:'kept-question',passageId:'p2',contentVersion:book.contentVersion,text:'自己的问题',origin:'user',createdAt:'2026-10-14T12:06:00.000Z'}];
 records.readingSessions=[focusSession()];records.readingMilestones=[{id:'chapter-mark',bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'ch01',type:'chapter_read',origin:'user',createdAt:'2026-10-14T12:10:00.000Z'}];
 records.readingGoal={minutes:25,updatedAt:'2026-10-14T12:00:00.000Z'};records.position={passageId:'p2',chapterId:'ch01',offset:18,withinParagraph:.25,mode:'parallel',variant:'literal',contentVersion:book.contentVersion,revision:3,updatedAt:'2026-10-14T12:10:00.000Z'};
 records.highlights=[{id:'highlight-one',bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'ch01',origin:'user',createdAt:'2026-10-14T12:04:00.000Z',parts:[{passageId:'p1',language:'en',variant:'interpretive',start:0,end:4,text:'Read'}]}];
 const backup={kind:'marginalia-library',schemaVersion:1,books:[{book,records,shelf:{order:[book.bookId],archivedAt:'2026-10-14T13:00:00.000Z'}}]},bytes=await createLibraryArchive(backup),op=await upload(s.portability,bytes);await s.portability.commit(owner,op.id);
 const restored=await s.target.library.exportLibrary(owner),entry=restored.books[0];assert.deepEqual(entry.book.sections,book.sections);for(const key of ['comments','questions','highlights','readingSessions','readingMilestones','readingGoal','position'])assert.deepEqual(entry.records[key],records[key],key);assert.deepEqual(entry.shelf,backup.books[0].shelf);
 const repeated=await upload(s.portability,bytes);await s.portability.commit(owner,repeated.id);assert.deepEqual((await s.target.library.exportLibrary(owner)).books,restored.books);
 const advanced=await s.target.library.saveProgress(owner,book.bookId,{...records.position,passageId:'p4',chapterId:'ch02',baseRevision:3});
 const changed=await s.target.library.getBook(owner,book.bookId);changed.sections[0].paragraphs[0].translations.literal={...changed.sections[0].paragraphs[0].translations.literal,text:'目标实例已确认的较新译文。',status:'reviewed'};
 await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book:changed,records:readingRecords()}]});
 await s.target.library.addComment(owner,book.bookId,{id:'target-only',passageId:'p3',text:'Existing target record stays.'});
 const retry=await upload(s.portability,bytes);await s.portability.commit(owner,retry.id);
 assert.deepEqual((await s.target.library.records(owner,book.bookId)).position,advanced);assert.equal((await s.target.library.getBook(owner,book.bookId)).sections[0].paragraphs[0].translations.literal.text,'目标实例已确认的较新译文。');assert.ok((await s.target.library.records(owner,book.bookId)).comments.some(r=>r.id==='target-only'));
});

// Regression: retained migration archives may contain runtime session metadata.
// The outbound projection must omit authority without dropping reading events.
test('legacy event archives export without runtime authority and restore content without mutating the source',async t=>{
 const s=await setup(t),book=structuredClone(readingBook),records=readingRecords();
 book.legacyReadingResources={localExperienceRecords:{events:[{id:'event-one',sessionId:'SYNTHETIC-SESSION',text:'A password and token discussion stays verbatim.',createdAt:'2026-10-14T12:00:00Z',context:{access_token:'SYNTHETIC-TOKEN',passageId:'p1'}}]},hostedExperienceRecords:[{events:[{id:'event-two',session_id:'SYNTHETIC-SESSION-TWO',text:'Original reading event',durationSeconds:60}],authorization:'SYNTHETIC-AUTH'}]};
 await s.source.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records}]});
 const sourceBefore=(await s.source.library.exportLibrary(owner)).books;
 const exporter=createLibraryPortability({...s.source,store:store()}),part=await exporter.exportPart(owner,book.bookId,{}),entry=JSON.parse(Buffer.from(part.data,'base64'));
 assert.equal(part.nextOffset,null);assert.deepEqual(entry.book.legacyReadingResources,{localExperienceRecords:{events:[{id:'event-one',text:'A password and token discussion stays verbatim.',createdAt:'2026-10-14T12:00:00Z',context:{passageId:'p1'}}]},hostedExperienceRecords:[{events:[{id:'event-two',text:'Original reading event',durationSeconds:60}]}]});
 const bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[entry]}),op=await upload(s.portability,bytes);await s.portability.commit(owner,op.id);
 const target=(await s.target.library.exportLibrary(owner)).books[0];assert.deepEqual(target.book,entry.book);assert.deepEqual(target.records,entry.records);assert.deepEqual((await s.source.library.exportLibrary(owner)).books,sourceBefore);assert.equal(s.calls(),0);
 const files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json']));entry.book.legacyReadingResources.localExperienceRecords.events[0].sessionId='FORGED';files['books/000.json']=strToU8(JSON.stringify(entry));manifest.files[0].bytes=files['books/000.json'].length;manifest.files[0].sha256=await portableHash(files['books/000.json']);files['manifest.json']=strToU8(JSON.stringify(manifest));
 const empty=await s.create('reject-target'),reject=createLibraryPortability({...empty,store:store()}),bad=await upload(reject,zipSync(files));await assert.rejects(reject.commit(owner,bad.id),/凭据|令牌/);assert.equal((await empty.library.exportLibrary(owner)).books.length,0);
});
test('outbound projection still rejects credential-bearing source URLs',async t=>{
 const s=await setup(t),book=structuredClone(readingBook);book.source.url='https://example.invalid/book?access_token=SYNTHETIC-TOKEN';
 await s.source.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:readingRecords()}]});
 const exporter=createLibraryPortability({...s.source,store:store()});await assert.rejects(exporter.exportPart(owner,book.bookId,{}),/凭据|令牌/);
});

async function legacySource(s){
 const book=structuredClone(readingBook);await s.source.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:readingRecords()}]});
 const hash=v=>createHash('sha256').update(v).digest('hex'),file=path.join(s.source.dataDir,'users',hash(owner.id),'chat',hash(book.bookId)+'.json');
 const legacy={kind:'marginalia-reader-chat',schemaVersion:1,bookId:book.bookId,turns:[{id:'legacy-question',passageId:'p1',contentVersion:'edition-1',text:'My preserved question.',origin:'user',createdAt:'2026-10-14T12:00:00Z',status:'completed',answer:{origin:'ai',summary:'Historical answer stays verbatim.',sourceRefs:[{passageId:'p1',quote:'Read this first.'},{passageId:'p3',quote:'Continue from here.'}]},activity:[]}]};
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(legacy));return {book,file,legacy};
}
test('stored historical AI answers export exact versioned citations and reimport to both clean and legacy instances without rewriting history',async t=>{
 const s=await setup(t),{book,file,legacy}=await legacySource(s),before=await readFile(file),history=await s.source.chat.exportHistory(owner,book.bookId);
 assert.deepEqual(history.turns[0].answer,{kind:'conversation',origin:'ai',summary:'Historical answer stays verbatim.',recommendations:[],sourceRefs:[{bookId:'reading-test',contentVersion:'edition-1',chapterId:'ch01',passageId:'p1',layer:'original',quote:'Read this first.',url:'/read?book=reading-test&passage=p1'},{bookId:'reading-test',contentVersion:'edition-1',chapterId:'ch02',passageId:'p3',layer:'original',quote:'Continue from here.',url:'/read?book=reading-test&passage=p3'}]});
 const exporter=createLibraryPortability({...s.source,store:store()}),part=await exporter.exportPart(owner,book.bookId,{}),entry=JSON.parse(Buffer.from(part.data,'base64')),bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[entry]});assert.deepEqual(await readFile(file),before);
 const op=await upload(s.portability,bytes);await s.portability.commit(owner,op.id);assert.deepEqual(await s.target.chat.exportHistory(owner,book.bookId),history);
 for(const p of [s.portability,exporter]){const again=await upload(p,bytes);await p.commit(owner,again.id);}assert.deepEqual(await readFile(file),before);assert.deepEqual(await s.target.chat.exportHistory(owner,book.bookId),history);assert.equal(s.calls(),0);
 const files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json']));entry.chat=legacy;files['books/000.json']=strToU8(JSON.stringify(entry));manifest.files[0].bytes=files['books/000.json'].length;manifest.files[0].sha256=await portableHash(files['books/000.json']);files['manifest.json']=strToU8(JSON.stringify(manifest));const empty=await s.create('raw-legacy-input'),reject=createLibraryPortability({...empty,store:store()}),bad=await upload(reject,zipSync(files));await assert.rejects(reject.commit(owner,bad.id),/AI 回答/);assert.equal((await empty.library.exportLibrary(owner)).books.length,0);
});
test('historical answers with wrong source text, versions or foreign anchors are never guessed into valid citations',async t=>{
 const s=await setup(t),{book,file,legacy}=await legacySource(s);
 for(const change of [t=>{t.answer.sourceRefs[0].quote='Not in the original';},t=>{t.contentVersion='wrong-version';},t=>{t.answer.sourceRefs[0].passageId='missing';},t=>{t.answer.sourceRefs[0].bookId='other-account-book';},t=>{t.answer.sourceRefs[0].layer='literal';}]){
  const bad=structuredClone(legacy);change(bad.turns[0]);await writeFile(file,JSON.stringify(bad));
  await assert.rejects(async()=>{const chat=await s.source.chat.exportHistory(owner,book.bookId),backup=await s.source.library.exportLibrary(owner);backup.books[0].chat=chat;await createLibraryArchive(backup);},/引用|版本|锚点|AI 回答/);
 }
 assert.equal(s.calls(),0);
});

test('incoming chapter metadata cannot redefine citations in existing trusted legacy history',async t=>{
 const s=await setup(t),{book,file}=await legacySource(s),exporter=createLibraryPortability({...s.source,store:store()}),part=await exporter.exportPart(owner,book.bookId,{}),entry=JSON.parse(Buffer.from(part.data,'base64'));
 entry.book.chapters[0].id='reframed-ch01';entry.book.sections[0].chapterId='reframed-ch01';entry.book.readingStart.chapterId='reframed-ch01';entry.chat.turns[0].answer.sourceRefs[0].chapterId='reframed-ch01';
 const bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[entry]}),before=(await s.source.library.exportLibrary(owner)).books,history=await readFile(file),op=await upload(exporter,bytes);
 await assert.rejects(exporter.commit(owner,op.id),/引用|冲突/);assert.deepEqual((await s.source.library.exportLibrary(owner)).books,before);assert.deepEqual(await readFile(file),history);assert.equal(s.calls(),0);
});

function citedHistory(book,passageId,source,quote){return {kind:'marginalia-reader-chat',schemaVersion:1,bookId:book.bookId,turns:[{id:'translated-answer',passageId,contentVersion:book.contentVersion,text:'Keep my old cited answer.',origin:'user',createdAt:'2026-10-14T12:00:00Z',status:'completed',answer:{kind:'conversation',origin:'ai',summary:'A preserved AI answer.',recommendations:[],sourceRefs:[{bookId:source.bookId,contentVersion:source.contentVersion,chapterId:source.sections[0].chapterId,passageId:source.sections[0].paragraphs[0].id,layer:'literal',quote}]},activity:[]}]};}
for(const crossBook of [false,true])test('restore rejects '+(crossBook?'cross-book':'same-book')+' citations into retained newer translations before any package write',async t=>{
 const s=await setup(t),main=structuredClone(readingBook),cited=structuredClone(readingBook);cited.bookId=crossBook?'cited-book':main.bookId;cited.sections[0].paragraphs[0].translations.literal={text:'OLD literal quotation.',origin:'ai',status:'draft'};
 const records=book=>({...readingRecords(),bookId:book.bookId}),sourceBooks=crossBook?[main,cited]:[cited],backup={kind:'marginalia-library',schemaVersion:1,books:sourceBooks.map(book=>({book,records:records(book)}))};backup.books[0].chat=citedHistory(sourceBooks[0],'p1',cited,'OLD literal quotation.');backup.books[0].records.comments.push({id:'incoming-note',passageId:'p1',contentVersion:'edition-1',text:'Do not write any of this rejected package',origin:'user',createdAt:'2026-10-14T12:00:00Z'});
 const newer=structuredClone(cited);newer.sections[0].paragraphs[0].translations.literal.text='NEW target literal.';await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book:newer,records:records(newer)}]});
 const before=(await s.target.library.exportLibrary(owner)).books,bytes=await createLibraryArchive(backup),op=await upload(s.portability,bytes);await assert.rejects(s.portability.commit(owner,op.id),{status:409});assert.deepEqual((await s.target.library.exportLibrary(owner)).books,before);assert.equal((await s.target.chat.exportHistory(owner,newer.bookId)).turns.length,0);assert.equal(s.calls(),0);
});
test('preserveExisting keeps private base translations without an overlay and fills a missing independent variant',async t=>{
 const s=await setup(t),book=structuredClone(readingBook);book.sections[0].paragraphs[0].translations.literal={text:'NEW private base.',origin:'ai',status:'reviewed'};await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:readingRecords()}]});
 const hash=v=>createHash('sha256').update(v).digest('hex');await unlink(path.join(s.target.dataDir,'users',hash(owner.id),'translations',hash(book.bookId)+'.json'));
 const incoming=structuredClone(book);incoming.sections[0].paragraphs[0].translations={literal:{text:'OLD incoming.',origin:'ai',status:'draft'},interpretive:{text:'New missing interpretive.',origin:'ai',status:'draft'}};
 await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book:incoming,records:readingRecords()}]},{preserveExisting:true});const actual=await s.target.library.getBook(owner,book.bookId);assert.equal(actual.sections[0].paragraphs[0].translations.literal.text,'NEW private base.');assert.equal(actual.sections[0].paragraphs[0].translations.interpretive.text,'New missing interpretive.');
});
test('clean public catalog accepts personal translations while existing personal overlays and isolation remain protected',async t=>{
 const s=await setup(t),target=await s.create('public-target',{catalogDir:path.resolve('catalog')}),book=await target.library.getBook(owner,'gutenberg-alice'),incoming=structuredClone(book),section=incoming.sections.find(s=>s.paragraphs.some(p=>p.translations.literal)),p=section.paragraphs.find(p=>p.translations.literal),beforePublic=await target.library.getBook(null,book.bookId);p.translations.literal={...p.translations.literal,text:'MY restored personal literal.',status:'reviewed'};
 const history={kind:'marginalia-reader-chat',schemaVersion:1,bookId:book.bookId,turns:[{id:'public-cited-answer',passageId:p.id,contentVersion:book.contentVersion,text:'My imported question.',origin:'user',createdAt:'2026-10-14T12:00:00Z',status:'completed',answer:{kind:'conversation',summary:'My archived answer.',origin:'ai',recommendations:[],sourceRefs:[{bookId:book.bookId,contentVersion:book.contentVersion,chapterId:section.chapterId,passageId:p.id,layer:'literal',quote:'MY restored personal literal.'}]},activity:[]}]};
 const entry={book:incoming,records:await target.library.records(owner,book.bookId),chat:history},bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[entry]}),portability=createLibraryPortability({...target,store:store()}),op=await upload(portability,bytes);await portability.commit(owner,op.id);const actual=await target.library.getBook(owner,book.bookId);assert.equal(actual.sections.flatMap(s=>s.paragraphs).find(x=>x.id===p.id).translations.literal.text,'MY restored personal literal.');assert.deepEqual(await target.library.getBook(null,book.bookId),beforePublic);assert.deepEqual(await target.library.getBook(other,book.bookId),beforePublic);
 const again=await upload(portability,bytes);await portability.commit(owner,again.id);assert.equal((await target.chat.exportHistory(owner,book.bookId)).turns.length,1);
 const newer=structuredClone(actual);newer.sections.flatMap(s=>s.paragraphs).find(x=>x.id===p.id).translations.literal.text='NEW personal target translation.';await target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book:newer,records:await target.library.records(owner,book.bookId)}]});const before=(await target.library.exportLibrary(owner)).books,bad=await upload(portability,bytes);await assert.rejects(portability.commit(owner,bad.id),{status:409});assert.deepEqual((await target.library.exportLibrary(owner)).books,before);assert.equal(s.calls(),0);
});

test('a missing translation variant can restore a valid cited answer while a different existing variant stays',async t=>{
 const s=await setup(t),book=structuredClone(readingBook);book.sections[0].paragraphs[0].translations.literal={text:'NEW kept literal.',origin:'ai',status:'reviewed'};await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:readingRecords()}]});
 const incoming=structuredClone(book);incoming.sections[0].paragraphs[0].translations={literal:{text:'OLD literal.',origin:'ai',status:'draft'},interpretive:{text:'Added interpretive quotation.',origin:'ai',status:'draft'}};const history=citedHistory(incoming,'p1',incoming,'Added interpretive quotation.');history.turns[0].answer.sourceRefs[0].layer='interpretive';
 const bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[{book:incoming,records:readingRecords(),chat:history}]}),op=await upload(s.portability,bytes);await s.portability.commit(owner,op.id);const actual=await s.target.library.getBook(owner,book.bookId);assert.equal(actual.sections[0].paragraphs[0].translations.literal.text,'NEW kept literal.');assert.equal(actual.sections[0].paragraphs[0].translations.interpretive.text,'Added interpretive quotation.');const exported=await s.target.library.exportLibrary(owner);exported.books[0].chat=await s.target.chat.exportHistory(owner,book.bookId);await createLibraryArchive(exported);assert.equal(s.calls(),0);
});

test('a concurrent target translation change after preflight reports incomplete restore without writing mismatched history',async t=>{
 const s=await setup(t),book=structuredClone(readingBook);book.sections[0].paragraphs[0].translations.literal={text:'OLD cited literal.',origin:'ai',status:'draft'};const entry={book,records:readingRecords(),chat:citedHistory(book,'p1',book,'OLD cited literal.')};entry.records.comments.push({id:'valid-import-note',passageId:'p1',text:'Valid package may have partial progress after concurrent target change.',origin:'user',createdAt:'2026-10-14T12:00:00Z'});
 await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:readingRecords()}]});const concurrent=await s.create('target'),newer=structuredClone(book);newer.sections[0].paragraphs[0].translations.literal.text='NEW concurrently saved literal.';let updated=false;
 const library={...s.target.library,previewRestoreBooks:async(user,backup)=>{const result=await s.target.library.previewRestoreBooks(user,backup);if(!updated){updated=true;await concurrent.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book:newer,records:readingRecords()}]});}return result;}},portability=createLibraryPortability({library,chat:s.target.chat,store:s.staging}),bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[entry]}),op=await upload(portability,bytes);
 await assert.rejects(portability.commit(owner,op.id),error=>error.status===409&&/未完成|可能已恢复|尚未写入/.test(error.message));assert.equal((await s.target.library.getBook(owner,book.bookId)).sections[0].paragraphs[0].translations.literal.text,'NEW concurrently saved literal.');assert.equal((await s.target.chat.exportHistory(owner,book.bookId)).turns.length,0);assert.ok([...s.staging.values.values()].some(v=>v.operationId===op.id&&v.data));assert.ok([...s.staging.values.values()].some(v=>v.id===op.id&&v.state==='uploading'&&!v.receipt));assert.equal(s.calls(),0);
});

for(const withMark of [true,false])test(withMark?'chapter milestones conflicting with retained target structure reject the whole package':'position-only chapter aliases retain the existing stable-passage alignment behavior',async t=>{
 const s=await setup(t),book=structuredClone(readingBook);await s.target.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records:readingRecords()}]});const incoming=structuredClone(book);incoming.chapters[0].id='reframed-ch01';incoming.sections[0].chapterId='reframed-ch01';incoming.readingStart.chapterId='reframed-ch01';const records=readingRecords();
 if(withMark)records.readingMilestones=[{id:'incoming-mark',bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'reframed-ch01',type:'chapter_read',origin:'user',createdAt:'2026-10-14T12:00:00Z'}];else records.position={passageId:'p1',chapterId:'reframed-ch01',offset:4,mode:'parallel',variant:'literal',contentVersion:book.contentVersion,revision:2,updatedAt:'2026-10-14T12:00:00Z'};
 const bytes=await createLibraryArchive({kind:'marginalia-library',schemaVersion:1,books:[{book:incoming,records}]}),op=await upload(s.portability,bytes),before=(await s.target.library.exportLibrary(owner)).books;
 if(withMark){await assert.rejects(s.portability.commit(owner,op.id),{status:409});assert.deepEqual((await s.target.library.exportLibrary(owner)).books,before);}else{await s.portability.commit(owner,op.id);const saved=(await s.target.library.records(owner,book.bookId)).position;assert.equal(saved.passageId,'p1');assert.equal(saved.chapterId,'ch01');assert.equal(saved.revision,2);await createLibraryArchive(await s.target.library.exportLibrary(owner));}
});
