import test from 'node:test';
import assert from 'node:assert/strict';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function fixture(options={}){
 const {createReaderAutoTranslation}=await import('../app/reader-auto-translation.mjs').catch(()=>assert.fail('Automatic reader translation coordinator is missing'));
 let scope={ownerId:'owner',bookId:'book',contentVersion:'v1',chapterId:'current',mode:'zh',visible:true,enabled:true,passageId:'p1'},calls=[],receipts=[],states=[];
 const coordinator=createReaderAutoTranslation({getScope:()=>scope,step:async(input,context)=>{calls.push({input,context});return {contentVersion:'v1',chapterId:input.phase==='current'?'current':'next',phase:input.phase,done:true,passage:{id:input.phase,original:'Source',translations:{literal:{text:'Literal'},interpretive:{text:'Interpretive'}}}};},onPassage:r=>receipts.push(r),onState:s=>states.push(s),...options});
 return {coordinator,calls,receipts,states,setScope:patch=>{scope={...scope,...patch};coordinator.refresh();}};
}
test('foreground translation reader finishes current phase and only the next phase serially',async()=>{
 const f=await fixture();f.coordinator.refresh();await tick();assert.deepEqual(f.calls.map(c=>c.input.phase),['current','next']);assert.equal(f.calls[0].input.chapterId,'current');assert.equal(f.calls[1].input.chapterId,'current');assert.equal(f.receipts.length,2);assert.equal(f.states.at(-1).status,'ready');f.coordinator.dispose();
});
test('original-only, disabled and background scopes dispatch nothing',async()=>{
 for(const patch of [{mode:'en'},{enabled:false},{visible:false},{ownerId:null},{offline:true}]){const f=await fixture();f.setScope(patch);await tick();assert.equal(f.calls.length,0);f.coordinator.dispose();}
});
test('scope changes abort in-flight work and discard stale receipts',async()=>{
 let release,context;const pending=new Promise(resolve=>{release=resolve;});
 const f=await fixture({step:async(_input,c)=>{context=c;return pending;}});f.coordinator.refresh();await tick();f.setScope({visible:false});assert.equal(context.signal.aborted,true);
 release({contentVersion:'v1',chapterId:'current',phase:'current',done:true,passage:{id:'old'}});await tick();assert.equal(f.receipts.length,0);f.coordinator.dispose();
});
test('funds/access/transient failures stop without automatic retry storms; explicit retry may resume',async()=>{
 for(const status of [402,403,409,429,503]){
  let calls=0;const f=await fixture({step:async()=>{calls++;throw Object.assign(Error('Unavailable'),{status});}});f.coordinator.refresh();await tick();f.coordinator.refresh();await tick();assert.equal(calls,1);assert.equal(f.states.at(-1).status,'failed');f.coordinator.retry();await tick();assert.equal(calls,2);f.coordinator.dispose();
 }
});
test('a malformed or non-progressing receipt terminates before an unbounded loop',async()=>{
 let calls=0;const f=await fixture({step:async()=>{calls++;return {contentVersion:'v1',chapterId:'current',phase:'current',done:false};}});f.coordinator.refresh();await tick();assert.equal(calls,1);assert.equal(f.states.at(-1).status,'failed');f.coordinator.dispose();
});
test('a rejected scope keeps its actionable failure and retry after background/foreground transitions',async()=>{
 let calls=0;const f=await fixture({step:async()=>{calls++;throw Object.assign(Error('Not enough points'),{status:402});}});f.coordinator.refresh();await tick();
 f.setScope({visible:false});f.setScope({visible:true});await tick();assert.equal(calls,1);assert.equal(f.coordinator.getState().status,'failed');assert.equal(f.coordinator.getState().error.status,402);
 f.coordinator.retry();await tick();assert.equal(calls,2);f.coordinator.dispose();
});

test('an automatic receipt preserves original source and rejects stale or changed passage identity',async()=>{
 const {mergeReadingTranslationReceipt}=await import('../app/reader-auto-translation.mjs');assert.equal(typeof mergeReadingTranslationReceipt,'function');
 const book={bookId:'book',contentVersion:'v1',sections:[{paragraphs:[{id:'p',original:'Exact source',translations:{literal:{text:'Reviewed',status:'reviewed'}}}]}]},source=book.sections[0].paragraphs[0];
 const receipt={contentVersion:'v1',passage:{id:'p',original:'Exact source',translations:{literal:{text:'AI draft',status:'draft'},interpretive:{text:'Independent draft',status:'draft'}}}};
 assert.equal(mergeReadingTranslationReceipt(book,receipt),true);assert.equal(source.original,'Exact source');assert.equal(source.translations.literal.text,'Reviewed');assert.equal(source.translations.interpretive.text,'Independent draft');
 source.translations.literal={text:'Saved draft',status:'draft'};assert.equal(mergeReadingTranslationReceipt(book,receipt),true);assert.equal(source.translations.literal.text,'Saved draft');
 assert.equal(mergeReadingTranslationReceipt(book,{...receipt,contentVersion:'old'}),false);assert.equal(mergeReadingTranslationReceipt(book,{...receipt,passage:{...receipt.passage,original:'Changed source'}}),false);
});
