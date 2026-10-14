import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {digest} from '../server/document-import.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {exportLibraryInParts} from '../app/library-export.mjs';
import {createLibraryService} from '../server/library-service.mjs';

test('ordinary large books export through bounded authenticated parts and retain exact Unicode source',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reading-export-http-')),server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,login=await server.portal.auth.localSession(),owner=login.user,headers={Cookie:'marginalia_session='+login.token,'X-Reader-Owner':owner.id};
  const books=[];for(const character of ['甲','乙'])books.push(await server.portal.library.importDocument(owner,{filename:'容量验收'+character+'.txt',bytes:Buffer.from(Array.from({length:30},()=>character.repeat(30000)).join('\n\n'))}));
  const legacy=await server.portal.library.exportLibrary(owner);assert.ok(Buffer.byteLength(JSON.stringify(legacy))>4.5*1024*1024,'the former aggregate response exceeds the actual hosting budget');
  const manifestResponse=await fetch(base+'/api/library/export/manifest',{headers});assert.equal(manifestResponse.status,200);const manifest=await manifestResponse.json();assert.ok(manifest.books.some(b=>b.bookId===books[0].bookId));
  assert.equal((await fetch(base+'/api/library/export/manifest')).status,401);
  const url=base+'/api/library/books/'+books[0].bookId+'/export-part';assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,'X-Reader-Owner':'different'}})).status,409);
  const chunks=[];let offset=0,snapshot;
  do{const r=await fetch(url+'?offset='+offset+(snapshot?'&snapshot='+snapshot:''),{headers}),text=await r.text();assert.equal(r.status,200);assert.ok(Buffer.byteLength(text)<1500000);const part=JSON.parse(text);assert.equal(part.offset,offset);snapshot??=part.snapshot;assert.equal(part.snapshot,snapshot);chunks.push(Buffer.from(part.data,'base64'));offset=part.nextOffset;}while(offset!==null);
  const raw=Buffer.concat(chunks);assert.equal(digest(raw),snapshot);const entry=JSON.parse(raw.toString('utf8'));assert.equal(entry.book.sections[0].paragraphs[0].original,books[0].sections[0].paragraphs[0].original);validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[entry]});
  const anchor=books[0].sections[0].paragraphs[0].id;await server.portal.library.addComment(owner,books[0].bookId,{id:'changed-during-export',passageId:anchor,text:'合成验收：导出途中新增的记录。'});assert.equal((await fetch(url+'?offset=1048576&snapshot='+snapshot,{headers})).status,409);
  for(const query of ['offset=-1','offset=0.5','offset=10','offset=0&snapshot=not-a-hash'])assert.equal((await fetch(url+'?'+query,{headers})).status,400);
  assert.equal((await fetch(base+'/api/library/export',{headers})).status,200,'existing local clients remain compatible');
  const all=await exportLibraryInParts({api:async url=>{const r=await fetch(base+url,{headers}),body=await r.json();if(!r.ok)throw Object.assign(Error(body.error),{status:r.status});return body;}}),fresh=await createLibraryService({dataDir:path.join(dir,'fresh'),catalogDir:null,translator:null});
  await fresh.restoreLibrary({id:'clean-reader'},all);assert.equal((await fresh.getBook({id:'clean-reader'},books[1].bookId)).sections[0].paragraphs[0].original,books[1].sections[0].paragraphs[0].original);assert.equal((await fresh.records({id:'clean-reader'},books[0].bookId)).comments[0].id,'changed-during-export');
});

test('unchanged public-book parts remain stable across independent service instances',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reading-export-instances-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const owner={id:'synthetic-instance-reader'},first=await createLibraryService({dataDir:dir}),book=await first.getBook(owner,'gutenberg-walden');
  const records={kind:'marginalia-personal-records',schemaVersion:3,bookId:book.bookId,contentVersion:book.contentVersion,comments:Array.from({length:200},(_,i)=>({id:'synthetic-comment-'+i,passageId:book.sections[0].paragraphs[0].id,origin:'user',text:'甲'.repeat(2000),createdAt:'2026-10-14T12:00:00.000Z'})),questions:[],readingSessions:[],readingMilestones:[],position:null};
  await first.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book,records}]});
  const second=await createLibraryService({dataDir:dir}),secondBook=await second.getBook(owner,book.bookId);
  assert.notEqual(book.createdAt,secondBook.createdAt,'the fixture must expose independent instance timestamps');
  const initial=await first.exportBookPart(owner,book.bookId);assert.ok(initial.nextOffset,'ordinary accumulated notes should require more than one part');
  const chunks=[Buffer.from(initial.data,'base64')];let offset=initial.nextOffset;
  while(offset!==null){const part=await second.exportBookPart(owner,book.bookId,{offset,snapshot:initial.snapshot});assert.equal(part.snapshot,initial.snapshot);chunks.push(Buffer.from(part.data,'base64'));offset=part.nextOffset;}
  const entry=JSON.parse(Buffer.concat(chunks).toString('utf8'));validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[entry]});
  assert.deepEqual(entry.book.sections,book.sections);assert.deepEqual(entry.records.comments,records.comments);
  assert.equal(entry.book.createdAt,undefined,'an instance start is not a public edition creation date');
  await second.addComment(owner,book.bookId,{id:'real-later-change',passageId:book.sections[0].paragraphs[0].id,text:'合成验收：真正的新记录仍须使快照失效。'});
  await assert.rejects(first.exportBookPart(owner,book.bookId,{offset:initial.nextOffset,snapshot:initial.snapshot}),{status:409});
});
