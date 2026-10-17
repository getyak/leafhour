import test from 'node:test';
import assert from 'node:assert/strict';
import {bookTransfer} from '../server/book-transfer.mjs';
import {assembleBookTransfer} from '../app/book-transfer.mjs';

test('large UTF-8 books cross bounded transport parts without dropping or changing text',async()=>{
 const book={bookId:'private-book',contentVersion:'v1',text:'原文 🌱 / quoted "evidence". '.repeat(85000)},manifest=bookTransfer(book);
 let reads=0;const restored=await assembleBookTransfer(manifest,async(offset,snapshot)=>{reads++;const part=bookTransfer(book,offset,snapshot);assert.ok(Buffer.byteLength(part.data,'base64')<=1048576);return part;});
 assert.ok(reads>1);assert.deepEqual(restored,book);
});
test('a changed book, corrupt part or inconsistent offset cannot be assembled as a complete book',async()=>{
 const book={bookId:'b',contentVersion:'v',text:'x'.repeat(1100000)},manifest=bookTransfer(book);
 assert.throws(()=>bookTransfer({...book,text:'changed'},0,manifest.snapshot),e=>e.status===409);
 await assert.rejects(assembleBookTransfer(manifest,async(offset,snapshot)=>({...bookTransfer(book,offset,snapshot),data:Buffer.from('wrong').toString('base64')})));
 await assert.rejects(assembleBookTransfer(manifest,async(offset,snapshot)=>({...bookTransfer(book,offset,snapshot),nextOffset:offset})));
});
