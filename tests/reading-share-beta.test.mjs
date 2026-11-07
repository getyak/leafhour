import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShareModel} from '../app/share-model.mjs';
import {createCreditGate} from '../server/credit-gate.mjs';
import {recordProviderCall} from '../server/provider-metering.mjs';
const book={bookId:'private',contentVersion:'v',title:{en:'PRIVATE FILE'},author:'PRIVATE AUTHOR',chapters:[{id:'c',number:1}],sections:[{chapterId:'c',number:1,paragraphs:[{id:'p',original:'before SELECTED after',translations:{literal:{text:'SECRET TRANSLATION'}}}]}],notes:['SECRET NOTE']};
const selected={bookId:'private',contentVersion:'v',chapterId:'c',parts:[{passageId:'p',language:'en',start:7,end:15,text:'SELECTED'}]};
test('card defaults never expand the explicit selection or private metadata',()=>{
 for(const options of [{},{language:'bilingual',above:'keep',below:'keep'},{language:'zh',variant:'literal'}]){
  const card=buildShareModel(book,selected,options);
  assert.equal(card.blocks[0].primary.text,'SELECTED');assert.equal(card.blocks[0].secondary,null);
  assert.equal(card.before,'');assert.equal(card.after,'');
  assert.doesNotMatch(JSON.stringify(card),/SECRET|PRIVATE FILE|PRIVATE AUTHOR/);
 }
});
test('beta zero-balance generation records usage without a quote, reservation or debit',async()=>{
 const calls=[];let executed=0;
 const gate=createCreditGate({billing:{enabled:true,usagePolicy:'beta',quote(){throw Error('no quote');},run(){throw Error('no debit');}},record:row=>calls.push(row)});
 const result=await gate.run({user:{id:'owner'},action:'conversation',bookId:'private',input:{id:'request',text:'question'},execute:async input=>{
  executed++;assert.equal(input.text,'question');await recordProviderCall({id:'provider-1',model:'deepseek-flash',provider:'deepseek',startedAt:'2026-11-07T00:00:00Z',status:'completed',usage:{inputTokens:12,outputTokens:4}});return {answer:'ok'};
 }});
 assert.equal(result.answer,'ok');assert.equal(executed,1);assert.equal(calls.length,1);assert.equal(calls[0].funding,'beta');assert.equal(calls[0].operationId,undefined);assert.equal(calls[0].usage.inputTokens,12);assert.equal(calls[0].costMicrousd,null);
 assert.doesNotMatch(JSON.stringify(calls),/question|private|SELECTED/);
});
test('public trial resolver uses only canonical catalogue, exact version and actual original paragraph',async()=>{
 const {publicExcerpt}=await import('../server/public-excerpt.mjs');
 const canonical={...book,bookId:'public',visibility:'public'},catalog=new Map([['public',canonical],['private',book]]);
 assert.throws(()=>publicExcerpt(catalog,{bookId:'private',passageId:'p',contentVersion:'v'}),e=>e.status===404);
 assert.throws(()=>publicExcerpt(catalog,{bookId:'public',passageId:'fake',contentVersion:'v'}),e=>e.status===404);
 assert.throws(()=>publicExcerpt(catalog,{bookId:'public',passageId:'p',contentVersion:'old'}),e=>e.status===409);
 const receipt=publicExcerpt(catalog,{bookId:'public',passageId:'p',contentVersion:'v',note:'SECRET',text:'PRIVATE'});
 const url=new URL(receipt.readUrl,'https://leafhour.com');
 assert.deepEqual([...url.searchParams.keys()],['book','passage','contentVersion','layer']);assert.equal(url.searchParams.get('layer'),'original');
 assert.doesNotMatch(JSON.stringify(receipt),/SECRET|PRIVATE|SELECTED/);
});
test('anonymous HTTP trial resolves the exact public original and cannot inspect a private upload',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {createReaderServer}=await import('../server/server.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-share-http-'));let generated=0;
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},sendCode:null,translator:null,readingGuideGenerator:async()=>{generated++;throw Error('must not generate');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const root='http://127.0.0.1:'+server.address().port;
 const canonical=await server.portal.library.getBook(null,'gutenberg-alice'),passageId=canonical.readingStart.passageId;
 const response=await fetch(root+'/api/public-excerpts/'+canonical.bookId+'/'+passageId+'?'+new URLSearchParams({contentVersion:canonical.contentVersion}));
 assert.equal(response.status,200);const receipt=await response.json();
 const {verifiedExcerptUrl}=await import('../app/share-link.mjs');
 assert.ok(verifiedExcerptUrl(receipt,{bookId:canonical.bookId,contentVersion:canonical.contentVersion,chapterId:canonical.readingStart.chapterId,parts:[{passageId}]}));
 const reader=await fetch(root+receipt.readUrl);assert.equal(reader.status,200);assert.doesNotMatch(await reader.text(),/id="auth-dialog"[^>]*open/);
 const source=await fetch(root+'/api/library/books/'+canonical.bookId+'/reading?'+new URLSearchParams({passageId}));assert.equal(source.status,200);assert.ok((await source.json()).sections.some(s=>s.paragraphs.some(p=>p.id===passageId&&p.original)));
 assert.equal((await fetch(root+'/api/public-excerpts/private/p?contentVersion=v')).status,404);
 assert.equal((await fetch(root+'/api/public-excerpts/'+canonical.bookId+'/'+passageId+'?contentVersion=stale')).status,409);
 const session=await (await fetch(root+'/api/auth/session')).json();assert.equal(session.billing.enabled,false);assert.equal(session.billing.usagePolicy,'beta');assert.equal(generated,0);
});
test('beta metering survives in the usage store while the financial ledger stays unchanged',async()=>{
 const {createBillingRuntime}=await import('../server/billing-runtime.mjs'),{createBillingMemoryStore}=await import('../server/billing-memory-store.mjs');
 const store=await createBillingMemoryStore(),ownerId='11111111-1111-4111-8111-111111111111';
 const billing=await createBillingRuntime({store,env:{READER_BILLING_ENABLED:'true',CREEM_MODE:'test',READER_BILLING_ADMIN_USER_IDS:ownerId}});
 const before=await billing.account({ownerId}),entries=await billing.entries({ownerId});
 const gate=createCreditGate({billing,record:facts=>billing.recordProviderCall(facts)});
 await gate.run({user:{id:ownerId},action:'translation',bookId:'private',input:{id:'r',passageId:'p'},execute:async()=>{
  await recordProviderCall({id:'beta-fixture',provider:'deepseek',model:'deepseek-flash',status:'completed',startedAt:'2026-11-07T01:00:00Z',finishedAt:'2026-11-07T01:00:01Z',usage:{inputTokens:90,outputTokens:10},costStatus:'reported_usage_rated',costMicrousd:7});return {ok:true};
 }});
 assert.deepEqual(await billing.account({ownerId}),before);assert.deepEqual(await billing.entries({ownerId}),entries);
 const summary=await billing.summary({ownerId,from:'2026-11-07T00:00:00Z',to:'2026-11-08T00:00:00Z'});
 assert.equal(summary.callsByFunding.beta.calls,1);assert.equal(summary.callsByFunding.beta.knownCostMicrousd,7);
 assert.equal((await billing.catalog()).available,false);
});
test('beta model accounting does not impose financial, turn or tool-call quotas',async()=>{
 const {withProviderMeter}=await import('../server/provider-metering.mjs'),{createChatBudget}=await import('../harness/chat-generator.mjs');
 await withProviderMeter({ownerId:'fixture-owner',feature:'reading-guide',funding:'beta',record:()=>{}},async()=>{
  const meter=createChatBudget({maxCostCny:.000001,maxRequests:1,maxToolCalls:0});
  for(let i=0;i<40;i++){meter.reserveRequest({kind:'main',inputBytes:500,maxTokens:2048});meter.tool();}
  assert.equal(meter.snapshot().requests,40);
 });
});
