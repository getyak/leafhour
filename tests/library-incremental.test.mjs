import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {moveShelfBook} from '../app/shelf-order.mjs';

const moduleUrl=new URL('../app/library-incremental.mjs',import.meta.url);
let mountIncrementalShelf;
try{({mountIncrementalShelf}=await import(moduleUrl));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||error.url!==moduleUrl.href)throw error;}
const books=Array.from({length:200},(_,i)=>({bookId:'book-'+i}));

function fixture({observe=true}={}){
  assert.equal(typeof mountIncrementalShelf,'function','The shelf needs its bounded rendering controller');
  const frames=new Map(),observers=[];let frame=0;
  const doc={activeElement:null,defaultView:{requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id)}};
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attrs={};this.listeners=new Map();this.hidden=false;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(name,value){this.attrs[name]=String(value);}
    getAttribute(name){return this.attrs[name]??null;}
    addEventListener(type,fn){this.listeners.set(type,fn);}
    removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
    focus(){doc.activeElement=this;}
    querySelector(){for(const child of this.children){if(child.tagName==='A'||child.tagName==='BUTTON')return child;const found=child.querySelector();if(found)return found;}return null;}
  }
  doc.createElement=tag=>new Node(tag);
  if(observe)doc.defaultView.IntersectionObserver=class{
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(){}
    unobserve(){}
    disconnect(){this.disconnected=true;}
    enter(){this.callback([{isIntersecting:true}]);}
  };
  const grid=new Node('div'),controls=new Node('div');
  const list=mountIncrementalShelf({grid,controls,renderItem:book=>{const card=new Node('article');card.bookId=book.bookId;const link=new Node('a');link.setAttribute('href','/read?book='+book.bookId);card.append(link);return card;}});
  return {list,grid,controls,doc,observers,button:()=>controls.children.find(n=>n.tagName==='BUTTON'),ids:()=>grid.children.map(n=>n.bookId),flush:()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}

test('a large shelf starts with 12 and appends every book once without replacing existing cards',()=>{
  const f=fixture();f.list.setItems(books,{key:'owner-a'});
  assert.deepEqual(f.ids(),books.slice(0,12).map(b=>b.bookId));
  const first=f.grid.children[0];
  while(f.ids().length<books.length)f.button().listeners.get('click')();
  assert.equal(f.grid.children[0],first);assert.deepEqual(f.ids(),books.map(b=>b.bookId));
  assert.equal(new Set(f.ids()).size,200);assert.equal(f.button().hidden,true);
});

test('observer callbacks coalesce per frame and stale owner callbacks cannot reveal old books',()=>{
  const f=fixture();f.list.setItems(books,{key:'owner-a'});
  const old=f.observers.at(-1);old.enter();old.enter();old.enter();f.flush();
  assert.equal(f.ids().length,24);
  old.enter();f.list.setItems([{bookId:'new-owner-book'}],{key:'owner-b'});old.enter();f.flush();
  assert.deepEqual(f.ids(),['new-owner-book']);
  f.list.destroy();old.enter();f.flush();assert.deepEqual(f.ids(),['new-owner-book']);
});

test('same-scope refresh preserves the window; filtering and logout reset it',()=>{
  const f=fixture();f.list.setItems(books,{key:'owner-a:all'});f.button().listeners.get('click')();
  f.list.setItems([...books],{key:'owner-a:all'});assert.equal(f.ids().length,24);
  f.list.setItems(books.slice(100),{key:'owner-a:search'});assert.deepEqual(f.ids(),books.slice(100,112).map(b=>b.bookId));
  f.list.setItems([],{key:'guest'});assert.deepEqual(f.ids(),[]);assert.equal(f.controls.hidden,true);
});

test('whole-shelf ordering retains unrendered books and can reveal an explicitly moved focused book',()=>{
  const f=fixture();f.list.setItems(books,{key:'owner-a'});
  const order=moveShelfBook(books.map(b=>b.bookId),'book-1','book-150','after');
  const byId=new Map(books.map(b=>[b.bookId,b]));f.list.setItems(order.map(id=>byId.get(id)),{key:'owner-a',anchorId:'book-1'});
  assert.ok(f.ids().includes('book-1'));assert.ok(f.ids().length<200);
  assert.equal(order.length,200);assert.equal(order.at(-1),'book-199');assert.equal(books[1].bookId,'book-1');
});

test('manual loading keeps keyboard focus useful and works without IntersectionObserver',()=>{
  const f=fixture({observe:false});f.list.setItems(books,{key:'owner-a'});
  const first=f.grid.children[0];first.children[0].focus();f.button().listeners.get('click')();
  assert.equal(f.doc.activeElement,first.children[0]);
  f.button().focus();f.button().listeners.get('click')();
  assert.equal(f.doc.activeElement,f.grid.children[24].children[0]);assert.equal(f.ids().length,36);
});

test('automatic loading never moves focus from an existing book',()=>{
  const f=fixture();f.list.setItems(books,{key:'owner-a'});const anchor=f.grid.children[0].children[0];anchor.focus();
  f.observers.at(-1).enter();f.flush();assert.equal(f.doc.activeElement,anchor);assert.equal(f.grid.children[0].children[0],anchor);
});

test('the local production server serves the imported shelf module as JavaScript',async t=>{
  const {createReaderServer}=await import('../server/server.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'get166-static-'));
  const server=await createReaderServer({bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null,env:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/library-incremental.mjs');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
  assert.equal(await response.text(),await readFile(moduleUrl,'utf8'));
});


test('destroy releases locale and deferred-ready updates without touching retained card nodes',async()=>{
  const {requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
  const f=fixture();f.list.setItems(books,{key:'a'});await new Promise(setImmediate);
  const nodes=[...f.controls.children,...f.grid.children],labels=nodes.map(x=>x.textContent);
  f.list.destroy();await requestUiRoute('ja');
  try{assert.deepEqual([...f.controls.children,...f.grid.children],nodes);assert.deepEqual(nodes.map(x=>x.textContent),labels);assert.equal(f.button().listeners.has('click'),false);}
  finally{await requestUiRoute('en');}
});
