import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {extractDocument,makeBook,digest} from '../server/document-import.mjs';

const expected=[
  ['gutenberg-alice','alice.txt',12,'Alice was beginning'],
  ['gutenberg-meditations','meditations.txt',12,'Of my grandfather Verus'],
  ['gutenberg-walden','walden.txt',18,'When I wrote the following pages']
];
test('default books open their actual first chapter and retain every prior stable passage',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir});
  for(const [id,file,count,firstWords]of expected){
    const book=await library.getBook(null,id);assert.equal(book.source.structure,'source_chapters');assert.equal(book.chapters.filter(c=>c.kind==='body').length,count);
    const first=book.sections.flatMap(s=>s.paragraphs).find(p=>p.id===book.readingStart.passageId);assert.match(first.original,new RegExp(firstWords));
    const bytes=await readFile(path.resolve('catalog',file)),extracted=await extractDocument({filename:file,bytes}),body=extracted.pages[0].text;
    const match=body.match(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*([\s\S]*?)\*\*\* END OF THE PROJECT GUTENBERG EBOOK/);extracted.pages[0].text=match[1].trim();
    const old=makeBook({bookId:id,filename:file,sourceHash:digest(bytes),extracted});
    assert.deepEqual(book.sections.flatMap(s=>s.paragraphs).map(p=>[p.id,p.original]),old.sections.flatMap(s=>s.paragraphs).map(p=>[p.id,p.original]));
    assert.ok(book.chapters.some(c=>c.kind==='frontmatter'));assert.ok(!book.chapters.some(c=>c.title.zh.includes('阅读片段')));
  }
});

test('restructuring the catalog restores an old position and backup by passage ID without losing original comments',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir}),user={id:'old-reader'};
  const bytes=await readFile('catalog/alice.txt'),extracted=await extractDocument({filename:'alice.txt',bytes});extracted.pages[0].text=extracted.pages[0].text.match(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*([\s\S]*?)\*\*\* END OF THE PROJECT GUTENBERG EBOOK/)[1].trim();
  const old=makeBook({bookId:'gutenberg-alice',filename:'alice.txt',sourceHash:digest(bytes),extracted}),section=old.sections[1],passage=section.paragraphs[0];
  passage.translations={literal:{text:'旧直译草稿',status:'draft',origin:'ai'},interpretive:{text:'旧意译草稿',status:'draft',origin:'ai'}};
  const records={kind:'marginalia-personal-records',schemaVersion:2,bookId:old.bookId,contentVersion:old.contentVersion,comments:[{id:'old-note',passageId:passage.id,text:'Keep my original note',origin:'user',createdAt:'2026-10-12T12:00:00Z'}],questions:[],readingSessions:[],position:{chapterId:section.chapterId,passageId:passage.id,offset:80,mode:'en',variant:'literal',font:22,theme:'paper'}};
  await library.restoreLibrary(user,{kind:'marginalia-library',schemaVersion:1,books:[{book:old,records}]});
  const updated=await library.getBook(user,old.bookId),saved=await library.records(user,old.bookId),current=updated.sections.find(s=>s.paragraphs.some(p=>p.id===passage.id));
  assert.notEqual(section.chapterId,current.chapterId);assert.equal(saved.position.passageId,passage.id);assert.equal(saved.position.chapterId,current.chapterId);assert.equal(saved.comments[0].text,'Keep my original note');
  assert.deepEqual(current.paragraphs.find(p=>p.id===passage.id).translations,passage.translations);
});
