import test from 'node:test';
import assert from 'node:assert/strict';
import * as shelf from '../app/book-import-shelf.mjs';
const format=(id,params)=>({id,params});
test('finished extraction is followed by an indeterminate saving stage, never a false completed percentage',()=>{
 const result=shelf.importShelfPresentation({stage:'organizing',job:{state:'publishing',progress:{completed:2131,total:2131}}},{format});assert.equal(result.active,true);assert.equal(result.percent,null);assert.equal(result.message.id,'bookUpload.saving');
});
test('extraction progress remains measured and a saved parse error retains its real reason',()=>{
 const parsing=shelf.importShelfPresentation({stage:'organizing',job:{state:'running',progress:{completed:32,total:64}}},{format});assert.equal(parsing.percent,50);assert.equal(parsing.message.id,'bookUpload.parsing');const failed=shelf.importShelfPresentation({stage:'interrupted',job:{state:'failed',error:'EPUB: invalid XML'}},{format});assert.equal(failed.active,false);assert.equal(failed.message,'EPUB: invalid XML');
});

test('a failed action remains visible while publication continues',()=>{const result=shelf.importShelfPresentation({stage:'organizing',error:true,job:{state:'publishing'}},{format});assert.equal(result.message.id,'bookUpload.error');assert.equal(result.percent,null);});
