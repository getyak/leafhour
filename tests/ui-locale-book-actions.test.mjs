import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLibraryBookActions} from '../app/library-book-actions.mjs';
import {requestUiRoute,t as uiText,onUiLocaleFault} from '../app/ui-locale.mjs';

class Node extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attrs=new Map();this.dataset={};this.style={};this.className='';this.textContent='';this.hidden=false;this.disabled=false;this.open=false;this.offsetWidth=200;this.offsetHeight=200;this._value='';this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 get isConnected(){return this.ownerDocument.body.contains(this);}
 setAttribute(key,value){this.attrs.set(key,String(value));}
 getAttribute(key){return this.attrs.get(key)||null;}
 hasAttribute(key){return this.attrs.has(key);}
 removeAttribute(key){this.attrs.delete(key);}
 toggleAttribute(key,on){if(on)this.setAttribute(key,'');else this.removeAttribute(key);}
 get value(){return this.tagName==='SELECT'?(this._value||this.children[0]?.value||''):this._value;}
 set value(value){this._value=value;}
 get options(){return this.children;}
 querySelectorAll(selector){const all=this.children.flatMap(node=>[node,...node.querySelectorAll('*')]);if(selector==='*')return all;
  if(selector.startsWith(':scope > .'))return this.children.filter(node=>node.className.split(' ').includes(selector.slice(10)));
  if(selector.startsWith('#'))return all.filter(node=>node.id===selector.slice(1));
  if(selector.startsWith('[role=menuitem]'))return all.filter(node=>node.getAttribute('role')==='menuitem'&&!node.disabled);
  if(selector==='[data-ui-owned-href]')return all.filter(node=>node.dataset.uiOwnedHref);
  if(selector==='[data-icon]')return [];
  if(selector==='button:not(:disabled)')return all.filter(node=>node.tagName==='BUTTON'&&!node.disabled);
  return all.filter(node=>node.tagName===selector.toUpperCase());
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 getBoundingClientRect(){return {left:100,right:200,top:100,bottom:140,width:100,height:40};}
 getClientRects(){return [{}];}
 closest(){return null;}
 focus(){this.ownerDocument.activeElement=this;}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
 click(){this.dispatchEvent(new Event('click',{cancelable:true}));}
}
const tick=()=>new Promise(setImmediate);
async function fixture(t,{onReorder=()=>{},other=false,action=2,request=async()=>({}),owner=()=> 'a:1',assertRead=()=>{}}={}){
 await requestUiRoute('en');const doc=new EventTarget(),win=new EventTarget(),posts=[];doc.createElement=tag=>{const n=new Node(tag,doc);if(tag==='iframe')n.contentWindow={postMessage:(data,origin)=>posts.push({frame:n,data,origin})};return n;};doc.body=new Node('body',doc);doc.querySelector=selector=>doc.body.querySelector(selector);doc.querySelectorAll=selector=>doc.body.querySelectorAll(selector);doc.getElementById=id=>doc.querySelector('#'+id);
 const before={document:globalThis.document,window:globalThis.window,location:globalThis.location,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};Object.assign(globalThis,{document:doc,window:win,location:{origin:'https://reader.example'},innerWidth:1200,innerHeight:800});
 const blobs=[],create=URL.createObjectURL,revoke=URL.revokeObjectURL,set=globalThis.setTimeout;URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic';};URL.revokeObjectURL=()=>{};globalThis.setTimeout=(fn,delay,...args)=>delay===10000?null:set(fn,delay,...args);
 const calls=[],book={bookId:'synthetic',title:{zh:'来源/阅读😀'},author:'Literal author',journey:{dailyGoalMinutes:15}},controller=mountLibraryBookActions({api:async(...args)=>{assertRead('api');calls.push(args);return request(...args);},getSession:()=>{assertRead('session');return {user:{id:'a'}};},getBooks:()=>{assertRead('books');return other?[book,{bookId:'other',title:{en:'Other'}}]:[book];},getOwner:()=>{assertRead('owner');return owner();},getRevision:()=>1,setRevision:()=>{},onReorder,onChanged:()=>{},openAuth:()=>assert.fail('unexpected auth')});
 t.after(async()=>{controller.dispose();Object.assign(globalThis,before);URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=set;await requestUiRoute('en');});
 const card=doc.createElement('article');doc.body.append(card);const trigger=controller.decorate(card,book);trigger.click();const menu=doc.getElementById('library-book-menu');menu.querySelectorAll('button')[action].click();await tick();
 return {doc,book,controller,calls,blobs,trigger,posts,dialog:doc.getElementById('library-book-dialog')};
}

