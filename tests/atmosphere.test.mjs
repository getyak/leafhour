import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAtmosphere,atmosphereMix,createAtmosphereSession} from '../app/atmosphere-state.mjs';

test('atmospheres restore only supported preferences, never playback intent',()=>{
  assert.deepEqual(normalizeAtmosphere({scene:'forest',music:0,nature:63,motion:false,playing:true}),{scene:'forest',music:0,nature:63,motion:false});
  assert.deepEqual(normalizeAtmosphere({scene:'../../private',music:Infinity,nature:-2,motion:'yes'}),{scene:'none',music:28,nature:32,motion:true});
  assert.equal(normalizeAtmosphere(null).scene,'none');
  for(const scene of ['forest','rain','hearth','sea','none'])assert.equal(normalizeAtmosphere({scene}).scene,scene);
});

test('narration ducks both channels without changing saved volume, zero stays silent',()=>{
  const prefs={scene:'forest',music:40,nature:50};
  assert.deepEqual(atmosphereMix(prefs),{music:0.4,nature:0.5});
  const ducked=atmosphereMix(prefs,{narrating:true});
  assert.ok(Math.abs(ducked.music-0.072)<1e-9);assert.equal(ducked.nature,0.09);
  assert.deepEqual(atmosphereMix({...prefs,scene:'none'}),{music:0,nature:0});
  assert.deepEqual(atmosphereMix({...prefs,music:0,nature:0},{narrating:true}),{music:0,nature:0});
});

test('late resource arrival after pause is disposed and cannot resume sound',async()=>{
  let resolve,stopped=0;const statuses=[];
  const session=createAtmosphereSession({start:()=>new Promise(r=>resolve=r),onState:s=>statuses.push(s.status)});
  const pending=session.play('forest');session.stop();resolve({stop:()=>stopped++});await pending;
  assert.equal(stopped,1);assert.equal(session.status,'paused');assert.ok(!statuses.includes('playing'));
});

test('a rapid scene change retains only the last playback, stale failure cannot replace it',async()=>{
  const pending=new Map(),stopped=[];
  const session=createAtmosphereSession({start:scene=>new Promise((resolve,reject)=>pending.set(scene,{resolve,reject}))});
  const old=session.play('forest'),current=session.play('sea');
  pending.get('sea').resolve({stop:()=>stopped.push('sea')});await current;
  pending.get('forest').reject(Error('old request failed'));await old;
  assert.equal(session.status,'playing');assert.equal(session.scene,'sea');
  session.stop();assert.deepEqual(stopped,['sea']);
});

test('current playback failure is visible and can be retried',async()=>{
  let calls=0;const session=createAtmosphereSession({start:async()=>{if(!calls++)throw Error('offline');return {stop(){}};}});
  await session.play('rain');assert.equal(session.status,'error');assert.equal(session.error.message,'offline');
  await session.play('rain');assert.equal(session.status,'playing');assert.equal(session.error,null);
});

test('volume or narration changes made while recordings load reach the accepted playback',async()=>{
  let resolve;const applied=[];
  const session=createAtmosphereSession({start:()=>new Promise(r=>resolve=r)});
  const pending=session.play('forest');session.setMix({music:0,nature:0.09});
  resolve({stop(){},setMix:mix=>applied.push(mix)});await pending;
  assert.deepEqual(applied,[{music:0,nature:0.09}]);
});
