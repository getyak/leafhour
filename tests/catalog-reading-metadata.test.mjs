import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';

test('audited display metadata preserves the published editions, source characters and backup anchors',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'catalog-reading-audit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir});
 const e=await library.getBook(null,'gutenberg-erewhon'),poem=e.sections.flatMap(s=>s.paragraphs).find(p=>p.original.includes('He who sins aught'));
 assert.ok(poem.source.lineBreaks.length>0);
 const alice=await library.getBook(null,'gutenberg-alice');assert.match(alice.licenseNotices,/Arthur DiBianca/);assert.match(alice.licenseNotices,/FULL PROJECT GUTENBERG/);
 const walden=await library.getBook(null,'gutenberg-walden');assert.ok(walden.sections.flatMap(s=>s.paragraphs).some(p=>p.source.lineBreaks?.length));
 const meditations=await library.getBook(null,'gutenberg-meditations');assert.equal(meditations.source.translation,'Meric Casaubon');assert.match(meditations.source.scopeNote,/删去/);
 const nights=await library.getBook(null,'gutenberg-arabian-nights');assert.ok(!nights.author.includes('英译 Andrew Lang'));assert.match(nights.source.translation,/unnamed/i);
 const room=await library.getBook(null,'gutenberg-au-room-of-ones-own');assert.match(room.licenseNotices,/Col Choat/);
 for(const entry of JSON.parse(await readFile('catalog/manifest.json','utf8'))){const book=await library.getBook(null,entry.id);assert.equal(book.contentVersion,digest(await readFile('catalog/'+entry.file)));assert.match(book.source.scopeNote,/本版|收录/);}
 const backup=await library.exportLibrary({id:'isolated-audit-reader'}),target=await createLibraryService({dataDir:path.join(dir,'restored'),catalogDir:null});await target.restoreLibrary({id:'isolated-restored-reader'},backup);
 for(const row of await library.list(null))assert.deepEqual((await target.getBook({id:'isolated-restored-reader'},row.bookId)).sections,(await library.getBook(null,row.bookId)).sections);
});

test('stale or invalid source layout metadata cannot attach to another edition or quote',async()=>{
 const api=await import('../server/catalog-reading-metadata.mjs');assert.equal(typeof api.applyCatalogReadingMetadata,'function');
 const original='First line. Second line.',book={bookId:'sample',contentVersion:'v1',source:{},sections:[{paragraphs:[{id:'p1',original,source:{}}]}]};
 const valid={contentVersion:'v1',passages:{p1:{sha256:digest(original),lineBreaks:[11]}}};
 const good=structuredClone(book);api.applyCatalogReadingMetadata(good,valid);assert.deepEqual(good.sections[0].paragraphs[0].source.lineBreaks,[11]);assert.equal(good.sections[0].paragraphs[0].original,original);
 for(const patch of [{contentVersion:'other'}, {passages:{p1:{sha256:'wrong',lineBreaks:[11]}}},{passages:{unknown:{sha256:digest(original),lineBreaks:[11]}}},{passages:{p1:{sha256:digest(original),lineBreaks:[11,4]}}}])assert.throws(()=>api.applyCatalogReadingMetadata(structuredClone(book),{...valid,...patch}),/metadata/i);
});