test('actual calendar owner keeps draft and focus; only explicit submit generates localized ICS with literal source and unchanged URL semantics',async t=>{
 const f=await fixture(t),form=f.dialog.querySelector('form'),inputs=form.querySelectorAll('input'),selects=form.querySelectorAll('select');assert.ok(form);
 inputs[0].value='2026-10-20T20:00';inputs[1].value='25';selects[0].value='weekly';selects[1].value='10';inputs[2].value='2026-12-20';inputs[0].focus();inputs[0].selectionStart=2;inputs[0].selectionEnd=4;
 const fields=[...form.children],nodes=[...inputs,...selects],values=nodes.map(node=>node.value);let writes=0;
 for(const node of nodes){let value=node.value;Object.defineProperty(node,'value',{get:()=>value,set:next=>{writes++;value=next;},configurable:true});}
 for(const locale of ['ja','zh-Hant','zh-Hans','en']){await requestUiRoute(locale);assert.equal(f.blobs.length,0);assert.equal(f.calls.length,0);assert.equal(writes,0);assert.deepEqual(form.children,fields);assert.deepEqual(nodes.map(node=>node.value),values);assert.equal(f.doc.activeElement,inputs[0]);assert.equal(inputs[0].selectionStart,2);assert.equal(inputs[0].selectionEnd,4);}
 await requestUiRoute('ja');form.dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(f.blobs.length,1);const first=await f.blobs[0].text(),unfold=first.replace(/\r\n /g,'');
 assert.match(unfold,/SUMMARY:読書 · 来源\/阅读😀/);assert.match(unfold,/DESCRIPTION:来源\/阅读😀 を 25 分読みます。/);assert.match(unfold,/DTSTART:20261020T200000/);assert.match(unfold,/DTEND:20261020T202500/);assert.match(unfold,/URL:https:\/\/reader.example\/read\?book=synthetic\r\n/);assert.match(unfold,/RRULE:FREQ=WEEKLY;UNTIL=20261220T235959/);assert.match(unfold,/TRIGGER:-PT10M/);
 await requestUiRoute('en');assert.equal(f.blobs.length,1);assert.equal(await f.blobs[0].text(),first);form.dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(f.blobs.length,2);const second=(await f.blobs[1].text()).replace(/\r\n /g,'');assert.match(second,/SUMMARY:Read · 来源\/阅读😀/);assert.notEqual(first.match(/UID:(.+)/)[1],second.match(/UID:(.+)/)[1]);assert.equal(f.calls.length,0);
 f.controller.dispose();form.dispatchEvent(new Event('submit',{cancelable:true}));await requestUiRoute('ja');assert.equal(f.blobs.length,2);assert.equal(f.calls.length,0);
});

test('every physical action trigger is localized even when the same book has two live cards',async t=>{
 const f=await fixture(t),card=f.doc.createElement('article');card.hidden=true;f.doc.body.append(card);const second=f.controller.decorate(card,f.book);
 await requestUiRoute('ja');assert.equal(f.trigger.getAttribute('aria-label'),second.getAttribute('aria-label'));assert.match(f.trigger.getAttribute('aria-label'),/来源\/阅读😀/);assert.ok(!f.trigger.getAttribute('aria-label').startsWith('More actions'));
 const previous=second.getAttribute('aria-label');second.remove();await requestUiRoute('en');assert.equal(second.getAttribute('aria-label'),previous);assert.match(f.trigger.getAttribute('aria-label'),/^More actions for/);assert.equal(f.calls.length,0);
});

test('a synchronous off-document card batch retains every newly mounted physical trigger',async t=>{
 const f=await fixture(t),cards=[0,1,2].map(index=>{const card=f.doc.createElement('article');f.controller.decorate(card,{...f.book,bookId:'batch-'+index,title:{en:'Literal book '+index}});return card;});
 f.doc.body.append(...cards);await tick();await requestUiRoute('ja');for(const [index,card]of cards.entries()){const trigger=card.querySelector('button');assert.ok(trigger.getAttribute('aria-label').includes('Literal book '+index));assert.ok(!trigger.getAttribute('aria-label').startsWith('More actions'));}assert.equal(f.calls.length,0);
});

for(const boundary of ['dispose','clear','new-menu'])test('late menu rejection cannot overwrite current status after '+boundary,async t=>{
 let reject,started=0;const pending=new Promise((_,fail)=>{reject=fail;});const f=await fixture(t,{other:true,onReorder:()=>{started++;return pending;}}),status=f.doc.createElement('p');status.id='library-status';status.textContent='Current status';f.doc.body.append(status);f.dialog.close();f.trigger.click();f.doc.getElementById('library-book-menu').querySelectorAll('button')[4].click();await tick();assert.equal(started,1);
 if(boundary==='new-menu')f.trigger.click();else f.controller[boundary]();reject(Error('late old failure'));await tick();await tick();assert.equal(status.textContent,'Current status');
});

