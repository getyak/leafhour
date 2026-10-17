import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {mergeLoadedReadingRecords} from '../app/reading-load.mjs';
import {createReaderServer} from '../server/server.mjs';
import {readingBook} from './reading-fixtures.mjs';

async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'personal-edits-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const user={id:'record-editor-a'},other={id:'record-editor-b'},open=name=>createLibraryService({dataDir:path.join(dir,name),catalogDir:null,translator:null});
  const library=await open('source'),book=await library.importDocument(user,{filename:'synthetic.txt',bytes:Buffer.from('Synthetic first source.\n\nSynthetic second source.')});
  const input={id:'own-note',passageId:book.sections[0].paragraphs[0].id,text:' My words <img src=x onerror=alert(1)>\n  keep spacing. ',quote:'Synthetic first source.',quoteLanguage:'en',quoteOrigin:'original'};
  const created=await library.addComment(user,book.bookId,input);
  const edit=(text='My revised words.',extra={})=>({text,contentVersion:book.contentVersion,baseRevision:0,editId:'edit-one',...extra});
  return {dir,user,other,open,library,book,input,created,edit};
}

test('editing preserves user text, identity, quote and creation time through reopen and clean-instance restore',async t=>{
  const {user,other,open,library,book,input,created,edit}=await fixture(t);
  assert.equal(created.revision,0);assert.equal(created.updatedAt,created.createdAt);
  const text=' Revised <script>not executable</script>\n  exact words. ';
  const changed=await library.editComment(user,book.bookId,created.id,edit(text));
  for(const key of ['id','bookId','contentVersion','passageId','origin','createdAt','quote','quoteLanguage','quoteOrigin'])assert.equal(changed[key],created[key],key);
  assert.equal(changed.text,text);assert.equal(changed.revision,1);assert.equal(changed.lastEditId,'edit-one');assert.ok(Number.isFinite(Date.parse(changed.updatedAt)));
  await assert.rejects(library.addComment(user,book.bookId,{...input,text:'Creation must not overwrite this edit.'}),e=>e.status===409,'creation retry is still immutable');
  assert.deepEqual(await library.addComment(user,book.bookId,{...input,text}),changed,'matching text still confirms the existing record');
  assert.deepEqual((await (await open('source')).records(user,book.bookId)).comments[0],changed);
  const backup=await library.exportLibrary(user),target=await open('target');await target.restoreLibrary(other,backup);
  assert.deepEqual((await target.records(other,book.bookId)).comments[0],changed);
  await target.editComment(other,book.bookId,created.id,edit('Newer local thought.',{baseRevision:1,editId:'edit-two'}));
  await target.restoreLibrary(other,backup);
  assert.equal((await target.records(other,book.bookId)).comments[0].text,'Newer local thought.','restore does not overwrite existing words');
});

test('concurrent edits reject a stale writer, confirm a lost-response retry once, and refuse edit-ID reuse',async t=>{
  const {user,library,book,created,edit}=await fixture(t);
  const attempts=[edit('Writer A.'),edit('Writer B.',{editId:'edit-other'})];
  const result=await Promise.allSettled(attempts.map(input=>library.editComment(user,book.bookId,created.id,input)));
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,409);
  const index=result.findIndex(r=>r.status==='fulfilled'),saved=result[index].value;
  assert.equal(saved.revision,1);
  assert.deepEqual(await library.editComment(user,book.bookId,created.id,attempts[index]),saved);
  await assert.rejects(library.editComment(user,book.bookId,created.id,{...attempts[index],text:'Reused ID with changed text.'}),e=>e.status===409);
  await assert.rejects(library.editComment(user,book.bookId,created.id,edit('Stale.',{editId:'edit-stale'})),e=>e.status===409);
  assert.deepEqual((await library.records(user,book.bookId)).comments[0],saved);
});

test('editing fences owners, books, versions, immutable fields and invalid input without changing stored words',async t=>{
  const {user,other,library,book,created,edit}=await fixture(t);
  const second=await library.importDocument(user,{filename:'second.txt',bytes:Buffer.from('Another private source.')});
  await assert.rejects(library.editComment(null,book.bookId,created.id,edit()),e=>e.status===401);
  await assert.rejects(library.editComment(other,book.bookId,created.id,edit()),e=>e.status===404);
  await assert.rejects(library.editComment(user,second.bookId,created.id,{...edit(),contentVersion:second.contentVersion}),e=>e.status===404);
  for(const extra of [{baseRevision:-1},{baseRevision:1.5},{baseRevision:Number.MAX_SAFE_INTEGER+1},{editId:''},{text:''},{text:'  '},{text:'a'.repeat(2001)},{origin:'ai'},{passageId:'other'},{createdAt:'2020-01-01'},{updatedAt:'2020-01-01'},{quote:'replacement'},{ownerId:other.id}]){
    await assert.rejects(library.editComment(user,book.bookId,created.id,edit('Valid.',extra)),e=>e.status===400,JSON.stringify(extra));
    assert.deepEqual((await library.records(user,book.bookId)).comments[0],created);
  }
  await assert.rejects(library.editComment(user,book.bookId,created.id,edit('Changed source.',{contentVersion:'different'})),e=>e.status===409);
});

