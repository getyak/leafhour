import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderCompanionState,COMPANION_TIMING} from '../app/reader-companion-state.mjs';

function setup(){
  let now=0;const state=createReaderCompanionState({clock:()=>now});
  state.configure({enabled:true,revision:1,scope:'alice/book/v1'});
  const sample=(passageId='p1',chapterId='ch1',extra={})=>state.sample({passageId,chapterId,visible:true,focused:true,blocked:false,eligiblePassage:true,...extra});
  sample();state.activity('scroll');
  const read=(seconds,passageId='p1',chapterId='ch1',extra={})=>{for(let i=0;i<seconds;i++){now+=1000;if(i%25===0)state.activity('reading');sample(passageId,chapterId,extra);}return state.view();};
  return {state,read,sample,advance:ms=>{now+=ms;},now:()=>now};
}

test('first companion needs ninety visible seconds and two actually observed passages',()=>{
  const f=setup();f.read(80);assert.equal(f.state.view().eligible,false);assert.deepEqual(f.state.view().observedIds,['p1']);
  f.read(10,'p2');assert.equal(f.state.view().eligible,true);assert.equal(COMPANION_TIMING.intervalMs,300000);
});
test('a new attempt requires five foreground minutes plus three new observed passages',()=>{
  const f=setup();f.read(45);f.read(45,'p2');f.state.attempted();
  f.read(20,'p3');f.read(20,'p4');f.read(259,'p5');assert.equal(f.state.view().eligible,false);
  f.read(1,'p5');assert.equal(f.state.view().eligible,true);f.state.attempted();assert.equal(f.state.view().eligible,false);
});
test('jumping between passages cannot claim skipped text as seen and a new chapter warms up',()=>{
  const f=setup();f.read(80);f.sample('p900','ch9');f.read(2,'p900','ch9');assert.deepEqual(f.state.view().observedIds,['p1']);
  f.read(8,'p900','ch9');assert.equal(f.state.view().eligible,false);f.read(35,'p900','ch9');assert.equal(f.state.view().eligible,true);
  assert.deepEqual(f.state.view().observedIds,['p1','p900']);
});
test('hidden blocked and unfocused time never counts toward a five-minute interval',()=>{
  const f=setup();f.read(45);f.read(45,'p2');f.state.attempted();const before=f.state.view().activeMs;
  f.read(300,'p3','ch1',{visible:false});f.read(300,'p3','ch1',{focused:false});f.read(300,'p3','ch1',{blocked:true});
  assert.equal(f.state.view().activeMs,before);assert.equal(f.state.view().eligible,false);
});
test('static pages pause after idle time and wall-clock gaps cannot become reading time',()=>{
  const f=setup();f.sample();f.advance(600000);f.sample();assert.ok(f.state.view().activeMs<=2000);
  f.state.activity('reading');f.read(10);const before=f.state.view().activeMs;
  for(let i=0;i<120;i++){f.advance(1000);f.sample();}assert.ok(f.state.view().activeMs-before<=60000);
});
test('scrolling and reading tools defer presentation without stealing the opportunity',()=>{
  const f=setup();f.read(45);f.read(45,'p2');assert.equal(f.state.view().safeToPresent,true);
  f.state.activity('scroll');f.sample('p2');assert.equal(f.state.view().safeToPresent,false);f.read(6,'p2');assert.equal(f.state.view().safeToPresent,true);
  f.sample('p2','ch1',{blocked:true});assert.equal(f.state.view().safeToPresent,false);
});
test('silence and failures consume attempts and disabling invalidates warm-up',()=>{
  const f=setup();f.read(45);f.read(45,'p2');f.state.attempted();
  f.read(100,'p3');f.read(100,'p4');f.read(100,'p5');f.state.attempted();
  f.read(100,'p6');f.read(100,'p7');f.read(100,'p8');f.state.attempted();
  f.read(300,'p9');assert.equal(f.state.view().eligible,false);assert.equal(f.state.view().attempts,3);
  f.state.configure({enabled:false,revision:2,scope:'alice/book/v1'});assert.equal(f.state.view().safeToPresent,false);
  f.state.configure({enabled:true,revision:3,scope:'alice/book/v1'});assert.equal(f.state.view().activeMs,0);assert.deepEqual(f.state.view().observedIds,[]);
});
