import test from 'node:test';
import assert from 'node:assert/strict';
import {manualReadingSession,createManualReadingAction} from '../app/reading-manual.mjs';
import {readingBook} from './reading-fixtures.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({queuedClose=false}={}){
 const doc={body:{},activeElement:null},fields=new Map();doc.activeElement=doc.body;
 class Field extends EventTarget{constructor(){super();this.value='';this.disabled=false;this.textContent='';}focus(){doc.activeElement=this;}}
 for(const key of ['form','#manual-reading-start','#manual-reading-end','#manual-reading-save','#manual-reading-status','#manual-reading-zone','#manual-reading-preview','[data-manual-close]'])fields.set(key,new Field());
 const closeTasks=[];const root=new Field();root.ownerDocument=doc;root.querySelector=key=>fields.get(key);root.showModal=()=>root.open=true;root.close=()=>{root.open=false;const emit=()=>root.dispatchEvent(new Event('close'));if(queuedClose)closeTasks.push(emit);else emit();};return {root,fields,doc,drainClose(){for(const emit of closeTasks.splice(0))emit();}};
}
test('manual form pauses on open and retains frozen inputs through a real action failure and explicit retry',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});
 const s=fixture(),pending=[],sent=[];let pauses=0,saved=0,lose=true,receipt=null,contextReads=0,actionReads=0;
 const action=createManualReadingAction({build:manualReadingSession,own:()=>{},enqueue:row=>pending.push(structuredClone(row)),flush:async()=>{sent.push(pending.at(-1));if(lose){lose=false;return {error:Error('temporary offline')};}receipt=sent.at(-1);return {sent:1};},confirmed:row=>receipt?.id===row.id});
 const ui=mountManualReading({root:s.root,getContext:()=>{contextReads++;return {book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'};},getAction:()=>{actionReads++;return action;},onOpen:()=>pauses++,onSaved:()=>saved++,now:()=>Date.parse('2026-10-14T13:00:00Z')});
 assert.equal(ui.open(),true);assert.equal(pauses,1);assert.match(s.fields.get('#manual-reading-zone').textContent,/UTC/);s.fields.get('#manual-reading-start').value='2026-10-14T12:00';s.fields.get('#manual-reading-end').value='2026-10-14T12:10';s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 assert.equal(saved,0);assert.equal(s.fields.get('#manual-reading-start').disabled,true);assert.equal(s.fields.get('#manual-reading-end').value,'2026-10-14T12:10');assert.match(s.fields.get('#manual-reading-status').textContent,/尚未确认/);assert.match(s.fields.get('#manual-reading-status').textContent,/本机/);assert.match(s.fields.get('#manual-reading-save').textContent,/重试/);
 const frozen=action.pending(),start=s.fields.get('#manual-reading-start'),end=s.fields.get('#manual-reading-end'),startValue=start.value,endValue=end.value;let writes=0;
 Object.defineProperty(start,'value',{configurable:true,get:()=>startValue,set(){writes++;}});Object.defineProperty(end,'value',{configurable:true,get:()=>endValue,set(){writes++;}});
 start.selectionStart=2;start.selectionEnd=5;start.focus();const reads={context:contextReads,action:actionReads};
 for(const [code,label] of [['en','Retry the same entry'],['ja','同じ記録を再試行'],['zh-Hant','重試同一次補記'],['zh-Hans','重试同一次补记']]){
  await requestUiRoute(code);assert.equal(s.fields.get('#manual-reading-save').textContent,label);assert.deepEqual(action.pending(),frozen);assert.equal(sent.length,1);assert.equal(pauses,1);assert.equal(s.doc.activeElement,start);assert.equal(start.selectionStart,2);assert.equal(start.selectionEnd,5);assert.equal(start.value,startValue);assert.equal(end.value,endValue);
 }
 assert.equal(writes,0);assert.deepEqual({context:contextReads,action:actionReads},reads,'locale reads only cached display state');
 s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(saved,1);assert.deepEqual(sent[0],sent[1]);assert.match(s.fields.get('#manual-reading-status').textContent,/已保存/);assert.equal(s.fields.get('#manual-reading-save').disabled,true);
 s.fields.get('[data-manual-close]').dispatchEvent(new Event('click'));assert.equal(s.root.open,false);
 ui.unmount();
});
test('invalid manual dates stay editable and never create or queue a record',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});const s=fixture();let submits=0;const action={pending:()=>null,submit:()=>submits++};
 const ui=mountManualReading({root:s.root,getContext:()=>({book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'}),getAction:()=>action,now:()=>Date.parse('2026-10-14T13:00:00Z')});ui.open();s.fields.get('#manual-reading-start').value='2026-02-30T12:00';s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(submits,0);assert.equal(s.fields.get('#manual-reading-start').disabled,false);assert.match(s.fields.get('#manual-reading-status').textContent,/不存在/);
});

test('manual close fences pending results before a queued native close event and old events cannot cancel a new open',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});
 for(const failure of [false,true]){
  const s=fixture({queuedClose:true}),enqueued=[];let release,receipt=null,saved=0,failed=0;
  const action=createManualReadingAction({build:manualReadingSession,own(){},enqueue:row=>enqueued.push(row),flush:async()=>{await new Promise(r=>release=r);if(failure)return {error:Error('Synthetic unavailable')};receipt=enqueued.at(-1);return {sent:1};},confirmed:row=>row.id===receipt?.id});
  const ui=mountManualReading({root:s.root,getContext:()=>({book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'}),getAction:()=>action,onSaved:()=>saved++,onFailure:()=>failed++,now:()=>Date.parse('2026-10-14T13:00:00Z')});
  ui.open();s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();s.fields.get('[data-manual-close]').dispatchEvent(new Event('click'));
  const closedText=s.fields.get('#manual-reading-status').textContent;release();await flush();assert.equal(saved,0);assert.equal(failed,0);assert.equal(s.fields.get('#manual-reading-status').textContent,closedText);
  assert.equal(ui.open(),true);s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();s.drainClose();release();await flush();
  assert.equal(s.root.open,true);assert.equal(failure?failed:saved,1,'the new explicit submission survives an older queued close event');ui.unmount();
 }
});

test('manual context A to B to A requires an explicit reopen and cannot adopt the old request',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});
 const s=fixture(),enqueued=[];let context={book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'},release,receipt,saved=0;
 const action=createManualReadingAction({build:manualReadingSession,own(){},enqueue:row=>enqueued.push(row),flush:async()=>{await new Promise(r=>release=r);receipt=enqueued.at(-1);return {sent:1};},confirmed:row=>row.id===receipt?.id});
 const ui=mountManualReading({root:s.root,getContext:()=>context,getAction:()=>action,onSaved:()=>saved++,now:()=>Date.parse('2026-10-14T13:00:00Z')});
 ui.open();s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();const original=context;context={...original,book:{...readingBook,bookId:'other-book'}};ui.refresh();context=original;ui.refresh();release();await flush();
 assert.equal(saved,0);assert.equal(s.fields.get('#manual-reading-save').disabled,true);assert.match(s.fields.get('#manual-reading-status').textContent,/重新打开补记/);ui.unmount();
});

test('a replaced manual action cannot receive the old form input before a refresh',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});
 const s=fixture(),rowsA=[],rowsB=[];
 const make=rows=>createManualReadingAction({build:manualReadingSession,own(){},enqueue:row=>rows.push(row),flush:async()=>({error:Error('Synthetic unavailable')}),confirmed:()=>false});
 const a=make(rowsA),b=make(rowsB);let action=a,ids=0;t.mock.method(crypto,'randomUUID',()=>{ids++;return 'manual-action-synthetic-id';});
 const ui=mountManualReading({root:s.root,getContext:()=>({book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'}),getAction:()=>action,now:()=>Date.parse('2026-10-14T13:00:00Z')});
 ui.open();action=b;s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 assert.equal(rowsA.length,0);assert.equal(rowsB.length,0);assert.equal(ids,0);assert.equal(b.pending(),null);assert.equal(s.fields.get('#manual-reading-save').disabled,true);assert.match(s.fields.get('#manual-reading-status').textContent,/重新打开补记/);ui.unmount();
});

test('a background confirmation cannot publish through a replaced manual action',async()=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),s=fixture(),a={pending:()=>null},b={pending:()=>null};let action=a,saved=0;
 const ui=mountManualReading({root:s.root,getContext:()=>({book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'}),getAction:()=>action,onSaved:()=>saved++});
 ui.open();action=b;ui.confirm({bookId:readingBook.bookId,contentVersion:readingBook.contentVersion,timeZone:'UTC',startedAt:'2026-10-14T12:00:00Z',endedAt:'2026-10-14T12:10:00Z'});
 assert.equal(saved,0);assert.match(s.fields.get('#manual-reading-status').textContent,/重新打开补记/);ui.unmount();
});
