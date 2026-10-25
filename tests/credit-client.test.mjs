import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../app/credit-client.mjs').catch(()=>({}));
const helper=name=>{assert.equal(typeof mod[name],'function',name);return mod[name];};
const session={user:{id:'A'},billing:{enabled:true,mode:'test',unitsPerPoint:1000000,prices:{translation:1000000,conversation:4000000,annotation:4000000}}};
const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const input={id:'request-1',passageId:'p-1',contentVersion:'v-1'};
const setup=()=>{let current='A',valid=true;const calls=[],confirmations=[],storage=new Map();const f={session,owner:'A',isCurrent:()=>valid,locale:'en',storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},confirm:async text=>{confirmations.push(text);return true;},fetcher:async(url,options)=>{calls.push({url,options});if(url==='/api/auth/session')return reply({user:current?{id:current}:null});return reply({id:'q-1',ownerId:'A',action:'translation',units:1000000,scope:{bookId:'book-1',requestId:'request-1',passageId:'p-1',contentVersion:'v-1'}});}};return {f,calls,confirmations,storage,setOwner:value=>current=value,invalidate:()=>valid=false};};

test('disabled billing returns exact data without network, identifiers or consent',async()=>{
 const prepare=helper('prepareCreditRequest'),data={passageId:'p'};
 assert.equal(await prepare({url:'/api/library/books/book-1/translate',data,session:{user:{id:'A'},billing:{enabled:false}},fetcher:()=>assert.fail('network'),confirm:()=>assert.fail('confirm')}),data);
});

test('explicit translation quotes its whitelisted body and requires first consent before attaching spend authority',async()=>{
 const prepare=helper('prepareCreditRequest'),t=setup();const result=await prepare({...t.f,url:'/api/library/books/book-1/translate?keep=1',data:input});
 const post=t.calls.find(c=>c.url==='/api/billing/quotes');assert.deepEqual(JSON.parse(post.options.body),{action:'translation',bookId:'book-1',input});assert.equal(post.options.headers['X-Reader-Owner'],'A');assert.equal(post.options.credentials,'same-origin');assert.equal(t.confirmations.length,1);assert.match(t.confirmations[0],/1 point/);assert.match(t.confirmations[0],/4 points/);assert.match(t.confirmations[0],/cancelled/);
 assert.deepEqual({...result,billing:undefined},{...input,billing:undefined});assert.equal(result.billing.quoteId,'q-1');assert.ok(result.billing.idempotencyKey.length>=10);assert.equal(input.billing,undefined);
});

test('consent persists only for the same owner, mode and price schedule and cancellation adds no authority',async()=>{
 const prepare=helper('prepareCreditRequest'),t=setup();await prepare({...t.f,url:'/api/library/books/book-1/translate',data:input});await prepare({...t.f,url:'/api/library/books/book-1/translate',data:input});assert.equal(t.confirmations.length,1);
 const cancelled=setup();cancelled.f.confirm=()=>false;await assert.rejects(prepare({...cancelled.f,url:'/api/library/books/book-1/translate',data:input}),{code:'BILLING_CONSENT_CANCELLED'});assert.equal(cancelled.storage.size,0);
 const live=setup();live.f.storage=t.f.storage;live.f.session={...session,billing:{...session.billing,mode:'live'}};await prepare({...live.f,url:'/api/library/books/book-1/translate',data:input});assert.equal(live.confirmations.length,1);
});

test('account changes while quote or confirmation waits prevent prepared paid submission',async()=>{
 const prepare=helper('prepareCreditRequest');
 for(const where of ['quote','confirm','revision']){const t=setup();if(where==='quote'){const original=t.f.fetcher;t.f.fetcher=async(...args)=>{const response=await original(...args);if(args[0]==='/api/billing/quotes')t.setOwner('B');return response;};}else t.f.confirm=()=>{where==='revision'?t.invalidate():t.setOwner('B');return true;};await assert.rejects(prepare({...t.f,url:'/api/library/books/book-1/translate',data:input}),{code:'BILLING_ACCOUNT_CHANGED'});assert.equal(t.storage.size,0);}
});

