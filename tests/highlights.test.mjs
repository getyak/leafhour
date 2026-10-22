import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
import {normalizeHighlight,highlightSegments} from '../app/highlights.mjs';

const owner={id:'highlight-reader'},other={id:'highlight-other'};
const selection=(patch={})=>({id:'highlight-1',bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,chapterId:'ch01',parts:[{passageId:'p1',language:'en',variant:'interpretive',start:5,end:9,text:'this'}],...patch});
async function setup(t){
  const dir=await mkdtemp(path.join(tmpdir(),'reader-highlights-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null});
  await library.restoreLibrary(owner,{kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(readingBook),records:readingRecords()}]});
  return {library,dir};
}

test('a selected phrase is saved once and is private to its account',async t=>{
  const {library}=await setup(t);assert.equal(typeof library.addHighlight,'function');
  const record=await library.addHighlight(owner,readingBook.bookId,selection());
  assert.equal(record.origin,'user');assert.equal(record.parts[0].text,'this');
  assert.deepEqual(await library.addHighlight(owner,readingBook.bookId,selection()),record);
  assert.equal((await library.addHighlight(owner,readingBook.bookId,selection({id:'retry-with-new-id'}))).id,record.id);
  assert.equal((await library.records(owner,readingBook.bookId)).highlights.length,1);
  await assert.rejects(library.addHighlight(null,readingBook.bookId,selection()),e=>e.status===401);
  await assert.rejects(library.records(other,readingBook.bookId),e=>e.status===404);
  await library.restoreLibrary(other,{kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(readingBook),records:readingRecords()}]});
  assert.deepEqual((await library.records(other,readingBook.bookId)).highlights,[]);
});

test('forged quotes, changed versions and cross-chapter selections are rejected',async t=>{
  const {library}=await setup(t);assert.equal(typeof library.addHighlight,'function');
  const invalid=[selection({contentVersion:'old'}),selection({origin:'ai'}),selection({parts:[{...selection().parts[0],text:'fake'}]}),selection({parts:[{...selection().parts[0],start:-1}]}),selection({parts:[{...selection().parts[0],passageId:'p3'}]}),selection({parts:[{...selection().parts[0],language:'zh'}]}),selection({parts:[]})];
  for(const input of invalid)await assert.rejects(library.addHighlight(owner,readingBook.bookId,input),e=>e.status===400);
  assert.equal((await library.records(owner,readingBook.bookId)).highlights.length,0);
});

test('highlights survive a clean-instance restore and a removal cannot be resurrected by an old backup',async t=>{
  const {library,dir}=await setup(t);assert.equal(typeof library.addHighlight,'function');
  await library.addHighlight(owner,readingBook.bookId,selection());const backup=await library.exportLibrary(owner);
  const restored=await createLibraryService({dataDir:path.join(dir,'fresh'),catalogDir:null});await restored.restoreLibrary(other,backup);
  assert.equal((await restored.records(other,readingBook.bookId)).highlights[0].parts[0].text,'this');
  const removed=await library.removeHighlight(owner,readingBook.bookId,'highlight-1');assert.ok(removed.deletedAt);
  assert.deepEqual(await library.removeHighlight(owner,readingBook.bookId,'highlight-1'),removed);
  await library.restoreLibrary(owner,backup);
  assert.ok((await library.records(owner,readingBook.bookId)).highlights[0].deletedAt);
  assert.ok((await library.addHighlight(owner,readingBook.bookId,selection())).deletedAt);
  await assert.rejects(library.addHighlight(owner,readingBook.bookId,selection({parts:[{...selection().parts[0],start:0,end:4,text:'Read'}]})),e=>e.status===409);
});

test('backup validation refuses malformed highlight records before writing',async t=>{
  const {library,dir}=await setup(t);assert.equal(typeof library.addHighlight,'function');
  await library.addHighlight(owner,readingBook.bookId,selection());
  const backup=await library.exportLibrary(owner);backup.books[0].records.highlights[0].parts[0].text='fake';
  const target=await createLibraryService({dataDir:path.join(dir,'invalid'),catalogDir:null});
  await assert.rejects(target.restoreLibrary(other,backup),e=>e.status===400);assert.equal((await target.list(other)).length,0);
});

