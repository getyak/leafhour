import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {libraryShelf} from '../app/library-workspace.mjs';

const editions=[
 {id:'gutenberg-beyond-good-and-evil',title:'超越善恶（善恶的彼岸）',source:'4363',translator:'Helen Zimmern'},
 {id:'gutenberg-zarathustra',title:'查拉图斯特拉如是说',source:'1998',translator:'Thomas Common'}
];

test('both Nietzsche editions are shared English reading editions for anonymous and independent accounts',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nietzsche-catalog-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,translator:()=>{throw Error('Catalog access must not generate translations');}});
 const manifest=JSON.parse(await readFile('catalog/manifest.json','utf8'));
 for(const user of [null,{id:'isolated-reader-a'},{id:'isolated-reader-b'}]){
  const rows=await library.list(user);
  for(const query of ['超越善恶','善恶的彼岸'])assert.ok(libraryShelf(rows,{query}).some(row=>row.bookId==='gutenberg-beyond-good-and-evil'));
  for(const expected of editions){
   assert.ok(rows.some(row=>row.bookId===expected.id),expected.id+' is shared across accounts');
   const book=await library.getBook(user,expected.id),entry=manifest.find(row=>row.id===expected.id),paragraphs=book.sections.flatMap(s=>s.paragraphs);
   assert.equal(book.title.zh,expected.title);assert.equal(book.visibility,'public');assert.equal(book.sourceLanguage,'en');assert.equal(book.source.originalLanguage,'de');
   assert.equal(book.source.url,'https://www.gutenberg.org/ebooks/'+expected.source);assert.match(book.source.translation,new RegExp(expected.translator));
   assert.ok(paragraphs.every(p=>Object.keys(p.translations).length===0));assert.equal(book.chapters.filter(c=>c.kind==='body').length,entry.bodyChapters);
   assert.ok(paragraphs.some(p=>p.id===book.readingStart.passageId&&p.original.includes(entry.opening)));assert.ok(paragraphs.some(p=>p.original.includes(entry.ending)));
   assert.ok(book.licenseNotices.includes('PROJECT GUTENBERG'));assert.match(book.source.scopeNote,/本版|收录/);
   if(expected.source==='4363'){
    const body=new Set(book.chapters.filter(c=>c.kind==='body').map(c=>c.id));
    const numbers=book.sections.filter(s=>body.has(s.chapterId)).flatMap(s=>s.paragraphs).map(p=>p.original.match(/^(\d+)\./)?.[1]).filter(Boolean).map(Number);
    assert.deepEqual(numbers,Array.from({length:296},(_,i)=>i+1));
   }else{
    assert.ok(paragraphs.some(p=>p.original.includes('In evening’s limpid air,')&&p.original.includes('\n')),'retain the author’s songs and verse lineation');
    for(const text of ['Not the height, it is the declivity that is terrible!','Too far did I fly into the future: a horror seized upon me.','“—and only when ye have all denied me, will I return unto you.','(OR THE YE-A AND AMEN LAY.)'])assert.ok(paragraphs.some(p=>p.original.includes(text)),'retain author text styled as a heading: '+text);
    assert.ok(!paragraphs.some(p=>p.original.includes('NOTES ON “THUS SPAKE ZARATHUSTRA” BY ANTHONY')));
   }
  }
 }
});

test('Beyond Good and Evil distinguishes its prose and concluding-poem translators',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nietzsche-translators-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,translator:null}),book=await library.getBook(null,'gutenberg-beyond-good-and-evil');
 assert.match(book.source.translation,/Helen Zimmern.*prose/);assert.match(book.source.translation,/L\. A\. Magnus.*poem/);
 assert.ok(book.sections.flatMap(s=>s.paragraphs).some(p=>p.original==='Translated by L. A. Magnus'));
});

test('Zarathustra preserves the original blank stanza separators in preformatted songs',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nietzsche-stanzas-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,translator:null}),book=await library.getBook(null,'gutenberg-zarathustra'),paragraphs=book.sections.flatMap(s=>s.paragraphs);
 assert.ok(paragraphs.some(p=>p.original.includes('Thou unfamiliar—GOD...\n\nSmite deeper!')));
});
