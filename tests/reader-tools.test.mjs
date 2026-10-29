import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderTools,readerTools} from '../app/reader-tools.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});

test('source self-host serves the new tools module and its complete direct dependencies as JavaScript',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'get184-source-assets-'));
  const disabled=async()=>{throw Error('Provider disabled during anonymous asset verification');};
  const server=await createReaderServer({bookPath:path.join(base,'missing.json'),recordsPath:path.join(base,'records.json'),portalDataDir:path.join(base,'portal'),allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null,generator:disabled});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(base,{recursive:true,force:true});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const file of ['reader-tools.mjs','reading-toolbar.mjs','reader-immersion.mjs','reader-conversation.mjs','palette-bootstrap.mjs','command-palette.mjs','palette-library.mjs']){
    const response=await fetch(origin+'/'+file);assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await response.text(),await readFile(new URL('../app/'+file,import.meta.url),'utf8'),file+' must serve exact source bytes');
  }
  const reader=await fetch(origin+'/read?book=alice-wonderland');assert.equal(reader.status,200);assert.match(await reader.text(),/src="\/reader\.js"/);
});

// One coordinator over the single pill: one click handler, one conceal timer,
// both reader surfaces, explicit chat integration seams.
class Element extends EventTarget {
  constructor(id=''){super();this.id=id;this.dataset={};this.attributes=new Map();this.classList={_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},toggle(c,on){on?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}};this.inert=false;this.hidden=false;this.textContent='';this.title='';this.children=[];this.listeners=new Map();}
  addEventListener(name,handler,options){if(!this.listeners.has(name))this.listeners.set(name,0);this.listeners.set(name,this.listeners.get(name)+1);super.addEventListener(name,handler,options);}
  removeEventListener(name,handler,options){this.listeners.set(name,Math.max(0,(this.listeners.get(name)||0)-1));super.removeEventListener(name,handler,options);}
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

test('a disposed primary-surface owner cannot close a replacement reader dialog',()=>withTools(f=>{
 const tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion:f.immersion,document:f.document});let closed=0;
 f.document.querySelectorAll=selector=>selector.startsWith('#settings-dialog')?[{id:'settings-dialog',close(){closed++;}}]:[];
 tools.unmount();tools.chatIntegration.onOpen();assert.equal(closed,0);
}));

test('closing chat restores the quiet reading edge without opening reading tools',t=>withTools(f=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const entry=new Element('chat-entry'),host=f.elements.get('#reading-tools-chat-slot');
  host.querySelector=()=>entry;host.append(entry);f.sessionRoot.append(host);
  const edge=f.elements.get('#reading-tools-trigger');
  const tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion:f.immersion,document:f.document});
  try{
    tools.toolbar.reveal(false);tools.chatIntegration.onOpen();
    assert.equal(tools.toolbar.expanded,false);
    tools.chatIntegration.focusReturn();
    assert.equal(tools.toolbar.expanded,false,'returning to the reading edge leaves tools asleep');
    assert.ok(f.document.activeElement===edge,'focus returns to the actual reading edge');
    assert.equal(f.immersion.shown,1,'closing chat does not introduce a second tools surface');
    t.mock.timers.tick(5000);
    assert.equal(tools.toolbar.expanded,false);
    assert.ok(f.document.activeElement===edge,'idle time keeps focus on the quiet reading edge');
    tools.chatIntegration.focusReturn();
    f.document.dispatchEvent(Object.assign(new Event('keydown'),{key:'Tab'}));
    t.mock.timers.tick(6000);
    assert.equal(tools.toolbar.expanded,false,'keyboard focus does not expand unrelated tools');
    assert.ok(f.document.activeElement===edge,'keyboard activity keeps focus on the actual reading edge');
    f.document.activeElement=null;f.sessionRoot.dispatchEvent(new Event('focusout'));
  }finally{tools.unmount();}
}));

