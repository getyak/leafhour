import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPopover} from '../app/popover-controls.mjs';
import {mountReaderBookActionsBootstrap} from '../app/reader-book-actions-bootstrap.mjs';
import {mountReaderBookActions} from '../app/reader-book-actions.mjs';
import {mountReaderTools} from '../app/reader-tools.mjs';
import {mountReaderImmersion} from '../app/reader-immersion.mjs';

// Capability fixtures shared with popover-controls.test.mjs: both variants
// refuse the ':popover-open' selector the way stock Chrome 113 does, so any
// dead unsafe path throws instead of passing silently.
const OPEN='data-popover-open';
class Node{
  constructor(tag,doc){
    this.tagName=String(tag).toUpperCase();this.ownerDocument=doc;this.parentElement=null;this.children=[];
    this.attributes=new Map();this.dataset={};this.className='';this.id='';this.textContent='';this.value='';
    this.hidden=false;this.disabled=false;this.type='';this.style={setProperty(key,value){this[key]=value;}};this.isConnected=true;
    this.offsetWidth=0;this.offsetHeight=0;this.listeners=new Map();this._visible=true;
  }
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){dispatch(this,event);return !event.defaultPrevented;}
  emit(type,props={}){dispatch(this,makeEvent(type,props));}
  setAttribute(key,value){const changed=this.getAttribute(key)!==String(value);this.attributes.set(key,String(value));if(key==='id')this.id=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).split('-').map((part,index)=>index?part[0].toUpperCase()+part.slice(1):part).join('')]=String(value);if(changed)this.ownerDocument?.mutated?.(this,key);}
  getAttribute(key){if(this.attributes.has(key))return this.attributes.get(key);const camel=key.startsWith('data-')?key.slice(5).split('-').map((part,index)=>index?part[0].toUpperCase()+part.slice(1):part).join(''):null;return camel&&this.dataset[camel]!==undefined?String(this.dataset[camel]):null;}
  hasAttribute(key){return this.getAttribute(key)!==null;}
  removeAttribute(key){const changed=this.hasAttribute(key);this.attributes.delete(key);const camel=key.startsWith('data-')?key.slice(5).split('-').map((part,index)=>index?part[0].toUpperCase()+part.slice(1):part).join(''):null;if(camel)delete this.dataset[camel];if(changed)this.ownerDocument?.mutated?.(this,key);}
  toggleAttribute(key,force){const on=force===undefined?!this.hasAttribute(key):!!force;if(on)this.setAttribute(key,'');else this.removeAttribute(key);return on;}
  get inert(){return this.hasAttribute('inert');}
  set inert(value){this.toggleAttribute('inert',!!value);}
  get classList(){
    const owner=this;
    return {
      add(...names){const set=new Set(owner.className.split(/\s+/).filter(Boolean));for(const name of names)set.add(name);owner.className=[...set].join(' ');},
      remove(...names){const set=new Set(owner.className.split(/\s+/).filter(Boolean));for(const name of names)set.delete(name);owner.className=[...set].join(' ');},
      toggle(name,force){const set=new Set(owner.className.split(/\s+/).filter(Boolean));const on=force===undefined?!set.has(name):!!force;if(on)set.add(name);else set.delete(name);owner.className=[...set].join(' ');return on;},
      contains(name){return owner.className.split(/\s+/).includes(name);}
    };
  }
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  prepend(node){node.parentElement=this;this.children.unshift(node);}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
  after(node){const parent=this.parentElement;if(!parent)throw Error('detached');const index=parent.children.indexOf(this);parent.children.splice(index+1,0,node);node.parentElement=parent;}
  remove(){const parent=this.parentElement;if(!parent)return;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}
  contains(node){let current=node;while(current){if(current===this)return true;current=current.parentElement;}return false;}
  closest(selector){let current=this;while(current){if(current.matches?.(selector))return current;current=current.parentElement;}return null;}
  querySelector(selector){return query(this,selector)[0]||null;}
  querySelectorAll(selector){return query(this,selector);}
  matches(selector){if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);if(selector.startsWith(':scope > '))throw Error('fixture cannot match selector: '+selector);return compound(selector).some(test=>test(this));}
  focus(){const doc=this.ownerDocument,previous=doc?.activeElement;if(doc)doc.activeElement=this;if(previous!==this)previous?.emit?.('focusout',{});this.emit('focusin',{});}
  getClientRects(){return this.isConnected&&this._visible&&!this.hidden?[{}]:[];}
  getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};}
  showModal(){this.open=true;this.setAttribute('open','');}
  close(){this.open=false;this.removeAttribute('open');this.emit('close',{});}
}
function makeEvent(type,props={}){
  const event=new Event(type,{bubbles:props.bubbles!==false,cancelable:props.cancelable!==false});
  for(const [key,value]of Object.entries(props))if(key!=='bubbles'&&key!=='cancelable')Object.defineProperty(event,key,{value,configurable:true});
  return event;
}
function dispatch(target,event){
  if(!Object.getOwnPropertyDescriptor(event,'target'))Object.defineProperty(event,'target',{value:target,configurable:true});
  for(const fn of [...(target.listeners?.get(event.type)||[])])fn.call(target,event);
  if(event.bubbles&&!event.cancelBubble&&target.parentElement)dispatch(target.parentElement,event);
}
function compound(selector){
  return String(selector).split(',').map(part=>{
    let rest=part.trim(),tag=null;const tests=[];
    const tagMatch=/^([a-zA-Z][\w-]*)/.exec(rest);
    if(tagMatch){tag=tagMatch[1].toUpperCase();rest=rest.slice(tagMatch[0].length);}
    while(rest){
      if(rest.startsWith('#')){const m=/^#([\w-]+)/.exec(rest);tests.push(node=>node.id===m[1]);rest=rest.slice(m[0].length);continue;}
      if(rest.startsWith('.')){const m=/^\.([\w-]+)/.exec(rest);tests.push(node=>node.classList.contains(m[1]));rest=rest.slice(m[0].length);continue;}
      if(rest.startsWith('[')){const m=/^\[([\w-]+)(?:=([^\]]*))?\]/.exec(rest);const key=m[1],value=m[2];tests.push(node=>value===undefined?node.hasAttribute(key):node.getAttribute(key)===value.replace(/^["']|["']$/g,''));rest=rest.slice(m[0].length);continue;}
      if(rest.startsWith(':not(')){const m=/^:not\(([^)]*)\)/.exec(rest);const inner=compound(m[1]);tests.push(node=>!inner.some(test=>test(node)));rest=rest.slice(m[0].length);continue;}
      if(rest.startsWith(':disabled')){tests.push(node=>node.disabled===true);rest=rest.slice(9);continue;}
      throw Error('fixture cannot match selector: '+selector);
    }
    return node=>(!tag||node.tagName===tag)&&tests.every(test=>test(node));
  });
}
function query(root,selector){
  if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);
  if(selector.startsWith(':scope > '))return root.children.filter(node=>compound(selector.slice(9)).some(test=>test(node)));
  const parsed=compound(selector),found=[];
  const walk=node=>{for(const child of node.children){if(parsed.some(test=>test(child)))found.push(child);walk(child);}};
  walk(root);
  return found;
}
class Doc{
  constructor({native}){
    this.native=native;this.listeners=new Map();this.activeElement=null;this._byId=new Map();this.computedReads=0;this.observers=[];
    this.body=new Node('body',this);this.body.parentElement=this;this.documentElement=this.body;
    const view=new Node('window',null);view.innerWidth=1200;view.innerHeight=900;view.location={assign(){}};
    view.getComputedStyle=node=>{this.computedReads++;return {visibility:node?.style?.visibility||'visible',display:node?._visible===false?'none':'block'};};
    this.defaultView=view;
  }
  createElement(tag){const node=new Node(tag,this);if(this.native)nativePopover(node);return node;}
  createElementNS(_ns,tag){return new Node(tag,this);}
  getElementById(id){return this._byId.get(id)||query(this.body,'#'+id)[0]||null;}
  querySelector(selector){return query(this.body,selector)[0]||null;}
  querySelectorAll(selector){return query(this.body,selector);}
  mutated(target,attributeName){
    for(const {root,options,callback} of this.observers){
      if(!options.attributes||target!==root&&(!options.subtree||!root.contains(target))||options.attributeFilter&&!options.attributeFilter.includes(attributeName))continue;
      queueMicrotask(()=>callback([{type:'attributes',target,attributeName}]));
    }
  }
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){dispatch(this,event);return !event.defaultPrevented;}
  emit(type,props={}){dispatch(this,makeEvent(type,props));}
  make(tag,id,attrs={}){
    const node=this.createElement(tag);
    if(id){node.id=id;this._byId.set(id,node);}
    for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);
    this.body.append(node);
    return node;
  }
}
function nativePopover(node){
  node.showPopover=function(){
    if(node._nativeOpen)throw Error('InvalidStateError');
    dispatch(node,makeEvent('beforetoggle',{newState:'open'}));
    node._nativeOpen=true;
    queueMicrotask(()=>dispatch(node,makeEvent('toggle',{newState:'open'})));
  };
  node.hidePopover=function(){
    if(!node._nativeOpen)throw Error('InvalidStateError');
    dispatch(node,makeEvent('beforetoggle',{newState:'closed'}));
    node._nativeOpen=false;
    queueMicrotask(()=>dispatch(node,makeEvent('toggle',{newState:'closed'})));
  };
}
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));
const settle=async()=>{for(let i=0;i<8;i++)await tick();};

