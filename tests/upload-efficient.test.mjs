import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {digest} from '../server/document-import.mjs';
import {createBookIngestion} from '../server/book-ingestion.mjs';
import {createIngestionUpload} from '../server/ingestion-upload.mjs';
import {uploadPdf} from '../app/pdf-ingestion.mjs';
function memory(){const rows=new Map(),blobs=new Map();return {rows,blobs,read:async(k,d)=>structuredClone(rows.get(k)??d),mutate:async(k,d,fn)=>{const r=structuredClone(rows.get(k)??d),v=await fn(r);rows.set(k,r);return v;},putBlob:async(k,b)=>blobs.set(k,Buffer.from(b)),blob:async k=>{if(!blobs.has(k))throw Object.assign(Error('missing'),{status:404});return Buffer.from(blobs.get(k));}};}
const owner={id:'upload-owner'};
async function pdf(count){const doc=await PDFDocument.create();for(let n=0;n<count;n++)doc.addPage();return Buffer.from(await doc.save());}
test('signed targets are owner-scoped and remain missing until byte/hash commit succeeds',async()=>{
 const store=memory();store.signedUpload=async target=>({url:'https://storage.example/'+target,method:'PUT',headers:{}});const bytes=await pdf(1),uploads=createIngestionUpload({store,ingestion:{prepare:async()=>({id:'job'})}}),input={filename:'signed.pdf',bytes:bytes.length,sha256:digest(bytes),mode:'auto'};
 const start=await uploads.start(owner,input);assert.equal(start.transport,'signed');
 await assert.rejects(uploads.target({id:'other'},start.id,{index:0,sha256:digest(bytes)}),{status:404});
 const target=await uploads.target(owner,start.id,{index:0,sha256:digest(bytes)});assert.equal(target.method,'PUT');
 assert.deepEqual((await uploads.start(owner,input)).received,[]);await assert.rejects(uploads.complete(owner,start.id),{status:422});
 await assert.rejects(uploads.commit(owner,start.id,{index:0,sha256:digest(bytes)}));
 const key=target.url.slice('https://storage.example/'.length);await store.putBlob(key,Buffer.alloc(bytes.length));await assert.rejects(uploads.commit(owner,start.id,{index:0,sha256:digest(bytes)}),{status:422});
 await store.putBlob(key,bytes);await uploads.commit(owner,start.id,{index:0,sha256:digest(bytes)});assert.deepEqual((await uploads.start(owner,input)).received,[0]);assert.equal((await uploads.complete(owner,start.id)).id,'job');
});
test('browser signed upload sends binary only to storage and resumes committed parts',async()=>{
 const file=new File([await pdf(1)],'signed.pdf'),calls=[],originalFetch=globalThis.fetch;let binary;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://storage.example/signed');binary=options.body;return new Response('{}');};
 try{const result=await uploadPdf({file,api:async(route,body)=>{calls.push({route,body});if(route.endsWith('/start'))return {id:'upload',transport:'signed',partBytes:file.size,count:1,received:[]};if(route.endsWith('/target'))return {url:'https://storage.example/signed',method:'PUT',headers:{}};if(route.endsWith('/commit'))return {accepted:true};if(route.endsWith('/complete'))return {id:'job'};throw Error('unexpected');}});assert.equal(result.id,'job');assert.equal(binary.size,file.size);assert.ok(calls.some(c=>c.route.endsWith('/commit')));assert.ok(calls.every(c=>!('base64' in c.body)));}finally{globalThis.fetch=originalFetch;}
});
test('all batches are inspected before consent and only recognition pages reserve quota once',async()=>{
 const store=memory(),bytes=await pdf(5);let inspected=0,submitted=0;
 const svc=createBookIngestion({store,batchPages:2,now:()=>1000,provider:{submit:async()=>{submitted++;throw Error('stop');}},library:{},nativeInspector:async(b,{start})=>{const count=(await PDFDocument.load(b)).getPageCount();inspected+=count;return {pages:Array.from({length:count},(_,n)=>({text:start+n===2||start+n===5?'':'Native source',needsRecognition:start+n===2||start+n===5}))};}});
 let j=await svc.prepare(owner,{filename:'mixed.pdf',bytes,mode:'auto'});for(let n=0;n<10&&j.state!=='awaiting_consent';n++)j=await svc.advance(owner,j.id);
 assert.equal(inspected,5);assert.equal(j.recognitionPages,2);assert.equal(submitted,0);
 await Promise.all([svc.consent(owner,j.id,{confirm:true,sourceHash:j.sourceHash}),svc.consent(owner,j.id,{confirm:true,sourceHash:j.sourceHash})]);
 const budget=store.rows.get('ingestion-budget/1970-01-01');assert.equal(budget.pages,2);assert.equal(budget.owners[digest(owner.id)],2);
});
test('publication passes an opaque verified original without another original read',async()=>{
 const store=memory(),bytes=await pdf(1);let input,sourceReads=0;const originalBlob=store.blob;store.blob=async k=>{if(k.endsWith('/source'))sourceReads++;return originalBlob(k);};
 const svc=createBookIngestion({store,library:{importExtracted:async(_u,i)=>{input=i;return {bookId:'book'};}},provider:null,nativeInspector:async()=>({pages:[{text:'A complete native paragraph.',needsRecognition:false}]})});let j=await svc.prepare(owner,{filename:'native.pdf',bytes,mode:'auto'});for(let n=0;n<8&&j.state!=='done';n++)j=await svc.advance(owner,j.id);
 assert.equal(j.state,'done');assert.equal(input.bytes,undefined);assert.ok(input.verifiedSource);assert.equal(sourceReads,1);
 const {resolveVerifiedSource}=await import('../server/verified-source.mjs');assert.equal(resolveVerifiedSource(owner,input.verifiedSource).sha256,digest(bytes));assert.throws(()=>resolveVerifiedSource({id:'other'},input.verifiedSource),{status:403});assert.throws(()=>resolveVerifiedSource(owner,{sha256:digest(bytes),target:'another-owner/source'}),{status:403});
});
test('legacy verified source publication obtains trusted stored layout when the job predates sourceParts',async()=>{
 const store=memory(),bytes=await pdf(1);let adopted;
 store.blobReferences=async(target,expected)=>{assert.ok(target.endsWith('/source'));assert.equal(expected.sha256,digest(bytes));return [{target,size:bytes.length,sha256:digest(bytes)}];};store.adoptBlob=async(target,parts,expected)=>{adopted={target,parts,expected};};
 const svc=createBookIngestion({store,library:{importExtracted:async(u,input)=>{const {resolveVerifiedSource}=await import('../server/verified-source.mjs');await resolveVerifiedSource(u,input.verifiedSource).adopt('library/original',store);return {bookId:'book'};}},provider:null,nativeInspector:async()=>({pages:[{text:'A source paragraph.',needsRecognition:false}]})});let j=await svc.prepare(owner,{filename:'legacy.pdf',bytes,mode:'auto'});const raw=store.rows.get('ingestion/'+digest(owner.id)+'/'+j.id);delete raw.sourceParts;delete raw.sourceBytes;
 for(let n=0;n<8&&j.state!=='done';n++)j=await svc.advance(owner,j.id);assert.equal(j.state,'done');assert.equal(adopted.expected.sha256,digest(bytes));assert.equal(adopted.parts.length,1);
});
test('hosted commit checks object size and completion alone verifies bytes, clearing a corrupt receipt for retry',async()=>{
 const store=memory(),bytes=await pdf(1);let reads=0;const read=store.blob;store.blob=async target=>{reads++;return read(target);};store.blobInfo=async target=>store.blobs.has(target)?{size:store.blobs.get(target).length}:null;store.signedUpload=async target=>({url:target,method:'PUT'});const uploads=createIngestionUpload({store,ingestion:{prepare:async()=>({id:'job'})}}),input={filename:'binary.pdf',bytes:bytes.length,sha256:digest(bytes),mode:'auto'},start=await uploads.start(owner,input),target=await uploads.target(owner,start.id,{index:0,sha256:digest(bytes)});
 await store.putBlob(target.url,Buffer.alloc(bytes.length));await uploads.commit(owner,start.id,{index:0,sha256:digest(bytes)});assert.equal(reads,0);await assert.rejects(uploads.complete(owner,start.id),{status:422});assert.deepEqual((await uploads.start(owner,input)).received,[]);
 const retry=await uploads.target(owner,start.id,{index:0,sha256:digest(bytes)});await store.putBlob(retry.url,bytes);await uploads.commit(owner,start.id,{index:0,sha256:digest(bytes)});assert.equal((await uploads.complete(owner,start.id)).id,'job');assert.equal(reads,2);
});
test('signed uploads keep at most two binary transfers active and report committed progress',async()=>{
 const file=new File([await pdf(1)],'parallel.pdf'),original=globalThis.fetch;let active=0,peak=0,release,two,commits=0;const gate=new Promise(r=>release=r),both=new Promise(r=>two=r),progress=[];
 globalThis.fetch=async()=>{active++;peak=Math.max(peak,active);if(active===2)two();await gate;active--;return new Response('{}');};
 try{const pending=uploadPdf({file,onProgress:value=>progress.push(value),api:async(route,input)=>route.endsWith('/start')?{id:'id',transport:'signed',count:2,partBytes:Math.ceil(file.size/2)}:route.endsWith('/target')?{url:'https://storage.example/'+input.index}:route.endsWith('/commit')?(commits++,{accepted:true}):{id:'job'}});await Promise.race([both,new Promise(r=>setTimeout(r,200))]);const observed=peak;release();await pending;assert.equal(observed,2);assert.equal(peak,2);assert.equal(commits,2);assert.deepEqual(progress.filter(p=>p.id==='pdf.upload.saved').map(p=>p.params.percent),[50,100]);}finally{release();globalThis.fetch=original;}
});
test('owner changes during source hashing stop the upload before its first request',async()=>{
 const original=crypto.subtle.digest,file=new File([await pdf(1)],'private.pdf');let stale=false,calls=0;
 crypto.subtle.digest=async(...args)=>{const result=await original.apply(crypto.subtle,args);stale=true;return result;};
 try{await assert.rejects(uploadPdf({file,assertCurrent:()=>{if(stale)throw Error('owner changed');},api:async()=>{calls++;return {job:{id:'old'}};}}),/owner changed/);assert.equal(calls,0);}finally{crypto.subtle.digest=original;}
});
test('owner changes during completion cannot return a completed old-owner task',async()=>{
 let stale=false;await assert.rejects(uploadPdf({file:new File([await pdf(1)],'private.pdf'),assertCurrent:()=>{if(stale)throw Error('owner changed');},api:async route=>{if(route.endsWith('/start'))return {id:'upload',count:1,received:[0]};stale=true;return {id:'old-job'};}}),/owner changed/);
});
test('recognition rechecks the current daily quota after staging and before provider submission',async()=>{
 const store=memory(),bytes=await pdf(1);let time=1000,submitted=0;store.rows.set('ingestion-budget/1970-01-02',{pages:15000,owners:{},jobs:{}});store.putSingleBlob=async()=>{time=86401000;};store.signedBlob=async()=> 'https://storage.example/input';const svc=createBookIngestion({store,now:()=>time,library:{},provider:{submit:async()=>{submitted++;return {jobId:'unexpected'};}},nativeInspector:async()=>({pages:[{text:'',needsRecognition:true}]})});let job=await svc.prepare(owner,{filename:'scan.pdf',bytes,mode:'auto'});for(let n=0;n<5&&job.state!=='awaiting_consent';n++)job=await svc.advance(owner,job.id);await svc.consent(owner,job.id,{confirm:true,sourceHash:job.sourceHash});await assert.rejects(svc.advance(owner,job.id),{status:429});assert.equal(submitted,0);
});

