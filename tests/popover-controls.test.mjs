import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPopover,overlayOpen} from '../app/popover-controls.mjs';
import {mountShelfFilters} from '../app/library-filter-controls.mjs';
import {mountLibraryBookActions} from '../app/library-book-actions.mjs';
import {mountBookIntroduction} from '../app/reader-navigation.mjs';
import {mountReaderBookActions} from '../app/reader-book-actions.mjs';
import {mountPaletteBootstrap} from '../app/palette-bootstrap.mjs';

// ---- capability fixtures ----------------------------------------------------
// Both fixtures refuse the ':popover-open' selector exactly the way stock
// Chrome 113 does, so a dead unsafe path throws instead of passing silently.
// The capability-present fixture also queues its toggle events the way the
// platform does (beforetoggle synchronous, toggle on a task) so eager state
// and "callbacks once" are proven against real event timing.
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
  setAttribute(key,value){this.attributes.set(key,String(value));if(key==='id')this.id=String(value);if(key==='class')this.className=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).split('-').map((part,index)=>index?part[0].toUpperCase()+part.slice(1):part).join('')]=String(value);}
  getAttribute(key){if(this.attributes.has(key))return this.attributes.get(key);const camel=key.startsWith('data-')?key.slice(5).split('-').map((part,index)=>index?part[0].toUpperCase()+part.slice(1):part).join(''):null;return camel&&this.dataset[camel]!==undefined?String(this.dataset[camel]):null;}
  hasAttribute(key){return this.getAttribute(key)!==null;}
  removeAttribute(key){this.attributes.delete(key);const camel=key.startsWith('data-')?key.slice(5).split('-').map((part,index)=>index?part[0].toUpperCase()+part.slice(1):part).join(''):null;if(camel)delete this.dataset[camel];}
  toggleAttribute(key,force){const on=force===undefined?!this.hasAttribute(key):!!force;if(on)this.setAttribute(key,'');else this.removeAttribute(key);return on;}
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
  matches(selector){if(selector.includes(':popover-open'))throw Error('unsupported selector: '+selector);if(selector.startsWith(':scope > '))throw Error('fixture cannot match selector: '+selector);const parsed=compound(selector);return parsed.some(test=>test(this));}
  focus(){const doc=this.ownerDocument;if(doc)doc.activeElement=this;this.emit('focusin',{});}
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
  if(!event.type)throw Error('event without type');
  if(!Object.getOwnPropertyDescriptor(event,'target'))Object.defineProperty(event,'target',{value:target,configurable:true});
  for(const fn of [...(target.listeners?.get(event.type)||[])])fn.call(target,event);
  if(event.bubbles&&!event.cancelBubble&&target.parentElement)dispatch(target.parentElement,event);
}
// Small honest selector engine for the compound selectors these controllers
// actually use; anything else fails loudly.
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
  if(selector.startsWith(':scope > ')){
    const parsed=compound(selector.slice(9));
    return root.children.filter(node=>parsed.some(test=>test(node)));
  }
  const parsed=compound(selector),found=[];
  const walk=node=>{for(const child of node.children){if(parsed.some(test=>test(child)))found.push(child);walk(child);}};
  walk(root);
  return found;
}
class Doc{
  constructor({native}){
    this.native=native;this.listeners=new Map();this.activeElement=null;this._byId=new Map();this.computedReads=0;
    this.body=new Node('body',this);this.body.parentElement=this;this.documentElement=this.body;
    this.defaultView={innerWidth:1200,innerHeight:900,addEventListener(){},removeEventListener(){},location:{assign(){}},
      getComputedStyle:node=>{this.computedReads++;return {visibility:node?.style?.visibility||'visible',display:node?._visible===false?'none':'block'};}};
  }
  createElement(tag){const node=new Node(tag,this);if(this.native)nativePopover(node);return node;}
  createElementNS(_ns,tag){return new Node(tag,this);}
  createTextNode(text){const node=new Node('#text',this);node.nodeType=3;node.textContent=String(text);Object.defineProperty(node,'parentNode',{get:()=>node.parentElement});return node;}
  getElementById(id){return this._byId.get(id)||query(this.body,'#'+id)[0]||null;}
  querySelector(selector){return query(this.body,selector)[0]||null;}
  querySelectorAll(selector){return query(this.body,selector);}
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
// Supporting browsers own the top layer: the fixture only emulates the
// declarative trigger and the event timing (beforetoggle sync, toggle queued).
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
function fixture({native}={}){
  const document=new Doc({native:!!native});
  const trigger=document.make('button','open-popover',{'popovertarget':'panel','aria-expanded':'false','aria-controls':'panel'});
  const element=document.make('div','panel',{popover:'auto',role:'dialog',tabindex:'-1'});
  const first=document.createElement('button');first.type='button';first.textContent='first control';
  const second=document.createElement('button');second.type='button';second.textContent='second control';
  element.append(first,second);
  if(native)trigger.addEventListener('click',()=>element._nativeOpen?element.hidePopover():element.showPopover());
  return {document,trigger,element,first,second};
}
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

test('both capability fixtures reject the unsafe :popover-open selector the way stock Chrome 113 does',()=>{
  for(const native of [false,true]){
    const f=fixture({native});
    assert.throws(()=>f.element.matches(':popover-open'),/unsupported selector/);
    assert.throws(()=>f.document.querySelector('[popover]:popover-open'),/unsupported selector/);
  }
});

test('the shared registry returns one owning instance per element in both capability branches',()=>{
  for(const native of [false,true]){
    const f=fixture({native}),calls=[];
    const consumer=open=>calls.push(open);
    const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger,onChange:consumer});
    const again=mountPopover({document:f.document,element:f.element,onChange:consumer});
    assert.equal(again,instance,'a second mount subscribes to the same owner instead of bootstrapping again');
    assert.equal(instance.isOpen(),false,'initial closed state is closed before any gesture');
    assert.equal(f.element.hasAttribute(OPEN),false);
    instance.open();
    assert.deepEqual(calls,[true],'the duplicated consumer is registered once and fires once');
    instance.close();
    assert.deepEqual(calls,[true,false]);
  }
});

