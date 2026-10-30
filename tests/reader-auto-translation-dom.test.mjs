import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderAutomaticTranslation} from '../app/reader-auto-translation.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.hidden=false;this.attrs={};this.textContent='';}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 insertBefore(node,before){node.parentElement=this;this.children.splice(this.children.indexOf(before),0,node);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
 setAttribute(name,value){this.attrs[name]=value;}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
function fixture({stored=null,request}={}){
 const doc=new EventTarget();doc.body=new Element('body');doc.hidden=false;doc.createElement=tag=>new Element(tag);doc.getElementById=id=>descendants(doc.body).find(n=>n.id===id);
 const details=new Element('details');details.id='translation-details';const mode=new Element('select');mode.id='view-mode';mode.value='zh';doc.body.append(details,mode);
 const book={bookId:'book',contentVersion:'v',sourceLanguage:'en',chapters:[{id:'current'},{id:'next'},{id:'third'}],sections:['current','next'].map(chapterId=>({chapterId,paragraphs:[{id:chapterId+'1',original:'Source',translations:{}}]}))},calls=[],receipts=[],ensured=[],writes=[];let locale='en',localeChanged;
 let selection=false;const painted=[];
 const reader={getBook:()=>book,getChapterId:()=> 'current',getState:()=>({mode:mode.value}),getAnchor:()=>({passageId:'current1'}),ensureChapter:async id=>ensured.push(id),isSelectionActive:()=>selection,repaintTranslationReceipts:ids=>painted.push(ids)};
 mode.addEventListener('change',()=>doc.dispatchEvent(new Event('reader:layout')));doc.addEventListener('reader:translation',e=>receipts.push(e.detail));
 const handle=mountReaderAutomaticTranslation({bookId:'book',session:{user:{id:'owner'},translationAvailable:true,billing:{enabled:true}},document:doc,getReader:()=>reader,getLocale:()=>locale,onLocaleChange:fn=>{localeChanged=fn;return()=>{};},storage:{getItem:()=>stored,setItem:(...args)=>writes.push(args)},request:async(url,options)=>{
  calls.push({url,options});if(request)return request(url,options);
  const body=JSON.parse(options.body);return Response.json({contentVersion:'v',phase:body.phase,chapterId:body.phase==='current'?'current':'next',done:true,passage:{id:body.phase+'1',original:'Source',translations:{literal:{text:'Literal'},interpretive:{text:'Interpretive'}}}});
 }});
 return {doc,handle,calls,receipts,ensured,writes,mode,painted,setSelection:value=>{selection=value;},controls:()=>doc.body.children.find(n=>n.tagName==='section').children,setLocale:value=>{locale=value;localeChanged();}};
}
test('automatic tools disclose cost, prepare only two chapters and retain their nodes on locale changes',async()=>{
 const f=fixture();await flush();await flush();const [label,cost,,retry,source]=f.controls();assert.equal(label.children[0].checked,true);assert.match(cost.textContent,/1 reading point/);assert.equal(retry.hidden,true);assert.equal(source.textContent,'Read original');
 assert.deepEqual(f.calls.map(c=>JSON.parse(c.options.body).phase),['current','next']);assert.deepEqual(f.ensured,['current','next']);assert.equal(f.receipts.length,2);assert.ok(f.receipts.every(r=>r.automatic&&r.reveal===false&&r.contentVersion==='v'));
 f.setLocale('zh-Hans');assert.equal(f.controls()[0],label);assert.match(cost.textContent,/1 阅读点/);assert.equal(f.calls.length,2);
 const toggle=label.children[0];toggle.checked=false;toggle.dispatchEvent(new Event('change'));assert.deepEqual(f.writes,[['marginalia-reading-translation-v1|owner|book','false']]);f.handle.dispose();
});
test('a persisted disable prevents all automatic requests and original choice remains available',async()=>{
 const f=fixture({stored:'false'});await flush();assert.equal(f.calls.length,0);const [label,,,,source]=f.controls();assert.equal(label.children[0].checked,false);source.dispatchEvent(new Event('click'));assert.equal(f.mode.value,'en');assert.equal(f.calls.length,0);f.handle.dispose();
});
test('identity invalidation aborts the browser request and ignores its eventual receipt',async()=>{
 let release;const response=new Promise(resolve=>{release=resolve;});const f=fixture({request:()=>response});await flush();assert.equal(f.calls.length,1);f.doc.dispatchEvent(new Event('reader:session-changed'));assert.equal(f.calls[0].options.signal.aborted,true);
 release(Response.json({contentVersion:'v',chapterId:'current',phase:'current',done:true,passage:{id:'current1'}}));await flush();assert.equal(f.receipts.length,0);assert.equal(f.calls.length,1);
});
test('automatic receipts save while selection is active and paint only after its release without changing mode',async()=>{
 const f=fixture();f.setSelection(true);await flush();await flush();assert.equal(f.receipts.length,2);assert.equal(f.painted.length,0);assert.equal(f.mode.value,'zh');
 f.setSelection(false);f.doc.dispatchEvent(new Event('reader:selection-end'));await flush();assert.deepEqual(f.painted,[['current1','next1']]);assert.equal(f.mode.value,'zh');f.handle.dispose();
});
