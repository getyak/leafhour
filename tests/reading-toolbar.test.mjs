import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadingToolbarState,mountReadingToolbar} from '../app/reading-toolbar.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
import {readFile} from 'node:fs/promises';
import {fixture as domFixture} from './annotation-dom-fixture.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});

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
    getAttribute(key){return this.attributes.get(key);}
    contains(){return false;}
    focus(){}
  }
  const root=new Element(),body=new Element(),elements=new Map(['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice'].map(id=>['#'+id,new Element()]));root.querySelector=id=>elements.get(id);
  const dialog={id:'late-audio'};let dialogOpen=false;const document=new Element();document.body=body;document.querySelector=selector=>{if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return dialogOpen?dialog:null;};document.querySelectorAll=()=>dialogOpen?[dialog]:[];
  const opener=elements.get('#reading-tools-trigger');opener.setAttribute('aria-controls','late-audio');root.querySelectorAll=()=>[opener];
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

// GET-184: explicit coordinator hooks over the single toolbar state machine.
test('mountReadingToolbar exposes explicit reveal, conceal, hold and control-mode hooks',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  class Element extends EventTarget {
    dataset={}; attributes=new Map(); inert=false; textContent=''; title='';
    setAttribute(key,value){this.attributes.set(key,value);}
    getAttribute(key){return this.attributes.get(key);}
    contains(){return false;}
    focus(){this.focused=true;}
  }
  const root=new Element(),elements=new Map(['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice'].map(id=>['#'+id,new Element()]));root.querySelector=id=>elements.get(id);
  const document=new Element();document.body=new Element();document.querySelector=()=>null;document.querySelectorAll=()=>[];
  const previous={document:globalThis.document,observer:globalThis.MutationObserver};
  globalThis.document=document;globalThis.MutationObserver=class{observe(){}};
  const changes=[];
  try{
    const toolbar=mountReadingToolbar(root,{onExpandedChange:expanded=>changes.push(expanded)});
    assert.equal(toolbar.expanded,false);
    toolbar.reveal();assert.equal(toolbar.expanded,true);assert.equal(root.dataset.expanded,'true');
    t.mock.timers.tick(6000);assert.equal(toolbar.expanded,false,'the single conceal timer still runs inside the state machine');
    assert.deepEqual(changes,[true,false],'the coordinator sees one expand and one conceal');
    toolbar.reveal();toolbar.hold('pointer',true);t.mock.timers.tick(10000);assert.equal(toolbar.expanded,true);
    toolbar.conceal();assert.equal(toolbar.expanded,false);
    assert.equal(elements.get('#reading-tools-trigger').getAttribute('aria-expanded'),'false');
    toolbar.setControlMode('focused');
    assert.match(elements.get('#reading-tools-trigger').getAttribute('aria-label'),/导航/,'focused control mode names the revealed navigation');
    toolbar.setControlMode('unfocused');
    assert.doesNotMatch(elements.get('#reading-tools-trigger').getAttribute('aria-label'),/导航/);
    assert.deepEqual(changes,[true,false,true,false]);
  }finally{Object.assign(globalThis,previous);}
});

for(const [openerId,dialogId]of [['listen-chapter','audio-dialog'],['manual-reading-open','manual-reading'],['reading-guide-open','reading-guide'],['reading-drafts-open','reading-drafts']])test(openerId+' keeps its real child dialog available without beforetoggle support',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {document}=domFixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8'));
 const callbacks=[],previous=globalThis.MutationObserver;globalThis.MutationObserver=class{constructor(fn){callbacks.push(fn);}observe(){}disconnect(){}};
 let toolbar;
 try{
  toolbar=mountReadingToolbar(document.getElementById('reading-session'),{document,header:document.getElementById('reading-header')});toolbar.reveal(false);
  const opener=document.getElementById(openerId);let dialog=document.getElementById(dialogId);
  if(!dialog){dialog=document.createElement('dialog');dialog.id=dialogId;document.body.append(dialog);}
  opener.focus();dialog.showModal();for(const callback of callbacks)callback();t.mock.timers.tick(6000);
  assert.equal(toolbar.expanded,true,'the actual declared opener, not an unrelated overlay, keeps the parent available');
  dialog.close();for(const callback of callbacks)callback();t.mock.timers.tick(5000);assert.equal(toolbar.expanded,false);
 }finally{toolbar?.unmount();globalThis.MutationObserver=previous;}
});

test('an unrelated dialog cannot hold an idle reading card',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {document}=domFixture('<body><section id="reading-session"><button id="reading-tools-trigger"></button><div id="reading-tools-panel"><button id="reading-tools-close"></button></div><span id="reading-tools-label"></span><p id="reading-tools-notice"></p></section><dialog id="unrelated" open></dialog></body>');
 const previous=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}};
 try{const toolbar=mountReadingToolbar(document.getElementById('reading-session'),{document});toolbar.reveal(false);t.mock.timers.tick(5000);assert.equal(toolbar.expanded,false);toolbar.unmount();}finally{globalThis.MutationObserver=previous;}
});

test('unchanged clock updates preserve the touch target text node',()=>{
 const {document}=domFixture('<body><section id="reading-session"><button id="reading-tools-trigger"><span id="reading-tools-label"></span></button><div id="reading-tools-panel"><button id="reading-tools-close"></button></div><p id="reading-tools-notice"></p></section></body>');
 const previous=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}};let toolbar;
 try{toolbar=mountReadingToolbar(document.getElementById('reading-session'),{document});const label=document.getElementById('reading-tools-label'),text=label.childNodes[0];toolbar.update({status:'idle',attention:false,draftCount:0});assert.ok(label.childNodes[0]===text,'a focus-triggered clock render cannot replace the text under a touch gesture');}finally{toolbar?.unmount();globalThis.MutationObserver=previous;}
});
