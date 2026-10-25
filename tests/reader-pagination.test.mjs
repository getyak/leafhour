import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAppearance,openingReadingPreferences} from '../app/reading-preferences.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
const pagination=()=>import('../app/reader-pagination.mjs').catch(()=>({}));
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});

test('turning spreads includes the gutter and never creates a blank final spread',async()=>{
  const {pageGeometry}=await pagination();assert.equal(typeof pageGeometry,'function');
  assert.deepEqual(pageGeometry({width:1000,scrollWidth:2600,gap:40,columns:2}),{step:1040,count:3});
  assert.deepEqual(pageGeometry({width:500,scrollWidth:1580,gap:40,columns:1}),{step:540,count:3});
  assert.deepEqual(pageGeometry({width:1000,scrollWidth:1000.2,gap:40,columns:2}),{step:1040,count:1});
});

test('a paragraph spanning pages keeps its fragment when the page shape changes',async()=>{
  const {fragmentProgress,fragmentIndex}=await pagination();assert.equal(typeof fragmentProgress,'function');
  const fragments=[{height:300},{height:600},{height:200}];
  const progress=fragmentProgress(fragments,1);
  assert.equal(progress,300/1100);assert.equal(fragmentIndex(fragments,progress),1);
  assert.equal(fragmentIndex([{height:200},{height:200},{height:200},{height:200},{height:300}],progress),1);
  assert.equal(fragmentIndex(fragments,1),2);
});

test('page shortcuts leave editing, text selections, controls and modified shortcuts alone',async()=>{
  const {pageKeyDirection}=await pagination();assert.equal(typeof pageKeyDirection,'function');
  const event={key:'ArrowRight',target:{closest:()=>null},preventDefault(){}};
  assert.equal(pageKeyDirection(event),1);assert.equal(pageKeyDirection({...event,key:'ArrowLeft'}),-1);
  for(const patch of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{defaultPrevented:true},{target:{isContentEditable:true}},{target:{closest:()=>({})}}])assert.equal(pageKeyDirection({...event,...patch}),0);
  assert.equal(pageKeyDirection(event,{selection:'selected words'}),0);assert.equal(pageKeyDirection(event,{blocked:true}),0);
});

test('page layout survives reopening and invalid imported layouts are rejected',()=>{
  assert.equal(openingReadingPreferences({pageLayout:'spread',mode:'zh'}).pageLayout,'spread');
  assert.equal(normalizeAppearance({}).pageLayout,'scroll');
  assert.equal(normalizeAppearance({pageLayout:'unknown'}).pageLayout,'scroll');
  assert.throws(()=>normalizeAppearance({pageLayout:'unknown'},true));
});