for(const observe of ['locale','frame-load'])test('real shared gift → trash handoff aborts stale UI permanently through '+observe,async testContext=>{
 let trap=false,account='a:1',finishTrash;const faults=[],offFault=onUiLocaleFault(error=>faults.push(error));testContext.after(offFault);
 const f=await fixture(testContext,{action:1,owner:()=>account,assertRead:kind=>assert.equal(trap,false,'locale cannot read '+kind),request:async(path)=>{if(path.endsWith('/gift-quote'))return {bookId:'synthetic',quote:null};if(path==='/api/library/trash')return new Promise(resolve=>{finishTrash=resolve;});if(path.endsWith('/gifts'))throw Error('Synthetic history failure');throw Error('Unexpected route '+path);}});
 const body=f.dialog.children[1],heading=f.dialog.children[0].children[0],status=f.dialog.children.at(-1),owned=[...body.children],intro=owned[0],frame=body.querySelector('iframe'),recipient=body.querySelector('input'),words=body.querySelector('textarea');
 assert.equal(f.dialog.open,true);assert.equal(status.textContent,'Sealed letters could not load right now.');assert.equal(heading.textContent,'Write a gift letter');recipient.value='Literal recipient';words.value='Unsent 私人 words';words.focus();frame.dispatchEvent(new Event('load'));assert.equal(f.posts.filter(p=>p.data.kind==='marginalia-gift-preview').length,1);const requestCount=f.calls.length,content=JSON.stringify(f.posts.find(p=>p.data.kind==='marginalia-gift-preview').data);for(const n of [recipient,words]){let value=n.value;Object.defineProperty(n,'value',{get(){assert.equal(trap,false,'locale cannot read native value');return value;},set(next){assert.equal(trap,false,'locale cannot write native value');value=next;}});}
 for(const code of ['ja','zh-Hant','zh-Hans','en']){trap=true;try{await requestUiRoute(code);}finally{trap=false;}assert.deepEqual(faults,[]);assert.equal(status.textContent,uiText('giftCompose.historyFailure'));assert.equal(heading.textContent,uiText('giftCompose.write'));assert.deepEqual(body.children,owned);assert.equal(f.doc.activeElement,words);assert.equal(recipient.value,'Literal recipient');assert.equal(words.value,'Unsent 私人 words');assert.equal(f.calls.length,requestCount);assert.equal(f.posts.filter(p=>p.data.kind==='marginalia-gift-preview').length,1);assert.equal(JSON.stringify(f.posts.find(p=>p.data.kind==='marginalia-gift-preview').data),content);assert.deepEqual(f.posts.at(-1).data,{kind:'leafhour-gift-ui-locale',version:1,locale:code});}
 const trash=f.controller.trash();assert.equal(f.controller.getOverlayKind(),'trash');assert.equal(f.dialog.open,true);assert.equal(intro.isConnected,false);assert.equal(status.textContent,uiText('book.trash.loading'));const retained=[...body.children],posts=f.posts.length,frameTitle=frame.getAttribute('title'),detachedText=intro.textContent;
 if(observe==='frame-load')frame.dispatchEvent(new Event('load'));
 trap=true;try{await requestUiRoute('ja');}finally{trap=false;}assert.deepEqual(faults,[]);assert.equal(status.textContent,uiText('book.trash.loading'),'trash owns its pending notice');assert.equal(heading.textContent,uiText('book.trash'));assert.deepEqual(body.children,retained);assert.equal(f.posts.length,posts,'no detached content or UI envelope');assert.equal(frame.getAttribute('title'),frameTitle);assert.equal(intro.textContent,detachedText);
 finishTrash({books:[],revision:1});await trash;assert.equal(status.textContent,'');const trashNodes=[...body.children];assert.ok(trashNodes.some(n=>n.textContent===uiText('book.trash.empty')));
 // Reconnecting the exact old nodes plus owner ABA cannot revive a terminal
 // instance. This exercises real DOM ownership, with no invented owner event.
 body.append(...owned);account='other';for(const code of ['zh-Hant','zh-Hans','en']){if(code==='zh-Hans')account='a:1';trap=true;try{await requestUiRoute(code);}finally{trap=false;}assert.deepEqual(faults,[]);assert.equal(status.textContent,'');assert.equal(heading.textContent,uiText('book.trash'));assert.deepEqual(body.children.slice(0,trashNodes.length),trashNodes);assert.equal(f.posts.length,posts);assert.equal(frame.getAttribute('title'),frameTitle);assert.equal(intro.textContent,detachedText);}
});
