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