test('locale preserves the sole conceal deadline, unread state, focus and held tools',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();let tools;
  try{
    tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion:f.immersion,document:f.document});
    const pill=f.elements.get('#reading-tools-trigger'),label=f.elements.get('#reading-tools-label'),notice=f.elements.get('#reading-tools-notice');
    tools.toolbar.update({status:'paused',attention:true,draftCount:2});tools.chatIntegration.onUnread(true);tools.toolbar.reveal(false);
    t.mock.timers.tick(4000);const focus=f.document.activeElement;
    await requestUiRoute('en');assert.equal(label.textContent,'Unsaved');assert.match(notice.textContent,/reading records/);
    assert.equal(f.elements.get('#reading-tools-chat-slot').getAttribute('aria-description'),'A reading companion message');assert.match(pill.getAttribute('aria-label'),/2 local drafts/);
    assert.equal(f.document.activeElement,focus);assert.equal(tools.toolbar.expanded,true);assert.equal(f.immersion.shown,1);
    t.mock.timers.tick(999);assert.equal(tools.toolbar.expanded,true);t.mock.timers.tick(1);assert.equal(tools.toolbar.expanded,false,'changing language cannot restart concealment');
    tools.toolbar.reveal(false);tools.toolbar.hold('pointer',true);
    await requestUiRoute('ja');assert.equal(label.textContent,'未保存');assert.equal(f.elements.get('#reading-tools-chat-slot').getAttribute('aria-description'),'読書の伴走メッセージがあります');
    t.mock.timers.tick(10000);assert.equal(tools.toolbar.expanded,true,'changing language cannot release pointer hold');
    tools.toolbar.hold('pointer',false);t.mock.timers.tick(5000);assert.equal(tools.toolbar.expanded,false);
    await requestUiRoute('zh-Hant');assert.equal(label.textContent,'待儲存');
    tools.unmount();const detached=label.textContent;await requestUiRoute('en');assert.equal(label.textContent,detached);
  }finally{tools?.toolbar.conceal();f.cleanup();}
});

test('unmount releases tools listeners and stale unread callbacks cannot change a replacement pill',()=>{
  const f=fixture();let next;
  try{
    const old=mountReaderTools({sessionRoot:f.sessionRoot,document:f.document,immersion:f.immersion});old.chatIntegration.onUnread(true);old.unmount();
    for(const event of ['keydown','pointerdown','reader:focus'])assert.equal(f.document.listeners.get(event)||0,0,event+' listener must be released');
    assert.equal(f.elements.get('#reading-tools-trigger').listeners.get('click')||0,0);
    next=mountReaderTools({sessionRoot:f.sessionRoot,document:f.document,immersion:f.immersion});
    assert.equal(f.elements.get('#reading-tools-chat-slot').classList.contains('has-companion-message'),false,'the new owner initializes its own unread presentation');
    assert.equal(f.elements.get('#reading-tools-chat-slot').getAttribute('aria-description'),'');
    old.chatIntegration.onUnread(true);assert.equal(f.elements.get('#reading-tools-chat-slot').classList.contains('has-companion-message'),false);
    assert.equal(f.elements.get('#reading-tools-chat-slot').getAttribute('aria-description'),'');
  }finally{next?.unmount();f.cleanup();}
});

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
    const immersion=mountReaderImmersion({document:f.document,focusReturn:()=>tools?.toolFocusTarget});
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
    assert.equal(chat.companionAnchor,elements.get('#reading-tools-chat-slot'));
    assert.equal(elements.get('#reading-tools-trigger').getAttribute('aria-expanded'),'false','timer ARIA stays coordinator-owned');
    chat.onUnread(true);
    const pill=elements.get('#reading-tools-trigger');
    assert.equal(elements.get('#reading-tools-chat-slot').classList.contains('has-companion-message'),true,'unread presentation belongs to the visible AI entry');
    assert.match(elements.get('#reading-tools-chat-slot').getAttribute('aria-description')||'',/陪读/);
    chat.onUnread(false);assert.equal(elements.get('#reading-tools-chat-slot').classList.contains('has-companion-message'),false);
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
    assert.equal(tools.toolbar.expanded,false,'pure reading ignores hover');
    assert.equal(f.document.activeElement,activeBefore,'hover reveal never moves activeElement');
    assert.equal(f.document.body.dataset.readingTools,'closed','hover does not open navigation');
    tools.toolbar.conceal();
    f.elements.get('#reading-tools-trigger').dispatchEvent(new Event('click'));
    assert.equal(tools.toolbar.expanded,true);
    assert.equal(f.document.activeElement,f.headerControl,'an explicit click may move focus into the revealed header');
    tools.toolbar.conceal();
  }finally{await Promise.resolve();f.cleanup();}
});

