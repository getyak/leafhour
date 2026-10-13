import test from 'node:test';import assert from 'node:assert/strict';
import {captureParagraphAnchor,paragraphScrollDelta,validParagraphAnchor} from '../app/paragraph-anchor.mjs';
test('a deep paragraph anchor stays bounded and restores its fraction after reflow',()=>{
  const anchor=captureParagraphAnchor({top:-8920,height:12000},80);
  assert.deepEqual(anchor,{offset:-4000,withinParagraph:0.75});assert.equal(validParagraphAnchor(anchor),true);
  assert.equal(paragraphScrollDelta({top:300,height:16000},anchor,80),12220);
  assert.equal(paragraphScrollDelta({top:-8920,height:12000},anchor,80),0);
});
test('paragraphs below the reading edge and legacy anchors keep their exact pixel placement',()=>{
  assert.deepEqual(captureParagraphAnchor({top:160,height:12000},80),{offset:160});
  assert.equal(paragraphScrollDelta({top:300,height:12000},{offset:160},80),140);
  for(const withinParagraph of [-0.1,1.1,NaN,'0.5'])assert.equal(validParagraphAnchor({offset:0,withinParagraph}),false);
});
