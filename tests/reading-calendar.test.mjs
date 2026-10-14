import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarMonth,shiftReadingMonth,createCalendarRequestState,chooseCurrentBook,localReadingDate} from '../app/reading-calendar.mjs';
import {libraryRestoreBatches} from '../app/library-restore.mjs';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('real Monday-first month cells include leap day without inventing records',()=>{
  const grid=calendarMonth('2024-02');assert.equal(grid.filter(Boolean).length,29);assert.equal(grid[0],null);assert.equal(grid[3],'2024-02-01');assert.equal(grid[31],'2024-02-29');assert.equal(grid.length%7,0);
  assert.equal(shiftReadingMonth('2026-01',-1),'2025-12');assert.equal(shiftReadingMonth('2026-12',1),'2027-01');assert.throws(()=>calendarMonth('2026-13'));
});
test('a slower old month or previous owner cannot replace the chosen month state',()=>{
  const s=createCalendarRequestState();const old=s.begin('a','2026-09'),current=s.begin('a','2026-10');assert.equal(s.resolve(old,{days:[]}),false);assert.equal(s.resolve(current,{month:'2026-10',days:[]}),true);assert.equal(s.view().status,'ready');
  const pending=s.begin('a','2026-11');s.clear();s.begin('b','2026-11');assert.equal(s.reject(pending,Error('old private error')),false);assert.equal(s.view().error,null);assert.equal(s.view().data,null);
});
test('error does not keep showing previous-month private records',()=>{
  const s=createCalendarRequestState();s.resolve(s.begin('a','2026-10'),{days:[{date:'2026-10-01'}]});const ticket=s.begin('a','2026-09');assert.equal(s.view().data,null);s.reject(ticket,Error('offline'));assert.equal(s.view().status,'error');assert.equal(s.view().error,'offline');s.clear();assert.equal(s.view().status,'idle');
});
test('current book uses actual activity and never automatically selects a finished book',()=>{
  const books=[{bookId:'done',journey:{status:'finished',lastReadAt:'2026-10-15'}},{bookId:'older',resume:{passageId:'p1'},journey:{lastReadAt:'2026-10-12'}},{bookId:'recent',journey:{lastReadAt:'2026-10-14'}}];assert.equal(chooseCurrentBook(books).bookId,'recent');assert.equal(chooseCurrentBook([books[0]]),null);assert.equal(chooseCurrentBook([{bookId:'unread'}]),null);
});
test('calendar date identifiers survive a browser locale that displays en-CA with slashes',()=>{
  const Original=Intl.DateTimeFormat;Intl.DateTimeFormat=function(...args){const formatter=new Original(...args);return {format:()=> '10/15/2026',formatToParts:formatter.formatToParts.bind(formatter)};};
  try{assert.equal(localReadingDate('Asia/Singapore',new Date('2026-10-14T16:01:00Z')),'2026-10-15');assert.equal(localReadingDate('America/New_York',new Date('2026-03-08T07:01:00Z')),'2026-03-08');}finally{Intl.DateTimeFormat=Original;}
});
test('browser restore batches retain goals, milestones and source anchors through a fresh service',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-batched-restore-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null});
  const records=readingRecords();records.readingSessions=[focusSession()];records.readingGoal={minutes:25,updatedAt:'2026-10-14T12:30:00Z'};records.readingMilestones=[{id:'read-1',type:'chapter_read',chapterId:'ch01',origin:'user',bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,createdAt:'2026-10-14T12:30:00.000Z'}];records.position={chapterId:'ch01',passageId:'p2',offset:0,mode:'en',variant:'literal'};
  const batches=[...libraryRestoreBatches({book:readingBook,records})];assert.equal(batches.filter(b=>b.records.readingGoal).length,1);assert.equal(batches.flatMap(b=>b.records.readingMilestones).length,1);
  for(const entry of batches)await library.restoreLibrary({id:'restore-owner'},{kind:'marginalia-library',schemaVersion:1,books:[entry]});
  const result=await library.records({id:'restore-owner'},readingBook.bookId);assert.equal(result.readingGoal.minutes,25);assert.deepEqual(result.readingMilestones,records.readingMilestones);assert.equal(result.position.passageId,'p2');assert.equal(result.readingSessions[0].durationSeconds,360);
});
