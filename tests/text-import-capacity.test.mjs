import test from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument,digest} from '../server/document-import.mjs';
import {createBookIngestion} from '../server/book-ingestion.mjs';
import {createIngestionUpload} from '../server/ingestion-upload.mjs';
import {createUploadState} from '../app/upload-state.mjs';

test('a 24 MB text original passes selection, extraction, resumable upload and deferred ingestion',async()=>{
 const bytes=Buffer.alloc(23_964_345,32);Buffer.from('第一章 开篇\n\n合成正文。').copy(bytes);
 assert.equal(createUploadState().select({name:'synthetic.txt',size:bytes.length}),true);
 const extracted=await extractDocument({filename:'synthetic.txt',bytes});assert.match(extracted.pages[0].text,/合成正文/);
 const rows=new Map(),blobs=new Map(),store={read:async(k,d)=>structuredClone(rows.get(k)??d),mutate:async(k,d,fn)=>{const row=structuredClone(rows.get(k)??d),result=await fn(row);rows.set(k,row);return result;},putBlob:async(k,b)=>{blobs.set(k,Buffer.from(b));},blob:async k=>blobs.get(k)};
 const owner={id:'synthetic-large-text-owner'},ingestion=createBookIngestion({store,library:{}}),uploads=createIngestionUpload({store,ingestion});
 const plan=await uploads.start(owner,{filename:'synthetic.txt',bytes:bytes.length,sha256:digest(bytes)});
 for(let i=0;i<plan.count;i++)await uploads.part(owner,plan.id,{index:i,base64:bytes.subarray(i*plan.partBytes,(i+1)*plan.partBytes).toString('base64')});
 const job=await uploads.complete(owner,plan.id);assert.equal(job.kind,'document');assert.equal(job.state,'preparing');assert.equal(job.filename,'synthetic.txt');
});

test('text limit is 64 MiB while EPUB remains 20 MiB and unknown formats stay rejected',async()=>{
 const state=createUploadState();
 for(const name of ['book.TXT','book.md','book.markdown']){assert.equal(state.select({name,size:64*1024*1024}),true);assert.throws(()=>state.select({name,size:64*1024*1024+1}));}
 assert.throws(()=>state.select({name:'book.epub',size:20*1024*1024+1}));
 assert.throws(()=>state.select({name:'book.exe',size:24*1024*1024}));
 const oversized=Buffer.alloc(64*1024*1024+1,32);await assert.rejects(extractDocument({filename:'too-large.txt',bytes:oversized}),{status:413});
});