test('a changed translation retains its historical quote in export and restore without painting unrelated words',async t=>{
  const {library,dir}=await setup(t),backup=await library.exportLibrary(owner),book=backup.books[0].book;
  book.sections[0].paragraphs[0].translations.interpretive={text:'这里是旧译文。',origin:'ai',status:'draft'};await library.restoreLibrary(owner,backup);
  await library.addHighlight(owner,book.bookId,selection({parts:[{passageId:'p1',language:'zh',variant:'interpretive',start:3,end:6,text:'旧译文'}]}));
  const changed=await library.exportLibrary(owner);changed.books[0].book.sections[0].paragraphs[0].translations.interpretive.text='这里是新文字。';
  const target=await createLibraryService({dataDir:path.join(dir,'changed'),catalogDir:null});await target.restoreLibrary(other,changed);
  const stored=(await target.records(other,book.bookId)).highlights[0];assert.equal(stored.parts[0].text,'旧译文');
  const spans=highlightSegments('这里是新文字。',[{id:stored.id,part:stored.parts[0]}]);assert.equal(spans.filter(span=>span.ids.length).length,0);
});

test('selected text boundaries reject split emoji and count paragraph separators within the quote limit',()=>{
  const book=structuredClone(readingBook);book.sections[0].paragraphs[0].original='A😀B';
  assert.throws(()=>normalizeHighlight(selection({parts:[{passageId:'p1',language:'en',variant:'literal',start:1,end:2,text:'\uD83D'}]}),book));
  const valid=normalizeHighlight(selection({parts:[{passageId:'p1',language:'en',variant:'literal',start:1,end:3,text:'😀'}]}),book);assert.equal(valid.parts[0].text,'😀');
  book.sections[0].paragraphs[0].original='A'.repeat(2000);book.sections[0].paragraphs[1].original='B'.repeat(2000);
  assert.throws(()=>normalizeHighlight(selection({parts:book.sections[0].paragraphs.map(p=>({passageId:p.id,language:'en',variant:'literal',start:0,end:2000,text:p.original}))}),book));
});

test('an identical acknowledged highlight remains retryable after its translation changes',async t=>{
  const {library}=await setup(t),backup=await library.exportLibrary(owner);backup.books[0].book.sections[0].paragraphs[0].translations.interpretive={text:'这里是旧译文。',origin:'ai',status:'draft'};await library.restoreLibrary(owner,backup);
  const input=selection({parts:[{passageId:'p1',language:'zh',variant:'interpretive',start:3,end:6,text:'旧译文'}]}),saved=await library.addHighlight(owner,readingBook.bookId,input);
  const changed=await library.exportLibrary(owner);changed.books[0].book.sections[0].paragraphs[0].translations.interpretive.text='这里是新文字。';await library.restoreLibrary(owner,changed);
  assert.deepEqual(await library.addHighlight(owner,readingBook.bookId,input),saved);
  await assert.rejects(library.addHighlight(owner,readingBook.bookId,{...input,id:'new-stale-request'}),e=>e.status===400);
});

test('a deduplicated request stays canceled when its lost acknowledgement is retried, including after restore',async t=>{
  const {library,dir}=await setup(t);await library.addHighlight(owner,readingBook.bookId,selection());
  const duplicate=selection({id:'second-tab-request'});assert.equal((await library.addHighlight(owner,readingBook.bookId,duplicate)).id,'highlight-1');
  await library.removeHighlight(owner,readingBook.bookId,'highlight-1');
  assert.ok((await library.addHighlight(owner,readingBook.bookId,duplicate)).deletedAt);
  const fresh=await createLibraryService({dataDir:path.join(dir,'alias-restored'),catalogDir:null});await fresh.restoreLibrary(other,await library.exportLibrary(owner));
  assert.ok((await fresh.addHighlight(other,readingBook.bookId,duplicate)).deletedAt);
  assert.equal((await fresh.records(other,readingBook.bookId)).highlights.filter(row=>!row.deletedAt).length,0);
});

