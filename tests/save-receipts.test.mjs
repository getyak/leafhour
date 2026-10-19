import test from 'node:test';
import assert from 'node:assert/strict';
import {noteSaveReceipt,readingSessionReceipt,matchingSessionSnapshot} from '../app/save-receipts.mjs';
import {createReadingOutbox} from '../app/reading-outbox.mjs';
const final={id:'this-session',sequence:3,status:'finished',durationSeconds:15,end:{chapterId:'c1',passageId:'p1'}};
test('JSONB key reordering does not reject exact interval receipts or accept changed intervals',()=>{
 const expected={...final,segments:[{startedAt:'2026-10-17T01:00:00.000Z',endedAt:'2026-10-17T01:00:05.000Z'},{startedAt:'2026-10-17T01:00:10.000Z',endedAt:'2026-10-17T01:00:20.000Z'}]},received={...expected,segments:expected.segments.map(s=>({endedAt:s.endedAt,startedAt:s.startedAt}))};
 assert.equal(matchingSessionSnapshot(expected,received),true);
 for(const segments of [[...received.segments].reverse(),received.segments.slice(0,1),[null,received.segments[1]],[{},received.segments[1]],[[received.segments[0]],received.segments[1]],new Array(2),[{...received.segments[0],endedAt:'2026-10-17T01:00:06.000Z'},received.segments[1]]])assert.equal(matchingSessionSnapshot(expected,{...received,segments}),false);
});
test('note confirmation distinguishes a saved submission from a newer memory-only draft',()=>{
  assert.equal(noteSaveReceipt({confirmed:true,durable:true,hasDraft:false}),'已保存到自己的书房。');
  assert.match(noteSaveReceipt({confirmed:true,durable:false,hasDraft:true}),/上次提交已保存.*仅在当前页面/);
});
test('failed note submission only claims a local draft when the current text was persisted',()=>{
  assert.match(noteSaveReceipt({confirmed:false,durable:true}),/尚未确认.*本机草稿/);
  const memory=noteSaveReceipt({confirmed:false,durable:false});assert.match(memory,/仅在当前页面.*复制/);assert.doesNotMatch(memory,/已留本机|本机草稿/);
});
test('session receipts distinguish memory, durable pending and this exact final confirmation',()=>{
  assert.match(readingSessionReceipt({confirmed:false,durable:false}),/仅在当前页面/);
  assert.match(readingSessionReceipt({confirmed:false,durable:true}),/已留本机.*尚未确认/);
  assert.match(readingSessionReceipt({confirmed:true,durable:false}),/时段已保存到书房/);
  assert.equal(matchingSessionSnapshot(final,{...final,sequence:2}),false);
  assert.equal(matchingSessionSnapshot(final,{...final,status:'paused'}),false);
  assert.equal(matchingSessionSnapshot(final,{...final,end:{chapterId:'c1',passageId:'p2'}}),false);
  assert.equal(matchingSessionSnapshot(final,structuredClone(final)),true);
});
test('an earlier checkpoint acknowledgment cannot confirm the final snapshot, even if another batch succeeded',async()=>{
  let disk=[],release,failFinal=true;
  const q=createReadingOutbox({load:()=>disk,save:rows=>disk=rows,send:row=>row.sequence===1?new Promise(resolve=>release=()=>resolve(row)):failFinal?Promise.reject(Error('offline')):Promise.resolve(row)});
  const checkpoint={...final,sequence:1,status:'paused'};q.enqueue(checkpoint);const work=q.flush();q.enqueue(final);release();await work;
  assert.equal(q.confirmed(final),false);assert.equal(disk[0].sequence,3);
  failFinal=false;await q.flush();assert.equal(q.confirmed(final),true);
});
test('a real server acknowledgment remains confirmed if removing the local queue then fails',async()=>{
  let disk=[],fail=false;const q=createReadingOutbox({load:()=>disk,save:rows=>{if(fail)throw Error('quota');disk=rows;},send:async row=>row});q.enqueue(final);fail=true;
  const result=await q.flush();assert.match(result.error.message,/quota/);assert.equal(q.confirmed(final),true);
});

