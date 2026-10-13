import test from 'node:test';import assert from 'node:assert/strict';
import {createProgressSync} from '../app/progress-sync.mjs';
test('rapid progress writes serialize and use the revision returned by the preceding write',async()=>{
  const requests=[];let release;
  const sync=createProgressSync({revision:7,send:async input=>{requests.push(input);if(requests.length===1)return new Promise(resolve=>{release=()=>resolve({...input,revision:8});});return {...input,revision:9};}});
  const first=sync.save({passageId:'first'}),second=sync.save({passageId:'second'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1);assert.equal(requests[0].baseRevision,7);release();await first;await second;
  assert.equal(requests[1].baseRevision,8);assert.equal(sync.revision,9);
});
test('adopting a position cancels older queued writes and ignores their late acknowledgements',async()=>{
  const requests=[],saved=[];let release;
  const sync=createProgressSync({revision:7,send:async input=>{requests.push(input);if(requests.length===1)return new Promise(resolve=>release=()=>resolve({...input,revision:8}));return {...input,revision:21};},onSaved:value=>saved.push(value)});
  const first=sync.save({passageId:'old'}),queued=sync.save({passageId:'old-queued'});await new Promise(resolve=>setImmediate(resolve));
  sync.adopt(20);release();await first;await queued;
  assert.equal(requests.length,1);assert.equal(sync.revision,20);assert.equal(saved.length,0);
  await sync.save({passageId:'chosen'});assert.equal(requests[1].baseRevision,20);
});
test('a conflict pauses queued autosaves until the reader explicitly adopts the current revision',async()=>{
  let calls=0,conflicts=0;const sync=createProgressSync({send:async input=>{calls++;if(calls===1)throw Object.assign(Error('newer position'),{status:409});return {...input,revision:6};},onConflict:()=>conflicts++});
  const first=sync.save({passageId:'old'}).catch(e=>e),second=sync.save({passageId:'still-old'});await first;await second;
  assert.equal(calls,1);assert.equal(conflicts,1);assert.equal(sync.paused,true);
  sync.adopt(5);await sync.save({passageId:'chosen-by-reader'});assert.equal(calls,2);assert.equal(sync.revision,6);
});
