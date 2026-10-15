import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseReadingPosition,resumeSummary,positionStorageKey,acknowledgePosition} from '../app/reading-progress.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';

const book={bookId:'book',contentVersion:'source-v1',source:{structure:'source_chapters'},chapters:[{id:'ch01',number:1,kind:'body',title:{zh:'起点'}},{id:'ch02',number:2,kind:'body',title:{zh:'继续'}}],sections:[{chapterId:'ch01',paragraphs:[{id:'p1'}]},{chapterId:'ch02',paragraphs:[{id:'p2'}]}]};
const position=(id,revision)=>({passageId:id,chapterId:id==='p1'?'ch01':'ch02',offset:100,mode:'en',variant:'literal',font:22,theme:'paper',contentVersion:'source-v1',revision});
test('invalid paragraph fractions cannot become a resumable position',()=>{
  assert.equal(chooseReadingPosition({book,remote:{...position('p1',1),withinParagraph:1.5},local:null}),null);
});
test('long-paragraph progress survives service persistence and backup recovery without weakening revision checks',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-long-position-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,catalogDir:null}),user={id:'owner'},b=await library.importDocument(user,{filename:'long.txt',bytes:Buffer.from('原文需要保留。'.repeat(600))});
  const input={chapterId:'ch01',passageId:b.sections[0].paragraphs[0].id,offset:-4000,withinParagraph:0.75,mode:'en',variant:'literal',baseRevision:0};
  const saved=await library.saveProgress(user,b.bookId,input);assert.equal(saved.withinParagraph,0.75);
  const backup=await library.exportLibrary(user),target=await createLibraryService({dataDir:path.join(dir,'target'),catalogDir:null});await target.restoreLibrary(user,backup);
  assert.equal((await target.records(user,b.bookId)).position.withinParagraph,0.75);
  await assert.rejects(library.saveProgress(user,b.bookId,{...input,baseRevision:1,withinParagraph:1.01}),e=>e.status===400);
  await assert.rejects(library.saveProgress(user,b.bookId,{...input,baseRevision:0}),e=>e.status===409);
});
test('an earlier save advances the newer pending cache without replacing its passage',()=>{
  const cached={...position('p2',7),pending:true,baseRevision:7,localSequence:2},submitted={...position('p1',7),baseRevision:7,localSequence:1},saved=position('p1',8);
  const next=acknowledgePosition(cached,saved,submitted);
  assert.equal(next.passageId,'p2');assert.equal(next.baseRevision,8);assert.equal(next.pending,true);
  assert.equal(chooseReadingPosition({book,remote:saved,local:next}).passageId,'p2');
  assert.deepEqual(acknowledgePosition({...cached,baseRevision:12},saved,submitted),{...cached,baseRevision:12});
  assert.deepEqual(acknowledgePosition({...cached,localWriterId:'other-tab'},saved,{...submitted,localWriterId:'this-tab'}),{...cached,localWriterId:'other-tab'});
});
test('a newer server position beats an old browser cache; unsent compatible work and anonymous reading still resume',()=>{
  const remote=position('p2',5),local=position('p1',1);
  assert.equal(chooseReadingPosition({book,remote,local}).passageId,'p2');
  assert.equal(chooseReadingPosition({book,remote,local:{...local,pending:true,baseRevision:5}}).passageId,'p1');
  assert.equal(chooseReadingPosition({book,remote,local:{...local,pending:true,baseRevision:4}}).passageId,'p2');
  assert.equal(chooseReadingPosition({book,remote:null,local,remoteAvailable:false}).passageId,'p1');
  assert.equal(chooseReadingPosition({book,remote,local:{...local,passageId:'unknown'}}).passageId,'p2');
  assert.equal(chooseReadingPosition({book,remote:null,local:{...local,contentVersion:'different'}}),null);
  assert.notEqual(positionStorageKey('book','alice'),positionStorageKey('book','bob'));
});
test('resume summaries preserve the anchor and name its actual chapter, without invented completion percentages',()=>{
  const summary=resumeSummary(book,position('p2',5));assert.equal(summary.passageId,'p2');assert.equal(summary.chapterTitle,'继续');assert.equal(summary.label,'第 2 章 · 继续');assert.ok(!('percentage' in summary));
  assert.equal(summary.mode,'en');assert.equal(summary.variant,'literal');
  assert.equal(resumeSummary(book,{...position('p2',5),passageId:'missing'}),null);
});
test('library returns only the signed-in reader resume and refuses stale browser writes atomically',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-progress-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir}),alice={id:'alice'},bob={id:'bob'},b=await library.getBook(alice,'gutenberg-alice');
  const first=b.readingStart,second=b.chapters.find(c=>c.id==='ch02');
  const input={chapterId:first.chapterId,passageId:first.passageId,offset:100,mode:'en',variant:'literal',font:22,theme:'paper',baseRevision:0};
  const saved=await library.saveProgress(alice,b.bookId,input);assert.equal(saved.revision,1);
  const newer=await library.saveProgress(alice,b.bookId,{...input,chapterId:second.id,passageId:second.startPassageId,baseRevision:1});assert.equal(newer.revision,2);
  await assert.rejects(library.saveProgress(alice,b.bookId,input),e=>e.status===409);
  assert.equal((await library.records(alice,b.bookId)).position.passageId,second.startPassageId);
  assert.equal((await library.list(alice)).find(row=>row.bookId===b.bookId).resume.chapterTitle,'泪水池');
  assert.equal((await library.list(bob)).find(row=>row.bookId===b.bookId).resume,null);
  assert.equal((await library.list(null)).find(row=>row.bookId===b.bookId).resume,null);
});
