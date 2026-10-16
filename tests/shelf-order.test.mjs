import test from 'node:test';
import assert from 'node:assert/strict';
import * as shelf from '../app/shelf-order.mjs';
test('moving a visible book preserves the current read and filtered-out books',()=>{
  assert.equal(typeof shelf.moveShelfBook,'function');
  const ids=['current','a','hidden','b','c'];
  assert.deepEqual(shelf.moveShelfBook(ids,'c','a','before'),['current','c','a','hidden','b']);
  assert.deepEqual(shelf.moveShelfBook(ids,'a','b','after'),['current','hidden','b','a','c']);
  assert.deepEqual(ids,['current','a','hidden','b','c']);
});
test('unknown, duplicate and self moves cannot silently lose or duplicate a book',()=>{
  assert.equal(typeof shelf.moveShelfBook,'function');
  assert.deepEqual(shelf.moveShelfBook(['a','b'],'a','a','after'),['a','b']);
  assert.throws(()=>shelf.moveShelfBook(['a','b'],'other','b','before'));
  assert.throws(()=>shelf.moveShelfBook(['a','a'],'a','a','after'));
  assert.throws(()=>shelf.moveShelfBook(['a','b'],'a','b','sideways'));
});

function dragFixture(){
 const handlers=new Map(),orders=[],set=()=>{const values=new Set();return {add:(...names)=>names.forEach(n=>values.add(n)),remove:(...names)=>names.forEach(n=>values.delete(n)),contains:n=>values.has(n)};};
 let removed=false;
 const ghost={classList:set(),style:{},setAttribute(){},remove(){removed=true;}};
 const cover={offsetWidth:160,offsetHeight:220,getBoundingClientRect:()=>({left:0,top:0,width:160,height:220}),cloneNode:()=>ghost};
 const card=(id,left)=>({dataset:{bookId:id},classList:set(),querySelector:()=>cover,getBoundingClientRect:()=>({left,right:left+180,top:0,bottom:250,width:180,height:250}),closest(){return this;}});
 const a=card('a',0),b=card('b',220),cards=[a,b],art={closest:selector=>selector==='.book-art'?art:selector==='.book-card[data-book-id]'?a:null},handle={closest:selector=>selector==='.book-drag-handle'?handle:selector==='.book-card[data-book-id]'?a:null,setPointerCapture(){}};
 const grid={classList:set(),querySelectorAll:()=>cards,addEventListener:(type,fn)=>handlers.set(type,fn),contains:n=>cards.includes(n),getBoundingClientRect:()=>({left:0,right:400,top:0,bottom:300}),append(){}};
 globalThis.document={elementFromPoint:()=>b};globalThis.window={addEventListener(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 shelf.mountShelfDrag({grid,getBooks:()=>[{bookId:'current'},{bookId:'a'},{bookId:'b'}],getOwner:()=> 'fixture',onReorder:ids=>orders.push(ids)});
 const event=target=>({target,clientX:390,clientY:80,pointerId:7,button:0,preventDefault(){this.prevented=true;},dataTransfer:{setData(){},setDragImage(){}}});
 return {handlers,grid,art,handle,event,orders,removed:()=>removed};
}
test('the native drag handoff pointercancel does not discard a cover before its drop',async()=>{
 const f=dragFixture();f.handlers.get('dragstart')(f.event(f.art));f.handlers.get('pointercancel')(f.event(f.art));
 assert.equal(f.grid.classList.contains('is-sorting'),true);
 const over=f.event(f.art);f.handlers.get('dragover')(over);assert.equal(over.prevented,true);
 f.handlers.get('drop')(f.event(f.art));await new Promise(setImmediate);
 assert.deepEqual(f.orders,[['current','b','a']]);assert.equal(f.grid.classList.contains('is-sorting'),false);
});
test('a cancelled pointer handle gesture still removes its ghost without saving order',()=>{
 const f=dragFixture();f.handlers.get('pointerdown')(f.event(f.handle));assert.equal(f.grid.classList.contains('is-sorting'),true);
 f.handlers.get('pointercancel')(f.event(f.handle));assert.equal(f.grid.classList.contains('is-sorting'),false);assert.equal(f.removed(),true);assert.equal(f.orders.length,0);
});
