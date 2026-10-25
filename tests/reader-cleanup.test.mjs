import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {fixture} from './annotation-dom-fixture.mjs';
import {readingJourney} from '../app/reading-journey.mjs';
import {requestUiRoute,t} from '../app/ui-locale.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {trackActionFocus} from '../app/action-focus.mjs';

const reader=await readFile(new URL('../app/reader.js',import.meta.url),'utf8');
const atmosphere=await readFile(new URL('../app/reader-atmosphere.js',import.meta.url),'utf8');
const session=await readFile(new URL('../app/reading-session.js',import.meta.url),'utf8');
const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
const declaration=(source,name)=>{const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);};
const book={bookId:'fixture',contentVersion:'v1',chapters:[{id:'one',number:1,kind:'body',title:{zh:'First'}},{id:'two',number:2,kind:'body',title:{zh:'Second'}}]};

test('Just the page has no inactive sound form or prompt, but retains a real storage error',()=>{
 const {document}=fixture('<body><section class="atmosphere-sound"></section><button id="atmosphere-play"><span></span><span id="atmosphere-play-label"></span></button><p id="atmosphere-status"></p><button id="settings-atmosphere-toggle"></button><p id="settings-atmosphere-status"></p><button id="atmosphere-quick-pause"></button><button id="open-atmosphere"></button></body>');
 const $=id=>document.getElementById(id),dialog={dataset:{},querySelector:s=>document.querySelector(s)};
 const scope={atmosphereDisposed:false,session:{status:'idle'},prefs:{scene:'none',music:28,nature:32},narrating:false,notice:'',dialog,$,playbackLabels(){ $('atmosphere-status').hidden=!scope.playback.hasScene&&!scope.playback.notice; }};
 const run=new Function(...Object.keys(scope),'let playback;'+declaration(atmosphere,'renderPlayback')+';renderPlayback();return playback;');
 scope.playback=run(...Object.values({...scope,playbackLabels(){}}));
 assert.equal(document.querySelector('.atmosphere-sound').hidden,true);
 assert.equal($('atmosphere-play').hidden,true);
 assert.equal($('settings-atmosphere-toggle').hidden,true);
 // The actual label owner controls notice visibility, including quiet mode.
 const labels=new Function('$','t','SCENE_UI','READER_SHELL','playback',declaration(atmosphere,'playbackLabels')+';playbackLabels();');
 labels($,id=>id,'reader.atmosphere.','reader.shell.',scope.playback);
 assert.equal($('atmosphere-status').hidden,true);
 assert.equal($('settings-atmosphere-status').hidden,true);
 labels($,id=>id,'reader.atmosphere.','reader.shell.',{...scope.playback,notice:'reader.atmosphere.storageError'});
 assert.equal($('atmosphere-status').hidden,false);
 assert.equal($('settings-atmosphere-status').hidden,false);
 assert.equal($('atmosphere-status').textContent,'reader.atmosphere.storageError');
});

for(const locale of ['en','zh-Hans','zh-Hant','ja'])test('chapter mark buttons expose their actual read state in '+locale,async()=>{
 await requestUiRoute(locale);
 const {document}=fixture('<body><div id="chapter-reading-actions"></div><button data-mark-chapter="one"></button><button data-mark-chapter="two"></button><button id="mark-chapter-read"></button><p id="chapter-read-state"></p></body>');
 const start=session.indexOf('  const chapter=book.chapters.find'),end=session.indexOf('\n}',start);
 const run=new Function('book','bridge','records','marks','allowed','$','document','readingJourney','label','SESSION_UI','READER_UI','READER_SHELL',session.slice(start,end));
 const records={readingMilestones:[{id:'mark',origin:'user',bookId:'fixture',contentVersion:'v1',type:'chapter_read',chapterId:'one',createdAt:'2026-10-26T00:00:00Z'}]};
 const label=(node,id)=>{node.textContent=t(id);};
 run(book,()=>({getChapterId:()=> 'one',areRecordsAvailable:()=>true}),()=>records,{pending:()=>false},true,id=>document.getElementById(id),document,readingJourney,label,'reading.time.','reader.b1.','reader.shell.');
 assert.equal(document.querySelector('[data-mark-chapter="one"]').getAttribute('aria-pressed'),'true');
 assert.equal(document.querySelector('[data-mark-chapter="two"]').getAttribute('aria-pressed'),'false');
 assert.equal(document.getElementById('mark-chapter-read').getAttribute('aria-pressed'),'true');
 assert.notEqual(document.querySelector('[data-mark-chapter="one"]').textContent,document.querySelector('[data-mark-chapter="two"]').textContent);
});

