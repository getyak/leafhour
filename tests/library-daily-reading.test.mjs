import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLibraryDailyReading} from '../app/library-daily-reading.mjs';
class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.value='';this.textContent='';this.className='';this.hidden=false;this.disabled=false;this.classList={toggle(){}};}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}
 focus(){document.activeElement=this;}
}
const all=root=>[root,...root.children.flatMap(all)],find=(root,id)=>all(root).find(n=>n.id===id),tick=()=>new Promise(setImmediate);
function fixture(api){
 globalThis.document=Object.assign(new EventTarget(),{createElement:tag=>new Element(tag),activeElement:null,body:new Element('body')});
 const root=new Element('section'),inboxRoot=new Element('section');let user={id:'a'};
 const book={bookId:'book-a',title:{zh:'一本书'}},downloads=[],books=[book];
 const ui=mountLibraryDailyReading({root,inboxRoot,api,getSession:()=>({user}),getBooks:()=>books,getCurrentBook:()=>book,origin:'https://leafhour.com',download:value=>downloads.push(value)});
 return {root,inboxRoot,ui,downloads,books,find:id=>find(root,id),switch:id=>{user=id?{id}:null;ui.update();}};
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
test('pause uses the authoritative revision and stale connection evidence never creates a working toggle',async()=>{
 const calls=[],f=fixture(async(url,body)=>{calls.push({url,body});return {plan:plan({status:url.endsWith('/pause')?'paused':'active',hostLabel:'Codex',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]};});
 await f.ui.refresh();assert.match(f.find('daily-state').textContent,/已开启/);f.find('daily-pause').dispatchEvent(new Event('click'));await tick();
 assert.deepEqual(calls[1],{url:'/api/library/daily-reading/pause',body:{baseRevision:2}});assert.match(f.find('daily-state').textContent,/已暂停/);
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
 await f.ui.refresh();f.find('daily-time').value='21:30';f.find('daily-time').dispatchEvent(new Event('input'));f.find('daily-consent').checked=true;f.find('daily-pause').dispatchEvent(new Event('click'));await tick();
 assert.equal(f.find('daily-time').value,'21:30');assert.equal(f.find('daily-consent').checked,true);assert.deepEqual(calls[1].body,{baseRevision:2});
});
test('actual delivery timestamps and book locators remain visible across later plan changes',async()=>{
 const f=fixture(async()=>({plan:plan(),inbox:[{id:'old',bookTitle:'另一本书',chapterLabel:'第二章',deliveredAt:'2026-10-17T12:00:00Z',message:'old'},{id:'new',bookTitle:'一本书',deliveredAt:'2026-10-18T12:00:00Z',message:'new'}]}));await f.ui.refresh();
 const nodes=all(f.inboxRoot);assert.ok(nodes.some(n=>n.textContent==='《另一本书》 · 第二章'));assert.equal(nodes.filter(n=>n.tagName==='time').length,2);assert.equal(nodes.filter(n=>n.tagName==='article')[0].children.some(n=>n.textContent==='new'),true);
});

test('a fixed book removed from the shelf stays visible and selected without a silent replacement',async()=>{
 const f=fixture(async()=>({plan:plan({bookId:'archived',bookTitle:'原来那本书',status:'active',connectedAt:'2026-10-18T12:00:00Z'}),inbox:[]}));f.books.length=0;await f.ui.refresh();
 assert.ok(all(f.root).some(n=>n.textContent.includes('陪读《原来那本书》')));assert.ok(all(f.root).some(n=>n.textContent.includes('已移出书架')));assert.equal(f.find('daily-book').value,'archived');assert.equal(f.find('daily-book').children[0].textContent,'原来那本书（已绑定）');
});
