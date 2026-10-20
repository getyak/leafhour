import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingAgentTools} from '../server/reading-agent-tools.mjs';
import {createAnnotationReadTools} from '../server/reader-annotation-tools.mjs';
import {createAnnotationArchive,createAnnotationThread,appendAnnotationMessage} from '../app/reader-annotation-records.mjs';

const user={id:'tools-reader'};
const book={bookId:'ann-book',contentVersion:'v1',title:{zh:'样本'},author:'Author',visibility:'private',source:{filename:'secret'},chapters:[{id:'ch1',title:'第一章',startPassageId:'p1'}],sections:[{chapterId:'ch1',paragraphs:[{id:'p1',original:'原文😀 end',translations:{literal:{text:'A literal translation.',status:'draft'},interpretive:{text:'An interpretation.',status:'reviewed'}}},{id:'p2',original:'Second source paragraph',translations:{}}]}]};
const quote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:2,text:'原文'}]});
const aiMessage=(id,body,patch={})=>({id,origin:'ai',body,createdAt:'2026-01-02T00:00:0'+(id.length%10)+'.000Z',provenance:{source:'site-agent',label:'Leafhour reading agent'},sourceRefs:[{passageId:'p1',layer:'original',quote:'原文'}],...patch});
const userMessage=(id,body)=>({id,origin:'user',body,createdAt:'2026-01-03T00:00:00.000Z'});
function archiveFixture(){
  let archive=createAnnotationArchive('ann-book');
  archive=createAnnotationThread(archive,book,{id:'thread-1',quote:quote(),highlightId:'highlight-1'},{now:'2026-01-01T00:00:00.000Z'});
  archive=appendAnnotationMessage(archive,book,'thread-1',aiMessage('msg-ai-1','## 第一条解释\n正文'));
  archive=appendAnnotationMessage(archive,book,'thread-1',userMessage('msg-user-1','我的私人追问 PRIVATE USER SENTINEL'));
  archive=appendAnnotationMessage(archive,book,'thread-1',aiMessage('msg-ai-2','第二条解释'));
  archive=createAnnotationThread(archive,book,{id:'thread-2',quote:quote()},{now:'2026-01-02T00:00:00.000Z'});
  archive=appendAnnotationMessage(archive,book,'thread-2',aiMessage('msg-ai-3','跨线程解释'));
  const tombstoned=createAnnotationThread(archive,book,{id:'thread-3',quote:quote()},{now:'2026-01-03T00:00:00.000Z'});
  return {archive,tombstoned:appendAnnotationMessage(tombstoned,book,'thread-3',aiMessage('msg-ai-4','被删除线程的解释'))};
}
function setup({archive=archiveFixture().archive}={}){
  const library={getBook:async(u,id)=>{assert.equal(u,user);if(id!=='ann-book')throw Object.assign(Error('missing'),{status:404});return structuredClone(book);}};
  const calls=[];
  const tools=createReadingAgentTools({library,user,bookId:'ann-book',passageId:'p1',scope:'book',onActivity:async a=>calls.push(a)});
  const reads=[];
  const wrapped=createAnnotationReadTools({tools,readView:async()=>{reads.push(true);return {bookId:'ann-book',contentVersion:'v1',archive:structuredClone(archive)};}});
  return {tools,wrapped,calls,reads,library};
}
const statusOf=result=>result?.error?.code;

test('the wrapper preserves every source tool verbatim and adds exactly one schema-valid read tool',()=>{
  const {tools,wrapped}=setup();
  assert.deepEqual(wrapped.definitions.slice(0,tools.definitions.length),structuredClone(tools.definitions));
  assert.equal(wrapped.definitions.length,tools.definitions.length+1);
  const definition=wrapped.definitions.at(-1);
  assert.equal(definition.name,'reader_get_annotations');
  assert.equal(definition.parameters.additionalProperties,false);
  assert.equal(definition.parameters.properties.limit.maximum,20);
  assert.equal(wrapped.verify,tools.verify);assert.equal(wrapped.sources,tools.sources);assert.equal(wrapped.recommendations,tools.recommendations);
  assert.throws(()=>createAnnotationReadTools({tools:{...tools,definitions:[...tools.definitions,{name:'reader_get_annotations'}]},readView:async()=>({})}),/already define/);
});

test('actual execute returns bounded AI-only annotation objects with provenance and anchor context labels',async()=>{
  const {wrapped,calls}=setup();
  const page=await wrapped.execute('reader_get_annotations',{});
  assert.equal(page.bookId,'ann-book');assert.equal(page.items.length,1);
  const item=page.items[0];
  assert.equal(item.threadId,'thread-1');assert.equal(item.messageId,'msg-ai-1');assert.equal(item.provenance,'ai');
  assert.equal(item.attribution.source,'site-agent');assert.equal(item.attribution.label,'Leafhour reading agent');
  assert.deepEqual(item.anchor,{passageId:'p1',layer:'original',excerpt:'原文',context:'stored selected-text context, not a source citation'});
  assert.equal(item.body,'## 第一条解释\n正文');
  const serial=JSON.stringify(page);
  assert.ok(!serial.includes('PRIVATE USER SENTINEL'),'user follow-up words leaked through the annotation tool');
  assert.ok(!serial.includes('secret'));
  const source=await wrapped.execute('reader_get_context',{});
  assert.equal(source.passageId,'p1');
  assert.ok(calls.some(a=>a.tool==='reader_get_context'));
  assert.ok(!calls.some(a=>a.tool==='reader_get_annotations'));
});

