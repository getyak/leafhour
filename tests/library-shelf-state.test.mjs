import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {exportLibraryInParts} from '../app/library-export.mjs';

const alice={id:'shelf-alice'},bob={id:'shelf-bob'};
async function workspace(t,{catalog=false,translator=null}={}){
  const root=await mkdtemp(path.join(tmpdir(),'reader-shelf-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let catalogDir=null;
  if(catalog){catalogDir=path.join(root,'catalog');await mkdir(catalogDir);await writeFile(path.join(catalogDir,'sample.txt'),'One shared public original.');await writeFile(path.join(catalogDir,'manifest.json'),JSON.stringify([{id:'public-sample',file:'sample.txt',title:'Public sample',originalTitle:'Public sample',author:'Fixture'}]));}
  const library=await createLibraryService({dataDir:path.join(root,'data'),catalogDir,translator});return {root,library,catalogDir};
}
const upload=(library,user,text)=>library.importDocument(user,{filename:'book.txt',bytes:Buffer.from(text)});
const ids=rows=>rows.map(row=>row.bookId);
const status=code=>error=>error.status===code;

test('manual ordering persists per account while an untouched shelf keeps its previous default list',async t=>{
  const {root,library}=await workspace(t),a=await upload(library,alice,'First private original.'),b=await upload(library,alice,'Second private original.');
  assert.deepEqual(await library.shelfState(null),{revision:0,order:[],archived:{}});
  assert.deepEqual(await library.shelfState(alice),{revision:0,order:[],archived:{}});
  assert.deepEqual(ids(await library.list(alice)),[a.bookId,b.bookId]);
  assert.ok((await library.list(alice)).every(row=>!Object.hasOwn(row,'shelfPosition')));
  const state=await library.reorderShelf(alice,{bookIds:[b.bookId,a.bookId],baseRevision:0});
  assert.equal(state.revision,1);assert.deepEqual(state.order,[b.bookId,a.bookId]);
  const restarted=await createLibraryService({dataDir:path.join(root,'data'),catalogDir:null});
  assert.deepEqual(await restarted.shelfState(alice),state);
  assert.deepEqual((await restarted.list(alice)).map(row=>[row.bookId,row.shelfPosition]),[[b.bookId,0],[a.bookId,1]]);
  assert.deepEqual(await restarted.shelfState(bob),{revision:0,order:[],archived:{}});
  const c=await upload(restarted,alice,'A new import after arranging.');
  assert.deepEqual(ids(await restarted.list(alice)),[b.bookId,a.bookId,c.bookId]);
  assert.equal((await restarted.list(alice))[2].shelfPosition,2);
});

test('reorders reject forged, incomplete and duplicate IDs without changing the saved shelf',async t=>{
  const {library}=await workspace(t),a=await upload(library,alice,'One owned book.'),b=await upload(library,alice,'Another owned book.'),foreign=await upload(library,bob,'Another account book.');
  for(const bookIds of [[a.bookId,a.bookId],[a.bookId],[a.bookId,foreign.bookId],[a.bookId,'unknown']])await assert.rejects(library.reorderShelf(alice,{bookIds,baseRevision:0}),error=>[400,404,409].includes(error.status));
  for(const baseRevision of [undefined,-1,0.1,'0',Number.MAX_SAFE_INTEGER+1])await assert.rejects(library.reorderShelf(alice,{bookIds:[a.bookId,b.bookId],baseRevision}),status(400));
  await assert.rejects(library.reorderShelf(alice,{bookIds:Array(1001).fill(a.bookId),baseRevision:0}),status(400));
  await assert.rejects(library.reorderShelf(null,{bookIds:[],baseRevision:0}),status(401));
  assert.equal((await library.shelfState(alice)).revision,0);
  await library.reorderShelf(alice,{bookIds:[b.bookId,a.bookId],baseRevision:0});
  await assert.rejects(library.reorderShelf(alice,{bookIds:[a.bookId,b.bookId],baseRevision:0}),status(409));
  assert.deepEqual((await library.shelfState(alice)).order,[b.bookId,a.bookId]);
});

test('removing a shared catalog book hides it only for its owner and keeps reader data and grants',async t=>{
  const {library}=await workspace(t,{catalog:true,translator:async()=>({literal:'直译草稿',interpretive:'意译草稿'})}),id='public-sample',book=await library.getBook(alice,id),passage=book.sections[0].paragraphs[0];
  await library.translate(alice,id,passage.id);await library.addComment(alice,id,{id:'own-note',passageId:passage.id,text:'My original note.'});
  const grant=await library.createGrant(alice,{bookId:id,scopes:['content','notes']});
  const state=await library.archiveBook(alice,id,{baseRevision:0});
  assert.equal(state.revision,1);assert.equal((await library.list(alice)).length,0);
  assert.deepEqual(ids(await library.list(bob)),[id]);assert.deepEqual(ids(await library.list(null)),[id]);
  assert.equal((await library.getBook(alice,id)).sections[0].paragraphs[0].translations.literal.text,'直译草稿');
  assert.equal((await library.records(alice,id)).comments[0].text,'My original note.');
  assert.deepEqual(await library.authorize(grant.token,id,'notes'),alice);
  const trash=await library.trash(alice);assert.equal(trash[0].bookId,id);assert.ok(Number.isFinite(Date.parse(trash[0].archivedAt)));
  assert.deepEqual(await library.trash(bob),[]);assert.deepEqual(await library.trash(null),[]);
  await assert.rejects(library.archiveBook(null,id,{baseRevision:0}),status(401));
  await assert.rejects(library.restoreBook(alice,id,{baseRevision:0}),status(409));
  await library.restoreBook(alice,id,{baseRevision:1});
  assert.deepEqual(ids(await library.list(alice)),[id]);assert.equal((await library.getBook(alice,id)).sections[0].paragraphs[0].id,passage.id);
  assert.equal((await library.records(alice,id)).comments[0].id,'own-note');assert.deepEqual(await library.trash(alice),[]);
});

test('restoring archived books returns their remembered slots and retains private originals',async t=>{
  const {library}=await workspace(t),a=await upload(library,alice,'Remember the first original.'),b=await upload(library,alice,'Remember the middle original.'),c=await upload(library,alice,'Remember the final original.');
  await library.reorderShelf(alice,{bookIds:[c.bookId,b.bookId,a.bookId],baseRevision:0});
  await library.archiveBook(alice,b.bookId,{baseRevision:1});await library.archiveBook(alice,c.bookId,{baseRevision:2});
  assert.deepEqual((await library.shelfState(alice)).order,[a.bookId]);
  await library.restoreBook(alice,b.bookId,{baseRevision:3});await library.restoreBook(alice,c.bookId,{baseRevision:4});
  assert.deepEqual(ids(await library.list(alice)),[c.bookId,b.bookId,a.bookId]);
  assert.equal((await library.getOriginal(alice,b.bookId)).bytes.toString(),'Remember the middle original.');
  await assert.rejects(library.archiveBook(bob,a.bookId,{baseRevision:0}),status(404));
  await assert.rejects(library.restoreBook(bob,a.bookId,{baseRevision:0}),status(404));
  await assert.rejects(library.archiveBook(alice,'unknown',{baseRevision:5}),status(404));
});

test('full and browser-part backups include archived content, notes and recoverable shelf state',async t=>{
  const {root,library}=await workspace(t),a=await upload(library,alice,'Backup the first book.'),b=await upload(library,alice,'Backup the hidden book.'),passage=b.sections[0].paragraphs[0];
  await library.addComment(alice,b.bookId,{id:'archived-note',passageId:passage.id,text:'Keep this note in the backup.'});
  await library.reorderShelf(alice,{bookIds:[b.bookId,a.bookId],baseRevision:0});await library.archiveBook(alice,b.bookId,{baseRevision:1});
  const full=await library.exportLibrary(alice),manifest=await library.exportManifest(alice);
  assert.equal(full.books.length,2);assert.equal(manifest.books.length,2);
  assert.equal(full.books.find(entry=>entry.book.bookId===b.bookId).records.comments[0].id,'archived-note');
  const backup=await exportLibraryInParts({api:async url=>{if(url==='/api/library/export/manifest')return library.exportManifest(alice);const parsed=new URL(url,'https://fixture.invalid'),id=decodeURIComponent(parsed.pathname.split('/')[4]);return library.exportBookPart(alice,id,{offset:Number(parsed.searchParams.get('offset')),snapshot:parsed.searchParams.get('snapshot')});}});
  assert.equal(backup.books.length,2);assert.ok(backup.books.find(entry=>entry.book.bookId===b.bookId).shelf.archivedAt);
  const target=await createLibraryService({dataDir:path.join(root,'target'),catalogDir:null});
  // The browser restores one book at a time, in an order unrelated to its shelf slot.
  for(const entry of [...backup.books].reverse())await target.restoreLibrary(bob,{...backup,books:[entry]});
  assert.deepEqual(ids(await target.list(bob)),[a.bookId]);assert.equal((await target.trash(bob))[0].bookId,b.bookId);
  assert.equal((await target.records(bob,b.bookId)).comments[0].id,'archived-note');
  await target.restoreBook(bob,b.bookId,{baseRevision:(await target.shelfState(bob)).revision});
  assert.deepEqual(ids(await target.list(bob)),[b.bookId,a.bookId]);
  const malformed=structuredClone(full);malformed.books[0].shelf={order:['unknown','unknown']};
  const empty=await createLibraryService({dataDir:path.join(root,'invalid-target'),catalogDir:null});
  await assert.rejects(empty.restoreLibrary(bob,malformed),status(400));assert.deepEqual(await empty.list(bob),[]);
});

function hostedDatabase(){
  const documents=new Map(),blobs=new Map();
  const fetcher=async(input,options={})=>{
    const url=new URL(input);let result;
    if(url.pathname==='/rest/v1/reader_documents'){const key=url.searchParams.get('key').slice(3);result=documents.has(key)?[structuredClone(documents.get(key))]:[];}
    else if(url.pathname==='/rest/v1/rpc/reader_document_cas'){const {document_key:key,expected_version,document_value}=JSON.parse(options.body),old=documents.get(key);result=(old?.version||0)===expected_version;if(result)documents.set(key,{version:expected_version+1,value:structuredClone(document_value)});}
    else if(url.pathname.startsWith('/storage/v1/object/reader-originals/')){const key=url.pathname.split('/reader-originals/')[1];if(options.method==='POST'){blobs.set(key,Buffer.from(options.body));result={};}else {const bytes=blobs.get(key);if(!bytes)return new Response('{}',{status:404});return new Response(options.method==='HEAD'?null:bytes,{headers:{'content-length':String(bytes.length)}});}}
    else throw Error('Unexpected hosted fixture path');
    return Response.json(result);
  };
  return fetcher;
}

test('independent hosted instances preserve shelf state and reject simultaneous stale mutations',async()=>{
  const fetcher=hostedDatabase(),env={SUPABASE_URL:'https://shelf-fixture.invalid',SUPABASE_SECRET_KEY:'fixture'},create=()=>createLibraryService({dataDir:'hosted-shelf',catalogDir:null,dataStore:createHostedStore({env,fetcher})}),a=await create(),b=await create();
  const first=await upload(a,alice,'First hosted original.'),second=await upload(a,alice,'Second hosted original.');
  const results=await Promise.allSettled([a.reorderShelf(alice,{bookIds:[second.bookId,first.bookId],baseRevision:0}),b.archiveBook(alice,first.bookId,{baseRevision:0})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  const restarted=await create(),state=await restarted.shelfState(alice);assert.equal(state.revision,1);assert.deepEqual(await restarted.shelfState(alice),await a.shelfState(alice));
  assert.deepEqual(await restarted.shelfState(bob),{revision:0,order:[],archived:{}});
  assert.deepEqual((await restarted.getOriginal(alice,first.bookId)).bytes,Buffer.from('First hosted original.'));
});
