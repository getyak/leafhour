import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderServer} from '../server/server.mjs';
import {collectNotebookEntries} from '../app/library-notebook-state.mjs';

test('notebook pages require an owner, include archived notes, and bind cursors to owner and shelf',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-notebook-page-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir,catalogDir:null}),owner={id:'synthetic-a'},other={id:'synthetic-b'};
 const books=[];for(let i=0;i<3;i++)books.push(await library.importDocument(owner,{filename:'book-'+i+'.txt',bytes:Buffer.from('Synthetic source '+i+'.')}));
 const b=books[0],p=b.sections[0].paragraphs[0];await library.addComment(owner,b.bookId,{id:'own-note',passageId:p.id,text:'Saved personal words',quote:p.original,quoteOrigin:'original',contentVersion:b.contentVersion});await library.archiveBook(owner,b.bookId,{baseRevision:0});
 await assert.rejects(()=>library.notebookPage(null,{}),{status:401});const page=await library.notebookPage(owner,{limit:1});assert.equal(page.total,3);assert.equal(page.books.length,1);assert.ok(page.nextCursor);
 const all=[...page.entries];let cursor=page.nextCursor;while(cursor){const next=await library.notebookPage(owner,{cursor,limit:1});all.push(...next.entries);cursor=next.nextCursor;}
 const entries=all.flatMap(({book,records})=>collectNotebookEntries(book,records));assert.equal(entries.length,1);assert.equal(entries[0].text,'Saved personal words');assert.equal(entries[0].quote,p.original);assert.equal(entries[0].quoteOrigin,'original');assert.equal((await library.notebookPage(other,{})).total,0);
 await assert.rejects(()=>library.notebookPage(other,{cursor:page.nextCursor}),{status:409});await assert.rejects(()=>library.notebookPage(owner,{cursor:'bad'}),{status:400});await assert.rejects(()=>library.notebookPage(owner,{limit:13}),{status:400});await library.restoreBook(owner,b.bookId,{baseRevision:1});await assert.rejects(()=>library.notebookPage(owner,{cursor:page.nextCursor}),{status:409});
});

test('notebook HTTP endpoint is authenticated, private and returns saved records without source content',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-notebook-http-')),server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/library/notebook')).status,401);const session=await server.portal.auth.localSession(),b=await server.portal.library.importDocument(session.user,{filename:'http-note.txt',bytes:Buffer.from('Synthetic HTTP source.')}),p=b.sections[0].paragraphs[0];await server.portal.library.addComment(session.user,b.bookId,{id:'http-own',passageId:p.id,text:'HTTP own note'});
 const headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id},response=await fetch(base+'/api/library/notebook?limit=12',{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);let page=await response.json(),entries=[...page.entries];while(page.nextCursor){page=await (await fetch(base+'/api/library/notebook?limit=12&cursor='+encodeURIComponent(page.nextCursor),{headers})).json();entries.push(...page.entries);}assert.ok(entries.some(entry=>entry.records.comments.some(note=>note.text==='HTTP own note')));assert.ok(entries.every(entry=>!entry.book.sections&&!entry.records.readingSessions));assert.equal((await fetch(base+'/api/library/notebook?cursor=bad',{headers})).status,400);
});

test('notebook projection uses only owner metadata and records, caps reads and reports oversized/corrupt documents',async()=>{
 const owner={id:'bounded-owner'},rows=Array.from({length:14},(_,i)=>({bookId:'b'+i,title:{en:'Synthetic '+i},contentVersion:'v1'}));let active=0,max=0;const paths=[];
 const service=await createLibraryService({dataDir:'/synthetic-notebook',catalogDir:null,dataStore:{read:async(file,fallback)=>{paths.push(file);if(file.endsWith('/index.json'))return {books:rows};if(file.endsWith('/shelf.json'))return {revision:0,archived:{},order:[]};assert.match(file,/\/records\//);active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;const {digest}=await import('../server/document-import.mjs');const row=rows.find(row=>file.endsWith(digest(row.bookId)+'.json'));if(row.bookId==='b0')return {bookId:'wrong'};return {bookId:row.bookId,contentVersion:'v1',comments:[{id:'n',origin:'user',text:row.bookId==='b1'?'x'.repeat(3600000):'kept',passageId:'p1'}]};}}});
 const page=await service.notebookPage(owner,{});assert.equal(page.books.length,12);assert.equal(max,3);assert.equal(paths.filter(file=>file.includes('/records/')).length,12);assert.equal(page.failed.length,2);assert.ok(page.failed.some(book=>book.bookId==='b1'&&book.fallback===true));assert.ok(page.failed.some(book=>book.bookId==='b0'&&!book.fallback));assert.ok(page.nextCursor);assert.ok(JSON.stringify(page).length<3500000);
});
