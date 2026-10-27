import test from 'node:test';
import assert from 'node:assert/strict';
import mountReaderPageSurface from '../app/reader-page-surface.mjs';

class Element extends EventTarget{
  constructor(){super();this.children=[];this.attrs=new Map();this.style={};this.clientWidth=640;this.handlers=new Map();}
  addEventListener(name,fn,options){this.handlers.set(name,[...(this.handlers.get(name)||[]),fn]);super.addEventListener(name,fn,options);}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  setAttribute(key,value){this.attrs.set(key,value);}
  removeAttribute(key){this.attrs.delete(key);}
  setPointerCapture(id){this.capture=id;}
  hasPointerCapture(id){return this.capture===id;}
  releasePointerCapture(){this.capture=null;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
}
function fixture({boundary=false,reduced=false}={}){
  const host=new Element(),viewport=new Element(),text={cloneNode:()=>assert.fail('fallback must not clone text'),querySelectorAll:()=>[],textContent:'x'.repeat(230000)};host.append(viewport);
  let frames=0;const commits=[],provenance=[],view=Object.assign(new EventTarget(),{getSelection:()=>'',matchMedia:()=>({matches:reduced}),requestAnimationFrame:()=>{frames++;},cancelAnimationFrame(){},performance:{now:()=>1}});
  const document=Object.assign(new EventTarget(),{hidden:false,defaultView:view,createElement:()=>new Element()});
  const surface=mountReaderPageSurface({document,viewport,text,getGeometry:()=>({active:true,page:0,count:boundary?1:3,columns:1,gap:40,step:680,previous:false,next:true}),onTurn:(d,source)=>{commits.push(d);provenance.push(source?.trusted===true);}});
  const handle=host.children.find(n=>n.className==='paper-turn-handle is-next');
  function event(type,x,time,{trusted=false}={}){if(trusted){for(const fn of handle.handlers.get(type)||[])fn({type,isTrusted:true,button:0,isPrimary:true,pointerId:7,clientX:x,timeStamp:time,preventDefault(){}});return;}const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,isPrimary:true,pointerId:7,clientX:x});Object.defineProperty(e,'timeStamp',{value:time});handle.dispatchEvent(e);}
  return {surface,commits,provenance,event,get frames(){return frames;}};
}
test('a page-edge drag still commits instantly when a chapter is too large to snapshot',()=>{
  const f=fixture();f.event('pointerdown',620,1);f.event('pointermove',180,17);f.event('pointerup',180,33);assert.deepEqual(f.commits,[1]);assert.equal(f.frames,0);f.surface.dispose();
});
test('the same drag reaches the existing chapter-boundary owner without inventing a preview',()=>{
  const f=fixture({boundary:true});f.event('pointerdown',620,1);f.event('pointermove',180,17);f.event('pointerup',180,33);assert.deepEqual(f.commits,[1]);assert.equal(f.frames,0);f.surface.dispose();
});
test('a short fallback drag returns and reduced motion still accepts a deliberate drag',()=>{
  const f=fixture({reduced:true});f.event('pointerdown',620,1);f.event('pointermove',610,17);f.event('pointerup',610,200);assert.deepEqual(f.commits,[]);f.event('pointerdown',620,300);f.event('pointermove',180,316);f.event('pointerup',180,332);assert.deepEqual(f.commits,[1]);assert.equal(f.frames,0);f.surface.dispose();
});
test('successful trusted drags retain provenance, cancelled drags and programmatic flips do not create it',()=>{
  const f=fixture({reduced:true});f.event('pointerdown',620,1,{trusted:true});f.event('pointermove',610,17,{trusted:true});f.event('pointercancel',610,200,{trusted:true});assert.equal(f.commits.length,0);
  f.event('pointerdown',620,300,{trusted:true});f.event('pointermove',180,316,{trusted:true});f.event('pointerup',180,332,{trusted:true});assert.deepEqual(f.provenance,[true]);f.surface.turn(-1);assert.deepEqual(f.provenance,[true,false]);f.surface.dispose();
});
