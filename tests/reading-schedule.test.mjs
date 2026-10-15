import test from 'node:test';
import assert from 'node:assert/strict';
import * as schedule from '../app/reading-schedule.mjs';
const book={bookId:'private-123',title:{zh:'一本书'},journey:{dailyGoalMinutes:20}},meta={origin:'https://reader.example.com',now:new Date('2026-10-15T12:00:00Z')},options={start:'2026-10-18T19:30',minutes:25,repeat:'weekly',until:'2026-12-20',reminder:10,uid:'reading-appointment-1'};
const unfold=text=>text.replace(/\r\n /g,'');

test('a reading appointment keeps local wall time, duration, recurrence and a link to the actual book',()=>{
  assert.equal(typeof schedule.buildReadingCalendar,'function');
  const value=unfold(schedule.buildReadingCalendar(book,options,meta));
  assert.ok(value.includes('DTSTART:20261018T193000\r\n'));
  assert.ok(value.includes('DTEND:20261018T195500\r\n'));
  assert.ok(value.includes('RRULE:FREQ=WEEKLY;UNTIL=20261220T235959\r\n'));
  assert.ok(value.includes('URL:https://reader.example.com/read?book=private-123\r\n'));
  assert.ok(value.includes('TRIGGER:-PT10M\r\n'));assert.equal(value.split('BEGIN:VEVENT').length,2);
});
test('one-off appointments and no reminder omit repeated events and alarms',()=>{
  assert.equal(typeof schedule.buildReadingCalendar,'function');
  const value=schedule.buildReadingCalendar(book,{...options,start:'2026-12-31T23:50',minutes:30,repeat:'none',reminder:-1},meta);
  assert.ok(value.includes('DTEND:20270101T002000'));assert.ok(!value.includes('RRULE:'));assert.ok(!value.includes('VALARM'));
});
test('book text cannot inject calendar components, and long Unicode lines unfold without corruption',()=>{
  assert.equal(typeof schedule.buildReadingCalendar,'function');
  const title='纸张😀;书名,\\\nEND:VEVENT\nBEGIN:VEVENT'.repeat(8);
  const value=schedule.buildReadingCalendar({...book,title:{zh:title}},options,meta);
  assert.equal(value.split('\r\nBEGIN:VEVENT\r\n').length,2);
  for(const line of value.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
  assert.ok(unfold(value).includes('纸张😀\\;书名\\,\\\\\\nEND:VEVENT\\nBEGIN:VEVENT'));
  assert.ok(value.isWellFormed());
});
test('invalid dates, durations, repeat ranges and origins are rejected before a file is produced',()=>{
  assert.equal(typeof schedule.buildReadingCalendar,'function');
  for(const next of [{start:'2026-02-30T20:00'},{minutes:0},{minutes:1000},{until:'2026-10-01'},{repeat:'hourly'},{reminder:5000},{uid:'bad\r\nUID:injected'}])assert.throws(()=>schedule.buildReadingCalendar(book,{...options,...next},meta));
  assert.throws(()=>schedule.buildReadingCalendar(book,options,{...meta,origin:'javascript:alert(1)'}));
});
