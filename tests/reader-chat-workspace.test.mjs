import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderChatWorkspace} from '../app/reader-chat-workspace.mjs';
import {createReadingNavigation} from '../app/reading-book.mjs';

class Element extends EventTarget{
 constructor(doc){super();this.doc=doc;this.children=[];this.attrs=new Map();this.values=new Map();this.inert=false;this.hidden=false;this.isConnected=true;this.style={setProperty:(k,v)=>this.values.set(k,v),getPropertyValue:k=>this.values.get(k)||'',removeProperty:k=>this.values.delete(k)};const classes=new Set();this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle:(k,v)=>v?classes.add(k):classes.delete(k)};}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
 prepend(n){n.parentElement=this;this.children.unshift(n);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
 contains(n){return this===n||this.children.some(c=>c.contains(n));}
 querySelectorAll(){return [];}querySelector(){return null;}
 focus(){this.doc.activeElement=this;}setPointerCapture(id){this.capture=id;}releasePointerCapture(){this.capture=null;}hasPointerCapture(id){return this.capture===id;}
 getBoundingClientRect(){return {width:440,left:1000,top:0,bottom:1000,height:1000};}
}
function fixture(width=1440,stored){
 const document=new EventTarget();document.createElement=()=>new Element(document);document.body=new Element(document);document.documentElement=new Element(document);document.activeElement=document.body;
 const root=new Element(document),book=new Element(document),header=new Element(document);header.inert=true;root.setAttribute('aria-modal','false');document.body.append(book,header,root);
 const window=new EventTarget(),frames=new Map();let id=0,currentBook={bookId:'one',contentVersion:'v1'};Object.assign(window,{innerWidth:width,requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 const writes=[],restored=[];const storage={getItem:()=>stored??null,setItem:(k,v)=>writes.push([k,v])};
 const reader={getBook:()=>currentBook,getAnchor:()=>({passageId:'p12',offset:104}),restoreAnchor:a=>restored.push(a)};
 const workspace=mountReaderChatWorkspace({root,document,window,storage,getReader:()=>reader,labels:{resize:'Resize AI workspace'}});
 const flush=()=>{for(let n=0;frames.size&&n<10;n++){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
 const key=(node,key,shiftKey=false)=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,shiftKey});node.dispatchEvent(event);return event;};
 return {workspace,root,book,header,document,window,reader,storage,writes,restored,flush,key,changeBook:()=>{currentBook={bookId:'two',contentVersion:'v1'};}};
}
test('desktop reserves book space and bounds keyboard resizing to the available reading column',()=>{
 const f=fixture();f.workspace.setOpen(true);const separator=f.root.children.find(n=>n.getAttribute('role')==='separator');assert.ok(separator);
 assert.equal(f.document.body.classList.contains('has-reader-chat'),true);assert.equal(separator.getAttribute('aria-valuenow'),'440');
 f.key(separator,'End');assert.equal(separator.getAttribute('aria-valuenow'),'640');f.key(separator,'Home');assert.equal(separator.getAttribute('aria-valuenow'),'320');
 f.key(separator,'ArrowLeft',true);assert.equal(separator.getAttribute('aria-valuenow'),'384');
 f.window.innerWidth=1100;f.window.dispatchEvent(new Event('resize'));f.key(separator,'End');assert.equal(separator.getAttribute('aria-valuenow'),'460');
 f.workspace.setOpen(false);assert.equal(f.document.body.classList.contains('has-reader-chat'),false);f.workspace.dispose();
});
test('phone containment restores pre-existing inert ownership across breakpoint changes and disposal',()=>{
 const f=fixture(390);f.workspace.setOpen(true);assert.equal(f.book.inert,true);assert.equal(f.header.inert,true);assert.equal(f.root.getAttribute('aria-modal'),'true');
 f.window.innerWidth=1440;f.window.dispatchEvent(new Event('resize'));assert.equal(f.book.inert,false);assert.equal(f.header.inert,true);assert.equal(f.root.getAttribute('aria-modal'),'false');
 f.window.innerWidth=390;f.window.dispatchEvent(new Event('resize'));f.workspace.dispose();assert.equal(f.book.inert,false);assert.equal(f.header.inert,true);assert.equal(f.root.getAttribute('aria-modal'),'false');
});
test('layout callbacks cannot restore a passage from a book that has since changed',()=>{
 const f=fixture();f.workspace.setOpen(true);f.changeBook();f.flush();assert.deepEqual(f.restored,[]);f.workspace.dispose();f.flush();assert.deepEqual(f.restored,[]);
});
test('opening the workspace restores the same live reading anchor after layout settles',()=>{
 const f=fixture();f.workspace.setOpen(true);f.flush();assert.deepEqual(f.restored,[{passageId:'p12',offset:104}]);f.workspace.dispose();
});
test('pointer resize persists only a completed gesture and releases capture on cancellation',()=>{
 const f=fixture();f.workspace.setOpen(true);const separator=f.root.children.find(n=>n.getAttribute('role')==='separator');
 const pointer=(type,x)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{button:0,pointerId:7,clientX:x});separator.dispatchEvent(e);};
 pointer('pointerdown',1000);pointer('pointermove',900);assert.equal(separator.getAttribute('aria-valuenow'),'540');assert.equal(f.writes.length,0);
 pointer('pointercancel',900);assert.equal(separator.getAttribute('aria-valuenow'),'440');assert.equal(separator.capture,null);
 pointer('pointerdown',1000);pointer('pointermove',900);pointer('pointerup',900);assert.equal(f.writes[0][1],'540');assert.equal(separator.capture,null);
 f.workspace.dispose();pointer('pointermove',800);assert.equal(f.writes.length,1);
});
test('invalid stored widths and denied persistence keep a usable bounded in-memory workspace',()=>{
 const f=fixture(1440,'400px');f.storage.setItem=()=>{throw Error('Denied');};f.workspace.setOpen(true);const separator=f.root.children.find(n=>n.getAttribute('role')==='separator');
 assert.equal(separator.getAttribute('aria-valuenow'),'440');assert.doesNotThrow(()=>f.key(separator,'ArrowLeft'));assert.equal(separator.getAttribute('aria-valuenow'),'456');f.workspace.dispose();
});
test('phone Tab and Shift+Tab stay in the actual conversation focus order',()=>{
 const f=fixture(390),first=new Element(f.document),last=new Element(f.document);f.root.append(first,last);
 for(const n of [first,last]){n.getClientRects=()=>[{}];n.closest=()=>null;}
 f.root.querySelectorAll=()=>[first,last];f.workspace.setOpen(true);last.focus();f.key(f.root,'Tab');assert.equal(f.document.activeElement,first);
 first.focus();f.key(f.root,'Tab',true);assert.equal(f.document.activeElement,last);f.workspace.dispose();
});
test('disposing a drag releases pointer capture without persisting an unfinished gesture',()=>{
 const f=fixture();f.workspace.setOpen(true);const separator=f.root.children.find(n=>n.getAttribute('role')==='separator');const e=new Event('pointerdown',{cancelable:true});Object.assign(e,{button:0,pointerId:9,clientX:1000});separator.dispatchEvent(e);assert.equal(separator.capture,9);f.workspace.dispose();assert.equal(separator.capture,null);assert.equal(f.writes.length,0);
});
test('a newer chapter navigation defeats the queued layout restore without cancelling the navigation',async()=>{
 const f=fixture(),commits=[];let ready;const source=new Promise(resolve=>{ready=resolve;});const nav=createReadingNavigation({isLoaded:()=>false,ensure:()=>source,commit:id=>commits.push(id)});
 f.reader.captureLayout=()=>nav.capture();f.workspace.setOpen(true);const pending=nav.navigate('next');f.flush();assert.deepEqual(f.restored,[]);ready();assert.equal(await pending,true);assert.deepEqual(commits,['next']);f.workspace.dispose();
});

test('new page, touch or reading-key intent defeats a queued old layout restore',()=>{
 for(const intent of ['reader:page','touchstart','keydown']){
  const f=fixture();f.workspace.setOpen(true);const event=new Event(intent);if(intent==='keydown')Object.assign(event,{key:'PageDown'});Object.defineProperty(event,'target',{value:f.book});f.document.dispatchEvent(event);f.flush();assert.deepEqual(f.restored,[],intent);f.workspace.dispose();
 }
});
