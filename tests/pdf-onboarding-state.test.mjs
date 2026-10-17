import test from 'node:test';import assert from 'node:assert/strict';
import {uploadPdf,advancePdf} from '../app/pdf-ingestion.mjs';
import {pdfJobPresentation} from '../app/pdf-onboarding-state.mjs';
test('selecting a previously imported PDF opens the existing book without uploading chunks or asking for consent',async()=>{
 const file=new File(['%PDF-synthetic'],'book.pdf'),calls=[],existing={id:'job',state:'done',bookId:'saved-book'};
 const result=await uploadPdf({file,api:async(path,body)=>{calls.push({path,body});return {job:existing,duplicate:true};},onProgress:()=>{}});
 assert.equal(result.bookId,'saved-book');assert.equal(calls.length,1);assert.equal(calls[0].body.mode,'auto');assert.equal(calls[0].body.consent,false);
});
test('client status polling never advances paid work and returns contextual consent as a normal state',async()=>{
 const values=[{id:'j',state:'running',completedPages:1,totalPages:3},{id:'j',state:'awaiting_consent',completedPages:1,totalPages:3}],calls=[];
 const job=await advancePdf({id:'j',api:async(path,body)=>{calls.push({path,body});assert.equal(body,undefined);assert.ok(!path.endsWith('/advance'));return values.shift();},onProgress:()=>{},pause:async()=>{}});
 assert.equal(job.state,'awaiting_consent');assert.equal(calls.length,2);
});
test('transient status reads recover without starting a new upload or provider submission',async()=>{
 let reads=0;const job=await advancePdf({id:'j',api:async(path,body)=>{assert.equal(body,undefined);reads++;if(reads<3)throw Error('network');return {id:'j',state:'done',bookId:'b'};},onProgress:()=>{},pause:async()=>{}});
 assert.equal(job.bookId,'b');assert.equal(reads,3);
});
test('only actual decisions appear as actions and incomplete content is never labelled complete',()=>{
 const base={filename:'book.pdf',totalPages:779,completedPages:30,recognitionPages:30,ocrAvailable:true};
 const waiting=pdfJobPresentation({...base,state:'awaiting_consent'});assert.ok(waiting.actions.includes('consent'));assert.ok(!waiting.actions.includes('resume'));assert.match(waiting.status,/30.*779/);
 const working=pdfJobPresentation({...base,state:'running'});assert.ok(!working.actions.includes('resume'));assert.ok(working.actions.includes('preview'));assert.ok(!working.actions.includes('open'));
 const uncertain=pdfJobPresentation({...base,state:'needs_review'});assert.ok(uncertain.actions.includes('reconcile'));assert.ok(!uncertain.actions.includes('consent'));
 const done=pdfJobPresentation({...base,state:'done',completedPages:779,bookId:'b'});assert.deepEqual(done.actions,['open']);
});
test('a completed import remains discoverable after closing the tab until opened, scoped to its account',async()=>{
 const {createPdfJobMemory,showPdfJob}=await import('../app/pdf-onboarding-state.mjs'),values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},id='11111111-1111-4111-8111-111111111111',now=Date.now(),first=createPdfJobMemory({storage,now:()=>now});
 first.watch('owner-a',id);const restored=createPdfJobMemory({storage,now:()=>now+1000}),old={id,state:'done',createdAt:new Date(now-2*3600000).toISOString()};
 assert.equal(showPdfJob(old,{memory:restored,owner:'owner-a',now:now+1000}),true);assert.equal(showPdfJob(old,{memory:restored,owner:'owner-b',now:now+1000}),false);
 restored.opened('owner-a',id);assert.equal(showPdfJob(old,{memory:restored,owner:'owner-a',now:now+1000}),false);
 const recent={...old,createdAt:new Date(now-60000).toISOString()};assert.equal(showPdfJob(recent,{memory:restored,owner:'owner-b',now}),true);assert.equal(showPdfJob(recent,{memory:restored,owner:'owner-a',now}),false);
});
test('import notices expire and denied local storage cannot block reading',async()=>{
 const {createPdfJobMemory}=await import('../app/pdf-onboarding-state.mjs'),values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},id='11111111-1111-4111-8111-111111111111',a=createPdfJobMemory({storage,now:()=>1000000});a.watch('owner',id);const expired=createPdfJobMemory({storage,now:()=>1000000+8*86400000});assert.deepEqual(expired.pending('owner'),[]);
 const denied=createPdfJobMemory({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});assert.doesNotThrow(()=>denied.watch('owner',id));assert.doesNotThrow(()=>denied.opened('owner',id));
});
