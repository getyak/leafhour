import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReadingJournalShare,journalMonthSummary,journalDayLevel} from '../app/reading-journal.mjs';
const day={date:'2026-10-28',durationSeconds:1520,sourceDurationSeconds:{reader_focus:1200,reader_estimate:320,manual:0},notes:5,questions:3,books:[{bookId:'private-book',title:{zh:'私人的书'},durationSeconds:1520}],details:[{text:'私人的问题',origin:'user'}]};
test('share defaults to date and measured duration without private book or note content',()=>{
 const share=buildReadingJournalShare(day);assert.deepEqual(share,{date:'2026-10-28',durationSeconds:1520,sourceDurationSeconds:{reader_focus:1200,reader_estimate:320},bookTitles:[]});
 assert.doesNotMatch(JSON.stringify(share),/private-book|私人的|questions|notes|details/);
});
test('book names require explicit opt-in and preserve literal source names',()=>{
 const share=buildReadingJournalShare(day,{includeBookTitles:true});assert.deepEqual(share.bookTitles,['私人的书']);assert.equal(share.durationSeconds,1520);assert.doesNotMatch(JSON.stringify(share),/私人的问题|private-book/);
});
test('share refuses invalid days or fabricated negative durations and tolerates unavailable breakdown',()=>{
 for(const changed of [{date:'2026-02-30'},{durationSeconds:-1},{durationSeconds:Infinity}])assert.throws(()=>buildReadingJournalShare({...day,...changed}));
 assert.deepEqual(buildReadingJournalShare({...day,sourceDurationSeconds:null}).sourceDurationSeconds,{});
});
test('month summary excludes adjacent-month overview days and counts actual activity without inventing a streak',()=>{
 const summary=journalMonthSummary({days:[day,{...day,date:'2026-10-01',durationSeconds:0,notes:2},{...day,date:'2026-09-30',durationSeconds:9000},{...day,date:'2026-10-02',durationSeconds:60,chapterMarks:1}]},'2026-10');
 assert.deepEqual(summary,{durationSeconds:1580,readingDays:2,notes:12,questions:9});
});
test('calendar intensity separates no record, note-only activity and measured reading',()=>{
 assert.equal(journalDayLevel(null),0);assert.equal(journalDayLevel({durationSeconds:0,notes:1}),1);assert.equal(journalDayLevel({durationSeconds:60}),2);assert.equal(journalDayLevel({durationSeconds:1200}),3);assert.equal(journalDayLevel({durationSeconds:3600}),4);
});
