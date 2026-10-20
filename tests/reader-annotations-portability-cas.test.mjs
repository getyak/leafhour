import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderChatService} from '../server/reader-chat.mjs';
import {createLibraryPortability} from '../server/library-portability.mjs';
import {createBookGifts} from '../server/book-gifts.mjs';
import {createAnnotationArchive,createAnnotationThread,appendAnnotationMessage} from '../app/reader-annotation-records.mjs';
import {createLibraryArchive,personalExportItems,selectedRecordExport} from '../app/library-portability.mjs';
import {readingBook,readingRecords} from '../tests/reading-fixtures.mjs';

// Real domain services and HostedStore CAS, but all fetch traffic ends in this
// Map. No socket, filesystem fixture, model, credentials or real records.
const owner={id:'independent-synthetic-owner'},stamp='2026-10-20T00:00:00.000Z';
const entry=(id='synthetic-review-book')=>{const book=structuredClone(readingBook),records=readingRecords();book.bookId=id;records.bookId=id;return {book,records};};
const quote=book=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:book.sections[0].chapterId,parts:[{passageId:book.sections[0].paragraphs[0].id,layer:'original',start:0,end:8,text:book.sections[0].paragraphs[0].original.slice(0,8)}]});
function archive(book,{thread='t',body='AI_EXPLICIT_WORDS',refs,reply=true}={}){
 let a=createAnnotationThread(createAnnotationArchive(book.bookId),book,{id:thread,quote:quote(book)},{now:stamp});
 a=appendAnnotationMessage(a,book,thread,{id:'a',origin:'ai',body,createdAt:stamp,provenance:{source:'external-agent',label:'External Agent'},...(refs?{sourceRefs:refs}:{})});
 return reply?appendAnnotationMessage(a,book,thread,{id:'u',origin:'user',body:'PRIVATE_FOLLOWUP_SENTINEL',createdAt:stamp}):a;
}
const backup=entries=>({kind:'marginalia-library',schemaVersion:1,books:entries});
async function fixture(t){
 const docs=new Map();let gate=null,calls=0;
 const fetcher=async(raw,options={})=>{const url=new URL(raw);if(url.pathname.endsWith('/reader_document_cas')){
  const p=JSON.parse(options.body);if(gate&&!gate.used&&gate.predicate(p)){gate.used=true;gate.reached();await gate.proceed;}
  const old=docs.get(p.document_key);if((old?.version||0)!==p.expected_version)return new Response('false');docs.set(p.document_key,{version:p.expected_version+1,value:structuredClone(p.document_value)});return new Response('true');
 }assert.ok(url.pathname.endsWith('/reader_documents'),'unexpected synthetic fetch '+url.pathname);const k=url.searchParams.get('key').slice(3),d=docs.get(k);return new Response(JSON.stringify(d?[{version:d.version,value:structuredClone(d.value)}]:[]));};
 const store=createHostedStore({env:{SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEY:'synthetic-not-a-credential'},fetcher});
 const dataDir='/synthetic-review-no-files';
 const library=await createLibraryService({dataDir,catalogDir:null,dataStore:store,translator:null});
 const chat=await createReaderChatService({library,dataDir,dataStore:store,generator:null,companionGenerator:null,annotationGenerator:async()=>{calls++;throw Error('Model must never run');}});
 const p=createLibraryPortability({library,chat,store});t.after(()=>chat.close());
 return {library,chat,p,store,docs,calls:()=>calls,snapshot:()=>JSON.stringify([...docs].sort(([a],[b])=>a.localeCompare(b))),
  block(predicate){let reached,release;const ready=new Promise(r=>reached=r),proceed=new Promise(r=>release=r);gate={predicate,reached,proceed,used:false};return {ready,release};}};
}
async function stage(f,value){const bytes=await createLibraryArchive(value),op=await f.p.start(owner,{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});for(let off=0;off<bytes.length;off+=1048576)await f.p.part(owner,op.id,{offset:off,data:Buffer.from(bytes.subarray(off,off+1048576)).toString('base64')});return ()=>f.p.commit(owner,op.id);}

