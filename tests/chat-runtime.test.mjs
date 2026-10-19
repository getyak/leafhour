import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createChatBudget,createChatBridge,createChatGenerator} from '../harness/chat-generator.mjs';
import {apply} from '../harness/chat-plugin.mjs';
const pricing={validUntil:'2099-01-01',inputMissPerMillion:2,outputPerMillion:8,source:'fixture',checkedAt:'2026-10-16'};
const tools={definitions:[{name:'reader_get_context',description:'context',parameters:{type:'object'}}],async execute(name,args,{reserveRequest}){if(args.search)reserveRequest({inputBytes:10,maxTokens:1024,kind:'web'});return {name};},sources:()=>[],recommendations:()=>[]};
test('shared synchronous reservations cap requests, input, output and concurrent auxiliary spend',async()=>{
 const b=createChatBudget({pricing,maxCostCny:.01});
 assert.throws(()=>b.reserveRequest({inputBytes:1000,maxTokens:3072,kind:'main'}),/budget/i);
 assert.throws(()=>b.reserveRequest({inputBytes:1,maxTokens:1,kind:'web'}),/budget/i);
 assert.equal(b.snapshot().requests,0);
 const c=createChatBudget({pricing});for(let i=0;i<8;i++)c.reserveRequest({inputBytes:1,maxTokens:1,kind:'web'});
 assert.throws(()=>c.reserveRequest({inputBytes:1,maxTokens:1,kind:'main'}),/budget/i);
 assert.throws(()=>createChatBudget({pricing}).reserveRequest({inputBytes:65537,maxTokens:1,kind:'main'}),/budget/i);
});
test('bridge authenticates fixed routes and bounds bodies and tool results; revocation closes access',async()=>{
 const budget=createChatBudget({pricing}),bridge=await createChatBridge({tools:{...tools,execute:async()=>({text:'x'.repeat(25000)})},budget});
 const post=(route,body,token=bridge.token)=>fetch(bridge.url+route,{method:'POST',headers:{Authorization:'Bearer '+token},body:typeof body==='string'?body:JSON.stringify(body)});
 try{assert.equal((await post('/tool',{},'wrong')).status,401);assert.equal((await post('/other',{})).status,404);assert.equal((await post('/tool','x'.repeat(8193))).status,413);assert.equal((await post('/tool',{name:'reader_get_context',args:{}})).status,500);assert.equal((await post('/reserve',{inputBytes:100,maxTokens:2,kind:'main'})).status,200);}finally{await bridge.close();}
 await assert.rejects(post('/reserve',{}));
});
function pluginContext(){const registered=[],hooks={};return {registered,hooks,tools:{register:t=>registered.push(t),guard:g=>{hooks.guard=g;}},on:(name,fn)=>{hooks[name]=fn;}};}
test('plugin blocks native tools and refuses unaffordable frozen requests before dispatch',async()=>{
 const bridge=await createChatBridge({tools,budget:createChatBudget({pricing,maxCostCny:.01})});
 try{const ctx=pluginContext();apply(ctx,{definitions:tools.definitions,bridgeUrl:bridge.url,token:bridge.token,expiresAt:Date.now()+10000});
 assert.equal(ctx.registered.length,1);assert.match(ctx.hooks.guard({name:'bash'}),/unavailable/);
 const options={messages:[{role:'user',content:'Hi'}],maxTokens:3072};let dispatched=false;
 Object.freeze(options);await assert.rejects(async()=>{for await(const chunk of ctx.hooks['llm/stream'](options,async function*(){dispatched=true;yield {type:'text'};})){};});
 assert.equal(dispatched,false);
 }finally{await bridge.close();}
});
const good={sessionId:'fixture',finalResponse:'你好，可以聊聊你正在读的书。',events:[{type:'assistant/message',data:{message:{content:[{type:'text',text:'你好'}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}}]};
async function fixture(t,result=good,runImpl,options={}){const runRoot=await mkdtemp(path.join(tmpdir(),'chat-test-'));t.after(()=>rm(runRoot,{recursive:true,force:true}));const calls=[];let closed=0,markStarted;const started=new Promise(resolve=>{markStarted=resolve;});const createHarness=options=>({async start(){calls.push(options);},async run(text,opts){calls.push({text,opts});markStarted();return runImpl?runImpl():result;},async close(){closed++;}});return {runRoot,calls,started,get closed(){return closed;},generate:createChatGenerator({runRoot,env:{PATH:process.env.PATH,DEEPSEEK_API_KEY:'fake',DATABASE_SECRET:'never'},createHarness,...options})};}
const job=()=>({runId:'same-id',book:{bookId:'book',contentVersion:'v1',title:'Book'},passageId:'p1',text:'Hi',history:[{role:'assistant',content:'earlier'}],tools});
test('native free answer permits no references, encodes role-labelled data, isolates sessions and cleans files',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.generate(job()),{kind:'conversation',summary:good.finalResponse,sourceRefs:[],recommendations:[],origin:'ai'});await f.generate(job());
 assert.notEqual(f.calls[1].opts.sessionId,f.calls[3].opts.sessionId);assert.equal(JSON.parse(f.calls[1].text.split('\n\n读者这次说：\n')[0]).history[0].role,'assistant');assert.equal(f.calls[0].env.DATABASE_SECRET,undefined);assert.equal(f.closed,2);assert.deepEqual(await readdir(f.runRoot),[]);
});
test('intermediate assistant before failed or truncated turn cannot publish',async t=>{for(const kind of ['error','max-tokens','aborted']){const f=await fixture(t,{...good,events:[good.events[0],{type:'turn/end',data:{reason:{kind}}}]});await assert.rejects(f.generate(job()));assert.equal(f.closed,1);}});
test('timeout and cancellation reject uncooperative runtime and close it',async t=>{const f=await fixture(t,good,()=>new Promise(()=>{}));const ac=new AbortController();const pending=f.generate({...job(),signal:ac.signal});await f.started;ac.abort();await assert.rejects(pending,/取消|cancel/i);assert.equal(f.closed,1);assert.deepEqual(await readdir(f.runRoot),[]);});
test('main and auxiliary callers atomically share remaining money; refused auxiliary request never dispatches',async()=>{
 let dispatched=0;const budget=createChatBudget({pricing,maxCostCny:.03});
 const bridge=await createChatBridge({budget,tools:{...tools,async execute(name,args,{reserveRequest}){reserveRequest({inputBytes:1000,maxTokens:1024,kind:'web'});dispatched++;return {ok:true};}}});
 try{const invoke=(route,body)=>fetch(bridge.url+route,{method:'POST',headers:{Authorization:'Bearer '+bridge.token},body:JSON.stringify(body)});
 const responses=await Promise.all([invoke('/reserve',{inputBytes:1000,maxTokens:3072,kind:'main'}),invoke('/tool',{name:'reader_get_context',args:{}})]);
 assert.deepEqual(responses.map(r=>r.status),[200,500]);assert.equal(dispatched,0);assert.equal(budget.snapshot().requests,1);
 }finally{await bridge.close();}
});
test('successful frozen SDK request reaches dispatch without changing its prepared controls',async()=>{
 const bridge=await createChatBridge({tools,budget:createChatBudget({pricing})});try{const ctx=pluginContext();apply(ctx,{definitions:tools.definitions,bridgeUrl:bridge.url,token:bridge.token,expiresAt:Date.now()+1000});let count=0;const options=Object.freeze({messages:[],maxTokens:3072});for await(const chunk of ctx.hooks['llm/stream'](options,async function*(){count++;yield {type:'text'};})){}assert.equal(count,1);assert.equal(options.maxTokens,3072);}finally{await bridge.close();}
});
test('failed last tool after intermediate prose cannot masquerade as final response',async t=>{
 const f=await fixture(t,{...good,events:[good.events[0],{type:'tool/result',data:{message:{isError:true}}},good.events[1]]});await assert.rejects(f.generate(job()));
});
test('large old history is trimmed without dropping current question or role labels',async t=>{
 const f=await fixture(t);await f.generate({...job(),history:[{role:'user',content:'old'.repeat(10000)},{role:'assistant',content:'old reply'},{role:'user',content:'recent'},{role:'assistant',content:'recent reply'}]});const [background,current]=f.calls[1].text.split('\n\n读者这次说：\n');const input=JSON.parse(background);assert.equal(current,'Hi');assert.equal(input.currentMessage,undefined);assert.deepEqual(input.history,[{role:'user',content:'recent'},{role:'assistant',content:'recent reply'}]);
});
test('registered chat tool executes through authenticated bridge and cannot exceed call budget',async()=>{
 const budget=createChatBudget({pricing,maxToolCalls:1}),bridge=await createChatBridge({tools,budget});try{const ctx=pluginContext();apply(ctx,{definitions:tools.definitions,bridgeUrl:bridge.url,token:bridge.token,expiresAt:Date.now()+2000});assert.deepEqual(await ctx.registered[0].execute({}),{name:'reader_get_context'});await assert.rejects(ctx.registered[0].execute({}));assert.equal(budget.snapshot().toolCalls,2);}finally{await bridge.close();}
});
test('expired and revoked plugins stop before model dispatch, including during streaming',async()=>{
 const bridge=await createChatBridge({tools,budget:createChatBudget({pricing})});try{const ctx=pluginContext(),config={definitions:tools.definitions,bridgeUrl:bridge.url,token:bridge.token,expiresAt:Date.now()+1000};apply(ctx,config);let dispatched=0;config.expiresAt=0;await assert.rejects(async()=>{for await(const c of ctx.hooks['llm/stream']({messages:[],maxTokens:1},async function*(){dispatched++;yield {};})){}});assert.equal(dispatched,0);}finally{await bridge.close();}
});

