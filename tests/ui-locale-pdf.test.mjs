import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPdfOnboarding} from '../app/pdf-onboarding.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';

class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attrs=new Map();this.textContent='';this.className='';this.hidden=false;this.open=false;this.disabled=false;}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 get isConnected(){return this.ownerDocument.body.contains(this);}
 setAttribute(key,value){this.attrs.set(key,String(value));}
 getAttribute(key){return this.attrs.get(key)||null;}
 querySelectorAll(selector){const rows=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);return selector==='*'?rows:rows.filter(row=>row.tagName===selector.toUpperCase());}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){this.ownerDocument.activeElement=this;}
 showModal(){this.open=true;}
 close(){this.open=false;const emit=()=>this.dispatchEvent(new Event('close'));if(this.ownerDocument.closeEvents)this.ownerDocument.closeEvents.push(emit);else emit();}
}
const tick=()=>new Promise(setImmediate);
const job={id:'11111111-1111-4111-8111-111111111111',filename:'来源/阅读.pdf',state:'awaiting_consent',completedPages:3,totalPages:8,recognitionPages:5,ocrAvailable:true,sourceHash:'synthetic-hash'};
async function fixture(t,{api=async()=>({jobs:[job]})}={}){
 await requestUiRoute('en');
 const doc=new EventTarget(),view=new EventTarget(),values=new Map();doc.createElement=tag=>new Element(tag,doc);doc.body=new Element('body',doc);doc.hidden=false;doc.defaultView=view;
 view.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 const root=doc.createElement('section');doc.body.append(root);let revision=0,owner='a',done=0,opens=0;
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let sequence=0;
 globalThis.setTimeout=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const calls=[];
 const controller=mountPdfOnboarding({document:doc,root,api:async(...args)=>{calls.push(args);return api(...args);},getSession:()=>({user:{id:owner}}),capture:()=>({owner,revision}),isCurrent:ticket=>ticket.owner===owner&&ticket.revision===revision,onOpen:()=>opens++,onDone:()=>done++});
 t.after(async()=>{controller.dispose();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;await requestUiRoute('en');});
 return {doc,root,controller,calls,timers,values,counts:()=>({done,opens}),switch(next){owner=next;revision++;controller.reset();}};
}

test('actual PDF owner relabels consent/progress in place without a poll, action, timer reset or source rewrite',async t=>{
 const f=await fixture(t);await f.controller.refresh();const row=f.root.children[0],nodes=[...row.children],buttons=row.querySelectorAll('button'),privacy=row.querySelector('details');privacy.open=true;buttons[1].focus();
 const poll=[...f.timers].find(([,timer])=>timer.delay===10000),requests=f.calls.length,title=row.querySelector('h3');
 row.replaceChildren=()=>assert.fail('locale must not rebuild job');row.children[3].replaceChildren=()=>assert.fail('locale must not rebuild consent');row.children[4].replaceChildren=()=>assert.fail('locale must not replace actions');
 for(const locale of ['ja','zh-Hant','zh-Hans','en']){
  await requestUiRoute(locale);assert.deepEqual(row.children,nodes);assert.equal(title.textContent,job.filename);assert.equal(f.doc.activeElement,buttons[1]);assert.equal(privacy.open,true);assert.equal(f.calls.length,requests);assert.equal(f.timers.get(poll[0]),poll[1]);assert.equal(row.querySelector('progress').value,3);assert.equal(row.querySelector('progress').max,8);assert.equal(f.root.getAttribute('lang'),locale);
 }
 assert.equal(buttons[0].textContent,'Allow recognition and continue');assert.equal(row.querySelector('p').textContent,'Permission is needed to recognize scanned pages · 3 / 8 pages');assert.deepEqual(f.counts(),{done:0,opens:0});assert.equal(f.calls.some(([,body])=>body?.confirm),false);
});

test('PDF preview uses current UI for owned labels while excerpts and filename stay literal',async t=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});
 const f=await fixture(t,{api:async url=>url.endsWith('/preview')?pending:{jobs:[job]}});await f.controller.refresh();const row=f.root.children[0],previewButton=row.querySelectorAll('button')[1];previewButton.focus();previewButton.dispatchEvent(new Event('click'));await tick();
 const requests=f.calls.length;await requestUiRoute('ja');assert.equal(f.calls.length,requests);
 resolve({completedPages:3,totalPages:8,pages:[{page:2,text:'来源 / 阅读 — original text'}]});await tick();await tick();
 const dialog=f.doc.body.querySelector('dialog');assert.equal(dialog.open,true);assert.equal(dialog.querySelector('h2').textContent,job.filename);assert.equal(dialog.querySelector('h3').textContent,'PDF 2 ページ');const excerpt=dialog.querySelectorAll('p').at(-1);assert.equal(excerpt.textContent,'来源 / 阅读 — original text');
 const pageNodes=[...dialog.children];await requestUiRoute('zh-Hant');assert.deepEqual(dialog.children,pageNodes);assert.equal(excerpt.textContent,'来源 / 阅读 — original text');assert.equal(f.calls.length,requests);
});

