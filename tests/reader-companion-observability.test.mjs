import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderCompanionService} from '../server/reader-companion.mjs';
import {createReaderServer} from '../server/server.mjs';
import {createObservability} from '../server/observability.mjs';
import {validateObservabilityEvent} from '../app/observability-contract.mjs';
import {observabilityDashboards} from '../tools/configure-observability.mjs';

const owner={id:'isolated-companion-owner'};
const book={bookId:'PRIVATE_BOOK',contentVersion:'v1',title:{en:'PRIVATE_TITLE'},chapters:[{id:'c1',kind:'body'}],sections:[{chapterId:'c1',paragraphs:[{id:'p1',original:'PRIVATE_SOURCE_ONE',translations:{}},{id:'p2',original:'PRIVATE_SOURCE_TWO',translations:{}}]}],glossary:[],annotations:[]};
async function fixture({generator=async()=>{throw Error('PRIVATE_PROVIDER https://PRIVATE_URL');},observer,quota=async()=>{}}={}){
 let now=1800000000000,version='v1',data={turns:[]},calls=0;const outcomes=[];
 const service=createReaderCompanionService({bookFor:async()=>({...structuredClone(book),contentVersion:version}),mutateBook:async(_u,_b,fn)=>{const next=structuredClone(data),result=await fn(next);data=next;return structuredClone(result);},clock:()=>now,generator:async job=>{calls++;return generator(job);},quota,reserveGlobal:async()=>({}),releaseGlobal:async()=>{},watchRun:()=>()=>{},active:new Map(),publicTurn:t=>structuredClone(t),conversationHistory:()=>[],cancel:async()=>{},getClosed:()=>false,onOutcome:observer||((user,event,context)=>outcomes.push({user,event,context}))});
 let meta=await service.view(owner,book.bookId);
 for(const passageId of ['p1','p2'])for(let n=0;n<7;n++){now+=8000;meta=await service.observe(owner,book.bookId,{...meta,passageId,active:true});}
 const operationId=randomUUID(),input={id:'PRIVATE_RECEIPT',revision:meta.revision,contentVersion:'v1',sessionId:meta.sessionId,passageId:'p2'};
 return {service,outcomes,operationId,send:opts=>service.generate(owner,book.bookId,input,{operationId,...opts}),calls:()=>calls,setVersion:value=>version=value};
}

