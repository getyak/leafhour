import {bookCoverLabel} from '../app/book-binding.mjs';
import {paintBookIdentity} from '../app/book-cover-ui.mjs';
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
 const context={make,bookCoverLabel,paintBookIdentity,getUiLocale,t,paintBookCover(){},readingBookUrl:()=>'/read?book=synthetic',ownedHref(){},bookActions:null,notebook:null,shelfDrag:null,mountCardLabels(){},roomIcons(){},cardLabel(node,id,params){assert.ok(Object.hasOwn(english,id),'shelf message exists: '+id);node.textContent=t(id,params);return node;}};
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
    if(!nodes.has(id))nodes.set(id,{dataset:{},textContent:'',value:'',open:false,disabled:false,attributes:new Map(),setAttribute(k,v){this.attributes.set(k,String(v));},getAttribute(k){return this.attributes.get(k);},classList:{toggle(){},remove(){}},replaceChildren(){},removeAttribute(){},close(){this.open=false;}});
    return nodes.get(id);
  };
  const ownerScope=createOwnerScope();ownerScope.adopt('synthetic-a');
  const upload=createUploadState();upload.select({name:'synthetic.pdf',size:1});upload.begin();
  const context={readingWorkspace:null,readingWorkspaceOwner:null,libraryArrival:null,personalizationPending:false,document:{querySelectorAll:()=>[]},$:el,t:formatter,getUiLocale,ownerScope,upload,createUploadState,homeMenu:null,invalidatePaletteLibraries(){},viewHistory:null,bookActions:null,notebook:null,shelfDrag:null,shelfRevision:0,orderOperation:null,authDialog:{reset(){}},pendingUpload:false,pendingChat:false,selectedCurrent:null,pdfOnboarding:null,followedPdfId:null,shelfControls:null,books:[],chat:null,shell:null,setupInvite:null,dashboard:null,renderBooks(){},landingBookCard(){assert.fail('no books expected');},...bindings};
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
  const context={document:{},bookCoverLabel,paintBookCover(){},getUiLocale,homeLocale:()=> 'en',homeText,isLibrary:false,make,session:{user:{id:'synthetic'}},readingBookUrl:()=>'/read?book=synthetic',t:formatter,chineseTrialUrl:()=>'/read',positionStorageKey:()=>'',localStorage:{getItem:()=>null}};
  vm.createContext(context);vm.runInContext(declaration('landingBookCard')+'\nthis.cardFactory=landingBookCard;',context);
  const book={bookId:'synthetic',title:{en:'阅读',zh:'阅读'},author:'Author',description:'Source description',visibility:'public',source:{format:'txt',filename:'source.txt',sha256:'v'},paragraphs:1,resume:{label:'阅读',passageId:'p1'}};
  const card=context.cardFactory(book),all=node=>[node,...node.children.flatMap(all)],nodes=all(card);
  assert.equal(nodes.find(x=>x.tag==='h3').textContent,'阅读');
  assert.equal(nodes.find(x=>x.className==='book-resume').textContent,'阅读');assert.equal(book.resume.label,'阅读');
});

