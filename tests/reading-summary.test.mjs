import test from 'node:test';
import assert from 'node:assert/strict';
import {readingBook,readingRecords,focusSession} from './reading-fixtures.mjs';
import {buildReadingSummary} from '../server/reading-summary.mjs';
test('summary unions global time while preserving overlapping per-book totals, timezone days and historical months',()=>{
 const a=readingRecords(),b=readingRecords();b.bookId='second';a.readingSessions=[focusSession(),focusSession({id:'old',startedAt:'2026-09-30T15:55:00Z',endedAt:'2026-09-30T16:05:00Z',segments:[{startedAt:'2026-09-30T15:55:00Z',endedAt:'2026-09-30T16:05:00Z'}]})];b.readingSessions=[focusSession({bookId:'second',source:'manual'})];
 const result=buildReadingSummary([{book:readingBook,records:a},{book:{...readingBook,bookId:'second'},records:b}],{month:'2026-10',timeZone:'Asia/Singapore'});
 assert.equal(result.durationSeconds,660);assert.equal(result.allTime.durationSeconds,960);assert.equal(result.allTime.readingDays,3);assert.equal(result.books[0].durationSeconds,960);assert.equal(result.books[1].durationSeconds,360);
});
test('empty and malformed/foreign/agent sessions never create time',()=>{
 const records=readingRecords();records.readingSessions=[focusSession({source:'agent'}),focusSession({contentVersion:'foreign'}),focusSession({segments:[{startedAt:'nonsense',endedAt:'2026-10-14T13:00:00Z'}]})];
 const result=buildReadingSummary([{book:readingBook,records}],{month:'2026-10',timeZone:'UTC'});assert.equal(result.allTime.durationSeconds,0);assert.equal(result.durationSeconds,0);
});