test('focused chrome sleeps under a stationary pointer but preserves keyboard focus',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=compositionFixture();
  try{
    const immersion=mountReaderImmersion({document:f.document});
    const tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    tools.toolbar.reveal();
    const hover=new Event('pointerenter');Object.defineProperty(hover,'pointerType',{value:'mouse'});
    f.header.dispatchEvent(hover);
    t.mock.timers.tick(10000);
    assert.equal(tools.toolbar.expanded,false,'stationary hover does not prevent pure reading');
    const leave=new Event('pointerleave');Object.defineProperty(leave,'pointerType',{value:'mouse'});
    f.header.dispatchEvent(leave);
    t.mock.timers.tick(5000);assert.equal(tools.toolbar.expanded,false);
    tools.toolbar.reveal();
    f.document.activeElement=f.headerControl;
    const tab=new Event('keydown');Object.defineProperty(tab,'key',{value:'Tab'});f.document.dispatchEvent(tab);
    f.header.dispatchEvent(new Event('focusin'));
    t.mock.timers.tick(10000);
    assert.equal(tools.toolbar.expanded,true,'header focus holds the single conceal timer');
    assert.equal(f.header.inert,false,'header targets stay operable while held');
    f.header.dispatchEvent(new Event('focusout'));
    f.document.activeElement=f.document.body;
    await Promise.resolve();t.mock.timers.tick(5000);
    assert.equal(tools.toolbar.expanded,false);
  }finally{await Promise.resolve();f.cleanup();}
});

