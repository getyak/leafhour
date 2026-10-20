import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookUploadController} from '../app/book-upload-controller.mjs';
const file={name:'book.pdf',size:100};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(options={}){let owner='a';const calls=[],controller=createBookUploadController({getOwner:()=>owner,getSession:()=>({user:{id:owner}}),api:async(path,body)=>{calls.push({path,body});return {jobs:[]};},pollMs:100000,...options});return {controller,calls,setOwner:value=>{owner=value;controller.syncOwner();}};}
test('first-book upload immediately creates one task, deduplicates a busy file and updates that task in place',async t=>{
 const pending=deferred();let progress;const {controller}=setup({uploadPdf:async options=>{progress=options.onProgress;return pending.promise;}});t.after(()=>controller.dispose());const id=controller.start(file);assert.equal(controller.start(file),id);assert.equal(controller.tasks().length,1);assert.equal(controller.tasks()[0].stage,'receiving');progress({id:'pdf.upload.saved',params:{percent:45}});assert.equal(controller.tasks()[0].percent,45);pending.resolve({id:'job',state:'done',bookId:'book'});await flush();assert.equal(controller.tasks()[0].id,id);assert.equal(controller.tasks()[0].stage,'ready');assert.equal(controller.tasks()[0].bookId,'book');
});
test('owner switch fences old upload progress and completion and clears private task names',async t=>{
 const pending=deferred();let progress;const {controller,setOwner}=setup({uploadPdf:async o=>{progress=o.onProgress;return pending.promise;}});t.after(()=>controller.dispose());controller.start(file);setOwner('b');progress({params:{percent:80}});pending.resolve({id:'secret',state:'done',bookId:'private'});await flush();assert.deepEqual(controller.tasks(),[]);
});
test('cancel during upload ignores late progress and cancels a late committed job without publishing ready',async t=>{
 const pending=deferred();const {controller,calls}=setup({uploadPdf:()=>pending.promise});t.after(()=>controller.dispose());const id=controller.start(file);await controller.cancel(id);pending.resolve({id:'job',state:'running'});await flush();assert.equal(controller.tasks()[0].stage,'cancelled');assert.ok(calls.some(c=>c.path==='/api/library/ingestion/job/cancel'));
});
test('recognition is never sent until explicit source-bound consent',async t=>{
 const {controller,calls}=setup({uploadPdf:async()=>({id:'job',sourceHash:'hash',state:'awaiting_consent',ocrAvailable:true,totalPages:99,recognitionPages:12})});t.after(()=>controller.dispose());const id=controller.start(file);await flush();assert.equal(controller.tasks()[0].stage,'permission');assert.equal(calls.length,0);await controller.act(id,'consent');assert.deepEqual(calls[0],{path:'/api/library/ingestion/job/consent',body:{confirm:true,sourceHash:'hash'}});
});
test('a failed transfer retries the same task and a committed job resumes without another transfer',async t=>{
 let attempts=0;const {controller,calls}=setup({uploadPdf:async()=>{if(++attempts===1)throw Error('network');return {id:'job',state:'failed'};}});t.after(()=>controller.dispose());const id=controller.start(file);await flush();assert.equal(controller.tasks()[0].stage,'interrupted');await controller.retry(id);await flush();assert.equal(controller.tasks().length,1);await controller.retry(id);assert.equal(attempts,2);assert.ok(calls.some(c=>c.path.endsWith('/job/resume')));
});
test('refresh restores private PDF jobs without generating messages or duplicate cards',async t=>{
 const {controller}=setup({api:async()=>({jobs:[{id:'job',filename:'restored.pdf',state:'running'}]})});t.after(()=>controller.dispose());await controller.refresh();await controller.refresh();assert.equal(controller.tasks().length,1);assert.equal(controller.tasks()[0].filename,'restored.pdf');assert.equal(controller.tasks()[0].stage,'organizing');
});
test('text uploads use existing API, and disposal prevents follow-up writes',async()=>{
 const pending=deferred(),{controller,calls}=setup({readBase64:()=>pending.promise});controller.start({name:'notes.md',size:8});controller.dispose();pending.resolve('Zm9v');await flush();assert.equal(calls.length,0);
});
test('a cancelled PDF still cancels a job returned by a delayed start response before adapter assertion',async t=>{
 const pending=deferred(),calls=[];const {controller}=setup({api:async(path,body)=>{calls.push({path,body});if(path.endsWith('/start'))return pending.promise;return {state:'cancelled'};},uploadPdf:async({api,assertCurrent})=>{const result=await api('/api/library/pdf-upload/start',{});assertCurrent();return result.job;}});t.after(()=>controller.dispose());const id=controller.start(file);await controller.cancel(id);pending.resolve({job:{id:'late',state:'running'}});await flush();assert.ok(calls.some(c=>c.path==='/api/library/ingestion/late/cancel'));assert.equal(controller.tasks()[0].stage,'cancelled');
});
test('a progress read begun before explicit consent cannot replace its newer action result',async t=>{
 const snapshot=deferred();const {controller}=setup({uploadPdf:async()=>({id:'j',state:'awaiting_consent',sourceHash:'h',ocrAvailable:true}),api:async(path)=>path.endsWith('/consent')?{id:'j',state:'running'}:snapshot.promise});t.after(()=>controller.dispose());const id=controller.start(file);await flush();const read=controller.refresh();await controller.act(id,'consent');snapshot.resolve({jobs:[{id:'j',state:'awaiting_consent',sourceHash:'h',ocrAvailable:true}]});await read;assert.equal(controller.tasks()[0].stage,'organizing');
});
test('a ready imported book survives a delayed organizing snapshot',async t=>{
 const snapshot=deferred();const {controller}=setup({uploadPdf:async()=>({id:'j',state:'running'}),api:async path=>path.endsWith('/resume')?{id:'j',state:'done',bookId:'book'}:snapshot.promise});t.after(()=>controller.dispose());const id=controller.start(file);await flush();const read=controller.refresh();await controller.act(id,'resume');snapshot.resolve({jobs:[{id:'j',state:'running'}]});await read;assert.equal(controller.tasks()[0].stage,'ready');
});
test('text import completes once through the byte-compatible endpoint without a model request',async t=>{
 const {controller,calls}=setup({readBase64:async()=> 'Ym9vaw==',api:async(path,body)=>{calls.push({path,body});return {bookId:'text'};}});t.after(()=>controller.dispose());controller.start({name:'book.txt',size:4});await flush();assert.equal(controller.tasks()[0].stage,'ready');assert.deepEqual(calls,[{path:'/api/library/upload',body:{filename:'book.txt',base64:'Ym9vaw=='}}]);
});

