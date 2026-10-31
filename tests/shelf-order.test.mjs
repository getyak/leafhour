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

function dragFixture({getOwner=()=> 'fixture'}={}){
 const handlers=new Map(),orders=[],set=()=>{const values=new Set();return {add:(...names)=>names.forEach(n=>values.add(n)),remove:(...names)=>names.forEach(n=>values.delete(n)),contains:n=>values.has(n)};};
 let removed=false;
 const ghost={classList:set(),style:{},setAttribute(){},remove(){removed=true;}};
 const cover={offsetWidth:160,offsetHeight:220,getBoundingClientRect:()=>({left:0,top:0,width:160,height:220}),cloneNode:()=>ghost};
 const card=(id,left)=>({dataset:{bookId:id},classList:set(),querySelector:()=>cover,getBoundingClientRect:()=>({left,right:left+180,top:0,bottom:250,width:180,height:250}),closest:selector=>selector==='.book-card[data-book-id]'?cards.find(c=>c.dataset.bookId===id):null,setPointerCapture(){},releasePointerCapture(){},isConnected:true});
 const a=card('a',0),b=card('b',220),cards=[a,b],art={closest:selector=>selector==='.book-art'||selector==='a'?art:selector==='.book-card[data-book-id]'?a:null,matches:selector=>selector==='.book-art'},handle={closest:selector=>selector==='.book-drag-handle'?handle:selector==='.book-card[data-book-id]'?a:null,setPointerCapture(){}};
 const grid={classList:set(),querySelectorAll:()=>cards,addEventListener:(type,fn)=>handlers.set(type,fn),contains:n=>cards.includes(n),getBoundingClientRect:()=>({left:0,right:400,top:0,bottom:300}),append(){}};
 globalThis.document={elementFromPoint:()=>b,addEventListener:(type,fn)=>handlers.set('document:'+type,fn)};globalThis.window={addEventListener:(type,fn)=>handlers.set('window:'+type,fn)};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const controller=shelf.mountShelfDrag({grid,getBooks:()=>[{bookId:'current'},{bookId:'a'},{bookId:'b'}],getOwner,onReorder:ids=>orders.push(ids)});
 const event=target=>({target,clientX:390,clientY:80,pointerId:7,button:0,preventDefault(){this.prevented=true;},dataTransfer:{setData(){},setDragImage(){}}});
 return {controller,handlers,grid,art,handle,a,b,event,orders,removed:()=>removed};
}
test('recent and publication sorts reject native cover drag and touch long press',async()=>{
 for(const sort of ['recent','added','published-asc','published-desc']){const f=dragFixture();f.grid.dataset={sort};const native=f.event(f.art);f.handlers.get('dragstart')(native);assert.equal(native.prevented,true);assert.equal(f.grid.classList.contains('is-sorting'),false);const touch=f.event(f.art);touch.pointerType='touch';f.handlers.get('pointerdown')(touch);await new Promise(r=>setTimeout(r,470));assert.equal(f.grid.classList.contains('is-sorting'),false);assert.deepEqual(f.orders,[]);}
});
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

