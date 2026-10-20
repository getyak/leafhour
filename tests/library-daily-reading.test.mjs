import test,{before} from 'node:test';
import {requestUiRoute} from '../app/ui-locale.mjs';
before(()=>requestUiRoute('zh-Hans'));
import assert from 'node:assert/strict';
import {mountLibraryDailyReading} from '../app/library-daily-reading.mjs';
class ClassList{
 constructor(node){this.node=node;this.set=new Set();}
 add(...names){for(const name of names)this.set.add(name);this.sync();}remove(...names){for(const name of names)this.set.delete(name);this.sync();}
 toggle(name,force){if(force===undefined)force=!this.set.has(name);if(force)this.set.add(name);else this.set.delete(name);this.sync();return force;}
 contains(name){return this.set.has(name);}sync(){this.node.className=[...this.set].join(' ');}
}
class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.textContent='';this.className='';this.hidden=false;this.disabled=false;this.checked=false;this.type='';this.classList=new ClassList(this);}
 get id(){return this.attributes.id||'';}set id(v){this.attributes.id=String(v);}
 get options(){return this.children;}
 append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
 appendChild(node){this.append(node);return node;}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 after(...nodes){const siblings=this.parentElement?this.parentElement.children:[];const at=siblings.indexOf(this);for(const node of nodes){node.parentElement=this.parentElement;siblings.splice(at+1,0,node);}}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return k in this.attributes?this.attributes[k]:null;}hasAttribute(k){return k in this.attributes;}removeAttribute(k){delete this.attributes[k];}toggleAttribute(k,force){if(force===undefined)force=!(k in this.attributes);if(force)this.attributes[k]='';else delete this.attributes[k];return force;}
 focus(){document.activeElement=this;}
 contains(node){return node===this||this.children.some(child=>child.contains&&child.contains(node));}
 getClientRects(){return [1];}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){const simple=selector.split(',').map(part=>part.trim());const match=node=>simple.some(part=>{if(part.startsWith('#'))return node.id===part.slice(1);if(part.startsWith('.'))return String(node.className).split(' ').includes(part.slice(1));const tag=part.replace(/[:.\[].*$/,'').toUpperCase();return !!tag&&String(node.tagName).toUpperCase()===tag;});const out=[];const walk=node=>{for(const child of node.children){if(match(child))out.push(child);walk(child);}};walk(this);return out;}
}
const all=root=>[root,...root.children.flatMap(all)],find=(root,id)=>all(root).find(n=>n.id===id),tick=()=>new Promise(setImmediate);
function fixture(api){
 const body=new Element('body');
 globalThis.document=Object.assign(new EventTarget(),{createElement:tag=>new Element(tag),activeElement:null,body,querySelector:()=>null,querySelectorAll:()=>[]});
 const root=new Element('section'),inboxRoot=new Element('section');let user={id:'a'};
 const book={bookId:'book-a',title:{zh:'一本书'}},downloads=[],books=[book];
 const ui=mountLibraryDailyReading({root,inboxRoot,api,getSession:()=>({user}),getBooks:()=>books,getCurrentBook:()=>book,origin:'https://leafhour.com',download:value=>downloads.push(value)});
 return {root,inboxRoot,ui,downloads,books,doc:globalThis.document,find:id=>find(root,id),switch:id=>{user=id?{id}:null;ui.update();}};
}
const plan=(patch={})=>({id:'plan-a',revision:2,bookId:'book-a',status:'awaiting-host',time:'20:00',timeZone:'Asia/Shanghai',channel:'library',grantExpiresAt:'2026-11-17T12:00:00Z',...patch});
test('opening and refreshing the daily panel only reads, and guests never call owner routes',async()=>{
 const calls=[],f=fixture(async(...args)=>{calls.push(args);return {plan:null,inbox:[]};});
 await f.ui.refresh();assert.equal(calls.length,1);assert.deepEqual(calls[0],['/api/library/daily-reading']);
 assert.equal(f.find('daily-time').value,'20:00');assert.equal(f.find('daily-consent').checked,false);
 f.switch(null);await f.ui.refresh();assert.equal(calls.length,1);assert.equal(f.find('daily-save').disabled,true);assert.equal(f.inboxRoot.hidden,true);
});
test('saving requires explicit consent, keeps the plan awaiting host and exposes the one-time token only on explicit download',async()=>{
 const calls=[],token='synthetic-private-token',f=fixture(async(url,body)=>{calls.push({url,body});return body?{plan:plan(),token}:{plan:null,inbox:[]};});
 await f.ui.refresh();f.find('daily-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();assert.equal(calls.length,1);
 f.find('daily-consent').checked=true;f.find('daily-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 assert.equal(calls[1].body.bookId,'book-a');assert.equal(calls[1].body.time,'20:00');assert.deepEqual(calls[1].body.consent,{originalText:true,readingActivity:true});
 assert.match(f.find('daily-state').textContent,/待连接/);assert.equal(f.downloads.length,0);assert.equal(all(f.root).some(n=>String(n.textContent).includes(token)),false);
 f.find('daily-download').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].token,token);
 f.switch('b');f.find('daily-download').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,1,'another account cannot download the prior token');
});
test('a late owner read or save never renders the previous account plan, card or token',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));const pending=f.ui.refresh();f.switch('b');resolve({plan:plan(),inbox:[{message:'private-a'}]});await pending;
 assert.equal(all(f.root).some(n=>n.textContent==='待连接'),false);assert.equal(all(f.inboxRoot).some(n=>n.textContent==='private-a'),false);
});
test('the pause switch uses the authoritative revision and shows only server state',async()=>{
 const calls=[],f=fixture(async(url,body)=>{calls.push({url,body});return {plan:plan({status:url.endsWith('/pause')?'paused':'active',hostLabel:'Codex',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]};});
 await f.ui.refresh();assert.match(f.find('daily-state').textContent,/已开启/);
 const toggle=f.find('daily-pause-toggle');assert.equal(toggle.checked,false,'an active plan is not paused');
 toggle.checked=true;toggle.dispatchEvent(new Event('change'));await tick();
 assert.deepEqual(calls[1],{url:'/api/library/daily-reading/pause',body:{baseRevision:2}});assert.match(f.find('daily-state').textContent,/已暂停/);assert.equal(toggle.checked,true);
 toggle.checked=false;toggle.dispatchEvent(new Event('change'));await tick();
 assert.deepEqual(calls[2],{url:'/api/library/daily-reading/resume',body:{baseRevision:2}});assert.equal(toggle.checked,false);
});
test('a failed pause write returns the switch to the server state and explains the failure',async()=>{
 const calls=[],f=fixture(async(url,body)=>{calls.push({url,body});if(url.endsWith('/pause'))throw Error('network');return {plan:plan({connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]};});
 await f.ui.refresh();const toggle=f.find('daily-pause-toggle');toggle.checked=true;toggle.dispatchEvent(new Event('change'));await tick();
 assert.equal(toggle.checked,false,'a refused pause never shows a speculative state');
 assert.match(f.find('daily-status').textContent,/未保存|未能|失败/);
});
test('inbox cards remain plain text, labelled AI, and only bounded local original links are navigable',async()=>{
 const f=fixture(async()=>({plan:plan(),inbox:[{id:'c1',message:'<script>private</script>',label:'连接测试',attribution:'AI · 每日陪读',createdAt:'2026-10-18T12:00:00Z',quote:{text:'原文。'},link:'/read?book=book-a&passage=p1&contentVersion=v1&layer=original'},{id:'c2',message:'bad link',link:'javascript:alert(1)'}]}));
 await f.ui.refresh();assert.equal(f.inboxRoot.hidden,false);const nodes=all(f.inboxRoot);assert.ok(nodes.some(n=>n.textContent==='<script>private</script>'));assert.ok(nodes.some(n=>n.textContent==='AI · 每日陪读'));
 const links=nodes.filter(n=>n.tagName==='a');assert.equal(links.length,1);assert.match(links[0].href,/^\/read\?/);
});
test('reading a rotated grant clears the stale one-time download',async()=>{
 let current=plan({grantId:'g1'});const f=fixture(async(url,body)=>body?{plan:current,token:'old-private-token'}:{plan:current,inbox:[]});
 await f.ui.refresh();f.find('daily-consent').checked=true;f.find('daily-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();assert.equal(f.find('daily-download').hidden,false);
 current=plan({revision:3,grantId:'g2'});await f.ui.refresh();assert.equal(f.find('daily-download').hidden,true);f.find('daily-download').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,0);
});
test('pausing preserves unsaved time edits and does not silently apply them',async()=>{
 const calls=[],f=fixture(async(url,body)=>{calls.push({url,body});return {plan:plan({status:url.endsWith('/pause')?'paused':'active',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]};});
 await f.ui.refresh();f.find('daily-time').value='21:30';f.find('daily-time').dispatchEvent(new Event('input'));f.find('daily-consent').checked=true;
 const toggle=f.find('daily-pause-toggle');toggle.checked=true;toggle.dispatchEvent(new Event('change'));await tick();
 assert.equal(f.find('daily-time').value,'21:30');assert.equal(f.find('daily-consent').checked,true);assert.deepEqual(calls[1].body,{baseRevision:2});
});

test('the daily tab opens with one plain sentence carrying the book and a 24-hour time',async()=>{
 const f=fixture(async()=>({plan:null,inbox:[]}));await f.ui.refresh();
 const token=f.find('daily-time-token');
 assert.ok(token,'the first thing shown is an editable sentence, not a status log');
 assert.equal(token.textContent,'20:00','the sentence states one 24-hour time');
 assert.equal(f.find('daily-time').type,'time');assert.equal(f.find('daily-time').value,'20:00');
 const sentence=all(f.root).find(n=>String(n.className).includes('daily-sentence'));
 assert.ok(sentence.children.includes(f.find('daily-book-token')),'the sentence keeps one book trigger');
 assert.ok(all(f.root).find(n=>n.id==='daily-book-editor').children.includes(f.find('daily-book')),'the book is edited through the existing choice enhancement');
 assert.equal(sentence.children.includes(token),true);
 // Host, expiry, timezone and refresh move into one connection-details disclosure.
 const details=f.find('daily-connection-details');
 assert.ok(details,'pipeline details are grouped behind one disclosure');
 for(const id of ['daily-binding','daily-connection','daily-expiry','daily-channel','daily-refresh'])assert.equal(details.children.includes(f.find(id)),true,id+' lives inside connection details');
 assert.equal(details.children.includes(f.find('daily-download')),true);
});

test('changing the book or time invalidates the old consent and needs a new explicit authorization',async()=>{
 const calls=[],f=fixture(async(url,body)=>{calls.push({url,body});return body?{plan:plan()}:{plan:null,inbox:[]};});
 await f.ui.refresh();
 const consent=f.find('daily-consent');consent.checked=true;
 f.find('daily-time').value='21:30';f.find('daily-time').dispatchEvent(new Event('input'));
 assert.equal(consent.checked,false,'the old authorization never covers a new time');
 assert.match(f.find('daily-status').textContent,/授权/);
 consent.checked=true;
 const book=f.find('daily-book');book.value='book-b';book.dispatchEvent(new Event('change'));
 assert.equal(consent.checked,false,'the old authorization never covers a new book');
 // the explicit enabling action still requires a fresh consent
 f.find('daily-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 assert.equal(calls.length,1,'no write happens without explicit consent');
 consent.checked=true;f.find('daily-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
 assert.equal(calls.length,2);assert.equal(calls[1].body.time,'21:30');assert.equal(calls[1].body.bookId,'book-b');
 assert.deepEqual(calls[1].body.consent,{originalText:true,readingActivity:true});
});

test('common-time chips drive the native 24-hour input and the sentence in one change',async()=>{
 const f=fixture(async()=>({plan:null,inbox:[]}));await f.ui.refresh();
 const chip=all(f.root).find(n=>n.dataset&&n.dataset.time==='22:30');
 assert.ok(chip,'the common times are real choices');
 const changes=[];f.find('daily-time').addEventListener('change',()=>changes.push(f.find('daily-time').value));
 chip.dispatchEvent(new Event('click'));
 assert.equal(f.find('daily-time').value,'22:30');
 assert.deepEqual(changes,['22:30'],'one user choice commits one native change event');
 assert.equal(f.find('daily-time-token').textContent,'22:30','the sentence restates the chosen 24-hour time');
});
test('actual delivery timestamps and book locators remain visible across later plan changes',async()=>{
 const f=fixture(async()=>({plan:plan(),inbox:[{id:'old',bookTitle:'另一本书',chapterLabel:'第二章',deliveredAt:'2026-10-17T12:00:00Z',message:'old'},{id:'new',bookTitle:'一本书',deliveredAt:'2026-10-18T12:00:00Z',message:'new'}]}));await f.ui.refresh();
 const nodes=all(f.inboxRoot);assert.ok(nodes.some(n=>n.textContent==='《另一本书》 · 第二章'));assert.equal(nodes.filter(n=>n.tagName==='time').length,2);assert.equal(nodes.filter(n=>n.tagName==='article')[0].children.some(n=>n.textContent==='new'),true);
});

test('a fixed book removed from the shelf stays visible and selected without a silent replacement',async()=>{
 const f=fixture(async()=>({plan:plan({bookId:'archived',bookTitle:'原来那本书',status:'active',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]}));f.books.length=0;await f.ui.refresh();
 assert.ok(all(f.root).some(n=>n.textContent.includes('陪读《原来那本书》')));assert.ok(all(f.root).some(n=>n.textContent.includes('已移出书架')));assert.equal(f.find('daily-book').value,'archived');assert.equal(f.find('daily-book').children[0].textContent,'原来那本书（已绑定）');
});

// ---- component review 02 repairs + browser candidate findings ----
const switchWrap=(root,needle)=>all(root).find(n=>String(n.className).includes('settings-switch')&&all(n).some(c=>c.id===needle));
test('the sentence hydrates the server time before it paints, including non-default times',async()=>{
 const f=fixture(async()=>({plan:plan({time:'07:00',status:'active',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]}));await f.ui.refresh();
 assert.equal(f.find('daily-time').value,'07:00');
 assert.equal(f.find('daily-time-token').textContent,'07:00','the sentence states the real plan time');
 f.find('daily-time').value='21:15';f.find('daily-time').dispatchEvent(new Event('input'));
 assert.equal(f.find('daily-time-token').textContent,'21:15','a draft edit moves the sentence immediately');
});

test('every programmatic checked change synchronises the custom switch chrome',async()=>{
 const calls=[],f=fixture(async(url,body)=>{calls.push({url,body});if(url.endsWith('/pause'))throw Error('refused');return {plan:plan({status:'active',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]};});
 await f.ui.refresh();
 const consent=f.find('daily-consent'),consentRow=switchWrap(f.root,'daily-consent');
 consent.checked=true;consent.dispatchEvent(new Event('change'));
 assert.equal(consentRow.dataset.checked,'true');
 f.find('daily-time').value='21:30';f.find('daily-time').dispatchEvent(new Event('input'));
 assert.equal(consent.checked,false);assert.equal(consentRow.dataset.checked,'false','the painted switch follows the revoked consent');
 const toggle=f.find('daily-pause-toggle'),pauseRow=switchWrap(f.root,'daily-pause-toggle');
 toggle.checked=true;toggle.dispatchEvent(new Event('change'));await tick();
 assert.equal(toggle.checked,false);assert.equal(pauseRow.dataset.checked,'false','a refused pause never leaves a painted active switch');
 f.switch('b');
 assert.equal(consentRow.dataset.checked,'false','an owner reset repaints the switches too');
});

test('the 24-hour trigger opens a compact editor whose chips appear only while editing',async()=>{
 const f=fixture(async()=>({plan:null,inbox:[]}));await f.ui.refresh();
 const editor=all(f.root).find(n=>n.id==='daily-time-editor');
 assert.ok(editor.hidden||editor.getAttribute('hidden')!==null,'chips and editor stay closed until the reader asks');
 f.find('daily-time-token').dispatchEvent(new Event('click'));
 assert.equal(editor.hidden,false);
 const chips=all(editor).filter(n=>String(n.className).includes('settings-time-chip'));
 assert.ok(chips.length>=4,'the common times live in the editor, not as a permanent duplicate row');
 const custom=all(editor).find(n=>String(n.className).includes('settings-time-custom'));
 custom.dispatchEvent(new Event('click'));
 assert.equal(f.doc.activeElement,f.find('daily-time-text'),'Custom reveals and focuses the HH:mm editor');
 f.find('daily-time-text').value='23:05';f.find('daily-time-text').dispatchEvent(new Event('change'));
 assert.equal(f.find('daily-time').value,'23:05','the native input stays the value owner');
 assert.equal(f.find('daily-time-token').textContent,'23:05');
 const bookChips=all(f.root).find(n=>n.id==='daily-book-editor');
 assert.ok(bookChips,'the book has a disclosed editor');
 f.find('daily-book-token').dispatchEvent(new Event('click'));
 assert.equal(bookChips.hidden,false);
 assert.ok(all(bookChips).some(n=>String(n.className).includes('choice-')),'the book select is enhanced with the shared choice control');
});

test('editor labels follow a language commit without rebuilding values or inputs',async()=>{
 const {requestUiRoute}=await import('../app/ui-locale.mjs');await requestUiRoute('en');
 const f=fixture(async()=>({plan:null,inbox:[]}));await f.ui.refresh();
 const time=f.find('daily-time'),editor=f.find('daily-time-text');
 editor.value='09:30';editor.dispatchEvent(new Event('change'));
 await requestUiRoute('ja');
 assert.equal(time.value,'09:30','a label commit never resets the value');
 assert.equal(f.find('daily-time-text').value,'09:30');
 const custom=all(f.root).find(n=>String(n.className).includes('settings-time-custom'));
 assert.equal(custom.textContent,'カスタム時刻','the Custom chip is relabelled in place');
 await requestUiRoute('en');
});