test('older records default to revision zero while malformed editing metadata rejects the entire backup',async t=>{
  const {user,other,open,library,book,created,edit}=await fixture(t),backup=await library.exportLibrary(user);
  for(const extra of [{revision:-1},{revision:1.5},{revision:Number.MAX_SAFE_INTEGER+1},{revision:1},{updatedAt:'not-a-time'},{lastEditId:'x',revision:0}]){
    const bad=structuredClone(backup);Object.assign(bad.books[0].records.comments[0],extra);const target=await open('invalid-'+Math.random().toString(36).slice(2));
    await assert.rejects(target.restoreLibrary(other,bad),e=>e.status===400,JSON.stringify(extra));assert.equal((await target.list(other)).length,0);
  }
  const old=structuredClone(backup),note=old.books[0].records.comments[0];delete note.revision;delete note.updatedAt;delete note.lastEditId;
  const target=await open('old');await target.restoreLibrary(other,old);
  const changed=await target.editComment(other,book.bookId,created.id,edit());assert.equal(changed.revision,1);assert.equal(changed.createdAt,note.createdAt);
  const max=structuredClone(backup);Object.assign(max.books[0].records.comments[0],{revision:Number.MAX_SAFE_INTEGER,lastEditId:'last-at-limit'});const full=await open('max');await full.restoreLibrary(other,max);
  await assert.rejects(full.editComment(other,book.bookId,created.id,edit('Overflow.',{baseRevision:Number.MAX_SAFE_INTEGER})),e=>e.status===409);
});

test('editing a saved unresolved question retains its status and attribution',async t=>{
  const {user,library,book,input,edit}=await fixture(t),question=await library.addComment(user,book.bookId,{...input,id:'own-question',text:'Why?'},'questions');
  const changed=await library.editComment(user,book.bookId,question.id,edit('Why is this still unclear?'),'questions');
  assert.equal(changed.status,'open');assert.equal(changed.origin,'user');assert.equal((await library.records(user,book.bookId)).questions[0].text,changed.text);
});

test('preparing translations cannot replace edited user words, quotes, versions or unresolved questions',async t=>{
  const {dir,user,library,book,input,created,edit}=await fixture(t);const changed=await library.editComment(user,book.bookId,created.id,edit('My independent interpretation.'));
  await library.addComment(user,book.bookId,{...input,id:'keep-question',text:'Still unclear.'},'questions');const before=await library.records(user,book.bookId);let calls=0;
  const translating=await createLibraryService({dataDir:path.join(dir,'source'),catalogDir:null,translator:async()=>{calls++;return {literal:'Synthetic new literal.',interpretive:'Synthetic new interpretation.',model:'deterministic-fixture'};}});
  await translating.translate(user,book.bookId,input.passageId);assert.equal(calls,1);assert.deepEqual(await translating.records(user,book.bookId),before);
  const reread=await translating.getBook(user,book.bookId);assert.equal(reread.sections[0].paragraphs[0].translations.literal.text,'Synthetic new literal.');assert.deepEqual((await translating.records(user,book.bookId)).comments[0],changed);
});

test('a delayed records read cannot replace a newer acknowledged edit, and source anchors never guess a new location',async()=>{
  const current={comments:[{id:'n',revision:1,text:'New words.'}],questions:[]},fresh={comments:[{id:'n',revision:0,text:'Old words.'}],questions:[]};
  assert.equal(mergeLoadedReadingRecords(fresh,current).comments[0].text,'New words.');
  assert.equal(mergeLoadedReadingRecords(current,fresh).comments[0].text,'New words.');
  const {personalRecordAnchor}=await import('../app/personal-records.mjs');
  const book={bookId:'b',contentVersion:'v',sections:[{number:2,chapterId:'ch02',paragraphs:[{id:'p2'}]}]},record={bookId:'b',contentVersion:'v',passageId:'p2'};
  assert.deepEqual(personalRecordAnchor(record,book),{passageId:'p2',chapterId:'ch02',section:2});
  for(const extra of [{bookId:'other'},{contentVersion:'old'},{passageId:'missing'},{contentVersion:undefined}])assert.equal(personalRecordAnchor({...record,...extra},book),null);
});

test('legacy local HTTP edits, exports and imports preserve editing metadata and quote attribution',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'legacy-personal-edits-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const bookPath=path.join(dir,'book.json');await writeFile(bookPath,JSON.stringify(readingBook));const servers=[];
  t.after(async()=>{for(const server of servers)await new Promise(resolve=>server.close(resolve));});
  async function open(name){const server=await createReaderServer({bookPath,recordsPath:path.join(dir,name,'records.json'),env:{},translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null});servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
  const first=await open('source'),post=(base,route,body)=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const created=await (await post(first,'/api/comments',{id:'legacy-note',passageId:'p1',text:'Original local words.',quote:'Read this first.',quoteOrigin:'original',quoteLanguage:'en'})).json();assert.equal(created.quoteOrigin,'original');
  const payload={baseRevision:0,editId:'legacy-edit-one',contentVersion:readingBook.contentVersion,text:'Edited local words.'};const response=await post(first,'/api/comments/legacy-note/edit',payload);assert.equal(response.status,200);const edited=await response.json();assert.equal(edited.revision,1);assert.equal(edited.quoteOrigin,'original');
  assert.equal((await post(first,'/api/comments/%ZZ/edit',payload)).status,400);
  const exported=await (await fetch(first+'/api/records/export')).json(),target=await open('target');assert.equal((await post(target,'/api/records/import',exported)).status,200);
  assert.deepEqual((await (await fetch(target+'/api/records')).json()).comments[0],edited);
  for(const asset of ['/personal-records.mjs','/personal-record-editor.mjs'])assert.equal((await fetch(first+asset)).status,200);
});
