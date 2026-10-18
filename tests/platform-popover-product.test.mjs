import test from 'node:test';
import assert from 'node:assert/strict';
import {readerInteractionBlocked} from '../app/reader-conversation.mjs';

test('actual reader interaction guard remains usable when the browser rejects the unsupported popover pseudo-class',()=>{
  const document={
    querySelector(selector){if(selector.includes(':popover-open'))throw new SyntaxError('unsupported pseudo-class');return null;},
    querySelectorAll(){return [];},
  };
  assert.doesNotThrow(()=>assert.equal(readerInteractionBlocked(document,{closest:()=>null}),false));
});
