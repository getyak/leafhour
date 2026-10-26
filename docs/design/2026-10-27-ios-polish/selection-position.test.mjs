import test from 'node:test';
import assert from 'node:assert/strict';
import * as geometry from './prototype/selection-position.mjs';
const bounds={left:16,top:118,right:386,bottom:758};
const menu={width:294,height:54};
const place=(anchor,b=bounds)=>{
  assert.equal(typeof geometry.placeSelectionMenu,'function','selection placement must be implemented');
  return geometry.placeSelectionMenu(anchor,menu,b);
};
test('the tool sits above a visible selection when there is room',()=>{
  const anchor={left:100,right:250,top:300,bottom:330};const p=place(anchor);
  assert.equal(p.placement,'above');assert.ok(p.top+menu.height<anchor.top);
});
test('a selection beside the top navigation gets tools below it',()=>{
  const anchor={left:28,right:200,top:124,bottom:150};const p=place(anchor);
  assert.equal(p.placement,'below');assert.ok(p.top>anchor.bottom);
});
test('selections near either edge keep the entire menu in the safe area',()=>{
  for(const anchor of [{left:17,right:40,top:300,bottom:330},{left:340,right:380,top:300,bottom:330}]){
    const p=place(anchor);assert.ok(p.left>=bounds.left);assert.ok(p.left+menu.width<=bounds.right);
  }
});
test('a long selection in the half sheet exposed area keeps the tools reachable',()=>{
  const b={...bounds,bottom:412};const p=place({left:28,right:350,top:120,bottom:410},b);
  assert.equal(p.placement,'edge');assert.ok(p.top>=b.top);assert.ok(p.top+menu.height<=b.bottom);
});
test('moving the source down moves the tools with it',()=>{
  const a=place({left:100,right:200,top:280,bottom:310});
  const b=place({left:100,right:200,top:480,bottom:510});
  assert.equal(b.top-a.top,200);
});
