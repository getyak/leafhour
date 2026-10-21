import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import english from '../app/ui-catalogs/en.mjs';
import {createOwnerScope} from '../app/owner-scope.mjs';
import {createUploadState} from '../app/upload-state.mjs';
import {homeText} from '../app/home-locale.mjs';
import {uiAuthoredPath} from '../app/ui-locale-codec.mjs';
import {fixture} from './reader-audio-fixture.mjs';
import {portalDocument} from '../server/portal-document.mjs';
import {getUiLocale,t,uiHref,requestUiRoute,onUiLocaleChange} from '../app/ui-locale.mjs';

// Execute the actual browser-owned functions with no network or user data.
// Parsing boundaries avoids a second test implementation of the product logic.
const source=await readFile(new URL('../app/portal.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=name=>{
  const item=ast.body.find(item=>item.id?.name===name||item.declarations?.some(d=>d.id.name===name));
  assert.ok(item,'actual declaration '+name);return source.slice(item.start,item.end);
};
const formatter=(id,params)=>id+(params?JSON.stringify(params):'');

test('actual public and private shelf cards use complete message IDs and preserve their source titles',async()=>{
 const make=(tag,className='',text)=>({tag,className,textContent:text??'',children:[],dataset:{},setAttribute(){},addEventListener(){},append(...children){this.children.push(...children);}});
 const context={make,paintBookCover(){},readingBookUrl:()=>'/read?book=synthetic',ownedHref(){},bookActions:null,shelfDrag:null,mountCardLabels(){},roomIcons(){},cardLabel(node,id,params){assert.ok(Object.hasOwn(english,id),'shelf message exists: '+id);node.textContent=t(id,params);return node;}};
 vm.createContext(context);vm.runInContext(declaration('bookCard')+'\nthis.cardFactory=bookCard;',context);
 try{for(const locale of ['en','zh-Hans','zh-Hant','ja']){
  await requestUiRoute(locale);
  for(const visibility of ['public','private']){
   const book={bookId:'synthetic',title:{zh:'来源 / 阅读'},author:'Literal author',visibility,source:{format:'txt'}};
   const card=context.cardFactory(book),all=node=>[node,...node.children.flatMap(all)],nodes=all(card);
   assert.equal(nodes.find(n=>n.className==='book-title-link').textContent,'来源 / 阅读');
   assert.equal(nodes.find(n=>n.className==='book-label').textContent,t(visibility==='public'?'portal.card.public':'portal.card.private',visibility==='public'?undefined:{format:'TXT'}));
  }
 }}finally{await requestUiRoute('en');}
});

function uploadFixture(bindings={}){
  const nodes=new Map(),el=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',open:false,disabled:false,attributes:new Map(),setAttribute(k,v){this.attributes.set(k,String(v));},getAttribute(k){return this.attributes.get(k);},classList:{toggle(){},remove(){}},replaceChildren(){},removeAttribute(){},close(){this.open=false;}});
    return nodes.get(id);
  };
  const ownerScope=createOwnerScope();ownerScope.adopt('synthetic-a');
  const upload=createUploadState();upload.select({name:'synthetic.pdf',size:1});upload.begin();
  const context={document:{querySelectorAll:()=>[]},$:el,t:formatter,getUiLocale,ownerScope,upload,createUploadState,homeMenu:null,invalidatePaletteLibraries(){},viewHistory:null,bookActions:null,shelfDrag:null,shelfRevision:0,orderOperation:null,authDialog:{reset(){}},pendingUpload:false,pendingChat:false,selectedCurrent:null,pdfOnboarding:null,followedPdfId:null,shelfControls:null,books:[],chat:null,shell:null,setupInvite:null,dashboard:null,renderBooks(){},landingBookCard(){assert.fail('no books expected');},...bindings};
  vm.createContext(context);
  vm.runInContext(['chromeLabels','specText','applySpec','own','uploadProgressMessage','paintStatus','status','showUploadProgress','updateUploadProgressLabel','clearPrivateUI'].map(declaration).join('\n')+'\nthis.progress=showUploadProgress;this.relabel=updateUploadProgressLabel;this.replace=status;this.clear=clearPrivateUI;',context);
  return {context,ownerScope,upload,el,ticket:ownerScope.capture()};
}

