import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderBookActions} from '../app/reader-book-actions.mjs';
import {readingBook} from './reading-fixtures.mjs';
const giftModules=async()=>Object.assign({},...await Promise.all([import('../app/gift-compose.mjs'),import('../app/book-binding.mjs')]));

function mount(t,{sourceBook=readingBook,response={gifts:[]},loadGiftComposer}={}){
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  const document=new EventTarget(),map=new Map();
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.value='';this.textContent='';this.ownerDocument=document;this.isConnected=true;this.classList={add(){},remove(){}};this.contentWindow={postMessage(){}};}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    prepend(node){node.parentElement=this;this.children.unshift(node);}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(key,value){this.attributes[key]=String(value);}
    removeAttribute(key){delete this.attributes[key];}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    matches(){return !!this.popoverOpen;}
    hidePopover(){this.popoverOpen=false;const event=new Event('toggle');Object.defineProperty(event,'newState',{value:'closed'});this.dispatchEvent(event);}
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
  mountReaderBookActions({document,getBook:()=>book,bookId:book.bookId,session:{user:{id:'fixture-owner'}},...(loadGiftComposer?{loadGiftComposer}:{}),api:async(url,data)=>{calls.push({url,data});return typeof response==='function'?response(url,data):response;}});
  const all=node=>[node,...node.children.flatMap(all)],find=text=>all(document.body).find(node=>node.textContent===text),id=value=>all(document.body).find(node=>node.id===value),click=node=>node.dispatchEvent(new Event('click'));
  return {document,calls,find,id,click,ready:async()=>{await giftModules();await new Promise(setImmediate);},getBook:()=>book,changeBook:()=>book={...book,contentVersion:'next-version'}};
}

test('reader accepts the server-validated introduction before its opening chapter is loaded',async t=>{
  const book=structuredClone(readingBook),value={kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text:'Opening sample introduction.',contentVersion:book.contentVersion,createdAt:'2026-10-18T00:00:00Z',model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:['p1']};
  book.reading={loadedChapters:['ch02']};book.sections[0].paragraphs=book.sections[0].paragraphs.map(({original,...p})=>({...p,unloaded:true}));
  const f=mount(t,{sourceBook:book,response:{source:'ai',text:value.text,introduction:value,available:true}});
  const event=new Event('toggle');Object.defineProperty(event,'newState',{value:'open'});f.id('book-info').dispatchEvent(event);await new Promise(setImmediate);
  assert.deepEqual(f.getBook().introduction,value);assert.equal(f.id('book-info-description').textContent,value.text);assert.equal(f.id('book-intro-status').textContent,'');
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