test('every beforeOpen subscription survives a later owner and runs exactly once per open in both mount orders',()=>{
  for(const native of [false,true]){
    for(const order of [['navigation','enhancement'],['enhancement','navigation']]){
      const f=fixture({native}),sequence=[];
      const mounts={navigation:()=>sequence.push('navigation'),enhancement:()=>sequence.push('enhancement')};
      mountPopover({document:f.document,element:f.element,trigger:f.trigger,beforeOpen:mounts[order[0]]});
      mountPopover({document:f.document,element:f.element,beforeOpen:mounts[order[1]]});
      f.trigger.emit('click');
      assert.deepEqual(sequence,[...order],'a later owner keeps its beforeOpen subscription in registration order');
      sequence.length=0;
      f.trigger.emit('click');f.trigger.emit('click');f.trigger.emit('click');f.trigger.emit('click');
      assert.deepEqual(sequence,[...order,...order],'each beforeOpen subscription runs once per open, never twice');
    }
  }
});

test('the subscription API delivers one already-open transition and unsubscribes for good',()=>{
  for(const native of [false,true]){
    const f=fixture({native}),events=[];
    const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
    instance.open();
    const unsubscribe=instance.subscribe({onChange:open=>events.push(open)});
    assert.deepEqual(events,[true],'a subscriber added while the popover already shows processes that open state exactly once');
    instance.close();
    assert.deepEqual(events,[true,false],'later transitions stay normal');
    unsubscribe();
    instance.open();instance.close();
    assert.deepEqual(events,[true,false],'an unsubscribed callback never fires again');
    assert.equal(instance.isOpen(),false);
  }
});

