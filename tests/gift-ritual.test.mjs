import test from 'node:test';
import assert from 'node:assert/strict';
const motion=await import('../app/gift-ritual.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
function clock(){let time=0,id=0;const queued=new Map();return {request:fn=>{queued.set(++id,fn);return id;},cancel:id=>queued.delete(id),step:()=>{time+=1000/60;const callbacks=[...queued.values()];queued.clear();for(const callback of callbacks)callback(time);},pending:()=>queued.size};}
test('opening and folding a letter settle completely without a background animation loop',()=>{
  assert.equal(typeof motion.createGiftSpring,'function');const frames=[],timer=clock(),spring=motion.createGiftSpring({onFrame:p=>frames.push(p),requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false});
  spring.setOpen(true);for(let i=0;i<180;i++)timer.step();assert.equal(frames.at(-1),1);assert.ok(frames.every(p=>p>=0&&p<=1));assert.equal(timer.pending(),0);
  spring.setOpen(false);for(let i=0;i<180;i++)timer.step();assert.equal(frames.at(-1),0);assert.equal(timer.pending(),0);
});
test('reversing an opening letter carries its current position rather than snapping to an endpoint',()=>{
  assert.equal(typeof motion.createGiftSpring,'function');const frames=[],timer=clock(),spring=motion.createGiftSpring({onFrame:p=>frames.push(p),requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false});
  spring.setOpen(true);for(let i=0;i<12;i++)timer.step();const before=frames.at(-1);assert.ok(before>.1&&before<.95);
  spring.setOpen(false);assert.equal(frames.at(-1),before);timer.step();assert.ok(Math.abs(frames.at(-1)-before)<.08);
  for(let i=0;i<180;i++)timer.step();assert.equal(frames.at(-1),0);assert.equal(timer.pending(),0);
});
test('reduced motion and finishing a hidden-page transition reveal the target without extra frames',()=>{
  assert.equal(typeof motion.createGiftSpring,'function');const frames=[],timer=clock();let reduced=true;const spring=motion.createGiftSpring({onFrame:p=>frames.push(p),requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>reduced});
  spring.setOpen(true);assert.equal(frames.at(-1),1);assert.equal(timer.pending(),0);spring.setOpen(false);assert.equal(frames.at(-1),0);
  reduced=false;spring.setOpen(true);timer.step();spring.finish();assert.equal(frames.at(-1),1);assert.equal(timer.pending(),0);
});
