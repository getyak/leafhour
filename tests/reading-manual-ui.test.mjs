import test from 'node:test';
import assert from 'node:assert/strict';
import {manualReadingSession,createManualReadingAction} from '../app/reading-manual.mjs';
import {readingBook} from './reading-fixtures.mjs';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 const doc={body:{},activeElement:null},fields=new Map();doc.activeElement=doc.body;
 class Field extends EventTarget{constructor(){super();this.value='';this.disabled=false;this.textContent='';}focus(){doc.activeElement=this;}}
 for(const key of ['form','#manual-reading-start','#manual-reading-end','#manual-reading-save','#manual-reading-status','#manual-reading-zone','#manual-reading-preview','[data-manual-close]'])fields.set(key,new Field());
 const root=new Field();root.ownerDocument=doc;root.querySelector=key=>fields.get(key);root.showModal=()=>root.open=true;root.close=()=>{root.open=false;root.dispatchEvent(new Event('close'));};return {root,fields,doc};
}
test('manual form pauses on open and retains frozen inputs through a real action failure and explicit retry',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});
 const s=fixture(),pending=[],sent=[];let pauses=0,saved=0,lose=true,receipt=null;
 const action=createManualReadingAction({build:manualReadingSession,own:()=>{},enqueue:row=>pending.push(structuredClone(row)),flush:async()=>{sent.push(pending.at(-1));if(lose){lose=false;return {error:Error('temporary offline')};}receipt=sent.at(-1);return {sent:1};},confirmed:row=>receipt?.id===row.id});
 const ui=mountManualReading({root:s.root,getContext:()=>({book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'}),getAction:()=>action,onOpen:()=>pauses++,onSaved:()=>saved++,now:()=>Date.parse('2026-10-14T13:00:00Z')});
 assert.equal(ui.open(),true);assert.equal(pauses,1);assert.match(s.fields.get('#manual-reading-zone').textContent,/UTC/);s.fields.get('#manual-reading-start').value='2026-10-14T12:00';s.fields.get('#manual-reading-end').value='2026-10-14T12:10';s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 assert.equal(saved,0);assert.equal(s.fields.get('#manual-reading-start').disabled,true);assert.equal(s.fields.get('#manual-reading-end').value,'2026-10-14T12:10');assert.match(s.fields.get('#manual-reading-status').textContent,/尚未确认/);assert.match(s.fields.get('#manual-reading-status').textContent,/本机/);assert.match(s.fields.get('#manual-reading-save').textContent,/重试/);
 s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(saved,1);assert.deepEqual(sent[0],sent[1]);assert.match(s.fields.get('#manual-reading-status').textContent,/已保存/);assert.equal(s.fields.get('#manual-reading-save').disabled,true);
 s.fields.get('[data-manual-close]').dispatchEvent(new Event('click'));assert.equal(s.root.open,false);
});
test('invalid manual dates stay editable and never create or queue a record',async t=>{
 const {mountManualReading}=await import('../app/reading-manual-ui.mjs'),old=process.env.TZ;process.env.TZ='UTC';t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;});const s=fixture();let submits=0;
 const ui=mountManualReading({root:s.root,getContext:()=>({book:readingBook,anchor:{chapterId:'ch01',passageId:'p1'},timeZone:'UTC'}),getAction:()=>({pending:()=>null,submit:()=>submits++}),now:()=>Date.parse('2026-10-14T13:00:00Z')});ui.open();s.fields.get('#manual-reading-start').value='2026-02-30T12:00';s.fields.get('form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(submits,0);assert.equal(s.fields.get('#manual-reading-start').disabled,false);assert.match(s.fields.get('#manual-reading-status').textContent,/不存在/);
});
