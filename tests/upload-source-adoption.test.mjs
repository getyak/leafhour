import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument} from 'pdf-lib';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createIngestionStorage} from '../server/ingestion-storage.mjs';
import {createBookIngestion} from '../server/book-ingestion.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';
const owner={id:'isolated-adoption-owner'},env={SUPABASE_URL:'https://storage.example',SUPABASE_SECRET_KEY:'isolated-server-secret'};
function backend(){const rows=new Map(),objects=new Map(),requests=[];return {requests,objects,fetcher:async(input,options={})=>{const u=new URL(input);requests.push({path:u.pathname,method:options.method||'GET',size:options.body?.length||0});if(u.pathname==='/rest/v1/reader_documents'){const row=rows.get(u.searchParams.get('key').slice(3));return Response.json(row?[row]:[]);}if(u.pathname==='/rest/v1/rpc/reader_document_cas'){const r=JSON.parse(options.body),old=rows.get(r.document_key);if((old?.version||0)!==r.expected_version)return Response.json(false);rows.set(r.document_key,{version:r.expected_version+1,value:r.document_value});return Response.json(true);}if(u.pathname.startsWith('/storage/v1/object/upload/sign/')){assert.equal(options.headers['x-upsert'],'false');assert.deepEqual(JSON.parse(options.body),{});return Response.json({url:u.pathname.replace('/storage/v1','')+'?token=fixture'});}if(u.pathname.startsWith('/storage/v1/object/reader-originals/')){const key=u.pathname.split('/reader-originals/')[1];if(options.method==='POST'){objects.set(key,Buffer.from(options.body));return Response.json({});}if(!objects.has(key))return new Response(null,{status:404});const bytes=objects.get(key);return new Response(options.method==='HEAD'?null:bytes,{headers:{'content-length':String(bytes.length)}});}throw Error('unexpected route '+u.pathname);}};}
async function source(){const doc=await PDFDocument.create();doc.addPage();return Buffer.from(await doc.save());}
async function finish(svc,bytes){let job=await svc.prepare(owner,{filename:'native.pdf',bytes,mode:'auto'});for(let n=0;n<8&&job.state!=='done';n++)job=await svc.advance(owner,job.id);assert.equal(job.state,'done');return job;}
const nativeInspector=async()=>({pages:[{text:'A real native source paragraph for isolated original adoption.',needsRecognition:false}]});
test('hosted publication adopts trusted part layout with zero publication source reads or source byte writes',async()=>{
 const fixture=backend(),store=createHostedStore({env,fetcher:fixture.fetcher}),bytes=await source(),library=await createLibraryService({dataDir:'isolated-hosted-adoption',catalogDir:null,dataStore:store});let publication=[];
 const svc=createBookIngestion({store,provider:null,nativeInspector,library:{importExtracted:async(...args)=>{const start=fixture.requests.length,result=await library.importExtracted(...args);publication=fixture.requests.slice(start);return result;}}});const job=await finish(svc,bytes);
 assert.equal(publication.filter(r=>r.path.startsWith('/storage/')&&r.method==='GET').length,0);assert.ok(publication.filter(r=>r.path.startsWith('/storage/')&&r.method==='POST').every(r=>r.size<bytes.length));assert.deepEqual((await library.getOriginal(owner,job.bookId)).bytes,bytes);await assert.rejects(library.getOriginal({id:'other'},job.bookId),{status:404});
});
test('local publication clones the verified original into the library and survives new service instances',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-source-adopt-'));
 try{const store=createIngestionStorage({dataDir:path.join(dir,'ingestion')}),library=await createLibraryService({dataDir:path.join(dir,'library'),catalogDir:null}),bytes=await source(),svc=createBookIngestion({store,library,provider:null,nativeInspector}),job=await finish(svc,bytes),fresh=await createLibraryService({dataDir:path.join(dir,'library'),catalogDir:null});assert.deepEqual((await fresh.getOriginal(owner,job.bookId)).bytes,bytes);}finally{await rm(dir,{recursive:true,force:true});}
});
test('hosted signed uploads bind the URL to the exact private target and prohibit upsert',async()=>{
 const fixture=backend(),store=createHostedStore({env,fetcher:fixture.fetcher}),target='pdf-upload/'+digest(owner.id)+'/server-issued-part',signed=await store.signedUpload(target);assert.equal(signed.method,'PUT');assert.equal(new URL(signed.url).pathname,'/storage/v1/object/upload/sign/reader-originals/originals/'+digest(target));assert.ok(!JSON.stringify(signed).includes(env.SUPABASE_SECRET_KEY));
 for(const url of ['https://other.example/object/upload/sign/reader-originals/a','/object/upload/sign/reader-originals/wrong-target']){const unsafe=createHostedStore({env,fetcher:async()=>Response.json({url})});await assert.rejects(unsafe.signedUpload(target),{status:503});}
});
test('concurrent recognition consent respects current shared quota and charges only actual recognition pages',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-quota-'));
 try{const store=createIngestionStorage({dataDir:dir}),day='1970-01-01',budget='ingestion-budget/'+day;await store.mutate(budget,{pages:14999,owners:{},jobs:{}},()=>{});const bytes=await source(),svc=createBookIngestion({store,now:()=>1000,provider:{},library:{},nativeInspector:async()=>({pages:[{text:'',needsRecognition:true}]})}),jobs=[];
 for(const user of [owner,{id:'other-isolated-owner'}]){let j=await svc.prepare(user,{filename:'scan.pdf',bytes,mode:'auto'});for(let n=0;n<5&&j.state!=='awaiting_consent';n++)j=await svc.advance(user,j.id);jobs.push({user,job:j});}
 const results=await Promise.allSettled(jobs.map(({user,job})=>svc.consent(user,job.id,{confirm:true,sourceHash:job.sourceHash})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,429);assert.equal((await store.read(budget,null)).pages,15000);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy hosted single-object sources retain a verifiable hash after reference adoption',async()=>{
 const fixture=backend(),store=createHostedStore({env,fetcher:fixture.fetcher}),bytes=await source(),library=await createLibraryService({dataDir:'isolated-legacy-adoption',catalogDir:null,dataStore:store}),svc=createBookIngestion({store,library,provider:null,nativeInspector}),old=await svc.prepare(owner,{filename:'native.pdf',bytes,mode:'auto'});
 await store.mutate('ingestion/'+digest(owner.id)+'/'+old.id,null,row=>{delete row.sourceParts;delete row.sourceBytes;});const job=await finish(svc,bytes);assert.deepEqual((await library.getOriginal(owner,job.bookId)).bytes,bytes);
});
