import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReadingSession,mergeReadingSession,buildReadingCalendar,readingJourney} from '../server/reading-activity.mjs';
import {createReadingClock} from '../app/reading-clock.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';

const base=Date.parse('2026-10-14T12:00:00Z'),now=Date.parse('2026-10-17T08:00:00Z');
const stamp=minutes=>new Date(base+minutes*60000).toISOString();
const session=(source,start=0,end=10)=>focusSession({id:source,source,status:'finished',startedAt:stamp(start),endedAt:stamp(end),segments:[{startedAt:stamp(start),endedAt:stamp(end)}],durationSeconds:(end-start)*60});
const context=(source='reader_focus')=>({id:'clock-'+source,bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,timeZone:'UTC',anchor:{chapterId:'ch01',passageId:'p1'},source});

test('actual focus, foreground estimate and self-reported manual retain distinct sources',()=>{
 for(const source of ['reader_focus','reader_estimate','manual'])assert.equal(normalizeReadingSession(session(source),readingBook,now).source,source);
 const legacy=session('reader_focus');delete legacy.source;assert.equal(normalizeReadingSession(legacy,readingBook,now).source,'reader_focus');
 for(const source of ['agent','design_preview_focus_timer','auto','',null])assert.throws(()=>normalizeReadingSession(session(source),readingBook,now),{status:400});
});
test('manual submissions are a finished positive single interval, not a duration claim or growing clock',()=>{
 assert.equal(normalizeReadingSession({...session('manual'),durationSeconds:999},readingBook,now).durationSeconds,600);
 for(const patch of [{status:'active'},{status:'paused'},{sequence:2},{segments:[]},{segments:[{startedAt:stamp(1),endedAt:stamp(10)}]},{segments:[{startedAt:stamp(0),endedAt:stamp(5)},{startedAt:stamp(5),endedAt:stamp(10)}]},{endedAt:stamp(0),segments:[{startedAt:stamp(0),endedAt:stamp(0)}]},{startedAt:new Date(now).toISOString(),endedAt:new Date(now+60000).toISOString(),segments:[{startedAt:new Date(now).toISOString(),endedAt:new Date(now+60000).toISOString()}]}])assert.throws(()=>normalizeReadingSession({...session('manual'),...patch},readingBook,now),{status:400});
});
test('manual idempotency preserves one exact self-report and rejects a changed interval under its ID',()=>{
 const old=normalizeReadingSession(session('manual'),readingBook,now);assert.deepEqual(mergeReadingSession(old,structuredClone(old)),old);
 const changed=normalizeReadingSession(session('manual',0,12),readingBook,now);assert.throws(()=>mergeReadingSession(old,changed),{status:409});
 const other=normalizeReadingSession({...session('reader_estimate'),id:old.id},readingBook,now);assert.throws(()=>mergeReadingSession(old,other),{status:409});
});
test('manual identity compares interval values after JSONB reorders object keys',()=>{
 const submitted=normalizeReadingSession(session('manual'),readingBook,now),persisted={...submitted,segments:submitted.segments.map(s=>({endedAt:s.endedAt,startedAt:s.startedAt}))};
 assert.notEqual(JSON.stringify(persisted.segments),JSON.stringify(submitted.segments));
 assert.equal(mergeReadingSession(persisted,submitted),persisted);
 const changed=normalizeReadingSession(session('manual',0,11),readingBook,now);assert.throws(()=>mergeReadingSession(persisted,changed),{status:409});
});
test('focus allows ten minutes thinking without interaction; estimate stops at two minutes and does not backfill',()=>{
 for(const source of ['reader_focus','reader_estimate']){
  let time=base;const clock=createReadingClock({now:()=>time,heartbeatGapMs:5000});clock.start(context(source));
  for(let second=1;second<=600;second++){time=base+second*1000;clock.view();}
  assert.equal(clock.snapshot().source,source);assert.equal(clock.view().elapsedSeconds,source==='reader_focus'?600:120);
  if(source==='reader_estimate'){
   assert.equal(clock.view().status,'paused');assert.equal(clock.view().idle,true);clock.activity();time+=1000;assert.equal(clock.view().elapsedSeconds,121);
   clock.pause();time+=1000;clock.activity();time+=1000;assert.equal(clock.view().status,'paused');assert.equal(clock.view().elapsedSeconds,121);
   clock.resume();time+=1000;assert.equal(clock.view().elapsedSeconds,122);
  }
 }
});
test('estimate excludes hidden, unfocused and unobserved time; trusted return never fills old idle intervals',()=>{
 let time=base;const clock=createReadingClock({now:()=>time,heartbeatGapMs:5000});clock.start(context('reader_estimate'));
 time+=1000;clock.setVisible(false);time+=60000;clock.activity();clock.setVisible(true);time+=1000;clock.view();clock.setFocused(false);time+=60000;clock.setFocused(true);clock.activity();time+=1000;assert.equal(clock.view().elapsedSeconds,3);
 time+=23000;assert.equal(clock.view().elapsedSeconds,3);time+=1000;assert.equal(clock.view().elapsedSeconds,4);
 const last=clock.finish();time+=60000;assert.equal(clock.finish().durationSeconds,last.durationSeconds);assert.throws(()=>clock.start(context('manual')),{status:400});
});
test('calendar totals union across sources while each source remains independently auditable',()=>{
 const records=readingRecords();records.readingSessions=[session('reader_focus',0,10),session('reader_estimate',5,15),session('manual',10,20)];
 const result=buildReadingCalendar([{book:readingBook,records}],{month:'2026-10',timeZone:'UTC'}),day=result.days[13];
 assert.equal(day.durationSeconds,1200);assert.equal(result.durationSeconds,1200);
 const expected={reader_focus:600,reader_estimate:600,manual:600};assert.deepEqual(day.sourceDurationSeconds,expected);assert.deepEqual(result.sourceDurationSeconds,expected);assert.deepEqual(day.books[0].sourceDurationSeconds,expected);
 assert.deepEqual(new Set(day.details.filter(d=>d.type==='reading').map(d=>d.source)),new Set(Object.keys(expected)));
 assert.match(result.meaning,/重叠/);assert.match(result.meaning,/不能相加/);
});
test('mixed-source duplicate devices and local midnight split by actual interval union',()=>{
 const records=readingRecords();records.readingSessions=[session('reader_estimate',235,245),{...session('manual',240,250),id:'manual-other'}];
 const other=readingRecords();other.bookId='other-book';other.readingSessions=[{...session('reader_focus',240,250),bookId:other.bookId}];
 const result=buildReadingCalendar([{book:readingBook,records},{book:{...readingBook,bookId:other.bookId},records:other}],{month:'2026-10',timeZone:'Asia/Singapore'});
 assert.equal(result.days[13].durationSeconds,300);assert.equal(result.days[14].durationSeconds,600);assert.equal(result.durationSeconds,900);
 assert.deepEqual(result.sourceDurationSeconds,{reader_focus:600,reader_estimate:600,manual:600});
});
test('all real sources validate in a backup and preserve latest reading; preview does not become real time',()=>{
 const records=readingRecords();records.readingSessions=[session('reader_focus'),session('reader_estimate',10,20),session('manual',20,30)];
 const backup={kind:'marginalia-library',schemaVersion:1,books:[{book:readingBook,records}]};assert.equal(validateLibraryBackup(backup).books,1);assert.equal(readingJourney(readingBook,records).lastReadAt,stamp(30));
 const invalid=structuredClone(backup);invalid.books[0].records.readingSessions[2].source='agent';assert.throws(()=>validateLibraryBackup(invalid));
 const preview=readingRecords();preview.readingSessions=[{...session('reader_focus'),source:'design_preview_focus_timer'}];assert.equal(readingJourney(readingBook,preview).lastReadAt,null);
});