test('Thought hides generated section identifiers while keeping real source pages and prose',()=>{
 const {document}=fixture('<body><div id="panel-content"></div><p id="panel-title"></p><span id="panel-anchor"></span></body>');
 const start=reader.indexOf('function renderPanel(){'),end=reader.indexOf('  for(const tab of',start),code=reader.slice(start,end)+'}';
 const p={id:'p',section:'B2',original:'B2 is part of the original text.',source:{}};
 const run=new Function('pruneLabels','ownedLabels','$','paragraphMap','selectedId','label','allRecords','panelTab','READER_SHELL','READER_UI',code+';renderPanel();');
 const label=(node,id,params)=>{node.textContent=t(id,params);};
 const render=()=>run(()=>{},{forget(){}},id=>document.getElementById(id),new Map([['p',p]]),'p',label,false,'comment','reader.shell.','reader.b1.');
 render();assert.equal(document.getElementById('panel-anchor').hidden,true);assert.equal(document.getElementById('panel-anchor').textContent,'');
 for(const source of [{printedPage:12},{pdfPage:12}]){p.source=source;render();assert.equal(document.getElementById('panel-anchor').hidden,false);assert.match(document.getElementById('panel-anchor').textContent,/12/);assert.doesNotMatch(document.getElementById('panel-anchor').textContent,/B2|§/);}
 assert.equal(p.section,'B2');assert.equal(p.original,'B2 is part of the original text.');
});

