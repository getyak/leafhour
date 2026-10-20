import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createReaderServer} from '../server/server.mjs';
import {createAnnotationArchive,createAnnotationThread,appendAnnotationMessage} from '../app/reader-annotation-records.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {createLibraryArchive,personalExportItems,selectedRecordExport} from '../app/library-portability.mjs';
import {zipSync,unzipSync,strToU8,strFromU8} from '../app/fflate.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';

const owner={id:'synthetic-annotation-portability-owner'},stamp='2026-10-20T00:00:00.000Z';
const entry=(id=readingBook.bookId)=>{const book=structuredClone(readingBook),records=readingRecords();book.bookId=id;records.bookId=id;return {book,records};};
const quote=book=>{const section=book.sections[0],p=section.paragraphs[0];return {kind:'leafhour-reading-quote',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:section.chapterId,parts:[{passageId:p.id,layer:'original',start:0,end:8,text:p.original.slice(0,8)}]};};
function archive(book){let value=createAnnotationArchive(book.bookId);value=createAnnotationThread(value,book,{id:'t',quote:quote(book)},{now:stamp});value=appendAnnotationMessage(value,book,'t',{id:'a',origin:'ai',body:'EXTERNAL_AI_EXPLANATION',createdAt:stamp,provenance:{source:'external-agent',label:'External Agent'}});return appendAnnotationMessage(value,book,'t',{id:'u',origin:'user',body:'PRIVATE_USER_FOLLOWUP',createdAt:stamp});}
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'annotation-portability-'));let calls=0;
 const server=await createReaderServer({bookPath:path.join(dir,'absent'),recordsPath:path.join(dir,'records.json'),authService:{userFor:async token=>token==='fixture'?owner:null},annotationGenerator:async()=>{calls++;return {kind:'annotation',text:'Synthetic'};},chatGenerator:null,companionGenerator:null,translator:null,sendCode:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,headers={Cookie:'marginalia_session=fixture','X-Reader-Owner':owner.id,Origin:base,'Content-Type':'application/json'};
 return {server,library:server.portal.library,annotations:server.portal.chat.annotations,calls:()=>calls,request:(url,body)=>fetch(base+url,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})})};
}
async function stageBytes(f,bytes){const sha256=createHash('sha256').update(bytes).digest('hex'),p=f.server.portal.portability,operation=await p.start(owner,{bytes:bytes.length,sha256});for(let offset=0;offset<bytes.length;offset+=1048576)await p.part(owner,operation.id,{offset,data:Buffer.from(bytes.subarray(offset,offset+1048576)).toString('base64')});return ()=>p.commit(owner,operation.id);}
async function stage(f,backup){return stageBytes(f,await createLibraryArchive(backup));}

test('the optional readerAnnotations key is strict even for null or runtime wrappers',()=>{
 for(const value of [null,{}, {archive:createAnnotationArchive(readingBook.bookId),runs:[]}])assert.throws(()=>validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[{...entry(),readerAnnotations:value}]}));
 assert.doesNotThrow(()=>validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[{...entry(),readerAnnotations:archive(readingBook)}]}));
});

test('legacy JSON and both part exports preserve annotations and restore words without jobs',async t=>{
 const source=await fixture(t),target=await fixture(t),seed=entry();await source.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[seed]});
 await source.annotations.restoreArchive(owner,seed.book,archive(seed.book));const expected=await source.annotations.exportArchive(owner,seed.book.bookId);
 const response=await source.request('/api/library/export');assert.equal(response.status,200);const backup=await response.json();
 assert.deepEqual(backup.books.find(row=>row.book.bookId===seed.book.bookId).readerAnnotations,expected);
 for(const action of ['export-part','portability-part']){const part=await (await source.request('/api/library/books/'+seed.book.bookId+'/'+action)).json(),content=JSON.parse(Buffer.from(part.data,'base64'));assert.deepEqual(content.readerAnnotations,expected);assert.equal(part.nextOffset,null);}
 assert.equal((await target.request('/api/library/validate',backup)).status,200);
 assert.equal((await target.request('/api/library/import',backup)).status,200);
 const restored=await target.annotations.exportArchive(owner,seed.book.bookId);assert.deepEqual(restored.threads,expected.threads);assert.ok(restored.revision>=expected.revision);assert.deepEqual((await target.annotations.view(owner,seed.book.bookId)).requests,[]);
 assert.equal(source.calls()+target.calls(),0);
});

test('a malformed final JSON annotation prevents every earlier book or record side effect',async t=>{
 const f=await fixture(t),backup={kind:'marginalia-library',schemaVersion:1,books:[entry('first-new-annotation-book'),{...entry('last-new-annotation-book'),readerAnnotations:null}]};
 for(const route of ['/api/library/validate','/api/library/import'])assert.equal((await f.request(route,backup)).status,400);
 await assert.rejects(f.library.getBook(owner,'first-new-annotation-book'),error=>error.status===404);assert.equal(f.calls(),0);
});

test('a hash-consistent malformed final ZIP annotation is rejected before installing any book',async t=>{
 const f=await fixture(t),backup={kind:'marginalia-library',schemaVersion:1,books:[entry('zip-first-new-book'),entry('zip-last-new-book')]};
 const files=unzipSync(await createLibraryArchive(backup)),name='books/001.json',last=JSON.parse(strFromU8(files[name]));last.readerAnnotations=null;files[name]=strToU8(JSON.stringify(last));
 const manifest=JSON.parse(strFromU8(files['manifest.json'])),row=manifest.files.find(row=>row.path===name);row.bytes=files[name].length;row.sha256=createHash('sha256').update(files[name]).digest('hex');files['manifest.json']=strToU8(JSON.stringify(manifest));
 const commit=await stageBytes(f,zipSync(files,{level:0}));await assert.rejects(commit,error=>error.status===400);
 await assert.rejects(f.library.getBook(owner,'zip-first-new-book'),error=>error.status===404);assert.equal(f.calls(),0);
});

