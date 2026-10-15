import test from 'node:test';
import assert from 'node:assert/strict';
import * as shelf from '../app/shelf-order.mjs';
test('moving a visible book preserves the current read and filtered-out books',()=>{
  assert.equal(typeof shelf.moveShelfBook,'function');
  const ids=['current','a','hidden','b','c'];
  assert.deepEqual(shelf.moveShelfBook(ids,'c','a','before'),['current','c','a','hidden','b']);
  assert.deepEqual(shelf.moveShelfBook(ids,'a','b','after'),['current','hidden','b','a','c']);
  assert.deepEqual(ids,['current','a','hidden','b','c']);
});
test('unknown, duplicate and self moves cannot silently lose or duplicate a book',()=>{
  assert.equal(typeof shelf.moveShelfBook,'function');
  assert.deepEqual(shelf.moveShelfBook(['a','b'],'a','a','after'),['a','b']);
  assert.throws(()=>shelf.moveShelfBook(['a','b'],'other','b','before'));
  assert.throws(()=>shelf.moveShelfBook(['a','a'],'a','a','after'));
  assert.throws(()=>shelf.moveShelfBook(['a','b'],'a','b','sideways'));
});
