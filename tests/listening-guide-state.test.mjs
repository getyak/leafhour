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
