import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createParallelPair} from '../app/parallel-reading.mjs';

class Element extends EventTarget{
  constructor(){super();this.children=[];this.attributes=new Map();this.dataset={};this.hidden=false;this.inert=false;this.classes=new Set();this.classList={contains:name=>this.classes.has(name),toggle:(name,active)=>active?this.classes.add(name):this.classes.delete(name)};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name);}
  querySelector(){return this.firstControl||null;}
  focus(){this.focused=true;}
}
function fixture(){
  const document=new EventTarget(),nodes=new Map(['reading-header','exit-focus','focus-fullscreen','enter-focus','immersive-reading'].map(id=>[id,new Element()]));
  Object.assign(document,{body:new Element(),documentElement:new Element(),getElementById:id=>nodes.get(id),createElement:()=>new Element(),querySelector:()=>null,fullscreenEnabled:true,fullscreenElement:null});
  let requests=0;document.documentElement.requestFullscreen=async()=>{requests++;document.fullscreenElement=document.documentElement;document.dispatchEvent(new Event('fullscreenchange'));};
  document.exitFullscreen=async()=>{document.fullscreenElement=null;document.dispatchEvent(new Event('fullscreenchange'));};
  return {document,nodes,requests:()=>requests};
}

test('reading opens immersive before JavaScript and bilingual labels only describe accessible groups',async()=>{
  const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');assert.ok(/<body[^>]*class="is-focused"/.test(html),'first paint must already be immersive');
  const {document}=fixture(),layers=[{kind:'original',label:'原文',text:'Source.'},{kind:'translation',label:'直译',text:'译文。'}];
  const pair=createParallelPair({document,layers,variant:'literal',passageId:'p1',prose:layer=>Object.assign(new Element(),{textContent:layer.text})});
  assert.equal(pair.children[0].getAttribute('aria-label'),'原文');assert.equal(pair.children[1].getAttribute('aria-label'),'直译');
  assert.equal(pair.children.some(column=>column.children.some(node=>node.className==='pair-label')),false);
});

test('tool visibility and browser fullscreen are independent, including a browser-initiated exit',async()=>{
  const {mountReaderImmersion}=await import('../app/reader-immersion.mjs').catch(()=>({}));assert.equal(typeof mountReaderImmersion,'function');
  const {document,nodes,requests}=fixture(),reader=mountReaderImmersion({document});
  const firstControl=new Element();nodes.get('reading-header').firstControl=firstControl;
  assert.equal(document.body.classList.contains('is-focused'),true);assert.equal(nodes.get('reading-header').inert,true);assert.equal(requests(),0);
  reader.toggleTools();assert.equal(nodes.get('reading-header').inert,false);assert.equal(document.body.dataset.readingTools,'open');
  assert.equal(firstControl.focused,true,'expanded navigation must be reachable in forward tab order');
  await reader.toggleFullscreen();assert.equal(requests(),1);assert.equal(document.body.dataset.fullscreen,'true');assert.equal(nodes.get('reading-header').inert,true);
  reader.toggleTools();assert.equal(document.fullscreenElement,document.documentElement,'opening navigation must keep fullscreen');
  document.fullscreenElement=null;document.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(document.body.dataset.fullscreen,'false');assert.equal(document.body.classList.contains('is-focused'),true);assert.equal(nodes.get('enter-focus').getAttribute('aria-label'),'全屏阅读');
  reader.setFocused(false);assert.equal(nodes.get('reading-header').inert,false);
});

test('a rejected fullscreen request keeps immersion and announces an honest fallback',async()=>{
  const {mountReaderImmersion}=await import('../app/reader-immersion.mjs').catch(()=>({}));assert.equal(typeof mountReaderImmersion,'function');
  const {document}=fixture(),messages=[];document.documentElement.requestFullscreen=async()=>{throw Error('Denied');};
  const reader=mountReaderImmersion({document,announce:text=>messages.push(text)});
  assert.equal(await reader.toggleFullscreen(),false);assert.equal(document.body.classList.contains('is-focused'),true);assert.equal(document.body.dataset.fullscreen,'false');assert.match(messages[0],/沉浸阅读/);
});

test('nonmodal reading chat leaves page tool dismissal usable without stealing chat interactions',async()=>{
  const {mountReaderImmersion}=await import('../app/reader-immersion.mjs'),{document}=fixture();
  document.querySelector=selector=>selector.includes(':not(.library-chat-dialog)')?null:{open:true};
  const reader=mountReaderImmersion({document});reader.toggleTools();
  const outside=new Event('pointerdown');Object.defineProperty(outside,'target',{value:{closest:()=>null}});document.dispatchEvent(outside);
  assert.equal(document.body.dataset.readingTools,'closed');
  reader.toggleTools();const inside=new Event('pointerdown');Object.defineProperty(inside,'target',{value:{closest:()=>({tagName:'DIALOG'})}});document.dispatchEvent(inside);
  assert.equal(document.body.dataset.readingTools,'open');
});

test('immersive reading keeps the chapter heading and side tools quiet by default',async()=>{
  const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
  assert.match(html,/<body[^>]*data-reading-tools="closed"/,'the side reading-tools panel starts collapsed');
  assert.match(html,/id="reading-tools-panel"[^>]*aria-hidden="true"[^>]*inert/,'the panel is inert and hidden until opened');
  const heading=/<header class="chapter-heading"[\s\S]*?<\/header>/.exec(html)?.[0];assert.ok(heading);assert.equal(heading.includes('<button'),false,'chapter content keeps no standalone tool control');
  assert.equal(html.split('id="listen-chapter"').length-1,1,'the single listen entry stays in the collapsible panel');
  assert.match(html,/id="open-chapter"[^>]*disabled/,'the chapter chooser is inert until the book is ready');
});

// GET-184: the floating immersion/fullscreen pair is gone; explicit show/close
// hooks drive the revealed header and fullscreen failure returns to the pill.
test('immersion exposes show and close hooks and no floating control remains in the reader shell',async()=>{
  const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
  assert.equal(html.includes('id="exit-focus"'),false,'the floating tools entry is removed');
  assert.equal(html.includes('id="focus-fullscreen"'),false,'the floating fullscreen control is removed');
  assert.equal(html.includes('class="focus-actions"'),false);
  assert.match(html,/id="reading-tools-trigger"/,'the reading pill is the sole floating entry');
  const {mountReaderImmersion}=await import('../app/reader-immersion.mjs');
  const {document,nodes}=fixture(),reader=mountReaderImmersion({document});
  reader.showTools();assert.equal(document.body.dataset.readingTools,'open');assert.equal(nodes.get('reading-header').inert,false);
  reader.closeTools();assert.equal(document.body.dataset.readingTools,'closed');assert.equal(nodes.get('reading-header').inert,true);
});

test('a failed fullscreen request returns focus to the visible pill fallback',async()=>{
  const {mountReaderImmersion}=await import('../app/reader-immersion.mjs');
  const {document,nodes}=fixture();document.documentElement.requestFullscreen=async()=>{throw Error('Denied');};
  const pill=new Element();nodes.set('reading-tools-trigger',pill);
  const reader=mountReaderImmersion({document,announce(){},focusReturn:()=>pill});
  nodes.get('enter-focus').focus();await reader.toggleFullscreen();
  assert.equal(pill.focused,true,'fullscreen failure restores the visible pill, not a removed floating control');
});
