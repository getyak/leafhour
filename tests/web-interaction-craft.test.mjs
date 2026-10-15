import test from 'node:test';
import assert from 'node:assert/strict';
import {pointOutside,tabDestination,mountInteractionCraft} from '../app/interaction-craft.mjs';

const rect={left:30,right:330,top:40,bottom:440};
test('modal backdrop accepts all four sides while retaining the boundary',()=>{
  for(const [x,y] of [[29,150],[331,150],[100,39],[100,441]])assert.equal(pointOutside(rect,x,y),true);
  for(const [x,y] of [[30,40],[330,440],[100,150]])assert.equal(pointOutside(rect,x,y),false);
});
test('keyboard tab movement wraps, supports first/last, and ignores text keys',()=>{
  assert.equal(tabDestination('ArrowRight',2,3),0);
  assert.equal(tabDestination('ArrowLeft',0,3),2);
  assert.equal(tabDestination('ArrowDown',0,3),1);
  assert.equal(tabDestination('ArrowUp',1,3),0);
  assert.equal(tabDestination('Home',2,3),0);
  assert.equal(tabDestination('End',0,3),2);
  assert.equal(tabDestination('a',0,3),null);
  assert.equal(tabDestination('Home',0,0),null);
  assert.equal(tabDestination('ArrowRight',-1,3),null);
});
function fixture({fallback=[]}={}){
  const handlers=new Map();
  const dialog={closed:0,contains:()=>false,getBoundingClientRect:()=>rect,addEventListener(type,fn){handlers.set(type,fn);},close(){this.closed++;}};
  const doc={body:{},defaultView:{MutationObserver:class {observe(){}disconnect(){}},requestAnimationFrame:fn=>fn()},querySelectorAll:selector=>selector==='dialog'?[dialog]:selector.split(',').flatMap(part=>fallback.filter(node=>part.trim()==='#'+node.id)),querySelector:()=>null,addEventListener(){}};
  mountInteractionCraft(doc);
  const dispatch=(type,target,x,y)=>{let stopped=false;handlers.get(type)({target,clientX:x,clientY:y,stopImmediatePropagation(){stopped=true;}});return stopped;};
  return {dialog,dispatch};
}
test('dragging a selection out of a modal does not accidentally close it',()=>{
  const {dialog,dispatch}=fixture(),text={};
  dispatch('pointerdown',text,120,100);
  assert.equal(dispatch('click',dialog,10,100),true);
  assert.equal(dialog.closed,0);
});
test('a fresh backdrop gesture closes a dynamic modal on every side',()=>{
  for(const [x,y]of [[10,100],[350,100],[120,20],[120,460]]){
    const {dialog,dispatch}=fixture();dispatch('pointerdown',dialog,x,y);dispatch('click',dialog,x,y);assert.equal(dialog.closed,1);
  }
});

test('a refreshed personal library still provides a visible focus target after its old opener disappears',()=>{
 const account={id:'library-account',isConnected:true,closest:()=>null,getClientRects:()=>[rect],focus(){this.focused=true;}};
 const {dialog,dispatch}=fixture({fallback:[account]});dispatch('close',dialog);assert.equal(account.focused,true);
});
