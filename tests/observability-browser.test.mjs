import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderObservabilitySignals,findVisibleReaderContent} from '../app/observability.mjs';
import {mountObservabilitySettings} from '../app/observability-settings.mjs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

function fixture(t){
  const document=new EventTarget();document.hidden=false;document.hasFocus=()=>true;
  const window=new EventTarget();window.innerHeight=800;window.innerWidth=400;window.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1'});
  let rect={top:50,bottom:200,left:0,right:300,width:300,height:150},frame=null,clock=0;
  const content={isConnected:true,hidden:false,getClientRects:()=>[rect],getBoundingClientRect:()=>rect,closest:()=>null,contains:target=>target===content};
  const events=[],collector={event:(name,properties)=>events.push({name,properties})};
  const signals=createReaderObservabilitySignals({collector,document,window,getContent:()=>content,now:()=>clock,requestFrame:callback=>{frame=callback;return 1;},cancelFrame:()=>{frame=null;}});
  t.after(()=>signals.dispose());return {signals,events,document,window,content,paint:()=>{const callback=frame;frame=null;callback?.();},setRect:r=>{rect=r;},setTime:value=>{clock=value;}};
}
test('request and actual visible content are separate signals; hidden/offscreen content does not count',t=>{
  const s=fixture(t);s.signals.start();assert.deepEqual(s.events.map(e=>e.name),['reader_open_requested']);
  s.setRect({top:900,bottom:1000,left:0,right:300,width:300,height:100});s.signals.contentReady();s.paint();assert.equal(s.events.length,1);
  s.setRect({top:50,bottom:200,left:0,right:300,width:300,height:150});s.document.hidden=true;s.signals.contentReady();s.paint();assert.equal(s.events.length,1);
  s.document.hidden=false;s.signals.contentReady();s.paint();assert.equal(s.events.at(-1).name,'reader_content_visible');s.signals.contentReady();s.paint();assert.equal(s.events.length,2);
});
test('active reading requires visible foreground content and a trusted reading interaction',t=>{
  const s=fixture(t);s.signals.start();s.signals.interact({isTrusted:true,type:'pointerdown',target:s.content});assert.equal(s.events.length,1);
  s.signals.contentReady();s.paint();s.signals.interact({isTrusted:false,type:'pointerdown',target:s.content});assert.equal(s.events.length,2);
  s.document.hidden=true;s.signals.interact({isTrusted:true,type:'pointerdown',target:s.content});assert.equal(s.events.length,2);
  s.document.hidden=false;s.signals.interact({isTrusted:true,type:'pointerdown',target:{closest:()=>null}});assert.equal(s.events.length,2);
  s.signals.interact({isTrusted:true,type:'pointerdown',target:s.content});assert.equal(s.events.at(-1).name,'reader_active');s.signals.interact({isTrusted:true,type:'wheel',target:s.content});assert.equal(s.events.length,3);
});
test('resume remains pending until actual restoration; missing/skipped/failed never becomes success',t=>{
  const s=fixture(t);s.signals.start();s.signals.contentReady();s.paint();assert.ok(!s.events.some(e=>e.name==='reader_resume_result'));
  s.signals.resumeResult({resume:'restored',restored:false});assert.ok(!s.events.some(e=>e.name==='reader_resume_result'));
  s.signals.resumeResult({resume:'restored',restored:true});assert.equal(s.events.at(-1).properties.resume,'restored');
  s.signals.start();s.signals.contentReady();s.paint();s.signals.resumeResult({resume:'missing'});assert.equal(s.events.at(-1).properties.outcome,'missing');
  s.signals.start();s.signals.contentReady();s.paint();s.signals.resumeResult({resume:'failed'});assert.equal(s.events.at(-1).properties.outcome,'failure');
});
test('dispose and a new opening invalidate old visibility callbacks',t=>{
  const s=fixture(t);s.signals.start();s.signals.contentReady();s.signals.start();s.paint();assert.ok(!s.events.some(e=>e.name==='reader_content_visible'));s.signals.contentReady();s.signals.dispose();s.paint();assert.ok(!s.events.some(e=>e.name==='reader_content_visible'));
});
test('delayed initial consent observes the current opening before current visible content without backdating',t=>{
  const s=fixture(t);let consent=false;const original=s.events.push.bind(s.events);s.events.push=(event)=>consent?original(event):false;
  s.signals.start();s.signals.contentReady();s.paint();assert.equal(s.events.length,0);
  consent=true;s.signals.observeCurrentOpening();assert.deepEqual(s.events.map(event=>event.name),['reader_open_requested']);s.paint();assert.deepEqual(s.events.map(event=>event.name),['reader_open_requested','reader_content_visible']);
  s.signals.observeCurrentOpening();s.paint();assert.equal(s.events.length,2);
});
test('expected access failures and cancellation never become reader fault alerts',t=>{
  const s=fixture(t);s.signals.start();s.signals.loadFailed(Object.assign(Error('PRIVATE'),{status:404}));s.signals.loadFailed(new DOMException('PRIVATE','AbortError'));assert.equal(s.events.length,1);s.signals.loadFailed(new TypeError('PRIVATE'));assert.equal(s.events.at(-1).name,'reader_load_failed');
});
test('a completed current resume is observed after delayed initial consent with the current timestamp',t=>{
  const s=fixture(t);let consent=false;const original=s.events.push.bind(s.events);s.events.push=event=>consent?original(event):false;
  s.signals.start();s.signals.contentReady();s.paint();s.signals.resumeResult({resume:'restored',restored:true});assert.equal(s.events.length,0);
  s.setTime(700);consent=true;s.signals.observeCurrentOpening();s.paint();assert.deepEqual(s.events.map(event=>event.name),['reader_open_requested','reader_content_visible','reader_resume_result']);assert.equal(s.events.at(-1).properties.durationMs,0);assert.equal(s.events.at(-1).properties.resume,'restored');
});
test('a later opt-in and an intervening trusted action never replay the earlier resume',t=>{
  const s=fixture(t);let consent=false;const original=s.events.push.bind(s.events);s.events.push=event=>consent?original(event):false;
  s.signals.start();s.signals.contentReady();s.signals.resumeResult({resume:'restored',restored:true});s.signals.interact({isTrusted:true,type:'pointerdown',target:s.content});consent=true;s.signals.contentReady();s.paint();assert.equal(s.events.length,0);
  s.signals.observeCurrentOpening();s.paint();assert.deepEqual(s.events.map(event=>event.name),['reader_open_requested','reader_content_visible']);
});
test('only a successfully committed trusted page turn counts page controls as active reading',t=>{
  const s=fixture(t);s.signals.start();s.signals.contentReady();s.paint();s.signals.pageTurned({trusted:false});assert.equal(s.events.length,2);
  s.signals.interact({type:'pointerdown',isTrusted:true,target:{closest:()=>({tagName:'BUTTON'})}});assert.equal(s.events.length,2);
  s.document.hidden=true;s.signals.pageTurned({trusted:true});assert.equal(s.events.length,2);s.document.hidden=false;s.signals.pageTurned({trusted:true});assert.equal(s.events.at(-1).name,'reader_active');
});
test('later columns use visible paragraph fragments within the reading viewport',()=>{
  const document={hidden:false},window={innerHeight:800,innerWidth:1200,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
  const passage=rects=>({isConnected:true,getClientRects:()=>rects,getBoundingClientRect:()=>({left:-1200,right:2000,top:100,bottom:400,width:3200,height:300})});
  const hidden=passage([{left:-1000,right:-600,top:100,bottom:400,width:400,height:300}]),shown=passage([{left:200,right:600,top:100,bottom:400,width:400,height:300}]);
  const root={querySelectorAll:()=>[hidden,shown]},viewport={getBoundingClientRect:()=>({left:160,right:900,top:80,bottom:700})};assert.equal(findVisibleReaderContent({root,document,window,viewport}),shown);
});

class Element extends EventTarget{
  constructor(tag,document){super();this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this.classList={add(){},toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);}
}
test('settings keep independent native switches, relabel in place, and fence late owner saves',async t=>{
  const document={createElement:tag=>new Element(tag,document)},root=document.createElement('section');let owner='alice',locale='one',resolveSave,config={enabled:true,analytics:false,diagnostics:true},notify;
  const calls=[],client={loaded:true,config:()=>({...config}),syncOwner(){},refresh:async()=>config,subscribe(fn){notify=fn;return ()=>{};},setConsent(value){calls.push(value);return new Promise(resolve=>{resolveSave=resolve;});}};
  const settings=mountObservabilitySettings({document,root,client,getOwner:()=>owner,t:id=>locale+id});t.after(()=>settings.dispose());await settings.update();
  const controls=settings.controls;assert.equal(controls.analytics.checked,false);assert.equal(controls.diagnostics.checked,true);
  controls.analytics.checked=true;controls.analytics.dispatchEvent(new Event('change'));assert.deepEqual(calls,[{analytics:true,diagnostics:true}]);
  locale='two';settings.updateLabels();assert.equal(settings.controls.analytics,controls.analytics);assert.equal(controls.analytics.checked,true);
  owner='bob';await settings.update();config={enabled:true,analytics:false,diagnostics:false};notify(config);resolveSave({enabled:true,analytics:true,diagnostics:true});await new Promise(setImmediate);assert.equal(controls.analytics.checked,false);
  owner=null;await settings.update();assert.equal(controls.analytics.disabled,true);assert.equal(controls.diagnostics.disabled,true);
});

async function delayedRecordsFixture(){
  const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),start=source.indexOf('async function adoptLoadedRecords('),end=source.indexOf("\nfor(const type of ['pointerdown'",start);
  assert.ok(start>0&&end>start);let finish,restored=false;const reports=[],nodes=new Map();
  const context={loadGeneration:1,recordsPending:true,document:{body:{dataset:{}}},records:{comments:[],questions:[]},selectedBookId:'fixture',readerOwner:()=> 'alice',recordsUnavailable:false,book:{},entryInteracted:false,localStorage:{getItem:()=>null},progressKey:'fixture',recordsPositionUnresolved:false,progressSync:{revision:0,adopt(){}},deferredProgress:false,persistTimer:null,clearTimeout(){},READER_UI:'',state:{},restoringProgress:false,readingBook:{ensure:()=>new Promise(resolve=>{finish=resolve;})},
    mergeLoadedReadingRecords:remote=>remote,resolveReadingPosition:(_book,position)=>position,chooseReadingPosition:({remote})=>remote,openingReadingPreferences:()=>({}),chineseOriginalOnly:()=>false,resumeSummary:()=>null,recoveredPositionNeedsChoice:()=>true,cachePosition(){},renderChapter(){},restoreAnchor(){restored=true;},reportReadingResume:(position,options)=>reports.push({position,options,restored}),readingSignals:{resumeResult:value=>reports.push(value)},announceUi(){},renderPanel(){},dispatchReaderEvent(){},queueReadingFlow(){},persist(){},$:id=>{if(!nodes.has(id))nodes.set(id,{hidden:true});return nodes.get(id);}};
  const adopt=runInNewContext('('+source.slice(start,end)+')',context);return {adopt,context,reports,release:()=>finish(),fresh:{comments:[],questions:[],position:{chapterId:'ch02',passageId:'PRIVATE_ID',revision:1}}};
}
test('the real delayed-record adoption waits for chapter load and anchor restoration before reporting resume',async()=>{
  const s=await delayedRecordsFixture(),pending=s.adopt(s.fresh,{generation:1,explicitEntry:false});assert.equal(s.reports.length,0);s.release();await pending;assert.equal(s.reports.length,1);assert.equal(s.reports[0].restored,true);assert.equal(s.reports[0].position.chapterId,'ch02');
});
test('the real delayed-record adoption reports skipped after user interaction and ignores a stale opening',async()=>{
  const s=await delayedRecordsFixture(),pending=s.adopt(s.fresh,{generation:1,explicitEntry:false});s.context.entryInteracted=true;s.release();await pending;assert.equal(s.reports.length,1);assert.equal(s.reports[0].options.skipped,true);assert.equal(s.reports[0].restored,false);
  const stale=await delayedRecordsFixture();stale.context.loadGeneration=2;await stale.adopt(stale.fresh,{generation:1,explicitEntry:false});assert.equal(stale.reports.length,0);
});
