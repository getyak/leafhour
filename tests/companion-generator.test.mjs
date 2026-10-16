import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionGenerator} from '../harness/companion-generator.mjs';

test('companion configures one bounded official run without tools and preserves silence',async()=>{
  let options,received;const generate=createCompanionGenerator({env:{DEEPSEEK_API_KEY:'fixture'},makeGenerator:value=>{options=value;return async job=>{received=job;return {summary:'{"kind":"silence"}'};};}});
  const result=await generate({book:{bookId:'b',contentVersion:'v1'},passageId:'p',context:{passages:[{id:'p',original:'Source'}]},history:[]});
  assert.deepEqual(result,{kind:'silence'});assert.equal(options.maxRequests,1);assert.equal(options.maxToolCalls,0);assert.equal(options.maxCostCny,.1);assert.equal(options.maxTokens,512);assert.deepEqual(received.tools.definitions,[]);assert.ok(received.text.includes('Source'));assert.ok(!options.systemPrompt.includes('reader_cite'));
});
test('invalid oversized or non-JSON companion replies fail rather than being substituted',async()=>{
  for(const summary of ['hello','{}','{"kind":"message","text":"'+ '字'.repeat(181)+'","sourcePassageIds":["p"]}']){
    const generate=createCompanionGenerator({makeGenerator:()=>async()=>({summary})});await assert.rejects(generate({book:{bookId:'b'},context:{passages:[]}}));
  }
});
