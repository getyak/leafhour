import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBookIngestion} from '../server/book-ingestion.mjs';
import {zipSync,strToU8} from 'fflate';
import {createIngestionStorage} from '../server/ingestion-storage.mjs';

const user={id:'document-owner'},bytes=Buffer.from('A synthetic paragraph.');
async function setup(t,options={}){const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-document-jobs-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=createIngestionStorage({dataDir:dir}),published=[];const ingestion=createBookIngestion({store,provider:null,library:{importExtracted:async(u,input)=>{published.push({u,input});return {bookId:'private-book',title:{en:'Synthetic book'}};}},...options});return {ingestion,published,store};}
test('document upload returns a durable small job before parsing and becomes ready through the existing runner interface',async t=>{
 const {ingestion,published}=await setup(t);const job=await ingestion.prepareDocument(user,{filename:'notes.txt',bytes});assert.equal(job.state,'preparing');assert.equal(published.length,0);assert.equal(JSON.stringify(job).includes('synthetic paragraph'),false);assert.equal((await ingestion.list(user))[0].id,job.id);const done=await ingestion.advance(user,job.id);assert.equal(done.state,'done');assert.equal(done.bookId,'private-book');assert.equal(published.length,1);assert.equal(published[0].input.extracted.pages[0].text,bytes.toString());
});
test('cancelled documents never publish, other owners cannot inspect them, duplicate source reuses a task',async t=>{
 const {ingestion,published}=await setup(t);const job=await ingestion.prepareDocument(user,{filename:'notes.txt',bytes});assert.equal((await ingestion.prepareDocument(user,{filename:'again.txt',bytes})).id,job.id);await assert.rejects(ingestion.view({id:'other'},job.id),{status:404});await ingestion.cancel(user,job.id);assert.equal((await ingestion.advance(user,job.id)).state,'cancelled');assert.equal(published.length,0);
});
test('document parse errors retain a specific safe reason after refresh and can retry without transferring again',async t=>{
 const {ingestion,published}=await setup(t);const job=await ingestion.prepareDocument(user,{filename:'broken.epub',bytes:Buffer.from('not a zip')});const failed=await ingestion.advance(user,job.id);assert.equal(failed.state,'failed');assert.match(failed.error,/EPUB|ZIP/);assert.equal((await ingestion.list(user))[0].error,failed.error);assert.equal((await ingestion.resume(user,job.id)).state,'preparing');assert.equal(published.length,0);
});
test('concurrent retries after cancellation create only one replacement job',async t=>{
 const {ingestion}=await setup(t);const original=await ingestion.prepareDocument(user,{filename:'notes.txt',bytes});await ingestion.cancel(user,original.id);
 const results=await Promise.allSettled([ingestion.prepareDocument(user,{filename:'notes.txt',bytes}),ingestion.prepareDocument(user,{filename:'notes.txt',bytes})]);
 const jobs=(await ingestion.list(user)).filter(j=>j.state!=='cancelled');assert.equal(jobs.length,1);assert.equal(new Set(results.filter(r=>r.status==='fulfilled').map(r=>r.value.id)).size,1);
});
test('a transient error after a library commit stays publishing and reconciles instead of permitting cancellation',async t=>{
 let commits=0;const {ingestion}=await setup(t,{library:{importExtracted:async()=>{if(++commits===1)throw Object.assign(Error('temporary chapter store failure'),{status:503});return {bookId:'saved-book',title:{en:'Saved'}};}}});
 const job=await ingestion.prepareDocument(user,{filename:'notes.txt',bytes}),uncertain=await ingestion.advance(user,job.id);assert.equal(uncertain.state,'publishing');await assert.rejects(ingestion.cancel(user,job.id),{status:409});assert.equal((await ingestion.advance(user,job.id)).state,'done');
});

test('reconciling an EPUB publication never downgrades to a cancellable parsing state',async t=>{
 const archive=Buffer.from(zipSync(Object.fromEntries(Object.entries({'mimetype':'application/epub+zip','META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>','package.opf':'<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>','one.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>A synthetic paragraph.</p></body></html>'}).map(([k,v])=>[k,strToU8(v)])),{level:0}));
 let attempts=0;const {ingestion,store}=await setup(t,{library:{importExtracted:async()=>{if(++attempts===1)throw Object.assign(Error('unknown commit result'),{status:503});return {bookId:'saved',title:{en:'Saved'}};}}}),job=await ingestion.prepareDocument(user,{filename:'recover.epub',bytes:archive});assert.equal((await ingestion.advance(user,job.id)).state,'publishing');
 const states=[],mutate=store.mutate;store.mutate=(k,d,fn)=>mutate(k,d,async row=>{const result=await fn(row);if(row?.kind==='document')states.push(row.state);return result;});assert.equal((await ingestion.advance(user,job.id)).state,'done');assert.equal(states.includes('running'),false);
});
