import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {libraryShelf,roomShelf} from '../app/library-workspace.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';

const books=[
  {bookId:'unread',visibility:'public',sourceLanguage:'en',topics:['literature'],title:{zh:'未开始的故事'},shelfPosition:0,journey:{status:'reading',lastReadAt:null,completedChapters:0}},
  {bookId:'current',visibility:'private',sourceLanguage:'zh-Hans',topics:['philosophy'],title:{zh:'自己的思考',en:'Thoughts'},author:'林读者',shelfPosition:1,resume:{passageId:'p2'}},
  {bookId:'finished',visibility:'public',sourceLanguage:'en-GB',topics:['philosophy'],title:{zh:'读完的书'},shelfPosition:2,journey:{status:'finished',lastReadAt:'2026-10-16'},resume:{passageId:'p3'}},
  {bookId:'session',visibility:'private',sourceLanguage:'en',title:{zh:'另一段阅读'},shelfPosition:3,journey:{status:'reading',lastReadAt:'2026-10-15'}},
  {bookId:'unknown',visibility:'private',title:{zh:'尚未分类'},shelfPosition:4}
];
const ids=rows=>rows.map(book=>book.bookId);

test('reading filters use real activity rather than the default reading journey or a saved position on a finished book',()=>{
  assert.deepEqual(ids(libraryShelf(books,{status:'reading'})),['current','session']);
  assert.deepEqual(ids(libraryShelf(books,{status:'unread'})),['unread','unknown']);
  assert.deepEqual(ids(libraryShelf(books,{status:'finished'})),['finished']);
});

test('source, topic, original language and search intersect while retaining the whole shelf order',()=>{
  const before=structuredClone(books);
  assert.deepEqual(ids(libraryShelf(books,{scope:'public',topic:'philosophy',language:'en'})),['finished']);
  assert.deepEqual(ids(libraryShelf(books,{scope:'private',status:'reading',topic:'philosophy',language:'zh',query:'thoughts'})),['current']);
  assert.deepEqual(ids(libraryShelf(books,{topic:'science'})),[]);
  assert.deepEqual(ids(libraryShelf(books,{language:'unknown'})),['unknown']);
  assert.deepEqual(books,before);
});

test('a Chinese trial does not turn an English original into a Chinese-language book',()=>{
  const trial={...books[0],chineseSample:{paragraphs:6}};
  assert.deepEqual(libraryShelf([trial],{language:'zh'}),[]);
  assert.deepEqual(ids(libraryShelf([trial],{language:'en'})),['unread']);
});

test('filtering collapses the featured card and includes the current book once; clearing restores it',()=>{
  for(const filter of [{status:'reading'},{scope:'private'},{topic:'philosophy'},{language:'zh'},{query:'思考'}]){
    const room=roomShelf(books,{...filter,selectedBookId:'current'});
    assert.equal(room.featured,null);
    assert.equal(ids(room.books).filter(id=>id==='current').length,1);
    assert.equal(room.books.length,room.total);
  }
  const reset=roomShelf(books,{selectedBookId:'current'});
  assert.equal(reset.featured.bookId,'current');
  assert.equal(reset.total,5);
  assert.deepEqual(ids(reset.books),['unread','finished','session','unknown']);
});

test('book listings expose original language and curated subjects, including older private index entries, without rewriting them',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-filter-metadata-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir}),user={id:'isolated-filter-reader'};
  const publicRows=await library.list(null),alice=publicRows.find(book=>book.bookId==='gutenberg-alice');
  assert.equal(alice.sourceLanguage,'en');
  assert.ok(alice.topics.includes('literature'));
  const chinese=await library.importDocument(user,{filename:'中文.txt',bytes:Buffer.from('这是一本中文原文。\n\n阅读可以从这里开始。')});
  const indexFile=path.join(dir,'users',digest(user.id),'index.json');
  const index=JSON.parse(await readFile(indexFile,'utf8'));
  delete index.books[0].sourceLanguage;
  await writeFile(indexFile,JSON.stringify(index));
  const before=await readFile(indexFile,'utf8');
  const row=(await library.list(user)).find(book=>book.bookId===chinese.bookId);
  assert.equal(row.sourceLanguage,'zh');
  assert.deepEqual(row.topics,[]);
  assert.equal(await readFile(indexFile,'utf8'),before);
});
