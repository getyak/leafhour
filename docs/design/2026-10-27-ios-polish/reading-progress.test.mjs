import test from 'node:test';import assert from 'node:assert/strict';
const a=await import('./prototype/reading-progress.mjs').catch(()=>({}));
const passages=[{id:'p1',source:'ABC',interpretive:'甲乙'},{id:'p2',source:'D🙂F',interpretive:'丙丁戊'}],identity={bookId:'b',sourceVersion:'v',layer:'source'};
test('chapter seek starts at first source character',()=>{const p=a.positionAtProgress(0,passages,identity);assert.equal(p.passageId,'p1');assert.equal(p.offsetUtf16,0);});
test('chapter seek end uses the last source character even when the chapter fits onscreen',()=>{const p=a.positionAtProgress(1,passages,identity);assert.equal(p.passageId,'p2');assert.equal(p.offsetUtf16,3);assert.equal(a.progressAtPosition(p,passages,'source'),1);});
test('paragraph boundaries and mid-chapter positions use stable text rather than pixels',()=>{const p=a.positionAtProgress(.5,passages,identity);assert.equal(p.passageId,'p2');assert.equal(p.offsetUtf16,0);assert.equal(a.progressAtPosition(p,passages,'source'),.5);});
test('seek never splits a source surrogate pair',()=>{const p=a.positionAtProgress(5/6,passages,identity);assert.equal(p.passageId,'p2');assert.equal(p.offsetUtf16,1);});
test('another reading layer uses its own text lengths',()=>{const p=a.positionAtProgress(1,passages,{...identity,layer:'interpretive'});assert.equal(p.offsetUtf16,2);assert.equal(a.progressAtPosition(p,passages,'interpretive'),1);});
test('empty chapters and invalid seeks do not fabricate a position',()=>{assert.equal(a.positionAtProgress(NaN,passages,identity),null);assert.equal(a.positionAtProgress(.5,[],identity),null);assert.equal(a.progressAtPosition(null,passages,'source'),0);});
