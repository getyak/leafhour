import test from 'node:test';
import assert from 'node:assert/strict';
import {withProviderMeter,providerMeterContext,recordProviderCall,normalizeDshUsage,normalizeDeepSeekUsage,createDshMeter} from '../server/provider-metering.mjs';
import {createTranslator} from '../server/translation.mjs';
import {createWebSearch} from '../server/reading-agent-search.mjs';
import {createChatGenerator} from '../harness/chat-generator.mjs';
import {Server} from 'node:http';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const stamp='2026-10-21T12:00:00.000Z';
const context=record=>({ownerId:'owner-a',operationId:'operation-a',feature:'translation',funding:'purchased',record});
test('DSH input and cache counters stay disjoint and reasoning is not added to output',()=>{
 assert.deepEqual(normalizeDshUsage({inputTokens:100,outputTokens:30,cacheReadTokens:50,cacheWriteTokens:5,reasoningTokens:20,totalTokens:185}),{inputTokens:100,outputTokens:30,cacheReadTokens:50,cacheWriteTokens:5});
 assert.deepEqual(normalizeDshUsage(),{inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null});
 assert.equal(normalizeDshUsage({inputTokens:-1,outputTokens:NaN}).inputTokens,null);
});
test('OpenAI prompt aggregate is split only using authoritative hit/miss counters',()=>{
 assert.deepEqual(normalizeDeepSeekUsage({prompt_tokens:150,completion_tokens:30,prompt_cache_hit_tokens:50,prompt_cache_miss_tokens:100}),{inputTokens:100,outputTokens:30,cacheReadTokens:50,cacheWriteTokens:null});
 assert.equal(normalizeDeepSeekUsage({prompt_tokens:150,completion_tokens:30}).inputTokens,null);
 assert.equal(normalizeDeepSeekUsage({prompt_tokens:20,prompt_cache_hit_tokens:50}).inputTokens,null);
});
test('meter context is isolated across concurrent owners and cannot be overwritten by supplier facts',async()=>{
 const rows=[];
 await Promise.all(['a','b'].map(ownerId=>withProviderMeter({...context(row=>rows.push(row)),ownerId},async()=>{
  await Promise.resolve();assert.equal(providerMeterContext().ownerId,ownerId);
  await recordProviderCall({id:'call-'+ownerId,ownerId:'intruder',feature:'intruder',provider:'deepseek',model:'deepseek-flash',status:'failed',startedAt:stamp,error:'PRIVATE',prompt:'PRIVATE',usage:{inputTokens:5,prompt:'PRIVATE'}});
 })));
 assert.deepEqual(rows.map(row=>row.ownerId).sort(),['a','b']);
 assert.equal(rows[0].feature,'translation');assert.equal(rows[0].usage.outputTokens,null);assert.equal(rows[0].costStatus,'unknown');
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|intruder/);assert.equal(providerMeterContext(),undefined);
});
test('recorder failure is surfaced with fixed safe facts and a successful record is awaited',async()=>{
 let finished=false;
 await withProviderMeter(context(async()=>{await Promise.resolve();finished=true;}),()=>recordProviderCall({id:'call',provider:'deepseek',model:'deepseek-flash',status:'failed',startedAt:stamp}));
 assert.equal(finished,true);
 await assert.rejects(withProviderMeter(context(()=>{throw Error('PRIVATE database failure');}),()=>recordProviderCall({id:'call',provider:'deepseek',model:'deepseek-flash',status:'failed',startedAt:stamp})),error=>error.code==='provider_meter_unavailable'&&!JSON.stringify(error).includes('PRIVATE')&&!error.message.includes('PRIVATE'));
 assert.equal(await recordProviderCall({prompt:'PRIVATE'}),null);
});
test('installed DSH message and failed-attempt stream shapes count once, including missing usage',async()=>{
 const rows=[],meter=createDshMeter({model:'deepseek-flash',startedAt:stamp,idPrefix:'run'});
 const message={type:'assistant/message',seq:3,time:Date.parse(stamp),data:{usage:{inputTokens:10,outputTokens:20,cacheReadTokens:5},stream:[{type:'chunk',time:1,chunk:{type:'usage',usage:{inputTokens:999,outputTokens:999}}}],message:{content:'PRIVATE'}}};
 meter.observe(message);meter.observe(structuredClone(message));
 meter.observe({type:'assistant/attempt',seq:4,data:{stream:[{type:'chunk',time:1,chunk:{type:'usage',usage:{inputTokens:2,outputTokens:3}}},{type:'chunk',time:2,chunk:{type:'finish',reason:{kind:'error',failure:{message:'PRIVATE'}}}}]}});
 meter.observe({type:'assistant/message',seq:5,data:{message:{content:'PRIVATE'}}});
 await withProviderMeter(context(row=>rows.push(row)),()=>meter.flush({finishedAt:stamp,attempts:[{id:'admitted-1'},{id:'admitted-2'},{id:'admitted-3'},{id:'admitted-4'}]}));
 assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>r.id),['admitted-1','admitted-2','admitted-3','admitted-4']);assert.equal(rows[0].usage.inputTokens,10);assert.equal(rows[1].status,'failed');assert.equal(rows[1].usage.outputTokens,3);assert.equal(rows[2].costStatus,'unknown');assert.equal(rows[3].status,'unknown');
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|999/);
});
test('translation meters supplier usage even when generated JSON is invalid',async t=>{
 const rows=[];t.mock.method(globalThis,'fetch',async()=>Response.json({usage:{prompt_tokens:150,completion_tokens:30,prompt_cache_hit_tokens:50,prompt_cache_miss_tokens:100},choices:[{message:{content:'invalid PRIVATE'}}]}));
 await assert.rejects(withProviderMeter(context(row=>rows.push(row)),()=>createTranslator({DEEPSEEK_API_KEY:'fixture'})({passageId:'p',passages:[{original:'PRIVATE'}]})),/格式/);
 assert.equal(rows.length,2);assert.equal(rows[0].status,'unknown');assert.equal(rows[0].id,rows[1].id);assert.equal(rows[1].status,'completed');assert.equal(rows[1].usage.inputTokens,100);assert.equal(rows[1].usage.cacheReadTokens,50);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|fixture/);
});
test('translation records failed dispatch without fabricating zero tokens',async t=>{
 const rows=[];t.mock.method(globalThis,'fetch',async()=>{throw Error('PRIVATE network error');});
 await assert.rejects(withProviderMeter(context(row=>rows.push(row)),()=>createTranslator({DEEPSEEK_API_KEY:'fixture'})({passageId:'p'})));
 assert.equal(rows.length,2);assert.equal(rows[0].status,'unknown');assert.equal(rows[0].id,rows[1].id);assert.equal(rows[1].status,'failed');assert.equal(rows[1].usage.inputTokens,null);assert.equal(rows[1].costMicrousd,null);
});
test('nested web requests persist unknown coverage because installed search SDK hides response usage',async t=>{
 const rows=[];t.mock.method(globalThis,'fetch',async()=>Response.json({usage:{input_tokens:40,output_tokens:50},content:[{type:'web_search_tool_result',content:[]}]}));
 await withProviderMeter({...context(row=>rows.push(row)),feature:'conversation'},()=>createWebSearch({env:{DEEPSEEK_API_KEY:'fixture'}})('PRIVATE query',{reserveRequest:()=>({})}));
 assert.equal(rows.length,2);assert.equal(rows[0].id,rows[1].id);assert.equal(rows[1].operationId,'operation-a');assert.equal(rows[1].costStatus,'unknown');assert.equal(rows[1].usage.inputTokens,null);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|query|fixture/);
});
test('rejected nested request budget does not record an undispatched supplier call',async t=>{
 const rows=[];t.mock.method(globalThis,'fetch',async()=>{throw Error('must not dispatch');});
 await assert.rejects(withProviderMeter(context(row=>rows.push(row)),()=>createWebSearch({env:{DEEPSEEK_API_KEY:'fixture'}})('query',{reserveRequest:()=>{throw Error('budget exhausted');}})));
 assert.equal(rows.length,0);
});
test('verified DSH tool-calls finish remains a completed supplier call',async()=>{
 const rows=[],meter=createDshMeter({startedAt:stamp});
 meter.observe({type:'assistant/message',seq:1,data:{usage:{inputTokens:10,outputTokens:20},stream:[{type:'chunk',time:1,chunk:{type:'finish',reason:{kind:'tool-calls'}}}]}});
 await withProviderMeter(context(row=>rows.push(row)),()=>meter.flush({finishedAt:stamp}));assert.equal(rows[0].status,'completed');
});
test('DSH failed-attempt usage survives a later successful step without double-counting message stream',async()=>{
 const rows=[],meter=createDshMeter({startedAt:stamp,idPrefix:'run'});
 meter.observe({type:'assistant/attempt',seq:1,data:{stream:[{type:'chunk',time:1,chunk:{type:'usage',usage:{inputTokens:6,outputTokens:2,cacheReadTokens:0}}},{type:'chunk',time:2,chunk:{type:'finish',reason:{kind:'error'}}}]}});
 meter.observe({type:'assistant/message',seq:2,data:{usage:{inputTokens:10,outputTokens:20,cacheReadTokens:0},stream:[{type:'chunk',time:3,chunk:{type:'usage',usage:{inputTokens:10,outputTokens:20,cacheReadTokens:0}}}]}});
 await withProviderMeter(context(row=>rows.push(row)),()=>meter.flush({finishedAt:stamp}));await withProviderMeter(context(row=>rows.push(row)),()=>meter.flush({finishedAt:stamp}));
 assert.equal(rows.length,2);assert.equal(rows[0].usage.inputTokens,6);assert.equal(rows[1].usage.inputTokens,10);assert.equal(rows[0].status,'failed');assert.equal(rows[1].status,'completed');
});
test('failed meter persistence can retry the same stable attempt without silently dropping it',async()=>{
 const rows=[],meter=createDshMeter({startedAt:stamp,idPrefix:'stable'});meter.observe({type:'assistant/attempt',seq:1,data:{stream:[]}});
 await assert.rejects(withProviderMeter(context(()=>{throw Error('offline');}),()=>meter.flush({finishedAt:stamp})),{code:'provider_meter_unavailable'});
 await withProviderMeter(context(row=>rows.push(row)),()=>meter.flush({finishedAt:stamp}));assert.equal(rows.length,1);assert.equal(rows[0].id,'stable:1');
});
async function generatorFixture(t,run,{record=()=>{}}={}){
 // Make accidental socket use fail before the operating system is called.
 t.mock.method(Server.prototype,'listen',()=>{throw Error('TCP forbidden in isolated generator test');});
 const runRoot=await mkdtemp(path.join(tmpdir(),'leafhour-meter-'));t.after(()=>rm(runRoot,{recursive:true,force:true}));
 let budget,closed=0;const rows=[];
 const generate=createChatGenerator({runRoot,env:{DEEPSEEK_API_KEY:'fixture'},createBridge:async options=>{budget=options.budget;return {url:'http://127.0.0.1:1',token:'fixture',close:async()=>{}};},createHarness:()=>({start:async()=>{},run:async(input,options)=>run(options,budget),close:async()=>{closed++;}})});
 const job={text:'PRIVATE question',book:{bookId:'b',contentVersion:'v'},passageId:'p',history:[],tools:{definitions:[],sources:()=>[],recommendations:()=>[]}};
 return {runRoot,rows,get closed(){return closed;},execute:()=>withProviderMeter({...context(async row=>{await record(row);rows.push(row);}),funding:'credits',maxCostUsd:.12,feature:'conversation'},()=>generate(job))};
}
test('generator meters live notifications and dedupes returned event copies',async t=>{
 const f=await generatorFixture(t,async(options,budget)=>{
  await budget.dispatchRequest({kind:'main',inputBytes:10,maxTokens:10});
  const event={seq:3,type:'assistant/message',data:{usage:{inputTokens:4,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0}}};
  options.onNotification({method:'session.event',params:{sessionId:options.sessionId,event}});
  options.onNotification({method:'session.event',params:{sessionId:'foreign',event:{...event,seq:4}}});
  return {finalResponse:'Answer',events:[structuredClone(event),{type:'turn/end',data:{reason:{kind:'completed'}}}]};
 });
 assert.equal((await f.execute()).summary,'Answer');assert.equal(f.rows.length,2);assert.equal(f.rows[0].status,'unknown');assert.equal(f.rows[0].id,f.rows[1].id);assert.equal(f.rows[1].usage.inputTokens,4);assert.equal(f.closed,1);assert.deepEqual(await readdir(f.runRoot),[]);
});
test('generator finally records failed and missing attempts when SDK throws after dispatch',async t=>{
 const f=await generatorFixture(t,async(options,budget)=>{
  budget.reserveRequest({kind:'main',inputBytes:10,maxTokens:10});budget.reserveRequest({kind:'main',inputBytes:10,maxTokens:10});
  options.onNotification({method:'session.event',params:{sessionId:options.sessionId,event:{seq:3,type:'assistant/attempt',data:{stream:[]}}}});
  throw Error('PRIVATE SDK failure');
 });
 await assert.rejects(f.execute());assert.deepEqual(f.rows.map(r=>r.status),['failed','unknown']);assert.equal(new Set(f.rows.map(r=>r.id)).size,2);assert.deepEqual(await readdir(f.runRoot),[]);
});
test('generator cannot deliver model output when supplier receipt persistence fails',async t=>{
 const f=await generatorFixture(t,async()=>({finalResponse:'Answer',events:[{seq:1,type:'assistant/message',data:{}},{type:'turn/end',data:{reason:{kind:'completed'}}}]}),{record:()=>{throw Error('PRIVATE storage failure');}});
 await assert.rejects(f.execute(),error=>error.readerStage==='cleanup'&&error.cause.code==='provider_meter_unavailable');assert.deepEqual(await readdir(f.runRoot),[]);assert.equal(f.closed,1);
});
