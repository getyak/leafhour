import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekGiftQuoteGenerator,createGiftQuoteService} from '../server/gift-quote.mjs';
import {withProviderMeter} from '../server/provider-metering.mjs';

const job={bookId:'book',contentVersion:'version',pool:[{passageId:'p',chapterId:'c',text:'A PRIVATE source sentence.'}]};
const meter=(record,maxCostUsd=.015)=>({ownerId:'owner',feature:'gift-quote',funding:'sponsored',maxCostUsd,record});
test('gift selector records real supplier usage separately from selected source text',async()=>{
 const rows=[],generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'PRIVATE credential'},fetcher:async()=>Response.json({usage:{prompt_tokens:150,prompt_cache_hit_tokens:50,prompt_cache_miss_tokens:100,completion_tokens:30},choices:[{message:{content:'{"candidateId":"q1"}'}}]})});
 const selected=await withProviderMeter(meter(row=>rows.push(row)),()=>generate(job));
 assert.equal(selected.text,job.pool[0].text);assert.equal(rows.length,2);assert.equal(rows[0].status,'unknown');assert.equal(rows[0].id,rows[1].id);const final=rows[1];assert.equal(final.funding,'sponsored');assert.equal(final.feature,'gift-quote');assert.equal(final.usage.inputTokens,100);assert.equal(final.usage.cacheReadTokens,50);assert.equal(final.status,'completed');assert.ok(final.id);assert.ok(final.startedAt);assert.ok(final.finishedAt);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|candidateId|q1/);
});
test('gift selector records failed and invalid result attempts without fake usage',async()=>{
 const rows=[];
 for(const fetcher of [async()=>{throw Error('PRIVATE network');},async()=>Response.json({choices:[{message:{content:'PRIVATE invalid JSON'}}]})]){
  const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture'},fetcher});
  await assert.rejects(withProviderMeter(meter(row=>rows.push(row)),()=>generate(job)));
 }
 assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>r.status),['unknown','failed','unknown','completed']);assert.equal(rows[0].id,rows[1].id);assert.equal(rows[2].id,rows[3].id);assert.notEqual(rows[0].id,rows[2].id);for(const row of rows){assert.equal(row.usage.inputTokens,null);assert.equal(row.costMicrousd,null);}assert.doesNotMatch(JSON.stringify(rows),/PRIVATE/);
});
test('gift sponsored budget refuses before model dispatch and rejected admission creates no call',async()=>{
 const rows=[];let calls=0;const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture'},fetcher:async()=>{calls++;throw Error('must not dispatch');}});
 await assert.rejects(withProviderMeter(meter(row=>rows.push(row),.000001),()=>generate(job)),/budget/i);assert.equal(calls,0);assert.equal(rows.length,0);
});
test('meter failure keeps deterministic gift fallback and never claims an AI-selected result',async()=>{
 const book={bookId:'book',contentVersion:'version',chapters:[{id:'c'}],sections:[{chapterId:'c',paragraphs:[{id:'p',original:job.pool[0].text}]}]};
 const service=createGiftQuoteService({library:{getBook:async()=>book},gifts:{prepareQuote:async(_user,selection)=>({...selection,receipt:'r',expiresAt:'2099-01-01'})},env:{DEEPSEEK_API_KEY:'fixture'},fetcher:async()=>Response.json({choices:[{message:{content:'{"candidateId":"q1"}'}}]})});
 const result=await withProviderMeter(meter(()=>{throw Error('PRIVATE persistence');}),()=>service.prepare({id:'owner'},'book'));assert.equal(result.quote.selection,'original-excerpt');assert.equal(result.quote.text,job.pool[0].text);
});
