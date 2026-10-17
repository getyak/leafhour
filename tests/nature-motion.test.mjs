import test from 'node:test';
import assert from 'node:assert/strict';

import * as nature from '../app/nature-motion.mjs';

// A recording canvas stands in for the GPU: transforms resolve each fill into
// canvas coordinates so geometry, alpha and the static horizon can be checked.
function recordingContext(){
  const context={gradients:0,draws:0,rects:[]};
  let a=1,b=0,c=0,d=1,e=0,f=0;
  context.globalAlpha=1;context.fillStyle=null;
  context.setTransform=(na,nb,nc,nd,ne,nf)=>{a=na;b=nb;c=nc;d=nd;e=ne;f=nf;};
  context.clearRect=()=>{context.draws++;context.rects=[];};
  context.fillRect=(x,y,w,h)=>context.rects.push({x:a*x+c*y+e,y:b*x+d*y+f,w:a*w+c*h,h:b*w+d*h,alpha:context.globalAlpha,fill:context.fillStyle});
  context.createLinearGradient=()=>{context.gradients++;const stops=[];return {stops,addColorStop:(offset,color)=>stops.push([offset,color])};};
  return context;
}

test('forest light breathes and slides beside both edges of the reading column while canopy shadows stay faint',()=>{
  assert.ok(nature?.createNatureRenderer,'Light through trees needs moving light, beyond a drifting photograph.');
  const draw=nature.createNatureRenderer('forest',320,200),context=recordingContext();
  draw(context,0);const first=context.rects.slice();
  draw(context,1.5);const next=context.rects.slice();
  assert.equal(first.length,12,'Eight sun shafts and four canopy shadows, a fixed bounded layout.');
  let changed=0,left=0,right=0,warm=0,shadowed=0;
  for(let i=0;i<first.length;i++){
    if(first[i].alpha!==next[i].alpha||first[i].x!==next[i].x)changed++;
    const colors=next[i].fill.stops.map(stop=>stop[1]);
    if(colors.includes('rgba(255,235,180,1)')){
      warm++;assert.ok(next[i].alpha<.2,'Sunlight stays restrained.');
      const middle=next[i].x+next[i].w/2;
      if(middle<80)left++;if(middle>224)right++;
    }
    if(colors.includes('rgba(6,22,16,1)'))shadowed++;
  }
  assert.ok(changed>=8,'The light must visibly move, not just change global brightness.');
  assert.ok(left>0&&right>0,'Sunlight remains visible beside both edges of the reading column.');
  assert.equal(warm,8);assert.equal(shadowed,4,'Faint canopy shadows drift between the shafts.');
});

test('sea glints shimmer below a horizon that never moves',()=>{
  const draw=nature.createNatureRenderer('sea',320,200),context=recordingContext();
  draw(context,0);const first=context.rects.slice();
  draw(context,2.3);const next=context.rects.slice();
  assert.ok(first.length>=20,'Small waves are many narrow glints, not one moving blob.');
  assert.equal(first.length,next.length);
  const horizon=nature.WATER_TOP*200;
  let changed=0,left=0,right=0;
  for(let i=0;i<first.length;i++){
    assert.ok(next[i].y>=horizon,'Water highlights stay confined below the photographed horizon.');
    assert.equal(next[i].y,first[i].y,'Wave rows never move vertically; the horizon stays stable.');
    assert.ok(next[i].h<=8,'Ripples are narrow highlights, not large displaced waves.');
    if(first[i].alpha!==next[i].alpha||first[i].x!==next[i].x)changed++;
    if(next[i].alpha>.04){
      if(next[i].x<80)left++;
      if(next[i].x+next[i].w>224)right++;
    }
  }
  assert.ok(changed>=6,'The water must visibly change within a few seconds.');
  assert.ok(left>0&&right>0,'Ripples stay visible beside both edges of the reading column.');
});

test('frames reuse one gradient table and one bounded band count, never allocating per frame',()=>{
  const draw=nature.createNatureRenderer('sea',320,200),context=recordingContext();
  draw(context,0);const gradients=context.gradients,count=context.rects.length;
  draw(context,.05);draw(context,1.2);draw(context,2.4);
  assert.ok(gradients>0&&gradients===count,'Each glint owns one gradient created at scene setup.');
  assert.equal(context.gradients,gradients,'Gradients are created once per scene, never per frame.');
  assert.equal(context.rects.length,count,'Every frame draws the same bounded number of bands.');
  assert.equal(nature.createNatureRenderer('hearth'),null,'Only forest and sea carry nature motion.');
  assert.equal(nature.createNatureRenderer('none'),null);
});