test('persisted companion failures emit only safe operational metadata once',async()=>{
 const f=await fixture();assert.equal((await f.send()).status,'failed');assert.equal(f.outcomes.length,1);
 const {user,event,context}=f.outcomes[0];assert.deepEqual(user,owner);
 assert.deepEqual(event,{name:'companion_failed',properties:{page:'reader',stage:'companion',outcome:'failure',errorKind:'internal'}});
 assert.equal(context.operationId,f.operationId);assert.match(context.dedupKey,/^companion-failed:[a-f0-9-]{36}$/);
 assert.ok(!JSON.stringify({event,context}).includes('PRIVATE'));
 assert.equal((await f.send()).status,'failed');assert.equal(f.calls(),1);assert.equal(f.outcomes.length,1);
});
test('malformed generated companion output is a parse failure rather than silent success',async()=>{
 const f=await fixture({generator:async()=>({kind:'message',text:'PRIVATE_BAD_RESULT',sourcePassageIds:['not-observed']})});
 assert.equal((await f.send()).status,'failed');assert.equal(f.outcomes[0]?.event.properties.errorKind,'parse');
});
test('ordinary admission limits and revoked work do not emit companion faults',async()=>{
 const limited=await fixture({quota:async()=>{throw Object.assign(Error('PRIVATE_LIMIT'),{status:429});}});
 assert.equal((await limited.send()).status,'failed');assert.equal(limited.calls(),0);assert.deepEqual(limited.outcomes,[]);
 const revoked=await fixture();assert.equal((await revoked.send({authorize:async()=>false})).status,'cancelled');assert.deepEqual(revoked.outcomes,[]);
});
test('source invalidation after generation is not reported as a provider fault',async()=>{
 let f;f=await fixture({generator:async()=>{f.setVersion('v2');return {kind:'silence'};}});
 await f.send();assert.deepEqual(f.outcomes,[]);
});
test('late provider rejection after authorization revocation stays cancelled and silent',async()=>{
 let authorized=true;const f=await fixture({generator:async()=>{authorized=false;throw Error('PRIVATE_LATE_FAILURE');}});
 assert.equal((await f.send({authorize:async()=>authorized})).status,'cancelled');assert.deepEqual(f.outcomes,[]);
});
test('silence and completed messages never become fault outcomes',async()=>{
 for(const candidate of [{kind:'silence'},{kind:'message',text:'Continue reading.',sourcePassageIds:['p1']}]){
  const f=await fixture({generator:async()=>candidate});assert.ok(['silent','completed'].includes((await f.send()).status));assert.deepEqual(f.outcomes,[]);
 }
});
test('observer failures cannot replace a persisted companion failure',async()=>{
 for(const observer of [()=>{throw Error('PRIVATE_OBSERVER');},async()=>{throw Error('PRIVATE_OBSERVER');}]){
  const f=await fixture({observer});assert.equal((await f.send()).status,'failed');
 }
});
test('a pending observer does not hold the persisted domain result open',async()=>{
 const f=await fixture({observer:()=>new Promise(()=>{})});
 assert.equal((await f.send()).status,'failed');
});
test('companion receipts remain opt-in, server-only, deduplicated and sanitized at transport',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'companion-observability-')),outgoing=[],pending=[];
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={LEAFHOUR_OBSERVABILITY_ENABLED:'true',OBSERVABILITY_ID_SECRET:'s'.repeat(32),POSTHOG_PROJECT_KEY:'test-key',POSTHOG_HOST:'https://posthog.example',VERCEL_ENV:'production'};
 const service=createObservability({dataDir:dir,env,schedule:p=>pending.push(p),fetcher:async(_url,opts)=>{outgoing.push(JSON.parse(opts.body));return Response.json({});}});
 const properties={page:'reader',stage:'companion',outcome:'failure',errorKind:'internal'};
 const context={dedupKey:'PRIVATE_RECEIPT',operationId:randomUUID()};
 assert.equal(await service.event(owner,'companion_failed',properties,context),false);
 await service.setConsent(owner,{analytics:false,diagnostics:true});
 assert.equal(await service.event(owner,'companion_failed',properties,context),true);
 assert.equal(await service.event(owner,'companion_failed',properties,context),false);
 await assert.rejects(service.accept(owner,{events:[{id:randomUUID(),operationId:randomUUID(),name:'companion_failed',occurredAt:new Date().toISOString(),properties}]}),{status:400});
 await assert.rejects(service.accept(owner,{events:[{id:randomUUID(),operationId:randomUUID(),name:'client_error',occurredAt:new Date().toISOString(),properties}]}),{status:400});
 while(pending.length)await Promise.all(pending.splice(0));
 assert.equal(outgoing.length,1);assert.equal(outgoing[0].event,'companion_failed');assert.equal(outgoing[0].properties.stage,'companion');
 assert.ok(!JSON.stringify(outgoing).includes('PRIVATE'));assert.ok(!JSON.stringify(outgoing).includes(owner.id));
});
test('actual HTTP200 companion failures correlate the request and emit one domain receipt',async t=>{
 let now=1800000000000;t.mock.method(Date,'now',()=>now);
 const dir=await mkdtemp(path.join(tmpdir(),'companion-http-')),user={id:'isolated-http-owner'};
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),portalDataDir:path.join(dir,'portal'),env:{},authService:{userFor:async()=>user},chatGenerator:null,companionGenerator:async()=>{throw Error('PRIVATE_PROVIDER');},introductionGenerator:null,annotationGenerator:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await server.portal.chat.close();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const book=await server.portal.library.getBook(user,'gutenberg-alice');
 const section=book.sections.find(s=>s.paragraphs.filter(p=>p.kind!=='source_heading').length>=2);
 const passages=section.paragraphs.filter(p=>p.kind!=='source_heading').slice(0,2);
 let meta=await server.portal.chat.companion.view(user,book.bookId);
 for(const p of passages)for(let n=0;n<7;n++){now+=8000;meta=await server.portal.chat.companion.observe(user,book.bookId,{revision:meta.revision,sessionId:meta.sessionId,contentVersion:meta.contentVersion,passageId:p.id,active:true});}
 const seen=[];server.portal.observability.event=async(...args)=>{seen.push(args);return true;};
 const operationId=randomUUID(),body={id:'fixture-companion',revision:meta.revision,sessionId:meta.sessionId,contentVersion:meta.contentVersion,passageId:passages[1].id};
 const origin='http://127.0.0.1:'+server.address().port;
 const call=()=>fetch(origin+'/api/library/books/'+book.bookId+'/companion/messages',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Reader-Owner':user.id,'X-Leafhour-Operation':operationId},body:JSON.stringify(body)});
 const first=await call();assert.equal(first.status,200);assert.equal((await first.json()).status,'failed');
 const second=await call();assert.equal(second.status,200);assert.equal((await second.json()).status,'failed');
 assert.equal(seen.length,1);assert.equal(seen[0][1],'companion_failed');assert.equal(seen[0][3].operationId,operationId);
 assert.ok(!JSON.stringify(seen.map(a=>a.slice(1))).includes('PRIVATE'));
});
test('the closed contract and both fault trends include companion outcomes',()=>{
 const event=validateObservabilityEvent({id:randomUUID(),operationId:randomUUID(),name:'companion_failed',occurredAt:new Date().toISOString(),properties:{page:'reader',stage:'companion',outcome:'failure',errorKind:'internal',text:'PRIVATE'}});
 assert.ok(event);assert.equal(event.properties.text,undefined);
 const fault=observabilityDashboards().find(d=>d.name==='Leafhour · 故障');
 assert.ok(fault.insights.every(i=>i.query.source.series.some(s=>s.event==='companion_failed')));
});