for(const dispose of [false,true])test('PDF '+(dispose?'disposal':'owner ABA')+' invalidates a pending preview without opening it or reviving task UI',async t=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});const f=await fixture(t,{api:async url=>url.endsWith('/preview')?pending:{jobs:[job]}});await f.controller.refresh();f.root.querySelectorAll('button')[1].dispatchEvent(new Event('click'));await tick();
  if(dispose)f.controller.dispose();else{f.switch('b');f.switch('a');}
  resolve({completedPages:3,totalPages:8,pages:[{page:1,text:'late original'}]});await tick();await tick();await requestUiRoute('ja');
  assert.equal(f.root.children.length,0);assert.equal(f.doc.body.querySelector('dialog')?.open||false,false);assert.equal([...f.timers.values()].some(timer=>timer.delay===2500||timer.delay===10000),false);assert.deepEqual(f.counts(),{done:0,opens:0});
});

test('newest preview wins across two real rows; older completion releases only its row without stealing dialog focus',async t=>{
 const other={...job,id:'22222222-2222-4222-8222-222222222222',filename:'Second original.pdf'},resolvers=new Map();
 const f=await fixture(t,{api:async url=>url.endsWith('/preview')?new Promise(resolve=>resolvers.set(url.split('/').at(-2),resolve)):{jobs:[job,other]}});await f.controller.refresh();
 const first=f.root.children[0].querySelectorAll('button')[1],second=f.root.children[1].querySelectorAll('button')[1];first.dispatchEvent(new Event('click'));second.dispatchEvent(new Event('click'));await tick();
 resolvers.get(other.id)({completedPages:3,totalPages:8,pages:[{page:1,text:'B original'}]});await tick();await tick();const dialog=f.doc.body.querySelector('dialog'),close=dialog.querySelector('button');assert.equal(dialog.querySelector('h2').textContent,other.filename);assert.equal(f.doc.activeElement,close);
 resolvers.get(job.id)({completedPages:3,totalPages:8,pages:[{page:1,text:'A original'}]});await tick();await tick();assert.equal(dialog.querySelector('h2').textContent,other.filename);assert.equal(f.doc.activeElement,close);assert.equal(first.disabled,false);assert.equal(second.disabled,false);
});

test('closing an existing PDF preview invalidates a pending newer preview without leaving its row busy',async t=>{
 const other={...job,id:'22222222-2222-4222-8222-222222222222',filename:'Second original.pdf'};let resolve;
 const f=await fixture(t,{api:async url=>url.endsWith(other.id+'/preview')?new Promise(done=>{resolve=done;}):url.endsWith('/preview')?{completedPages:3,totalPages:8,pages:[{page:1,text:'A original'}]}:{jobs:[job,other]}});await f.controller.refresh();
 f.root.children[0].querySelectorAll('button')[1].dispatchEvent(new Event('click'));await tick();await tick();const dialog=f.doc.body.querySelector('dialog');assert.equal(dialog.open,true);
 const second=f.root.children[1].querySelectorAll('button')[1];second.dispatchEvent(new Event('click'));await tick();dialog.close();resolve({completedPages:3,totalPages:8,pages:[{page:1,text:'B original'}]});await tick();await tick();assert.equal(dialog.open,false);assert.equal(second.disabled,false);
});

for(const actor of ['button','cancel'])test('PDF '+actor+' invalidates synchronously before the queued native close event, which cannot cancel a fresh intent',async t=>{
 const other={...job,id:'22222222-2222-4222-8222-222222222222',filename:'Second original.pdf'},resolvers=new Map();let first=true;
 const f=await fixture(t,{api:async url=>{
  if(!url.endsWith('/preview'))return {jobs:[job,other]};
  if(first){first=false;return {completedPages:3,totalPages:8,pages:[{page:1,text:'A original'}]};}
  return new Promise(resolve=>resolvers.set(url.split('/').at(-2),resolve));
 }});f.doc.closeEvents=[];await f.controller.refresh();const firstButton=f.root.children[0].querySelectorAll('button')[1],second=f.root.children[1].querySelectorAll('button')[1];firstButton.dispatchEvent(new Event('click'));await tick();await tick();const dialog=f.doc.body.querySelector('dialog');assert.equal(dialog.open,true);
 second.dispatchEvent(new Event('click'));await tick();
 if(actor==='button')dialog.querySelector('button').dispatchEvent(new Event('click'));else{const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);}
 assert.equal(dialog.open,false);assert.equal(f.doc.closeEvents.length,1);
 resolvers.get(other.id)({completedPages:3,totalPages:8,pages:[{page:1,text:'late B original'}]});for(let n=0;n<12;n++)await Promise.resolve();assert.equal(dialog.open,false);assert.equal(second.disabled,false);
 firstButton.dispatchEvent(new Event('click'));await tick();f.doc.closeEvents.shift()();resolvers.get(job.id)({completedPages:3,totalPages:8,pages:[{page:1,text:'fresh A original'}]});await tick();await tick();assert.equal(dialog.open,true);assert.equal(dialog.querySelectorAll('p').at(-1).textContent,'fresh A original');
});