// These gestures exercise the same DOM event boundary as a real book card.
test('native dragging a card body preserves the complete hidden catalog',async()=>{
 const f=dragFixture(),start=f.event(f.a);f.handlers.get('dragstart')(start);
 assert.equal(start.prevented,undefined);assert.equal(f.grid.classList.contains('is-sorting'),true);
 f.handlers.get('drop')(f.event(f.a));await new Promise(setImmediate);
 assert.deepEqual(f.orders,[['current','b','a']]);
});
test('touch short tap and an early swipe do not claim reading or scrolling',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=dragFixture(),down={...f.event(f.art),pointerType:'touch',clientX:50,clientY:50};
 f.handlers.get('pointerdown')(down);assert.equal(down.prevented,undefined);
 f.handlers.get('pointerup')({...down});t.mock.timers.tick(500);assert.equal(f.grid.classList.contains('is-sorting'),false);
 f.handlers.get('pointerdown')(down);const swipe={...down,clientY:80};f.handlers.get('pointermove')(swipe);
 assert.equal(swipe.prevented,undefined);t.mock.timers.tick(500);assert.equal(f.grid.classList.contains('is-sorting'),false);assert.equal(f.orders.length,0);
});
test('a held book moves with touch and consumes only the drag-release click',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=dragFixture(),down={...f.event(f.art),pointerType:'touch',clientX:50,clientY:50};
 f.handlers.get('pointerdown')(down);t.mock.timers.tick(450);assert.equal(f.grid.classList.contains('is-sorting'),true);
 const move={...down,clientX:390,clientY:80};f.handlers.get('pointermove')(move);f.handlers.get('pointerup')(move);await new Promise(setImmediate);
 assert.deepEqual(f.orders,[['current','b','a']]);assert.equal(f.removed(),true);
 const click={...f.event(f.art),detail:1,stopImmediatePropagation(){}};f.handlers.get('click')(click);assert.equal(click.prevented,true);
 const next={...f.event(f.art),detail:1};f.handlers.get('click')(next);assert.equal(next.prevented,undefined);
});

test('a changed owner, early cancellation and escape cannot activate a stale hold',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let owner='first';const f=dragFixture({getOwner:()=>owner}),down={...f.event(f.art),pointerType:'touch',clientX:50,clientY:50};
 f.handlers.get('pointerdown')(down);owner='second';t.mock.timers.tick(450);assert.equal(f.grid.classList.contains('is-sorting'),false);
 f.handlers.get('pointerdown')(down);f.handlers.get('pointercancel')(down);t.mock.timers.tick(450);assert.equal(f.grid.classList.contains('is-sorting'),false);
 f.handlers.get('pointerdown')(down);f.handlers.get('keydown')({key:'Escape',preventDefault(){}});t.mock.timers.tick(450);assert.equal(f.grid.classList.contains('is-sorting'),false);assert.equal(f.orders.length,0);
});
test('a second finger, blur and reset release a held book without submitting an order',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=dragFixture(),down={...f.event(f.art),pointerType:'touch',clientX:50,clientY:50};
 for(const cancel of [()=>f.handlers.get('pointerdown')({...down,isPrimary:false}),()=>f.handlers.get('window:blur')(),()=>f.controller.reset()]){
  f.handlers.get('pointerdown')(down);t.mock.timers.tick(450);assert.equal(f.grid.classList.contains('is-sorting'),true);cancel();assert.equal(f.grid.classList.contains('is-sorting'),false);assert.equal(f.removed(),true);
  const scroll={preventDefault(){this.prevented=true;}};f.handlers.get('touchmove')(scroll);assert.equal(scroll.prevented,undefined);
 }assert.equal(f.orders.length,0);
});
test('an owner switch during an active gesture cannot save into the next account',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let owner='first';const f=dragFixture({getOwner:()=>owner}),down={...f.event(f.art),pointerType:'touch',clientX:50,clientY:50};
 f.handlers.get('pointerdown')(down);t.mock.timers.tick(450);owner='second';f.handlers.get('pointerup')({...down,clientX:390,clientY:80});await new Promise(setImmediate);
 assert.equal(f.orders.length,0);assert.equal(f.grid.classList.contains('is-sorting'),false);assert.equal(f.removed(),true);
});

test('a second finger outside the grid cancels the hold before native pinch movement',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=dragFixture(),down={...f.event(f.art),pointerType:'touch',clientX:50,clientY:50};
 f.handlers.get('pointerdown')(down);t.mock.timers.tick(450);assert.equal(f.grid.classList.contains('is-sorting'),true);
 f.handlers.get('document:pointerdown')({isPrimary:false});assert.equal(f.grid.classList.contains('is-sorting'),false);
 const move={touches:[{},{}],preventDefault(){this.prevented=true;}};f.handlers.get('touchmove')(move);assert.equal(move.prevented,undefined);assert.equal(f.orders.length,0);
});