function bootstrapFixture({native=false,loadEnhancement,introductionResponse=null}={}){
  const document=new Doc({native});
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  globalThis.document=document;globalThis.window=new EventTarget();globalThis.location={origin:'https://fixture.invalid'};
  for(const id of ['book-info','open-book-info','book-intro-status','book-intro-retry','book-intro-generate','book-intro-login','book-info-share','book-intro-provenance','book-intro-scope','book-info-description'])
    document.make(id==='book-info'?'section':'div',id,id==='book-info'?{popover:'auto',tabindex:'-1'}:id==='open-book-info'?{'popovertarget':'book-info','aria-expanded':'false','aria-controls':'book-info'}:{});
  document.getElementById('book-intro-generate').hidden=true;
  document.getElementById('book-intro-login').hidden=true;
  document.getElementById('book-info-share').disabled=true;
  document.getElementById('book-intro-retry').hidden=true;
  const info=document.getElementById('book-info'),trigger=document.getElementById('open-book-info'),retry=document.getElementById('book-intro-retry'),status=document.getElementById('book-intro-status');
  if(native)trigger.addEventListener('click',()=>info._nativeOpen?info.hidePopover():info.showPopover());
  const handle=mountPopover({document,element:info,trigger});
  const calls={imports:0,introduction:0};
  let book={bookId:'fixture-book',contentVersion:'v1',title:{zh:'一本书'},chapters:[{id:'ch1',number:1,title:{zh:'第一章'}}],sections:[{chapterId:'ch1',number:1,title:'一',paragraphs:[{id:'p1'}]}],source:{}};
  let owner='owner-one';
  const injected=[];
  const load=loadEnhancement||(async()=>({mountReaderBookActions}));
  const wrapped=async()=>{calls.imports++;const module=await load();return {mountReaderBookActions:args=>{injected.push(args);return module.mountReaderBookActions(args);}};};
  const bootstrap=mountReaderBookActionsBootstrap({document,info:handle,getBook:()=>book,api:async url=>{if(String(url).endsWith('/introduction'))calls.introduction++;return introductionResponse?introductionResponse(url):{source:'ai',text:'介绍'};},session:{user:{id:'owner-one'}},bookId:'fixture-book',getOwner:()=>owner,loadEnhancement:wrapped});
  return {document,handle,info,trigger,retry,status,calls,injected,bootstrap,
    open:()=>trigger.emit('click'),
    changeVersion:()=>book={...book,contentVersion:'v2'},
    changeOwner:()=>owner='owner-two',
    restore(){for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('the lazy enhancement never imports, mounts or reads before the reader actually opens book-info',async t=>{
  const f=bootstrapFixture();
  t.after(f.restore);
  assert.equal(f.calls.imports,0,'no module load before the real user open');
  assert.equal(f.calls.introduction,0);
  assert.equal(f.document.getElementById('reader-book-gift'),null,'no gift DOM before the open');
  assert.equal(f.document.getElementById('book-intro-status').textContent,'');
  f.open();
  assert.equal(f.calls.imports,1,'the first real open starts exactly one shared import');
  assert.equal(f.status.textContent,'正在准备简介与分享…','one accessible loading state');
  assert.equal(f.calls.introduction,0,'no API read until the enhancement mounts');
  await settle();
  assert.equal(f.calls.imports,1);
  assert.ok(f.document.getElementById('reader-book-gift'),'the mounted enhancement owns its gift dialog');
  assert.equal(f.status.textContent,'');
  assert.equal(f.calls.introduction,1,'the already-open state is read exactly once at mount');
});

test('the injected handle is the exact same controller instance and one import mounts one enhancement per page',async t=>{
  const f=bootstrapFixture();
  t.after(f.restore);
  f.open();await settle();
  assert.equal(f.injected.length,1);
  assert.equal(f.injected[0].info,f.handle,'the lazy module receives the same shared popover handle');
  f.handle.close();f.open();f.handle.close();f.open();
  await settle();
  assert.equal(f.calls.imports,1,'close and reopen reuse the one shared import promise');
  assert.equal(f.injected.length,1,'one mounted enhancement per page');
  assert.equal(f.document.body.children.filter(node=>node.id==='reader-book-gift').length,1);
});

test('mounting the real enhancement preserves its pending introduction status',async t=>{
  let resolveIntroduction;
  const pending=new Promise(resolve=>{resolveIntroduction=resolve;});
  const f=bootstrapFixture({introductionResponse:()=>pending});
  t.after(f.restore);
  f.open();await settle();
  assert.equal(f.calls.introduction,1);
  assert.ok(f.document.getElementById('reader-book-gift'),'the real enhancement has mounted');
  assert.equal(f.status.textContent,'正在读取已保存的简介…','the enhancement owns status while its request is pending');
  assert.equal(f.status.getAttribute('role'),'status');
  resolveIntroduction({source:'missing',text:'',available:true});await settle();
  assert.equal(f.status.textContent,'','the enhancement clears its own status when the read settles');
});

for(const native of [false,true])test((native?'native':'fallback')+' book info holds the single tools timer through a slow enhancement and returns focus after Escape',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let resolveEnhancement;
  const pending=new Promise(resolve=>{resolveEnhancement=resolve;});
  const f=bootstrapFixture({native,loadEnhancement:()=>pending});
  const previousObserver=globalThis.MutationObserver;
  globalThis.MutationObserver=class{constructor(callback){this.callback=callback;}observe(root,options){f.document.observers.push({root,options,callback:this.callback});}};
  const move=(node,parent)=>{node.remove();parent.append(node);return node;};
  const root=f.document.make('section','reading-session');
  for(const id of ['reading-tools-trigger','reading-tools-panel','reading-tools-close','reading-tools-label','reading-tools-notice','reading-tools-chat-slot'])move(f.document.make(id.includes('trigger')||id.includes('close')?'button':'div',id),root);
  const header=f.document.make('header','reading-header');header.className='reading-header';
  move(f.trigger,header);move(f.document.make('button','enter-focus'),header);
  f.document.make('input','immersive-reading');
  f.document.body.classList.add('is-focused');
  let tools;
  const immersion=mountReaderImmersion({document:f.document,onToolsCloseRequest:target=>tools?.closeRequest(target)});
  tools=mountReaderTools({sessionRoot:root,immersion,document:f.document});
  t.after(async()=>{f.bootstrap.dispose();tools.toolbar.conceal();await settle();globalThis.MutationObserver=previousObserver;f.restore();});
  f.document.getElementById('reading-tools-trigger').emit('click');
  f.open();f.info.focus();await settle();
  assert.equal(f.calls.imports,1);
  t.mock.timers.tick(6000);
  assert.equal(tools.toolbar.expanded,true,'the actual popover marker holds the existing conceal timer beyond five seconds');
  assert.equal(header.inert,false,'the opener remains usable during a slow import');
  assert.equal(f.handle.isOpen(),true);
  resolveEnhancement({mountReaderBookActions});await settle();
  assert.equal(f.calls.introduction,1,'the delayed real enhancement can still mount and read once');
  assert.ok(f.document.getElementById('reader-book-gift'));
  t.mock.timers.tick(10000);
  assert.equal(header.inert,false,'a long open bookplate keeps its actual opener reachable');
  f.document.emit('keydown',{key:'Escape'});await settle();
  assert.equal(f.handle.isOpen(),false);
  assert.equal(f.document.activeElement,f.trigger,'Escape returns to the visible title trigger');
  const outside=f.document.make('button','outside');outside.focus();await settle();
  t.mock.timers.tick(4999);assert.equal(tools.toolbar.expanded,true);
  t.mock.timers.tick(1);assert.equal(tools.toolbar.expanded,false,'closing releases the original five-second timer');
  assert.equal(header.inert,true);
  assert.equal(f.document.activeElement,outside,'normal concealment keeps intentional outside focus');
});

test('a real close during the load delay lets the late module arrive as cached code only',async t=>{
  const f=bootstrapFixture();
  t.after(f.restore);
  const outside=f.document.make('button','outside');
  f.open();
  f.handle.close();
  outside.focus();
  await settle();
  assert.equal(f.document.getElementById('reader-book-gift'),null,'a cancelled open never mounts DOM');
  assert.equal(f.calls.introduction,0,'a cancelled open never reads');
  assert.equal(f.document.activeElement,outside,'a late module never moves focus');
});

for(const [name,mutate]of [['a primitive source version change','changeVersion'],['an owner change','changeOwner']]){
  test(name+' during the load delay prevents the late mount and any stale read',async t=>{
    const f=bootstrapFixture();
    t.after(f.restore);
    f.open();
    f[mutate]();
    await settle();
    assert.equal(f.document.getElementById('reader-book-gift'),null);
    assert.equal(f.calls.introduction,0);
  });
}

for(const [name,leave]of [['reader:session-changed',f=>f.document.emit('reader:session-changed')],['pagehide',f=>f.document.defaultView.emit('pagehide')],['explicit clear',f=>f.bootstrap.clear()]]){
  test(name+' during the load delay synchronously invalidates pending work',async t=>{
    const f=bootstrapFixture();
    t.after(f.restore);
    f.open();
    leave(f);
    await settle();
    assert.equal(f.document.getElementById('reader-book-gift'),null,'a late module cannot mount after '+name);
    assert.equal(f.calls.introduction,0);
    assert.equal(f.status.textContent,'','loading state resets synchronously');
    assert.equal(f.retry.hidden,true);
  });
}

test('a newer overlay blocks the still-current mount with honest retry feedback and no focus move',async t=>{
  for(const native of [false,true]){
    const f=bootstrapFixture({native});
    f.open();
    const focused=f.document.activeElement;
    const dialog=f.document.make('dialog','modal');
    dialog.setAttribute('open','');
    await settle();
    assert.equal(f.document.getElementById('reader-book-gift'),null,'never mounts over another open surface');
    assert.equal(f.retry.hidden,false,'an ordinary explicit retry control is visible');
    assert.equal(f.status.getAttribute('role'),'alert');
    assert.equal(f.document.activeElement,focused,'blocked feedback never moves focus');
    f.restore();
  }
});

test('a hidden, detached, display:none or visibility:hidden opener prevents the late mount without touching stale private UI',async t=>{
  for(const unusable of ['hidden','detached','display:none','visibility:hidden']){
    const f=bootstrapFixture();
    f.open();
    const focused=f.document.activeElement;
    if(unusable==='hidden')f.trigger.hidden=true;
    else if(unusable==='detached'){f.trigger.remove();f.trigger.isConnected=false;}
    else if(unusable==='display:none')f.trigger._visible=false;
    else f.trigger.style.visibility='hidden';
    await settle();
    assert.equal(f.document.getElementById('reader-book-gift'),null,unusable+' opener must not late-mount');
    assert.equal(f.calls.introduction,0,unusable+' opener must not late-read');
    assert.equal(f.document.activeElement,focused,unusable+' opener must not move focus');
    if(unusable==='visibility:hidden')assert.ok(f.document.computedReads>0,'the guard reads real computed visibility, not a state marker');
    f.restore();
  }
});

test('a failed import keeps the basic bookplate readable and one explicit retry recovers exactly once',async t=>{
  let attempts=0;
  const f=bootstrapFixture({loadEnhancement:async()=>{if(++attempts===1)throw Error('module unavailable');return {mountReaderBookActions:args=>mountReaderBookActions(args)};}});
  t.after(f.restore);
  f.document.getElementById('book-info-description').textContent='已有的简介';
  f.open();
  await settle();
  assert.equal(f.document.getElementById('reader-book-gift'),null);
  assert.equal(f.retry.hidden,false,'load failure shows the explicit retry control');
  assert.equal(f.status.getAttribute('role'),'alert');
  assert.equal(f.status.textContent,'简介与分享暂时无法载入，可以重试。');
  assert.equal(f.document.getElementById('book-info-description').textContent,'已有的简介','the basic description stays readable');
  f.retry.emit('click');
  await settle();
  assert.ok(f.document.getElementById('reader-book-gift'),'the explicit retry mounts the enhancement');
  assert.equal(f.retry.hidden,true);
  assert.equal(attempts,2,'retry imports exactly once more, with no background timer');
});

test('a synchronous enhancement setup failure is consumed with honest retry and no unhandled rejection',async t=>{
  const unhandled=[];
  const onUnhandled=error=>unhandled.push(error);
  process.on('unhandledRejection',onUnhandled);
  let attempts=0;
  const f=bootstrapFixture({loadEnhancement:async()=>({mountReaderBookActions:args=>{if(++attempts===1)throw Error('synthetic setup failure');return mountReaderBookActions(args);}})});
  t.after(()=>{process.removeListener('unhandledRejection',onUnhandled);f.restore();});
  f.open();
  await settle();
  assert.deepEqual(unhandled,[],'the whole load-and-mount chain is consumed, never an unhandled rejection');
  assert.equal(f.document.getElementById('reader-book-gift'),null);
  assert.equal(f.retry.hidden,false,'a setup failure shows the explicit retry control');
  assert.equal(f.status.getAttribute('role'),'alert');
  assert.equal(f.status.textContent,'简介与分享暂时无法载入，可以重试。');
  f.retry.emit('click');
  await settle();
  assert.deepEqual(unhandled,[],'the explicit retry stays inside the consumed chain');
  assert.equal(f.document.body.children.filter(node=>node.id==='reader-book-gift').length,1,'the explicit retry mounts exactly one enhancement');
  assert.equal(f.calls.introduction,1,'the retry read runs once for one open state');
  f.handle.close();f.open();
  await settle();
  assert.deepEqual(unhandled,[]);
  assert.equal(f.document.body.children.filter(node=>node.id==='reader-book-gift').length,1,'a retry never duplicates a poisoned ready');
});

test('close and reopen during one shared pending import adopt only the newest request',async t=>{
  const f=bootstrapFixture();
  t.after(f.restore);
  f.open();
  f.handle.close();
  f.open();
  await settle();
  assert.equal(f.calls.imports,1,'the shared import promise runs once');
  assert.equal(f.document.body.children.filter(node=>node.id==='reader-book-gift').length,1,'only the newest request mounts');
  assert.equal(f.calls.introduction,1);
});

test('reader:ready invalidates a pending load but never disturbs a mounted enhancement',async t=>{
  const f=bootstrapFixture();
  t.after(f.restore);
  f.open();
  f.document.emit('reader:ready');
  await settle();
  assert.equal(f.document.getElementById('reader-book-gift'),null,'a source revision change cancels the pending mount');
  f.handle.close();f.open();
  await settle();
  assert.ok(f.document.getElementById('reader-book-gift'));
  f.document.emit('reader:ready');
  await settle();
  assert.equal(f.document.body.children.filter(node=>node.id==='reader-book-gift').length,1,'a mounted enhancement survives reader:ready');
});

test('the native controller runs the same bootstrap boundary with truthful state',async t=>{
  const f=bootstrapFixture({native:true});
  t.after(f.restore);
  f.open();
  await settle();
  assert.equal(f.calls.imports,1);
  assert.ok(f.document.getElementById('reader-book-gift'));
  assert.equal(f.calls.introduction,1,'the already-open state is processed exactly once');
  f.trigger.emit('click');
  await settle();
  assert.equal(f.calls.imports,1);
  assert.equal(f.calls.introduction,1);
});
