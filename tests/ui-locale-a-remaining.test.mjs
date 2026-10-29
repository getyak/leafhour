import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import * as locale from '../app/ui-locale.mjs';
import * as calendar from '../app/reading-calendar.mjs';
import * as journal from '../app/reading-journal.mjs';
import * as workspace from '../app/library-workspace.mjs';
import * as policy from '../app/reading-time-policy.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';
import {paintBookCover,bookCoverLabel} from '../app/book-binding.mjs';
import {paintBookIdentity,bookCoverSearchText} from '../app/book-cover-ui.mjs';
import {mountReadingArrival} from '../app/reading-arrival.mjs';
import {trackActionFocus} from '../app/action-focus.mjs';
class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.dataset={};this.value='';this.textContent='';this.hidden=false;this.className='';this.replacements=0;this.classList={add:n=>this.toggle(n,true),remove:n=>this.toggle(n,false),toggle:(n,v)=>this.toggle(n,v)};}
 toggle(n,v){const a=new Set(this.className.split(' '));if(v)a.add(n);else a.delete(n);this.className=[...a].join(' ');}
 get isConnected(){return this===this.ownerDocument.body||!!this.parentElement?.isConnected;}
 append(...nodes){for(const n of nodes){n.parentElement?.children.splice(n.parentElement.children.indexOf(n),1);n.parentElement=this;this.children.push(n);}}
 replaceChildren(...nodes){this.replacements++;for(const n of this.children)n.parentElement=null;this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}hasAttribute(k){return Object.hasOwn(this.attrs,k);}removeAttribute(k){delete this.attrs[k];}
 toggleAttribute(k,force){const next=force===undefined?!this.hasAttribute(k):!!force;if(next)this.setAttribute(k,'');else this.removeAttribute(k);return next;}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 querySelectorAll(s){return all(this).slice(1).filter(n=>s.startsWith('.')?n.className.split(' ').includes(s.slice(1)):s==='[data-reading-arrival]'?!!n.dataset.readingArrival:s.startsWith('[data-date=')?n.dataset.date===s.slice(12,-2):false);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}focus(){this.ownerDocument.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
const all=n=>[n,...n.children.flatMap(all)],deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};},flush=()=>new Promise(setImmediate);
const dashboardSource=await readFile(new URL('../app/reading-dashboard.mjs',import.meta.url),'utf8'),dashboardAst=parse(dashboardSource,{ecmaVersion:'latest',sourceType:'module'});
function dashboardFixture(runtime={},bookRows=null){
 const doc=new EventTarget();doc.defaultView={location:{search:'',reload(){assert.fail('no arrival reload');}}};doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');const roots=Array.from({length:3},()=>doc.createElement('section'));doc.body.append(...roots);let calls=0;const reads={session:0,owner:0,books:0,view:0},preview=deferred(),activity=deferred();
 const book={bookId:'synthetic',contentVersion:'v1',title:{zh:'阅读 · Source title'},author:'Literal author',resume:{passageId:'p1',label:'Literal resume',variant:'interpretive'},journey:{dailyGoalMinutes:15,status:'reading'}};
 const context={...locale,...runtime,...calendar,...journal,...workspace,...policy,document:doc,Intl,Date,Event,inferSourceLanguage,paintBookCover,bookCoverLabel,paintBookIdentity,mountReadingArrival,trackActionFocus,crypto:globalThis.crypto,createCalendarRequestState(){const r=calendar.createCalendarRequestState();return {...r,view(){reads.view++;return r.view();}};}};vm.createContext(context);
 const executable=dashboardAst.body.map(n=>n.type==='ImportDeclaration'?'':n.type==='ExportNamedDeclaration'?dashboardSource.slice(n.declaration.start,n.end):dashboardSource.slice(n.start,n.end)).join('\n');vm.runInContext(executable+'\nthis.mount=mountReadingDashboard;',context);
 const ui=context.mount({root:roots[0],overviewRoot:roots[1],historyRoot:roots[2],api(url){calls++;return url.includes('/preview')?preview.promise:activity.promise;},getSession(){reads.session++;return {user:{id:'a'}};},getOwner(){reads.owner++;return 'a';},getBooks(){reads.books++;return bookRows||[book];},openAuth(){assert.fail('no auth from locale');},refresh(){assert.fail('no refresh from locale');}});
 return {doc,ui,roots,preview,activity,reads,calls:()=>calls,find:cls=>all(doc.body).find(n=>n.className.split(' ').includes(cls))};
}
test('actual native current-book selectors keep public volumes distinct across language commits without business reads',async()=>{
 await locale.requestUiRoute('en');const books=[1,2].map(volume=>({bookId:'gutenberg-dream-red-chamber-'+volume,visibility:'public',contentVersion:'test',title:{zh:'Source '+volume},author:'Source author',source:{format:'txt'}})),original=JSON.stringify(books),f=dashboardFixture({},books);
 try{f.ui.update(null);const choice=f.find('today-book-choice'),options=choice.children.slice(),snapshot={...f.reads},calls=f.calls();
  const expected={en:['Dream of the Red Chamber · Volume 1 · Chapters 1–40 · Chinese text','Dream of the Red Chamber · Volume 2 · Chapters 41–80 · Chinese text'],'zh-Hans':['红楼梦 · 第 1 册 · 第 1—40 回 · 中文原典','红楼梦 · 第 2 册 · 第 41—80 回 · 中文原典'],'zh-Hant':['紅樓夢 · 第 1 冊 · 第 1—40 回 · 中文原典','紅樓夢 · 第 2 冊 · 第 41—80 回 · 中文原典'],ja:['紅楼夢 · 第 1 冊 · 第 1–40 回 · 中国語本文','紅楼夢 · 第 2 冊 · 第 41–80 回 · 中国語本文']};
  for(const code of ['en','ja','zh-Hans','zh-Hant']){await locale.requestUiRoute(code);assert.deepEqual(choice.children,options);assert.deepEqual(options.map(option=>option.textContent),expected[code]);assert.deepEqual(f.reads,snapshot);assert.equal(f.calls(),calls);}assert.equal(JSON.stringify(books),original);
 }finally{f.ui.dispose();await locale.requestUiRoute('en');}
});
test('actual dashboard relabels cached pending and completed previews/calendar without reads, API, selection or rebuild',async()=>{
 await locale.requestUiRoute('en');const f=dashboardFixture();try{
 f.ui.update(null);f.ui.openHistory();await flush();const input=f.find('today-book-choice'),goal=f.find('reading-goal').children.find(n=>n.tagName==='select'),grid=f.find('calendar-grid');goal.value='25';goal.focus();const selected=grid.children.find(n=>n.getAttribute('aria-pressed')==='true'),cell=grid.children.find(n=>n.dataset.date),snapshot={...f.reads},count=f.calls(),gridChanges=grid.replacements;
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.deepEqual(f.reads,snapshot);assert.equal(f.calls(),count);assert.equal(grid.replacements,gridChanges);assert.ok(f.find('today-book-choice')===input);assert.equal(goal.value,'25');assert.ok(f.doc.activeElement===goal);assert.equal(selected.getAttribute('aria-pressed'),'true');assert.match(cell.getAttribute('aria-label'),new RegExp(cell.dataset.date));}
 f.preview.resolve({original:'Literal source Source',interpretive:'原译文 阅读',translationStatus:{interpretive:'draft'},question:{text:'Literal question',passageId:'p1'}});f.activity.resolve({days:[],readingDays:0,durationSeconds:0,notes:0});await flush();const text=f.find('room-excerpt-text'),original=text.textContent,question=f.find('room-question-text'),nodes=grid.children.slice(),after={...f.reads},countAfter=f.calls();
 for(const code of ['zh-Hans','ja','zh-Hant','en']){await locale.requestUiRoute(code);assert.deepEqual(f.reads,after);assert.equal(f.calls(),countAfter);assert.ok(f.find('room-excerpt-text')===text);assert.equal(text.textContent,original);assert.equal(question.textContent,'Literal question');assert.deepEqual(grid.children,nodes);}
 }finally{f.ui.dispose();}
});

