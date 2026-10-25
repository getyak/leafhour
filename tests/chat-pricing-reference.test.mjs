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
