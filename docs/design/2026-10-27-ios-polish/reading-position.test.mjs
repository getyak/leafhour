import test from 'node:test';
import assert from 'node:assert/strict';
import * as reading from './prototype/reading-position.mjs';

const identity={bookId:'walden-public-sample',sourceVersion:'prototype-20261026',layer:'interpretive'};
const sample={schema:1,...identity,passageId:'walden-2-002',offsetUtf16:2,fraction:0.25,viewportOffsetPx:-4};
function normalize(raw=sample,text='甲乙丙丁'){
  assert.equal(typeof reading.normalizeReadingPosition,'function','reading-position validation must be implemented');
  return reading.normalizeReadingPosition(raw,identity,text);
}
test('a locator keeps its book, source version and paragraph independently of display pixels',()=>{
  const result=normalize();assert.deepEqual(result.position,sample);assert.equal(result.sameLayer,true);
});
test('a different book or source version is not restored as this document',()=>{
  assert.equal(normalize({...sample,bookId:'another-book'}),null);
  assert.equal(normalize({...sample,sourceVersion:'another-version'}),null);
});
test('offsets are bounded by actual same-layer text',()=>{
  assert.equal(normalize({...sample,offsetUtf16:999}).position.offsetUtf16,3);
  assert.equal(normalize({...sample,offsetUtf16:-5}).position.offsetUtf16,0);
  assert.equal(normalize({...sample,fraction:2}).position.fraction,1);
});
test('UTF-16 offsets do not split a surrogate pair',()=>{
  assert.equal(normalize({...sample,offsetUtf16:2},'A😀BC').position.offsetUtf16,1);
});
test('a different text layer uses the paragraph fallback instead of reusing its character offset',()=>{
  const result=normalize({...sample,layer:'source',offsetUtf16:25});
  assert.equal(result.sameLayer,false);assert.equal(result.position.offsetUtf16,25);assert.equal(result.position.fraction,0.25);
});
test('malformed and nonfinite locator fields are rejected',()=>{
  for(const value of [null,[],{...sample,schema:0},{...sample,layer:'unknown'},{...sample,offsetUtf16:NaN},{...sample,fraction:Infinity},{...sample,viewportOffsetPx:'4'},{...sample,passageId:''}]) assert.equal(normalize(value),null);
  assert.equal(normalize(sample,''),null);
});
test('normalization does not mutate the stored locator',()=>{
  const original={...sample,offsetUtf16:999};normalize(original);assert.equal(original.offsetUtf16,999);
});
