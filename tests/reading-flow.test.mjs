import test from 'node:test';
import assert from 'node:assert/strict';
import * as flowModule from '../app/reading-flow.mjs';
import * as loadModule from '../app/reading-load.mjs';
const chapters=[{id:'one'},{id:'two'},{id:'three'}];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('the readable book is ready even while personal records are still pending',async()=>{
  assert.equal(typeof loadModule.startReadingLoad,'function','Non-blocking loading is not implemented');
  const book=deferred(),records=deferred();
  const load=loadModule.startReadingLoad({readBook:()=>book.promise,readRecords:()=>records.promise});
  book.resolve({bookId:'book'});
  assert.deepEqual(await load.book,{bookId:'book'});
  assert.equal(load.peekRecords(),undefined);
  records.resolve({comments:[],position:{passageId:'second'}});
  assert.equal((await load.records).position.passageId,'second');
});
test('unavailable personal records do not discard a readable book',async()=>{
  assert.equal(typeof loadModule.startReadingLoad,'function');
  const load=loadModule.startReadingLoad({readBook:async()=>({bookId:'book'}),readRecords:async()=>{throw Error('offline');}});
  assert.deepEqual(await load.book,{bookId:'book'});
  assert.equal(await load.records,null);
});
test('records that arrive first are available for the initial position restoration',async()=>{
  assert.equal(typeof loadModule.startReadingLoad,'function');
  const book=deferred(),load=loadModule.startReadingLoad({readBook:()=>book.promise,readRecords:async()=>({position:{passageId:'last'}})});
  await load.records;book.resolve({bookId:'book'});await load.book;
  assert.equal(load.peekRecords().position.passageId,'last');
});
test('a delayed records response retains newly acknowledged notes and milestones',()=>{
  assert.equal(typeof loadModule.mergeLoadedReadingRecords,'function');
  const merged=loadModule.mergeLoadedReadingRecords({comments:[{id:'old',text:'server'}],questions:[],readingMilestones:[]},{comments:[{id:'new',text:'just saved'}],readingMilestones:[{id:'mark'}]});
  assert.deepEqual(merged.comments.map(x=>x.id),['old','new']);assert.equal(merged.readingMilestones[0].id,'mark');
});
test('continuous reading prepares only the adjacent chapter and reuses it on append',()=>{
  assert.equal(typeof flowModule.createChapterFlow,'function','Continuous chapter preparation is not implemented');
  const flow=flowModule.createChapterFlow({chapters,render:chapter=>({id:chapter.id})});
  assert.equal(flow.start('one').id,'one');
  const prepared=flow.prepareNext();
  assert.equal(prepared.id,'two');
  assert.deepEqual(flow.renderedIds,['one']);
  assert.strictEqual(flow.appendNext().node,prepared);
  assert.deepEqual(flow.renderedIds,['one','two']);
  assert.equal(flow.nextId,'three');
});
test('a delayed records response cannot resurrect a removed highlight',()=>{
  const row={id:'highlight',bookId:'book',contentVersion:'v1',chapterId:'one',parts:[]};
  const merged=loadModule.mergeLoadedReadingRecords({highlights:[row]},{highlights:[{...row,deletedAt:'2026-10-16T00:00:00Z'}]});
  assert.equal(merged.highlights[0].deletedAt,'2026-10-16T00:00:00Z');
});
test('chapter ordering is retained, duplicate appends stop at the end, and a jump resets the flow',()=>{
  assert.equal(typeof flowModule.createChapterFlow,'function');
  const flow=flowModule.createChapterFlow({chapters,render:chapter=>({id:chapter.id})});
  flow.start('two');flow.appendNext();
  assert.equal(flow.appendNext(),null);
  assert.deepEqual(flow.renderedIds,['two','three']);
  flow.start('one');assert.deepEqual(flow.renderedIds,['one']);
  assert.equal(flow.node('three'),null);
});
test('language changes invalidate prepared content while preserving the paragraphs already in the page',()=>{
  assert.equal(typeof flowModule.createChapterFlow,'function');
  let language='source';
  const flow=flowModule.createChapterFlow({chapters,render:chapter=>({id:chapter.id,language})});
  const first=flow.start('one'),old=flow.prepareNext();language='translation';flow.invalidatePrepared();
  assert.strictEqual(flow.node('one'),first);
  const next=flow.appendNext().node;
  assert.notStrictEqual(next,old);assert.equal(next.language,'translation');
});
test('only typographic dividers are compacted, not prose or untranslated sentences',()=>{
  assert.equal(typeof flowModule.isReadingDivider,'function');
  assert.equal(flowModule.isReadingDivider('* * * * * * *'),true);
  assert.equal(flowModule.isReadingDivider('***'),true);
  assert.equal(flowModule.isReadingDivider('···'),true);
  assert.equal(flowModule.isReadingDivider('· · ·'),true);
  assert.equal(flowModule.isReadingDivider('Wait · before continuing.'),false);
  assert.equal(flowModule.isReadingDivider('Never *just* assume.'),false);
  assert.equal(flowModule.isReadingDivider('A missing translation.'),false);
});
