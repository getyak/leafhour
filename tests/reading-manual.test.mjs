import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadingOutbox} from '../app/reading-outbox.mjs';
import {createReadingQueueStore} from '../app/reading-queue-store.mjs';
import {matchingSessionSnapshot} from '../app/save-receipts.mjs';
import {readingBook} from './reading-fixtures.mjs';
const module=()=>import('../app/reading-manual.mjs');
const input={id:'manual-1',book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC',startedAt:'2026-10-14T12:00:00.000Z',endedAt:'2026-10-14T12:10:00.000Z'};
const storage=()=>{const rows=new Map();return {get length(){return rows.size;},key:i=>[...rows.keys()][i]||null,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,String(v)),removeItem:k=>rows.delete(k)};};

test('manual local dates reject normalization and DST holes instead of silently shifting a self-report',async()=>{
 const {localReadingTimestamp,manualReadingSession}=await module();const old=process.env.TZ;process.env.TZ='America/New_York';
 try{
  assert.equal(localReadingTimestamp('2026-10-14T08:00'),'2026-10-14T12:00:00.000Z');
  for(const value of ['2026-02-30T08:00','2026-13-01T08:00','2026-03-08T02:30','2026-10-14T24:00','no date'])assert.throws(()=>localReadingTimestamp(value));
  assert.equal(localReadingTimestamp('2026-11-01T01:30'),'2026-11-01T05:30:00.000Z','the device-selected offset must be retained as the actual instant');
  const row=manualReadingSession(input,Date.parse('2026-10-15T00:00:00Z'));assert.equal(row.source,'manual');assert.equal(row.durationSeconds,600);assert.deepEqual(row.start,input.anchor);assert.equal(row.status,'finished');
  assert.throws(()=>manualReadingSession({...input,endedAt:input.startedAt}));
 }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('a lost ACK keeps the frozen manual ID and payload, and a fresh real queue can resume it exactly once',async()=>{
 const {manualReadingSession,createManualReadingAction}=await module(),store=storage(),scope='manual|owner|reading-test',queue=createReadingQueueStore({storage:store,scope,book:readingBook}),saved=new Map(),requests=[];let lost=true;
 const send=async row=>{requests.push(structuredClone(row));saved.set(row.id,saved.get(row.id)||row);if(lost){lost=false;throw Error('ACK lost after actual save');}return saved.get(row.id);};
 const outbox=createReadingOutbox({load:queue.load,save:queue.save,send}),action=createManualReadingAction({build:x=>manualReadingSession(x),own:queue.own,enqueue:outbox.enqueue,flush:outbox.flush,confirmed:outbox.confirmed});
 await assert.rejects(action.submit(input),/ACK lost/);assert.equal(action.pending().id,'manual-1');assert.equal(action.durable(),true);assert.equal(queue.all().length,1);
 await action.submit({...input,id:'different-id',endedAt:'2026-10-14T12:20:00.000Z'});assert.equal(action.pending(),null);assert.equal(saved.size,1);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(queue.pendingCount,0);
 // A second unsent snapshot survives constructing the real queue/outbox afresh.
 lost=true;await assert.rejects(action.submit({...input,id:'manual-2'}));const freshQueue=createReadingQueueStore({storage:store,scope,book:readingBook}),fresh=createReadingOutbox({load:freshQueue.load,save:freshQueue.save,send});assert.equal((await fresh.flush()).sent,1);assert.equal(saved.size,2);assert.equal(freshQueue.pendingCount,0);
});
test('storage failure retains the manual snapshot in memory without a server call or a fake durable receipt',async()=>{
 const {manualReadingSession,createManualReadingAction}=await module();let failing=true,sends=0,receipt=null;const queued=[];
 const action=createManualReadingAction({build:manualReadingSession,own:()=>{},enqueue:row=>{if(failing)throw Error('storage full');queued.push(structuredClone(row));},flush:async()=>{sends++;receipt=queued[0];return {sent:1};},confirmed:row=>matchingSessionSnapshot(row,receipt)});
 await assert.rejects(action.submit(input),/storage full/);assert.equal(sends,0);assert.equal(action.durable(),false);assert.equal(action.pending().durationSeconds,600);failing=false;await action.retry();assert.equal(sends,1);assert.equal(queued[0].id,'manual-1');assert.equal(action.pending(),null);
});
test('a finished receipt from a different source or interval is not confirmation of a manual record',async()=>{
 const row={id:'manual-1',bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,source:'manual',sequence:1,status:'finished',startedAt:input.startedAt,endedAt:input.endedAt,timeZone:'UTC',durationSeconds:600,start:input.anchor,end:input.anchor,segments:[{startedAt:input.startedAt,endedAt:input.endedAt}]};
 assert.equal(matchingSessionSnapshot(row,{...row,source:'reader_focus'}),false);
 assert.equal(matchingSessionSnapshot(row,{...row,startedAt:'2026-10-14T11:00:00.000Z'}),false);
 assert.equal(matchingSessionSnapshot(row,{...row,segments:[{startedAt:'2026-10-14T11:00:00.000Z',endedAt:row.endedAt}]}),false);
 assert.equal(matchingSessionSnapshot(row,{...row,recordedAt:'2026-10-17T00:00:00.000Z'}),true);
});
test('a background sync receipt cannot consume the foreground action acknowledgement while its flush is running',async()=>{
 const {manualReadingSession,createManualReadingAction}=await module();let release,receipt=null;const action=createManualReadingAction({build:manualReadingSession,own:()=>{},enqueue:row=>receipt=row,flush:()=>new Promise(r=>release=()=>r({sent:1})),confirmed:row=>matchingSessionSnapshot(row,receipt)});
 const submitted=action.submit(input);assert.equal(action.reconcile(),null);release();const saved=await submitted;assert.equal(saved.id,input.id);assert.equal(action.pending(),null);
});
