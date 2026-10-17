import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePaddlePage} from '../server/paddleocr.mjs';
test('keeps footnotes, excludes page furniture, records normalized boxes and original page numbers',()=>{
 const page=normalizePaddlePage({markdownText:'ignored',prunedResult:{width:100,height:200,parsing_res_list:[{block_label:'header',block_content:'页眉',block_bbox:[0,0,100,10]},{block_label:'text',block_content:'原文\n续行',block_bbox:[10,20,90,120],block_order:1},{block_label:'footnote',block_content:'① 译者注',block_bbox:[10,150,90,180],block_order:null}]}},31);
 assert.equal(page.page,31);assert.equal(page.blocks.length,2);assert.equal(page.blocks[0].text,'原文续行');assert.deepEqual(page.blocks[0].bbox,[.1,.1,.9,.6]);assert.equal(page.blocks[1].type,'footnote');assert.equal(page.discarded.length,1);assert.ok(page.blocks[0].id);
});
test('does not treat a malformed result as a blank page',()=>{assert.throws(()=>normalizePaddlePage({markdownText:'lost'},1));});
