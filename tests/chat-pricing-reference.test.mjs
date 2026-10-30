import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createChatBudget} from '../harness/chat-generator.mjs';
import {assertPricingWindow} from '../server/pricing-reference.mjs';
const start=Date.parse('2026-10-25T00:00:00Z'),end=start+1000;
const pricing={validUntil:new Date(end).toISOString(),checkedAt:new Date(start).toISOString(),inputMissPerMillion:2,outputPerMillion:8,source:'fixture'};
test('legacy chat rechecks pricing at each dispatch and expires at the exact boundary',()=>{
 let now=start;const budget=createChatBudget({pricing,clock:()=>now});
 budget.reserveRequest({kind:'main',inputBytes:1,maxTokens:1});now=end;
 assert.throws(()=>budget.reserveRequest({kind:'main',inputBytes:1,maxTokens:1}),/Pricing reference/);
 assert.equal(budget.snapshot().requests,1);
});
test('future, malformed and expired prices fail before a request is reserved',()=>{
 for(const now of [start-1,end,NaN])assert.throws(()=>createChatBudget({pricing,clock:()=>now}),/Pricing reference/);
 for(const field of ['checkedAt','validUntil'])assert.throws(()=>assertPricingWindow({...pricing,[field]:'invalid'},start),/Pricing reference/);
 assert.throws(()=>assertPricingWindow(pricing,start,{minimumRemainingMs:1001}),/Pricing reference/);
 assert.throws(()=>assertPricingWindow(pricing,start,{maximumValidityMs:999}),/Pricing reference/);
});
test('the shipped legacy reference admits a bounded request at the real current time',async()=>{
 const reference=JSON.parse(await readFile(new URL('../harness/pricing.json',import.meta.url),'utf8'));
 const budget=createChatBudget({pricing:reference});budget.reserveRequest({kind:'main',inputBytes:20,maxTokens:1});assert.equal(budget.snapshot().requests,1);
});

test('release pricing check detects near expiry and never renews on source failure',async()=>{
 const {checkPublishedPricing}=await import('../tools/check-pricing.mjs');
 const before=await readFile(new URL('../harness/pricing.json',import.meta.url),'utf8');
 const result=await checkPublishedPricing();assert.equal(result.references.length,2);
 const earliest=Math.min(...result.references.map(p=>Date.parse(p.validUntil)));
 await assert.rejects(checkPublishedPricing({now:earliest-1000}),/Pricing reference/);
 await assert.rejects(checkPublishedPricing({verifySources:true,fetcher:async()=>{throw Error('fixture network failure');}}),/fixture network failure/);
 assert.equal(await readFile(new URL('../harness/pricing.json',import.meta.url),'utf8'),before);
});

const feeBoundary=Date.parse('2026-10-31T16:00:00Z');
const feePricing={...pricing,checkedAt:'2026-10-30T00:00:00Z',validUntil:'2026-11-03T00:00:00Z',searchPerThousand:5,fetchPerThousand:5,toolFeeBasis:'standalone-upper-bound'};
test('legacy auxiliary search reserves its standalone fee on both sides of the promotion boundary',()=>{
 for(const now of [feeBoundary-1,feeBoundary+1]){
  const budget=createChatBudget({pricing:feePricing,clock:()=>now});
  budget.tool();assert.equal(budget.snapshot().reservedCostCny,0,'domain tool calls do not imply paid web search');
  budget.reserveRequest({kind:'web',inputBytes:1,maxTokens:1});
  assert.equal(budget.snapshot().reservedCostCny,.005010);
 }
});
test('legacy tool fees are admitted atomically and missing or invalid fees cannot submit',()=>{
 const budget=createChatBudget({pricing:feePricing,maxCostCny:.005009,clock:()=>feeBoundary});let submitted=0;
 assert.throws(()=>{budget.reserveRequest({kind:'web',inputBytes:1,maxTokens:1});submitted++;},/budget/i);
 assert.equal(submitted,0);assert.equal(budget.snapshot().requests,0);assert.equal(budget.snapshot().reservedCostCny,0);
 for(const value of [undefined,0,-1,.5,10,NaN,Infinity]){
  const b=createChatBudget({pricing:{...feePricing,searchPerThousand:value},clock:()=>feeBoundary});
  assert.throws(()=>b.reserveRequest({kind:'web',inputBytes:1,maxTokens:1}),/Pricing reference/);
  assert.equal(b.snapshot().requests,0);assert.equal(b.snapshot().reservedCostCny,0);
 }
});

test('concurrent legacy auxiliary work shares the unchanged main cost ceiling',async()=>{
 const budget=createChatBudget({pricing:feePricing,maxCostCny:.05,clock:()=>feeBoundary+1});
 budget.reserveRequest({kind:'main',inputBytes:1000,maxTokens:3072});
 const results=await Promise.allSettled([1,2].map(()=>Promise.resolve().then(()=>budget.reserveRequest({kind:'web',inputBytes:0,maxTokens:1024}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(budget.snapshot().requests,2);assert.equal(budget.snapshot().reservedCostCny,.039768);
 assert.equal(budget.snapshot().maxCostCny,.05);
});
