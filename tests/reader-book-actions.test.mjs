import {requestUiRoute as initializeLegacyUi} from '../app/ui-locale.mjs';
await initializeLegacyUi('zh-Hans');
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderBookActions} from '../app/reader-book-actions.mjs';
import {mountPopover} from '../app/popover-controls.mjs';
import {readingBook} from './reading-fixtures.mjs';
const giftModules=async()=>Object.assign({},...await Promise.all([import('../app/gift-compose.mjs'),import('../app/book-binding.mjs')]));

function mount(t,{sourceBook=readingBook,response={gifts:[]},loadGiftComposer,openInfo=false,brokenInfo=false}={}){
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  const document=new EventTarget(),map=new Map();
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.value='';this.textContent='';this.ownerDocument=document;this.isConnected=true;this.classList={add(){},remove(){}};this.contentWindow={postMessage(){}};}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    prepend(node){node.parentElement=this;this.children.unshift(node);}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    remove(){const parent=this.parentElement;if(!parent)return;const index=parent.children.indexOf(this);parent.children.splice(index,1);this.parentElement=null;}
    setAttribute(key,value){this.attributes[key]=String(value);}
    getAttribute(key){return this.attributes[key]===undefined?null:this.attributes[key];}
    hasAttribute(key){return this.attributes[key]!==undefined;}
    removeAttribute(key){delete this.attributes[key];}
    toggleAttribute(key,force){const on=force===undefined?!this.hasAttribute(key):!!force;if(on)this.attributes[key]='';else delete this.attributes[key];return on;}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    matches(selector){if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return false;}
    querySelector(){return null;}
    showModal(){this.open=true;}
    close(){this.open=false;this.dispatchEvent(new Event('close'));}
    focus(){document.activeElement=this;}
  }
  document.body=new Element('body');document.createElement=tag=>new Element(tag);document.getElementById=id=>map.get(id);
  document.defaultView={location:{assign(){}}};document.activeElement=document.body;
  for(const id of ['book-info','open-book-info','book-intro-generate','book-intro-login','book-info-share','book-intro-status','book-intro-provenance','book-intro-scope','book-info-description']){const node=new Element('div');node.id=id;map.set(id,node);document.body.append(node);}
  globalThis.document=document;globalThis.window=new EventTarget();globalThis.location={origin:'https://fixture.invalid'};
  t.after(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  const calls=[];let book=structuredClone(sourceBook);
  // The one shared popover handle is created exactly as the reader page does
  // and injected into the lazy enhancement; this module may never create its
  // own second registry copy.
  const info=brokenInfo?{subscribe(){throw Error('setup failure');},close(){},isOpen:()=>false,setTrigger(){}}:mountPopover({document,element:map.get('book-info'),trigger:map.get('open-book-info')});
  let setupError=null,actions=null;
  try{actions=mountReaderBookActions({document,info,getBook:()=>book,bookId:book.bookId,session:{user:{id:'fixture-owner'}},...(loadGiftComposer?{loadGiftComposer}:{}),api:async(url,data)=>{calls.push({url,data});return typeof response==='function'?response(url,data):response;}});}
  catch(error){setupError=error;}
  const all=node=>[node,...node.children.flatMap(all)],find=text=>all(document.body).find(node=>node.textContent===text),id=value=>all(document.body).find(node=>node.id===value),click=node=>node.dispatchEvent(new Event('click'));
  const openInfoPanel=()=>click(id('open-book-info'));
  if(openInfo&&!setupError)openInfoPanel();
  return {document,calls,find,id,click,info,actions,setupError,openInfo:openInfoPanel,ready:async()=>{await giftModules();await new Promise(setImmediate);},settle:async()=>{for(let i=0;i<8;i++)await Promise.resolve();},getBook:()=>book,changeBook:()=>book={...book,contentVersion:'next-version'}};
}

test('reader accepts the server-validated introduction before its opening chapter is loaded',async t=>{
  const book=structuredClone(readingBook),value={kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text:'Opening sample introduction.',contentVersion:book.contentVersion,createdAt:'2026-10-18T00:00:00Z',model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:['p1']};
  book.reading={loadedChapters:['ch02']};book.sections[0].paragraphs=book.sections[0].paragraphs.map(({original,...p})=>({...p,unloaded:true}));
  const f=mount(t,{sourceBook:book,response:{source:'ai',text:value.text,introduction:value,available:true}});
  f.openInfo();
  await new Promise(setImmediate);
  assert.deepEqual(f.getBook().introduction,value);assert.equal(f.id('book-info-description').textContent,value.text);assert.equal(f.id('book-intro-status').textContent,'');
  assert.equal(f.id('book-info').getAttribute('hidden'),null,'the shared popover controller opens through the owned marker');
});