function motionFixture({withContext=true}={}){
  const context=recordingContext(),pending=new Map();
  let id=0,created=0;
  const canvas=new EventTarget();
  Object.assign(canvas,{className:'',hidden:true,width:0,height:0,setAttribute(){},getContext:()=>withContext?context:null});
  const target={ownerDocument:{createElement:()=>{created++;return canvas;}},dataset:{},append(node){this.canvas=node;}};
  const clock={requestAnimationFrame:fn=>{pending.set(++id,fn);return id;},cancelAnimationFrame:frame=>pending.delete(frame)};
  return {context,pending,target,clock,canvas,motion:nature.createNatureMotion(target,clock),created:()=>created};
}

test('the nature renderer runs only the active scene and releases its loop on pause',()=>{
  const f=motionFixture();
  assert.equal(f.created(),0,'Rain, hearth and paper scenes do not allocate a canvas.');
  f.motion.setActive(true);assert.equal(f.pending.size,0,'A scene without moving nature schedules nothing.');
  f.motion.setScene('forest');
  assert.equal(f.created(),1);assert.equal(f.pending.size,1);
  assert.equal(f.canvas.hidden,false);assert.equal(f.target.dataset.natureRenderer,'canvas');
  f.motion.setActive(true);assert.equal(f.pending.size,1,'Rendering cannot start twice.');
  let lastTick=null;
  const step=time=>{const [key,tick]=f.pending.entries().next().value;f.pending.delete(key);lastTick=tick;tick(time);};
  step(0);assert.equal(f.context.draws,1);assert.equal(f.pending.size,1);
  step(20);assert.equal(f.context.draws,1,'20 fps is the frame rate ceiling.');
  step(55);assert.equal(f.context.draws,2);
  f.motion.setScene('sea');assert.equal(f.pending.size,1,'A scene switch reuses the running loop.');
  step(110);assert.equal(f.context.draws,3);
  for(const rect of f.context.rects)assert.ok(rect.y>=nature.WATER_TOP*200,'The sea frame keeps its horizon.');
  f.motion.setScene('rain');assert.equal(f.pending.size,0,'Only the current nature scene renders.');
  assert.equal(f.canvas.hidden,true);assert.equal('natureRenderer' in f.target.dataset,false);
  f.motion.setScene('sea');assert.equal(f.pending.size,1);assert.equal(f.created(),1,'Resume reuses the same canvas.');
  f.motion.setActive(false);assert.equal(f.pending.size,0);assert.equal(f.canvas.hidden,true);
  lastTick(170);assert.equal(f.pending.size,0,'A paused renderer keeps no live frame loop.');
  f.motion.setActive(true);assert.equal(f.pending.size,1);
  f.motion.setActive(false);
});

test('a missing or lost canvas context preserves the still photograph without a frame loop',()=>{
  const bare=motionFixture({withContext:false});
  bare.motion.setScene('sea');bare.motion.setActive(true);
  assert.equal(bare.pending.size,0,'No context means no frame loop.');
  assert.equal(bare.canvas.hidden,true);assert.equal('natureRenderer' in bare.target.dataset,false);
  bare.motion.setActive(false);bare.motion.setActive(true);assert.equal(bare.pending.size,0,'A failed context never restarts a loop.');

  const f=motionFixture();
  f.motion.setScene('forest');f.motion.setActive(true);
  assert.equal(f.pending.size,1);
  f.canvas.dispatchEvent(new Event('contextlost'));
  assert.equal(f.pending.size,0,'Context loss stops rendering immediately.');
  assert.equal(f.canvas.hidden,true);assert.equal('natureRenderer' in f.target.dataset,false);
  f.canvas.dispatchEvent(new Event('contextrestored'));
  assert.equal(f.pending.size,1);assert.equal(f.canvas.hidden,false,'A restored context resumes on the same canvas.');
  f.motion.setActive(false);
});
