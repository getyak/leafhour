import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingDraftStore} from '../app/reading-draft-store.mjs';
import {createReadingMarkStore} from '../app/reading-mark-store.mjs';
import {createReadingMarkActions} from '../app/reading-mark-actions.mjs';
import {retainedLibraryBackup,restoreRetainedDrafts} from '../app/reading-retained-backup.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {readingBook,focusSession} from './reading-fixtures.mjs';
import {normalizeReadingMilestone} from '../app/reading-session-record.mjs';
const memory=()=>{const rows=new Map();return {get length(){return rows.size;},key:i=>[...rows.keys()][i]??null,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,String(v)),removeItem:k=>rows.delete(k)};};
const scope='marginalia-reading-ending-drafts-v1|owner|'+readingBook.bookId;
const make=(storage)=>createReadingDraftStore({storage,scope,book:readingBook});
const p1=readingBook.sections[0].paragraphs[0].id,p2=readingBook.sections[1].paragraphs[0].id,k1='comment:'+p1,k2='question:'+p2;
const edit=(drafts,key,text)=>{drafts.activate(key);drafts.edit(key,text);drafts.persist();};
test('independent tabs retain different passages and two distinct thoughts at the same passage after reload',()=>{
  const storage=memory(),a=make(storage),b=make(storage);a.activate(k1);b.activate(k1);edit(a,k1,'First tab thought');edit(b,k1,'Second tab thought');edit(b,k2,'Question elsewhere');
  assert.deepEqual(make(storage).list().map(r=>r.text).sort(),['First tab thought','Question elsewhere','Second tab thought']);
});
test('recovering an older source draft does not require a new timed session and preserves a concurrently edited branch',()=>{
  const storage=memory(),a=make(storage);edit(a,k1,'Earlier thought');edit(a,k2,'Later question');const recovered=make(storage),old=recovered.list().find(r=>r.key===k1);recovered.activate(k1,old.id);recovered.edit(k1,'Recovered thought');recovered.persist();
  a.edit(k1,'Original tab continued typing');a.persist();assert.deepEqual(make(storage).list().map(r=>r.text).sort(),['Later question','Original tab continued typing','Recovered thought']);
});
test('a lost note confirmation retries its original id while another tab and newer text survive',()=>{
  const storage=memory(),a=make(storage);edit(a,k1,'Submitted');const submitted=a.begin(k1,{passageId:p1,contentVersion:readingBook.contentVersion,quoteOrigin:'original'},()=> 'stable-note');a.persist();a.finish(k1);a.edit(k1,'New draft');a.persist();
  const b=make(storage);b.activate(k1);assert.deepEqual(b.begin(k1,{passageId:p1},()=> 'wrong'),submitted);b.acknowledge(k1,submitted);b.persist();b.finish(k1);
  assert.equal(b.text(k1),'New draft');assert.equal(b.pending(k1),null);assert.equal(make(storage).list().filter(r=>r.text==='New draft').length,1);
});
test('legacy reflection snapshots remain readable and are retired only after a durable copy exists',()=>{
  const storage=memory();storage.setItem(scope,JSON.stringify({version:1,entries:{[k1]:{text:'Old thought',pending:null}}}));const d=make(storage);d.activate(k1);assert.equal(d.text(k1),'Old thought');d.persist();assert.equal(make(storage).list().length,1);assert.ok(storage.getItem(scope));
});
test('concurrent offline chapter intents retain both retry ids and only acknowledge the confirmed mark',async()=>{
  const storage=memory(),markScope='marks',storeA=createReadingMarkStore({storage,scope:markScope,book:readingBook}),storeB=createReadingMarkStore({storage,scope:markScope,book:readingBook});
  const a=createReadingMarkActions({book:readingBook,...storeA,send:async()=>{throw Error('offline');}}),b=createReadingMarkActions({book:readingBook,...storeB,send:async()=>{throw Error('offline');}});
  await assert.rejects(a.submit('chapter_read','ch01'));await assert.rejects(b.submit('chapter_read','ch02'));const rows=createReadingMarkStore({storage,scope:markScope,book:readingBook}).all();assert.equal(rows.length,2);const retry=createReadingMarkActions({book:readingBook,...createReadingMarkStore({storage,scope:markScope,book:readingBook}),send:async row=>row});assert.equal((await retry.submit('chapter_read','ch01')).id,rows.find(r=>r.chapterId==='ch01').id);assert.equal(createReadingMarkStore({storage,scope:markScope,book:readingBook}).all()[0].chapterId,'ch02');
});
const backup=()=>({kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(readingBook),records:{kind:'marginalia-personal-records',schemaVersion:3,bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null}}]});
test('the ordinary library export includes final local snapshots, pending marks and explicitly separate drafts',()=>{
  const storage=memory(),base=backup(),paused=focusSession({status:'paused',sequence:2}),final=focusSession({status:'finished',sequence:3,endedAt:'2026-10-14T12:15:00.000Z',segments:[{startedAt:'2026-10-14T12:00:00.000Z',endedAt:'2026-10-14T12:15:00.000Z'}],durationSeconds:900});base.books[0].records.readingSessions=[paused];storage.setItem('marginalia-reading-outbox-v1|owner|'+readingBook.bookId,JSON.stringify([final]));edit(make(storage),k1,'Not submitted');
  const mark=normalizeReadingMilestone({id:'pending-mark',type:'chapter_read',chapterId:'ch01',createdAt:'2026-10-14T12:15:00.000Z'},readingBook);storage.setItem('marginalia-reading-marks-v1|owner|'+readingBook.bookId,JSON.stringify([mark]));
  const result=retainedLibraryBackup({backup:base,storage,owner:'owner'});assert.deepEqual(result.backup.books[0].records.readingSessions,[final]);assert.equal(result.draftCount,1);assert.deepEqual(result.backup.books[0].records.readingMilestones,[mark]);assert.equal(result.backup.books[0].records.readingSessions[0].durationSeconds,900);assert.equal(result.backup.books[0].records.comments.length,0);assert.equal(result.backup.books[0].localReadingDrafts.entries[0].text,'Not submitted');validateLibraryBackup(result.backup);
  const fresh=memory();restoreRetainedDrafts({backup:result.backup,storage:fresh,owner:'new-owner'});const restored=createReadingDraftStore({storage:fresh,scope:'marginalia-reading-ending-drafts-v1|new-owner|'+readingBook.bookId,book:readingBook});assert.equal(restored.list()[0].text,'Not submitted');assert.equal(make(fresh).list().length,0);
});
test('bad portable draft anchors fail validation before any restore mutation',()=>{const b=backup();b.books[0].localReadingDrafts={version:1,entries:[{id:'bad',key:'comment:missing',text:'Private thought',pending:null,revision:1,updatedAt:new Date().toISOString()}]};assert.throws(()=>validateLibraryBackup(b),/草稿/);});
test('restoring a retired draft creates a reachable copy and repeated restore does not multiply it',()=>{
  const storage=memory(),a=make(storage);edit(a,k1,'Portable original');const original=a.list()[0],b=make(storage);b.activate(k1,original.id);b.edit(k1,'A newer branch');b.persist();
  a.import([original]);a.import([original]);assert.deepEqual(make(storage).list().map(r=>r.text).sort(),['A newer branch','Portable original']);
});
test('a malformed second portable draft cannot partly restore the first book drafts',()=>{
  const storage=memory(),b=backup(),other=structuredClone(b.books[0]);other.book.bookId='another-book';other.records.bookId='another-book';b.books.push(other);
  b.books[0].localReadingDrafts={version:1,entries:[{id:'good',key:k1,text:'Keep me',pending:null,revision:1,updatedAt:new Date().toISOString()}]};
  other.localReadingDrafts={version:1,entries:[{id:'bad',key:'question:missing',text:'Broken source',pending:null,revision:1,updatedAt:new Date().toISOString()}]};
  assert.throws(()=>restoreRetainedDrafts({backup:b,storage,owner:'owner'}),/草稿/);assert.equal(storage.length,0);
});
test('switching between two drafts at the same source cannot apply an older receipt to the newly opened editor',()=>{
  const storage=memory(),a=make(storage),b=make(storage);a.activate(k1);b.activate(k1);edit(a,k1,'First pending thought');edit(b,k1,'Second independent thought');
  const submitted=a.begin(k1,{passageId:p1},()=> 'first-submit'),first=a.activeId(k1);a.persist();const second=a.list().find(r=>r.text==='Second independent thought');a.activate(k1,second.id);a.acknowledge(k1,submitted,first);a.finish(k1,first);a.persist();assert.equal(a.text(k1),'Second independent thought');assert.equal(make(storage).list().length,1);
});
test('an unreadable retained cache is reported before enabling a new reflection editor',()=>{const storage=memory();storage.setItem(scope,'{broken');assert.throws(()=>make(storage));assert.equal(storage.getItem(scope),'{broken');});
test('import beyond the draft capacity fails before replacing or partly appending original words',()=>{
  const storage=memory(),d=make(storage),row={key:k1,text:'Existing',pending:null,revision:1,updatedAt:new Date().toISOString()};d.import(Array.from({length:200},(_,i)=>({...row,id:'original-'+i,text:'Existing '+i})));const before=storage.length;assert.throws(()=>d.import([{...row,id:'extra',text:'Over capacity'}]),/草稿/);assert.equal(storage.length,before);assert.equal(d.list().length,200);
});
test('existing paragraph-panel drafts join the same recoverable gallery and ordinary backup without altering their old cache',()=>{
  const storage=memory(),oldScope='marginalia-focus-drafts-v2|owner|'+readingBook.bookId,old=JSON.stringify({version:1,entries:{[k1]:{text:'Earlier paragraph-panel thought',pending:null}}});storage.setItem(oldScope,old);
  assert.equal(make(storage).list()[0].text,'Earlier paragraph-panel thought');const result=retainedLibraryBackup({backup:backup(),storage,owner:'owner'});assert.equal(result.draftCount,1);assert.equal(result.backup.books[0].localReadingDrafts.entries[0].text,'Earlier paragraph-panel thought');assert.equal(storage.getItem(oldScope),old);
});