test('mounting the enhancement while the bookplate already shows processes that open exactly once',async t=>{
  const f=mount(t,{openInfo:true,response:{source:'ai',text:'介绍',available:true}});
  await new Promise(setImmediate);
  assert.equal(f.info.isOpen(),true);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/introduction')).length,1,'the introduction reads exactly once for one open state');
  f.info.close();
  assert.equal(f.calls.filter(call=>call.url.endsWith('/introduction')).length,1,'closing never restarts the read');
});

test('dispose unsubscribes and disables the old controls before an owner or session leave',async t=>{
  const f=mount(t,{openInfo:true,response:{source:'missing',available:true}});
  await new Promise(setImmediate);
  assert.equal(f.id('book-intro-generate').hidden,false);
  const reads=f.calls.filter(call=>call.url.endsWith('/introduction')).length;
  assert.equal(reads,1);
  f.actions.dispose();
  f.info.close();f.openInfo();
  await new Promise(setImmediate);
  assert.equal(f.id('book-intro-generate').hidden,true,'a disposed enhancement keeps stale controls disabled');
  assert.equal(f.calls.filter(call=>call.url.endsWith('/introduction')).length,reads,'no stale read after dispose');
});

test('a captured stale action after terminal dispose calls no API and never re-enables controls',async t=>{
  const f=mount(t,{openInfo:true,response:{source:'missing',available:true}});
  await new Promise(setImmediate);
  const reads=f.calls.filter(call=>call.url.endsWith('/introduction')).length;
  assert.equal(reads,1);
  f.actions.dispose();
  f.click(f.id('book-intro-generate'));
  f.actions.render();
  await f.settle();
  assert.equal(f.calls.filter(call=>call.url.endsWith('/introduction')).length,reads,'a stale captured generate action after dispose calls no introduction API');
  assert.equal(f.calls.length,reads,'no paid call of any kind after dispose');
  assert.equal(f.id('book-info-share').disabled,true,'dispose keeps the old controls disabled even through a stale render');
});

test('a pending gift import after terminal dispose never constructs the gift controller',async t=>{
  let resolveGift,mounts=0,opens=0;
  const f=mount(t,{loadGiftComposer:()=>new Promise(resolve=>{resolveGift=resolve;})});
  f.click(f.id('book-info-share'));
  f.actions.dispose();
  resolveGift({mountGiftComposer(){mounts++;return {open(){opens++;},clear(){}};},paintBookCover(){}});
  await f.settle();
  assert.equal(mounts,0,'a late module is cached code only and never constructs a gift controller after dispose');
  assert.equal(opens,0);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/gifts')&&call.data!==undefined).length,0,'a disposed enhancement never publishes');
});

test('an enhancement setup failure rolls back its partial listeners and DOM',async t=>{
  const f=mount(t,{brokenInfo:true});
  assert.equal(f.setupError?.message,'setup failure');
  assert.equal(f.id('reader-book-gift'),undefined,'a failed setup leaves no gift dialog behind');
  f.click(f.id('book-intro-generate'));
  await f.settle();
  assert.equal(f.calls.length,0,'the partially attached generate listener is rolled back before any retry');
});

test('the open gift dialog is named by its actual visible heading',t=>{
  const f=mount(t,{loadGiftComposer:()=>new Promise(()=>{})});
  const dialog=f.id('reader-book-gift');
  f.click(f.id('book-info-share'));
  assert.equal(dialog.open,true);
  const heading=f.id(dialog.getAttribute('aria-labelledby'));
  assert.ok(heading,'the accessible-name reference resolves to a real heading');
  assert.equal(heading.tagName,'H2');
  assert.equal(heading.textContent,'写一封赠书信');
  assert.equal(f.calls.length,0,'naming the dialog does not request gift or model data');
});

test('reader gift close returns focus and keeps the unsent draft for this book',async t=>{
  const f=mount(t);f.click(f.id('book-info-share'));await f.ready();
  f.id('gift-recipient').value='An unsent reader';f.id('gift-recipient').dispatchEvent(new Event('input'));f.id('gift-message').value='An unsent letter';f.id('gift-message').dispatchEvent(new Event('input'));
  f.click(f.find('×'));assert.equal(f.document.activeElement.id,'open-book-info');
  f.click(f.id('book-info-share'));await f.ready();
  assert.equal(f.id('gift-recipient').value,'An unsent reader');assert.equal(f.id('gift-message').value,'An unsent letter');
  assert.ok(f.calls.some(call=>call.url.endsWith('/gift-quote')),'existing quote preparation remains available');
  assert.ok(f.calls.filter(call=>call.url.endsWith('/gifts')).every(call=>call.data===undefined),'opening and closing must never publish a gift');
});

