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
  reader.toggleTools();assert.equal(nodes.get('reading-header').inert,false);assert.equal(nodes.get('exit-focus').getAttribute('aria-expanded'),'true');
  assert.equal(firstControl.focused,true,'expanded navigation must be reachable in forward tab order');
  await reader.toggleFullscreen();assert.equal(requests(),1);assert.equal(document.body.dataset.fullscreen,'true');assert.equal(nodes.get('reading-header').inert,true);
  reader.toggleTools();assert.equal(document.fullscreenElement,document.documentElement,'opening navigation must keep fullscreen');
  document.fullscreenElement=null;document.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(document.body.dataset.fullscreen,'false');assert.equal(document.body.classList.contains('is-focused'),true);assert.equal(nodes.get('focus-fullscreen').getAttribute('aria-label'),'全屏阅读');
  reader.setFocused(false);assert.equal(nodes.get('reading-header').inert,false);assert.equal(nodes.get('exit-focus').hidden,true);
});

test('a rejected fullscreen request keeps immersion and announces an honest fallback',async()=>{
  const {mountReaderImmersion}=await import('../app/reader-immersion.mjs').catch(()=>({}));assert.equal(typeof mountReaderImmersion,'function');
  const {document}=fixture(),messages=[];document.documentElement.requestFullscreen=async()=>{throw Error('Denied');};
  const reader=mountReaderImmersion({document,announce:text=>messages.push(text)});
  assert.equal(await reader.toggleFullscreen(),false);assert.equal(document.body.classList.contains('is-focused'),true);assert.equal(document.body.dataset.fullscreen,'false');assert.match(messages[0],/沉浸阅读/);
});