test('legacy coordinator and ZIP round-trip complete archive without jobs; owner stays isolated',async t=>{
 const a=await fixture(t),b=await fixture(t),e=entry();await a.library.restoreLibrary(owner,backup([e]));await a.chat.annotations.restoreArchive(owner,e.book,archive(e.book));
 const expected=await a.chat.annotations.exportArchive(owner,e.book.bookId),out=await a.p.exportLibrary(owner);assert.deepEqual(out.books[0].readerAnnotations,expected);
 const part=await a.p.exportPart(owner,e.book.bookId),decoded=JSON.parse(Buffer.from(part.data,'base64'));assert.deepEqual(decoded.readerAnnotations,expected);
 await b.p.restoreLibrary(owner,out);assert.deepEqual((await b.chat.annotations.exportArchive(owner,e.book.bookId)).threads,expected.threads);
 await (await stage(b,out))();assert.deepEqual((await b.chat.annotations.exportArchive(owner,e.book.bookId)).threads,expected.threads);
 assert.deepEqual((await b.chat.annotations.view(owner,e.book.bookId)).requests,[]);await assert.rejects(b.chat.annotations.exportArchive({id:'synthetic-other-owner'},e.book.bookId),{status:404});assert.equal(a.calls()+b.calls(),0);
});
test('malformed final archive and existing final conflict leave every earlier book/record untouched',async t=>{
 const f=await fixture(t),held=entry();await f.library.restoreLibrary(owner,backup([held]));await f.chat.annotations.restoreArchive(owner,held.book,archive(held.book));let before=f.snapshot();
 await assert.rejects(f.p.restoreLibrary(owner,backup([entry('earlier-new'),{...held,readerAnnotations:null}])),{status:400});assert.equal(f.snapshot(),before);
 const conflict=archive(held.book,{body:'CONFLICTING_WORDS'});before=f.snapshot();await assert.rejects(f.p.restoreLibrary(owner,backup([entry('earlier-new'),{...held,readerAnnotations:conflict}])),{status:409});assert.equal(f.snapshot(),before);assert.equal(f.calls(),0);
});
test('applied-target conflict is caught for all entries before any annotation restore',async t=>{
 const f=await fixture(t),held=entry(),early=entry('earlier-new');await f.library.restoreLibrary(owner,backup([held]));
 const lib={...f.library,restoreLibrary:async(...args)=>{const r=await f.library.restoreLibrary(...args);await f.chat.annotations.restoreArchive(owner,held.book,archive(held.book,{body:'CONCURRENT_COMMITTED'}));return r;}};
 const p=createLibraryPortability({library:lib,chat:f.chat,store:f.store});
 await assert.rejects(p.restoreLibrary(owner,backup([{...early,readerAnnotations:archive(early.book)},{...held,readerAnnotations:archive(held.book)}])),{status:409});
 assert.equal((await f.library.getBook(owner,early.book.bookId)).bookId,early.book.bookId);assert.deepEqual((await f.chat.annotations.exportArchive(owner,early.book.bookId)).threads,[]);
 assert.equal((await f.chat.annotations.exportArchive(owner,held.book.bookId)).threads[0].messages[0].body,'CONCURRENT_COMMITTED');assert.equal(f.calls(),0);
});
test('domain restore CAS retry rejects a concurrent changed same identity instead of overwriting',async t=>{
 const f=await fixture(t),e=entry();await f.library.restoreLibrary(owner,backup([e]));
 const gate=f.block(p=>p.document_key.includes('/annotations/')&&p.document_value.archive?.threads.some(x=>x.messages.some(m=>m.body==='AI_EXPLICIT_WORDS')));
 const pending=f.p.restoreLibrary(owner,backup([{...e,readerAnnotations:archive(e.book)}]));pending.catch(()=>{});await gate.ready;
 await f.chat.annotations.restoreArchive(owner,e.book,archive(e.book,{body:'CONCURRENT_COMMITTED'}));gate.release();await assert.rejects(pending,{status:409});assert.equal((await f.chat.annotations.exportArchive(owner,e.book.bookId)).threads[0].messages[0].body,'CONCURRENT_COMMITTED');assert.equal(f.calls(),0);
});
test('domain restore CAS retry preserves unrelated concurrent thread',async t=>{
 const f=await fixture(t),e=entry();await f.library.restoreLibrary(owner,backup([e]));
 const gate=f.block(p=>p.document_key.includes('/annotations/')&&p.document_value.archive?.threads.some(x=>x.id==='t'));
 const pending=f.p.restoreLibrary(owner,backup([{...e,readerAnnotations:archive(e.book)}]));pending.catch(()=>{});await gate.ready;
 await f.chat.annotations.restoreArchive(owner,e.book,archive(e.book,{thread:'concurrent',body:'OTHER_AI_WORDS'}));gate.release();await pending;
 assert.deepEqual((await f.chat.annotations.exportArchive(owner,e.book.bookId)).threads.map(x=>x.id).sort(),['concurrent','t']);assert.equal(f.calls(),0);
});
test('historical refs survive newer target translation, omitted old archives never erase tombstones',async t=>{
 const f=await fixture(t),e=entry();e.book.sections[0].paragraphs[0].translations.literal={text:'NEW_TRANSLATION',origin:'ai',status:'draft'};await f.library.restoreLibrary(owner,backup([e]));
 const old=structuredClone(e);old.book.sections[0].paragraphs[0].translations.literal.text='OLD_TRANSLATION';const a=archive(old.book,{refs:[{passageId:old.book.sections[0].paragraphs[0].id,layer:'literal',quote:'OLD_TRANSLATION'}]});
 await f.p.restoreLibrary(owner,backup([{...old,readerAnnotations:a}]));assert.deepEqual((await f.chat.annotations.exportArchive(owner,e.book.bookId)).threads,a.threads);assert.equal((await f.library.getBook(owner,e.book.bookId)).sections[0].paragraphs[0].translations.literal.text,'NEW_TRANSLATION');
 await f.chat.annotations.remove(owner,e.book.bookId,'t');const removed=await f.chat.annotations.exportArchive(owner,e.book.bookId);await f.p.restoreLibrary(owner,backup([e]));await (await stage(f,backup([{...old,readerAnnotations:a}])))();assert.deepEqual(await f.chat.annotations.exportArchive(owner,e.book.bookId),removed);assert.equal(f.calls(),0);
});
test('selected JSON/Markdown preserve external provenance without secondary quote/private follow-up leakage',()=>{
 const e=entry();e.book.sections[0].paragraphs[0].translations.literal={text:'CITATION_SENTINEL',origin:'ai',status:'draft'};const a=archive(e.book,{refs:[{passageId:e.book.sections[0].paragraphs[0].id,layer:'literal',quote:'CITATION_SENTINEL'}]});const items=personalExportItems(backup([{...e,readerAnnotations:a}])),ai=items.find(x=>x.category==='annotation'),user=items.find(x=>x.category==='annotationReply');
 assert.ok(user);for(const format of ['json','markdown']){const hidden=selectedRecordExport([ai],{format,sharing:true,includeQuotes:false});for(const secret of ['PRIVATE_FOLLOWUP_SENTINEL','CITATION_SENTINEL',quote(e.book).parts[0].text])assert.ok(!hidden.includes(secret));assert.ok(hidden.includes('external-agent'));assert.ok(hidden.includes('External Agent'));const shown=selectedRecordExport([ai],{format,includeQuotes:true});assert.ok(shown.includes('CITATION_SENTINEL'));assert.ok(shown.includes(quote(e.book).parts[0].text));}assert.ok(selectedRecordExport([user]).includes('PRIVATE_FOLLOWUP_SENTINEL'));
});
test('real gift construction and download remain unenriched',async t=>{
 const f=await fixture(t),e=entry();await f.library.restoreLibrary(owner,backup([e]));await f.chat.annotations.restoreArchive(owner,e.book,archive(e.book));
 const gifts=createBookGifts({library:f.library,dataDir:'/synthetic-review-no-files',dataStore:f.store});const card=await gifts.create(owner,e.book.bookId),token=card.shareUrl.split('/').at(-1),pack=await gifts.download(token);assert.equal(Object.hasOwn(pack.books[0],'readerAnnotations'),false);assert.equal(Object.hasOwn(pack.books[0],'chat'),false);for(const secret of ['AI_EXPLICIT_WORDS','PRIVATE_FOLLOWUP_SENTINEL'])assert.ok(!JSON.stringify(pack).includes(secret));assert.equal(f.calls(),0);
});