const portalSource=await readFile(new URL('../app/portal.js',import.meta.url),'utf8'),portalAst=parse(portalSource,{ecmaVersion:'latest',sourceType:'module'});
const declaration=name=>{const n=portalAst.body.find(n=>n.id?.name===name||n.declarations?.some(d=>d.id.name===name));assert.ok(n,name);return portalSource.slice(n.start,n.end);};
test('actual portal room descriptors use business snapshots while filters and focused dirty search remain intact',async()=>{
 await locale.requestUiRoute('en');const doc={};doc.body=new Element('body',doc);doc.querySelectorAll=()=>[];doc.querySelector=()=>null;const nodes=new Map(),el=id=>{if(!nodes.has(id)){const n=new Element('div',doc);nodes.set(id,n);doc.body.append(n);}return nodes.get(id);};for(const tag of ['h2','p']){const n=new Element(tag,doc);el('empty-shelf').append(n);}el('empty-shelf').querySelector=s=>el('empty-shelf').children.find(n=>n.tagName===s);doc.activeElement=null;
 const counters={loading:0,current:0,filters:0,update:0,chat:0};const book={bookId:'book',title:{zh:'阅读'},author:'Literal author'},context={...locale,...workspace,bookCoverSearchText,document:doc,$:el,books:[book],session:{user:{id:'a'}},selectedCurrent:null,personalizationPending:false,shelfList:null,shelfControls:{read(){counters.filters++;return {query:'阅读',scope:'all'};},update(){counters.update++;},setPending(){}},dashboard:{isLoading(){counters.loading++;return false;},getCurrentBook(){counters.current++;return null;}},bookActions:null,chat:{update(){counters.chat++;}},squirrelPosition:null,shell:null,isLibrary:true,upload:null,updateUploadProgressLabel(){},Intl};vm.createContext(context);vm.runInContext(['chromeLabels','specText','num','uploadTitleId','applySpec','own','shelfEmptyHelpId','renderReadingBookmark','renderBooks','updatePortalLabels'].map(declaration).join('\n')+'\nthis.render=renderBooks;this.labels=updatePortalLabels;this.cardLabels=new Map();this.ownedLinks=new Set();',context);
 context.render();const before={...counters},room=el('room-count'),search=el('book-search'),shelf=el('library-books'),replacements=shelf.replacements;search.value='IME composing 阅读';doc.activeElement=search;
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);context.labels();assert.deepEqual(counters,before);assert.equal(shelf.replacements,replacements);assert.equal(search.value,'IME composing 阅读');assert.ok(doc.activeElement===search);assert.equal(room.textContent,locale.t('portal.count.filtered',{shown:'1',total:'1'}));}
});


