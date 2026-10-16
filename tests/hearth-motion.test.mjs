import test from 'node:test';
import assert from 'node:assert/strict';

import * as hearth from '../app/hearth-motion.mjs';

test('hearth flames change their visible shape over time while staying on the photographed fuel',()=>{
  assert.ok(hearth?.createHearthFrame,'The hearth needs moving flames, beyond a drifting photograph.');
  const frame=hearth.createHearthFrame(300,200);
  const first=frame(0).slice(),next=frame(.6).slice();
  let changed=0,left=0,right=0;
  for(let y=0;y<200;y++)for(let x=0;x<300;x++){
    const i=(y*300+x)*4;
    if(first[i+3]!==next[i+3])changed++;
    if(y<55||y>175)assert.equal(next[i+3],0,'Fire cannot float over the wall or below the fuel.');
    if(next[i+3]>60){
      assert.ok(next[i]>next[i+1]&&next[i+1]>next[i+2],'Flames have a warm colour.');
      if(x<75)left++;if(x>200)right++;
    }
  }
  assert.ok(changed>500,'The fire must visibly burn, not just change global brightness.');
  assert.ok(left>100&&right>100,'Fire remains visible beside both edges of the reading column.');
});

test('hearth rendering releases its frame loop on pause and reuses its canvas on resume',()=>{
  assert.ok(hearth?.createHearthMotion,'A paused or hidden hearth must stop rendering.');
  let drawn=0,created=0,id=0;const pending=new Map();
  const context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:()=>drawn++};
  const doc={createElement:()=>{created++;return {hidden:true,setAttribute(){},getContext:()=>context};}};
  const target={ownerDocument:doc,append(canvas){this.canvas=canvas;}};
  const clock={requestAnimationFrame:fn=>{pending.set(++id,fn);return id;},cancelAnimationFrame:id=>pending.delete(id)};
  const motion=hearth.createHearthMotion(target,clock);
  assert.equal(created,0,'Non-hearth scenes do not allocate a canvas.');
  motion.setActive(true);assert.equal(pending.size,1);assert.equal(target.canvas.hidden,false);
  motion.setActive(true);assert.equal(pending.size,1,'Rendering cannot start twice.');
  const [key,tick]=pending.entries().next().value;pending.delete(key);tick(100);
  assert.equal(drawn,1);assert.equal(pending.size,1);
  motion.setActive(false);assert.equal(pending.size,0);assert.equal(target.canvas.hidden,true);
  motion.setActive(true);assert.equal(created,1);assert.equal(pending.size,1);
  motion.setActive(false);
});

test('a device without a canvas context keeps the photograph available without a frame loop',()=>{
  assert.ok(hearth?.createHearthMotion);
  let requested=0;
  const target={ownerDocument:{createElement:()=>({setAttribute(){},getContext:()=>null})},append(){}};
  const motion=hearth.createHearthMotion(target,{requestAnimationFrame:()=>requested++,cancelAnimationFrame(){}});
  assert.doesNotThrow(()=>motion.setActive(true));assert.equal(requested,0);
});
