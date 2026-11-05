import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReaderChatWorkspace} from '../app/reader-chat-workspace.mjs';

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
test('every viewport contains one full-page destination without reflowing the reader',()=>{
 for(const width of [320,390,1440]){const f=fixture(width);f.workspace.setOpen(true);assert.equal(f.root.getAttribute('aria-modal'),'true');assert.equal(f.root.classList.contains('is-reader-chat-fullpage'),true);assert.equal(f.book.inert,true);assert.equal(f.header.inert,true);assert.equal(f.document.body.style.getPropertyValue('overflow'),'hidden');assert.equal(f.document.body.classList.contains('has-reader-chat'),false);assert.equal(f.document.body.style.getPropertyValue('--reader-chat-width'),'');f.flush();assert.deepEqual(f.restored,[]);f.workspace.setOpen(false);f.flush();assert.deepEqual(f.restored,[{passageId:'p12',offset:104}]);assert.equal(f.book.inert,false);assert.equal(f.header.inert,true);f.workspace.dispose();}
});
test('closing restores the captured reader position and retains prior overflow ownership',()=>{
 const f=fixture();f.document.body.style.setProperty('overflow','auto');f.workspace.setOpen(true);f.window.innerWidth=390;f.window.dispatchEvent(new Event('resize'));assert.equal(f.document.body.style.getPropertyValue('overflow'),'hidden');f.workspace.setOpen(false);assert.equal(f.document.body.style.getPropertyValue('overflow'),'auto');f.flush();assert.equal(f.restored.length,1);f.workspace.dispose();
});
test('reader popover mode keeps desktop reading available and uses a contained destination on phones',()=>{
 for(const width of [390,1440]){
  const f=fixture(width);f.workspace.dispose();const popup=mountReaderChatWorkspace({root:f.root,document:f.document,window:f.window,getReader:()=>f.reader,presentation:'popover'});
  popup.setOpen(true);assert.equal(popup.isFullPage(),width<900);assert.equal(f.book.inert,width<900);assert.equal(f.root.classList.contains('is-reader-chat-popover'),width>=900);
  popup.setOpen(false);popup.dispose();assert.equal(f.book.inert,false);
 }
});

test('a changed book or navigation ticket defeats the queued reading return',()=>{
 for(const kind of ['book','ticket','chapter']){const f=fixture();let valid=true;f.reader.captureLayout=()=>()=>valid;f.workspace.setOpen(true);if(kind==='book')f.changeBook();if(kind==='chapter')f.document.dispatchEvent(new Event('reader:chapter'));f.workspace.setOpen(false);if(kind==='ticket')valid=false;f.flush();assert.deepEqual(f.restored,[],kind);f.workspace.dispose();}
});
test('a phone conversation resized into a desktop popup cannot restore an obsolete reading anchor on close',()=>{
 const f=fixture(390);f.workspace.dispose();const popup=mountReaderChatWorkspace({root:f.root,document:f.document,window:f.window,getReader:()=>f.reader,presentation:'popover'});
 popup.setOpen(true);f.window.innerWidth=1440;f.window.dispatchEvent(new Event('resize'));assert.equal(popup.isFullPage(),false);
 f.reader.getAnchor=()=>({passageId:'p30',offset:300});popup.setOpen(false);f.flush();assert.deepEqual(f.restored,[]);popup.dispose();
});
test('browser Back closes the destination once and preserves the surrounding history state',()=>{
 const f=fixture(),stack=[{libraryView:'shelf'}];let index=0,pushes=0,backs=0,closes=0,workspace;
 f.window.history={get state(){return stack[index];},pushState(state){stack.splice(++index);stack[index]=state;pushes++;},replaceState(state){stack[index]=state;},back(){backs++;if(index>0)index--;f.window.dispatchEvent(new Event('popstate'));}};
 f.workspace.dispose();workspace=mountReaderChatWorkspace({root:f.root,document:f.document,window:f.window,getReader:()=>f.reader,onBack:()=>{closes++;workspace.setOpen(false);}});
 workspace.setOpen(true);assert.equal(pushes,1);assert.equal(f.window.history.state.libraryView,'shelf');f.window.history.back();assert.equal(closes,1);assert.equal(backs,1);assert.equal(workspace.isFullPage(),false);assert.deepEqual(f.window.history.state,{libraryView:'shelf'});f.flush();assert.equal(f.restored.length,1);
 workspace.setOpen(true);workspace.setOpen(false);assert.equal(backs,2);assert.equal(closes,1);workspace.dispose();
});
test('reopening before the return frame prevents an obsolete anchor restore',()=>{
 const f=fixture();f.workspace.setOpen(true);f.workspace.setOpen(false);f.workspace.setOpen(true);f.flush();assert.deepEqual(f.restored,[]);f.workspace.dispose();f.flush();assert.deepEqual(f.restored,[]);
});
test('Tab and Shift+Tab stay within the conversation at desktop and phone widths',()=>{
 for(const width of [390,1440]){const f=fixture(width),first=new Element(f.document),last=new Element(f.document);f.root.append(first,last);for(const n of [first,last]){n.getClientRects=()=>[{}];n.closest=()=>null;}f.root.querySelectorAll=()=>[first,last];f.workspace.setOpen(true);last.focus();f.key(f.root,'Tab');assert.equal(f.document.activeElement,first);first.focus();f.key(f.root,'Tab',true);assert.equal(f.document.activeElement,last);f.workspace.dispose();}
});
test('disposal releases only its inert and scroll ownership',()=>{
 const f=fixture();f.document.body.style.setProperty('overflow','auto');f.workspace.setOpen(true);f.workspace.dispose();assert.equal(f.book.inert,false);assert.equal(f.header.inert,true);assert.equal(f.root.getAttribute('aria-modal'),'false');assert.equal(f.document.body.style.getPropertyValue('overflow'),'auto');assert.equal(f.root.classList.contains('reader-chat-workspace'),false);
});

