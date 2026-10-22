import test from 'node:test';
import assert from 'node:assert/strict';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
import {withProviderMeter} from '../server/provider-metering.mjs';
import {createTranslator} from '../server/translation.mjs';
import {createDeepSeekGiftQuoteGenerator} from '../server/gift-quote.mjs';
import {createWebSearch} from '../server/reading-agent-search.mjs';
import {createChatBudget,createChatBridge} from '../harness/chat-generator.mjs';

const context=record=>({ownerId:'synthetic-dispatch',feature:'translation',funding:'credits',maxCostUsd:.12,record});
const window=()=>({from:new Date(Date.now()-60000).toISOString(),to:new Date(Date.now()+60000).toISOString()});
test('translation persists unknown dispatch before fetch and enriches the same attempt after response',async t=>{
  const store=createBillingMemoryStore(),record=row=>store.command('providerCall',{mode:'test',...row});
  t.mock.method(globalThis,'fetch',async()=>{
    const summary=await store.command('summary',{mode:'test',...window()});
    assert.equal(summary.calls,1);assert.equal(summary.unknownCostCalls,1);
    return Response.json({usage:{prompt_tokens:10,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:10,completion_tokens:5},choices:[{message:{content:'{"literal":"直译","interpretive":"意译"}'}}]});
  });
  await withProviderMeter(context(record),()=>createTranslator({DEEPSEEK_API_KEY:'synthetic-key'})({passageId:'p'}));
  const summary=await store.command('summary',{mode:'test',...window()});assert.equal(summary.calls,1);
});
test('unavailable dispatch persistence prevents translation and search requests from reaching a provider',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not dispatch');});
  const record=()=>{throw Error('isolated store unavailable');};
  for(const run of [()=>createTranslator({DEEPSEEK_API_KEY:'synthetic-key'})({passageId:'p'}),()=>createWebSearch({env:{DEEPSEEK_API_KEY:'synthetic-key'}})('query',{reserveRequest:()=>({})})]){
    await assert.rejects(withProviderMeter(context(record),run),{code:'provider_meter_unavailable'});
  }
  assert.equal(calls,0);
});
test('gift and nested search persist one unknown attempt before their provider begins',async t=>{
  const store=createBillingMemoryStore(),record=row=>store.command('providerCall',{mode:'test',...row});let requests=0;
  t.mock.method(globalThis,'fetch',async()=>{
    requests++;const summary=await store.command('summary',{mode:'test',...window()});assert.equal(summary.calls,requests);assert.ok(summary.unknownCostCalls>=1);
    return requests===1?Response.json({choices:[{message:{content:'{"candidateId":"q1"}'}}]}):Response.json({content:[{type:'web_search_tool_result',content:[]}]});
  });
  const gift=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'synthetic-key'}});
  await withProviderMeter(context(record),()=>gift({bookId:'b',contentVersion:'v',pool:[{passageId:'p',chapterId:'c',text:'A synthetic source sentence.'}]}));
  await withProviderMeter(context(record),()=>createWebSearch({env:{DEEPSEEK_API_KEY:'synthetic-key'}})('query',{reserveRequest:()=>({})}));
  assert.equal((await store.command('summary',{mode:'test',...window()})).calls,2);
});
test('DSH request admission awaits durable dispatch and terminal receipts cannot be rewritten',async()=>{
  const store=createBillingMemoryStore();let pending;
  const record=row=>{pending=row;return store.command('providerCall',{mode:'test',...row});};
  await withProviderMeter(context(record),async()=>{
    const budget=createChatBudget();await budget.dispatchRequest({kind:'main',inputBytes:10,maxTokens:10});
    assert.equal(pending.status,'unknown');assert.equal((await store.command('summary',{mode:'test',...window()})).calls,1);
    const completed={...pending,status:'completed',finishedAt:new Date().toISOString()};
    await record(completed);await record(completed);
    await assert.rejects(record({...completed,status:'failed'}),{code:'idempotency_conflict'});
    await assert.rejects(record({...completed,ownerId:'different-owner'}),{code:'idempotency_conflict'});
  });
});
test('DSH bridge withholds dispatch permission until its durable receipt is acknowledged',async()=>{
  let acknowledge,entered;
  const started=new Promise(resolve=>entered=resolve),persisted=new Promise(resolve=>acknowledge=resolve);
  const bridge=await withProviderMeter(context(async()=>{entered();await persisted;}),()=>createChatBridge({budget:createChatBudget(),tools:{definitions:[]}}));
  let response;
  try{
    const pending=fetch(bridge.url+'/reserve',{method:'POST',headers:{Authorization:'Bearer '+bridge.token},body:JSON.stringify({kind:'main',inputBytes:10,maxTokens:10})}).then(value=>{response=value;return value;});
    await started;assert.equal(response,undefined);
    acknowledge();assert.equal((await pending).status,200);
  }finally{acknowledge();await bridge.close();}
});
