import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePersonReturn,readPersonReturn} from '../app/person-return.mjs';
test('an unfamiliar author keeps its search and book return only in owner-scoped session state',()=>{
 const rows=new Map(),storage={setItem:(k,v)=>rows.set(k,v),getItem:k=>rows.get(k)};
 assert.equal(capturePersonReturn({storage,owner:'reader',bookId:'private-book',passageId:'p1',personId:'pending-author',searchQuery:'An unfamiliar author'}),true);
 const intent=readPersonReturn({storage,owner:'reader',personId:'pending-author'});assert.equal(intent.searchQuery,'An unfamiliar author');assert.equal(readPersonReturn({storage,owner:'other',personId:'pending-author'}),null);
 capturePersonReturn({...intent,storage,personId:'chosen-person'});assert.equal(readPersonReturn({storage,owner:'reader',personId:'chosen-person'}).bookId,'private-book');
});
