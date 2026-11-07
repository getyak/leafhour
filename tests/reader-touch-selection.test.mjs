import test from 'node:test';
import assert from 'node:assert/strict';
import {sentenceSelection,createTouchSelectionIntent,touchAdjustsSelection,mountReaderTouchSelection} from '../app/reader-touch-selection.mjs';
import {fixture} from './annotation-dom-fixture.mjs';

test('initial selection expands to sentence boundaries with exact UTF-16 offsets',()=>{
 const text='First sentence.  The 🌱 grows slowly. Last sentence.';
 const start=text.indexOf('grows'),range=sentenceSelection(text,start,start+5,{locale:'en'});
 assert.equal(text.slice(range.start,range.end),'The 🌱 grows slowly.');
 assert.equal(range.start,text.indexOf('The'));
 assert.equal(text.slice(0,range.start)+text.slice(range.start,range.end)+text.slice(range.end),text);
});
test('CJK, quoted punctuation and an initial range across sentences retain complete boundaries',()=>{
 const text='第一句。 “第二句！” 第三句。';
 const range=sentenceSelection(text,text.indexOf('第二'),text.indexOf('第三')+2,{locale:'zh'});
 assert.equal(text.slice(range.start,range.end),'“第二句！” 第三句。');
});
test('no segmenter falls back to the trimmed paragraph; malformed and empty ranges are ignored',()=>{
 const text='  A paragraph without punctuation  ';
 assert.deepEqual(sentenceSelection(text,4,8,{Segmenter:null}),{start:2,end:33});
 assert.equal(sentenceSelection(text,8,4),null);
 assert.equal(sentenceSelection(text,0,0),null);
 assert.equal(sentenceSelection('   ',0,1),null);
});
function intent(){let time=0;const prose={};return {prose,clock:value=>{time=value;},owner:createTouchSelectionIntent({now:()=>time})};}
test('only a stationary native hold authorizes one initial expansion, then handle edits pass through',()=>{
 const f=intent();f.owner.begin({prose:f.prose,x:10,y:20});f.clock(500);
 assert.deepEqual(f.owner.selection(f.prose),{accept:true,touch:true,expand:true});
 assert.deepEqual(f.owner.selection(f.prose),{accept:true,touch:true,expand:false});
 f.owner.begin({prose:f.prose,x:10,y:20,adjusting:true});f.owner.move({x:80,y:90});
 assert.deepEqual(f.owner.selection(f.prose),{accept:true,touch:true,expand:false});
});
test('taps, scrolling, multitouch, early cancellation, expiry and unrelated prose cannot normalize',()=>{
 for(const action of ['tap','scroll','multi','cancel','expiry','other']){
  const f=intent();f.owner.begin({prose:f.prose,x:10,y:20});
  if(action==='tap'||action==='cancel'){f.clock(100);f.owner.end();}
  if(action==='scroll')f.owner.move({x:10,y:40});
  if(action==='multi')f.owner.move({x:10,y:20,touches:2});
  f.clock(action==='expiry'?6000:500);
  assert.deepEqual(f.owner.selection(action==='other'?{}:f.prose),{accept:false,touch:true,expand:false},action);
 }
});
test('late native selection after a qualified cancel works, while mouse, navigation and reset discard touch ownership',()=>{
 const f=intent();f.owner.begin({prose:f.prose,x:0,y:0});f.clock(450);f.owner.end();f.clock(600);
 assert.equal(f.owner.selection(f.prose).expand,true);
 f.owner.reset();assert.deepEqual(f.owner.selection(f.prose),{accept:true,touch:false,expand:false});
 f.owner.begin({prose:f.prose,x:0,y:0});f.owner.cancel();f.clock(1000);
 assert.equal(f.owner.selection(f.prose).accept,false);
});

test('only native endpoint regions count as handle edits, not an unrelated retained range',()=>{
 const node={},root={contains:value=>value===node},range={getClientRects:()=>[{left:20,right:120,top:50,bottom:80,width:100,height:30}]},selection={isCollapsed:false,rangeCount:1,anchorNode:node,getRangeAt:()=>range};
 assert.equal(touchAdjustsSelection(selection,{clientX:20,clientY:85},root),true);
 assert.equal(touchAdjustsSelection(selection,{clientX:120,clientY:85},root),true);
 assert.equal(touchAdjustsSelection(selection,{clientX:200,clientY:85},root),false);
 const f=intent();f.owner.begin({prose:f.prose,x:200,y:85,adjusting:false});f.clock(500);assert.equal(f.owner.selection(f.prose).expand,true);
});
test('mounted native ownership rejects duplicates and permits exact-word reselection after collapse',()=>{
 let time=0;const {document}=fixture('<body><div id="root"><p lang="en" data-reading-layer="original">The 🌱 grows slowly. Next sentence.</p></div></body>'),root=document.getElementById('root'),prose=root.querySelector('p'),text=prose.childNodes[0],handlers=new Map();
 const makeRange=(start,end)=>({startContainer:text,startOffset:start,endContainer:text,endOffset:end,getClientRects:()=>[{left:20,right:120,top:50,bottom:80,width:100,height:30}],cloneRange(){let offset=end;return {selectNodeContents(){},setEnd(_node,value){offset=value;},toString:()=>prose.textContent.slice(0,offset)};}});
 let range=makeRange(7,12);const selection={isCollapsed:true,rangeCount:0,anchorNode:text,getRangeAt:()=>range,setBaseAndExtent(_a,start,_b,end){range=makeRange(start,end);}};
 const controller=mountReaderTouchSelection({document,root,now:()=>time,getSelection:()=>selection,listen(_target,event,fn){handlers.set(event,[...(handlers.get(event)||[]),fn]);},rangeForOffsets:(_prose,start,end)=>makeRange(start,end)});
 const touch=()=>handlers.get('touchstart').forEach(fn=>fn({target:prose,touches:[{clientX:220,clientY:80}]}));
 touch();time=500;selection.isCollapsed=false;selection.rangeCount=1;assert.equal(controller.capture().expand,true);assert.equal(controller.capture().accept,false,'duplicate native events cannot reopen tools');
 range=makeRange(7,12);assert.deepEqual(controller.capture(),{accept:true,touch:true,expand:false});
 selection.isCollapsed=true;selection.rangeCount=0;time=600;touch();time=1100;selection.isCollapsed=false;selection.rangeCount=1;range=makeRange(7,12);assert.deepEqual(controller.capture(),{accept:true,touch:true,expand:true});
});