test('an explicit source jump cancels the queued close restore even without a reader layout ticket',()=>{
 const f=fixture();f.workspace.setOpen(true);f.workspace.setOpen(false);f.document.dispatchEvent(new Event('reader:jump'));f.flush();assert.deepEqual(f.restored,[]);f.workspace.dispose();
});

test('a citation return holds browser scroll restoration until after popstate, then restores its previous mode',()=>{
 for(const previous of ['auto','manual']){
  const f=fixture(),tasks=[];let state={},nativeRestores=0;
  f.window.setTimeout=fn=>tasks.push(fn);
  f.window.history={scrollRestoration:previous,get state(){return state;},pushState(next){state=next;},replaceState(next){state=next;},back(){state={};f.window.dispatchEvent(new Event('popstate'));if(this.scrollRestoration==='auto')nativeRestores++;}};
  f.workspace.setOpen(true);assert.equal(f.window.history.scrollRestoration,'manual');f.workspace.setOpen(false);f.document.dispatchEvent(new Event('reader:jump'));f.flush();assert.equal(nativeRestores,0);assert.deepEqual(f.restored,[]);assert.equal(f.window.history.scrollRestoration,'manual');tasks.splice(0).forEach(fn=>fn());assert.equal(f.window.history.scrollRestoration,previous);f.workspace.dispose();
 }
});

test('a new conversation inherits the original history mode while the previous workspace release is pending',()=>{
 const f=fixture(),tasks=[];let state={};
 f.window.setTimeout=fn=>tasks.push(fn);f.window.history={scrollRestoration:'auto',get state(){return state;},pushState(next){state=next;},replaceState(next){state=next;},back(){state={};f.window.dispatchEvent(new Event('popstate'));}};
 const other=new Element(f.document);f.document.body.append(other);const second=mountReaderChatWorkspace({root:other,document:f.document,window:f.window,getReader:()=>f.reader});
 f.workspace.setOpen(true);f.workspace.setOpen(false);second.setOpen(true);tasks.splice(0).forEach(fn=>fn());assert.equal(f.window.history.scrollRestoration,'manual','an old close cannot release the new conversation');second.setOpen(false);tasks.splice(0).forEach(fn=>fn());assert.equal(f.window.history.scrollRestoration,'auto');second.dispose();f.workspace.dispose();
});

test('reopening waits for an asynchronous history return and does not let its old popstate close the new destination',()=>{
 const f=fixture(),tasks=[],returns=[],stack=[{reader:true}];let index=0,pushes=0;
 f.window.setTimeout=fn=>tasks.push(fn);f.window.history={scrollRestoration:'auto',get state(){return stack[index];},pushState(next){stack.splice(++index);stack[index]=next;pushes++;},replaceState(next){stack[index]=next;},back(){const target=index-1;returns.push(()=>{index=target;f.window.dispatchEvent(new Event('popstate'));});}};
 f.workspace.setOpen(true);f.workspace.setOpen(false);f.workspace.setOpen(true);assert.equal(pushes,1);assert.equal(f.workspace.isFullPage(),true);returns.shift()();assert.equal(pushes,2);assert.equal(index,1);assert.equal(f.workspace.isFullPage(),true);tasks.splice(0).forEach(fn=>fn());assert.equal(f.window.history.scrollRestoration,'manual');f.workspace.setOpen(false);returns.shift()();tasks.splice(0).forEach(fn=>fn());assert.equal(index,0);assert.equal(f.window.history.scrollRestoration,'auto');assert.equal(f.workspace.isFullPage(),false);f.workspace.dispose();
});

test('an older release timer cannot release a later close before its own history return',()=>{
 const f=fixture(),tasks=[],returns=[];let state={};
 f.window.setTimeout=fn=>tasks.push(fn);f.window.history={scrollRestoration:'auto',get state(){return state;},pushState(next){state=next;},replaceState(next){state=next;},back(){returns.push(()=>{state={};f.window.dispatchEvent(new Event('popstate'));});}};
 f.workspace.setOpen(true);f.workspace.setOpen(false);returns.shift()();f.workspace.setOpen(true);f.workspace.setOpen(false);tasks.splice(0).forEach(fn=>fn());assert.equal(f.window.history.scrollRestoration,'manual');returns.shift()();tasks.splice(0).forEach(fn=>fn());assert.equal(f.window.history.scrollRestoration,'auto');f.workspace.dispose();
});
