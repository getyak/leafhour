import test from 'node:test';
import assert from 'node:assert/strict';
const module=()=>import('../app/reading-outbox.mjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const row=(id='reading-a',sequence=1)=>({id,sequence,source:'reader_focus',bookId:'book-a',status:'paused',durationSeconds:30});

test('one pending session keeps its newest sequence and successful delivery removes only that snapshot',async()=>{
  const {createReadingOutbox}=await module();let disk=[];const q=createReadingOutbox({load:()=>disk,save:v=>disk=structuredClone(v),send:async v=>({id:v.id,sequence:v.sequence})});q.enqueue(row());q.enqueue(row('reading-a',3));q.enqueue(row('reading-a',2));assert.equal(q.size,1);assert.equal(disk[0].sequence,3);assert.equal((await q.flush()).sent,1);assert.equal(disk.length,0);
});
test('a late acknowledgment cannot remove a newer snapshot queued while a write was running',async()=>{
  const {createReadingOutbox}=await module(),first=deferred(),second=deferred(),secondStarted=deferred();let disk=[];const q=createReadingOutbox({load:()=>disk,save:v=>disk=structuredClone(v),send:async v=>{if(v.sequence===1)return first.promise;secondStarted.resolve();return second.promise;}});q.enqueue(row());const running=q.flush();q.enqueue(row('reading-a',2));first.resolve({id:'reading-a',sequence:1});await secondStarted.promise;assert.equal(q.size,1);assert.equal(disk[0].sequence,2);second.resolve({id:'reading-a',sequence:2});await running;assert.equal(disk.length,0);
});
test('a network failure survives module reconstruction and can be retried later',async()=>{
  const {createReadingOutbox}=await module();let disk=[];const save=v=>disk=structuredClone(v),first=createReadingOutbox({load:()=>disk,save,send:async()=>{throw Error('offline');}});first.enqueue(row());const result=await first.flush();assert.equal(result.remaining,1);assert.equal(result.error.message,'offline');assert.equal(disk.length,1);const fresh=createReadingOutbox({load:()=>disk,save,send:async v=>({id:v.id,sequence:v.sequence})});await fresh.flush();assert.equal(disk.length,0);
});
test('the pending limit protects all20 entries and still permits updating an existing session',async()=>{
  const {createReadingOutbox}=await module();let disk=[];const q=createReadingOutbox({load:()=>disk,save:v=>disk=structuredClone(v),send:async v=>v});for(let i=0;i<20;i++)q.enqueue(row('r-'+i));assert.throws(()=>q.enqueue(row('r-20')));assert.equal(disk.length,20);q.enqueue(row('r-0',2));assert.equal(disk[0].sequence,2);assert.equal(disk.at(-1).id,'r-19');
});
test('failed local persistence does not pretend the new snapshot is safely queued',async()=>{
  const {createReadingOutbox}=await module();const q=createReadingOutbox({load:()=>[],save:()=>{throw Error('quota');},send:async v=>v});assert.throws(()=>q.enqueue(row()),/quota/);assert.equal(q.size,0);
});
test('wrong or stale server receipts leave the original snapshot available for retry',async()=>{
  const {createReadingOutbox}=await module();for(const receipt of [{id:'wrong',sequence:3},{id:'reading-a',sequence:0},{}]){let disk=[];const q=createReadingOutbox({load:()=>disk,save:v=>disk=structuredClone(v),send:async()=>receipt});q.enqueue(row());const result=await q.flush();assert.equal(result.remaining,1);assert.equal(disk[0].id,'reading-a');}
});
test('separate owner stores never deliver each other’s pending reading records',async()=>{
  const {createReadingOutbox}=await module();const disks={a:[],b:[]},received={a:[],b:[]},make=owner=>createReadingOutbox({load:()=>disks[owner],save:v=>disks[owner]=structuredClone(v),send:async v=>{received[owner].push(v);return v;}}),a=make('a'),b=make('b');a.enqueue(row('a'));b.enqueue(row('b'));await b.flush();assert.equal(disks.a.length,1);assert.deepEqual(received.b.map(v=>v.id),['b']);assert.equal(received.a.length,0);
});
test('simultaneous flushes share completion and a corrupted cache is not silently replaced',async()=>{
  const {createReadingOutbox}=await module(),gate=deferred();let disk=[];const q=createReadingOutbox({load:()=>disk,save:v=>disk=structuredClone(v),send:()=>gate.promise});q.enqueue(row());const a=q.flush(),b=q.flush();assert.equal(a,b);gate.resolve(row());await a;assert.equal(disk.length,0);assert.throws(()=>createReadingOutbox({load:()=>({invalid:true}),save:()=>{},send:async()=>{}}));
});