test('actual dashboard first ready and initial catalogue failure repaint labels without business work',async()=>{
 const ja=(await import('../app/ui-catalogs/ja.mjs')).default;
 for(const mode of ['success','failure']){const pending=deferred();let formats=0;const runtime=locale.createUiLocale({loadCatalogue:()=>pending.promise,getLocation:()=>({href:'https://leafhour.invalid/library?ui=ja'})});const initialization=runtime.initializeOnce(),f=dashboardFixture({t(...a){formats++;return runtime.t(...a);},getUiLocale:runtime.getUiLocale,uiHref:runtime.uiHref,onUiLocaleChange:runtime.onUiLocaleChange,uiReady:runtime.uiReady});try{f.ui.update(null);const before={...f.reads},calls=f.calls(),formatted=formats,choice=f.find('today-book-choice');choice.value='dirty-selection';choice.focus();if(mode==='success')pending.resolve(ja);else pending.reject(Error('synthetic catalogue failure'));await initialization;await runtime.uiReady;await flush();assert.deepEqual(f.reads,before);assert.equal(f.calls(),calls);assert.ok(formats>formatted);assert.equal(choice.value,'dirty-selection');assert.ok(f.doc.activeElement===choice);assert.equal(runtime.getUiLocale(),mode==='success'?'ja':'en');assert.equal(runtime.getUiLocaleState().initialFallback,mode==='failure');}finally{f.ui.dispose();}}
});

test('actual daily settings keep dirty time, consent and literal inbox nodes without identity reads on locale',async t=>{
 const {mountLibraryDailyReading}=await import('../app/library-daily-reading.mjs');await locale.requestUiRoute('en');const old=globalThis.document,doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');globalThis.document=doc;t.after(()=>{globalThis.document=old;});const root=doc.createElement('section'),inbox=doc.createElement('section');doc.body.append(root,inbox);const reads={session:0,books:0,current:0,api:0},book={bookId:'book',title:{zh:'阅读'}};
 const ui=mountLibraryDailyReading({root,inboxRoot:inbox,getSession(){reads.session++;return {user:{id:'a'}};},getBooks(){reads.books++;return [book];},getCurrentBook(){reads.current++;return book;},async api(){reads.api++;return {plan:{id:'plan',revision:1,bookId:'book',status:'active',time:'20:00',timeZone:'Asia/Shanghai',connectedAt:'2026-10-18T12:00:00Z',grantExpiresAt:'2026-11-18T12:00:00Z'},inbox:[{id:'card',message:'Literal AI 阅读',quote:{text:'Literal quote'},createdAt:'2026-10-18T12:00:00Z',link:'/read?book=book&passage=p1&contentVersion=v1&layer=original'}]};}});t.after(()=>ui.dispose());await ui.refresh();await flush();const find=id=>all(root).find(n=>n.id===id),time=find('daily-time');time.value='21:37';time.dispatchEvent(new Event('input'));const consent=find('daily-consent');consent.checked=true;time.focus();const snapshot={...reads},children=all(inbox),options=find('daily-book').children.slice();
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.deepEqual(reads,snapshot);assert.equal(time.value,'21:37');assert.equal(consent.checked,true);assert.ok(doc.activeElement===time);assert.deepEqual(all(inbox),children);assert.deepEqual(find('daily-book').children,options);assert.ok(children.some(n=>n.textContent==='Literal AI 阅读'));assert.ok(children.some(n=>n.textContent==='Literal quote'));}
});

