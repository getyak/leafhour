import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';

test('the thirty selected English editions are complete readable shared books with honest provenance',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'world-catalog-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const entries=JSON.parse(await readFile('catalog/manifest.json','utf8'));
 assert.equal(entries.length,30);
 const library=await createLibraryService({dataDir:dir,translator:()=>{throw Error('Catalog reading must not generate translations');}});
 const rows=await library.list(null);assert.equal(rows.length,30);
 for(const entry of entries){
  const book=await library.getBook(null,entry.id),paragraphs=book.sections.flatMap(s=>s.paragraphs);
  assert.equal(book.visibility,'public');assert.equal(book.sourceLanguage,'en');assert.ok(book.topics.length);
  assert.ok(book.chapters.some(c=>c.kind==='body'));assert.ok(book.readingStart?.passageId);
  assert.equal(new Set(paragraphs.map(p=>p.id)).size,paragraphs.length);
  assert.ok(paragraphs.length>40,entry.id);assert.ok(paragraphs.at(-1).original.length>0,entry.id);
  if(entry.format==='structured'){
   assert.equal(book.source.structure,'source_chapters');assert.ok(book.source.license);assert.ok(book.source.downloadSha256);
   assert.equal(book.source.translation,entry.translation||null);
   assert.ok(paragraphs.every(p=>Object.keys(p.translations).length===0));
   assert.ok(paragraphs.every(p=>!p.original.includes('START OF THE PROJECT GUTENBERG EBOOK')&&!p.original.includes('END OF THE PROJECT GUTENBERG EBOOK')));
   assert.equal(book.chapters.filter(c=>c.kind==='body').length,entry.bodyChapters,entry.id);
   for(const sentence of [entry.opening,entry.ending])assert.ok(paragraphs.some(p=>p.original.includes(sentence)),entry.id+': '+sentence);
  }
 }
 const quixote=await library.getBook(null,'gutenberg-don-quixote');assert.equal(quixote.chapters.filter(c=>c.kind==='body').length,126);assert.ok(quixote.chapters.some(c=>c.kind==='frontmatter'&&c.title.en.includes('DEDICATION OF VOLUME II')));const volOneLast=quixote.chapters.find(c=>c.title.en.startsWith('Volume I · CHAPTER LII.'));assert.ok(!quixote.sections.find(s=>s.chapterId===volOneLast.id).paragraphs.some(p=>p.original==='Volume II'));
 const counts={'gutenberg-flatland':22,'gutenberg-frankenstein':28,'gutenberg-on-liberty':5,'gutenberg-home-and-world':12,'gutenberg-book-of-tea':7,'gutenberg-prophet':28,'gutenberg-tao-te-ching':81,'gutenberg-dhammapada':26,'gutenberg-bhagavad-gita':18,'gutenberg-pride-prejudice':61,'gutenberg-candide':30,'gutenberg-equiano':12,'gutenberg-seacole':20};
 for(const [id,count] of Object.entries(counts)){const book=await library.getBook(null,id);assert.equal(book.chapters.filter(c=>c.kind==='body').length,count,id);}
 const dhamma=await library.getBook(null,'gutenberg-dhammapada'),verses=new Set();
 for(const p of dhamma.sections.flatMap(s=>s.paragraphs)){const m=p.original.match(/^(\d+(?:,\s*\d+)*)\.\s/);if(m)for(const n of m[1].split(','))verses.add(Number(n));}
 assert.deepEqual([...verses].sort((a,b)=>a-b),Array.from({length:423},(_,i)=>i+1));
 const gita=await library.getBook(null,'gutenberg-bhagavad-gita');assert.ok(gita.sections.flatMap(s=>s.paragraphs).some(p=>p.original.startsWith('Dhritirashtra:\nRanged thus for battle')));assert.ok(gita.sections.flatMap(s=>s.paragraphs).some(p=>p.original==='[FN#1] Some repetitionary lines are here omitted.'));
 const ivan=await library.getBook(null,'ccel-ivan-ilych');assert.equal(ivan.chapters.filter(c=>c.kind==='body').length,12);
 const room=await library.getBook(null,'gutenberg-au-room-of-ones-own');assert.equal(room.chapters.filter(c=>c.kind==='body').length,6);assert.ok(room.sections.flatMap(s=>s.paragraphs).some(p=>p.original.startsWith('[* This essay is based upon two papers')));
});
