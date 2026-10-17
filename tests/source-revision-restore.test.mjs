import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryService} from '../server/library-service.mjs';

function storage(){const values=new Map(),blobs=new Map(),queues=new Map();let fault=null;return {values,setFault:fn=>{fault=fn;},async read(k,d){return structuredClone(values.get(k)??d);},async mutate(k,d,fn){const prior=queues.get(k)||Promise.resolve(),task=prior.catch(()=>{}).then(async()=>{const row=await this.read(k,d);await fn(structuredClone(row));const out=await fn(row);if(fault)await fault(k,row);values.set(k,structuredClone(row));return structuredClone(out);});queues.set(k,task);try{return await task;}finally{if(queues.get(k)===task)queues.delete(k);}},async putBlob(k,b){blobs.set(k,Buffer.from(b));},async blob(k){return Buffer.from(blobs.get(k));},async blobInfo(k){return blobs.has(k)?{size:blobs.get(k).length}:null;}};}
const user={id:'retry-owner'};
test('a failed record publication never advertises an incomplete revision; cross-instance retry preserves later notes',async()=>{
 const store=storage(),make=()=>createLibraryService({dataDir:'revision-cas',catalogDir:null,dataStore:store}),a=await make(),b=await make(),book=await a.importDocument(user,{filename:'retry.txt',bytes:Buffer.from('Old source.\n\nUnchanged source.')}),p=book.sections[0].paragraphs[0];await a.addComment(user,book.bookId,{id:'old-note',passageId:p.id,text:'Original thought'});
 const input={baseContentVersion:book.contentVersion,operation:'correct',changes:[{passageId:p.id,before:p.original,replacement:['Corrected source.'],reason:'Compared to source',evidence:{sha256:book.source.sha256,href:'retry.txt'}}]};let failed=false;
 store.setFault((k,row)=>{if(!failed&&k.includes('/records/')&&row.sourceRevisionMigration){failed=true;throw Error('Injected durable record write failure');}});
 await assert.rejects(a.createSourceRevision(user,book.bookId,input),/Injected/);assert.equal((await b.list(user)).length,1);assert.equal((await b.records(user,book.bookId)).comments[0].text,'Original thought');
 store.setFault(null);await b.addComment(user,book.bookId,{id:'late-source-note',passageId:p.id,text:'Added while retrying'});const created=await b.createSourceRevision(user,book.bookId,input);assert.equal(created.pending,2);const revision=created.book;await b.addComment(user,revision.bookId,{id:'target-note',passageId:revision.sections[0].paragraphs[0].id,text:'New revision thought'});const before=await b.records(user,revision.bookId);
 await a.createSourceRevision(user,book.bookId,input);assert.deepEqual(await b.records(user,revision.bookId),before);assert.equal((await b.list(user)).length,2);assert.equal((await b.records(user,book.bookId)).comments.length,2);
});
