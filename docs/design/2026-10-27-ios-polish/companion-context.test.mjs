import test from 'node:test';
import assert from 'node:assert/strict';
import * as companion from './prototype/companion-context.mjs';
const previous={passageId:'p1',version:'v1',layer:'interpretive',startUtf16:2,endUtf16:4,text:'原句'};
const current={passageId:'p2',version:'v1',layer:'interpretive',startUtf16:0,endUtf16:3,text:'当前段'};
function resolve(extra={}){
  assert.equal(typeof companion.resolveCompanionContext,'function','companion context resolution must be implemented');
  return companion.resolveCompanionContext({readingQuote:current,discussionQuote:previous,...extra});
}
test('quote identity retains the existing six-field format',()=>{
  assert.equal(typeof companion.quoteIdentity,'function');
  assert.equal(companion.quoteIdentity(previous),JSON.stringify(['p1','v1','interpretive',2,4,'原句']));
});
test('a fresh entry follows the current reading paragraph instead of a placeholder',()=>{
  const r=resolve();assert.equal(r.mode,'reading');assert.equal(r.label,'读到这里');assert.deepEqual(r.quote,current);assert.equal(r.relation,'current');
});
test('a previous draft keeps its exact source and offers an explicit current-paragraph switch',()=>{
  const r=resolve({draft:'还没问完'});assert.equal(r.mode,'discussion');assert.equal(r.label,'继续讨论');assert.deepEqual(r.quote,previous);assert.equal(r.canAskCurrent,true);
});
test('a sent question keeps its established source',()=>{
  assert.deepEqual(resolve({question:'原来的问题'}).quote,previous);
});
test('an explicit selection keeps its scope even before typing a question',()=>{
  const r=resolve({discussionStarted:true,readingQuote:{...previous,startUtf16:0,endUtf16:4,text:'整段原句'}});
  assert.deepEqual(r.quote,previous);assert.equal(r.relation,'selection');assert.equal(r.canAskCurrent,true);
});
test('an uncompleted request alone resumes its own snapshot',()=>{
  const pending={quote:previous,question:'尚未完成的问题'};
  const r=resolve({discussionQuote:current,pendingTurn:pending});assert.deepEqual(r.quote,previous);assert.deepEqual(pending.quote,previous);
});
test('a new active draft is not replaced by another paragraphs pending request',()=>{
  const r=resolve({discussionQuote:current,draft:'新的草稿',pendingTurn:{quote:previous,question:'旧问题'}});assert.deepEqual(r.quote,current);assert.equal(r.canAskCurrent,false);
});
test('whitespace does not establish a discussion',()=>{
  assert.deepEqual(resolve({draft:'  ',question:'\n'}).quote,current);
});
test('an established question with an incomplete source is not silently rebound',()=>{
  const r=resolve({discussionQuote:null,question:'不能丢的问题'});assert.equal(r.mode,'blocked');assert.equal(r.quote,null);
});
test('resolver output does not mutate or alias the source snapshot',()=>{
  const r=resolve({draft:'保留'});assert.notEqual(r.quote,previous);r.quote.text='修改';assert.equal(previous.text,'原句');
});