test('the same session id in a different book or source version cannot confirm this ending',()=>{
  assert.equal(matchingSessionSnapshot({...final,bookId:'a',contentVersion:'v1'},{...final,bookId:'b',contentVersion:'v1'}),false);
  assert.equal(matchingSessionSnapshot({...final,bookId:'a',contentVersion:'v1'},{...final,bookId:'a',contentVersion:'v2'}),false);
});
test('position confirmation remains separate from local persistence and delayed older saves',async()=>{
  const receipts=await import('../app/save-receipts.mjs');assert.equal(typeof receipts.positionSaveState,'function');
  const first={chapterId:'c',passageId:'p',contentVersion:'v',offset:100,localSequence:1,localWriterId:'tab'};
  assert.deepEqual(receipts.positionSaveState(first,first,{durable:false}),{confirmed:true,durable:false,unresolved:false});
  const newer={...first,offset:110,localSequence:2};
  assert.equal(receipts.positionSaveState(newer,first,{durable:true}).confirmed,false);
  assert.equal(receipts.positionSaveState(first,{...first,localWriterId:'other'},{durable:true}).confirmed,false);
  assert.equal(receipts.positionSaveState(first,first,{durable:true,unresolved:true}).confirmed,false);
});

test('editing after a saved note replaces its old success receipt with the new draft state',async()=>{
  const receipts=await import('../app/save-receipts.mjs');assert.equal(typeof receipts.draftSaveReceipt,'function');
  assert.match(receipts.draftSaveReceipt({durable:true}),/草稿.*尚未提交.*已留本机/);
  assert.match(receipts.draftSaveReceipt({durable:false}),/草稿.*仅在当前页面/);
  assert.doesNotMatch(receipts.draftSaveReceipt({durable:true}),/已保存到.*书房/);
});

test('real draft persistence failure preserves the retry identity and new memory text without claiming durability',async()=>{
  const {createReadingDraftStore}=await import('../app/reading-draft-store.mjs'),{readingBook}=await import('./reading-fixtures.mjs');
  const rows=new Map();let fail=false;
  const storage={get length(){return rows.size;},key:i=>[...rows.keys()][i]??null,getItem:key=>rows.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('quota');rows.set(key,value);},removeItem:key=>rows.delete(key)};
  const scope='isolated-note-receipt',key='comment:'+readingBook.sections[0].paragraphs[0].id;
  const drafts=createReadingDraftStore({storage,scope,book:readingBook});drafts.edit(key,'Submitted');const id=drafts.activeId(key),submitted=drafts.begin(key,{passageId:key.slice(8),contentVersion:readingBook.contentVersion},()=> 'same-submission');drafts.persist();
  fail=true;drafts.edit(key,'New text while saving');assert.throws(()=>drafts.persist(),/quota/);assert.equal(drafts.acknowledge(key,submitted,id),true);drafts.finish(key,id);assert.throws(()=>drafts.persist(),/quota/);assert.equal(drafts.text(key),'New text while saving');
  assert.equal(createReadingDraftStore({storage,scope,book:readingBook}).list()[0].pending.id,'same-submission');
  assert.match(noteSaveReceipt({confirmed:true,durable:false,hasDraft:true}),/仅在当前页面/);
  fail=false;drafts.persist();assert.equal(createReadingDraftStore({storage,scope,book:readingBook}).list()[0].text,'New text while saving');
});

test('toolbar cannot reuse an old ending receipt during initial empty sync or a newly active session',async()=>{
  const receipts=await import('../app/save-receipts.mjs');assert.equal(typeof receipts.currentSessionReceipt,'function');
  const confirmed={confirmed:true,durable:false};
  assert.equal(receipts.currentSessionReceipt({status:'idle'},final,confirmed),'');
  assert.equal(receipts.currentSessionReceipt({status:'active',id:'new-reading'},final,confirmed),'');
  assert.equal(receipts.currentSessionReceipt({status:'finished',id:'different-reading'},final,confirmed),'');
  assert.match(receipts.currentSessionReceipt({status:'finished',id:final.id},final,confirmed),/时段已保存到书房/);
});

