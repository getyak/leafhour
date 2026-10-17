import test from 'node:test';import assert from 'node:assert/strict';
import {safeReaderReturn,readerLoginUrl,resolveReaderEntry} from '../app/reader-return.mjs';
import {recoveredPositionNeedsChoice} from '../app/reading-progress.mjs';
test('sign in links retain only a book, stable passage and note intent',()=>{
  const target='/read?book=gutenberg-alice&passage=p1&note=comment';assert.equal(safeReaderReturn(target+'&untrusted=ignored'),target);
  const login=new URL(readerLoginUrl({bookId:'gutenberg-alice',passageId:'p1',note:'comment'}),'http://local');assert.equal(login.pathname,'/library');assert.equal(login.searchParams.get('login'),'1');assert.equal(login.searchParams.get('next'),target);
});
test('external and invalid return locations cannot become a redirect',()=>{
  for(const target of ['https://evil.example/read?book=alice','//evil.example/read?book=alice','javascript:alert(1)','/library','/read?book=../../secret','/read?book=alice%2Fsecret','/read?book='])assert.equal(safeReaderReturn(target),null);
});
test('reader entry resolves the requested paragraph within the same book',()=>{
  const book={bookId:'gutenberg-alice',sections:[{chapterId:'ch2',paragraphs:[{id:'p1'}]}]};assert.deepEqual(resolveReaderEntry(book,new URLSearchParams('book=gutenberg-alice&passage=p1&note=question')),{chapterId:'ch2',passageId:'p1',offset:160,note:'question'});
  assert.equal(resolveReaderEntry(book,new URLSearchParams('book=another&passage=p1')),null);assert.equal(resolveReaderEntry(book,new URLSearchParams('book=gutenberg-alice&passage=missing')),null);
});
test('recovered records require a position choice before replacing a newer remote position',()=>{
  assert.equal(recoveredPositionNeedsChoice(0,{revision:4}),true);assert.equal(recoveredPositionNeedsChoice(4,{revision:4}),false);assert.equal(recoveredPositionNeedsChoice(4,null),false);
});
test('translation sign-in returns to the same paragraph without an automatic model action',()=>{
  const target='/read?book=alice&passage=p2&action=translate',login=new URL(readerLoginUrl({bookId:'alice',passageId:'p2',action:'translate'}),'http://local');assert.equal(login.searchParams.get('next'),target);assert.equal(safeReaderReturn(target+'&run=automatic'),target);
  const book={bookId:'alice',sections:[{chapterId:'ch1',paragraphs:[{id:'p2'}]}]};assert.deepEqual(resolveReaderEntry(book,new URLSearchParams('book=alice&passage=p2&action=translate')),{chapterId:'ch1',passageId:'p2',offset:160,note:null,action:'translate'});assert.equal(safeReaderReturn('/read?book=alice&action=translate'),'/read?book=alice');assert.equal(safeReaderReturn(target+'&note=comment'),'/read?book=alice&passage=p2&note=comment');assert.equal(safeReaderReturn('/read?book=alice&passage=p2&action=delete'),'/read?book=alice&passage=p2');
});

test('versioned citation entry fences editions and chooses a text layer without a model action',()=>{
 const book={bookId:'alice',contentVersion:'edition-1',sections:[{chapterId:'ch1',paragraphs:[{id:'p2'}]}]};
 for(const [layer,mode,variant]of [['original','en',undefined],['literal','zh','literal'],['interpretive','zh','interpretive']]){
  const entry=resolveReaderEntry(book,new URLSearchParams({book:'alice',passage:'p2',contentVersion:'edition-1',layer}));assert.equal(entry.contentVersion,'edition-1');assert.equal(entry.layer,layer);assert.equal(entry.mode,mode);assert.equal(entry.variant,variant);assert.equal(entry.action,undefined);
 }
 for(const query of [{contentVersion:'old'},{contentVersion:''},{layer:'private'},{contentVersion:'edition-1',passage:'missing'}])assert.throws(()=>resolveReaderEntry(book,new URLSearchParams({book:'alice',passage:'p2',...query})),/引用/);
 assert.throws(()=>resolveReaderEntry(book,new URLSearchParams('book=alice&passage=p2&contentVersion=edition-1&contentVersion=old')),/引用/);
});
test('citation identity survives login return and malformed identity is never silently downgraded',()=>{
 const target='/read?book=alice&passage=p2&contentVersion=edition-1&layer=interpretive';assert.equal(safeReaderReturn(target+'&scopes=all'),target);
 const login=new URL(readerLoginUrl({bookId:'alice',passageId:'p2',contentVersion:'edition-1',layer:'interpretive'}),'http://local');assert.equal(login.searchParams.get('next'),target);
 for(const bad of [target+'&layer=original','/read?book=alice&passage=p2&layer=secret','/read?book=alice&passage=p2&contentVersion='])assert.equal(safeReaderReturn(bad),null);
});
