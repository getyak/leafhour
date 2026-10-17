import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {buildArrivalCatalog,renderArrivalCatalog} from '../tools/build-arrival-catalog.mjs';
import {arrivalCatalog} from '../app/arrival-catalog.mjs';
import {arrivalQuote} from '../app/reading-arrival.mjs';

test('every public structured book has a bounded excerpt from that exact source version and passage',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'arrival-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:root,translator:null});
 const manifest=JSON.parse(await readFile('catalog/manifest.json','utf8'));
 const structured=manifest.filter(row=>row.format==='structured');assert.equal(Object.keys(arrivalCatalog).length,structured.length);
 for(const entry of manifest){
  const quote=arrivalQuote(entry.id);assert.equal(quote.bookId,entry.id);assert.equal(quote.sourceUrl,entry.sourceUrl);
  const book=await library.getBook(null,entry.id),paragraph=book.sections.flatMap(section=>section.paragraphs).find(row=>row.id===quote.passageId);
  assert.ok(paragraph,entry.id);assert.equal(quote.contentVersion,book.contentVersion);
  if(entry.format==='structured'){
   assert.ok(quote.original.length<=281);assert.ok(paragraph.original.trim().startsWith(quote.original.endsWith('…')?quote.original.slice(0,-1):quote.original));
   assert.equal(quote.translation,null);assert.equal(quote.sourceLanguage,'en');
  }
 }
 for(const id of ['unknown-private','constructor','__proto__'])assert.equal(arrivalQuote(id),null);
});
test('checked-in public excerpts are deterministic and current, with no runtime data input',async()=>{
 const generated=await buildArrivalCatalog(process.cwd());assert.deepEqual(generated,arrivalCatalog);
 assert.equal(await readFile('app/arrival-catalog.mjs','utf8'),renderArrivalCatalog(generated));
});
