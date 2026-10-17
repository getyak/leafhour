import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingDraftStore} from '../app/reading-draft-store.mjs';
import {readingBook} from './reading-fixtures.mjs';
import {createNoteDrafts} from '../app/note-drafts.mjs';

test('explicit conflict refresh may retire a frozen edit request while preserving newer words and durable drafts',()=>{
  const drafts=createNoteDrafts();drafts.edit('comment:p1','First edit.');drafts.begin('comment:p1',{passageId:'p1',editId:'e1',baseRevision:0},()=> 'note');
  assert.throws(()=>drafts.discardPending('comment:p1'),/保存/);drafts.edit('comment:p1','Newer local words.');drafts.finish('comment:p1');
  drafts.discardPending('comment:p1');assert.equal(drafts.pending('comment:p1'),null);assert.equal(drafts.text('comment:p1'),'Newer local words.');
  const data=new Map(),storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  let n=0;const open=()=>createReadingDraftStore({storage,scope:'edit-owner-book-note',book:readingBook,newId:()=> 'draft-'+(++n)});
  const first=open();first.edit('comment:p1','Retained words.');const submitted=first.begin('comment:p1',{passageId:'p1',contentVersion:readingBook.contentVersion,baseRevision:0,editId:'frozen'},()=> 'note');first.persist();first.finish('comment:p1');
  const second=open();assert.deepEqual(second.pending('comment:p1'),submitted);second.discardPending('comment:p1');second.persist();
  assert.equal(open().pending('comment:p1'),null);assert.equal(open().text('comment:p1'),'Retained words.');
});
import {createLibraryService} from '../server/library-service.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const key='comment:p1',quote={passageId:'p1',quote:'Original quote.',quoteLanguage:'en',quoteOrigin:'original'};
test('acknowledging a submitted note preserves text typed while it was saving',()=>{
  const drafts=createNoteDrafts();drafts.edit(key,'First thought');const submitted=drafts.begin(key,quote,()=> 'id-1');drafts.edit(key,'Next thought');
  drafts.acknowledge(key,submitted);assert.equal(drafts.text(key),'Next thought');assert.equal(drafts.pending(key),null);
});
test('an acknowledged unchanged draft clears without affecting another paragraph',()=>{
  const drafts=createNoteDrafts();drafts.edit(key,'Thought');drafts.edit('question:p2','Another paragraph');const submitted=drafts.begin(key,quote,()=> 'id-1');
  assert.equal(drafts.acknowledge(key,submitted),true);assert.equal(drafts.text(key),'');assert.equal(drafts.text('question:p2'),'Another paragraph');
});
test('a retry after reload sends exactly the original submission and preserves the new draft',()=>{
  const drafts=createNoteDrafts();drafts.edit(key,'First thought');const submitted=drafts.begin(key,quote,()=> 'id-1');drafts.finish(key);drafts.edit(key,'Next thought');
  const restored=createNoteDrafts(JSON.parse(JSON.stringify(drafts.snapshot())));const retry=restored.begin(key,{...quote,quote:'Changed selection.'},()=> 'id-2');assert.deepEqual(retry,submitted);
  restored.acknowledge(key,retry);restored.finish(key);assert.equal(restored.text(key),'Next thought');const next=restored.begin(key,quote,()=> 'id-2');assert.equal(next.id,'id-2');assert.equal(next.text,'Next thought');
});
test('reopening a composer cannot start another request while the first is still saving',()=>{
  const drafts=createNoteDrafts();drafts.edit(key,'Thought');const submitted=drafts.begin(key,quote,()=> 'id-1');assert.equal(drafts.busy(key),true);assert.throws(()=>drafts.begin(key,quote,()=> 'id-2'));
  drafts.finish(key);assert.equal(drafts.busy(key),false);assert.deepEqual(drafts.begin(key,quote,()=> 'id-2'),submitted);
});
test('a saved record reconciles a lost confirmation without duplicating or discarding new text',()=>{
  const drafts=createNoteDrafts();drafts.edit(key,'First');const submitted=drafts.begin(key,quote,()=> 'id-1');drafts.edit(key,'Next');
  const restored=createNoteDrafts(drafts.snapshot());assert.equal(restored.reconcile(key,[{...submitted,text:'different'}]),false);assert.equal(restored.reconcile(key,[submitted]),true);assert.equal(restored.text(key),'Next');assert.equal(restored.pending(key),null);
});
test('old plain text drafts migrate while malformed cached pending submissions are ignored',()=>{
  const drafts=createNoteDrafts(null,{[key]:'Old draft'});assert.equal(drafts.text(key),'Old draft');const restored=createNoteDrafts({version:1,entries:{[key]:{text:'Current',pending:{id:1,text:'bad'}}}});assert.equal(restored.text(key),'Current');assert.equal(restored.pending(key),null);
});
test('an oversized paragraph quote cannot drop the retry identity after a committed response is lost',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-long-quote-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir}),user={id:'quote-fixture'},original='word '.repeat(900),book=await library.importDocument(user,{filename:'long-quote.txt',bytes:Buffer.from(original)}),p=book.sections[0].paragraphs[0],draftId='comment:'+p.id;
  const drafts=createNoteDrafts();drafts.edit(draftId,'My thought');const submitted=drafts.begin(draftId,{passageId:p.id,quote:original,quoteLanguage:'en',quoteOrigin:'original'},()=> 'stable-note');await library.addComment(user,book.bookId,submitted);
  const oldCache=drafts.snapshot();oldCache.entries[draftId].pending.quote=original;
  const restored=createNoteDrafts(JSON.parse(JSON.stringify(oldCache))),retry=restored.begin(draftId,{passageId:p.id},()=> 'duplicate-note');assert.equal(retry.id,submitted.id);assert.equal(Object.hasOwn(retry,'quote'),false);await library.addComment(user,book.bookId,retry);assert.equal((await library.records(user,book.bookId)).comments.length,1);
});