test('homepage catalog metadata and cached chapter positions follow the committed UI language in place',async()=>{
 const make=(tag,className='',text)=>({tag,className,textContent:text??'',children:[],attrs:{},setAttribute(k,v){this.attrs[k]=v;},append(...children){this.children.push(...children);}});
 const labels=new Map(),local={passageId:'p7',chapterLabel:'第 1 章 · 掉进兔子洞',contentVersion:'v'};
 const context={bookCoverLabel,paintBookCover(){},getUiLocale,homeText,isLibrary:false,make,session:null,readingBookUrl:(_book,resume)=>'/read?book=gutenberg-alice'+(resume?'&passage='+resume.passageId:''),t,chineseTrialUrl:()=>'/read?sample=zh',positionStorageKey:()=>'',localStorage:{getItem:()=>JSON.stringify(local)},registerCardNode(node,spec){labels.set(node,spec);}};
 vm.createContext(context);vm.runInContext(declaration('landingBookCard')+'\nthis.cardFactory=landingBookCard;',context);
 const book={bookId:'gutenberg-alice',title:{en:'Alice’s Adventures in Wonderland',zh:'爱丽丝梦游仙境'},author:'Lewis Carroll',description:'跟着白兔进入一个熟悉的陌生世界。',visibility:'public',cover:'alice',source:{format:'txt',sha256:'v'},paragraphs:20,chapterIndex:[{id:'ch01',kind:'body',number:1,title:{zh:'掉进兔子洞',en:'Down the Rabbit-Hole'}}]};
 const original=JSON.stringify({book,local});
 try{
  await requestUiRoute('en');const card=context.cardFactory(book),all=node=>[node,...node.children.flatMap(all)],nodes=all(card);
  const find=cls=>nodes.find(node=>node.className===cls);
  assert.equal(find('book-resume').textContent,'Chapter 1 · Down the Rabbit-Hole');
  assert.equal(find('book-description').textContent,'Follow the White Rabbit into a familiar, unfamiliar world.');
  assert.equal(find('book-read').attrs['data-ui-message'],'portal.card.continue');
  assert.match(nodes.find(node=>node.className==='book-art alice').href,/passage=p7/);
  for(const locale of ['zh-Hans','en']){
   await requestUiRoute(locale);
   for(const [node,spec] of labels)if(!spec.attr)node.textContent=spec.render?spec.render():t(spec.id,spec.params);
   assert.equal(find('book-resume').textContent,locale==='en'?'Chapter 1 · Down the Rabbit-Hole':'第 1 章 · 掉进兔子洞');
   assert.equal(nodes.find(node=>node.tag==='h3').textContent,book.title[locale==='en'?'en':'zh']);
  }
  assert.equal(JSON.stringify({book,local}),original,'formatting never changes source metadata or persisted progress');
  const meditation=context.cardFactory({...book,bookId:'gutenberg-meditations',author:'Marcus Aurelius · 英译 Meric Casaubon',resume:{chapterId:'ch01',passageId:'p7',label:local.chapterLabel}});
  assert.equal(all(meditation).find(node=>node.className==='book-author').textContent,'Marcus Aurelius · English translation: Meric Casaubon');
 }finally{await requestUiRoute('en');}
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

test('the signed-in home reading-room button opens the shelf without an extra settings dialog',async()=>{
 const accountHandler=ast.body.find(n=>n.type==='ExpressionStatement'&&source.slice(n.start,n.end).startsWith("$('account-button').addEventListener('click'"));assert.ok(accountHandler);
 for(const code of ['en','ja','zh-Hans','zh-Hant']){await requestUiRoute(code);let handler;const location={href:''};const context={$:()=>({addEventListener(_type,fn){handler=fn;}}),session:{user:{id:'synthetic'}},isLibrary:false,shell:{openSettings(){assert.fail('home route');}},location,uiHref};vm.createContext(context);vm.runInContext(source.slice(accountHandler.start,accountHandler.end),context);handler();assert.equal(location.href,"/library");assert.equal(new URL(location.href,'https://leafhour.invalid').searchParams.has('settings'),false,'reading should not require closing a profile dialog');}
 await requestUiRoute('en');
});

test('the home guest button still opens sign-in and the library account button still opens account settings',()=>{
 const accountHandler=ast.body.find(n=>n.type==='ExpressionStatement'&&source.slice(n.start,n.end).startsWith("$('account-button').addEventListener('click'"));
 for(const signedIn of [false,true]){let handler,logins=0,settings=0;const location={href:''};const context={$:()=>({addEventListener(_type,fn){handler=fn;}}),session:{user:signedIn?{id:'synthetic'}:null},isLibrary:signedIn,openAuth(){logins++;},shell:{openSettings(tab){assert.equal(tab,'account');settings++;}},location,uiHref};vm.createContext(context);vm.runInContext(source.slice(accountHandler.start,accountHandler.end),context);handler();assert.equal(logins,signedIn?0:1);assert.equal(settings,signedIn?1:0);assert.equal(location.href,'');}
});

test('saving, confirming and deleting reading preferences preserves explicit shelf selections and reader defaults',()=>{
 const selected={query:'my book',topic:'history',language:'en',form:'original'},updates=[];
 const context={session:{user:{id:'reader'},readingPreferences:{revision:1},preferenceMemory:{revision:1,memory:{topic:null,sources:{}},preferences:{mode:'en'}}},
  shelfControls:{applyMemoryPreferences(){assert.fail('a saved preference must not filter or clear the shelf');}},
  setupInvite:{update(){updates.push('invite');}},shell:{update(){updates.push('shell');}}};
 vm.createContext(context);vm.runInContext(declaration('adoptPreferenceMemory')+'\nthis.adopt=adoptPreferenceMemory;',context);
 for(const [revision,mode,topic,sources]of [[2,'zh','philosophy',{mode:{source:'settings'}}],[3,'parallel','science',{mode:{source:'agent'}}],[4,'en',null,{}]]){
  const saved={revision,preferences:{mode,theme:'night'},memory:{topic,sources}};
  context.adopt(saved,{changed:true,keys:['topic','mode']});
  assert.equal(context.session.preferenceMemory,saved);assert.equal(context.session.readingPreferences.preferences.mode,mode);
  assert.deepEqual(selected,{query:'my book',topic:'history',language:'en',form:'original'});
 }
 assert.equal(updates.length,6);context.adopt({revision:1});assert.equal(context.session.readingPreferences.revision,4,'stale preference responses remain fenced');
});

test('opening and refreshing an account never replaces the explicit shelf view with saved preferences',async()=>{
 for(const firstEntry of [true,false]){
  const explicit={query:'kept',topic:'history',language:'en',form:'translated'},session={user:{id:'reader'},readingPreferences:{preferences:{preferredLanguage:'zh'}},preferenceMemory:{revision:2,memory:{topic:'philosophy',sources:{mode:{source:'settings'}}},preferences:{mode:'en'}}};
  let renders=0;
  const context={ensureReadingWorkspace:async()=>null,libraryArrival:null,personalizationPending:false,requestAnimationFrame(){},refreshGeneration:0,isLibrary:true,identityResolved:!firstEntry,ownerScope:createOwnerScope(firstEntry?'guest':'reader'),session,books:[],shelfRevision:0,pendingUpload:false,pendingChat:false,bootstrapped:false,
   dashboard:{begin:()=>1,update(){},fail(){}},homeMenu:null,adoptUiOwner(){},deviceBookStore:()=>({adopt:async()=>{}}),prepareOfflineResources:async()=>false,
   authDialog:{updateCapabilities(){},isSettingPasswordFor:()=>false},clearPrivateUI(options){assert.equal(options.preserveView,true,'first identity keeps the incoming explicit URL');},
   shell:{update(){},refreshDaily(){}},setupInvite:{update(){}},
   shelfControls:{applyReadingPreferences(){assert.fail('account language cannot filter the shelf');},applyMemoryPreferences(){assert.fail('account topic or mode cannot filter the shelf');}},
   api:async route=>{assert.equal(route,'/api/library?view=books');return {books:[]};},$:()=>({hidden:false,setAttribute(){}}),own(){},status(){},renderBooks(){renders++;},pdfOnboarding:{refresh(){}}};
  vm.createContext(context);vm.runInContext(declaration('refresh')+'\nthis.refreshAccount=refresh;',context);
  await context.refreshAccount(session);await context.refreshAccount(session);
  assert.equal(renders,4);assert.deepEqual(explicit,{query:'kept',topic:'history',language:'en',form:'translated'});
  assert.equal(context.session.readingPreferences.preferences.preferredLanguage,'zh');
 }
});

test('empty shelf help addresses a title search before language and format filters',()=>{
 const context={};vm.createContext(context);vm.runInContext(declaration('shelfEmptyHelpId')+'\nthis.help=shelfEmptyHelpId;',context);
 assert.equal(context.help({query:'no such book'}),'portal.empty.filteredHelp');
 assert.equal(context.help({query:'no such book',language:'zh',form:'bilingual'}),'portal.empty.filteredHelp');
 assert.equal(context.help({topic:'science'}),'portal.empty.filteredHelp');
 assert.equal(context.help({language:'zh'}),'filter.languageEmptyHelp');
 assert.equal(context.help({form:'translated'}),'filter.languageEmptyHelp');
});