// ---- repair batch 2: real DOM event bubbling over the composed modules ----
class BubbleElement extends EventTarget {
  constructor(id=''){super();this.id=id;this.dataset={};this.attributes=new Map();this.hidden=false;this.inert=false;this.textContent='';this.title='';this.children=[];this.parentElement=null;this.handlers=new Map();this.classList={_s:new Set(),add(c){this._s.add(c);},remove(c){this._s.delete(c);},toggle(c,on){on?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}};}
  addEventListener(name,fn,options){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push({fn,capture:!!(options===true||options?.capture)});super.addEventListener(name,fn,options);}
  setAttribute(key,value){this.attributes.set(key,value);}getAttribute(key){return this.attributes.get(key);}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  insertBefore(n,before){n.remove();n.parentElement=this;const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,n);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(c=>c!==this);this.parentElement=null;}}
  contains(node){let n=node;while(n){if(n===this)return true;n=n.parentElement;}return false;}
  querySelector(selector){const all=[...this.children];for(const c of all){const hit=c.querySelector?.(selector);if(hit)return hit;}return null;}
  querySelectorAll(){return [];}
  getClientRects(){return [{top:0,left:0,right:10,bottom:10,width:10,height:10}];}
  getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};}
  focus(){this.docOwner?.activeElement;globalThis.document.activeElement=this;this.focused=(this.focused||0)+1;}
  closest(selector){
    let n=this;
    while(n){
      for(const part of String(selector).split(',')){
        const sel=part.trim();
        if(sel.startsWith('#')&&n.id===sel.slice(1))return n;
        if(sel.startsWith('[')&&sel.endsWith(']')&&n.attributes?.has?.(sel.slice(1,-1)))return n;
      }
      n=n.parentElement;
    }
    return null;
  }
}
// Faithful bubble-phase dispatch: capture listeners on the document run first,
// then listeners run up the parent chain until stopPropagation.
function fire(target,type,props={},document=null){
  const event=new Event(type,{cancelable:true,bubbles:true});Object.assign(event,props);
  Object.defineProperty(event,'target',{value:target});
  let stopped=false;event.stopPropagation=()=>{stopped=true;};
  const call=(node,capture)=>{for(const entry of node.handlers?.get?.(type)||[])if(entry.capture===capture&&!stopped)entry.fn.call(node,event);};
  if(document)call(document,true);
  let node=target;const chain=[];while(node){chain.push(node);node=node.parentElement;}
  for(const n of chain){if(stopped)break;call(n,false);}
  return event;
}
function bubbleFixture(){
  const body=new BubbleElement('body');body.classList.add('is-focused');
  const sessionRoot=new BubbleElement('reading-session');body.append(sessionRoot);
  const elements=new Map(['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice','reading-tools-chat-slot'].map(id=>{const n=new BubbleElement(id);return ['#'+id,n];}));
  sessionRoot.querySelector=s=>elements.get(s)||null;
  const trigger=elements.get('#reading-tools-trigger'),panel=elements.get('#reading-tools-panel');
  sessionRoot.append(trigger,panel,elements.get('#reading-tools-label'),elements.get('#reading-tools-notice'));
  panel.append(elements.get('#reading-tools-chat-slot'),elements.get('#reading-tools-close'));
  elements.get('#reading-tools-chat-slot').setAttribute('data-tools-handoff','');
  const header=new BubbleElement('reading-header');body.append(header);
  const headerControl=new BubbleElement('enter-focus');header.append(headerControl);
  const setting=new BubbleElement('immersive-reading');setting.checked=true;
  const outside=new BubbleElement('outside');body.append(outside);
  const chatSurface=new BubbleElement('chat-surface');body.append(chatSurface);
  const nodes=new Map([['reading-header',header],['enter-focus',headerControl],['immersive-reading',setting]]);
  const document=new BubbleElement('document');document.body=body;document.activeElement=body;body.parentElement=document;
  document.getElementById=id=>nodes.get(id)||null;document.querySelector=()=>null;document.querySelectorAll=()=>[];
  document.documentElement=new BubbleElement('html');document.documentElement.requestFullscreen=async()=>{};
  document.fullscreenEnabled=true;document.fullscreenElement=null;
  const previous={document:globalThis.document,observer:globalThis.MutationObserver,CustomEvent:globalThis.CustomEvent,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
  globalThis.document=document;globalThis.innerWidth=1200;globalThis.innerHeight=800;
  globalThis.MutationObserver=class{observe(){}};
  globalThis.CustomEvent=class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}};
  return {body,sessionRoot,elements,trigger,panel,header,headerControl,outside,chatSurface,document,
    fire:(target,type,props)=>fire(target,type,props,document),
    cleanup:()=>Object.assign(globalThis,previous)};
}

test('outside completed click and pill click keep one tools state across both surfaces',()=>{
  const f=bubbleFixture();
  try{
    const immersion=mountReaderImmersion({document:f.document,onToolsCloseRequest:target=>f.tools?.closeRequest?.(target)});
    f.tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    const tools=f.tools,pill=f.trigger;
    // Explicit activation opens both surfaces in pure reading.
    f.fire(pill,'click',{detail:1});
    assert.equal(tools.toolbar.expanded,true);
    assert.equal(f.document.body.dataset.readingTools,'open','explicit activation opens navigation');
    assert.equal(pill.getAttribute('aria-expanded'),'true');
    // Closing needs the completed gesture, without consuming its action.
    f.fire(f.outside,'pointerdown',{button:0});f.fire(f.outside,'pointerup',{button:0});f.fire(f.outside,'click',{button:0,detail:1});
    assert.equal(tools.toolbar.expanded,false,'the coordinator owns the close transition');
    assert.equal(f.document.body.dataset.readingTools,'closed','the header can never go invisible while the pill says expanded');
    assert.equal(pill.getAttribute('aria-expanded'),'false');
    assert.equal(f.header.inert,true);
    // and a plain click recovers fully
    f.fire(pill,'click',{detail:1});
    assert.equal(tools.toolbar.expanded,true);
    assert.equal(f.document.body.dataset.readingTools,'open');
    assert.equal(pill.getAttribute('aria-expanded'),'true');
    assert.equal(f.header.inert,false);
    tools.toolbar.conceal();
  }finally{f.cleanup();}
});

