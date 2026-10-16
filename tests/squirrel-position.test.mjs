import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSquirrelPosition} from '../app/squirrel-position.mjs';
function setup(t,initial){
 const window=new EventTarget();Object.assign(window,{innerWidth:1200,innerHeight:800});
 const viewport=new EventTarget();Object.assign(viewport,{width:1200,height:800,offsetLeft:0,offsetTop:0});window.visualViewport=viewport;
 const saved=new Map(initial?[['marginalia:squirrel-position:v1',JSON.stringify(initial)]]:[]);
 const launcher=new EventTarget();launcher.dataset={};launcher.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};launcher.setAttribute=()=>{};launcher.setPointerCapture=()=>{};launcher.releasePointerCapture=()=>{};
 launcher.getBoundingClientRect=()=>{const left=launcher.style.left?parseFloat(launcher.style.left):window.innerWidth-72,top=launcher.style.top?parseFloat(launcher.style.top):window.innerHeight-70;return {left,top,right:left+48,bottom:top+48,width:48,height:48};};
 const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const position=mountSquirrelPosition({launcher,window,storage});t.after(()=>position.dispose());
 const fire=(type,values={},target=launcher)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,pointerId:1,isPrimary:true,clientX:1150,clientY:750,...values});target.dispatchEvent(event);return event;};
 return {launcher,window,viewport,saved,position,fire};
}
test('drag moves the squirrel without opening chat, while taps still click normally',t=>{
 const s=setup(t);let opens=0;s.launcher.addEventListener('click',()=>opens++);
 s.fire('pointerdown');s.fire('pointermove',{clientX:400,clientY:300});s.fire('pointerup',{clientX:400,clientY:300});
 s.fire('click',{detail:1});assert.equal(opens,0);assert.equal(s.launcher.getBoundingClientRect().left,378);assert.equal(s.launcher.getBoundingClientRect().top,280);
 s.fire('pointerdown',{clientX:400,clientY:300});s.fire('pointerup',{clientX:400,clientY:300});s.fire('click',{detail:1});assert.equal(opens,1);
});
test('saved placement survives remount and remains inside a smaller visual viewport',t=>{
 const s=setup(t,{x:1,y:1});Object.assign(s.viewport,{width:320,height:400,offsetTop:20});s.viewport.dispatchEvent(new Event('resize'));
 const r=s.launcher.getBoundingClientRect();assert.equal(r.right,308);assert.equal(r.bottom,408);
 s.fire('keydown',{altKey:true,key:'ArrowLeft'});assert.equal(s.launcher.getBoundingClientRect().left,244);
 const stored=JSON.parse(s.saved.get('marginalia:squirrel-position:v1'));const next=setup(t,stored);assert.ok(next.launcher.getBoundingClientRect().left<1140);
});
test('cancelled and non-primary gestures cannot leave the character dragged or swallow keyboard activation',t=>{
 const s=setup(t);const before=s.launcher.getBoundingClientRect();
 s.fire('pointerdown',{isPrimary:false});s.fire('pointermove',{clientX:200,clientY:200});assert.equal(s.launcher.getBoundingClientRect().left,before.left);
 s.fire('pointerdown');s.fire('pointermove',{clientX:200,clientY:200});s.fire('pointercancel');assert.equal(s.launcher.getBoundingClientRect().left,before.left);
 let opens=0;s.launcher.addEventListener('click',()=>opens++);s.fire('click',{detail:0});assert.equal(opens,1);assert.notEqual(s.launcher.dataset.dragging,'true');
});
test('bubble follows the squirrel and flips below near the top without leaving the viewport',t=>{
 const s=setup(t,{x:0,y:0}),bubble={hidden:false,style:{},classList:{toggle(){}},getBoundingClientRect:()=>({width:290,height:130})};
 s.position.attach(bubble);s.position.layout();assert.equal(parseFloat(bubble.style.left),12);assert.equal(parseFloat(bubble.style.top),68);
 s.fire('keydown',{altKey:true,key:'ArrowDown'});assert.equal(parseFloat(bubble.style.top),84);
});
test('pinch-zoomed visual viewport keeps the whole bubble within reach',t=>{
 const s=setup(t,{x:0,y:0}),bubble={hidden:false,style:{},classList:{toggle(){}},getBoundingClientRect:()=>({width:Math.min(290,parseFloat(bubble.style.maxWidth)||290),height:130})};
 Object.assign(s.viewport,{width:195,height:400,offsetLeft:80,offsetTop:10});s.position.attach(bubble);
 assert.equal(parseFloat(bubble.style.maxWidth),171);assert.equal(parseFloat(bubble.style.left),92);
 assert.equal(parseFloat(bubble.style.left)+bubble.getBoundingClientRect().width,263);
});
