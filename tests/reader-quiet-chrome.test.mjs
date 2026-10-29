import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';
import {mountReadingToolbar} from '../app/reading-toolbar.mjs';
import {mountReaderTools} from '../app/reader-tools.mjs';
import {mountReaderLocation} from '../app/reader-location.mjs';

async function setup(t) {
 t.mock.timers.enable({apis:['setTimeout']});
 const {document,win}=fixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8'));
 const previous=globalThis.MutationObserver;
 globalThis.MutationObserver=class {observe(){} disconnect(){}};
 const root=document.getElementById('reading-session');
 const tools=mountReaderTools({sessionRoot:root,document});
 win.ResizeObserver=class{observe(){}disconnect(){}};
 const location=mountReaderLocation({document,tools,getReader:()=>null});
 t.after(()=>{location.unmount();tools.unmount();globalThis.MutationObserver=previous;});
 return {document,win,root,tools,location};
}
function event(type,values={}) {const e=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(values))Object.defineProperty(e,key,{value});return e;}

test('closing companion restores the quiet reading edge without leaving the AI entry focused',async t=>{
 const {document,tools}=await setup(t);
 const slot=document.getElementById('reading-tools-chat-slot'),chat=document.createElement('button');
 chat.className='library-chat-trigger';slot.append(chat);
 tools.toolbar.reveal(false);tools.chatIntegration.onOpen();
 document.getElementById('reader-conversation').focus();
 assert.equal(tools.chatIntegration.focusReturn(),true);
 assert.equal(document.activeElement.id,'reading-tools-trigger');
 assert.equal(tools.toolbar.expanded,false);
});

test('focused reader wakes only on explicit edge activation, then sleeps within ten seconds',async t=>{
 const {document,tools}=await setup(t);
 const top=document.getElementById('reader-top-edge');assert.ok(top,'production reader needs an accessible top-edge target');
 document.dispatchEvent(event('pointermove',{pointerType:'mouse',clientY:8,buttons:0}));
 assert.equal(tools.toolbar.expanded,false);
 const bottom=document.getElementById('reading-tools-trigger');
 bottom.dispatchEvent(event('pointerenter',{pointerType:'mouse'}));assert.equal(tools.toolbar.expanded,false,'hover is not an explicit wake');
 top.dispatchEvent(event('click',{detail:1}));assert.equal(tools.toolbar.expanded,true);
 t.mock.timers.tick(10000);assert.equal(tools.toolbar.expanded,false);
 bottom.dispatchEvent(event('click',{detail:1}));assert.equal(tools.toolbar.expanded,true);
 document.dispatchEvent(event('scroll',{targetOverride:'unused'}));
 assert.equal(tools.toolbar.expanded,false,'ordinary document scroll puts controls to sleep');
});

test('reading scroll preserves a keyboard control, selection and a child dialog',async t=>{
 const {document,tools}=await setup(t);
 tools.toolbar.reveal(false);
 const input=document.createElement('input');document.getElementById('reading-tools-panel').append(input);
 assert.ok(input);input.focus();document.dispatchEvent(event('keydown',{key:'Tab'}));
 document.dispatchEvent(event('scroll'));t.mock.timers.tick(10000);
 assert.equal(tools.toolbar.expanded,true);assert.equal(document.activeElement,input);
 input.blur?.();document.activeElement=document.body;
 document.dispatchEvent(event('pointerdown',{pointerType:'touch'}));
 const selection={isCollapsed:false,toString:()=> 'selected source'};
 document.getSelection=()=>selection;
 document.dispatchEvent(event('scroll'));assert.equal(tools.toolbar.expanded,true);
 document.getSelection=()=>({isCollapsed:true,toString:()=>''});
 const dialog=document.getElementById('settings-dialog');dialog.showModal();
 document.dispatchEvent(event('scroll'));assert.equal(tools.toolbar.expanded,true);
 dialog.close();document.dispatchEvent(event('scroll'));assert.equal(tools.toolbar.expanded,false);
});

test('quiet edge subscriptions are removed on remount/disposal',async t=>{
 const {document,root,tools,location}=await setup(t);
 const top=document.getElementById('reader-top-edge');assert.ok(top);
 location.unmount();tools.unmount();
 top.dispatchEvent(event('click',{detail:1}));assert.equal(tools.toolbar.expanded,false);
});

test('paged reading scroll also sleeps, and a keyboard top-edge wake requests visible focus',async t=>{
 const {document,win,tools,location}=await setup(t);
 location.unmount();tools.unmount();
 let requested;
 const next=mountReaderTools({sessionRoot:document.getElementById('reading-session'),document,immersion:{showTools:options=>{requested=options.focus;},closeTools(){}}});
 const owner=mountReaderLocation({document,tools:next,getReader:()=>null});
 t.after(()=>{owner.unmount();next.unmount();});
 document.getElementById('reader-top-edge').dispatchEvent(event('click',{detail:0}));
 assert.equal(requested,true);
 document.getElementById('reading-pages').dispatchEvent(event('scroll'));
 assert.equal(next.toolbar.expanded,false);
});

test('only a completed short edge click is consumed; text drag, cancellation, links and long press keep native input',async t=>{
 const {document,tools}=await setup(t),body=document.body;
 const gesture=(extra={})=>{
  const p={pointerId:7,button:0,isPrimary:true,clientX:50,clientY:12,timeStamp:1000,...extra};
  document.dispatchEvent(event('pointerdown',p));
  if(extra.move)document.dispatchEvent(event('pointermove',{...p,clientX:100}));
  if(extra.cancel)document.dispatchEvent(event('pointercancel',p));
  document.dispatchEvent(event('pointerup',p));
  const click=event('click',{target:body,detail:1,clientY:12,timeStamp:1100,...extra});document.dispatchEvent(click);return click;
 };
 assert.equal(gesture({move:true}).defaultPrevented,false);assert.equal(tools.toolbar.expanded,false);
 assert.equal(gesture({cancel:true}).defaultPrevented,false);assert.equal(tools.toolbar.expanded,false);
 // A separate timestamp on click models holding the pointer, without a production timer.
 document.dispatchEvent(event('pointerdown',{pointerId:7,button:0,clientX:50,clientY:12,timeStamp:1000}));
 document.dispatchEvent(event('pointerup',{pointerId:7}));
 const hold=event('click',{target:body,detail:1,clientY:12,timeStamp:1800});document.dispatchEvent(hold);
 assert.equal(hold.defaultPrevented,false);assert.equal(tools.toolbar.expanded,false);
 const link=document.createElement('a');body.append(link);
 assert.equal(gesture({target:link}).defaultPrevented,false);assert.equal(tools.toolbar.expanded,false);
 document.getSelection=()=>({toString:()=> 'selected source'});
 assert.equal(gesture().defaultPrevented,false);assert.equal(tools.toolbar.expanded,false);
 document.getSelection=()=>({toString:()=> ''});
 assert.equal(gesture().defaultPrevented,true);assert.equal(tools.toolbar.expanded,true);
});

test('page navigation belongs to the sleeping tools panel rather than reserving reading space',async t=>{
 const {document,tools}=await setup(t);
 const pages=document.getElementById('page-turner'),panel=document.getElementById('reading-tools-panel');
 assert.ok(panel.contains(pages));assert.equal(document.getElementById('book-page').contains(pages),false);
 assert.equal(panel.inert,true);tools.toolbar.reveal(false);assert.equal(panel.inert,false);
});
