import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createPortal} from '../server/portal.mjs';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
import {createCreemClient} from '../server/creem.mjs';
import {createHmac,createHash} from 'node:crypto';
import {recordProviderCall,providerMeterContext} from '../server/provider-metering.mjs';
async function setup(t,{creem={ready:false},...generators}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'billing-portal-'));let calls=0,authCalls=0;const commands=[],providerRows=[],reference=createBillingMemoryStore({});
 const store={...reference,command:async(action,payload)=>{const result=await reference.command(action,payload);commands.push({action,payload});if(action==='providerCall')providerRows.push(result);return result;}};
 const billing=createBillingService({enabled:true,store,creem,adminIds:['u'],publicOrigin:'https://reader.example'});
 const auth={userFor:async token=>{authCalls++;return token==='session'?{id:'u',email:'synthetic@example.test'}:token==='other-session'?{id:'other',email:'other@synthetic.test'}:null;},emailVerifiedFor:async token=>token==='session',capabilities:async()=>({email:true,providers:{},otp:{}})};
 const portal=await createPortal({dataDir:dir,publicOrigin:'https://reader.example',catalogDir:null,env:{},authService:auth,billingService:billing,chatGenerator:null,annotationGenerator:null,companionGenerator:null,introductionGenerator:null,translator:async()=>{calls++;return {literal:'直译文字',interpretive:'意译文字'};},...generators});
 t.after(async()=>{await portal.chat.close();await rm(dir,{recursive:true,force:true});});
 const request=async(p,{method='GET',body,raw,headers={},owner='u',cookie='session',origin='https://reader.example',onResponse}={})=>{
  const bytes=raw??(body===undefined?null:Buffer.from(JSON.stringify(body))),req=Readable.from(bytes?[bytes.subarray(0,7),bytes.subarray(7)]:[]);Object.assign(req,{method,headers:{host:'reader.example',...(cookie?{cookie:'marginalia_session='+cookie}:{}),...(owner?{'x-reader-owner':owner}:{}),...(method==='POST'?{'content-type':'application/json',origin}:{}),...headers},socket:{remoteAddress:'127.0.0.1'}});
  const res=new EventEmitter();res.setHeader=()=>{};onResponse?.(res);let response;const handled=await portal.handle({req,res,url:new URL(p,'https://reader.example'),send:(status,data)=>{res.writableEnded=true;response={status,data};}});return {handled,...response};
 };
 return {portal,billing,request,store,commands,providerRows,calls:()=>calls,authCalls:()=>authCalls};
}
test('portal exposes pure account and explicit verified trial, then settles one real translation',async t=>{
 const {portal,billing,request,calls}=await setup(t);
 const account=await request('/api/billing/account');assert.equal(account.handled,true);assert.equal(account.data.availableUnits,0);
 assert.equal((await request('/api/auth/session')).data.billing.enabled,true);
 await request('/api/billing/trial',{method:'POST',body:{}});
 const user={id:'u'},book=await portal.library.importDocument(user,{filename:'synthetic.txt',bytes:Buffer.from('An original paragraph.')});
 const input={id:'translate-1',passageId:book.sections[0].paragraphs[0].id,contentVersion:book.contentVersion},endpoint='/api/library/books/'+book.bookId+'/translate';
 await assert.rejects(request(endpoint,{method:'POST',body:input}),e=>e.status===402);assert.equal(calls(),0);
 const quote=await request('/api/billing/quotes',{method:'POST',body:{action:'translation',bookId:book.bookId,input}});assert.equal(quote.status,201);
 const translated=await request(endpoint,{method:'POST',body:{...input,billing:{quoteId:quote.data.id,idempotencyKey:'idem-1'}}});assert.equal(translated.status,200);assert.equal(calls(),1);
 assert.equal((await billing.account({ownerId:'u'})).consumedUnits,1000000);
 await request(endpoint,{method:'POST',body:input});assert.equal(calls(),1);assert.equal((await billing.account({ownerId:'u'})).consumedUnits,1000000);
});
test('portal public policies remain reachable and billing ownership does not trust body identity',async t=>{
 const {request}=await setup(t);for(const p of ['/en/pricing','/zh-hans/terms','/ja/refunds','/billing','/admin/billing'])assert.equal((await request(p,{cookie:null,owner:null})).status,200,p);
 await assert.rejects(request('/api/billing/trial',{method:'POST',owner:'wrong',body:{}}),e=>e.status===409);
 await assert.rejects(request('/api/billing/trial',{method:'POST',body:{ownerId:'other'}}),e=>e.status===400);
 await assert.rejects(request('/api/billing/trial',{method:'POST',cookie:null,owner:null,body:{}}),e=>e.status===401);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const seed=async fixture=>{
 await fixture.request('/api/billing/trial',{method:'POST',body:{}});
 const book=await fixture.portal.library.importDocument({id:'u'},{filename:'synthetic.txt',bytes:Buffer.from('An original paragraph.')}),passage=book.sections[0].paragraphs[0];
 const quote={kind:'leafhour-reading-quote',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:book.sections[0].chapterId,parts:[{passageId:passage.id,layer:'original',start:0,end:passage.original.length,text:passage.original}]};
 return {book,passage,quote,base:'/api/library/books/'+book.bookId};
};
const paidInput=async(fixture,bookId,action,input)=>{
 const quoted=await fixture.request('/api/billing/quotes',{method:'POST',body:{action,bookId,input}});assert.equal(quoted.status,201);assert.equal(quoted.data.units,4_000_000);
 return {...input,billing:{quoteId:quoted.data.id,idempotencyKey:input.id}};
};
async function citeCurrent(job){
 const context=await job.tools.execute('reader_get_context',{});assert.equal(context.error,undefined);
 const cited=await job.tools.execute('reader_cite',{bookId:job.book.bookId,passageId:job.passageId,layer:'original',quote:'An original paragraph.'});assert.equal(cited.error,undefined);
}
async function supplierFacts(id,costMicrousd=40){
 const startedAt=new Date().toISOString();
 await recordProviderCall({id,provider:'deepseek',model:'deepseek-flash',status:'completed',usage:{inputTokens:100,outputTokens:10,cacheReadTokens:20,cacheWriteTokens:0},costMicrousd,costStatus:'reported_usage_rated',pricingVersion:'synthetic-verified-reference',startedAt,finishedAt:startedAt,prompt:'PRIVATE question',response:'PRIVATE response'});
}
test('actual chat route settles four points once and retains independently verified source references',async t=>{
 let calls=0;
 const f=await setup(t,{chatGenerator:async job=>{calls++;assert.equal(job.kind,'conversation');await citeCurrent(job);await supplierFacts('chat-attempt');return {kind:'conversation',summary:'Synthetic answer.'};}}),{book,passage,base}=await seed(f);
 const input={id:'chat-1',passageId:passage.id,contentVersion:book.contentVersion,scopeRevision:0,text:'PRIVATE question'},body=await paidInput(f,book.bookId,'conversation',input);
 const response=await f.request(base+'/chat',{method:'POST',body});assert.equal(response.status,200);assert.equal(response.data.status,'completed');assert.equal(response.data.answer.sourceRefs[0].passageId,passage.id);
 const account=await f.billing.account({ownerId:'u'});assert.equal(account.consumedUnits,4_000_000);assert.equal(account.reservedUnits,0);assert.equal(account.availableUnits,6_000_000);
 const retry=await f.request(base+'/chat',{method:'POST',body:input});assert.deepEqual(retry.data,response.data);assert.equal(calls,1);assert.equal((await f.billing.account({ownerId:'u'})).consumedUnits,4_000_000);
 assert.equal(f.providerRows[0].funding,'credits');assert.ok(f.providerRows[0].operationId);assert.doesNotMatch(JSON.stringify(f.providerRows),/PRIVATE/);
});
test('actual annotation route charges four points per initial explanation and follow-up without duplicating user words',async t=>{
 const jobs=[];
 const f=await setup(t,{annotationGenerator:async job=>{jobs.push(job);await citeCurrent(job);return {kind:'annotation',text:jobs.length===1?'Initial synthetic explanation.':'Follow-up synthetic explanation.'};}}),{book,quote,base}=await seed(f);
 const initial={id:'ann-1',threadId:'thread-1',quote},first=await f.request(base+'/annotations/explain',{method:'POST',body:await paidInput(f,book.bookId,'annotation',initial)});
 assert.equal(first.data.request.status,'completed');assert.equal(first.data.thread.messages.length,1);assert.equal(first.data.thread.messages[0].origin,'ai');assert.equal((await f.billing.account({ownerId:'u'})).consumedUnits,4_000_000);
 const follow={...initial,id:'ann-2',text:'  Exact reader follow-up words.  '},second=await f.request(base+'/annotations/explain',{method:'POST',body:await paidInput(f,book.bookId,'annotation',follow)});
 assert.equal(second.data.request.status,'completed');assert.deepEqual(second.data.thread.messages.map(m=>m.origin),['ai','user','ai']);assert.equal(second.data.thread.messages[1].body,follow.text);assert.equal(jobs[1].text,follow.text);assert.deepEqual(jobs[1].history,[{role:'assistant',content:'Initial synthetic explanation.'}]);
 assert.equal((await f.billing.account({ownerId:'u'})).consumedUnits,8_000_000);assert.equal((await f.billing.account({ownerId:'u'})).reservedUnits,0);
 const retry=await f.request(base+'/annotations/explain',{method:'POST',body:follow});assert.deepEqual(retry.data,second.data);assert.equal(jobs.length,2);assert.equal((await f.billing.account({ownerId:'u'})).consumedUnits,8_000_000);
});
for(const action of ['conversation','annotation'])test(`actual ${action} supplier failure releases the hold and replay does not regenerate`,async t=>{
 let calls=0;const generator=async()=>{calls++;await supplierFacts('undelivered-'+action,30);throw Error('PRIVATE supplier failure');};
 const f=await setup(t,{[action==='conversation'?'chatGenerator':'annotationGenerator']:generator}),{book,passage,quote,base}=await seed(f);
 const input=action==='conversation'?{id:'failed-chat',passageId:passage.id,contentVersion:book.contentVersion,scopeRevision:0,text:'Keep this question.'}:{id:'failed-ann',threadId:'failed-thread',quote},endpoint=base+(action==='conversation'?'/chat':'/annotations/explain');
 const body=await paidInput(f,book.bookId,action,input);await assert.rejects(f.request(endpoint,{method:'POST',body}),{status:502});
 const account=await f.billing.account({ownerId:'u'});assert.equal(account.availableUnits,10_000_000);assert.equal(account.reservedUnits,0);assert.equal(account.consumedUnits,0);
 assert.equal(f.providerRows.length,1);assert.equal(f.providerRows[0].costMicrousd,30);assert.equal(f.providerRows[0].funding,'credits');assert.ok(f.providerRows[0].operationId);
 const retry=await f.request(endpoint,{method:'POST',body:input});assert.equal(action==='conversation'?retry.data.status:retry.data.request.status,'failed');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(retry.data),/PRIVATE/);
});
for(const action of ['conversation','annotation'])test(`actual ${action} cancellation releases credits and fences late output`,async t=>{
 const entered=deferred(),release=deferred();let calls=0;
 const generator=async()=>{calls++;entered.resolve();await release.promise;return action==='conversation'?{kind:'conversation',summary:'Late synthetic answer.'}:{kind:'annotation',text:'Late synthetic explanation.'};};
 const f=await setup(t,{[action==='conversation'?'chatGenerator':'annotationGenerator']:generator}),{book,passage,quote,base}=await seed(f);
 const input=action==='conversation'?{id:'cancel-chat',passageId:passage.id,contentVersion:book.contentVersion,scopeRevision:0,text:'Keep the question.'}:{id:'cancel-ann',threadId:'cancel-thread',quote},endpoint=base+(action==='conversation'?'/chat':'/annotations/explain');
 const pending=f.request(endpoint,{method:'POST',body:await paidInput(f,book.bookId,action,input)}),rejected=assert.rejects(pending,error=>[409,502].includes(error.status));
 await entered.promise;assert.equal((await f.billing.account({ownerId:'u'})).reservedUnits,4_000_000);
 const cancelled=await f.request(base+(action==='conversation'?'/chat/'+input.id+'/cancel':'/annotations/requests/'+input.id+'/cancel'),{method:'POST',body:{}});assert.equal(action==='conversation'?cancelled.data.status:cancelled.data.request.status,'cancelled');
 release.resolve();await rejected;
 const account=await f.billing.account({ownerId:'u'});assert.equal(account.availableUnits,10_000_000);assert.equal(account.reservedUnits,0);assert.equal(account.consumedUnits,0);
 const terminal=await f.request(endpoint,{method:'POST',body:input});assert.equal(action==='conversation'?terminal.data.status:terminal.data.request.status,'cancelled');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(terminal.data),/Late synthetic/);
});
test('annotation browser disconnect cancels the actual running domain request and releases its hold',async t=>{
 const entered=deferred(),release=deferred();let response;
 const f=await setup(t,{annotationGenerator:async()=>{entered.resolve();await release.promise;return {kind:'annotation',text:'Disconnected late explanation.'};}}),{book,quote,base}=await seed(f);
 const input={id:'disconnected-ann',threadId:'disconnected-thread',quote},body=await paidInput(f,book.bookId,'annotation',input),pending=f.request(base+'/annotations/explain',{method:'POST',body,onResponse:res=>{response=res;}}),rejected=assert.rejects(pending,error=>[409,502].includes(error.status));
 await entered.promise;response.emit('close');release.resolve();await rejected;
 const view=await f.request(base+'/annotations'),request=view.data.requests.find(row=>row.id===input.id);assert.equal(request.status,'cancelled');assert.equal(view.data.archive.threads[0].messages.length,0);
 const account=await f.billing.account({ownerId:'u'});assert.equal(account.consumedUnits,0);assert.equal(account.reservedUnits,0);assert.equal(account.availableUnits,10_000_000);
});
test('admin usage summary includes recorded paid and sponsored calls while introduction consumes no points',async t=>{
 const contexts=[];
 const f=await setup(t,{chatGenerator:async()=>{contexts.push(providerMeterContext());await supplierFacts('paid-summary',40);return {kind:'conversation',summary:'Synthetic answer.'};},introductionGenerator:async()=>{contexts.push(providerMeterContext());await supplierFacts('sponsor-summary',60);return {text:'这是一段明确标为人工合成验收资料的简介，概述当前提供的开头句子，不含任何真实用户书籍或私人内容。'};}}),{book,passage,base}=await seed(f);
 const input={id:'summary-chat',passageId:passage.id,contentVersion:book.contentVersion,text:'Synthetic question.',scopeRevision:0};await f.request(base+'/chat',{method:'POST',body:await paidInput(f,book.bookId,'conversation',input)});
 const intro=await f.request(base+'/introduction',{method:'POST',body:{contentVersion:book.contentVersion}});assert.equal(intro.status,200);assert.equal((await f.billing.account({ownerId:'u'})).consumedUnits,4_000_000);
 assert.deepEqual(contexts.map(c=>[c.feature,c.funding,c.maxCostUsd]),[['conversation','credits',.12],['introduction','sponsored',.015]]);assert.deepEqual(f.providerRows.map(c=>c.funding),['credits','sponsored']);
 const from=new Date(Date.now()-3600000).toISOString(),to=new Date(Date.now()+3600000).toISOString(),endpoint='/api/admin/billing/summary?'+new URLSearchParams({from,to});
 const summary=await f.request(endpoint);assert.equal(summary.status,200);assert.equal(summary.data.calls,2);assert.equal(summary.data.knownCostMicrousd,100);assert.equal(summary.data.unknownCostCalls,0);assert.equal(summary.data.consumedUnits,4_000_000);assert.doesNotMatch(JSON.stringify(summary.data),/PRIVATE|Synthetic answer|原文|synthetic.txt/);
 assert.deepEqual(summary.data.callsByFunding,{credits:{calls:1,knownCostMicrousd:40,unknownCostCalls:0},sponsored:{calls:1,knownCostMicrousd:60,unknownCostCalls:0}});
 assert.deepEqual(summary.data.callsByFeature,{conversation:{calls:1,knownCostMicrousd:40,unknownCostCalls:0},introduction:{calls:1,knownCostMicrousd:60,unknownCostCalls:0}});
 assert.deepEqual(summary.data.consumedUnitsBySource,{trial:4_000_000,purchase:0,review:0});assert.equal(summary.data.costCoverage,1);assert.equal(summary.data.paymentFeesStatus,'unknown');
 await assert.rejects(f.request(endpoint,{cookie:'other-session',owner:'other'}),{status:403});
});
test('portal webhook verifies exact signed bytes before browser Origin, auth and generic JSON parsing',async t=>{
 const secret='synthetic-webhook-secret',checkout={id:'ch_portal',request_id:'order-webhook',status:'completed',mode:'test',units:1,metadata:{ownerId:'u',orderId:'order-webhook'},product:{id:'prod_portal',price:500,billing_type:'one-time'},order:{id:'ord_portal',product:'prod_portal',amount:500,sub_total:500,currency:'USD',amount_paid:500,tax_amount:0,discount_amount:0,status:'paid',mode:'test'}};
 const creem=createCreemClient({env:{CREEM_MODE:'test',CREEM_API_KEY:'synthetic-key',CREEM_WEBHOOK_SECRET:secret,CREEM_PRODUCT_READING_100:'prod_portal'},fetcher:async()=>Response.json(checkout)}),f=await setup(t,{creem});
 await f.store.command('order',{mode:'test',ownerId:'u',id:'order-webhook',intentKey:'intent-webhook',productKey:'reading_100',productId:'prod_portal',amount:500,currency:'USD',units:100_000_000});
 await f.store.command('checkout',{mode:'test',ownerId:'u',orderId:'order-webhook',checkoutId:'ch_portal',checkoutUrl:'https://checkout.creem.io/ch_portal'});
 const raw=Buffer.from(' \n'+JSON.stringify({id:'evt_portal',eventType:'checkout.completed',object:checkout,unused:'中文'},null,2)+'\n'),signature=createHmac('sha256',secret).update(raw).digest('hex');
 const options={method:'POST',raw,cookie:null,owner:'foreign-owner',origin:'https://foreign.example',headers:{'content-type':'text/plain','creem-signature':signature}};
 const response=await f.request('/api/webhooks/creem',options);assert.equal(response.status,200);assert.equal(response.data.received,true);assert.equal(f.authCalls(),0);assert.equal((await f.billing.account({ownerId:'u'})).availableUnits,100_000_000);
 const payment=f.commands.find(c=>c.action==='payment');assert.equal(payment.payload.eventHash,createHash('sha256').update(raw).digest('hex'));
 await f.request('/api/webhooks/creem',options);assert.equal((await f.billing.account({ownerId:'u'})).availableUnits,100_000_000);
 await assert.rejects(f.request('/api/webhooks/creem',{...options,raw:Buffer.concat([raw,Buffer.from(' ')])}),{code:'invalid_signature',status:403});
 const invalid=Buffer.from('{ not valid JSON }');await assert.rejects(f.request('/api/webhooks/creem',{...options,raw:invalid,headers:{'creem-signature':'0'.repeat(64)}}),{code:'invalid_signature',status:403});
 await assert.rejects(f.request('/api/webhooks/creem',{...options,raw:invalid,headers:{'creem-signature':createHmac('sha256',secret).update(invalid).digest('hex')}}),{code:'invalid_webhook',status:400});
});