test('actual portal statuses and initial failure keep semantic labels through locale commits and relinquish replaced slots',async()=>{
 await locale.requestUiRoute('en');const doc={querySelectorAll:()=>[],querySelector:()=>null};doc.body=new Element('body',doc);doc.createElement=tag=>new Element(tag,doc);const nodes=new Map(),el=id=>{if(!nodes.has(id)){const n=doc.createElement('div');nodes.set(id,n);doc.body.append(n);}return nodes.get(id);};
 const context={...locale,document:doc,$:el,isLibrary:true,upload:{get busy(){assert.fail('locale reads no upload business state');}},shell:null,squirrelPosition:null,refresh(){assert.fail('no refresh on locale');},api(){assert.fail('no API on locale');},updateUploadProgressLabel(){},Intl};vm.createContext(context);vm.runInContext(['make','chromeLabels','specText','uploadTitleId','applySpec','own','uploadProgressMessage','paintStatus','status','updatePortalLabels'].map(declaration).join('\n')+'\nthis.setStatus=status;this.labels=updatePortalLabels;this.own=own;',context);
 const catchCall=portalAst.body.find(n=>n.type==='ExpressionStatement'&&n.expression?.callee?.property?.name==='catch'&&portalSource.slice(n.start,n.end).startsWith('refresh().then(')).expression;
 vm.runInContext('this.failed='+portalSource.slice(catchCall.arguments[0].start,catchCall.arguments[0].end)+';',context);
 const status=el('library-status');context.own(el('confirm-upload'),{id:'portal.upload.busy'});context.setStatus('library-status',{id:'portal.status.uploadIncomplete',params:{filename:'来源 / 阅读.md'}},true);const before=status;
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);context.labels();assert.equal(el('library-status'),before);assert.equal(el('confirm-upload').textContent,locale.t('portal.upload.busy'));assert.equal(status.textContent,locale.t('portal.status.uploadIncomplete',{filename:'来源 / 阅读.md'}));assert.equal(status.getAttribute('lang'),code);assert.ok(status.className.includes('error'));assert.equal(el('library-menu').getAttribute('aria-label'),locale.t('nav.roomMenu'));}
 context.setStatus('library-status','Literal replacement',false);await locale.requestUiRoute('ja');context.labels();assert.equal(status.textContent,'Literal replacement');
 const failure={get message(){assert.fail('opaque remote prose is not read for UI');}};context.failed(failure);const featured=el('featured-books').children[0];assert.ok(featured);for(const code of ['en','zh-Hans','zh-Hant','ja']){await locale.requestUiRoute(code);context.labels();assert.equal(status.textContent,locale.t('ui.generic.error'));assert.equal(el('featured-books').children[0],featured);assert.equal(featured.textContent,locale.t('portal.books.failed'));assert.notEqual(featured.textContent,'portal.books.failed');}
 context.setStatus('library-status','');await locale.requestUiRoute('en');context.labels();assert.equal(status.textContent,'');
});

test('uploaded book reading action keeps the current route UI and exact encoded book ID',async()=>{
 const {uploadedBookHref}=await import('../app/chat-book-upload.mjs');await locale.requestUiRoute('ja');const target=new URL(uploadedBookHref('来源/a?b'),'https://example.invalid');assert.equal(target.pathname,'/read');assert.equal(target.searchParams.get('book'),'来源/a?b');assert.deepEqual(target.searchParams.getAll('ui'),[]);await locale.requestUiRoute('en');
});