test('invalid quote facts, foreign owners and changed prices fail closed',async()=>{
 const prepare=helper('prepareCreditRequest');
 for(const facts of [{ownerId:'B'},{action:'annotation'},{units:0},{units:4000000},{scope:{bookId:'other',requestId:'request-1'}},{scope:{bookId:'book-1',requestId:'other'}},{scope:{bookId:'book-1',requestId:'request-1',passageId:'other'}},{id:''}]){const t=setup();t.f.fetcher=async url=>url==='/api/auth/session'?reply({user:{id:'A'}}):reply({id:'q',ownerId:'A',action:'translation',units:1000000,scope:{bookId:'book-1',requestId:'request-1',passageId:'p-1',contentVersion:'v-1'},...facts});await assert.rejects(prepare({...t.f,url:'/api/library/books/book-1/translate',data:input}),{code:'BILLING_INVALID_QUOTE'});assert.equal(t.confirmations.length,0);}
});

test('only explicit generation endpoints are intercepted and client billing injection is rejected',async()=>{
 const prepare=helper('prepareCreditRequest'),t=setup();
 for(const url of ['/api/library/books/book-1/chat/scope','/api/library/books/book-1/chat/request-1/cancel','/api/library/books/book-1/annotations/requests/x/cancel','/api/book','https://elsewhere.test/api/library/books/book-1/chat'])assert.equal(await prepare({...t.f,url,data:input}),input,url);
 await assert.rejects(prepare({...t.f,url:'/api/library/books/book-1/translate',data:{...input,billing:{quoteId:'forged',idempotencyKey:'forged'}}}),{code:'BILLING_INVALID_INPUT'});assert.equal(t.calls.length,0);
});

test('translation receives a stable request ID when absent and body extras never leak into quote',async()=>{
 const prepare=helper('prepareCreditRequest'),t=setup();t.f.fetcher=async(url,options)=>{t.calls.push({url,options});if(url==='/api/auth/session')return reply({user:{id:'A'}});const posted=JSON.parse(options.body);return reply({id:'q',ownerId:'A',action:posted.action,units:1000000,scope:{bookId:posted.bookId,requestId:posted.input.id}});};
 const result=await prepare({...t.f,url:'/api/library/books/book-1/translate',data:{passageId:'p-1'}});assert.match(result.id,/^[A-Za-z0-9_-]+$/);assert.ok(result.billing.idempotencyKey);
 await assert.rejects(prepare({...t.f,url:'/api/library/books/book-1/translate',data:{passageId:'p-1',ownerId:'B'}}),{code:'BILLING_INVALID_INPUT'});
});

test('all four locales expose exact point labels and safe readable errors',()=>{
 const label=helper('creditActionLabel'),message=helper('creditErrorMessage');
 assert.equal(label('translation','en'),'1 point');assert.equal(label('conversation','en'),'4 points');assert.equal(label('annotation','zh-Hans'),'4 点');assert.equal(label('translation','zh-Hant'),'1 點');assert.equal(label('conversation','ja'),'4 ポイント');assert.match(message({status:402},'en'),/points/i);assert.doesNotMatch(message({message:'<secret>'},'en'),/secret/);
});

