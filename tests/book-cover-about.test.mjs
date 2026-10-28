import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';
import {mountReaderBookActions} from '../app/reader-book-actions.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
const flush=()=>new Promise(setImmediate);

test('lazy reader About shares the illustrated cover while keeping its required source nodes and edition text',async()=>{
  await requestUiRoute('en');const {document,win}=fixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8'));
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};Object.assign(globalThis,{document,window:win,location:{origin:'https://leafhour.invalid'}});
  const book={bookId:'gutenberg-walden',visibility:'public',contentVersion:'test',title:{zh:'来源书名',en:'Source title'},author:'Source author',source:{scopeNote:'Original edition note'},chapters:[],sections:[]};
  document.getElementById('book-info-cover-title').textContent='来源书名';document.getElementById('book-info-scope').textContent='Original edition note';document.getElementById('book-info-original-title').textContent='Source title';
  const info={isOpen:()=>true,close(){},subscribe({onChange}){onChange(true);return()=>{};}};
  const coverModule=await import('../app/book-cover-ui.mjs');
  const owner=mountReaderBookActions({document,info,getBook:()=>book,bookId:book.bookId,session:{user:null},loadCoverLabels:async()=>coverModule,api:()=>assert.fail('About cover does not request account or model data')});
  try{
    await flush();await flush();const cover=document.getElementById('book-info-artwork'),source=document.getElementById('book-info-cover-title');
    assert.ok(cover?.querySelector('img'),'the actual lazy enhancement paints the original public artwork');assert.equal(source.textContent,'来源书名');assert.equal(document.getElementById('book-info-title').textContent,'Walden');
    const image=cover.querySelector('img');await requestUiRoute('ja');assert.equal(document.getElementById('book-info-title').textContent,'森の生活');assert.equal(document.getElementById('book-info-author').textContent,'ヘンリー・デイヴィッド・ソロー');assert.equal(cover.querySelector('img'),image);assert.equal(document.getElementById('book-info-cover-title'),source);assert.equal(document.getElementById('book-info-scope').textContent,'Original edition note');assert.equal(document.getElementById('book-info-original-title').textContent,'Source title');
    book.visibility='private';owner.render();assert.equal(Boolean(document.getElementById('book-info-artwork')),false,'a private public-looking ID keeps the existing source miniature');assert.equal(source.closest('.book-info-cover').hidden,false);assert.equal(document.getElementById('book-info-title').textContent,'来源书名');
    book.visibility='public';owner.render();owner.dispose();assert.equal(Boolean(document.getElementById('book-info-artwork')),false);await requestUiRoute('zh-Hant');assert.equal(document.getElementById('book-info-title').textContent,'来源书名','disposal returns identity ownership to the source bookplate');
  }finally{owner.dispose();Object.assign(globalThis,previous);await requestUiRoute('en');}
});