test('limit defaults to one, paging walks threads in stored order and deleted threads stay unreachable',async()=>{
  const {tombstoned}=archiveFixture();
  const deleted={...tombstoned,threads:tombstoned.threads.map(row=>row.id==='thread-3'?{...row,deletedAt:'2026-01-04T00:00:00.000Z'}:row)};
  const {wrapped}=setup({archive:deleted});
  const first=await wrapped.execute('reader_get_annotations',{limit:3});
  assert.deepEqual(first.items.map(item=>item.messageId),['msg-ai-1','msg-ai-2','msg-ai-3']);
  assert.equal(first.nextCursor,null);
  const single=await wrapped.execute('reader_get_annotations',{});
  assert.equal(single.items.length,1);assert.equal(single.items[0].messageId,'msg-ai-1');
  assert.equal(single.nextCursor.messageId,'msg-ai-2');
});

test('UTF-16 charOffset continuation reconstructs the whole body without losing the tail',async()=>{
  const body='开头😀'.repeat(2000)+'真实结尾';
  const {archive}=archiveFixture();
  const grown=appendAnnotationMessage(archive,book,'thread-2',aiMessage('msg-long',body));
  const {wrapped}=setup({archive:grown});
  const collected=[];let cursor;let page=await wrapped.execute('reader_get_annotations',{threadId:'thread-2',messageId:'msg-long',limit:1});
  collected.push(...page.items.map(item=>item.body));cursor=page.nextCursor;
  while(cursor){page=await wrapped.execute('reader_get_annotations',cursor);collected.push(...page.items.map(item=>item.body));cursor=page.nextCursor;}
  assert.equal(collected.join(''),body);
});

test('surrogate-splitting offsets and unknown cursor identities are rejected, not repaired',async()=>{
  const body='开头😀'.repeat(2000);
  const {archive}=archiveFixture();
  const grown=appendAnnotationMessage(archive,book,'thread-2',aiMessage('msg-long',body));
  const {wrapped}=setup({archive:grown});
  const page=await wrapped.execute('reader_get_annotations',{threadId:'thread-2',messageId:'msg-long',limit:1});
  const boundary=page.nextCursor.charOffset;
  // page.nextCursor lands on a code-unit boundary; ask for one inside a surrogate.
  const middle=body.indexOf('😀')+1;
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{threadId:'thread-2',messageId:'msg-long',charOffset:middle,snapshot:page.snapshot})),'INVALID_ARGUMENTS');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{threadId:'thread-2',messageId:'missing',charOffset:1,snapshot:page.snapshot})),'INVALID_ARGUMENTS');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{charOffset:1})),'INVALID_ARGUMENTS');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{threadId:'thread-2',messageId:'msg-long',charOffset:body.length+1,snapshot:page.snapshot})),'INVALID_ARGUMENTS');
  assert.ok(boundary<=body.length);
});

test('snapshot conflicts fail closed and invalid arguments never reach the archive',async()=>{
  const {wrapped,reads}=setup();
  const page=await wrapped.execute('reader_get_annotations',{});
  assert.equal(page.items.length,1);
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{threadId:'thread-1',messageId:'msg-ai-2',charOffset:1,snapshot:'stale-hash'})),'SNAPSHOT_CHANGED');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{limit:0})),'INVALID_ARGUMENTS');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{limit:21})),'INVALID_ARGUMENTS');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{bookId:'other'})),'INVALID_ARGUMENTS');
  assert.equal(statusOf(await wrapped.execute('reader_get_annotations',{userId:'other'})),'INVALID_ARGUMENTS');
  const before=reads.length;await wrapped.execute('reader_get_annotations',{limit:0});assert.equal(reads.length,before,'invalid arguments should not read the archive');
});

test('long bodies page under the byte target and the hard bound keeps every remainder reachable',async()=>{
  const body='文'.repeat(12000);
  const {archive}=archiveFixture();
  const grown=appendAnnotationMessage(archive,book,'thread-2',aiMessage('msg-huge',body));
  const {wrapped}=setup({archive:grown});
  let page=await wrapped.execute('reader_get_annotations',{threadId:'thread-2',messageId:'msg-huge',limit:20}),pages=1,text='';
  text+=page.items.map(item=>item.body).join('');
  while(page.nextCursor){assert.ok(Buffer.byteLength(JSON.stringify(page))<=18432);page=await wrapped.execute('reader_get_annotations',page.nextCursor);text+=page.items.map(item=>item.body).join('');assert.ok(++pages<50);}
  assert.ok(Buffer.byteLength(JSON.stringify(page))<=18432);
  assert.equal(text,body);
});

test('the annotation tool cannot select another book or owner and verify stays source-only',async()=>{
  const {wrapped,tools}=setup();
  await wrapped.execute('reader_get_context',{});
  await wrapped.execute('reader_cite',{bookId:'ann-book',passageId:'p1',layer:'original',quote:'原文'});
  await wrapped.execute('reader_get_annotations',{});
  await wrapped.verify();
  assert.deepEqual(tools.sources().map(ref=>ref.passageId),['p1']);
  assert.deepEqual(wrapped.sources(),tools.sources());
  assert.deepEqual(wrapped.recommendations(),tools.recommendations());
  const refused=await wrapped.execute('reader_get_annotations',{bookId:'other-book'});
  assert.ok(refused.error);
  // A forged read view cannot widen identity: the wrapper is constructed per owner.
  const forged=createAnnotationReadTools({tools,readView:async()=>{throw Error('cross owner read');}});
  assert.ok((await forged.execute('reader_get_annotations',{})).error);
});
