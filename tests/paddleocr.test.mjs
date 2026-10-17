import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePaddlePage} from '../server/paddleocr.mjs';
test('keeps footnotes, excludes page furniture, records normalized boxes and original page numbers',()=>{
 const page=normalizePaddlePage({markdownText:'ignored',prunedResult:{width:100,height:200,parsing_res_list:[{block_label:'header',block_content:'页眉',block_bbox:[0,0,100,10]},{block_label:'text',block_content:'原文\n续行',block_bbox:[10,20,90,120],block_order:1},{block_label:'footnote',block_content:'① 译者注',block_bbox:[10,150,90,180],block_order:null}]}},31);
 assert.equal(page.page,31);assert.equal(page.blocks.length,2);assert.equal(page.blocks[0].text,'原文续行');assert.deepEqual(page.blocks[0].bbox,[.1,.1,.9,.6]);assert.equal(page.blocks[1].type,'footnote');assert.equal(page.discarded.length,1);assert.ok(page.blocks[0].id);
});
test('does not treat a malformed result as a blank page',()=>{assert.throws(()=>normalizePaddlePage({markdownText:'lost'},1));});
test('renders Chinese emphasis and circled footnotes as readable source while retaining real formula syntax',()=>{const source=String.raw`原文 $ \underset{\cdot}{自}\underset{\cdot}{因的} $。注 $ ^{①} $。公式 $x+y$。`;const p=normalizePaddlePage({prunedResult:{width:100,height:100,parsing_res_list:[{block_label:'text',block_content:source,block_bbox:[20,10,90,80]}]}},1);assert.equal(p.text,'原文 自因的。注 ①。公式 $x+y$。');assert.ok(p.blocks[0].transforms.includes('chinese-dot-emphasis-v1'));});
test('drops only isolated numeric side labels at page edges, preserving real marginal text',()=>{const p=normalizePaddlePage({prunedResult:{width:100,height:100,parsing_res_list:[{block_label:'aside_text',block_content:'144',block_bbox:[1,50,10,55]},{block_label:'aside_text',block_content:'边注内容',block_bbox:[1,60,10,70]},{block_label:'text',block_content:'正文有32个字。',block_bbox:[20,10,90,80]}]}},1);assert.equal(p.discarded.length,1);assert.equal(p.blocks[0].text,'边注内容');assert.ok(p.text.includes('32个'));});
