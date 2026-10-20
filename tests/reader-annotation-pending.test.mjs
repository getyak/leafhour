import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnnotationPending,normalizeAnnotationOperation} from '../app/reader-annotation-pending.mjs';

const quote={kind:'leafhour-reading-quote',schemaVersion:1,bookId:'b',contentVersion:'v',chapterId:'c',parts:[{passageId:'p',layer:'literal',start:0,end:3,text:'选中文字',translationStatus:'draft'}]};
quote.parts[0].end=quote.parts[0].text.length;
const operation=()=>({phase:'highlight',input:{id:'r',threadId:'t',quote:structuredClone(quote),responseLocale:'ja'},highlight:{id:'highlight-request',bookId:'b',contentVersion:'v',chapterId:'c',parts:[{passageId:'p',language:'zh',variant:'literal',start:0,end:quote.parts[0].end,text:quote.parts[0].text}]}});
const memory=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};};
const open=(storage,owner='a',contentVersion='v')=>createAnnotationPending({storage,owner,bookId:'b',contentVersion});

test('an uncertain highlight and explanation retain exact identities through reload',()=>{
 const storage=memory(),first=open(storage),initial=operation();first.remember(initial);
 const second=open(storage);assert.deepEqual(second.current(),initial);
 const submitted=second.highlightSaved({...initial.highlight,id:'canonical-highlight'});assert.equal(submitted.input.highlightId,'canonical-highlight');assert.equal(submitted.input.id,'r');assert.equal(submitted.input.threadId,'t');assert.equal(submitted.input.responseLocale,'ja');
 const third=open(storage);assert.deepEqual(third.current(),submitted);assert.equal(third.abandonBeforeDispatch(),false);
 const changed=structuredClone(submitted);changed.input.id='new-paid-id';assert.throws(()=>third.remember(changed),error=>error.status===409);
 assert.equal(third.reconcile({id:'different',threadId:'t',status:'completed'}),false);assert.equal(third.reconcile({id:'r',threadId:'different',status:'failed'}),false);
 for(const status of ['running',null,undefined])assert.equal(third.reconcile({id:'r',threadId:'t',status}),false);
 assert.equal(third.reconcile({id:'r',threadId:'t',status:'completed'}),true);assert.equal(open(storage).current(),null);
});

test('owner/version scopes never expose another action and exact user words stay immutable',()=>{
 const storage=memory(),first=open(storage),value={phase:'explain',input:{...operation().input,text:'  实际合成用户的问题  '}};first.remember(value);
 assert.equal(open(storage,'b').current(),null);assert.equal(open(storage,'a','new-version').current(),null);
 assert.equal(open(storage).current().input.text,value.input.text);const changed=structuredClone(value);changed.input.quote.parts[0].translationStatus='reviewed';assert.throws(()=>first.remember(changed),error=>error.status===409);
 assert.equal(first.reconcile({id:'r',threadId:'t',status:'cancelled'}),true);assert.equal(first.current(),null);
});

test('storage failure retains the only in-memory operation and corrupt bytes are not erased',()=>{
 const storage={getItem:()=>null,setItem:()=>{throw Error('full');},removeItem:()=>{throw Error('full');}},state=open(storage);state.remember(operation());assert.deepEqual(state.current(),operation());assert.equal(state.status().durable,false);
 let raw='corrupt-private-recovery';const corrupt=open({getItem:()=>raw,setItem:()=>{throw Error();},removeItem:()=>{raw=null;}});assert.equal(corrupt.current(),null);assert.equal(corrupt.status().problem,true);assert.equal(raw,'corrupt-private-recovery');
});

test('invalid quotes, forged authority and malformed highlight transitions fail before dispatch',()=>{
 for(const mutate of [v=>v.input.origin='user',v=>v.input.responseLocale='invalid',v=>v.input.quote.parts[0].text='different',v=>v.highlight.parts[0].language='unknown',v=>v.input.text=' '.repeat(20)]){const value=operation();mutate(value);assert.throws(()=>normalizeAnnotationOperation(value));}
 const state=open(memory());state.remember(operation());assert.throws(()=>state.highlightSaved({id:'x',deletedAt:'now'}));assert.equal(state.current().phase,'highlight');
 const snapshot=state.current();snapshot.input.id='mutated';assert.equal(state.current().input.id,'r');
});

test('an unconfirmed server outcome keeps the request, while an explicit preflight refusal allows a new selection',()=>{
 const state=open(memory()),value={phase:'explain',input:operation().input};state.remember(value);
 for(const status of [undefined,200,408,429,500,503]){assert.equal(state.rejectPreflight(status),false);assert.deepEqual(state.current(),value);}
 assert.equal(state.rejectPreflight(422),true);assert.equal(state.current(),null);
 const next=operation();next.input.id='explicit-new-action';state.remember(next);assert.equal(state.current().input.id,'explicit-new-action');
});
