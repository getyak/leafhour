import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {fixture} from './annotation-dom-fixture.mjs';
import {paintBookCover,paintBookIdentity,bookCoverLabel,bookCoverSearchText} from '../app/book-cover-ui.mjs';
import * as workspace from '../app/library-workspace.mjs';
import {mountIncrementalShelf} from '../app/library-incremental.mjs';
import {requestUiRoute,getUiLocale,t,onUiLocaleChange} from '../app/ui-locale.mjs';
import {homeText} from '../app/home-locale.mjs';

const source=await readFile(new URL('../app/portal.js',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='landingBookCard');
const shelfDeclaration=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='bookCard');

function publicShelfFixture(){
  const {document}=fixture('<body></body>'),labels=new Map();
  const make=(tag,className='',text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const apply=(node,spec)=>{const value=spec.render?spec.render():t(spec.id,spec.params);if(spec.attr)node.setAttribute(spec.attr,value);else node.textContent=value;};
  const context={make,paintBookCover,paintBookIdentity,bookCoverLabel,getUiLocale,t,readingBookUrl:book=>'/read?book='+book.bookId,ownedHref:(node,href)=>{node.href=href;},bookActions:null,shelfDrag:null,roomIcons(){},scheduleCardPrune(){},registerCardNode(node,spec){labels.set(node,spec);apply(node,spec);}};
  vm.createContext(context);for(const name of ['cardLabel','mountCardLabels','bookCard']){const declaration=ast.body.find(node=>node.id?.name===name||node.declarations?.some(row=>row.id.name===name));vm.runInContext(source.slice(declaration.start,declaration.end),context);}vm.runInContext('this.makeCard=bookCard;',context);
  const off=onUiLocaleChange(()=>{for(const [node,spec]of labels)if(node.isConnected)apply(node,spec);});
  return {document,context,makeCard:book=>{const card=context.makeCard(book);document.body.append(card);return card;},dispose(){off();document.body.replaceChildren();}};
}

test('actual home and library queries find the displayed Japanese cover and preserve source metadata',async()=>{
 await requestUiRoute('ja');const f=publicShelfFixture(),{document,context}=f;
 const ids=['book-search','search-clear','featured-books','library-books','reading-dashboard','shelf-title','library-shelf','room-title','room-count','sidebar-book-count','empty-shelf','empty-upload','empty-clear','shelf-more'];
 for(const id of ids){const node=document.createElement('div');node.id=id;document.body.append(node);}
 const $=id=>document.getElementById(id);for(const tag of ['h2','p'])$('empty-shelf').append(document.createElement(tag));
 const books=[{bookId:'gutenberg-walden',visibility:'public',title:{en:'Walden',zh:'瓦尔登湖'},author:'Henry David Thoreau',sourceLanguage:'en',source:{format:'txt'}},{bookId:'gutenberg-alice',visibility:'public',title:{en:'Alice'},author:'Lewis Carroll',sourceLanguage:'en',source:{format:'txt'}}],before=JSON.stringify(books);
 let query='森の生活';Object.assign(context,workspace,{document,$,books,bookCoverSearchText,bootstrapped:true,personalizationPending:false,session:{user:{id:'synthetic'}},homeText,Intl,getOwner:()=> 'synthetic',dashboard:null,chat:null,shelfControls:{read:()=>({query}),update(){},setPending(){},clearAll(){query='';}}});
 for(const name of ['chromeLabels','specText','num','applySpec','own','landingBookCard','shelfEmptyHelpId','renderHomeBooks','renderBooks']){const n=ast.body.find(n=>n.id?.name===name||n.declarations?.some(row=>row.id.name===name));vm.runInContext(source.slice(n.start,n.end),context);}
 context.shelfList=mountIncrementalShelf({grid:$('library-books'),controls:$('shelf-more'),renderItem:context.makeCard});
 try{
  for(const isLibrary of [false,true]){
   context.isLibrary=isLibrary;context.renderBooks();const grid=$(isLibrary?'library-books':'featured-books');
   assert.equal(grid.querySelectorAll('.book-card').length,1,(isLibrary?'library':'home')+' query must find the Japanese title');
   assert.equal(grid.querySelector('.cover-title').textContent,'森の生活');assert.equal(grid.querySelector('.book-author').textContent,'ヘンリー・デイヴィッド・ソロー');
  }
  query='ヘンリー・デイヴィッド・ソロー';context.renderBooks();assert.equal($('library-books').querySelectorAll('.book-card').length,1,'the visible Japanese author is searchable');
  assert.equal(JSON.stringify(books),before);
 }finally{context.shelfList.destroy();f.dispose();await requestUiRoute('en');}
});

test('real shelf titles and accessible action names distinguish public volumes in every committed language',async()=>{
  await requestUiRoute('en');const f=publicShelfFixture(),books=[1,2].map(volume=>({bookId:'gutenberg-dream-red-chamber-'+volume,visibility:'public',title:{zh:'原始书名 '+volume},author:'Source author',source:{format:'txt'}})),original=JSON.stringify(books),cards=books.map(f.makeCard);
  const expected={en:['Dream of the Red Chamber · Volume 1 · Chapters 1–40 · Chinese text','Dream of the Red Chamber · Volume 2 · Chapters 41–80 · Chinese text'],'zh-Hans':['红楼梦 · 第 1 册 · 第 1—40 回 · 中文原典','红楼梦 · 第 2 册 · 第 41—80 回 · 中文原典'],'zh-Hant':['紅樓夢 · 第 1 冊 · 第 1—40 回 · 中文原典','紅樓夢 · 第 2 冊 · 第 41—80 回 · 中文原典'],ja:['紅楼夢 · 第 1 冊 · 第 1–40 回 · 中国語本文','紅楼夢 · 第 2 冊 · 第 41–80 回 · 中国語本文']};
  try{for(const locale of ['en','ja','zh-Hans','zh-Hant']){await requestUiRoute(locale);cards.forEach((card,index)=>{const title=card.querySelector('.book-title-link');assert.equal(title.textContent,expected[locale][index]);assert.equal(card.querySelector('.book-art').getAttribute('aria-label'),t('portal.card.readAria',{title:title.textContent}));assert.equal(card.querySelector('.book-drag-handle').getAttribute('aria-label'),t('portal.drag.aria',{title:title.textContent}));});}assert.equal(JSON.stringify(books),original);}finally{f.dispose();await requestUiRoute('en');}
});

test('real Chinese-original shelf cards carry a neutral public-edition badge in all four languages',async()=>{
  await requestUiRoute('en');const f=publicShelfFixture(),card=f.makeCard({bookId:'gutenberg-analects-zh',visibility:'public',sourceLanguage:'zh',title:{zh:'论语'},author:'孔子及其弟子',source:{format:'txt'}}),expected={en:'Public-domain edition','zh-Hans':'公版书','zh-Hant':'公版書',ja:'パブリックドメイン'};
  try{for(const locale of ['en','ja','zh-Hans','zh-Hant']){await requestUiRoute(locale);assert.equal(card.querySelector('.book-label').textContent,expected[locale]);}}finally{f.dispose();await requestUiRoute('en');}
});

test('real private shelf cards keep an authorless upload filename through every language commit',async()=>{
  await requestUiRoute('en');const {document}=fixture('<body></body>');
  const make=(tag,className='',text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const context={make,paintBookCover,paintBookIdentity,bookCoverLabel,getUiLocale,t,readingBookUrl:()=>'/read?book=private-upload',ownedHref:(node,href)=>{node.href=href;},bookActions:null,shelfDrag:null,mountCardLabels(){},roomIcons(){},cardLabel(node,id,params,attribute){if(attribute)node.setAttribute(attribute,t(id,params));else node.textContent=t(id,params);return node;}};
  vm.createContext(context);vm.runInContext(source.slice(shelfDeclaration.start,shelfDeclaration.end)+'\nthis.makeCard=bookCard;',context);
  const book={bookId:'private-upload',visibility:'private',title:{zh:'原始书名'},author:'',source:{format:'txt',filename:'original-file.txt'}},original=JSON.stringify(book),card=context.makeCard(book);document.body.append(card);
  const author=card.querySelector('.book-author');
  try{
    assert.equal(author.textContent,'original-file.txt');
    for(const locale of ['ja','zh-Hans','zh-Hant','en']){await requestUiRoute(locale);assert.equal(author.textContent,'original-file.txt',locale+' must keep the native filename fallback');assert.equal(card.querySelector('.book-author'),author);}
    assert.equal(JSON.stringify(book),original,'a displayed filename never becomes the stored author');
  }finally{card.remove();await requestUiRoute('en');}
});

test('real home-card factory shares illustrated covers and updates their existing nodes on language commits',async()=>{
  await requestUiRoute('en');const {document}=fixture('<body></body>');
  const make=(tag,className='',text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const labels=new Map(),off=onUiLocaleChange(()=>{for(const [node,spec]of labels)if(spec.render){if(spec.attr)node.setAttribute(spec.attr,spec.render());else node.textContent=spec.render();}});
  const context={make,paintBookCover,bookCoverLabel,registerCardNode:(node,spec)=>labels.set(node,spec),getUiLocale,t,homeText,session:{user:{id:'synthetic'}},readingBookUrl:()=>'/read?book=gutenberg-walden',positionStorageKey:()=>'',localStorage:{getItem:()=>null}};
  vm.createContext(context);vm.runInContext(source.slice(declaration.start,declaration.end)+'\nthis.makeCard=landingBookCard;',context);
  const book={bookId:'gutenberg-walden',visibility:'public',title:{zh:'来源书名',en:'Source title'},author:'Literal author',source:{format:'txt'}};
  const original=JSON.stringify(book),card=context.makeCard(book);document.body.append(card);const cover=card.querySelector('.book-cover'),title=cover.querySelector('.cover-title'),image=cover.querySelector('img');
  try{
    assert.ok(image,'homepage must use the shared original artwork');assert.equal(title.textContent,'Walden');assert.equal(card.querySelector('h3').textContent,'Walden');
    await requestUiRoute('ja');assert.equal(title.textContent,'森の生活');assert.equal(cover.querySelector('img'),image);assert.equal(cover.querySelector('.cover-title'),title);assert.equal(card.querySelector('h3').textContent,'森の生活');assert.equal(card.querySelector('.book-author').textContent,'ヘンリー・デイヴィッド・ソロー');
    await requestUiRoute('zh-Hant');assert.equal(title.textContent,'瓦爾登湖');assert.equal(JSON.stringify(book),original);
  }finally{off();card.remove();await requestUiRoute('en');}
});