test('a poll started during cancellation cannot undo its receipt or revive a cancelled task on later reads',async t=>{
 const action=deferred(),snapshot=deferred();const {controller}=setup({uploadPdf:async()=>({id:'j',state:'running'}),api:async path=>path.endsWith('/cancel')?action.promise:snapshot.promise});t.after(()=>controller.dispose());const id=controller.start(file);await flush();const cancelling=controller.cancel(id);assert.equal(controller.tasks()[0].busy,true);const read=controller.refresh();action.resolve({id:'j',state:'cancelled'});await cancelling;assert.equal(controller.tasks()[0].stage,'cancelled');snapshot.resolve({jobs:[{id:'j',state:'running'}]});await read;assert.equal(controller.tasks()[0].stage,'cancelled');await controller.refresh();assert.equal(controller.tasks()[0].stage,'cancelled');
});
for(const operation of [{action:'consent',prior:'awaiting_consent'},{action:'resume',prior:'failed'}])test('a poll started during '+operation.action+' cannot restore the preceding '+operation.prior+' state after the action settles',async t=>{
 const action=deferred(),snapshot=deferred();const {controller}=setup({uploadPdf:async()=>({id:'j',state:operation.prior,sourceHash:'h',ocrAvailable:true}),api:async path=>path.endsWith('/'+operation.action)?action.promise:snapshot.promise});t.after(()=>controller.dispose());const id=controller.start(file);await flush();const acting=controller.act(id,operation.action);assert.equal(controller.tasks()[0].busy,true);const read=controller.refresh();action.resolve({id:'j',state:'running'});await acting;snapshot.resolve({jobs:[{id:'j',state:operation.prior,sourceHash:'h',ocrAvailable:true}]});await read;assert.equal(controller.tasks()[0].stage,'organizing');assert.equal(controller.tasks()[0].busy,false);assert.equal(controller.tasks()[0].error,false);
});
test('a poll started during a failing consent action cannot erase the action error',async t=>{
 const action=deferred(),snapshot=deferred();const {controller}=setup({uploadPdf:async()=>({id:'j',state:'awaiting_consent',sourceHash:'h',ocrAvailable:true}),api:async path=>path.endsWith('/consent')?action.promise:snapshot.promise});t.after(()=>controller.dispose());const id=controller.start(file);await flush();const consenting=controller.act(id,'consent'),read=controller.refresh();action.resolve(Promise.reject(Error('offline')));await consenting;assert.equal(controller.tasks()[0].error,true);snapshot.resolve({jobs:[{id:'j',state:'awaiting_consent',sourceHash:'h',ocrAvailable:true}]});await read;assert.equal(controller.tasks()[0].error,true);assert.equal(controller.tasks()[0].stage,'permission');assert.equal(controller.tasks()[0].busy,false);
});