test('an unconfirmed final remains durable and a later exact receipt really retries it',async()=>{
  const submitted={...final,bookId:'book-a',contentVersion:'version-a'};
  const mismatches=[
    {id:submitted.id,sequence:submitted.sequence},
    {...submitted,sequence:submitted.sequence+1,status:'active'},
    {...submitted,sequence:submitted.sequence+1},
    {...submitted,sequence:submitted.sequence+1,contentVersion:'version-b'},
    {...submitted,sequence:submitted.sequence+1,end:{chapterId:'c1',passageId:'other'}},
    {...submitted,contentVersion:'version-b'},
    {...submitted,bookId:'book-b'},
    {...submitted,end:{chapterId:'c1',passageId:'other'}},
    {...submitted,durationSeconds:submitted.durationSeconds+1}
  ];
  for(const receipt of mismatches){
    let disk=[],reply=receipt,calls=0;const q=createReadingOutbox({load:()=>disk,save:rows=>disk=rows,send:async()=>{calls++;return reply;}});q.enqueue(submitted);const result=await q.flush();
    assert.equal(result.error?.status,502,JSON.stringify(receipt));assert.equal(result.remaining,1);assert.equal(result.sent,0);
    assert.equal(q.confirmed(submitted),false);assert.deepEqual(disk,[submitted]);
    reply=structuredClone(submitted);q.refresh();const retry=await q.flush();
    assert.equal(calls,2,'retry must send the retained final again');assert.equal(retry.error,null);assert.equal(retry.remaining,0);assert.equal(disk.length,0);assert.equal(q.confirmed(submitted),true);
  }
  let disk=[];const q=createReadingOutbox({load:()=>disk,save:rows=>disk=rows,send:async()=>structuredClone(submitted)});q.enqueue(submitted);await q.flush();assert.equal(q.confirmed(submitted),true);
});

test('receipt descriptors carry the exact confirmed and durable state without changing the payload or inventing a current ending',async()=>{
  const {draftSaveReceipt,currentSessionReceipt}=await import('../app/save-receipts.mjs');
  const descriptor=(id,params)=>({id,params});
  for(const [state,id]of [
    [{confirmed:true,hasDraft:false},'receipt.note.saved'],
    [{confirmed:true,hasDraft:true,durable:true},'receipt.note.savedDraftLocal'],
    [{confirmed:true,hasDraft:true,durable:false},'receipt.note.savedDraftMemory'],
    [{confirmed:false,durable:true},'receipt.note.pendingLocal'],
    [{confirmed:false,durable:false},'receipt.note.pendingMemory']
  ]){const frozen=Object.freeze({...state});assert.deepEqual(noteSaveReceipt(frozen,descriptor),{id,params:{}});assert.deepEqual(frozen,state);}
  assert.deepEqual(readingSessionReceipt({confirmed:true,durable:false},descriptor),{id:'receipt.session.saved',params:{}});
  assert.deepEqual(readingSessionReceipt({confirmed:false,durable:true},descriptor),{id:'receipt.session.pendingLocal',params:{}});
  assert.deepEqual(readingSessionReceipt({confirmed:false,durable:false},descriptor),{id:'receipt.session.pendingMemory',params:{}});
  assert.deepEqual(draftSaveReceipt({durable:true},descriptor),{id:'receipt.draft.local',params:{}});
  assert.deepEqual(draftSaveReceipt({durable:false},descriptor),{id:'receipt.draft.memory',params:{}});
  let formats=0;const format=(...args)=>{formats++;return descriptor(...args);};
  assert.equal(currentSessionReceipt({status:'active',id:final.id},final,{confirmed:true},format),'');assert.equal(formats,0);
  assert.deepEqual(currentSessionReceipt({status:'finished',id:final.id},final,{confirmed:true},format),{id:'receipt.session.saved',params:{}});assert.equal(formats,1);
});