test('upload progress relabels only its current operation and never revives a replaced status',()=>{
  for(const replacement of ['', 'completed', 'different error']){
    const f=uploadFixture();f.context.progress({id:'pdf.upload.saved',params:{percent:73}},f.ticket,f.upload);
    assert.match(f.el('upload-status').textContent,/73/);f.context.relabel();assert.match(f.el('upload-status').textContent,/73/);
    f.context.replace('upload-status',replacement,true);f.context.relabel();assert.equal(f.el('upload-status').textContent,replacement);
  }
});

test('owner reset, owner ABA and a finished upload fence cached and late progress',()=>{
  for(const transition of ['clear','ABA','finished','new-operation']){
    const f=uploadFixture();f.context.progress({id:'pdf.upload.saved',params:{percent:73}},f.ticket,f.upload);
    if(transition==='clear')f.context.clear();
    if(transition==='ABA'){f.ownerScope.adopt('synthetic-b');f.ownerScope.adopt('synthetic-a');}
    if(transition==='finished')f.upload.finish();
    if(transition==='new-operation')f.context.upload=createUploadState();
    const before=f.el('upload-status').textContent;f.context.relabel();assert.equal(f.el('upload-status').textContent,before);
    f.context.progress({id:'pdf.upload.saved',params:{percent:99}},f.ticket,f.upload);assert.equal(f.el('upload-status').textContent,before);
    if(transition==='clear')assert.equal(before,'');
  }
});

test('owner reset drops account translation availability even for shared public books',()=>{
  const f=uploadFixture({books:[{bookId:'public',visibility:'public',sourceLanguage:'en',translationLanguages:['zh'],supportsParallel:true,translatedParagraphs:2,translationCoverage:'partial'},{bookId:'private',visibility:'private'}]});
  f.context.clear();
  assert.equal(f.context.books.length,1);
  const row=f.context.books[0];
  assert.deepEqual([...row.translationLanguages],[]);assert.equal(row.supportsParallel,false);assert.equal(row.translatedParagraphs,0);assert.equal(row.translationCoverage,'none');
});

test('home cover title and stored resume label remain content even when equal to a UI phrase',()=>{
  const make=(tag,className='',text)=>({tag,className,textContent:text??'',children:[],setAttribute(){},append(...children){this.children.push(...children);}});
  const context={document:{},getUiLocale,homeLocale:()=> 'en',homeText,isLibrary:false,make,session:{user:{id:'synthetic'}},readingBookUrl:()=>'/read?book=synthetic',t:formatter,chineseTrialUrl:()=>'/read',positionStorageKey:()=>'',localStorage:{getItem:()=>null}};
  vm.createContext(context);vm.runInContext(declaration('landingBookCard')+'\nthis.cardFactory=landingBookCard;',context);
  const book={bookId:'synthetic',title:{en:'阅读',zh:'阅读'},author:'Author',description:'Source description',visibility:'public',source:{format:'txt',filename:'source.txt',sha256:'v'},paragraphs:1,resume:{label:'阅读',passageId:'p1'}};
  const card=context.cardFactory(book),all=node=>[node,...node.children.flatMap(all)],nodes=all(card);
  assert.equal(nodes.find(x=>x.tag==='h3').textContent,'阅读');assert.equal(nodes.find(x=>x.tag==='strong').textContent,'阅读');
  assert.equal(nodes.find(x=>x.className==='book-resume').textContent,'阅读');assert.equal(book.resume.label,'阅读');
});

