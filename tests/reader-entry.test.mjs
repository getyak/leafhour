import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLibraryService} from '../server/library-service.mjs';
import {resolveReaderOpening} from '../app/reader-entry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-entry-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir}),book=await library.getBook(null,'gutenberg-alice');
  return {book,hasPassage:id=>book.sections.some(s=>s.paragraphs.some(p=>p.id===id)),chapterOf:id=>book.sections.find(s=>s.paragraphs.some(p=>p.id===id))?.chapterId};
};
const open=(f,extra={})=>resolveReaderOpening({book:f.book,hasPassage:f.hasPassage,chapterOf:f.chapterOf,state:{chapterId:f.book.readingStart.chapterId},...extra});

test('a genuinely fresh opening stops at the generated chapter top instead of clipping its heading',async t=>{
  const f=await fixture(t),opening=open(f);
  assert.equal(opening.position,null,'fresh opening must not restore an anchor below the chapter heading');
  assert.equal(opening.chapterId,f.book.readingStart.chapterId);
  assert.equal(opening.preferences.mode,'en','a fresh opening keeps the existing original-first defaults');
  assert.equal(opening.preferences.font,22);
});

test('invalid saved positions open at the chapter top rather than a clipped paragraph anchor',async t=>{
  const f=await fixture(t),start=f.book.readingStart;
  const valid={passageId:start.passageId,chapterId:start.chapterId,offset:100,mode:'en',variant:'literal',contentVersion:f.book.contentVersion};
  for(const broken of [{...valid,offset:5000},{...valid,offset:NaN},{...valid,withinParagraph:1.5},{...valid,passageId:'missing-passage'},{...valid,contentVersion:'other-version'}]){
    const opening=open(f,{remote:broken});
    assert.equal(opening.position,null,JSON.stringify(broken));
    assert.equal(opening.chapterId,start.chapterId);
  }
  // A record whose paragraph is not loaded yet cannot anchor the opening, but
  // its revision still reaches progress-sync exactly as before.
  const unloaded=open(f,{remote:{...valid,revision:9},hasPassage:()=>false});
  assert.equal(unloaded.position,null);
  assert.equal(unloaded.chosen.revision,9,'the raw chosen record keeps its revision for progress-sync even when unusable as an anchor');
});

test('validated local and remote resumes keep their anchor with context above the paragraph',async t=>{
  const f=await fixture(t),paragraphs=f.book.sections.flatMap(s=>s.paragraphs),target=paragraphs[6];
  const saved={passageId:target.id,chapterId:f.chapterOf(target.id),offset:-120,withinParagraph:0.35,mode:'en',variant:'literal',contentVersion:f.book.contentVersion,revision:3};
  const opening=open(f,{remote:saved});
  assert.equal(opening.position.passageId,target.id);
  assert.equal(opening.position.offset,-120);
  assert.equal(opening.position.withinParagraph,0.35);
  assert.equal(opening.chapterId,f.chapterOf(target.id));
  const local={...saved,offset:-60,withinParagraph:0.2,localSequence:2,localWriterId:'tab',pending:true,baseRevision:3};
  assert.equal(open(f,{remote:saved,local}).position.offset,-60,'unsent compatible local work still resumes');
});

test('an explicit citation entry outranks saved progress and keeps its deliberate paragraph anchor',async t=>{
  const f=await fixture(t),paragraphs=f.book.sections.flatMap(s=>s.paragraphs),target=paragraphs[10];
  const saved={passageId:paragraphs[2].id,chapterId:f.chapterOf(paragraphs[2].id),offset:80,mode:'en',variant:'literal',contentVersion:f.book.contentVersion};
  const query=new URLSearchParams({book:f.book.bookId,passage:target.id,contentVersion:f.book.contentVersion,layer:'original'});
  const opening=open(f,{query,remote:saved});
  assert.equal(opening.position.passageId,target.id);
  assert.equal(opening.position.offset,160);
  assert.equal(opening.position.withinParagraph,undefined);
  assert.equal(opening.preferences.mode,'en');
});

test('a note entry opens its paragraph while sample entry opens the translated start',async t=>{
  const f=await fixture(t),paragraphs=f.book.sections.flatMap(s=>s.paragraphs),target=paragraphs[4];
  const note=open(f,{query:new URLSearchParams({book:f.book.bookId,passage:target.id,note:'comment'})});
  assert.equal(note.position.passageId,target.id);assert.equal(note.position.offset,160);assert.equal(note.preferences.mode,'en');
  const sample=open(f,{query:new URLSearchParams({book:f.book.bookId,sample:'zh'})});
  assert.equal(sample.position.passageId,f.book.readingStart.passageId);
  assert.equal(sample.position.offset,160);
  assert.equal(sample.preferences.mode,'zh');assert.equal(sample.preferences.variant,'interpretive');
  const both=open(f,{query:new URLSearchParams({book:f.book.bookId,sample:'zh',passage:target.id})});
  assert.equal(both.position.passageId,target.id,'an explicit passage wins over the sample entry');
});

test('reader boot consumes the real entry policy and opens fresh books at chapter top',async()=>{
  const source=await readFile(path.join(root,'app/reader.js'),'utf8');
  assert.match(source,/import\s*{[^}]*resolveReaderOpening[^}]*}\s*from\s*'\.\/reader-entry\.mjs'/);
  assert.match(source,/resolveReaderOpening\(/);
  assert.doesNotMatch(source,/readingStart,\s*offset:\s*\d+/,'the no-position branch must not clip the generated chapter heading');
});
