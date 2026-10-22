import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';
import {mountReaderHighlights} from '../app/reader-highlights.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8');
// Execute the actual reader owner functions with controlled async boundaries;
// no copied navigation or keyboard implementation is used by this fixture.
const functionSource=name=>{const start=source.indexOf('async function '+name+'('),end=source.indexOf('\nfunction ',start+1);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const mark={id:'mark-one',bookId:'book-one',contentVersion:'version-one',chapterId:'chapter-one',parts:[{passageId:'passage-one',language:'en',variant:'interpretive',start:0,end:6,text:'Quoted'}]};

for(const outcome of ['success','cancelled','failed'])test('a highlight thought waits for '+outcome+' navigation before opening a composer',async()=>{
  const {document}=fixture('<body><div id="chapter-text"></div><button id="show-highlight"></button><p id="highlight-status"></p></body>');
  const navigation=gate(),calls=[];
  const controller=mountReaderHighlights({document,getRecords:()=>({highlights:[mark]}),onSelect:()=>navigation.promise,onNote:()=>calls.push('note'),announce:()=>calls.push('notice')});
  try{
    const row=controller.recordNode(mark);document.body.append(row);row.querySelectorAll('button')[1].dispatchEvent(new Event('click'));
    assert.deepEqual(calls,[],'a composer must not open against the previous selection');
    if(outcome==='failed')navigation.reject(Error('chapter unavailable'));else navigation.resolve(outcome==='success');
    await tick();assert.deepEqual(calls,outcome==='success'?['note']:outcome==='failed'?['notice']:[]);
  }finally{controller.unmount();}
});

test('a disposed highlight owner cannot open a late composer',async()=>{
  const {document}=fixture('<body><div id="chapter-text"></div><button id="show-highlight"></button><p id="highlight-status"></p></body>');
  const navigation=gate();let opened=0;
  const controller=mountReaderHighlights({document,getRecords:()=>({highlights:[mark]}),onSelect:()=>navigation.promise,onNote:()=>opened++,announce(){}});
  const row=controller.recordNode(mark);row.querySelectorAll('button')[1].dispatchEvent(new Event('click'));controller.unmount();navigation.resolve(true);await tick();assert.equal(opened,0);
});

function selectionOwner({ensure=async()=>{},navigate=async()=>true,rendered=true}={}){
  const {document}=fixture('<body><main id="book-page"><div id="passage-one"></div></main><div id="paragraph-tools"></div><button id="show-share"></button></body>');
  const paragraph={id:'passage-one',chapterId:'chapter-one',original:'Quoted text',translations:{}},state={chapterId:rendered?'chapter-one':'other'},calls=[];let active=true;
  const scope={document,state,paragraphMap:new Map([[paragraph.id,paragraph]]),readingNavigation:{begin:()=>()=>active},readingBook:{ensure},highlights:{notify:()=>calls.push('error'),updateTools:()=>{}},closePanel:()=>calls.push('close'),changeChapter:navigate,updateText:()=>calls.push('render'),restoreAnchor:()=>{},choosePassage:()=>calls.push('select'),positionTools:()=>{},proseForPart:()=>null,pagination:{active:false},READER_UI:'reader.b1.',$:id=>document.getElementById(id)};
  const run=new Function(...Object.keys(scope),'let overrides,selectedExcerpt,selectionKind;'+functionSource('selectHighlight')+';return selectHighlight;')(...Object.values(scope));
  return {run,calls,cancel:()=>{active=false;}};
}
test('the actual highlight navigation reports success only after selecting its target',async()=>{
  const owner=selectionOwner();assert.equal(await owner.run(mark),true);assert.deepEqual(owner.calls,['close','render','select']);
});
test('a superseded actual highlight navigation reports cancellation without changing selection',async()=>{
  const waiting=gate(),owner=selectionOwner({ensure:()=>waiting.promise}),work=owner.run(mark);owner.cancel();waiting.resolve();assert.equal(await work,false);assert.deepEqual(owner.calls,[]);
});
test('a failed chapter read reports failure without selecting the old passage',async()=>{
  const owner=selectionOwner({ensure:async()=>{throw Error('offline');}});assert.equal(await owner.run(mark),false);assert.deepEqual(owner.calls,['error']);
});
test('a chapter change that loses navigation ownership cannot report success',async()=>{
  const owner=selectionOwner({rendered:false,navigate:async()=>false});assert.equal(await owner.run(mark),false);assert.equal(owner.calls.includes('select'),false);
});

test('passage note tabs support wrapping arrows, Home and End without consuming modified shortcuts',()=>{
  const {document}=fixture('<body><nav class="panel-tabs"><button data-panel-tab="annotations"></button><button data-panel-tab="comment"></button><button data-panel-tab="question"></button></nav></body>');
  const start=source.indexOf("for(const b of document.querySelectorAll('[data-panel-tab]'))"),end=source.indexOf("\nlisten($('panel-source')",start);assert.ok(start>=0&&end>start);
  const tabs=[...document.querySelectorAll('[data-panel-tab]')];let renders=0;
  const setup=new Function('document','listen','renderPanel','let panelTab="annotations",allRecords=false;'+source.slice(start,end)+';return ()=>({panelTab,allRecords});');
  const state=setup(document,(node,name,handler)=>node.addEventListener(name,handler),()=>{renders++;});
  const press=(target,key,extra={})=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,...extra});target.dispatchEvent(event);return event;};
  for(const [from,key,expected]of [[0,'ArrowRight',1],[1,'ArrowRight',2],[2,'ArrowRight',0],[0,'ArrowLeft',2],[2,'Home',0],[0,'End',2]]){
    tabs[from].focus();const event=press(tabs[from],key);assert.equal(event.defaultPrevented,true);assert.ok(document.activeElement===tabs[expected]);assert.equal(state().panelTab,tabs[expected].dataset.panelTab);
  }
  const count=renders;for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true}]){assert.equal(press(tabs[2],'ArrowLeft',extra).defaultPrevented,false);}
  assert.equal(press(tabs[2],'Tab').defaultPrevented,false);assert.equal(renders,count);
});

test('timer settings follow guest, signed-in and signed-out reading access',async()=>{
  const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8'),timer=await readFile(new URL('../app/reading-session.js',import.meta.url),'utf8'),{document}=fixture(html);
  const start=timer.indexOf('function renderTimeSource('),end=timer.indexOf('\nfunction ',start+1);assert.ok(start>=0&&end>start);
  const render=new Function('$','label','SESSION_UI','manualAction','marks','drafts','storageFailure','manualUi',timer.slice(start,end)+';return renderTimeSource;')(id=>document.getElementById(id),()=>{},'reading.time.',{},{},{},null,{refresh(){}});
  const settings=document.querySelector('.reading-timer-settings'),summary=settings.querySelector('summary');
  render({status:'idle'},false);assert.equal(settings.hidden,true,'guests cannot expand an empty timer settings disclosure');
  render({status:'idle'},true);assert.equal(settings.hidden,false);assert.equal(document.getElementById('reading-time-options').hidden,false);assert.equal(document.getElementById('reading-time-help').hidden,false);
  settings.open=true;render({status:'paused',source:'reader_focus'},false);assert.equal(settings.hidden,true,'sign-out withdraws the entire timer configuration');
  render({status:'idle'},true);assert.equal(settings.hidden,false);assert.ok(settings.querySelector('summary')===summary);assert.equal(settings.id,'reading-timer-settings');
});