test('a lost reply and same-tab reload reuse the original quote and idempotency pair in the real ledger',async()=>{
 const {createBillingService}=await import('../server/billing-service.mjs');const {createBillingMemoryStore}=await import('../server/billing-memory-store.mjs');
 const store=createBillingMemoryStore(),service=createBillingService({store,enabled:true,mode:'test'}),rows=new Map(),storage={getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,value)};let quotes=0,current='A';const records=new Map();
 await store.command('trial',{mode:'test',ownerId:'A',grantId:'isolated-trial',units:10000000});
 const fetcher=async(url,options)=>{if(url==='/api/auth/session')return reply({user:{id:current}});const posted=JSON.parse(options.body);quotes++;const quote=await service.quote({ownerId:current,action:posted.action,scope:{bookId:posted.bookId,requestId:posted.input.id,passageId:posted.input.passageId,contentVersion:posted.input.contentVersion,requestHash:'a'.repeat(64)}});records.set(quote.id,quote);return reply(quote);};
 const options={url:'/api/library/books/book-1/translate',data:{...input},session,owner:'A',isCurrent:()=>true,fetcher,storage,confirm:()=>true};
 const first=await helper('prepareCreditRequest')(options);const quote=records.get(first.billing.quoteId);
 const op=await store.command('reserve',{mode:'test',ownerId:'A',operationId:'interrupted',quoteId:quote.id,scopeHash:quote.scopeHash,idempotencyKey:first.billing.idempotencyKey});
 const reloaded=await import('../app/credit-client.mjs?retry-reload=isolated');const again=await reloaded.prepareCreditRequest({...options,data:{...input}});
 assert.deepEqual(again.billing,first.billing);assert.equal(quotes,1,'retry must not issue a new quote for the same request');
 const repeated=await store.command('reserve',{mode:'test',ownerId:'A',operationId:'retry-other-operation-id',quoteId:again.billing.quoteId,scopeHash:quote.scopeHash,idempotencyKey:again.billing.idempotencyKey});assert.equal(repeated.id,op.id);assert.equal((await service.account({ownerId:'A'})).reservedUnits,1000000);
 await assert.rejects(reloaded.prepareCreditRequest({...options,data:{...input,passageId:'changed'}}),{code:'BILLING_INPUT_CHANGED'});assert.equal(quotes,1);
 const reads=[];current='B';const foreign=await reloaded.prepareCreditRequest({...options,session:{...session,user:{id:'B'}},owner:'B',storage:{getItem:key=>{reads.push(key);return rows.get(key)||null;},setItem:(key,value)=>rows.set(key,value)}});assert.notEqual(foreign.billing.quoteId,first.billing.quoteId);assert.ok(reads.every(key=>!key.includes('owner=A')),'the second identity never reads the first identity pair');
 for(const saved of rows.values())assert.doesNotMatch(saved,/"text":|private question/,'only hashed input and minimal financial references may persist');
});

test('consent cancellation and quote failure are marked as not yet submitted',async()=>{
 const prepare=helper('prepareCreditRequest'),t=setup();t.f.confirm=()=>false;
 await assert.rejects(prepare({...t.f,url:'/api/library/books/book-1/translate',data:input}),error=>error.code==='BILLING_CONSENT_CANCELLED'&&error.preSubmit===true);
});

test('paid conversation quotes and preserves explicit per-turn preference consent',async()=>{
 const t=setup(),data={...input,text:'Explain this.',scopeRevision:0,preferenceWrites:true};
 t.f.fetcher=async(url,options)=>{t.calls.push({url,options});return reply(url==='/api/auth/session'?{user:{id:'A'}}:{id:'q-chat',ownerId:'A',action:'conversation',units:4000000,scope:{bookId:'book-1',requestId:data.id,passageId:data.passageId,contentVersion:data.contentVersion}});};
 const prepared=await helper('prepareCreditRequest')({...t.f,url:'/api/library/books/book-1/chat',data});
 assert.equal(prepared.preferenceWrites,true);assert.deepEqual(JSON.parse(t.calls.find(c=>c.url==='/api/billing/quotes').options.body).input,data);assert.equal(prepared.billing.quoteId,'q-chat');
 await assert.rejects(helper('prepareCreditRequest')({...t.f,url:'/api/library/books/book-1/chat',data:{...data,id:'bad',preferenceWrites:'true'}}),e=>e.code==='BILLING_INVALID_INPUT');
});


test('point confirmation includes explicit per-question preference authority',()=>{
 const text=helper('creditConsentText');assert.match(text({action:'conversation',units:4000000,locale:'en',preferenceWrites:true}),/updates are allowed/);assert.match(text({action:'conversation',units:4000000,locale:'en',preferenceWrites:false}),/updates are off/);
});