test('actual dedicated upload progress replaces a semantic notice and keeps its language truthful without reviving finished work',async()=>{
 await requestUiRoute('en');const f=uploadFixture({t,getUiLocale});const off=onUiLocaleChange(f.context.relabel);try{f.context.replace('upload-status',{id:'portal.upload.organizing'});assert.equal(f.el('upload-status').getAttribute('lang'),'en');f.context.progress({id:'pdf.upload.saved',params:{percent:73}},f.ticket,f.upload);await requestUiRoute('ja');assert.equal(f.el('upload-status').textContent,t('pdf.upload.saved',{percent:73}));assert.equal(f.el('upload-status').getAttribute('lang'),'ja');const before={text:f.el('upload-status').textContent,lang:f.el('upload-status').getAttribute('lang')};f.upload.finish();await requestUiRoute('en');assert.equal(f.el('upload-status').textContent,before.text);assert.equal(f.el('upload-status').getAttribute('lang'),before.lang);f.context.replace('upload-status','');await requestUiRoute('ja');assert.equal(f.el('upload-status').textContent,'');}finally{off();await requestUiRoute('en');}
});


test('actual portal relabels static library chrome in place, including visible names, hints and authored home destinations',async()=>{
 const html=portalDocument(await readFile(new URL('../app/home.html',import.meta.url),'utf8'),'/library'),{document}=fixture(html),$=id=>document.getElementById(id);
 const brands=[...document.querySelectorAll('a.brand')],shelves=[...document.querySelectorAll('[data-shelf]')],labels=shelves.map(n=>n.querySelector('.sidebar-label'));
 const originalButtons=shelves.map(n=>n.children.slice());let calls=0;
 const context={document,$,t,getUiLocale,uiAuthoredPath,isLibrary:true,chromeLabels:new Map(),cardLabels:new Map(),ownedLinks:new Set(),applySpec(){assert.fail('empty registry');},uiHref(){assert.fail('empty registry');},uploadTitleId:'portal.upload.title',squirrelPosition:null,shell:{updateLabels(){calls++;}},updateUploadProgressLabel(){},refresh(){assert.fail('language cannot refresh');},renderBooks(){assert.fail('language cannot render books');}};
 vm.createContext(context);vm.runInContext(declaration('updatePortalLabels')+'\nthis.relabel=updatePortalLabels;',context);
 try{for(const code of ['en','ja','zh-Hant','zh-Hans']){
  await requestUiRoute(code);context.relabel();
  for(let i=0;i<shelves.length;i++){const key=shelves[i].dataset.shelf==='all'?'portal.room.library':'portal.room.private';assert.equal(labels[i].textContent,t(key));assert.equal(shelves[i].getAttribute('aria-label'),t(key));assert.equal(shelves[i].dataset.hint,t(key));assert.deepEqual(shelves[i].children,originalButtons[i]);}
  const search=$('sidebar-search-open');assert.equal(search.querySelector('.sidebar-label').textContent,t('palette.title'));assert.equal(search.getAttribute('aria-label'),t('palette.title'));assert.equal(search.dataset.hint,t('palette.title'));
  assert.equal(document.querySelector('.shelf-tabs').getAttribute('aria-label'),t('portal.shelf.filters'));assert.equal($('library-filter-controls').getAttribute('aria-label'),t('filter.bookshelf'));
  for(const brand of brands){assert.equal(brand.getAttribute('href'),uiAuthoredPath('/',code));assert.equal(brand.getAttribute('aria-label'),t('portal.brand.home'));assert.equal(brand.querySelector('.brand-name').textContent,'Leafhour');}
 }}finally{await requestUiRoute('en');}
 assert.equal(calls,4);
});

test('signed-in desktop home account handoff carries the current UI language',async()=>{
 const accountHandler=ast.body.find(n=>n.type==='ExpressionStatement'&&source.slice(n.start,n.end).startsWith("$('account-button').addEventListener('click'"));assert.ok(accountHandler);
 for(const code of ['en','ja']){await requestUiRoute(code);let handler;const location={href:''};const context={$:()=>({addEventListener(_type,fn){handler=fn;}}),session:{user:{id:'synthetic'}},isLibrary:false,shell:{openSettings(){assert.fail('home route');}},location,uiHref};vm.createContext(context);vm.runInContext(source.slice(accountHandler.start,accountHandler.end),context);handler();assert.equal(location.href,'/library?settings=account&ui='+code);}
 await requestUiRoute('en');
});