test('a new source version closes the old gift and disables its captured seal action',async t=>{
  const f=mount(t);f.click(f.id('book-info-share'));await f.ready();f.click(f.find('看看收信时的样子'));const seal=f.find('封好这封信，生成链接');
  f.changeBook();f.document.dispatchEvent(new Event('reader:ready'));assert.equal(f.id('reader-book-gift').open,false);f.click(seal);await new Promise(setImmediate);assert.ok(f.calls.filter(call=>call.url.endsWith('/gifts')).every(call=>call.data===undefined),'old captured seal must never publish after the source changes');
});

test('gift code loads only after explicit share, once, and closing fences the delayed open',async t=>{
  let resolve,loads=0;const f=mount(t,{loadGiftComposer:()=>{loads++;return new Promise(r=>resolve=r);}});
  assert.equal(loads,0);assert.equal(f.calls.length,0);
  f.click(f.id('book-info-share'));f.click(f.id('book-info-share'));
  assert.equal(loads,1);assert.equal(f.id('reader-book-gift').open,true);assert.equal(f.id('gift-recipient'),undefined);
  f.click(f.find('×'));resolve(await giftModules());await f.ready();
  assert.equal(f.id('reader-book-gift').open,false);assert.equal(f.calls.length,0);assert.equal(f.id('gift-recipient'),undefined);
  f.click(f.id('book-info-share'));await f.ready();assert.equal(loads,1);assert.ok(f.id('gift-recipient'));
  assert.ok(f.calls.filter(call=>call.url.endsWith('/gifts')).every(call=>call.data===undefined));
});

test('a new source version during gift loading never opens or prepares the old book',async t=>{
  let resolve;const f=mount(t,{loadGiftComposer:()=>new Promise(r=>resolve=r)});
  f.click(f.id('book-info-share'));f.changeBook();f.document.dispatchEvent(new Event('reader:ready'));
  resolve(await giftModules());await f.ready();
  assert.equal(f.id('reader-book-gift').open,false);assert.equal(f.id('gift-recipient'),undefined);assert.equal(f.calls.length,0);
});

test('a failed gift import leaves an honest error and permits a later explicit retry',async t=>{
  let loads=0;const f=mount(t,{loadGiftComposer:async()=>{if(++loads===1)throw Error('module unavailable');return giftModules();}});
  f.click(f.id('book-info-share'));await new Promise(setImmediate);
  const status=f.id('reader-book-gift').children.at(-1);assert.match(status.textContent,/暂时无法打开/);assert.equal(status.attributes.role,'alert');
  assert.equal(f.calls.length,0);f.click(f.find('×'));f.click(f.id('book-info-share'));await f.ready();
  assert.equal(loads,2);assert.ok(f.id('gift-recipient'));assert.ok(f.calls.filter(call=>call.url.endsWith('/gifts')).every(call=>call.data===undefined));
});

test('reopening while gift code is pending adopts only the newest explicit share',async t=>{
  let resolve,loads=0;const f=mount(t,{loadGiftComposer:()=>{loads++;return new Promise(r=>resolve=r);}});
  f.click(f.id('book-info-share'));f.click(f.find('×'));f.click(f.id('book-info-share'));f.click(f.id('book-info-share'));
  resolve(await giftModules());await f.ready();
  assert.equal(loads,1);assert.ok(f.id('gift-recipient'));assert.equal(f.calls.filter(call=>call.url.endsWith('/gift-quote')).length,1);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/gifts')).length,1);assert.equal(f.calls.find(call=>call.url.endsWith('/gifts')).data,undefined);
});

test('lazy sharing still publishes only once after the explicit seal action',async t=>{
  let finish;const f=mount(t,{response:(url,data)=>url.endsWith('/gifts')&&data?new Promise(r=>finish=r):{gifts:[]}});
  f.click(f.id('book-info-share'));await f.ready();f.click(f.find('看看收信时的样子'));
  assert.equal(f.calls.filter(call=>call.url.endsWith('/gifts')&&call.data!==undefined).length,0);
  const seal=f.find('封好这封信，生成链接');f.click(seal);f.click(seal);
  assert.equal(f.calls.filter(call=>call.url.endsWith('/gifts')&&call.data!==undefined).length,1);
  finish({token:'A'.repeat(43),recipient:'A reader'});await new Promise(setImmediate);
  assert.ok(f.find('这封信已封好。'));
});
