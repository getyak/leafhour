import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryShelf,roomShelf} from '../app/library-workspace.mjs';
import * as cover from '../app/book-binding.mjs';
const walden={bookId:'gutenberg-walden',visibility:'public',title:{zh:'瓦尔登湖',en:'Walden'},author:'Henry David Thoreau',sourceLanguage:'en'};
test('shelf search accepts display aliases without changing original book objects or filters',()=>{
 const other={...walden,bookId:'private',visibility:'private',title:{zh:'私人原文',en:'Private source'}},books=[walden,other],before=JSON.stringify(books);
 const searchText=book=>book===walden?'森の生活 ヘンリー・デイヴィッド・ソロー':'';
 assert.deepEqual(libraryShelf(books,{query:'森の生活'},{searchText}),[walden]);
 assert.equal(libraryShelf(books,{query:'ヘンリー'},{searchText})[0],walden);
 assert.deepEqual(libraryShelf(books,{query:'森の生活',scope:'private'},{searchText}),[]);
 assert.deepEqual(roomShelf(books,{query:'森の生活'},{searchText}).books,[walden]);
 assert.equal(libraryShelf(books,{query:'Private source'},{searchText})[0],other);
 assert.equal(JSON.stringify(books),before);
});
test('public display aliases include every locale and full volume identity without leaking into private/unknown metadata',()=>{
 assert.equal(typeof cover.bookCoverSearchText,'function');
 const aliases=cover.bookCoverSearchText(walden);
 for(const value of ['森の生活','瓦尔登湖','瓦爾登湖','Henry David Thoreau','ヘンリー・デイヴィッド・ソロー'])assert.ok(aliases.includes(value),value);
 assert.equal(cover.bookCoverSearchText({...walden,visibility:'private'}),'');
 assert.equal(cover.bookCoverSearchText({...walden,bookId:'unknown-public'}),'');
 const volumes=[1,2,3].map(n=>({...walden,bookId:'gutenberg-dream-red-chamber-'+n}));
 const visible=cover.bookCoverLabel(volumes[0],'ja').title;
 assert.ok(cover.bookCoverSearchText(volumes[0]).includes(visible));
 assert.deepEqual(libraryShelf(volumes,{query:visible},{searchText:cover.bookCoverSearchText}),[volumes[0]]);
});
