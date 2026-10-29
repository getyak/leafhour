import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';
import {mountReaderImmersion} from '../app/reader-immersion.mjs';
import {mountReaderTools} from '../app/reader-tools.mjs';
import {mountReadingHub} from '../app/reading-hub.mjs';

const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
// Native focus refuses visibility:hidden descendants even though they have
// rectangles. Exercise the actual owners with independently controlled paints.
function setup(t,{hub=true}={}){
 const {document,win}=fixture(html),$=id=>document.getElementById(id),frames=new Map(),timers=new Map(),attempts=[];
 let painted=false,sequence=0;
 win.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};win.cancelAnimationFrame=id=>frames.delete(id);
 win.setTimeout=fn=>{timers.set(++sequence,fn);return sequence;};win.clearTimeout=id=>timers.delete(id);
 win.getComputedStyle=node=>({display:'block',visibility:node===$('reader-top-edge')&&document.body.dataset.readingTools==='open'||!painted&&(node===$('reading-header')||node===$('reading-tools-panel')||$('reading-header').contains(node)||$('reading-tools-panel').contains(node))?'hidden':'visible',opacity:painted?'1':'0'});
 for(const node of document.querySelectorAll('*')){
  let inert=node.hasAttribute('inert');Object.defineProperty(node,'inert',{get:()=>inert,set:value=>{inert=!!value;if(inert)node.setAttribute('inert','');else node.removeAttribute('inert');}});
  const native=node.focus.bind(node);node.focus=()=>{attempts.push(node.id);if(!node.closest('[inert],[hidden]')&&win.getComputedStyle(node).visibility==='visible')native();};
 }
 // The pill is already painted before either navigation surface is revealed.
 const pill=$('reading-tools-trigger');pill.focus=()=>{document.activeElement=pill;};
 const previous={MutationObserver:globalThis.MutationObserver,CustomEvent:globalThis.CustomEvent};
 $('reading-session').hidden=false;$('reading-session').removeAttribute('hidden');
 $('open-toc').disabled=false;$('open-toc').removeAttribute('disabled');
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 globalThis.CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
 document.documentElement.requestFullscreen=async()=>{};
 const immersion=mountReaderImmersion({document}),tools=mountReaderTools({document,sessionRoot:$('reading-session'),immersion});
 const adapter=hub?mountReadingHub({document,panel:$('reading-tools-panel'),toolbar:tools.toolbar}):null;
 t.after(()=>{adapter?.unmount();tools.unmount();immersion.unmount();Object.assign(globalThis,previous);});
 return {document,win,$,pill,tools,immersion,adapter,attempts,frames,timers,
  paint(value=true){painted=value;},
  frame(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();},
  expire(){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();},
  activate(){pill.focus();const event=new Event('click');Object.assign(event,{detail:0});pill.dispatchEvent(event);},
 };
}
test('real hub keyboard activation hands off once after its controls become painted',async t=>{
 const f=setup(t);f.activate();await Promise.resolve();f.frame();
 assert.ok(f.document.activeElement===f.pill,'hidden transition frames cannot accept focus');
 f.paint();f.frame();
 assert.ok(f.document.activeElement===f.$('open-toc'),'the actual moved primary control receives keyboard focus');
 assert.deepEqual(f.attempts,['open-toc'],'the superseded header request must not compete with the hub');
 assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
test('header-only keyboard reveal uses the same painted handoff when the optional hub is unavailable',t=>{
 const f=setup(t,{hub:false});f.pill.focus();f.tools.toolbar.reveal();f.frame();assert.ok(f.document.activeElement===f.pill);
 f.paint();f.frame();
 assert.equal(f.$('reading-header').contains(f.document.activeElement),true);
 assert.ok(f.document.activeElement!==f.pill);assert.equal(f.attempts.length,1);
});
test('top-edge keyboard reveal survives its own native hidden-opener blur, while a newer body focus event cancels it',t=>{
 for(const newerFocus of [false,true]){
  const f=setup(t,{hub:false});f.$('reader-top-edge').focus();f.attempts.length=0;f.tools.toolbar.reveal();
  // The edge disappears as navigation opens. Chromium silently blurs it to
  // body, with no focusin event. Explicit newer focus remains a separate intent.
  f.document.activeElement=f.document.body;
  const blur=new Event('blur');Object.defineProperty(blur,'target',{value:f.$('reader-top-edge')});f.win.dispatchEvent(blur);
  if(newerFocus)f.document.dispatchEvent(new Event('focusin'));
  f.frame();f.paint();f.frame();
  assert.equal(f.$('reading-header').contains(f.document.activeElement),!newerFocus);
  assert.equal(f.attempts.length,newerFocus?0:1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
 }
});
for(const event of ['keydown','pointerdown','beforeinput','compositionstart','wheel','focusin','reader:session-changed'])test('pending hub handoff yields to newer '+event,async t=>{
 const f=setup(t);f.activate();await Promise.resolve();f.document.dispatchEvent(new Event(event));f.paint();f.frame();
 assert.ok(f.document.activeElement===f.pill);assert.deepEqual(f.attempts,[]);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
test('a newer focus owner, conceal/reopen, hidden page, window blur and unmount fence old painted work',async t=>{
 for(const action of ['focus','conceal','hidden','blur','unmount']){
  const f=setup(t);f.activate();await Promise.resolve();
  if(action==='focus')f.document.activeElement=f.$('reading-tools-chat-slot');
  if(action==='conceal'){f.tools.toolbar.conceal();f.tools.toolbar.reveal(false);}
  if(action==='hidden'){f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));f.document.hidden=false;}
  if(action==='blur')f.win.dispatchEvent(new Event('blur'));
  if(action==='unmount')f.adapter.unmount();
  const active=f.document.activeElement;f.attempts.length=0;f.paint();f.frame();
  assert.ok(f.document.activeElement===active,action);assert.deepEqual(f.attempts,[],action);assert.equal(f.frames.size,0,action);assert.equal(f.timers.size,0,action);
 }
});
test('paint wait is bounded and releases its work even when animation frames are suspended',async t=>{
 const f=setup(t);f.activate();await Promise.resolve();f.expire();f.paint();f.frame();
 assert.ok(f.document.activeElement===f.pill);assert.deepEqual(f.attempts,[]);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
