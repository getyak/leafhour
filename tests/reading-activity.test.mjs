import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';
const domain=()=>import('../server/reading-activity.mjs');
const now=Date.parse('2026-10-15T01:00:00Z');

test('a new backup carries actual foreground intervals and explicit read marks',()=>{
  const records=readingRecords();records.readingSessions=[focusSession()];records.readingMilestones=[{id:'chapter-1',type:'chapter_read',bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,chapterId:'ch01',origin:'user',createdAt:'2026-10-14T12:11:00Z'}];records.readingGoal={minutes:15,updatedAt:'2026-10-14T12:00:00Z'};
  assert.deepEqual(validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[{book:readingBook,records}]}),{books:1,paragraphs:4,notes:0});
});
test('the interval sum excludes pauses and merges overlaps instead of trusting a duration claim',async()=>{
  const {normalizeReadingSession}=await domain();const result=normalizeReadingSession(focusSession({durationSeconds:9999,segments:[{startedAt:'2026-10-14T12:00:00Z',endedAt:'2026-10-14T12:04:00Z'},{startedAt:'2026-10-14T12:03:00Z',endedAt:'2026-10-14T12:05:00Z'},{startedAt:'2026-10-14T12:08:00Z',endedAt:'2026-10-14T12:10:00Z'}]}),readingBook,now);
  assert.equal(result.durationSeconds,420);assert.equal(result.segments.length,2);assert.equal(result.source,'reader_focus');
});
test('invalid time, interval bounds, anchors and non-reader source cannot create activity',async()=>{
  const {normalizeReadingSession}=await domain();for(const patch of [{startedAt:'bad'},{endedAt:'2026-10-16T13:00:00Z'},{startedAt:'2026-10-12T12:00:00Z'},{sequence:0},{sequence:1.5},{timeZone:'not/a-time-zone'},{source:'agent'},{contentVersion:'other'},{start:{chapterId:'ch02',passageId:'p1'}},{segments:[{startedAt:'2026-10-14T11:00:00Z',endedAt:'2026-10-14T12:00:00Z'}]},{segments:[{startedAt:'2026-10-14T12:04:00Z',endedAt:'2026-10-14T12:03:00Z'}]},{segments:Array.from({length:121},()=>({startedAt:'2026-10-14T12:00:00Z',endedAt:'2026-10-14T12:01:00Z'}))}])assert.throws(()=>normalizeReadingSession(focusSession(patch),readingBook,now),e=>[400,409].includes(e.status),JSON.stringify(patch));
});
test('late checkpoints do not undo a completed session or erase previously measured intervals',async()=>{
  const {normalizeReadingSession:n,mergeReadingSession:merge}=await domain();const older=n(focusSession(),readingBook,now),finished=n(focusSession({sequence:3,status:'finished',endedAt:'2026-10-14T12:12:00Z',segments:[{startedAt:'2026-10-14T12:10:00Z',endedAt:'2026-10-14T12:12:00Z'}]}),readingBook,now);
  const saved=merge(older,finished);assert.equal(saved.durationSeconds,480);assert.equal(saved.status,'finished');assert.deepEqual(merge(saved,older),saved);assert.throws(()=>merge(saved,n(focusSession({sequence:4,status:'active'}),readingBook,now)),e=>e.status===409);
  const duplicateFinal=merge(saved,n(focusSession({sequence:4,status:'finished'}),readingBook,now));assert.equal(duplicateFinal.status,'finished');assert.equal(duplicateFinal.durationSeconds,480);
  assert.throws(()=>merge(older,n(focusSession({sequence:2,startedAt:'2026-10-14T11:59:00Z'}),readingBook,now)),e=>e.status===409);
});
test('visiting the last passage never finishes a chapter or book',async()=>{
  const {readingJourney}=await domain();const records=readingRecords();records.position={chapterId:'ch02',passageId:'p4'};records.readingSessions=[focusSession()];const journey=readingJourney(readingBook,records);assert.equal(journey.status,'reading');assert.equal(journey.completedChapters,0);assert.equal(journey.dailyGoalMinutes,15);
});
test('explicit milestones can finish and reopen a chapter or whole book',async()=>{
  const {readingJourney,normalizeReadingMilestone}=await domain();const records=readingRecords();records.readingMilestones=[normalizeReadingMilestone({id:'r1',type:'chapter_read',chapterId:'ch01',createdAt:'2026-10-14T12:00:00Z'},readingBook,now),normalizeReadingMilestone({id:'r2',type:'book_finished',createdAt:'2026-10-14T12:01:00Z'},readingBook,now)];let journey=readingJourney(readingBook,records);assert.equal(journey.status,'finished');assert.equal(journey.completedChapters,1);
  records.readingMilestones.push(normalizeReadingMilestone({id:'r3',type:'chapter_reopened',chapterId:'ch01',createdAt:'2026-10-14T12:02:00Z'},readingBook,now),normalizeReadingMilestone({id:'r4',type:'book_reopened',createdAt:'2026-10-14T12:03:00Z'},readingBook,now));journey=readingJourney(readingBook,records);assert.equal(journey.status,'reading');assert.equal(journey.completedChapters,0);
  assert.throws(()=>normalizeReadingMilestone({id:'bad',type:'chapter_read',chapterId:'absent'},readingBook,now));assert.throws(()=>normalizeReadingMilestone({id:'ai',type:'book_finished',origin:'ai'},readingBook,now));
});
test('calendar splits a real Singapore midnight and counts overlapped devices only once',async()=>{
  const {buildReadingCalendar}=await domain();const a=readingRecords(),b=readingRecords();b.bookId='second-book';a.readingSessions=[focusSession({id:'a',startedAt:'2026-10-14T15:55:00Z',endedAt:'2026-10-14T16:05:00Z',segments:[{startedAt:'2026-10-14T15:55:00Z',endedAt:'2026-10-14T16:05:00Z'}],durationSeconds:600})];b.readingSessions=[focusSession({id:'b',bookId:'second-book',startedAt:'2026-10-14T16:00:00Z',endedAt:'2026-10-14T16:10:00Z',segments:[{startedAt:'2026-10-14T16:00:00Z',endedAt:'2026-10-14T16:10:00Z'}],durationSeconds:600})];
  const result=buildReadingCalendar([{book:readingBook,records:a},{book:{...readingBook,bookId:'second-book'},records:b}],{month:'2026-10',timeZone:'Asia/Singapore'});const d14=result.days.find(d=>d.date==='2026-10-14'),d15=result.days.find(d=>d.date==='2026-10-15');assert.equal(result.days.length,31);assert.equal(d14.durationSeconds,300);assert.equal(d15.durationSeconds,600);assert.equal(d15.books.length,2);assert.equal(result.durationSeconds,900);
});
test('calendar handles leap February and actual elapsed time across a DST change',async()=>{
  const {buildReadingCalendar}=await domain();assert.equal(buildReadingCalendar([],{month:'2024-02',timeZone:'UTC'}).days.length,29);const records=readingRecords();records.readingSessions=[focusSession({startedAt:'2026-03-08T06:30:00Z',endedAt:'2026-03-08T07:30:00Z',segments:[{startedAt:'2026-03-08T06:30:00Z',endedAt:'2026-03-08T07:30:00Z'}],durationSeconds:3600})];const result=buildReadingCalendar([{book:readingBook,records}],{month:'2026-03',timeZone:'America/New_York'});assert.equal(result.days.find(d=>d.date==='2026-03-08').durationSeconds,3600);assert.throws(()=>buildReadingCalendar([],{month:'2026-13',timeZone:'UTC'}));assert.throws(()=>buildReadingCalendar([],{month:'2026-03',timeZone:'invalid'}));
});
test('legacy preview time stays labeled and never becomes real calendar time; own notes stay separate',async()=>{
  const {buildReadingCalendar}=await domain();const records=readingRecords();records.readingSessions=[{id:'legacy',bookId:'reading-test',source:'design_preview_focus_timer',startedAt:'2026-10-14T12:00:00Z',endedAt:'2026-10-14T13:00:00Z',durationSeconds:3600}];records.comments=[{id:'note',origin:'user',passageId:'p2',text:'My own thought.',createdAt:'2026-10-14T12:05:00Z'}];const result=buildReadingCalendar([{book:readingBook,records}],{month:'2026-10',timeZone:'UTC'}),day=result.days.find(d=>d.date==='2026-10-14');assert.equal(day.durationSeconds,0);assert.equal(day.notes,1);assert.equal(day.details[0].passageId,'p2');assert.equal(day.details[0].origin,'user');
});
test('new activity backup validates all entries before mutation and preserves the older format',()=>{
  const records=readingRecords();records.readingSessions=[focusSession()];for(const edit of [r=>r.readingSessions[0].durationSeconds=500,r=>r.readingSessions[0].end.passageId='missing',r=>r.readingMilestones=[{id:'bad',type:'book_finished',origin:'ai',createdAt:'2026-10-14T12:00:00Z'}],r=>r.readingGoal={minutes:0,updatedAt:'2026-10-14T12:00:00Z'}]){const bad=structuredClone(records);edit(bad);assert.throws(()=>validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[{book:readingBook,records:bad}]}));}
  const old=readingRecords();old.schemaVersion=2;delete old.readingMilestones;old.readingSessions=[{id:'legacy',bookId:'reading-test',source:'design_preview_focus_timer',startedAt:'2026-10-14T12:00:00Z',endedAt:'2026-10-14T12:02:00Z',durationSeconds:120}];assert.equal(validateLibraryBackup({kind:'marginalia-library',schemaVersion:1,books:[{book:readingBook,records:old}]}).books,1);
});
test('calendar completion events return to an actual source passage in that chapter',async()=>{
  const {buildReadingCalendar}=await domain(),records=readingRecords();records.readingMilestones=[{id:'ch2-read',bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,origin:'user',type:'chapter_read',chapterId:'ch02',createdAt:'2026-10-14T12:30:00Z'}];const data=buildReadingCalendar([{book:readingBook,records}],{month:'2026-10',timeZone:'Asia/Singapore'});assert.equal(data.days[13].details[0].passageId,'p3');
});
