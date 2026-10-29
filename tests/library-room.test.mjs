import test from 'node:test';
import assert from 'node:assert/strict';
import * as workspace from '../app/library-workspace.mjs';

const books=[{bookId:'alice',title:{zh:'爱丽丝'},author:'Carroll',visibility:'public',resume:{passageId:'a2',updatedAt:'2026-10-15'}},{bookId:'walden',title:{zh:'瓦尔登湖'},visibility:'public'},{bookId:'mine',title:{zh:'自己的书'},visibility:'private'}];
test('a returning reader sees the active book once, while filtering searches every book',()=>{
  assert.equal(typeof workspace.roomShelf,'function');
  const room=workspace.roomShelf(books);
  assert.equal(room.featured.bookId,'alice');assert.equal(room.total,3);assert.deepEqual(room.books.map(b=>b.bookId),['mine','walden']);
  const search=workspace.roomShelf(books,{query:'Carroll'});assert.equal(search.featured,null);assert.deepEqual(search.books.map(b=>b.bookId),['alice']);
  assert.equal(workspace.roomShelf(books,{scope:'private'}).featured,null);
  assert.equal(books.length,3);
});
test('an explicit current book can be changed without losing books or inventing reading history',()=>{
  assert.equal(typeof workspace.roomShelf,'function');
  const room=workspace.roomShelf(books,{selectedBookId:'walden'});assert.equal(room.featured.bookId,'walden');assert.equal(room.total,3);assert.equal(room.books.length,2);
  const fresh=workspace.roomShelf(books.map(({resume,...book})=>book));assert.equal(fresh.featured,null);assert.equal(fresh.books.length,3);
});
const book={bookId:'b',contentVersion:'v1',chapters:[{id:'front',kind:'front_matter',title:{zh:'目录'}},{id:'ch1',kind:'chapter',title:{zh:'第一章'}}],sections:[{chapterId:'front',paragraphs:[{id:'p0',original:'CONTENTS'}]},{chapterId:'ch1',paragraphs:[{id:'p1',original:'A stable original.',translations:{interpretive:{text:'现有的意译。',status:'draft'}}},{id:'p2',original:'No translation exists.'}]}]};
test('the room preview uses the stable requested paragraph and never fills in missing translations',()=>{
  assert.equal(typeof workspace.roomExcerpt,'function');
  const preview=workspace.roomExcerpt(book,'p2');assert.equal(preview.passageId,'p2');assert.equal(preview.original,'No translation exists.');assert.equal(preview.interpretive,null);assert.equal(preview.translationStatus.interpretive,'missing');
  const first=workspace.roomExcerpt(book);assert.equal(first.passageId,'p1');assert.equal(first.interpretive,'现有的意译。');assert.equal(first.translationStatus.interpretive,'draft');
  assert.throws(()=>workspace.roomExcerpt(book,'absent'),/段落/);
});
test('long preview text remains a bounded exact prefix without splitting Unicode characters',()=>{
  assert.equal(typeof workspace.roomExcerpt,'function');
  const original='😀'.repeat(6001),long={...book,sections:[{chapterId:'ch1',paragraphs:[{id:'long',original}]}]};
  const preview=workspace.roomExcerpt(long,'long');assert.ok(preview.original.length<=6000);assert.ok(preview.original.isWellFormed());assert.ok(original.startsWith(preview.original));assert.equal(preview.truncated,true);
});
test('pending personalization never classifies a book as unread or empties a saved status filter',()=>{
 const pending={...books[2],personalizationPending:true};assert.equal(workspace.shelfReadingStatus(pending),'pending');assert.equal(workspace.libraryShelf([pending],{status:'reading',form:'bilingual',language:'ja'}).length,1);
});

test('the bookmark resumes the most recent valid unfinished passage regardless of shelf order',()=>{
  assert.equal(typeof workspace.currentReadingBookmark,'function');
  const recent={...books[0],bookId:'recent',resume:{passageId:'a9',label:'Chapter Nine',updatedAt:'2026-10-29'}};
  const finished={...recent,bookId:'finished',journey:{status:'finished',lastReadAt:'2026-10-30'}};
  const pending={...recent,bookId:'pending',personalizationPending:true};
  assert.equal(workspace.currentReadingBookmark([books[0],finished,pending,recent]),recent);
  assert.equal(workspace.currentReadingBookmark([{...recent,resume:null,journey:{lastReadAt:'2026-10-30'}},finished,pending]),null);
});
