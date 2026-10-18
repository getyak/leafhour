import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderTools,readerTools} from '../app/reader-tools.mjs';

// One coordinator over the single pill: one click handler, one conceal timer,
// both reader surfaces, explicit chat integration seams.
class Element extends EventTarget {
  constructor(id=''){super();this.id=id;this.dataset={};this.attributes=new Map();this.classList={_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},toggle(c,on){on?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}};this.inert=false;this.hidden=false;this.textContent='';this.title='';this.children=[];this.listeners=new Map();}
  addEventListener(name,handler,options){if(!this.listeners.has(name))this.listeners.set(name,0);this.listeners.set(name,this.listeners.get(name)+1);super.addEventListener(name,handler,options);}
  setAttribute(key,value){this.attributes.set(key,value);}
  getAttribute(key){return this.attributes.get(key);}
  append(...nodes){this.children.push(...nodes);}
  contains(node){if(node===this)return true;for(const child of this.children){if(child===node||child.contains?.(node))return true;}return false;}
  focus(){this.focused=true;globalThis.document.activeElement=this;}
}
function fixture(){
  const sessionRoot=new Element('reading-session');
  const elements=new Map(['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice','reading-tools-chat-slot'].map(id=>['#'+id,new Element(id)]));
  sessionRoot.querySelector=selector=>elements.get(selector)||null;
  const header=new Element('reading-header');header.querySelector=()=>null;
  const document=new Element('document');document.body=new Element('body');document.body.classList.add('is-focused');
  document.getElementById=id=>id==='reading-header'?header:null;
  document.querySelector=()=>null;document.querySelectorAll=()=>[];
  const immersion={shown:0,closed:0,showTools(){this.shown++;},closeTools(){this.closed++;},setFocusReturn(fn){this.focusReturn=fn;},restoreToolFocus(){this.restored=(this.restored||0)+1;}};
  const previous={document:globalThis.document,observer:globalThis.MutationObserver};
  globalThis.document=document;globalThis.MutationObserver=class{observe(){}};
  return {sessionRoot,elements,header,document,immersion,cleanup:()=>Object.assign(globalThis,previous)};
}
function withTools(run){
  const f=fixture();
  try{return run(f);}finally{f.cleanup();}
}

test('the single pill interaction drives both tools surfaces through one conceal timer',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  withTools(({sessionRoot,elements,immersion})=>{
    const tools=mountReaderTools({sessionRoot,immersion});
    assert.equal(readerTools(),tools);
    assert.equal(elements.get('#reading-tools-trigger').listeners.get('click'),1,'exactly one pill click handler exists');
    elements.get('#reading-tools-trigger').dispatchEvent(new Event('click'));
    assert.equal(tools.toolbar.expanded,true);assert.equal(immersion.shown,1,'revealing tools shows the focused header surface');
    t.mock.timers.tick(5000);
    assert.equal(tools.toolbar.expanded,false);assert.equal(immersion.closed,1,'the one conceal timer closes both surfaces');
    elements.get('#reading-tools-trigger').dispatchEvent(new Event('click'));
    t.mock.timers.tick(5000);assert.equal(immersion.shown,2);assert.equal(immersion.closed,2);
  });
});

test('concealing tools returns focus from the revealed header to the visible pill',()=>{
  withTools(({sessionRoot,elements,header,document,immersion})=>{
    const tools=mountReaderTools({sessionRoot,immersion});
    tools.toolbar.reveal();
    const nav=new Element('nav');header.append(nav);document.activeElement=nav;
    tools.toolbar.conceal();
    assert.equal(immersion.closed,1);
    assert.equal(elements.get('#reading-tools-trigger').focused,true,'focus never stays inside the concealed header');
  });
});

test('fullscreen failure restoration targets the visible pill through the reader wiring seam',async()=>{
  const f=compositionFixture();
  try{
    // The exact production wiring app/reader.js uses: immersion resolves its
    // focus fallback through the coordinator's shared pill seam.
    let tools=null;
    const immersion=mountReaderImmersion({document:f.document,focusReturn:()=>tools?.chatIntegration?.companionAnchor});
    tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    f.document.documentElement.requestFullscreen=async()=>{throw Error('Denied');};
    await immersion.toggleFullscreen();
    assert.equal(f.elements.get('#reading-tools-trigger').focused,true,'fullscreen failure restores the visible pill');
    tools.toolbar.conceal();
  }finally{await Promise.resolve();f.cleanup();}
});

test('injected chat integration keeps trigger, anchor, focus and unread seams separate',()=>{
  withTools(({sessionRoot,elements,immersion,document})=>{
    const tools=mountReaderTools({sessionRoot,immersion});
    const chat=tools.chatIntegration;
    assert.equal(chat.triggerHost,elements.get('#reading-tools-chat-slot'));
    assert.equal(chat.companionAnchor,elements.get('#reading-tools-trigger'));
    assert.equal(chat.companionAnchor.getAttribute('aria-expanded'),'false','pill ARIA stays coordinator-owned');
    chat.onUnread(true);
    const pill=elements.get('#reading-tools-trigger');
    assert.equal(pill.classList.contains('has-companion-message'),true,'unread presentation is owned by the coordinator');
    assert.match(pill.getAttribute('aria-description')||'',/陪读/);
    chat.onUnread(false);assert.equal(pill.classList.contains('has-companion-message'),false);
    tools.toolbar.reveal();chat.focusReturn();
    assert.equal(pill.focused,true,'the focus callback returns to the visible pill');
    tools.toolbar.reveal();chat.onOpen();
    assert.equal(tools.toolbar.expanded,false,'opening chat hands focus over and closes tools');
    assert.equal(pill.getAttribute('aria-expanded'),'false');
    assert.equal(immersion.closed>=1,true);
    assert.equal(document.body.classList.contains('is-focused'),true);
  });
});