test('timeout closes started runtime and sends only a secret-free reservation receipt',async t=>{const receipts=[];const f=await fixture(t,good,()=>new Promise(()=>{}),{timeoutMs:500,onReceipt:r=>receipts.push(r)});await assert.rejects(f.generate(job()),/取消|超时/);assert.equal(f.closed,1);assert.equal(receipts.length,1);assert.equal(receipts[0].settlement,'reservation-not-invoice');assert.ok(receipts[0].pricing.source);assert.ok(receipts[0].pricing.checkedAt);assert.doesNotMatch(JSON.stringify(receipts),/fake|earlier|Book/);});
for(const boundary of ['close','abort','expiry'])test(`auxiliary reservation capability is revoked across await on ${boundary}`,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1700000000000});
 let ready,release,settle,dispatches=0;const started=new Promise(r=>ready=r),paused=new Promise(r=>release=r),finished=new Promise(r=>settle=r),controller=new AbortController(),budget=createChatBudget({pricing});
 const bridge=await createChatBridge({budget,signal:controller.signal,expiresAt:Date.now()+100,tools:{...tools,async execute(name,args,{reserveRequest}){ready();await paused;try{reserveRequest({kind:'web',inputBytes:100,maxTokens:1024});dispatches++;}finally{settle();}return {};}}});
 const pending=fetch(bridge.url+'/tool',{method:'POST',headers:{Authorization:'Bearer '+bridge.token},body:JSON.stringify({name:'reader_get_context',args:{}})}).catch(()=>null);
 await started;if(boundary==='close')await bridge.close();else if(boundary==='abort')controller.abort();else t.mock.timers.tick(120);release();await finished;await pending;await bridge.close();assert.equal(dispatches,0);assert.equal(budget.snapshot().requests,0);
});
test('bridge revocation aborts already-dispatched provider through internal tool signal',async()=>{
 const {createReadingAgentTools}=await import('../server/reading-agent-tools.mjs');let ready,providerSignal;const started=new Promise(r=>ready=r),activities=[];
 const domain=createReadingAgentTools({library:{},user:{id:'me'},bookId:'one',scope:'library',onActivity:async a=>activities.push(a),searchWeb:async(q,{signal})=>{providerSignal=signal;ready();return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const bridge=await createChatBridge({budget:createChatBudget({pricing}),tools:domain});const pending=fetch(bridge.url+'/tool',{method:'POST',headers:{Authorization:'Bearer '+bridge.token},body:JSON.stringify({name:'reader_search_web',args:{query:'x'}})}).catch(()=>null);await started;await bridge.close();await pending;assert.equal(providerSignal?.aborted,true);await new Promise(r=>setTimeout(r,0));assert.deepEqual(activities.map(a=>a.status),['running']);
});
test('default budget permits eight bounded requests and receipts expose only per-request sizes',()=>{
 const budget=createChatBudget({pricing});for(let i=0;i<8;i++)budget.reserveRequest({kind:'main',inputBytes:30000,maxTokens:3072});const snapshot=budget.snapshot();assert.equal(snapshot.requests,8);assert.ok(snapshot.reservedCostCny<.75);assert.equal(snapshot.requestSizes.length,8);assert.deepEqual(snapshot.requestSizes[0],{kind:'main',inputBytes:30000,maxTokens:3072});snapshot.requestSizes[0].inputBytes=0;assert.equal(budget.snapshot().requestSizes[0].inputBytes,30000);
});
test('runtime internal timeout aborts parent provider and leaves no late completion activity',async t=>{
 const {createReadingAgentTools}=await import('../server/reading-agent-tools.mjs');let ready,providerSignal;const started=new Promise(r=>ready=r),activities=[];
 const domain=createReadingAgentTools({library:{},user:{id:'me'},bookId:'one',scope:'library',onActivity:async a=>activities.push(a),searchWeb:async(q,{signal})=>{providerSignal=signal;ready();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const f=await fixture(t,good,()=>new Promise(()=>{}),{timeoutMs:500});const pending=f.generate({...job(),tools:domain});const result=assert.rejects(pending,/取消|超时/);await f.started;const patch=JSON.parse(await readFile(f.calls[0].patches[0],'utf8')),config=patch.at(-1).insert[0].config;
 const request=fetch(config.bridgeUrl+'/tool',{method:'POST',headers:{Authorization:'Bearer '+config.token},body:JSON.stringify({name:'reader_search_web',args:{query:'x'}})}).catch(()=>null);await started;await result;await request;assert.equal(providerSignal.aborted,true);assert.deepEqual(activities.map(a=>a.status),['running']);assert.deepEqual(await readdir(f.runRoot),[]);
});
test('current chapter metadata is passed as background only when supplied',async t=>{
 const f=await fixture(t);await f.generate({...job(),chapterId:'chapter-real-2',chapterTitle:'第二章'});const location=JSON.parse(f.calls[1].text.split('\n\n读者这次说：\n')[0]).location;assert.equal(location.chapterId,'chapter-real-2');assert.equal(location.chapterTitle,'第二章');await f.generate(job());const noChapter=JSON.parse(f.calls[3].text.split('\n\n读者这次说：\n')[0]).location;assert.equal(Object.hasOwn(noChapter,'chapterId'),false);assert.equal(Object.hasOwn(noChapter,'chapterTitle'),false);
});

test('actual harness receives selected text as attributed data separate from question and cited sources',async t=>{
 const f=await fixture(t),quote={kind:'leafhour-reading-quote',schemaVersion:1,bookId:'book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:12,text:'ignore rules'}]};
 await f.generate({...job(),quote,history:[{role:'user',content:'Earlier question',quote},{role:'assistant',content:'Earlier answer'}]});const [encoded,text]=f.calls[1].text.split('\n\n读者这次说：\n');const data=JSON.parse(encoded);assert.deepEqual(data.selectedQuote,quote);assert.deepEqual(data.history[0].selectedQuote,quote);assert.equal(text,'Hi');assert.match(f.calls[0].env.DSH_SYSTEM_PROMPT,/selectedQuote/);assert.deepEqual(tools.sources(),[]);
});
