import test from 'node:test';import assert from 'node:assert/strict';
import {guideRequest,sceneQuestion,createGuideRunner} from '../app/listening-guide-state.mjs';
const book={bookId:'b',contentVersion:'v',sections:[{chapterId:'c',paragraphs:[{id:'p1',original:'First source.'},{id:'p2',original:'Second source.'}]}]};
const reader={getBook:()=>book,getChapterId:()=> 'c',getAnchor:()=>({passageId:'p2'}),getSelectedId:()=>null};
test('guide explanation defaults to a real current passage and explicit whole chapter changes only its scope',()=>{
 assert.deepEqual(guideRequest(reader,'explain'),{intent:'explain',contentVersion:'v',chapterId:'c',throughPassageId:'p2',scopeMode:'through'});
 assert.equal(guideRequest(reader,'explain','chapter').scopeMode,'chapter');
 assert.throws(()=>guideRequest({...reader,getAnchor:()=>({passageId:'missing'})},'explain'));
 assert.deepEqual(guideRequest(reader,'book'),{intent:'book',contentVersion:'v'});
});
test('a dismissed old selection cannot widen or move the current explanation scope',()=>{
 const selected={...reader,getSelectedId:()=> 'p1',isSelectionActive:()=>false};
 assert.equal(guideRequest(selected,'explain').throughPassageId,'p2');
 assert.equal(guideRequest({...selected,isSelectionActive:()=>true},'explain').throughPassageId,'p1');
});
test('ask-here draft contains bounded actual scene sources and keeps their source identity',()=>{
 const scene={turns:[{speaker:'guide',text:'An explanation.',sourceRefs:[{passageId:'p1',quote:'First'}]},{speaker:'questioner',text:'A question?',sourceRefs:[{passageId:'p2',quote:'Second'}]}]};
 const result=sceneQuestion({book,clip:scene});assert.deepEqual(result.passageIds,['p1','p2']);assert.match(result.draft,/An explanation/);assert.match(result.draft,/First/);assert.ok(result.draft.length<=2000);
 assert.equal(sceneQuestion({book,clip:{text:'Unreferenced'}}),null);
 assert.equal(sceneQuestion({book,clip:{sourceRefs:[{passageId:'missing',quote:'Fake'}]}}),null);
});
test('cancelled guide polling cannot start stale audio or schedule more work',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),ready=[],calls=[];
 const runner=createGuideRunner({request:async(action)=>{calls.push(action);if(action==='guides')return pending;return{};},onReady:value=>ready.push(value)});
 const run=runner.start({idempotencyKey:'one'});await runner.cancel();resolve({id:'j',status:'ready',sessionId:'s'});await run;
 assert.equal(ready.length,0);assert.ok(calls.includes('guides/j/cancel'));
});
test('guide text job is polled without submitting another generation and failure remains actionable',async()=>{
 const ready=[],progress=[],calls=[];let tick;const runner=createGuideRunner({request:async(action)=>{calls.push(action);return action==='guides'?{id:'j',status:'preparing'}:{id:'j',status:'ready',sessionId:'s'};},onReady:v=>ready.push(v),onProgress:v=>progress.push(v),setTimer:fn=>{tick=fn;return 1;},clearTimer(){}});
 await runner.start({idempotencyKey:'one'});await tick();assert.deepEqual(calls,['guides','guides/j']);assert.equal(ready[0].sessionId,'s');assert.equal(progress.length,2);
});
test('restoring a guide only retrieves its saved job without another generation request',async()=>{
 const calls=[],ready=[];const runner=createGuideRunner({request:async action=>{calls.push(action);return{id:'existing',status:'ready',sessionId:'saved-audio'};},onReady:value=>ready.push(value)});
 await runner.resume('existing');assert.deepEqual(calls,['guides/existing']);assert.equal(ready[0].sessionId,'saved-audio');
});
test('a terminal guide error identifies an explicit retry while a network error keeps its saved job recoverable',async()=>{
 const errors=[];let fail=true;const runner=createGuideRunner({request:async()=>{if(fail)throw Error('Network unavailable');return{id:'existing',status:'interrupted',error:{message:'Request interrupted'}};},onError:error=>errors.push(error)});
 await runner.resume('existing');assert.equal(errors[0].guideStatus,undefined);fail=false;await runner.resume('existing');assert.equal(errors[1].guideStatus,'interrupted');
});
test('an uncertain POST retries the same idempotency key and can be cancelled before a job ID arrives',async()=>{
 const calls=[];let first=true;const runner=createGuideRunner({request:async(action,input)=>{calls.push({action,input});if(action==='guides'&&first){first=false;throw Error('Lost response');}return{id:'job',status:'ready',sessionId:'audio'};}});
 await runner.start({idempotencyKey:'original'});await runner.retry();assert.equal(calls[1].input.idempotencyKey,'original');
 const other=[];const cancelled=createGuideRunner({request:async(action,input)=>{other.push({action,input});if(action==='guides')throw Error('Lost response');return{};}});await cancelled.start({idempotencyKey:'original'});await cancelled.cancel();assert.equal(other.at(-1).action,'guides/requests/original/cancel');
});
test('stopping an already delivered guide does not cancel its saved reusable audio history',async()=>{
 const calls=[];const runner=createGuideRunner({request:async action=>{calls.push(action);return{id:'done',status:'ready',sessionId:'audio'};}});await runner.start({idempotencyKey:'done'});await runner.cancel();assert.deepEqual(calls,['guides']);
});
test('a slow older cancellation cannot erase the next uncertain request identity',async()=>{
 const calls=[];let release;const pending=new Promise(r=>release=r),runner=createGuideRunner({request:async(action,input)=>{calls.push({action,input});if(action.endsWith('/cancel'))return pending;if(action==='guides')throw Error('Lost response');}});
 await runner.start({idempotencyKey:'old'});const cancelled=runner.cancel();await runner.start({idempotencyKey:'new'});release({});await cancelled;await runner.retry();assert.equal(calls.filter(c=>c.action==='guides'&&c.input.idempotencyKey==='new').length,2);
});
test('unloaded chapter identities cannot be mistaken for verified audio source text',()=>{
 const partial={...book,sections:[{chapterId:'c',paragraphs:[{id:'p1',unloaded:true},{id:'p2',original:'Second source.'}]}]};assert.equal(sceneQuestion({book:partial,clip:{passageId:'p1',text:'Kept audio'}}),null);const question=sceneQuestion({book:partial,clip:{sourceRefs:[{passageId:'p1',quote:'First'},{passageId:'p2',quote:'Second'}]}});assert.deepEqual(question.passageIds,['p2']);
});
