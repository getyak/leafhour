import test from 'node:test';
import assert from 'node:assert/strict';
import {DEEPSEEK_PRICING,createProviderBudget,priceProviderUsage} from '../server/provider-pricing.mjs';
import {createChatBudget} from '../harness/chat-generator.mjs';
import {withProviderMeter} from '../server/provider-metering.mjs';
import {createTranslator} from '../server/translation.mjs';

const now=Date.parse('2026-10-21T12:00:00Z');
test('verified USD reference has separate peak/cache/tool prices and dated expiry',()=>{
 assert.equal(DEEPSEEK_PRICING.currency,'USD');assert.equal(DEEPSEEK_PRICING.peak.inputPerMillion,.3);assert.equal(DEEPSEEK_PRICING.peak.cacheReadPerMillion,.006);assert.equal(DEEPSEEK_PRICING.peak.outputPerMillion,1.2);assert.equal(DEEPSEEK_PRICING.searchPerThousand,.75);assert.equal(DEEPSEEK_PRICING.harnessToolsFreeUntil,'2026-10-31T16:00:00.000Z');
 assert.ok(Date.parse(DEEPSEEK_PRICING.validUntil)>now);
});
test('USD budget reserves peak upper bounds and refuses before dispatch atomically',()=>{
 const budget=createProviderBudget({maxCostUsd:.015,clock:()=>now});
 budget.reserveRequest({kind:'main',inputBytes:30000,maxTokens:5000});
 assert.equal(budget.snapshot().reservedCostMicrousd,15000);
 assert.throws(()=>budget.reserveRequest({kind:'web',inputBytes:1,maxTokens:1}),/budget/i);assert.equal(budget.snapshot().requests,1);
});
test('paid price guards fail closed for expired reference and unsupported models',()=>{
 assert.throws(()=>createProviderBudget({pricing:{...DEEPSEEK_PRICING,validUntil:'2026-01-01'},clock:()=>now}),/expired/i);
 assert.throws(()=>createProviderBudget({model:'custom',clock:()=>now}),/pricing/i);
 assert.throws(()=>createProviderBudget({clock:()=>NaN}),/pricing/i);
 for(const maxRequests of [0,-1,NaN,Infinity])assert.throws(()=>createProviderBudget({maxRequests,clock:()=>now}),/budget/i);
 for(const maxToolCalls of [-1,NaN,Infinity])assert.throws(()=>createProviderBudget({maxToolCalls,clock:()=>now}),/budget/i);
});
test('usage estimate counts caches once and never prices missing token counters as zero',()=>{
 const usage={inputTokens:1000000,cacheReadTokens:1000000,cacheWriteTokens:0,outputTokens:1000000};
 const rated=priceProviderUsage({usage,model:'deepseek-flash',startedAt:'2026-10-21T12:00:00Z',clock:()=>now});
 assert.equal(rated.costMicrousd,753000);assert.equal(rated.costStatus,'reported_usage_rated');
 assert.equal(priceProviderUsage({usage:{inputTokens:10,outputTokens:null},clock:()=>now}).costMicrousd,null);
 const peak=priceProviderUsage({usage,startedAt:'2026-10-21T06:30:00Z',clock:()=>now});assert.equal(peak.costStatus,'partial');assert.equal(peak.costMicrousd,1506000);
});
test('missing applicable DSH cache-write count keeps cost unknown',()=>{
 const usage={inputTokens:10,cacheReadTokens:0,cacheWriteTokens:null,outputTokens:20};
 assert.equal(priceProviderUsage({usage,startedAt:'2026-10-21T12:00:00Z',clock:()=>now}).costMicrousd,null);
 assert.equal(priceProviderUsage({usage,cacheWriteIncludedInInput:true,startedAt:'2026-10-21T12:00:00Z',clock:()=>now}).costStatus,'reported_usage_rated');
});
test('credit-funded chat preserves per-request output caps and rejects an expired reference at dispatch',async()=>{
 let clock=now;
 await withProviderMeter({ownerId:'a',operationId:'o',feature:'conversation',funding:'credits',maxCostUsd:.12,record:()=>{}},async()=>{
  assert.throws(()=>createChatBudget({clock:()=>clock}).reserveRequest({kind:'main',inputBytes:1,maxTokens:3073}),/budget/i);
  assert.throws(()=>createChatBudget({clock:()=>clock}).reserveRequest({kind:'web',inputBytes:1,maxTokens:1025}),/budget/i);
  const budget=createChatBudget({clock:()=>clock});clock=Date.parse(DEEPSEEK_PRICING.validUntil);assert.throws(()=>budget.reserveRequest({kind:'main',inputBytes:1,maxTokens:1}),/expired/i);assert.equal(budget.snapshot().requests,0);
 });
});
test('paid chat uses USD while disabled billing preserves legacy CNY reservations',async()=>{
 const legacy={checkedAt:'2026-10-21',validUntil:'2099-01-01',inputMissPerMillion:2,outputPerMillion:8};
 const free=createChatBudget({pricing:legacy});free.reserveRequest({kind:'main',inputBytes:30000,maxTokens:3072});assert.ok(free.snapshot().reservedCostCny>0);
 await withProviderMeter({ownerId:'a',operationId:'o',feature:'conversation',funding:'purchased',record:()=>{}},async()=>{
  const paid=createChatBudget({pricing:{...legacy,validUntil:'2000-01-01'},clock:()=>now});
  for(let i=0;i<8;i++)paid.reserveRequest({kind:'main',inputBytes:30000,maxTokens:3072});
  assert.ok(paid.snapshot().reservedCostMicrousd<=120000);assert.equal(paid.snapshot().currency,'USD');
 });
});
test('paid translation refuses input above verified peak budget without a model call',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not dispatch');});
 await assert.rejects(withProviderMeter({ownerId:'a',operationId:'o',feature:'translation',funding:'purchased',record:()=>{}},()=>createTranslator({DEEPSEEK_API_KEY:'fixture'})({text:'x'.repeat(40000)})),/budget/i);assert.equal(calls,0);
});
