import test from 'node:test';
import assert from 'node:assert/strict';

const placementModule=await import('../app/toolbar-placement.mjs').catch(()=>({}));

test('more menu independently fits below a top toolbar and above a bottom toolbar',()=>{
 const place=placementModule.placeFloatingMenu;assert.equal(typeof place,'function');
 for(const [toolbar,height] of [[{left:120,right:380,top:110,bottom:158},844],[{left:120,right:380,top:710,bottom:758},844],[{left:12,right:298,top:230,bottom:278},480]]){
  const result=place({toolbar,menu:{width:180,height:340},viewport:{width:390,height},headerBottom:72});
  assert.ok(result.top>=80);assert.ok(result.top+result.maxHeight<=height-12);assert.ok(result.left>=12);assert.ok(result.left+180<=378);
 }
});

test('floating paragraph tools prefer the already-read space above the selection',()=>{
  assert.equal(typeof placementModule.placeFloatingToolbar,'function','floating placement helper is missing');
  const result=placementModule.placeFloatingToolbar({
    anchor:{top:310,bottom:410,left:180,right:760},
    toolbar:{width:286,height:48},
    viewport:{width:960,height:720},
    headerBottom:72,
    gap:10
  });
  assert.deepEqual(result,{left:180,top:252,placement:'above',visible:true});
});

test('floating paragraph tools move below when the header leaves no room above',()=>{
  assert.equal(typeof placementModule.placeFloatingToolbar,'function','floating placement helper is missing');
  const result=placementModule.placeFloatingToolbar({
    anchor:{top:92,bottom:160,left:24,right:600},
    toolbar:{width:300,height:48},
    viewport:{width:640,height:720},
    headerBottom:72,
    gap:10
  });
  assert.deepEqual(result,{left:24,top:170,placement:'below',visible:true});
});

test('a partial text selection falls back below its whole paragraph',()=>{
  assert.equal(typeof placementModule.placeFloatingToolbar,'function','floating placement helper is missing');
  const result=placementModule.placeFloatingToolbar({
    anchor:{top:82,bottom:113,left:315,right:782},
    fallbackAnchor:{top:76,bottom:294,left:315,right:965},
    toolbar:{width:260,height:48},
    viewport:{width:1280,height:720},
    headerBottom:72,
    gap:10
  });
  assert.deepEqual(result,{left:315,top:304,placement:'below',visible:true});
});

test('floating paragraph tools clamp to the viewport and disappear with their passage',()=>{
  assert.equal(typeof placementModule.placeFloatingToolbar,'function','floating placement helper is missing');
  assert.deepEqual(placementModule.placeFloatingToolbar({
    anchor:{top:300,bottom:380,left:290,right:510},
    toolbar:{width:286,height:48},
    viewport:{width:320,height:720},
    headerBottom:62,
    gap:10
  }),{left:22,top:242,placement:'above',visible:true});
  assert.equal(placementModule.placeFloatingToolbar({
    anchor:{top:-300,bottom:-120,left:20,right:300},
    toolbar:{width:260,height:48},
    viewport:{width:320,height:720},
    headerBottom:62,
    gap:10
  }).visible,false);
});
