import test from 'node:test';
import assert from 'node:assert/strict';

const module=await import('../app/reader-page-turn.mjs').catch(()=>({}));
function fixture(reducedMotion=false){
  assert.equal(typeof module.createPageTurn,'function');
  let sequence=0,time=0;const pending=new Map(),paints=[],commits=[];
  const turn=module.createPageTurn({requestFrame:fn=>{pending.set(++sequence,fn);return sequence;},cancelFrame:id=>pending.delete(id),onPaint:value=>paints.push({...value}),onCommit:direction=>commits.push(direction),reducedMotion:()=>reducedMotion});
  const step=()=>{time+=16;const rows=[...pending.values()];pending.clear();for(const fn of rows)fn(time);};
  const settle=()=>{for(let i=0;i<300&&pending.size;i++)step();assert.equal(pending.size,0,'a leaf must settle rather than animate indefinitely');};
  return {turn,pending,paints,commits,step,settle};
}

test('a turn commits once only after its visible leaf reaches the destination',()=>{
  const f=fixture();f.turn.turn(1);assert.deepEqual(f.commits,[]);f.step();
  assert.ok(f.paints.at(-1).progress>0&&f.paints.at(-1).progress<1);assert.deepEqual(f.commits,[]);
  f.settle();assert.deepEqual(f.commits,[1]);assert.equal(f.paints.at(-1).progress,0);
});

test('short drags return to the same page and a deliberate flick completes it',()=>{
  const f=fixture();f.turn.grab(1);f.turn.drag(.2,0);assert.equal(f.paints.at(-1).progress,.2);
  f.turn.release(false);f.settle();assert.deepEqual(f.commits,[]);
  f.turn.grab(-1);f.turn.drag(.18,2);f.turn.release(false);f.settle();assert.deepEqual(f.commits,[-1]);
});

test('pointer cancellation never commits even after a long drag',()=>{
  const f=fixture();f.turn.grab(1);f.turn.drag(.85,2);f.turn.release(true);f.settle();assert.deepEqual(f.commits,[]);
});

test('regrabbing starts from the displayed leaf and reversing cancels the pending turn',()=>{
  const f=fixture();f.turn.turn(1);f.step();f.step();const visible=f.paints.at(-1).progress;
  const grabbed=f.turn.grab(1);assert.equal(grabbed.progress,visible);assert.equal(grabbed.direction,1);
  f.turn.drag(.25,-2);f.turn.release(false);f.settle();assert.deepEqual(f.commits,[]);
  f.turn.turn(1);f.step();f.turn.turn(-1);f.settle();assert.deepEqual(f.commits,[]);
});

test('repeated input does not duplicate a committed page and stale frames cannot revive it',()=>{
  const f=fixture();f.turn.turn(1);const old=[...f.pending.values()][0];f.turn.turn(1);f.settle();
  assert.deepEqual(f.commits,[1]);const count=f.paints.length;old(10000);assert.equal(f.paints.length,count);assert.deepEqual(f.commits,[1]);
});

test('layout invalidation and disposal discard pending work without moving the reader',()=>{
  const f=fixture();f.turn.turn(1);const old=[...f.pending.values()][0];f.step();f.turn.cancel();old(1000);f.settle();assert.deepEqual(f.commits,[]);
  f.turn.turn(-1);const pending=[...f.pending.values()][0];f.turn.dispose();pending(2000);f.turn.turn(1);assert.deepEqual(f.commits,[]);assert.equal(f.pending.size,0);
});

test('reduced motion changes pages immediately without drawing or scheduling a leaf',()=>{
  const f=fixture(true);f.turn.turn(1);assert.deepEqual(f.commits,[1]);assert.deepEqual(f.paints,[]);assert.equal(f.pending.size,0);
});

test('a soft leaf stays flat at rest and its bent strips meet without seams',()=>{
  assert.equal(typeof module.leafSegments,'function');
  const flat=module.leafSegments(0,100,4,1);assert.deepEqual(flat.map(s=>Math.round(s.x)),[0,25,50,75]);
  assert.ok(flat.every(s=>s.z===0&&s.angle===0&&s.width===25));
  const bent=module.leafSegments(.5,100,4,1);assert.ok(new Set(bent.map(s=>s.angle)).size>1,'a bent leaf is not one rigid rotating panel');
  for(let i=0;i<bent.length-1;i++){
    const a=bent[i],b=bent[i+1],radians=a.angle*Math.PI/180;
    assert.ok(Math.abs(a.x+Math.cos(radians)*a.width-b.x)<1e-8);
    assert.ok(Math.abs(a.z-Math.sin(radians)*a.width-b.z)<1e-8);
  }
  const reversed=module.leafSegments(.5,100,4,-1);assert.equal(Math.sign(reversed[0].angle),-Math.sign(bent[0].angle));
  assert.deepEqual(module.leafSegments(.5,0,4,1),[]);
});