test('fallback trigger clicks toggle open marker, hidden state, aria and first-control focus',async()=>{
  const f=fixture(),opens=[],closes=[];
  const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger,beforeOpen:()=>opens.push(1),onChange:open=>closes.push(open)});
  f.trigger.emit('click');
  assert.equal(instance.isOpen(),true);
  assert.equal(f.element.hasAttribute(OPEN),true);
  assert.equal(f.element.getAttribute('hidden'),null,'the fallback opens through the native hidden state');
  assert.equal(f.trigger.getAttribute('aria-expanded'),'true');
  assert.equal(f.document.activeElement,f.first,'keyboard and pointer opens reach a usable first control');
  assert.deepEqual(opens,[1]);
  f.trigger.emit('click');
  assert.equal(instance.isOpen(),false);
  assert.equal(f.element.hasAttribute(OPEN),false);
  assert.equal(f.element.getAttribute('hidden'),'','the fallback closes through the native hidden state');
  assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
  assert.equal(f.document.activeElement,f.trigger,'closing returns focus to the connected trigger');
  assert.deepEqual(closes,[true,false],'open and close callbacks run once each');
});

test('supporting browsers keep declarative triggers and truthful state even when toggle arrives on a task',async()=>{
  const f=fixture({native:true}),events=[];
  const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger,beforeOpen:()=>events.push('before'),onChange:open=>events.push(open?'open':'close')});
  f.trigger.emit('click');
  assert.equal(instance.isOpen(),true,'the owned marker is truthful before the queued toggle event');
  assert.deepEqual(events,['before','open']);
  await tick();
  assert.deepEqual(events,['before','open'],'the queued toggle event cannot double-fire callbacks');
  assert.equal(f.element.getAttribute('hidden'),null,'supporting browsers never touch the hidden attribute');
  f.trigger.emit('click');
  await tick();
  assert.equal(instance.isOpen(),false);
  assert.deepEqual(events,['before','open','close']);
});

test('Escape closes the fallback with focus return and stays the page keyboard gate',()=>{
  const f=fixture();
  const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
  instance.open();
  const event=makeEvent('keydown',{key:'Escape'});
  f.document.dispatchEvent(event);
  assert.equal(instance.isOpen(),false);
  assert.equal(event.defaultPrevented,true,'an owned popover dismissal keeps later page shortcuts out of the way');
  assert.equal(f.document.activeElement,f.trigger);
});

test('outside pointer and outside focus dismiss the fallback without stealing the intentional target',()=>{
  for(const kind of ['pointerdown','focusin']){
    const f=fixture(),outside=f.document.make('button','outside');
    const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
    instance.open();
    outside.focus();
    if(kind==='pointerdown')f.document.dispatchEvent(makeEvent('pointerdown'));
    else f.document.dispatchEvent(makeEvent('focusin'));
    assert.equal(instance.isOpen(),false,'an outside '+kind+' light-dismisses the fallback');
    assert.equal(f.document.activeElement,outside,'the intentional outside target keeps focus');
  }
});

test('dismissal never closes on its own trigger or popover interior and an old close cannot steal a newer modal',()=>{
  const f=fixture();
  const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
  instance.open();
  f.trigger.emit('pointerdown');
  f.first.emit('pointerdown');
  assert.equal(instance.isOpen(),true,'presses on the trigger or inside the popover are not light dismissal');
  const dialog=f.document.make('dialog','modal');
  dialog.showModal();
  dialog.focus();
  instance.close();
  assert.equal(f.document.activeElement,dialog,'focus stays in the newer modal instead of moving to an old trigger');
});

