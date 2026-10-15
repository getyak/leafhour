import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryShelf,readingBookUrl,readingWeek,latestReadingEntry,workspaceCurrentBook,loadWorkspaceActivity} from '../app/library-workspace.mjs';

test('finished books remain available to reopen after refreshing, including books without a saved position',()=>{
  const finished={bookId:'finished',journey:{status:'finished'}};
  assert.equal(workspaceCurrentBook([finished]),finished);
  assert.equal(workspaceCurrentBook([{bookId:'unread'}]),null);
  const current={bookId:'current',resume:{passageId:'p2'}};
  assert.equal(workspaceCurrentBook([finished,current]),current);
});

test('a cross-month overview fetches the real adjacent days and keeps the monthly calendar separate',async()=>{
  const seen=[],october={days:[{date:'2026-10-31',notes:1}]},november={days:[{date:'2026-11-01',notes:2}]};
  const api=async url=>{const month=new URL(url,'http://localhost').searchParams.get('month');seen.push(month);return month==='2026-10'?october:november;};
  const result=await loadWorkspaceActivity(api,{month:'2026-11',date:'2026-11-01',timeZone:'Asia/Singapore'});
  assert.deepEqual(seen,['2026-11','2026-10']);assert.equal(result.calendar,november);
  assert.deepEqual(result.overview.days,[...november.days,...october.days]);
  seen.length=0;const history=await loadWorkspaceActivity(api,{month:'2026-10',date:'2026-11-01',timeZone:'UTC'});
  assert.deepEqual(seen,['2026-10']);assert.equal(history.overview,null);
});

test('the shelf puts owned books first and searches titles and authors without changing the catalog',()=>{
  const books=[{bookId:'sample',visibility:'public',title:{zh:'样书',en:'Sample'},author:'A'},{bookId:'mine-old',visibility:'private',title:{zh:'我的旧书'},author:'B',resume:{updatedAt:'2026-10-12'}},{bookId:'mine-new',visibility:'private',title:{zh:'我的新书'},author:'中文作者',journey:{lastReadAt:'2026-10-15'}}];
  assert.deepEqual(libraryShelf(books).map(b=>b.bookId),['mine-new','mine-old','sample']);
  assert.deepEqual(libraryShelf(books,{scope:'private',query:'中文作者'}).map(b=>b.bookId),['mine-new']);
  assert.deepEqual(libraryShelf(books,{query:'SAMPLE'}).map(b=>b.bookId),['sample']);
  assert.equal(books[0].bookId,'sample');
});

test('every continue entry retains its paragraph anchor while new entries open the original text',()=>{
  const book={bookId:'a book',chineseSample:{paragraphs:6},resume:{passageId:'p/7'}};
  assert.equal(readingBookUrl(book),'/read?book=a+book&passage=p%2F7');
  assert.equal(readingBookUrl({...book,resume:null}),'/read?book=a+book');
  assert.equal(readingBookUrl({bookId:'private'}),'/read?book=private');
});

test('the compact week crosses month and year boundaries on a real Monday-to-Sunday calendar',()=>{
  assert.deepEqual(readingWeek('2026-01-01'),['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03','2026-01-04']);
  assert.equal(readingWeek('2026-10-18')[0],'2026-10-12');
  assert.throws(()=>readingWeek('2026-02-30'));
});

test('reading near the book surfaces the latest actual entry rather than inventing an empty-today achievement',()=>{
  const entry={bookId:'mine',passageId:'p2',type:'comment',text:'我的原话',createdAt:'2026-10-14T12:00:00Z'};
  const data={days:[{date:'2026-10-14',details:[entry]},{date:'2026-10-15',details:[]}]};
  assert.deepEqual(latestReadingEntry(data),entry);
  assert.equal(latestReadingEntry({days:[]}),null);
  assert.equal(latestReadingEntry(null),null);
});