test('ZIP and JSON merge preflight reject final conflicts before an earlier new book is installed',async t=>{
 const f=await fixture(t),held=entry();await f.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[held]});
 await f.annotations.restoreArchive(owner,held.book,archive(held.book));const saved=await f.annotations.exportArchive(owner,held.book.bookId);
 const changed=structuredClone(saved);changed.threads[0].messages[0].body='CONFLICTING_AI_WORDS';
 const backup={kind:'marginalia-library',schemaVersion:1,books:[entry('earlier-new-book'),{...held,readerAnnotations:changed}]};
 const commit=await stage(f,backup);await assert.rejects(commit,error=>error.status===409);
 assert.equal((await f.request('/api/library/import',backup)).status,409);
 await assert.rejects(f.library.getBook(owner,'earlier-new-book'),error=>error.status===404);
 assert.deepEqual(await f.annotations.exportArchive(owner,held.book.bookId),saved);assert.equal(f.calls(),0);
});

test('old JSON and ZIP backups preserve current annotations and tombstones',async t=>{
 const f=await fixture(t),held=entry(),backup={kind:'marginalia-library',schemaVersion:1,books:[held]};await f.library.restoreLibrary(owner,backup);
 await f.annotations.restoreArchive(owner,held.book,archive(held.book));await f.annotations.remove(owner,held.book.bookId,'t');const before=await f.annotations.exportArchive(owner,held.book.bookId);
 assert.equal((await f.request('/api/library/import',backup)).status,200);assert.deepEqual(await f.annotations.exportArchive(owner,held.book.bookId),before);
 await (await stage(f,backup))();assert.deepEqual(await f.annotations.exportArchive(owner,held.book.bookId),before);
 await (await stage(f,{...backup,books:[{...held,readerAnnotations:archive(held.book)}]}))();assert.deepEqual(await f.annotations.exportArchive(owner,held.book.bookId),before);assert.equal(f.calls(),0);
});

test('selected exports separate AI and user words, preserve attribution and honor nested quote opt-out',()=>{
 const value=entry(),backup={kind:'marginalia-library',schemaVersion:1,books:[{...value,readerAnnotations:archive(value.book)}]},items=personalExportItems(backup),ai=items.find(row=>row.category==='annotation'),user=items.find(row=>row.category==='annotationReply');
 assert.ok(ai);assert.ok(user);assert.equal(ai.origin,'ai');assert.equal(user.origin,'user');
 const hidden=JSON.parse(selectedRecordExport([ai],{includeQuotes:false})).items[0];assert.equal(hidden.provenance.source,'external-agent');assert.equal(hidden.threadId,'t');assert.ok(!JSON.stringify(hidden).includes('PRIVATE_USER_FOLLOWUP'));assert.equal(hidden.typedQuote.parts[0].text,undefined);
 const shown=JSON.parse(selectedRecordExport([ai],{includeQuotes:true})).items[0];assert.equal(shown.typedQuote.parts[0].text,quote(value.book).parts[0].text);
 const markdown=selectedRecordExport([ai],{format:'markdown'});assert.match(markdown,/External Agent/);assert.match(markdown,/external-agent/);assert.doesNotMatch(markdown,/PRIVATE_USER_FOLLOWUP/);
});

test('historical translation citations survive ZIP restore into a target with newer translation words',async t=>{
 const f=await fixture(t),held=entry(),p=held.book.sections[0].paragraphs[0];p.translations.literal={text:'NEW_TRANSLATION',origin:'ai',status:'draft'};
 await f.library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[held]});
 const incoming=structuredClone(held);incoming.book.sections[0].paragraphs[0].translations.literal.text='OLD_TRANSLATION';
 let saved=createAnnotationThread(createAnnotationArchive(held.book.bookId),incoming.book,{id:'historical',quote:quote(incoming.book)},{now:stamp});
 saved=appendAnnotationMessage(saved,incoming.book,'historical',{id:'historical-answer',origin:'ai',body:'Saved AI words.',createdAt:stamp,provenance:{source:'site-agent',label:'Leafhour reading agent'},sourceRefs:[{passageId:p.id,layer:'literal',quote:'OLD_TRANSLATION'}]});
 await (await stage(f,{kind:'marginalia-library',schemaVersion:1,books:[{...incoming,readerAnnotations:saved}]}))();
 assert.equal((await f.library.getBook(owner,held.book.bookId)).sections[0].paragraphs[0].translations.literal.text,'NEW_TRANSLATION');
 const result=await f.annotations.exportArchive(owner,held.book.bookId);assert.deepEqual(result.threads,saved.threads);assert.equal(f.calls(),0);
 const ai=personalExportItems({kind:'marginalia-library',schemaVersion:1,books:[{...held,readerAnnotations:result}]}).find(row=>row.category==='annotation');
 const hidden=JSON.parse(selectedRecordExport([ai],{includeQuotes:false})).items[0];assert.equal(hidden.sourceRefs[0].quote,undefined);assert.equal(hidden.sourceRefs[0].bookId,held.book.bookId);assert.ok(!JSON.stringify(hidden).includes('OLD_TRANSLATION'));
 const shown=JSON.parse(selectedRecordExport([ai],{includeQuotes:true})).items[0];assert.equal(shown.sourceRefs[0].quote,'OLD_TRANSLATION');
});
