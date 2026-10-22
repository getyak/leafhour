import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditGate} from '../server/credit-gate.mjs';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';
const book={bookId:'book-a',contentVersion:'version-a',sections:[{paragraphs:[{id:'p1',original:'An original paragraph.',translations:{}}]}]};
function fixture(){
 const calls=[],billing={enabled:true,async quote(input){calls.push(['quote',input]);return {id:'quote-a',units:1000000};},async run(input){calls.push(['run',input.scope]);await input.execute({operationId:'operation-a'});return {status:'settled',id:'operation-a'};},async operation(){return null;}};
 const library={getBook:async()=>structuredClone(book)},gate=createCreditGate({billing,library});
 return {gate,calls,billing,library};
}
test('a source-bound quote records a digest rather than private text',async()=>{
 const f=fixture(),input={id:'request-a',passageId:'p1',text:'A private question',contentVersion:'version-a'};
 await f.gate.quote({id:'account-a'},{action:'conversation',bookId:'book-a',input});
 const saved=f.calls[0][1];assert.equal(saved.scope.bookId,'book-a');assert.equal(saved.scope.requestId,'request-a');assert.equal(saved.scope.requestHash.length,64);
 assert.ok(!JSON.stringify(saved.scope).includes('private question'));
});
test('new paid generation without quote is refused before dispatch',async()=>{
 const f=fixture();let ran=false;
 await assert.rejects(f.gate.run({user:{id:'account-a'},action:'translation',bookId:'book-a',input:{passageId:'p1'},execute:async()=>{ran=true;}}),{status:402});
 assert.equal(ran,false);
});
test('a completed cached translation stays free and does not require a new quote',async()=>{
 const f=fixture();f.library.getBook=async()=>({...structuredClone(book),sections:[{paragraphs:[{...book.sections[0].paragraphs[0],translations:{literal:{text:'直译'},interpretive:{text:'意译'}}}]}]});
 let received;
 const result=await f.gate.run({user:{id:'account-a'},action:'translation',bookId:'book-a',input:{passageId:'p1'},execute:async input=>{received=input;return {id:'p1',translations:{literal:{text:'直译'},interpretive:{text:'意译'}}};}});
 assert.equal(result.id,'p1');assert.deepEqual(received,{passageId:'p1'});assert.deepEqual(f.calls,[]);
});
test('only persisted successful results may settle and financial metadata stays out of the reading request',async()=>{
 const f=fixture();let received;
 const result=await f.gate.run({user:{id:'account-a'},action:'conversation',bookId:'book-a',input:{id:'request-a',text:'Question',passageId:'p1',contentVersion:'version-a',billing:{quoteId:'quote-a',idempotencyKey:'request-a'}},execute:async input=>{received=input;return {id:'request-a',status:'completed',passageId:'p1',contentVersion:'version-a',answer:{summary:'Saved answer'}};}});
 assert.equal(result.answer.summary,'Saved answer');assert.ok(!('billing' in received));
 await assert.rejects(f.gate.run({user:{id:'account-a'},action:'conversation',bookId:'book-a',input:{id:'request-b',text:'Question',passageId:'p1',contentVersion:'version-a',billing:{quoteId:'quote-b',idempotencyKey:'request-b'}},execute:async()=>({id:'request-b',status:'failed',answer:null})}),{status:502});
});
test('stale and oversized source requests cannot submit paid generation',async()=>{
 const f=fixture();
 await assert.rejects(f.gate.quote({id:'account-a'},{action:'translation',bookId:'book-a',input:{id:'t-a',passageId:'p1',contentVersion:'old'}}),{status:409});
 f.library.getBook=async()=>({...book,sections:[{paragraphs:[{id:'p1',original:'x'.repeat(4001),translations:{}}]}]});
 await assert.rejects(f.gate.quote({id:'account-a'},{action:'translation',bookId:'book-a',input:{id:'t-a',passageId:'p1'}}),{status:413});
 assert.deepEqual(f.calls,[]);
});
async function realFixture(){
 const now=Date.parse('2026-10-21T00:00:00Z'),store=createBillingMemoryStore({clock:()=>now}),billing=createBillingService({enabled:true,store,clock:()=>now}),user={id:'account-a'};
 await billing.trial({ownerId:user.id,verified:true});
 const savedBook=structuredClone(book),turns=[];const library={getBook:async()=>structuredClone(savedBook)},chat={view:async()=>({turns:structuredClone(turns)})};
 const gate=createCreditGate({billing,library,chat,clock:()=>now});return {gate,billing,store,user,savedBook,turns,now,chat,library};
}
test('real billing domain accepts the source-bound durable completion receipt',async()=>{
 const f=await realFixture(),input={id:'request-real',text:'Question',passageId:'p1',contentVersion:'version-a'};
 const quote=await f.gate.quote(f.user,{action:'conversation',bookId:'book-a',input});let calls=0;
 const execute=async body=>{calls++;const turn={...body,status:'completed',answer:{summary:'Saved answer'}};f.turns.push(turn);return turn;};
 const result=await f.gate.run({user:f.user,action:'conversation',bookId:'book-a',input:{...input,billing:{quoteId:quote.id,idempotencyKey:input.id}},execute});
 assert.equal(result.status,'completed');assert.equal(calls,1);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,4_000_000);
 assert.equal((await f.billing.recover({ownerId:f.user.id})).operations.length,0);
});
test('cached persisted success recovers the pending operation without another generation',async()=>{
 const f=await realFixture(),input={id:'recover-real',text:'Question',passageId:'p1',contentVersion:'version-a'};
 const quote=await f.gate.quote(f.user,{action:'conversation',bookId:'book-a',input});
 let captured;const failing={...f.billing,run:async args=>{
  captured=args.operationId;
  const op=await f.store.command('reserve',{mode:'test',ownerId:f.user.id,quoteId:quote.id,scopeHash:quote.scopeHash,operationId:captured,idempotencyKey:input.id});
  await f.store.command('running',{mode:'test',ownerId:f.user.id,operationId:captured,reservationToken:op.reservationToken});
  f.turns.push({...input,status:'completed',answer:{summary:'Saved before crash'}});throw new Error('process ended after saving');
 }};
 const gate=createCreditGate({billing:failing,library:{getBook:async()=>structuredClone(f.savedBook)},chat:{view:async()=>({turns:f.turns})}});
 await assert.rejects(gate.run({user:f.user,action:'conversation',bookId:'book-a',input:{...input,billing:{quoteId:quote.id,idempotencyKey:input.id}},execute:async()=>{throw new Error('must not generate');}}));
 const recovered=await f.gate.run({user:f.user,action:'conversation',bookId:'book-a',input,execute:async()=>{throw new Error('cached result must not redispatch');}});
 assert.equal(recovered.status,'completed');assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:captured})).status,'settled');assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,4_000_000);
});
test('background recovery verifies saved results before releasing holds and never dispatches models',async()=>{
 const f=await realFixture(),input={id:'background-recover',text:'Question',passageId:'p1',contentVersion:'version-a'};
 const q=await f.gate.quote(f.user,{action:'conversation',bookId:'book-a',input});
 await f.store.command('reserve',{mode:'test',ownerId:f.user.id,quoteId:q.id,scopeHash:q.scopeHash,operationId:'background-op',idempotencyKey:input.id});
 f.turns.push({...input,status:'completed',answer:{summary:'Persisted answer'}});
 await f.gate.recover(f.user);assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:'background-op'})).status,'settled');
});
test('paid translation records the trusted operation reference and recovers only matching variants',async()=>{
 const f=await realFixture(),input={id:'translation-real',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'translation',bookId:'book-a',input});let captured;
 await f.gate.run({user:f.user,action:'translation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute:async(body,authority)=>{
  captured=authority;const p=f.savedBook.sections[0].paragraphs[0];p.translations=Object.fromEntries(['literal','interpretive'].map(k=>[k,{text:k,sourceVersion:'version-a',generationReceipt:authority}]));return structuredClone(p);
 }});
 assert.equal(captured.requestId,input.id);assert.ok(captured.operationId);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
 const second=await realFixture(),q2=await second.gate.quote(second.user,{action:'translation',bookId:'book-a',input:{...input,id:'different'}});
 await second.store.command('reserve',{mode:'test',ownerId:second.user.id,quoteId:q2.id,scopeHash:q2.scopeHash,operationId:'other-operation',idempotencyKey:'different'});
 second.savedBook.sections[0].paragraphs[0].translations={literal:{text:'old',generationReceipt:{operationId:'foreign',requestId:'old'}},interpretive:{text:'old',generationReceipt:{operationId:'foreign',requestId:'old'}}};
 await second.gate.recover(second.user);assert.equal((await second.billing.account({ownerId:second.user.id})).consumedUnits,0);
});
test('cached failed request releases its pending hold without dispatch or new consumption',async()=>{
 const f=await realFixture(),input={id:'failed-cache',text:'Question',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'conversation',bookId:'book-a',input});
 const opId='credit-'+(await import('node:crypto')).createHash('sha256').update(JSON.stringify([f.user.id,'conversation','book-a',input.id])).digest('hex');
 await f.store.command('reserve',{mode:'test',ownerId:f.user.id,quoteId:q.id,scopeHash:q.scopeHash,operationId:opId,idempotencyKey:input.id});f.turns.push({...input,status:'failed',answer:null});
 const result=await f.gate.run({user:f.user,action:'conversation',bookId:'book-a',input,execute:async()=>{throw new Error('must not regenerate');}});
 assert.equal(result.status,'failed');assert.equal((await f.billing.account({ownerId:f.user.id})).reservedUnits,0);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,0);
});
test('orphan recovery releases old unclaimed holds and fences expired translation workers',async()=>{
 const f=await realFixture(),input={id:'orphan-translation',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'translation',bookId:'book-a',input});
 const reserved=await f.store.command('reserve',{mode:'test',ownerId:f.user.id,quoteId:q.id,scopeHash:q.scopeHash,operationId:'orphan-reserved',idempotencyKey:input.id});
 const stale=createCreditGate({billing:f.billing,library:{getBook:async()=>structuredClone(f.savedBook)},clock:()=>f.now+16*60000});await stale.recover(f.user);
 assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:reserved.id})).status,'cancelled');
 await assert.rejects(f.store.command('running',{mode:'test',ownerId:f.user.id,operationId:reserved.id,reservationToken:reserved.reservationToken}),{code:'invalid_state'});
 const second=await f.gate.quote(f.user,{action:'translation',bookId:'book-a',input:{...input,id:'orphan-running'}}),running=await f.store.command('reserve',{mode:'test',ownerId:f.user.id,quoteId:second.id,scopeHash:second.scopeHash,operationId:'orphan-running',idempotencyKey:'orphan-running'});
 await f.store.command('running',{mode:'test',ownerId:f.user.id,operationId:running.id,reservationToken:running.reservationToken});await stale.recover(f.user);
 assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:running.id})).status,'cancelled');assert.equal((await f.billing.account({ownerId:f.user.id})).reservedUnits,0);
});
test('annotation followup binds the owned thread quote while preserving original request identity',async()=>{
 const f=await realFixture(),thread={id:'thread-a',quote:{bookId:'book-a',contentVersion:'version-a',parts:[{passageId:'p1',start:0,end:2}]},messages:[]},requests=[];
 f.chat.annotations={view:async()=>({archive:{threads:[thread]},requests})};
 const input={id:'followup-a',threadId:thread.id,text:'Explain this distinction',responseLocale:'en'},q=await f.gate.quote(f.user,{action:'annotation',bookId:'book-a',input});
 assert.equal(q.scope.passageId,'p1');assert.equal(q.scope.contentVersion,'version-a');
 const result=await f.gate.run({user:f.user,action:'annotation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute:async body=>{assert.deepEqual(body,input);const request={id:input.id,threadId:thread.id,status:'completed'};requests.push(request);return {request,thread};}});
 assert.equal(result.request.status,'completed');assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,4_000_000);
});
test('real generation failure exposes only its trusted terminal billing reference',async()=>{
 const f=await realFixture(),input={id:'terminal-failure-ref',text:'Question',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'conversation',bookId:'book-a',input});
 const failure=new Error('Generation failed');let returned;
 await assert.rejects(f.gate.run({user:f.user,action:'conversation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute:async()=>{throw failure;}}),error=>{returned=error;return error===failure;});
 assert.equal(returned.billingOperation.status,'released');assert.deepEqual(Object.keys(returned.billingOperation).sort(),['id','status']);
 assert.equal((await f.billing.operation({ownerId:f.user.id,operationId:returned.billingOperation.id})).status,'released');
});
test('ambiguous completion persistence failure exposes no terminal billing hint',async()=>{
 const f=await realFixture(),input={id:'unknown-result-ref',text:'Question',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'conversation',bookId:'book-a',input});
 const original=f.store.command,storageFailure=Object.assign(new Error('Storage unavailable'),{status:503});f.store.command=async(action,p)=>{if(action==='result')throw storageFailure;return original(action,p);};
 await assert.rejects(f.gate.run({user:f.user,action:'conversation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute:async()=>{const turn={...input,status:'completed',answer:{summary:'Saved answer'}};f.turns.push(turn);return turn;}}),error=>error===storageFailure&&!Object.hasOwn(error,'billingOperation'));
 const recovery=await f.billing.recover({ownerId:f.user.id});assert.equal(recovery.operations[0].status,'running');
});
test('lost translation failure response replays its terminal hint without another supplier call',async()=>{
 const f=await realFixture(),input={id:'lost-translation-failure',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'translation',bookId:'book-a',input});let calls=0;
 const request={user:f.user,action:'translation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute:async()=>{calls++;throw new Error('Supplier failed');}};
 await assert.rejects(f.gate.run(request));let replay;
 await assert.rejects(f.gate.run(request),error=>{replay=error;return error.status===409;});
 assert.equal(replay.billingOperation.status,'released');assert.deepEqual(Object.keys(replay.billingOperation).sort(),['id','status']);assert.equal(calls,1);
});
test('never-started insufficient and expired requests allow a fresh explicit translation after top-up',async()=>{
 let now=Date.parse('2026-10-21T00:00:00Z');const store=createBillingMemoryStore({clock:()=>now}),billing=createBillingService({enabled:true,store,clock:()=>now}),user={id:'account-a'},savedBook=structuredClone(book),library={getBook:async()=>structuredClone(savedBook)},gate=createCreditGate({billing,library,clock:()=>now});
 const input={id:'never-started-translation',passageId:'p1',contentVersion:'version-a'},q=await gate.quote(user,{action:'translation',bookId:'book-a',input});let calls=0;
 const execute=async(body,authority)=>{calls++;const p=savedBook.sections[0].paragraphs[0];p.translations=Object.fromEntries(['literal','interpretive'].map(k=>[k,{text:k,sourceVersion:'version-a',generationReceipt:authority}]));return structuredClone(p);};
 const request={user,action:'translation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute};
 await assert.rejects(gate.run(request),error=>error.code==='insufficient_credits'&&error.billingOperation?.status==='not_started');assert.equal(calls,0);
 await billing.trial({ownerId:user.id,verified:true});now+=11*60000;
 await assert.rejects(gate.run(request),error=>error.code==='stale_quote'&&error.billingOperation?.status==='not_started');assert.equal(calls,0);
 const fresh={...input,id:'explicit-new-translation'},freshQuote=await gate.quote(user,{action:'translation',bookId:'book-a',input:fresh});
 await gate.run({...request,input:{...fresh,billing:{quoteId:freshQuote.id,idempotencyKey:fresh.id}}});assert.equal(calls,1);assert.equal((await billing.account({ownerId:user.id})).consumedUnits,1_000_000);
});
test('unknown reserve transport failure with no visible operation never claims not-started',async()=>{
 const f=await realFixture(),input={id:'unknown-reserve-transport',passageId:'p1',contentVersion:'version-a'},q=await f.gate.quote(f.user,{action:'translation',bookId:'book-a',input}),original=f.store.command;
 f.store.command=async(action,p)=>{if(action==='reserve')throw Object.assign(new Error('Transport unavailable'),{code:'billing_unavailable',status:503});return original(action,p);};
 await assert.rejects(f.gate.run({user:f.user,action:'translation',bookId:'book-a',input:{...input,billing:{quoteId:q.id,idempotencyKey:input.id}},execute:async()=>{throw new Error('must not dispatch');}}),error=>error.code==='billing_unavailable'&&!Object.hasOwn(error,'billingOperation'));
});