const agentQuote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,chapterId:'ch01',parts:[{passageId:'p1',layer:'original',start:5,end:9,text:'this'}]});
test('external highlights share web records, validate exact quotes and return idempotent narrow receipts',async t=>{
 const {library,dir}=await setup(t),input={bookId:readingBook.bookId,id:'agent-highlight',quote:agentQuote()},grant=await library.createGrant(owner,{bookId:readingBook.bookId,scopes:['highlight:write']});
 const authorize=()=>library.authorize(grant.token,readingBook.bookId,'highlight:write');
 const receipt=await library.addAgentHighlight(owner,readingBook.bookId,input,{authorize});
 assert.deepEqual(Object.keys(receipt).sort(),['createdAt','highlightId','status']);assert.equal(receipt.status,'stored');
 assert.deepEqual(await library.addAgentHighlight(owner,readingBook.bookId,input,{authorize}),receipt);
 const rows=(await library.records(owner,readingBook.bookId)).highlights;assert.equal(rows.length,1);assert.equal(rows[0].createdVia,'external-agent');assert.equal(rows[0].parts[0].text,'this');
 for(const patch of [{ownerId:other.id},{quote:{...agentQuote(),contentVersion:'stale'}},{quote:{...agentQuote(),parts:[{...agentQuote().parts[0],text:'fake'}]}}])await assert.rejects(library.addAgentHighlight(owner,readingBook.bookId,{...input,id:'bad',...patch},{authorize}));
 await assert.rejects(library.addAgentHighlight(other,readingBook.bookId,input,{authorize}));
 const fresh=await createLibraryService({dataDir:path.join(dir,'agent-restore'),catalogDir:null});await fresh.restoreLibrary(other,await library.exportLibrary(owner));assert.equal((await fresh.records(other,readingBook.bookId)).highlights[0].createdVia,'external-agent');
 await library.removeHighlight(owner,readingBook.bookId,receipt.highlightId);assert.equal((await library.addAgentHighlight(owner,readingBook.bookId,input,{authorize})).status,'deleted');
 await library.revokeGrant(owner,grant.id);await assert.rejects(library.addAgentHighlight(owner,readingBook.bookId,input,{authorize}));
 assert.equal((await library.records(owner,readingBook.bookId)).position,null);assert.equal((await library.records(owner,readingBook.bookId)).readingSessions.length,0);
});

test('real SDK memory transport lists only granted tools and saves a highlighted AI evaluation',{timeout:15000},async t=>{
 const {createMcpReadingServer}=await import('../server/mcp-http.mjs');assert.equal(typeof createMcpReadingServer,'function');
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js'),{createReaderChatService}=await import('../server/reader-chat.mjs');
 const {library,dir}=await setup(t),chat=await createReaderChatService({library,dataDir:dir,generator:null,annotationGenerator:null});t.after(()=>chat.close());
 async function connect(scopes){
  const grant=await library.createGrant(owner,{bookId:readingBook.bookId,scopes}),identity={bookId:readingBook.bookId,scope:scopes.join(' '),expiresAt:Date.now()+3600000},oauth={authenticate:async()=>{await library.authorize(grant.token,readingBook.bookId,'content');return identity;}};
  const server=createMcpReadingServer({oauth,identity,token:grant.token,library,annotations:chat.annotations}),client=new Client({name:'memory-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();t.after(async()=>{await client.close();await server.close();});await server.connect(b);await client.connect(a);return {client,grant};
 }
 const read=await connect(['content']);assert.equal((await read.client.listTools()).tools.length,5);
 const writable=await connect(['content','annotations','highlight:write','annotation:write']),client=writable.client;
 assert.equal((await client.listTools()).tools.length,8);
 const input={bookId:readingBook.bookId,id:'memory-highlight',quote:agentQuote()},put=await client.callTool({name:'reader_add_highlight',arguments:input});assert.ok(!put.isError,put.content[0].text);
 const args={bookId:readingBook.bookId,threadId:'memory-thread',messageId:'memory-ai',quote:agentQuote(),highlightId:put.structuredContent.highlightId,body:'This is an AI evaluation.'};
 const saved=await client.callTool({name:'reader_add_annotation',arguments:args});assert.ok(!saved.isError,saved.content[0].text);
 assert.deepEqual((await client.callTool({name:'reader_add_annotation',arguments:args})).structuredContent,saved.structuredContent);
 const page=await client.callTool({name:'reader_get_annotations',arguments:{bookId:readingBook.bookId}});assert.equal(page.structuredContent.items[0].attribution.source,'external-agent');
 assert.equal((await library.records(owner,readingBook.bookId)).comments.length,0);
 const bad=await client.callTool({name:'reader_add_highlight',arguments:{...input,ownerId:'foreign'}});assert.equal(bad.isError,true);
 const forged=await client.callTool({name:'reader_add_highlight',arguments:{...input,id:'fake-quote',quote:{...agentQuote(),parts:[{...agentQuote().parts[0],text:'fake'}]}}});assert.equal(forged.isError,true);
 await library.revokeGrant(owner,writable.grant.id);assert.equal((await client.callTool({name:'reader_add_annotation',arguments:{...args,messageId:'revoked'}})).isError,true);
 const web=await chat.annotations.view(owner,readingBook.bookId);assert.equal(web.archive.threads[0].messages[0].body,args.body);assert.equal(web.archive.threads[0].highlightId,put.structuredContent.highlightId);
});