test('setFocused and fullscreen transitions cannot strand the toolbar state',async()=>{
  const f=bubbleFixture();
  try{
    let tools=null;
    const immersion=mountReaderImmersion({document:f.document,focusReturn:()=>tools?.toolFocusTarget,onToolsCloseRequest:target=>tools?.closeRequest?.(target)});
    tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    f.fire(f.trigger,'click',{detail:1});
    assert.equal(tools.toolbar.expanded,true);
    f.fire(f.headerControl,'click',{detail:1}); // fullscreen success closes tools through the coordinator
    await Promise.resolve();await Promise.resolve();
    assert.equal(tools.toolbar.expanded,false);
    assert.equal(f.document.body.dataset.readingTools,'closed');
    assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
    f.fire(f.trigger,'click',{detail:1});
    await Promise.resolve();await Promise.resolve();
    f.document.documentElement.requestFullscreen=async()=>{throw Error('Denied');};
    await immersion.toggleFullscreen();
    assert.equal(tools.toolbar.expanded,false,'fullscreen failure also ends in one coherent state');
    assert.equal(f.trigger.focused>0,true,'focus returns to the visible pill');
    f.document.documentElement.requestFullscreen=async()=>{};
    f.fire(f.trigger,'click',{detail:1});
    await Promise.resolve();await Promise.resolve();
    immersion.setFocused(false);
    assert.equal(tools.toolbar.expanded,false,'a focus-mode change cannot strand an expanded pill');
    assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
    immersion.setFocused(true);
    f.fire(f.trigger,'click',{detail:1});
    await Promise.resolve();await Promise.resolve();
    assert.equal(f.document.body.dataset.readingTools,'open','repeated reveal recovers every time');
    tools.toolbar.conceal();
  }finally{f.cleanup();}
});

test('the Ask AI handoff closes tools without bubbling re-reveal or focus theft',()=>{
  const f=bubbleFixture();
  try{
    const immersion=mountReaderImmersion({document:f.document,onToolsCloseRequest:target=>f.tools?.closeRequest?.(target)});
    const opened=[];
    f.tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
    const chat=f.tools.chatIntegration;
    // The injected trigger lives in the tools panel slot (bubbles to the panel).
    const ask=f.elements.get('#reading-tools-chat-slot');
    const trigger=new BubbleElement('ask-ai');ask.append(trigger);
    trigger.addEventListener('click',()=>{chat.onOpen();f.chatSurface.focus();});
    f.fire(f.trigger,'click',{detail:1});
    assert.equal(f.tools.toolbar.expanded,true);
    f.fire(trigger,'click',{detail:1});
    assert.equal(f.tools.toolbar.expanded,false,'the bubbling panel click must not re-reveal the tools');
    assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
    assert.equal(f.document.body.dataset.readingTools,'closed','the focused-mode header closes with the tools');
    assert.equal(f.document.activeElement,f.chatSurface,'focus stays with the chat handoff');
    assert.equal(opened.length,0);
  }finally{f.cleanup();}
});

// GET-221 exercises the production composition, including its one state timer.
function composed(t){
  const f=bubbleFixture();
  // Production's AI entry is a sibling, outside the panel's hover region.
  f.sessionRoot.append(f.elements.get('#reading-tools-chat-slot'));
  f.document.defaultView=new EventTarget();
  const immersion=mountReaderImmersion({document:f.document,focusReturn:()=>f.tools?.toolFocusTarget,onToolsCloseRequest:target=>f.tools?.closeRequest?.(target)});
  f.tools=mountReaderTools({sessionRoot:f.sessionRoot,immersion,document:f.document});
  t.after(()=>{f.tools.unmount();immersion.unmount();f.cleanup();});
  return f;
}
const mouse={pointerType:'mouse',pointerId:1,button:0,isPrimary:true};