test('restoring a later page moves the viewport and retains only the reading anchor across reflow',async()=>{
  const {mountReaderPagination}=await pagination();assert.equal(typeof mountReaderPagination,'function');
  class Element extends EventTarget{constructor(){super();this.style={};this.dataset={};this.hidden=false;this.scrollLeft=0;this.clientWidth=1000;}focus(){}}
  const ids=['reading-pages','chapter-text','page-end','page-turner','page-previous','page-next','page-position','page-layout','page-layout-setting','page-layout-hint','book-page'];
  const nodes=new Map(ids.map(id=>[id,new Element()])),viewport=nodes.get('reading-pages'),text=nodes.get('chapter-text');
  viewport.getBoundingClientRect=()=>({left:0,right:viewport.clientWidth,top:100,bottom:600});text.scrollWidth=5160;
  let gap=40,pitch=1040,geometryReads=0;const passages=Array.from({length:5},(_,i)=>{const node=new Element();node.dataset.id='p'+i;node.getClientRects=()=>[{left:i*pitch-viewport.scrollLeft,right:i*pitch-viewport.scrollLeft+450,top:100,bottom:400,height:300}];nodes.set('p'+i,node);return node;});
  text.querySelectorAll=()=>passages;text.contains=node=>passages.includes(node);
  let resized,frame;const document=Object.assign(new EventTarget(),{body:{dataset:{}},activeElement:null,getElementById:id=>nodes.get(id),defaultView:{getComputedStyle:()=>{geometryReads++;return {columnGap:String(gap),columnCount:'2'};},getSelection:()=>'',scrollTo(){},cancelAnimationFrame(){},requestAnimationFrame:callback=>{frame=callback;},ResizeObserver:class{constructor(callback){resized=callback;}observe(){}}}});
  let turns=0;const pages=mountReaderPagination({document,onTurn:()=>turns++});pages.update({pageLayout:'spread',mode:'en'});
  pages.restore({passageId:'p2',offset:100,font:18,mode:'zh'});
  assert.equal(viewport.scrollLeft,2080);assert.equal(nodes.get('page-position').textContent,'双页 · 3 / 5');
  assert.deepEqual(pages.anchor(),{passageId:'p2',offset:100});
  viewport.clientWidth=500;pitch=540;text.scrollWidth=2660;resized();frame();
  assert.equal(viewport.scrollLeft,1080);assert.equal(pages.anchor().passageId,'p2');
  resized();const staleResize=frame;
  nodes.get('page-next').dispatchEvent(new Event('click'));
  staleResize();
  assert.equal(viewport.scrollLeft,1620);assert.equal(pages.anchor().passageId,'p3');
  resized();const oldNavigationResize=frame;document.dispatchEvent(new Event('reader:jump'));viewport.scrollLeft=0;oldNavigationResize();assert.equal(viewport.scrollLeft,0,'an older resize cannot rewind a new navigation');
  pages.restore({passageId:'p4'});assert.equal(pages.anchor().offset,100);
  viewport.scrollLeft=540;passages[1].matches=()=>true;
  const focus=new Event('focusin');Object.defineProperty(focus,'target',{value:passages[1]});text.dispatchEvent(focus);
  assert.equal(pages.anchor().passageId,'p1');assert.equal(turns,2);
  passages[1].getClientRects=()=>[0,540,1080].map(left=>({left:left-viewport.scrollLeft,right:left-viewport.scrollLeft+450,top:100,bottom:400,height:300}));
  text.dispatchEvent(focus);
  assert.equal(viewport.scrollLeft,540);assert.equal(pages.anchor().withinParagraph,1/3);
  assert.equal(typeof pages.revealRect,'function');pages.revealRect({left:550,top:150},'p1');
  assert.equal(viewport.scrollLeft,1080);assert.equal(pages.anchor().withinParagraph,2/3);
  const anchor=pages.anchor(),reads=geometryReads,turnCount=turns,layout=nodes.get('page-layout').value;
  await requestUiRoute('en');assert.equal(nodes.get('page-position').textContent,'Two pages · 3 / 5');
  await requestUiRoute('ja');assert.equal(nodes.get('page-position').textContent,'見開き · 3 / 5');
  await requestUiRoute('zh-Hant');assert.equal(nodes.get('page-position').textContent,'雙頁 · 3 / 5');
  assert.equal(geometryReads,reads,'locale must not measure or reflow the chapter');assert.equal(turns,turnCount);
  assert.deepEqual(pages.anchor(),anchor);assert.equal(viewport.scrollLeft,1080);assert.equal(nodes.get('page-layout').value,layout);
  pages.unmount();const label=nodes.get('page-position').textContent;await requestUiRoute('en');assert.equal(nodes.get('page-position').textContent,label);
  const beforeRemount=turns;let replacementTurns=0;
  const replacement=mountReaderPagination({document,onTurn:()=>replacementTurns++});replacement.update({pageLayout:'spread',mode:'en'});
  nodes.get('page-next').dispatchEvent(new Event('click'));assert.equal(replacementTurns,1);assert.equal(turns,beforeRemount,'the unmounted owner cannot turn or save progress again');
  replacement.unmount();
});