test('control mode follows the reader focus layout for the pill label',()=>{
  withTools(({sessionRoot,elements,document,immersion})=>{
    const tools=mountReaderTools({sessionRoot,immersion});
    assert.match(elements.get('#reading-tools-trigger').getAttribute('aria-label'),/导航/,'first paint is focused reading');
    document.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused:false}}));
    assert.doesNotMatch(elements.get('#reading-tools-trigger').getAttribute('aria-label'),/导航/);
    document.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused:true}}));
    assert.match(elements.get('#reading-tools-trigger').getAttribute('aria-label'),/导航/);
  });
});

// ---- real composition: mountReaderTools + mountReadingToolbar + mountReaderImmersion ----
import {mountReaderImmersion} from '../app/reader-immersion.mjs';

function compositionFixture(){
  const sessionRoot=new Element('reading-session');
  const elements=new Map(['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice','reading-tools-chat-slot'].map(id=>['#'+id,new Element(id)]));
  sessionRoot.querySelector=selector=>elements.get(selector)||null;
  const header=new Element('reading-header');
  header.firstControl=null;
  header.querySelector=()=>header.firstControl;
  const headerControl=new Element('enter-focus');headerControl.hidden=false;header.append(headerControl);header.firstControl=headerControl;
  const setting=new Element('immersive-reading');setting.checked=true;
  const nodes=new Map([['reading-header',header],['enter-focus',headerControl],['immersive-reading',setting]]);
  const document=new Element('document');document.body=new Element('body');document.body.classList.add('is-focused');
  document.getElementById=id=>nodes.get(id)||null;
  document.querySelector=()=>null;document.querySelectorAll=()=>[];
  document.documentElement=new Element('html');document.documentElement.requestFullscreen=async()=>{};
  document.fullscreenEnabled=true;document.fullscreenElement=null;
  const previous={document:globalThis.document,observer:globalThis.MutationObserver,CustomEvent:globalThis.CustomEvent};
  globalThis.document=document;
  globalThis.MutationObserver=class{observe(){}};
  globalThis.CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
  return {sessionRoot,elements,header,headerControl,document,cleanup:()=>Object.assign(globalThis,previous)};
}

test('composed tools keep hover reveals from stealing focus while explicit clicks may focus',async()=>{
  const f=compositionFixture();
  try{
    const immersion=mountReaderImmersion({document:f.document});
    const tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    const activeBefore=f.document.activeElement;
    const hover=new Event('pointerenter');Object.defineProperty(hover,'pointerType',{value:'mouse'});
    f.elements.get('#reading-tools-trigger').dispatchEvent(hover);
    assert.equal(tools.toolbar.expanded,true,'hover preview reveals the tools');
    assert.equal(f.document.activeElement,activeBefore,'hover reveal never moves activeElement');
    assert.equal(f.document.body.dataset.readingTools,'open');
    tools.toolbar.conceal();
    f.elements.get('#reading-tools-trigger').dispatchEvent(new Event('click'));
    assert.equal(tools.toolbar.expanded,true);
    assert.equal(f.document.activeElement,f.headerControl,'an explicit click may move focus into the revealed header');
    tools.toolbar.conceal();
  }finally{await Promise.resolve();f.cleanup();}
});

test('composed tools hold concealment while the focused header is hovered or focused',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=compositionFixture();
  try{
    const immersion=mountReaderImmersion({document:f.document});
    const tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    tools.toolbar.reveal();
    const hover=new Event('pointerenter');Object.defineProperty(hover,'pointerType',{value:'mouse'});
    f.header.dispatchEvent(hover);
    t.mock.timers.tick(10000);
    assert.equal(tools.toolbar.expanded,true,'header hover holds the single conceal timer');
    const leave=new Event('pointerleave');Object.defineProperty(leave,'pointerType',{value:'mouse'});
    f.header.dispatchEvent(leave);
    t.mock.timers.tick(5000);assert.equal(tools.toolbar.expanded,false);
    tools.toolbar.reveal();
    f.header.dispatchEvent(new Event('focusin'));
    f.document.activeElement=f.headerControl;
    t.mock.timers.tick(10000);
    assert.equal(tools.toolbar.expanded,true,'header focus holds the single conceal timer');
    assert.equal(f.header.inert,false,'header targets stay operable while held');
    f.header.dispatchEvent(new Event('focusout'));
    f.document.activeElement=f.document.body;
    await Promise.resolve();t.mock.timers.tick(5000);
    assert.equal(tools.toolbar.expanded,false);
  }finally{await Promise.resolve();f.cleanup();}
});