test('hover preview stays available on the tucked-away AI sibling and conceals after leaving',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);f.tools.toolbar.setControlMode('unfocused');
  f.fire(f.sessionRoot,'pointerenter',mouse);f.fire(f.trigger,'pointerenter',mouse);
  f.fire(f.trigger,'pointerleave',mouse);f.fire(f.elements.get('#reading-tools-chat-slot'),'pointerenter',mouse);
  t.mock.timers.tick(1000);assert.equal(f.tools.toolbar.expanded,true);
  f.fire(f.elements.get('#reading-tools-chat-slot'),'pointerleave',mouse);
  t.mock.timers.tick(200);assert.equal(f.tools.toolbar.expanded,false);
  assert.equal(f.panel.inert,true);assert.equal(f.panel.getAttribute('aria-hidden'),'true');
});

test('hover reveals only the card and explicit activation adds the navigation surface',t=>{
  const f=composed(t);f.tools.toolbar.setControlMode('unfocused');f.fire(f.trigger,'pointerenter',mouse);
  assert.equal(f.tools.toolbar.expanded,true);assert.equal(f.body.dataset.readingTools,'closed');assert.equal(f.document.activeElement,f.body);
  assert.doesNotMatch(f.trigger.getAttribute('aria-label'),/导航/,'preview does not claim the closed navigation is expanded');
  f.tools.toolbar.setControlMode('focused');f.fire(f.trigger,'click',{detail:1});assert.equal(f.body.dataset.readingTools,'open');
  assert.match(f.trigger.getAttribute('aria-label'),/导航/);
});

test('button and card gap crossings and reentry cancel the sole old preview deadline',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);f.tools.toolbar.setControlMode('unfocused');
  f.fire(f.trigger,'pointerenter',mouse);f.fire(f.trigger,'pointerleave',mouse);t.mock.timers.tick(150);
  f.fire(f.panel,'pointerenter',mouse);t.mock.timers.tick(1000);assert.equal(f.tools.toolbar.expanded,true);
  f.fire(f.panel,'pointerleave',mouse);t.mock.timers.tick(200);assert.equal(f.tools.toolbar.expanded,false);
  f.fire(f.trigger,'pointerenter',mouse);t.mock.timers.tick(200);assert.equal(f.tools.toolbar.expanded,true);
  f.fire(f.trigger,'pointerleave',mouse);t.mock.timers.tick(200);assert.equal(f.tools.toolbar.expanded,false);
});

test('mouse focus in navigation cannot hold explicit tools forever but Tab focus can',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);
  f.fire(f.trigger,'click',{detail:1});f.fire(f.headerControl,'pointerdown',mouse);f.headerControl.focus();f.fire(f.headerControl,'focusin');
  t.mock.timers.tick(5000);assert.equal(f.tools.toolbar.expanded,false,'mouse-induced header focus is idle');
  f.fire(f.trigger,'click',{detail:0});f.fire(f.headerControl,'keydown',{key:'Tab'});f.headerControl.focus();f.fire(f.headerControl,'focusin');
  t.mock.timers.tick(10000);assert.equal(f.tools.toolbar.expanded,true,'keyboard navigation remains operable');
});

test('Enter activation establishes keyboard ownership before navigation receives focus',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);
  f.fire(f.trigger,'keydown',{key:'Enter'});f.fire(f.trigger,'click',{detail:0});f.headerControl.focus();f.fire(f.headerControl,'focusin');
  t.mock.timers.tick(6000);assert.equal(f.tools.toolbar.expanded,true,'keyboard-opened navigation is still in use');
});

test('outside dismissal waits for a complete primary gesture and preserves its target',t=>{
  const f=composed(t);f.fire(f.trigger,'click',{detail:1});
  f.fire(f.outside,'pointerdown',mouse);assert.equal(f.tools.toolbar.expanded,true,'pointerdown is not a completed click');
  f.outside.focus();let actions=0;f.outside.addEventListener('click',()=>actions++);
  f.fire(f.outside,'pointerup',mouse);f.fire(f.outside,'click',{...mouse,detail:1});
  assert.equal(f.tools.toolbar.expanded,false);assert.equal(actions,1);assert.equal(f.document.activeElement,f.outside);
});

