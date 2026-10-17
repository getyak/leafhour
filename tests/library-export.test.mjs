import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {exportLibraryInParts} from '../app/library-export.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function source(){const book=structuredClone(readingBook);for(const p of book.sections.flatMap(s=>s.paragraphs))p.original='原'.repeat(100000);return {book,records:readingRecords()};}
function endpoint(entry,onPart=()=>{}){let requests=0;return {get requests(){return requests;},async api(url){if(url==='/api/library/export/manifest')return {kind:'marginalia-export-manifest',schemaVersion:1,exportedAt:'2026-10-14T12:00:00.000Z',books:[{bookId:entry.book.bookId,contentVersion:entry.book.contentVersion}]};const u=new URL(url,'https://fixture.invalid'),offset=Number(u.searchParams.get('offset')),bytes=Buffer.from(JSON.stringify(entry)),snapshot=sha(bytes);requests++;if(offset&&u.searchParams.get('snapshot')!==snapshot)throw Object.assign(Error('changed'),{status:409});const next=Math.min(bytes.length,offset+1048576),part={kind:'marginalia-book-export-part',schemaVersion:1,bookId:entry.book.bookId,contentVersion:entry.book.contentVersion,offset,totalBytes:bytes.length,nextOffset:next<bytes.length?next:null,snapshot,data:bytes.subarray(offset,next).toString('base64')};await onPart(part,requests);return part;}};}
test('bounded parts restore full Unicode without decoding individual split codepoints',async()=>{const entry=source(),server=endpoint(entry),out=await exportLibraryInParts({api:server.api});assert.deepEqual(out.books,[entry]);assert.ok(server.requests>1);});
test('an intervening write restarts only this book instead of mixing incompatible snapshots',async()=>{const entry=source(),server=endpoint(entry,(_,n)=>{if(n===1)entry.records.comments.push({id:'new-note',origin:'user',passageId:'p1',text:'New while exporting',createdAt:'2026-10-14T12:00:00Z'});});const out=await exportLibraryInParts({api:server.api});assert.equal(out.books.length,1);assert.equal(out.books[0].records.comments.length,1);assert.equal(server.requests,4);});
test('a corrupted part, digest or invalid offset never produces a downloadable backup',async()=>{for(const corruption of ['bytes','offset','digest']){const server=endpoint(source(),part=>{if(corruption==='bytes')part.data='QQ==';else if(corruption==='digest')part.data='A'+part.data.slice(1);else part.offset++;});await assert.rejects(exportLibraryInParts({api:server.api}),/备份|分段|校验/);}});
test('changing owner during a request aborts without retrying an old private export',async()=>{let current=true;const server=endpoint(source(),()=>{current=false;}),assertCurrent=()=>{if(!current)throw Error('账户已切换');};await assert.rejects(exportLibraryInParts({api:server.api,assertCurrent}),/账户已切换/);assert.equal(server.requests,1);});
test('a book that keeps changing has a finite retry budget and no partial success',async()=>{const server=endpoint(source()),api=async url=>{if(url.includes('offset=1048576'))throw Object.assign(Error('changed'),{status:409});return server.api(url);};await assert.rejects(exportLibraryInParts({api}),/更新|重试/);assert.equal(server.requests,3);});
test('transient manifest and later-part failures retry the same validated read without duplicating chunks',async()=>{
 const entry=source(),server=endpoint(entry),counts=new Map(),pauses=[];
 const api=async url=>{const n=(counts.get(url)||0)+1;counts.set(url,n);if(n<3&&(url.endsWith('/manifest')||url.includes('offset=1048576')))throw Object.assign(Error('temporary'),{status:503});return server.api(url);};
 const out=await exportLibraryInParts({api,pause:async ms=>pauses.push(ms)});assert.deepEqual(out.books,[entry]);assert.equal(server.requests,2);assert.deepEqual(pauses,[200,600,200,600]);
});
test('persistent transient export reads stop after three attempts without a partial backup',async()=>{
 let requests=0;await assert.rejects(exportLibraryInParts({api:async()=>{requests++;throw Object.assign(Error('temporary'),{retryable:true});},pause:async()=>{}}),/temporary/);assert.equal(requests,3);
});
test('owner or cancellation change during a read retry pause stops before requesting again',async()=>{
 let current=true,requests=0;await assert.rejects(exportLibraryInParts({api:async()=>{requests++;throw Object.assign(Error('temporary'),{status:502});},assertCurrent:()=>{if(!current)throw Error('cancelled owner');},pause:async()=>{current=false;}}),/cancelled owner/);assert.equal(requests,1);
});
test('authorization and validation read errors are not retried',async()=>{
 for(const status of [400,401,403,404]){let requests=0;await assert.rejects(exportLibraryInParts({api:async()=>{requests++;throw Object.assign(Error('denied'),{status});},pause:async()=>{}}),/denied/);assert.equal(requests,1);}
});
