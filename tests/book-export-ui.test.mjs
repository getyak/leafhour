import test from 'node:test';
import assert from 'node:assert/strict';
import {mountBookExport} from '../app/book-export-ui.mjs';
import {bookTransfer} from '../server/book-transfer.mjs';
import {readingBook} from './reading-fixtures.mjs';
import en from '../app/ui-catalogs/en.mjs';
const tick=()=>new Promise(setImmediate);
class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.doc=doc;this.children=[];this.attributes={};this.value='';this.disabled=false;this.hidden=false;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);if(this.tagName==='select'&&this.children.length===1)this.value=node.value;}}
 setAttribute(k,v){this.attributes[k]=v;}
 remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
 click(){if(this.tagName==='a')this.doc.downloads.push({name:this.download,href:this.href});else this.dispatchEvent(new Event('click'));}
}
const all=node=>[node,...node.children.flatMap(all)];
function fixture(t){
 const doc={downloads:[],createElement(tag){return new Element(tag,doc);}};doc.body=doc.createElement('body');const body=doc.createElement('section');doc.body.append(body);
 const old=URL.createObjectURL,blobs=[];URL.createObjectURL=b=>{blobs.push(b);return 'blob:test';};t.after(()=>{URL.createObjectURL=old;});
 let current=true;const notices=[],book=structuredClone(readingBook),api=async url=>url.endsWith('/document-export')?bookTransfer(book):bookTransfer(book,Number(new URL(url,'https://test.invalid').searchParams.get('offset')),new URL(url,'https://test.invalid').searchParams.get('snapshot'));
 const args={document:doc,body,book,api,current:()=>current,t:id=>en[id],locale:()=> 'en',notice:(...v)=>notices.push(v)};
 return {args,doc,body,book,blobs,notices,leave:()=>{current=false;},select:name=>all(body).find(n=>n.attributes['aria-label']===name),submit:()=>all(body).find(n=>n.tagName==='form').dispatchEvent(new Event('submit',{cancelable:true})),cancel:()=>all(body).find(n=>n.textContent===en['data.cancel'])};
}
test('book UI downloads only the chosen chapter and restores controls after a local Markdown save',async t=>{
 const f=fixture(t);await mountBookExport(f.args);f.select('Range').value='ch02';f.submit();await tick();
 assert.equal(f.doc.downloads.length,1);assert.match(f.doc.downloads[0].name,/-ch02.md$/);const text=await f.blobs[0].text();assert.ok(text.includes('Continue from here.'));assert.ok(!text.includes('Read this first.'));assert.equal(f.select('Range').disabled,false);
});
test('cancelling a pending PDF module prevents late download and permits a fresh Markdown retry',async t=>{
 const f=fixture(t);let resolve;await mountBookExport({...f.args,loadPdf:()=>new Promise(r=>{resolve=r;})});f.select('Export format').value='pdf';f.submit();await tick();f.cancel().click();
 resolve({documentPdf:async(doc,{assertCurrent})=>{assertCurrent();return new Uint8Array([1]);}});await tick();assert.equal(f.doc.downloads.length,0);assert.equal(f.select('Range').disabled,false);
 f.select('Export format').value='markdown';f.submit();await tick();assert.equal(f.doc.downloads.length,1);assert.equal(f.notices.at(-1)[0],'export.downloadRequested');
});
test('a closed or changed owner cannot resume a pending private source read',async t=>{
 const f=fixture(t);let resolve;const pending=mountBookExport({...f.args,api:()=>new Promise(r=>{resolve=r;})});f.leave();resolve(bookTransfer(f.book));await pending;assert.equal(f.doc.downloads.length,0);assert.ok(!f.notices.some(n=>n[0]==='export.ready'));
});