test('WebKit touch compatibility click can finish its actual released gesture with a mouse ID',t=>{
  const f=composed(t);f.fire(f.trigger,'click',{detail:1});
  f.fire(f.outside,'pointerdown',{...mouse,pointerType:'touch',pointerId:0});
  f.fire(f.outside,'pointerup',{...mouse,pointerType:'touch',pointerId:0});
  f.fire(f.outside,'click',{...mouse,pointerType:'mouse',pointerId:1,detail:1});
  assert.equal(f.tools.toolbar.expanded,false,'native WebKit touch(0) -> compatibility mouse click(1) closes immediately');
});

for(const boundary of ['cancelled','unmatched-release'])test('WebKit compatibility click cannot bypass '+boundary+' touch protection',t=>{
  const f=composed(t);f.fire(f.trigger,'click',{detail:1});
  f.fire(f.outside,'pointerdown',{...mouse,pointerType:'touch',pointerId:0});
  if(boundary==='cancelled')f.fire(f.outside,'pointercancel',{...mouse,pointerType:'touch',pointerId:0});
  f.fire(f.outside,'pointerup',{...mouse,pointerType:'touch',pointerId:boundary==='unmatched-release'?2:0});
  f.fire(f.outside,'click',{...mouse,pointerType:'mouse',pointerId:1,detail:1});
  assert.equal(f.tools.toolbar.expanded,true);
});

for(const kind of ['inside-drag','cancelled','right-click','touch-scroll'])test(kind+' is not an outside dismissal',t=>{
  const f=composed(t);f.fire(f.trigger,'click',{detail:1});
  const start=kind==='inside-drag'?f.panel:f.outside,props={...mouse,...(kind==='right-click'?{button:2}:kind==='touch-scroll'?{pointerType:'touch'}:{})};
  f.fire(start,'pointerdown',props);
  if(kind==='cancelled')f.fire(f.outside,'pointercancel',props);
  if(kind==='touch-scroll')f.fire(f.outside,'pointermove',{...props,clientY:100});
  f.fire(f.outside,'pointerup',props);f.fire(f.outside,'click',{...props,detail:1});
  assert.equal(f.tools.toolbar.expanded,true);
});

test('leaving the window releases transient mouse holds and a chapter change closes coherently',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);
  f.fire(f.trigger,'pointerenter',mouse);f.document.defaultView.dispatchEvent(new Event('blur'));t.mock.timers.tick(200);
  assert.equal(f.tools.toolbar.expanded,false);
  f.fire(f.trigger,'click',{detail:1});f.fire(f.header,'pointerenter',mouse);f.fire(f.document,'reader:chapter');
  assert.equal(f.tools.toolbar.expanded,false);assert.equal(f.header.inert,true);
  f.fire(f.trigger,'click',{detail:1});t.mock.timers.tick(5000);assert.equal(f.tools.toolbar.expanded,false,'previous chapter holds are gone');
});

test('pointer cancellation releases a preview hold rather than stranding it',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);
  f.fire(f.trigger,'pointerenter',mouse);f.fire(f.document,'pointercancel',mouse);
  t.mock.timers.tick(200);assert.equal(f.tools.toolbar.expanded,false);
});

test('a replacement coordinator retires the old listeners and conceal deadline',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t),old=f.tools;
  const next=mountReaderTools({sessionRoot:f.sessionRoot,document:f.document});t.after(()=>next.unmount());
  f.fire(f.trigger,'click',{detail:1});
  assert.equal(old.toolbar.expanded,false,'the old mount cannot react to the replacement pill');
  assert.equal(next.toolbar.expanded,true);t.mock.timers.tick(5000);assert.equal(next.toolbar.expanded,false);
});