for(const later of ['popover','focus','inert'])test('a late account import cannot replace newer '+later+' intent',async()=>{
 const {document}=fixture('<body><header id="reading-header"><button id="open-reader-account"></button><button id="other"></button></header><section id="book-info" popover="auto"></section></body>');
 const trigger=document.getElementById('open-reader-account');trigger.focus();let release,opened=0;
 const loading=new Promise(resolve=>{release=resolve;});
 const node=parse(reader,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ExpressionStatement'&&n.expression.callee?.name==='listen'&&n.expression.arguments[0]?.arguments?.[0]?.value==='open-reader-account');
 const callback=node.expression.arguments[2],code=reader.slice(callback.start,callback.end).replace(/import\('\.\/reader-account\.mjs(?:\?retry=1)?'\)/g,'load()');
 const handler=new Function('document','$','bookInfo','load','readerDisposed','readerSession','readerFetch','readerLoginUrl','selectedBookId','anchor','getUiLinkLocale','announceUi','Event','location','uiHref','let accountSurface,accountLoad,accountRetry;return '+code)(document,id=>document.getElementById(id),{close(){document.getElementById('book-info').removeAttribute('data-popover-open');}},()=>loading,false,{user:{id:'fixture'}},()=>{},()=>'/library', 'fixture',()=>null,()=> 'en',()=>{},Event,{assign(){}},v=>v);
 const pending=handler();
 if(later==='popover')document.getElementById('book-info').setAttribute('data-popover-open','');
 if(later==='focus')document.getElementById('other').focus();
 if(later==='inert')document.getElementById('reading-header').setAttribute('inert','');
 release({mountReaderAccount:()=>({open(){opened++;}})});await pending;
 assert.equal(opened,0);if(later==='popover')assert.equal(document.getElementById('book-info').hasAttribute('data-popover-open'),true);
 assert.equal(trigger.hasAttribute('aria-busy'),false);
});

test('hosted owner-checked logout remains local when provider verification is unavailable',async()=>{
 const f=authFixture({onProvider:({url})=>url.pathname.endsWith('/user')?Response.json({error:'temporarily unavailable'},{status:503}):undefined}),store=f.store(),auth=createHostedAuth({...f,store});
 const session=await auth.verifyCode('fixture@example.test','123456','login');
 await assert.rejects(()=>auth.logout(session.token,{expectedOwner:'different-owner'}),error=>error.status===409);
 assert.equal([...f.rows.values()].find(row=>row.value?.user?.id)?.value.revoked,undefined);
 await auth.logout(session.token,{expectedOwner:session.user.id});
 assert.equal([...f.rows.values()].find(row=>row.value?.user?.id)?.value.revoked,true);
 assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/user')).length,0);
});

for(const moved of [false,true])test('chapter marking '+(moved?'respects newer focus':'returns keyboard focus to its changed action'),async()=>{
 const {document}=fixture('<body><button id="mark-chapter-read"></button><button data-mark-chapter="one"></button><button id="other"></button></body>');
 const trigger=document.querySelector('[data-mark-chapter]');trigger.focus();let release,reported;
 const pending=new Promise(resolve=>{release=resolve;});document.addEventListener('reader:milestone-saved',event=>{reported=event.detail.record;});
 const run=new Function('book','bridge','marks','$','document','readingJourney','records','message','notice','SESSION_UI','render','CustomEvent','disposed','trackActionFocus','markFocusOwners',declaration(session,'markChapter')+';return markChapter;')(book,()=>({getChapterId:()=> 'one'}),{submit:()=>pending},id=>document.getElementById(id),document,readingJourney,()=>({readingMilestones:[]}),()=>{},id=>id,'reading.time.',()=>{},class extends Event{constructor(name,options){super(name);this.detail=options.detail;}},false,trackActionFocus,new Set());
 const saving=run('one');(moved?document.getElementById('other'):document.body).focus();release({type:'chapter_read'});await saving;
 assert.equal(reported.type,'chapter_read');assert.ok(document.activeElement===(moved?document.getElementById('other'):trigger));
});
test('session disposal releases mark focus ownership while its transport is still pending',async()=>{
 const {document}=fixture('<body><button id="mark-chapter-read"></button><button data-mark-chapter="one"></button></body>'),trigger=document.querySelector('[data-mark-chapter]');trigger.focus();
 const active=new Set(),add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);document.addEventListener=(name,fn,...args)=>{if(name==='focusin')active.add(fn);return add(name,fn,...args);};document.removeEventListener=(name,fn,...args)=>{if(name==='focusin')active.delete(fn);return remove(name,fn,...args);};
 let release;const waiting=new Promise(resolve=>{release=resolve;}),markFocusOwners=new Set();
 const api=new Function('deps','const {book,bridge,marks,$,document,readingJourney,records,message,notice,SESSION_UI,render,CustomEvent,trackActionFocus,markFocusOwners}=deps;let disposed=false,sessionEpoch=0,endingOpening=0,ready=true;const listenerDisposers=[],offLocale=()=>{},ownedLabels={clear(){}},manualUi={unmount(){}},tickTimer=undefined,checkpointTimer=undefined;'+declaration(session,'markChapter')+'\n'+declaration(session,'disposeSession')+';return {markChapter,disposeSession};')({book,bridge:()=>({getChapterId:()=> 'one'}),marks:{submit:()=>waiting},$:id=>document.getElementById(id),document,readingJourney,records:()=>({readingMilestones:[]}),message:()=>{},notice:id=>id,SESSION_UI:'reading.time.',render:()=>{},CustomEvent:class extends Event{constructor(name,options){super(name);this.detail=options.detail;}},trackActionFocus,markFocusOwners});
 const saving=api.markChapter('one');assert.equal(active.size,1);api.disposeSession();assert.equal(active.size,0,'unmount must not wait for the network');assert.equal(markFocusOwners.size,0);release({type:'chapter_read'});await saving;assert.equal(active.size,0);
});