test('a detached, hidden, display:none or visibility:hidden trigger never takes return focus',()=>{
  for(const unusable of ['detached','hidden','display:none','visibility:hidden']){
    const f=fixture();
    const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
    instance.open();
    if(unusable==='detached'){f.trigger.remove();f.trigger.isConnected=false;}
    if(unusable==='hidden')f.trigger.hidden=true;
    if(unusable==='display:none')f.trigger._visible=false;
    if(unusable==='visibility:hidden')f.trigger.style.visibility='hidden';
    f.document.activeElement=null;
    assert.doesNotThrow(()=>instance.close(),'closing with an unusable trigger must stay safe');
    assert.equal(instance.isOpen(),false);
    assert.equal(f.document.activeElement,null,'an unusable trigger is never focused blindly');
    if(unusable==='visibility:hidden')assert.ok(f.document.computedReads>0,'computed visibility is actually read, not pretended by a state marker');
  }
});

test('a fallback popover replaces an older one without letting the old close steal focus',()=>{
  const f=fixture();
  const first=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
  const other=f.document.make('div','menu',{popover:'auto'}),otherTrigger=f.document.make('button','menu-trigger');
  const second=mountPopover({document:f.document,element:other,trigger:otherTrigger});
  first.open();
  second.open();
  assert.equal(first.isOpen(),false,'the fallback keeps the popover=auto one-at-a-time semantics');
  assert.equal(second.isOpen(),true);
  assert.equal(f.document.activeElement!==f.trigger,true,'the replaced popover did not move focus back to its trigger');
});

// ---- filter panel (library page) -------------------------------------------
function filterFixture({native}={}){
  const document=new Doc({native:!!native});
  const root=document.make('section','filter-root');
  const make=(tag,id,attrs={},parent=root)=>{const node=document.createElement(tag);node.id=id;for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);parent.append(node);return node;};
  const trigger=make('button','shelf-filter-button',{'popovertarget':'shelf-filter-panel','aria-expanded':'false','aria-controls':'shelf-filter-panel'});
  const panel=make('div','shelf-filter-panel',{popover:'auto'});
  const search=make('input','book-search'),chips=make('div','shelf-filter-chips'),clear=make('button','shelf-filter-clear');
  const selection=make('div','shelf-filter-selection'),count=make('span','shelf-filter-count');
  const states=['all','reading','unread','finished'].map(name=>make('button','status-'+name,{'data-reading-status':name}));
  const fields={};
  for(const id of ['shelf-source','shelf-topic','shelf-language']){
    const select=make('select',id,{},panel);Object.defineProperty(select,'options',{get:()=>select.children,configurable:true});
    for(const value of id==='shelf-source'?['all','public','private']:['all']){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
    fields[id]=select;
  }
  if(native)trigger.addEventListener('click',()=>panel._nativeOpen?panel.hidePopover():panel.showPopover());
  return {document,root,trigger,panel,search,chips,clear,selection,count,states,fields};
}
const books=[{bookId:'b1',visibility:'private',sourceLanguage:'zh',topics:['fiction'],title:{zh:'合成小说'}}];

test('the filter panel reports open/close once to the URL history owner and clears a choice onto its own control',async()=>{
  for(const native of [false,true]){
    const f=filterFixture({native}),openChanges=[];
    const controls=mountShelfFilters({root:f.root,onChange:()=>{},onOpenChange:open=>openChanges.push(open)});
    controls.update(books);
    const panel=mountPopover({document:f.document,element:f.panel});
    assert.equal(controls.choices.topic.mode,'chips');
    assert.equal(panel.isOpen(),false,'the initial closed state is closed in both branches');
    f.trigger.emit('click');
    assert.deepEqual(openChanges,[true],'the history overlay is pushed exactly once');
    await tick();
    assert.deepEqual(openChanges,[true],'the queued native toggle cannot push the history overlay twice');
    controls.set({topic:'fiction'});
    controls.update(books);
    const chip=f.chips.children[0];
    chip.emit('click');
    assert.equal(f.document.activeElement,controls.choices.topic.chips[0],'clearing a choice with the panel open lands on the owning choice control');
    if(native)f.trigger.emit('click');
    else f.document.dispatchEvent(makeEvent('pointerdown'));
    assert.deepEqual(openChanges,[true,false],'the history overlay is dismissed exactly once');
    if(!native)assert.equal(f.document.activeElement,controls.choices.topic.chips[0],'an intentional outside target keeps focus on dismiss');
    f.chips.replaceChildren();
    controls.set({topic:'fiction'});controls.update(books);
    f.chips.children[0].emit('click');
    assert.equal(f.document.activeElement,f.trigger,'with the panel closed a cleared choice falls back to the connected trigger');
  }
});

