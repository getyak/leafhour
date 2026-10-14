import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReadingSession} from '../server/reading-activity.mjs';
import {readingBook} from './reading-fixtures.mjs';
const clockModule=()=>import('../app/reading-clock.mjs');
const base=Date.parse('2026-10-14T12:00:00Z');
const context=(id='clock-1')=>({id,bookId:'reading-test',contentVersion:'edition-1',timeZone:'Asia/Singapore',anchor:{chapterId:'ch01',passageId:'p1'}});

test('a page that was merely opened has no reading snapshot',async()=>{const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});now+=600000;assert.equal(clock.snapshot(),null);assert.equal(clock.view().status,'idle');});
test('an explicitly started clock measures visible intervals and excludes a manual pause',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());now+=300000;clock.pause();now+=300000;clock.resume();now+=180000;const snapshot=clock.snapshot();assert.equal(snapshot.durationSeconds,480);assert.equal(snapshot.segments.length,2);assert.equal(snapshot.status,'active');assert.equal(normalizeReadingSession(snapshot,readingBook,now).durationSeconds,480);
});
test('hidden time is excluded and a visible return only resumes the previously running clock',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());now+=30000;clock.setVisible(false);now+=600000;assert.equal(clock.snapshot().durationSeconds,30);assert.equal(clock.view().status,'paused');clock.setVisible(true);now+=20000;assert.equal(clock.snapshot().durationSeconds,50);clock.pause();clock.setVisible(false);now+=100000;clock.setVisible(true);now+=30000;assert.equal(clock.snapshot().durationSeconds,50);
});
test('a background start or loss of window focus cannot add reading time',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.setVisible(false);clock.start(context());now+=100000;assert.equal(clock.snapshot().durationSeconds,0);clock.setVisible(true);now+=10000;clock.setFocused(false);now+=300000;assert.equal(clock.snapshot().durationSeconds,10);clock.setFocused(true);now+=5000;assert.equal(clock.snapshot().durationSeconds,15);
});
test('chapter changes preserve the original start and never create completion marks',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());now+=2000;clock.setContext({chapterId:'ch02',passageId:'p3'});const snapshot=clock.snapshot();assert.deepEqual(snapshot.start,{chapterId:'ch01',passageId:'p1'});assert.deepEqual(snapshot.end,{chapterId:'ch02',passageId:'p3'});assert.equal(snapshot.readingMilestones,undefined);assert.equal(snapshot.durationSeconds,2);
});
test('finish is terminal, repeated final snapshots are monotonic, and a new session starts separately',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());now+=32000;const finished=clock.finish();assert.equal(finished.status,'finished');assert.equal(finished.durationSeconds,32);now+=100000;assert.throws(()=>clock.resume());const again=clock.snapshot();assert.equal(again.durationSeconds,32);assert.ok(again.sequence>finished.sequence);assert.equal(again.endedAt,finished.endedAt);clock.start(context('clock-2'));assert.equal(clock.snapshot().durationSeconds,0);assert.equal(clock.snapshot().id,'clock-2');
});
test('a long-open tab closes at the 24-hour bound without inventing paused reading time',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());now+=60000;clock.setVisible(false);now+=25*3600000;clock.setVisible(true);const snapshot=clock.snapshot();assert.equal(snapshot.status,'finished');assert.equal(snapshot.durationSeconds,60);assert.equal(Date.parse(snapshot.endedAt)-Date.parse(snapshot.startedAt),86400000);assert.equal(normalizeReadingSession(snapshot,readingBook,now).durationSeconds,60);
});
test('a backward wall-clock adjustment does not erase already accumulated seconds',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());now+=15000;assert.equal(clock.snapshot().durationSeconds,15);now-=5000;assert.equal(clock.snapshot().durationSeconds,15);now=base+20000;assert.equal(clock.snapshot().durationSeconds,20);
});
test('starting again cannot discard an unfinished session, and the pause-interval bound keeps valid data',async()=>{
  const {createReadingClock}=await clockModule();let now=base;const clock=createReadingClock({now:()=>now});clock.start(context());assert.throws(()=>clock.start(context('another')));assert.equal(clock.snapshot().id,'clock-1');for(let i=0;i<120;i++){now+=1000;clock.pause();now+=1000;if(i<119)clock.resume();}clock.resume();const snapshot=clock.snapshot();assert.equal(snapshot.status,'finished');assert.equal(snapshot.segments.length,120);assert.equal(snapshot.durationSeconds,120);assert.equal(normalizeReadingSession(snapshot,readingBook,now).durationSeconds,120);
});
test('foreground heartbeat sampling excludes a silent runtime suspension and resumes from return',async()=>{const {createReadingClock}=await clockModule();let now=Date.parse('2026-10-14T12:00:00Z');const clock=createReadingClock({now:()=>now,heartbeatGapMs:5000});clock.start({bookId:'b',contentVersion:'v',timeZone:'Asia/Singapore',anchor:{chapterId:'c',passageId:'p'}});now+=1000;assert.equal(clock.view().elapsedSeconds,1);now+=23000;assert.equal(clock.view().elapsedSeconds,1);now+=1000;assert.equal(clock.view().elapsedSeconds,2);clock.pause();now+=23000;assert.equal(clock.view().status,'paused');assert.equal(clock.view().elapsedSeconds,2);});
test('many observed suspension gaps still respect the interval bound without dropping old time',async()=>{const {createReadingClock}=await clockModule();let now=Date.parse('2026-10-14T12:00:00Z');const clock=createReadingClock({now:()=>now,heartbeatGapMs:5000});clock.start({bookId:'b',contentVersion:'v',timeZone:'Asia/Singapore',anchor:{chapterId:'c',passageId:'p'}});for(let i=0;i<120;i++){now+=1000;clock.view();now+=6000;clock.view();}assert.equal(clock.view().status,'finished');assert.equal(clock.view().reason,'interval_limit');assert.equal(clock.snapshot().segments.length,120);assert.equal(clock.snapshot().durationSeconds,120);});