test('existing chapter navigation updates one header location in both reading modes',()=>{
 const {document}=fixture(html),$=id=>document.getElementById(id);let events=0;
 document.addEventListener('reader:chapter',()=>events++);
 const state={chapterId:'two'},run=new Function('book','currentChapter','state','$','document','renderToc','CustomEvent',declaration(reader,'updateChapterNavigation')+';updateChapterNavigation();');
 assert.ok($('running-progress'),'one location belongs to the existing chapter chooser');
 for(const continuous of [true,false]){document.body.dataset.continuous=String(continuous);run(book,()=>book.chapters[1],state,$,document,()=>{},class extends Event{constructor(name,options){super(name);this.detail=options.detail;}});assert.equal($('running-progress').textContent,$('chapter-fraction').textContent);assert.equal($('running-progress').textContent,'2 / 2');}
 assert.equal(events,2);
});

test('reader account entry identifies its owned overlay for the existing tools coordinator',()=>{
 const {document}=fixture(html),trigger=document.getElementById('open-reader-account');
 assert.ok(trigger,'reader account is reachable without returning to the library');
 assert.equal(trigger.getAttribute('aria-controls'),'reader-account');assert.equal(trigger.getAttribute('aria-haspopup'),'dialog');
});

test('actual atmosphere artwork exposes loading, error and a separate image retry without choosing a scene',()=>{
 const {document}=fixture('<body><div class="atmosphere-choices"></div></body>');
 const imageNode=parse(atmosphere,{ecmaVersion:'latest',sourceType:'module'}).body.flatMap(n=>n.declarations||[]).find(n=>n.id.name==='imageLabel').init;
 const imageLabel=new Function('t','SCENE_UI','return '+atmosphere.slice(imageNode.start,imageNode.end))(id=>id,'reader.atmosphere.');
 const loop=parse(atmosphere,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ForOfStatement'&&atmosphere.slice(n.start,n.end).startsWith('for(const scene of atmospheres)'));
 let choices=0;
 new Function('document','atmospheres','SCENE_UI','t','listen','choose','dialog','imageLabel','sceneNode',atmosphere.slice(loop.start,loop.end))(document,[{id:'forest',image:'/forest.jpg'}],'reader.atmosphere.',id=>id,(n,k,fn)=>n.addEventListener(k,fn),()=>choices++,document,imageLabel,new Function('document',declaration(atmosphere,'sceneNode')+';return sceneNode;')(document));
 const choice=document.querySelector('.atmosphere-choice'),image=choice.querySelector('img'),retry=document.querySelector('.atmosphere-image-retry');
 assert.equal(choice.dataset.imageState,'loading');assert.equal(choice.querySelector('.atmosphere-image-status').hidden,false);
 image.dispatchEvent(new Event('error'));assert.equal(choice.dataset.imageState,'error');assert.equal(choice.querySelector('.atmosphere-image-status').textContent,'reader.atmosphere.imageError');assert.equal(retry.hidden,false);
 retry.dispatchEvent(new Event('click'));assert.equal(choice.dataset.imageState,'loading');assert.equal(choices,0);assert.match(image.src,/\/forest.jpg\?retry=/);
 image.naturalWidth=100;image.dispatchEvent(new Event('load'));assert.equal(choice.dataset.imageState,'ready');assert.equal(choice.querySelector('.atmosphere-image-status').hidden,true);assert.equal(retry.hidden,true);
 choice.dispatchEvent(new Event('click'));assert.equal(choices,1);
});