test('a blocked signed transfer continues through bounded same-origin parts without losing the original bytes',async()=>{
 const savedFetch=globalThis.fetch,savedReader=globalThis.FileReader,file=new File(['A synthetic EPUB source'],'source.epub'),calls=[],progress=[];globalThis.fetch=async()=>{throw Error('storage connection closed');};globalThis.FileReader=class{readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:application/octet-stream;base64,'+Buffer.from(b).toString('base64');this.onload();});}};
 try{const job=await uploadPdf({file,onProgress:p=>progress.push(p),api:async(route,input)=>{calls.push({route,input});if(route.endsWith('/start')){assert.equal(input.mode,'document');return {id:'upload',transport:'signed',count:1,partBytes:file.size,received:[]};}if(route.endsWith('/target'))return {url:'https://storage.example/signed',method:'PUT'};if(route.endsWith('/part')){assert.equal(Buffer.from(input.base64,'base64').toString(),await file.text());return {accepted:true};}if(route.endsWith('/complete'))return {id:'document-job'};throw Error('unexpected commit');}});assert.equal(job.id,'document-job');assert.equal(calls.filter(c=>c.route.endsWith('/part')).length,1);assert.equal(progress.find(p=>p.id==='pdf.upload.saved').params.percent,100);}finally{globalThis.fetch=savedFetch;globalThis.FileReader=savedReader;}
});