// ---- dynamic book menu (library page) --------------------------------------
function bookActionsFixture({native}={}){
  const document=new Doc({native:!!native});
  const previous={document:globalThis.document,window:globalThis.window,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
  globalThis.document=document;globalThis.window=new EventTarget();globalThis.innerWidth=1200;globalThis.innerHeight=900;
  const cards=[0,1].map(index=>{const card=document.make('article','book-card');card.dataset.bookId='book-'+index;return card;});
  const books=[{bookId:'book-0',visibility:'private',title:{zh:'第一本'}},{bookId:'book-1',visibility:'private',title:{zh:'第二本'}}];
  const actions=mountLibraryBookActions({api:async()=>({}),getSession:()=>({user:{id:'owner'}}),getBooks:()=>books,getOwner:()=> 'owner',getRevision:()=>0,setRevision:()=>{},onReorder:()=>{},onChanged:async()=>{},openAuth:()=>{}});
  const triggers=cards.map((card,index)=>actions.decorate(card,books[index]));
  return {document,cards,books,actions,triggers,restore(){for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('the dynamic book menu keeps its actual current trigger and clears it on owner reset',t=>{
  const f=bookActionsFixture();
  t.after(f.restore);
  const [first,second]=f.triggers;
  first.emit('click');
  const menu=f.document.getElementById('library-book-menu');
  assert.equal(menu.hasAttribute(OPEN),true);
  assert.equal(first.getAttribute('aria-expanded'),'true','the menu reports its real trigger only');
  assert.equal(second.getAttribute('aria-expanded'),'false');
  second.emit('click');
  assert.equal(first.getAttribute('aria-expanded'),'false','an older trigger is cleared when the menu moves on');
  assert.equal(second.getAttribute('aria-expanded'),'true');
  f.document.dispatchEvent(makeEvent('keydown',{key:'Escape'}));
  assert.equal(menu.hasAttribute(OPEN),false);
  assert.equal(f.document.activeElement,second,'Escape returns to the trigger that actually opened the menu');
  second.emit('click');
  const focused=f.document.activeElement;
  f.actions.clear();
  assert.equal(menu.hasAttribute(OPEN),false,'an owner reset cancels the open menu');
  assert.equal(second.getAttribute('aria-expanded'),'false','owner reset clears the trigger state');
  assert.equal(f.document.activeElement,focused,'an owner reset never steals focus back to a stale trigger');
});

// ---- reader book info (bookplate) ------------------------------------------
function readerFixture({native=false,order='navigation-first'}={}){
  const document=new Doc({native:!!native});
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  globalThis.document=document;globalThis.window=new EventTarget();globalThis.location={origin:'https://fixture.invalid'};
  const ids=['open-book-info','book-info','close-book-info','reading-header','book-info-title','book-info-cover-title','book-info-original-title','book-info-author','book-info-description','book-info-extent','book-info-current','book-info-sample','book-info-scope','book-info-source','book-intro-generate','book-intro-login','book-info-share','book-intro-status','book-intro-provenance','book-intro-scope'];
  for(const id of ids)document.make(id==='book-info'?'section':'div',id,id==='book-info'?{popover:'auto',tabindex:'-1'}:id==='open-book-info'?{'popovertarget':'book-info','aria-expanded':'false','aria-controls':'book-info'}:{});
  const info=document.getElementById('book-info'),trigger=document.getElementById('open-book-info');
  if(native)trigger.addEventListener('click',()=>info._nativeOpen?info.hidePopover():info.showPopover());
  const calls={intro:0,onOpen:0};
  const book={bookId:'fixture-book',contentVersion:'v1',title:{zh:'一本书'},author:'作者',chapters:[{id:'ch1',number:1,title:{zh:'第一章'}}],sections:[{chapterId:'ch1',number:1,title:'一',paragraphs:[{id:'p1'}]}],source:{}};
  let handle=null;
  const mountNavigation=()=>mountBookIntroduction({document,getBook:()=>book,getChapter:()=>book.chapters[0],onOpen:()=>calls.onOpen++});
  const mountActions=()=>mountReaderBookActions({document,info:handle,getBook:()=>book,api:async url=>{if(String(url).endsWith('/introduction'))calls.intro++;return {source:'ai',text:'介绍'};},session:{user:{id:'fixture-owner'}},bookId:book.bookId,loadGiftComposer:()=>Promise.resolve({})});
  if(order==='navigation-first'){handle=mountNavigation();mountActions();}
  else{handle=mountPopover({document,element:info,trigger});mountActions();handle=mountNavigation();}
  return {document,book,calls,handle,restore(){for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('navigation and book actions share one book-info owner and the lifecycle runs once per transition in both mount orders',async t=>{
  for(const native of [false,true]){
    for(const order of ['navigation-first','book-actions-first']){
      const f=readerFixture({native,order});
      t.after(f.restore);
      const trigger=f.document.getElementById('open-book-info'),info=f.document.getElementById('book-info'),close=f.document.getElementById('close-book-info');
      const instance=mountPopover({document:f.document,element:info});
      assert.equal(instance.trigger,trigger,'the registry keeps the real trigger owned by the bookplate');
      trigger.emit('click');
      assert.equal(instance.isOpen(),true);
      assert.equal(f.calls.onOpen,1,'the bookplate renders once per open even when navigation mounted later');
      assert.equal(trigger.getAttribute('aria-expanded'),'true');
      await tick();
      assert.equal(f.calls.onOpen,1,'a queued native toggle cannot rerun the open lifecycle');
      assert.equal(f.calls.intro,1,'the introduction lifecycle loads exactly once per open');
      close.emit('click');
      assert.equal(f.calls.intro,1,'closing never restarts the introduction lifecycle');
      assert.equal(instance.isOpen(),false);
      assert.equal(trigger.getAttribute('aria-expanded'),'false');
      assert.equal(f.document.activeElement,trigger,'the close control returns to the connected title trigger');
    }
  }
});

// ---- command palette deferral ----------------------------------------------
test('the palette shortcut defers while a fallback popover is open and recovers after close',async()=>{
  const f=fixture(),loads=[];
  f.document.make('button','palette-open',{'data-palette-open':''});
  f.document.make('span','palette-keycap',{'data-palette-keycap':''});
  const tools=mountPaletteBootstrap({document:f.document,navigator:{userAgentData:{platform:'macOS'}},matchMedia:()=>({matches:true}),loadPalette:async()=>{loads.push(1);return {openCommandPalette(){}};}});
  const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
  const press=()=>f.document.dispatchEvent(makeEvent('keydown',{key:'k',metaKey:true}));
  instance.open();
  press();
  await tick();
  assert.deepEqual(loads,[],'an open popover defers the palette modal');
  instance.close();
  press();
  await tick();
  assert.deepEqual(loads,[1],'the shortcut works again once the popover is closed');
  assert.ok(tools);
});

test('the shared safe overlay query covers popovers without evaluating :popover-open',()=>{
  const f=fixture();
  const instance=mountPopover({document:f.document,element:f.element,trigger:f.trigger});
  assert.equal(overlayOpen(f.document),false);
  instance.open();
  assert.equal(overlayOpen(f.document),true);
  instance.close();
  const dialog=f.document.make('dialog','chat-dialog');
  dialog.classList.add('library-chat-dialog');
  dialog.showModal();
  assert.equal(overlayOpen(f.document),true);
  assert.equal(overlayOpen(f.document,'dialog[open]:not(.library-chat-dialog)'),false,'callers can scope their own dialog class');
});