test('selecting card text holds it through pointer release until the selection leaves',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);let selection=null;
  f.document.getSelection=()=>selection;
  f.fire(f.trigger,'click',{detail:1});selection={isCollapsed:false,anchorNode:f.panel,focusNode:f.panel};
  f.fire(f.document,'selectionchange');t.mock.timers.tick(6000);assert.equal(f.tools.toolbar.expanded,true);
  selection=null;f.fire(f.document,'selectionchange');t.mock.timers.tick(5000);assert.equal(f.tools.toolbar.expanded,false);
});

test('an outside gesture that light-dismisses a child popover does not also close its parent tools',t=>{
  const f=composed(t);let overlay=false;f.document.querySelector=()=>overlay?{}:null;
  f.fire(f.trigger,'click',{detail:1});overlay=true;
  f.fire(f.outside,'pointerdown',mouse);overlay=false; // native light dismissal before click
  f.fire(f.outside,'pointerup',mouse);f.fire(f.outside,'click',{...mouse,detail:1});
  assert.equal(f.tools.toolbar.expanded,true,'one gesture consumes only the child layer');
  f.fire(f.outside,'pointerdown',mouse);f.fire(f.outside,'pointerup',mouse);f.fire(f.outside,'click',{...mouse,detail:1});assert.equal(f.tools.toolbar.expanded,false);
});

test('touch interaction promotes an existing mouse preview before native scroll cancellation',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);
  f.fire(f.trigger,'pointerenter',mouse);f.fire(f.panel,'pointerdown',{...mouse,pointerType:'touch'});f.fire(f.document,'pointercancel',{...mouse,pointerType:'touch'});
  t.mock.timers.tick(201);assert.equal(f.tools.toolbar.expanded,true,'active touch scrolling cannot disappear at the preview deadline');
});

test('active card scrolling renews explicit idle time through native pointer cancellation',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);f.fire(f.trigger,'click',{detail:1});
  for(let i=0;i<6;i++){t.mock.timers.tick(1000);f.fire(f.panel,'scroll');assert.equal(f.tools.toolbar.expanded,true);}
  t.mock.timers.tick(4999);assert.equal(f.tools.toolbar.expanded,true);t.mock.timers.tick(1);assert.equal(f.tools.toolbar.expanded,false,'idle starts after the last scroll');
});

test('a passive layout scroll cannot promote or reopen a hover preview',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);f.fire(f.trigger,'pointerenter',mouse);f.fire(f.trigger,'pointerleave',mouse);
  f.fire(f.panel,'scroll');t.mock.timers.tick(200);assert.equal(f.tools.toolbar.expanded,false);f.fire(f.panel,'scroll');assert.equal(f.tools.toolbar.expanded,false);
});

test('a wheel operation promotes preview and gets explicit idle time',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);f.tools.toolbar.setControlMode('unfocused');f.fire(f.trigger,'pointerenter',mouse);f.fire(f.trigger,'pointerleave',mouse);f.fire(f.panel,'wheel');
  t.mock.timers.tick(201);assert.equal(f.tools.toolbar.expanded,true);assert.equal(f.body.dataset.readingTools,'open');
});

test('browser fullscreen exit clears the old header hold and tools state',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=composed(t);
  f.document.fullscreenElement=f.document.documentElement;f.fire(f.document,'fullscreenchange');
  f.fire(f.trigger,'click',{detail:1});f.fire(f.header,'pointerenter',mouse);f.document.fullscreenElement=null;f.fire(f.document,'fullscreenchange');
  assert.equal(f.tools.toolbar.expanded,false);assert.equal(f.header.inert,true);
  f.fire(f.trigger,'click',{detail:1});t.mock.timers.tick(5000);assert.equal(f.tools.toolbar.expanded,false);
});

test('a late fullscreen notification cannot close tools opened after that state was already rendered',t=>{
  const f=composed(t);f.fire(f.trigger,'click',{detail:1});
  f.fire(f.document,'fullscreenchange'); // property already false at the new explicit open
  assert.equal(f.tools.toolbar.expanded,true);assert.equal(f.header.inert,false);
});
