import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditGate} from '../server/credit-gate.mjs';
import {createBillingService} from '../server/billing-service.mjs';
import {createBillingMemoryStore} from '../server/billing-memory-store.mjs';

const source=()=>({bookId:'book',contentVersion:'v1',chapters:['current','next','third'].map(id=>({id})),sections:['current','next','third'].map(chapterId=>({chapterId,paragraphs:[1,2].map(n=>({id:chapterId+n,chapterId,original:'An original paragraph '+n+'.',translations:{}}))}))});
async function fixture({paid=false,funded=true}={}){
 const {createReadingTranslation}=await import('../server/reading-translation.mjs').catch(()=>assert.fail('Shared bounded reading translation service is missing'));
 const book=source(),calls=[],user={id:'owner'},store=createBillingMemoryStore(),billing=createBillingService({enabled:paid,store});
 if(paid&&funded)await billing.trial({ownerId:user.id,verified:true});
 const library={translationAvailable:true,getBook:async owner=>{if(owner?.id!==user.id)throw Object.assign(Error('not owned'),{status:403});return structuredClone(book);},translate:async(owner,id,pid,options)=>{
  calls.push({pid,options});if(options.authorizeGeneration)assert.equal(await options.authorizeGeneration(),true);
  const p=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===pid);
  p.translations=Object.fromEntries(['literal','interpretive'].map(variant=>[variant,options.preserveExistingTranslations&&p.translations?.[variant]?.text?.trim()?p.translations[variant]:{text:variant+' draft',sourceVersion:book.contentVersion,status:'draft',...(options.generationReceipt?{generationReceipt:options.generationReceipt}:{})}]));return structuredClone(p);
 }};
 const creditGate=createCreditGate({library,billing}),service=createReadingTranslation({library,billing,creditGate});
 return {book,calls,user,billing,store,library,service,step:input=>service.step(user,'book',{chapterId:'current',contentVersion:'v1',phase:'current',...input})};
}
test('one call generates one missing passage, current then immediate next without third-chapter traversal',async()=>{
 const f=await fixture();let r=await f.step({passageId:'current2'});assert.equal(r.passage.id,'current2');assert.equal(r.done,false);
 r=await f.step({});assert.equal(r.passage.id,'current1');assert.equal(r.done,true);
 r=await f.step({phase:'next'});assert.equal(r.chapterId,'next');assert.equal(r.passage.id,'next1');assert.equal(r.done,false);
 r=await f.step({phase:'next'});assert.equal(r.done,true);assert.deepEqual(f.calls.map(c=>c.pid),['current2','current1','next1','next2']);
 assert.equal((await f.step({phase:'next'})).passage,undefined);assert.equal(f.book.sections[2].paragraphs[0].translations.literal,undefined);
 assert.equal((await f.step({chapterId:'third',phase:'next'})).chapterId,null);
});
test('stale versions, foreign owners, invalid phases and cross-chapter priority reject before generation',async()=>{
 const f=await fixture();
 for(const input of [{contentVersion:'stale'},{chapterId:'absent'},{phase:'third'},{passageId:'next1'},{billing:{}}])await assert.rejects(f.step(input));
 await assert.rejects(f.service.step({id:'foreign'},'book',{chapterId:'current',contentVersion:'v1',phase:'current'}),{status:403});assert.equal(f.calls.length,0);
});
test('partial translations are completed while every saved variant, heading and Chinese original is retained',async()=>{
 const f=await fixture(),rows=f.book.sections[0].paragraphs;
 rows[0].translations={literal:{text:'reviewed',status:'reviewed'},interpretive:{text:'independent',status:'draft'}};rows[1].translations={literal:{text:'partial',status:'reviewed'}};
 rows.push({id:'heading',chapterId:'current',original:'A heading',kind:'source_heading',translations:{}},{id:'chinese',chapterId:'current',original:'这段中文原文无需翻译。',translations:{}});
 const before=structuredClone(rows);assert.equal((await f.step({})).done,true);assert.equal(f.calls.length,1);assert.deepEqual(rows[0],before[0]);assert.deepEqual(rows[1].translations.literal,before[1].translations.literal);assert.equal(rows[1].translations.interpretive.text,'interpretive draft');assert.deepEqual(rows.slice(2),before.slice(2));
});
test('parallel callers share one deterministic paid operation and charge only the saved independent pair',async()=>{
 const f=await fixture({paid:true}),results=await Promise.all(Array.from({length:6},()=>f.step({passageId:'current1'})));
 assert.ok(results.every(r=>r.passage.id==='current1'));assert.equal(f.calls.length,1);
 assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
 assert.match(f.calls[0].options.generationReceipt.requestId,/^reading-/);
 await f.step({passageId:'current1'});assert.equal(f.calls.length,1,'cached passage never starts a fresh charge');
});
test('durable paid identity survives a service restart without quoting or generating again',async()=>{
 const f=await fixture({paid:true});const first=await f.step({passageId:'current1'});
 const {createReadingTranslation}=await import('../server/reading-translation.mjs');
 const second=createReadingTranslation({library:f.library,billing:f.billing,creditGate:createCreditGate({library:f.library,billing:f.billing})});
 const r=await second.step(f.user,'book',{chapterId:'current',contentVersion:'v1',phase:'current',passageId:'current1'});
 assert.deepEqual(r.passage,first.passage);assert.equal(f.calls.length,1);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
});
test('exhausted credit and unconfigured providers stop before model work; abort cannot start generation',async()=>{
 const f=await fixture({paid:true,funded:false});await assert.rejects(f.step({}),{status:402});assert.equal(f.calls.length,0);
 f.library.translationAvailable=false;await assert.rejects(f.step({}),{status:503});
 const free=await fixture(),controller=new AbortController();controller.abort();await assert.rejects(free.service.step(free.user,'book',{chapterId:'current',contentVersion:'v1',phase:'current'},{signal:controller.signal}));assert.equal(free.calls.length,0);
});
test('automatic paid preparation rejects a quote with a changed price, mode, owner or source',async()=>{
 for(const patch of [{units:2_000_000},{mode:'live'},{ownerId:'foreign'},{action:'conversation'},{scope:{bookId:'other'}}]){
  const f=await fixture({paid:true}),quote=f.billing.quote;f.billing.quote=async args=>({...await quote(args),...patch});
  await assert.rejects(f.step({}),{status:409});assert.equal(f.calls.length,0);
 }
});
test('free instances enforce the same bounded single-passage context before provider dispatch',async()=>{
 const f=await fixture();f.book.sections[0].paragraphs[0].original='x'.repeat(4001);await assert.rejects(f.step({}),{status:413});assert.equal(f.calls.length,0);
});
test('a known released paid attempt can be retried without charging for the failed attempt',async()=>{
 const f=await fixture({paid:true}),translate=f.library.translate;let attempts=0;
 f.library.translate=async(...args)=>{attempts++;if(attempts===1)throw Object.assign(Error('Provider temporarily unavailable'),{status:503});return translate(...args);};
 await assert.rejects(f.step({passageId:'current1'}),{status:503});assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,0);
 const retry=await f.step({passageId:'current1'});assert.equal(retry.passage.id,'current1');assert.equal(attempts,2);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
});
test('a shared generation keeps each caller current/next receipt phase',async()=>{
 const f=await fixture(),[a,b]=await Promise.all([f.step({phase:'next',passageId:'next1'}),f.step({chapterId:'next',passageId:'next1'})]);
 assert.equal(f.calls.length,1);assert.equal(a.phase,'next');assert.equal(b.phase,'current');assert.equal(a.chapterId,'next');assert.equal(b.chapterId,'next');
});
test('at most three automatic attempts are permitted for a source passage',async()=>{
 const f=await fixture({paid:true});let attempts=0;f.library.translate=async()=>{attempts++;throw Object.assign(Error('Provider failure'),{status:503});};
 for(let i=0;i<3;i++)await assert.rejects(f.step({passageId:'current1'}),{status:503});
 await assert.rejects(f.step({passageId:'current1'}),error=>error.status===409&&error.message.includes('单段翻译'));assert.equal(attempts,3);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,0);
});
test('paid partial completion retains the saved reviewed variant and settles only a delivered missing variant',async()=>{
 const f=await fixture({paid:true}),literal={text:'Exact reviewed version',status:'reviewed',sourceVersion:'v1',origin:'human'};f.book.sections[0].paragraphs[0].translations={literal:structuredClone(literal)};
 const result=await f.step({passageId:'current1'});assert.deepEqual(result.passage.translations.literal,literal);assert.equal(result.passage.translations.interpretive.text,'interpretive draft');assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
 await f.step({passageId:'current1'});assert.equal(f.calls.length,1);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
});
test('a saved partial completion reconciles a durable settlement interruption without another generation',async()=>{
 const f=await fixture({paid:true});f.book.sections[0].paragraphs[0].translations={literal:{text:'Saved literal',status:'draft',sourceVersion:'v1'}};
 const command=f.store.command;let failOnce=true;f.store.command=async(action,input)=>{if(action==='settle'&&failOnce){failOnce=false;throw Error('Settlement transport interrupted');}return command(action,input);};
 await assert.rejects(f.step({passageId:'current1'}),/Settlement transport interrupted/);assert.equal(f.calls.length,1);
 const result=await f.step({passageId:'current1'});assert.equal(result.passage.translations.literal.text,'Saved literal');assert.equal(f.calls.length,1);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);assert.equal((await f.billing.account({ownerId:f.user.id})).reservedUnits,0);
});
test('a paid partial completion cannot settle after changing the preserved saved variant',async()=>{
 const f=await fixture({paid:true});f.book.sections[0].paragraphs[0].translations={literal:{text:'Exact reviewed literal',status:'reviewed',sourceVersion:'v1'}};const translate=f.library.translate;
 f.library.translate=async(...args)=>{const result=await translate(...args);result.translations.literal.text='Unexpected replacement';return result;};
 await assert.rejects(f.step({passageId:'current1'}),{status:502});assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,0);
});
test('blank saved translation objects never bypass paid generation or block missing-content preparation',async()=>{
 const f=await fixture({paid:true});f.book.sections[0].paragraphs[0].translations={literal:{text:'  ',status:'reviewed'},interpretive:{text:'\n',status:'draft'}};
 const result=await f.step({passageId:'current1'});assert.equal(result.passage.translations.literal.text,'literal draft');assert.equal(result.passage.translations.interpretive.text,'interpretive draft');assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
});
test('self-hosted free preparation also limits failed automatic attempts within a server lifetime',async()=>{
 const f=await fixture();let attempts=0;f.library.translate=async()=>{attempts++;throw Object.assign(Error('Provider failure'),{status:503});};
 for(let i=0;i<3;i++)await assert.rejects(f.step({passageId:'current1'}),{status:503});await assert.rejects(f.step({passageId:'current1'}),{status:409});assert.equal(attempts,3);
});
test('separate service instances sharing the ledger cannot generate or charge the same source twice',async()=>{
 const f=await fixture({paid:true}),translate=f.library.translate;let dispatched=0;f.library.translate=async(...args)=>{dispatched++;await new Promise(setImmediate);return translate(...args);};
 const {createReadingTranslation}=await import('../server/reading-translation.mjs'),second=createReadingTranslation({library:f.library,billing:f.billing,creditGate:createCreditGate({library:f.library,billing:f.billing})});
 const input={chapterId:'current',contentVersion:'v1',phase:'current',passageId:'current1'},results=await Promise.allSettled([f.service.step(f.user,'book',input),second.step(f.user,'book',input)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));for(const result of results)if(result.status==='rejected')assert.equal(result.reason.status,409);assert.equal(dispatched,1);assert.equal((await f.billing.account({ownerId:f.user.id})).consumedUnits,1_000_000);
 const receipt=await second.step(f.user,'book',input);assert.equal(receipt.passage.id,'current1');assert.equal(dispatched,1);
});
