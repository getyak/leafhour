import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadingToolbarState,mountReadingToolbar} from '../app/reading-toolbar.mjs';

test('reading tools start tucked away and return there after leaving them idle', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  assert.equal(toolbar.expanded, false);
  toolbar.reveal();
  assert.equal(toolbar.expanded, true);
  t.mock.timers.tick(4999);
  assert.equal(toolbar.expanded, true);
  t.mock.timers.tick(1);
  assert.equal(toolbar.expanded, false);
});

test('pointer and keyboard holds independently protect controls from disappearing', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  toolbar.reveal();
  toolbar.hold('pointer', true);
  toolbar.hold('keyboard', true);
  t.mock.timers.tick(10000);
  toolbar.hold('pointer', false);
  t.mock.timers.tick(10000);
  assert.equal(toolbar.expanded, true);
  toolbar.hold('keyboard', false);
  t.mock.timers.tick(5000);
  assert.equal(toolbar.expanded, false);
});

test('closing and reopening cancels the earlier disappearance timer', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  toolbar.reveal();
  t.mock.timers.tick(4000);
  toolbar.conceal();
  toolbar.reveal();
  t.mock.timers.tick(1000);
  assert.equal(toolbar.expanded, true);
  t.mock.timers.tick(4000);
  assert.equal(toolbar.expanded, false);
});

test('a dialog holds the open tools but never opens tucked-away controls on its own', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const toolbar = createReadingToolbarState();
  toolbar.hold('dialog', true);
  assert.equal(toolbar.expanded, false);
  toolbar.reveal();
  t.mock.timers.tick(10000);
  assert.equal(toolbar.expanded, true);
  toolbar.conceal();
  toolbar.hold('dialog', false);
  t.mock.timers.tick(10000);
  assert.equal(toolbar.expanded, false);
});

test('a dialog added after mounting keeps its sidebar opener available until it closes',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  class Element extends EventTarget {
    dataset={}; attributes=new Map(); inert=false; textContent=''; title='';
    setAttribute(key,value){this.attributes.set(key,value);}
    contains(){return false;}
    focus(){}
  }
  const root=new Element(),body=new Element(),elements=new Map(['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice'].map(id=>['#'+id,new Element()]));root.querySelector=id=>elements.get(id);
  let dialogOpen=false;const document=new Element();document.body=body;document.querySelector=()=>dialogOpen?{}:null;document.querySelectorAll=()=>[];
  const observers=[];class Observer {constructor(callback){this.callback=callback;}observe(target,options){observers.push({target,options,callback:this.callback});}}
  const oldDocument=globalThis.document,oldObserver=globalThis.MutationObserver;globalThis.document=document;globalThis.MutationObserver=Observer;
  const mutation=()=>{for(const observer of observers)if(observer.target===body&&observer.options.childList&&observer.options.subtree)observer.callback([{type:'childList'}]);};
  try{
    mountReadingToolbar(root);elements.get('#reading-tools-trigger').dispatchEvent(new Event('click'));assert.equal(root.dataset.expanded,'true');
    dialogOpen=true;mutation();t.mock.timers.tick(6000);assert.equal(root.dataset.expanded,'true','late-created audio dialog must hold its actual opener');assert.equal(elements.get('#reading-tools-panel').inert,false);
    dialogOpen=false;mutation();t.mock.timers.tick(4999);assert.equal(root.dataset.expanded,'true');t.mock.timers.tick(1);assert.equal(root.dataset.expanded,'false');
    dialogOpen=true;mutation();t.mock.timers.tick(6000);assert.equal(root.dataset.expanded,'false','a dialog never reveals a previously closed panel');
  }finally{globalThis.document=oldDocument;globalThis.MutationObserver=oldObserver;}
});
