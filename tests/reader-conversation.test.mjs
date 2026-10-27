import test,{before,after} from 'node:test';
import {requestUiRoute} from '../app/ui-locale.mjs';
before(()=>requestUiRoute('zh-Hans'));
after(()=>requestUiRoute('en'));
import assert from 'node:assert/strict';
import {readerConversationContext,mountReaderConversation,readerInteractionBlocked} from '../app/reader-conversation.mjs';
import {renderChatMarkdown} from '../app/library-chat-markdown.mjs';
import {mountChatBookUpload} from '../app/chat-book-upload.mjs';
import {createBookUploadController} from '../app/book-upload-controller.mjs';
import {mountLibraryChat} from '../app/library-chat.mjs';
import {mountReaderCompanion} from '../app/reader-companion.mjs';

const book={bookId:'book-one',sections:[{paragraphs:[{id:'p1'},{id:'p2'}]}]};
const reader=(selected='p2',anchor='p1')=>({getBook:()=>book,isSelectionActive:()=>true,getSelectedId:()=>selected,getAnchor:()=>({passageId:anchor})});

test('audio questions open a bounded source-linked draft only for the captured account and current book',()=>{
 const opened=[];const f=mount({mountChat:()=>({update(){},open:value=>opened.push(value)})});
 const event=detail=>{const e=new Event('reader:audio-question');e.detail=detail;return e;};
 f.events.dispatchEvent(event({ownerId:'other',bookId:'book-one',passageId:'p1',draft:'Explain'}));
 f.events.dispatchEvent(event({ownerId:'reader-one',bookId:'other',passageId:'p1',draft:'Explain'}));assert.equal(opened.length,0);
 f.events.dispatchEvent(event({ownerId:'reader-one',bookId:'book-one',passageId:'p1',draft:'Explain this scene.'}));
 assert.deepEqual(opened,[{bookId:'book-one',passageId:'p1',draft:'Explain this scene.'}]);
});

test('nonmodal conversation does not block reading keys while chat controls keep their own keys',()=>{
  const safe=query=>{if(String(query).includes(':popover-open'))throw Error('unsupported selector: '+query);};
  const document={querySelector:selector=>{safe(selector);return selector.includes(':not(.library-chat-dialog)')?null:{open:true};}};
  assert.equal(readerInteractionBlocked(document,{closest:()=>null}),false);
  assert.equal(readerInteractionBlocked(document,{closest:()=>({tagName:'DIALOG'})}),true);
  assert.equal(readerInteractionBlocked({querySelector:selector=>{safe(selector);return {open:true};}},{closest:()=>null}),true);
});

test('reader chat uses a valid selection, then a valid visible paragraph, and rejects another book',()=>{
  assert.equal(readerConversationContext(reader(),'book-one').passageId,'p2');
  assert.equal(readerConversationContext(reader('unknown'),'book-one').passageId,'p1');
  assert.equal(readerConversationContext({...reader(),isSelectionActive:()=>false},'book-one').passageId,'p1');
  assert.equal(readerConversationContext(reader('unknown','missing'),'book-one').passageId,null);
  assert.equal(readerConversationContext(reader(),'another-book'),null);
  assert.equal(readerConversationContext(null,'book-one'),null);
});

function mount(options={}){
  const events=new EventTarget();globalThis.document=events;
  let hooks,updates=0,resets=0;const navigations=[],replacements=[];
  const instance=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader(),root:{},mountChat:value=>{hooks=value;return {update(){updates++;},reset(){resets++;}};},navigate:url=>navigations.push(url),replace:url=>replacements.push(url),...options});
  return {instance,hooks,events,navigations,replacements,counts:()=>({updates,resets})};
}

test('reader adapter preserves the real current book and login return paragraph',()=>{
  const f=mount();assert.deepEqual(f.hooks.getBooks(),[book]);assert.equal(f.hooks.getCurrentPassage(),'p2');assert.equal(f.hooks.getOwner(),'reader-one');
  f.hooks.openAuth();const login=new URL(f.navigations[0],'http://reader.test'),next=new URL(login.searchParams.get('next'),'http://reader.test');assert.equal(login.pathname,'/library');assert.equal(next.pathname,'/read');assert.equal(next.searchParams.get('book'),'book-one');assert.equal(next.searchParams.get('passage'),'p2');
  f.events.dispatchEvent(new Event('reader:ready'));assert.equal(f.counts().updates,2);
});

test('source navigation stays within the same book and a real passage',()=>{
  const visits=[],current={...reader(),dismissTools(){visits.push('dismiss');},goToPassage:id=>visits.push(id)},f=mount({getReader:()=>current});
  assert.equal(f.hooks.onNavigateToPassage('book-one','p1'),true);assert.deepEqual(visits,['dismiss','p1']);
  assert.equal(f.hooks.onNavigateToPassage('other','p1'),false);assert.equal(f.hooks.onNavigateToPassage('book-one','unknown'),false);assert.equal(visits.length,2);
});

test('reader chat requests keep owner guards without remapping library URLs',async()=>{
  const requests=[],f=mount({request:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({ok:true}),{status:200});}});
  const url='/api/library/books/book-one/chat';await f.hooks.api(url);await f.hooks.api(url,{text:'原话'});
  assert.equal(requests[0].url,url);assert.equal(requests[0].options.headers['X-Reader-Owner'],'reader-one');assert.equal(requests[1].options.method,'POST');assert.deepEqual(JSON.parse(requests[1].options.body),{text:'原话'});
});

test('session-change responses clear private chat before returning to the library',async()=>{
  const f=mount({request:async()=>new Response(JSON.stringify({error:'changed'}),{status:409,headers:{'X-Reader-Session-Changed':'1'}})});
  let notified=0;f.events.addEventListener('reader:session-changed',()=>notified++);
  await assert.rejects(f.hooks.api('/api/library/books/book-one/chat'),error=>error.status===409);assert.equal(f.counts().resets,1);assert.deepEqual(f.replacements,['/library']);
  assert.equal(notified,1,'the reader session lifecycle notifies palette caches before leaving the page');
});

test('HTTP errors preserve status for idempotent recovery and do not fabricate replies',async()=>{
  const f=mount({request:async()=>new Response(JSON.stringify({error:'稍后继续'}),{status:503})});await assert.rejects(f.hooks.api('/api/library/books/book-one/chat'),error=>error.status===503&&error.message==='稍后继续');assert.equal(f.counts().resets,0);
});

test('a companion result rechecks the current cookie identity before exposing old-account text',async()=>{
  const f=mount({request:async url=>new Response(JSON.stringify(url==='/api/auth/session'?{user:{id:'different-reader'}}:{kind:'companion',answer:{summary:'原账号的私有消息'}}),{status:200})});
  await assert.rejects(f.hooks.api('/api/library/books/book-one/companion/messages',{id:'one'}),e=>e.status===409);
  assert.equal(f.counts().resets,1);assert.deepEqual(f.replacements,['/library']);
});

// ---- GET-184 injected chat: real chat + companion controllers over one tools seam ----
class Element extends EventTarget {
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.attrs={};this.style={setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k]||'';},removeProperty(k){delete this[k];}};this.value='';this.open=false;this.isConnected=true;this.hidden=false;this.scrollHeight=1000;this.clientHeight=300;this.scrollTop=0;this.className='';this.dataset={};this.classList={add:c=>{if(!this.className.split(' ').includes(c))this.className+=(this.className?' ':'')+c;},remove:c=>{this.className=this.className.split(' ').filter(x=>x&&x!==c).join(' ');},toggle:(c,on)=>{on?this.classList.add(c):this.classList.remove(c);},contains:c=>this.className.split(' ').includes(c)};}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  appendChild(n){this.append(n);return n;}
  prepend(n){n.remove();n.parentElement=this;this.children.unshift(n);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(n=>n!==this);this.parentElement=null;}}
  insertBefore(n,before){n.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,n);n.parentElement=this;}
  after(...nodes){const p=this.parentElement;if(!p)return;const i=p.children.indexOf(this);for(const [k,n]of nodes.entries()){n.remove();n.parentElement=p;p.children.splice(i+1+k,0,n);}}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}hasAttribute(k){return k in this.attrs;}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  focus(){if(this.doc)this.doc.activeElement=this;}
  show(){this.open=true;this.mode='nonmodal';this.focus();}
  showModal(){this.open=true;this.mode='modal';}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  click(){this.dispatchEvent(new Event('click',{cancelable:true}));}
  getBoundingClientRect(){return {top:0,left:0,right:0,bottom:0,width:0,height:0};}
  getClientRects(){return [{top:0,left:0,right:10,bottom:10,width:10,height:10}];}
  get clientTop(){return this._clientTop||0;}
  querySelector(){return null;}querySelectorAll(){return [];}
  get lastElementChild(){return this.children.at(-1)||null;}
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function realFixture(t){
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>{const n=new Element('#text',doc);n.textContent=text;return n;};doc.body=doc.createElement('body');
  const all=n=>[n,...n.children.flatMap(all)];doc.getElementById=id=>all(doc.body).find(n=>n.id===id);doc.querySelectorAll=()=>[];doc.querySelector=()=>null;
  doc.visibilityState='visible';doc.hasFocus=()=>true;
  const previous={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight,getSelection:globalThis.getSelection,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const storage=new Map();globalThis.document=doc;globalThis.innerWidth=1200;globalThis.innerHeight=800;globalThis.getSelection=()=>null;
  const timers=new Map();let timerId=0;globalThis.setInterval=(fn)=>{timers.set(++timerId,fn);return timerId;};globalThis.clearInterval=id=>timers.delete(id);globalThis.setTimeout=(fn)=>{timers.set(++timerId,fn);return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.window={innerWidth:1200,requestAnimationFrame:fn=>setTimeout(fn),cancelAnimationFrame:id=>clearTimeout(id),matchMedia:()=>({matches:false,addEventListener(){}}),visualViewport:null,addEventListener(){},removeEventListener(){}};
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const dialog=doc.createElement('dialog');dialog.id='reader-conversation';doc.body.append(dialog);
  const header=doc.createElement('header');const closeButton=doc.createElement('button');header.append(closeButton);
  const pill=doc.createElement('button');pill.id='reading-tools-trigger';pill.className='reading-tools-trigger';
  const triggerHost=doc.createElement('div');triggerHost.id='reading-tools-chat-slot';doc.body.append(header,pill,triggerHost);
  let cleanup=()=>{};
  t.after(()=>{cleanup();Object.assign(globalThis,previous);});
  return {doc,dialog,header,pill,triggerHost,all,onCleanup:fn=>{cleanup=fn;}};
}
function realMount(t,{integration=null,requests=[]}={}){
  const f=realFixture(t);
  const api=async(url,data,options={})=>{requests.push({url,data,options});if(url==='/api/auth/session')return new Response(JSON.stringify({user:{id:'reader-one'}}),{status:200});if(url==='/api/library/books/book-one/companion')return {enabled:true,revision:1,contentVersion:'v1',sessionId:'s1'};if(url.endsWith('/chat'))return {bookId:'book-one',available:true,contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:'p1',chapterTitle:'章节',original:'Source'},turns:[]};return {};};
  const book={bookId:'book-one',contentVersion:'v1',title:{zh:'一本书',en:'A book'},sections:[{chapterId:'ch1',paragraphs:[{id:'p1',kind:'body'},{id:'p2',kind:'body'}]}]};
  const reader={getBook:()=>book,isSelectionActive:()=>false,getAnchor:()=>({passageId:'p1'})};
  const opened=[];
  const instance=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,api:(url,data,options)=>Promise.resolve(api(url,data,options)),integration,mountCompanion:undefined});
  f.onCleanup(()=>{});
  return {...f,instance,requests,book,opened};
}

test('injected conversation creates one AI trigger in the tools surface and no generated launcher',async t=>{
  const seams={triggerHost:null,companionAnchor:null,focusReturn:null,onUnread:null,onOpen:null};
  const calls={unread:[],opened:0,returned:0};
  const f=realFixture(t);
  const triggerHost=f.triggerHost,pill=f.pill;
  const api=async url=>{
    const value=url==='/api/library/books/book-one/companion'?{enabled:true,revision:1,contentVersion:'v1',sessionId:'s1'}:{bookId:'book-one',available:true,contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:'p1',chapterTitle:'章节',original:'Source'},turns:[]};
    return new Response(JSON.stringify(value),{status:200});
  };
  const book={bookId:'book-one',contentVersion:'v1',title:{zh:'一本书',en:'A book'},sections:[{chapterId:'ch1',paragraphs:[{id:'p1',kind:'body'}]}]};
  const reader={getBook:()=>book,isSelectionActive:()=>false,getAnchor:()=>({passageId:'p1'})};
  const integration={triggerHost,companionAnchor:pill,focusReturn:()=>{calls.returned++;pill.focus();},onUnread:value=>calls.unread.push(value),onOpen:()=>{calls.opened++;}};
  Object.assign(seams,{triggerHost,companionAnchor:pill,focusReturn:integration.focusReturn,onUnread:integration.onUnread,onOpen:integration.onOpen});
  const instance=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,api,integration});
  await instance.companionReady;await flush();
  const all=f.all;
  assert.equal(all(f.doc.body).filter(n=>n.className==='library-chat-launcher').length,0,'injected mode generates no hidden launcher');
  assert.equal(all(f.doc.body).filter(n=>n.className==='squirrel-companion-toggle').length,1,'exactly one companion toggle mounts');
  const trigger=all(triggerHost).find(n=>n.tagName==='BUTTON');
  assert.ok(trigger,'the AI trigger lives in the tools surface');
  assert.match(trigger.getAttribute('aria-label')||trigger.textContent||'',/对话|Ask AI/);
  await requestUiRoute('en');assert.equal(trigger.textContent,'Ask AI');
  await requestUiRoute('zh-Hans');assert.equal(trigger.textContent,'问 AI');
  trigger.click();await flush();
  assert.equal(f.dialog.open,true,'the injected trigger opens the conversation');
  assert.equal(calls.opened,1,'opening chat performs the focus handoff to close tools');
  assert.deepEqual(calls.unread,[false],'chat open resets unread through the explicit callback');
  assert.equal(pill.getAttribute('aria-expanded'),undefined,'shared pill ARIA stays with the tools coordinator');
  assert.equal(pill.getAttribute('aria-label'),undefined);
  assert.equal(pill.getAttribute('aria-description'),undefined);
  const dismiss=all(f.doc.body).find(n=>n.className==='squirrel-companion-dismiss');
  dismiss.click();assert.equal(calls.returned,1,'bubble dismissal returns focus through the explicit callback');
  f.dialog.close();
  assert.equal(calls.returned,2,'collapsing chat falls back to the shared pill');
});

test('tools reveals never re-mount chat or companion and keep one instance each',async t=>{
  const f=realFixture(t);
  const mounts={chat:0,companion:0};
  const api=async url=>{
    const value=url==='/api/library/books/book-one/companion'?{enabled:true,revision:1,contentVersion:'v1',sessionId:'s1'}:{bookId:'book-one',available:true,contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:'p1',chapterTitle:'章节',original:'Source'},turns:[]};
    return new Response(JSON.stringify(value),{status:200});
  };
  const book={bookId:'book-one',contentVersion:'v1',title:{zh:'一本书',en:'A book'},sections:[{chapterId:'ch1',paragraphs:[{id:'p1',kind:'body'}]}]};
  const reader={getBook:()=>book,isSelectionActive:()=>false,getAnchor:()=>({passageId:'p1'})};
  const integration={triggerHost:f.triggerHost,companionAnchor:f.pill,focusReturn:()=>f.pill.focus(),onUnread(){},onOpen(){}};
  mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,api,integration,
    mountChat:options=>{mounts.chat++;return mountLibraryChat(options);},
    mountCompanion:options=>{mounts.companion++;return mountReaderCompanion(options);}});
  await flush();
  assert.deepEqual(mounts,{chat:1,companion:1});
  for(let i=0;i<3;i++){f.doc.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused:i%2===0}}));f.doc.dispatchEvent(new Event('reader:ready'));}
  await flush();
  assert.deepEqual(mounts,{chat:1,companion:1},'tool and ready events never re-mount the shared instances');
  assert.equal(f.all(f.doc.body).filter(n=>n.className==='squirrel-companion-bubble').length,1);
  assert.equal(f.all(f.doc.body).filter(n=>n.className==='library-chat-book-choice').length,1);
});

test('conversation auth uses the current UI on both safe returns without reopening or reloading on locale',async()=>{
 const f=mount(),before=f.counts();await requestUiRoute('ja');assert.deepEqual(f.counts(),before);f.hooks.openAuth();
 const outer=new URL(f.navigations[0],'http://reader.test'),inner=new URL(outer.searchParams.get('next'),'http://reader.test');
 assert.equal(outer.pathname,'/library');assert.deepEqual(outer.searchParams.getAll('ui'),[]);assert.equal(inner.pathname,'/read');assert.equal(inner.searchParams.get('book'),'book-one');assert.equal(inner.searchParams.get('passage'),'p2');assert.deepEqual(inner.searchParams.getAll('ui'),[]);f.instance.dispose?.();await requestUiRoute('zh-Hans');
});

test('disposed conversation removes owned event hooks and consumes late account-change responses without navigation',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=mount({request:()=>pending});
 const operation=f.hooks.api('/api/library/books/book-one/chat');assert.equal(typeof f.instance.dispose,'function');f.instance.dispose();const counts=f.counts();f.events.dispatchEvent(new Event('reader:ready'));assert.deepEqual(f.counts(),counts);
 resolve(new Response(JSON.stringify({error:'old-owner'}),{status:409,headers:{'X-Reader-Session-Changed':'1'}}));await assert.rejects(operation,e=>e.code==='READER_CONVERSATION_DISPOSED');assert.deepEqual(f.counts(),counts);assert.deepEqual(f.replacements,[]);
});

test('notes to AI retains the selected passage and the existing note layout',async t=>{
 const f=realFixture(t),requests=[];let notesOpen=true;
 const book={bookId:'book-one',contentVersion:'v1',title:{en:'A book'},sections:[{chapterId:'ch1',paragraphs:[{id:'p1'},{id:'p2'}]}]};
 const reader={getBook:()=>book,isSelectionActive:()=>notesOpen,getSelectedId:()=> 'p2',getAnchor:()=>({passageId:'p1'}),closeNotes:()=>{notesOpen=false;}};
 const chat=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,mountCompanion:()=>({dispose(){}}),integration:{triggerHost:f.triggerHost,companionAnchor:f.pill,onOpen(){},focusReturn(){}},request:async url=>{requests.push(url);return new Response(JSON.stringify({bookId:'book-one',available:true,contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:new URL(url,'https://local').searchParams.get('passageId'),original:'Source'},turns:[]}));}});
 f.onCleanup(()=>chat.dispose());chat.open();await flush();assert.equal(notesOpen,true);assert.ok(requests.some(url=>url.includes('/chat?passageId=p2')),JSON.stringify(requests));
});

test('real mounted selection capture quotes exact source before opening and never posts a question',async t=>{
 const f=realFixture(t),requests=[];let selected=true;
 const book={bookId:'book-one',contentVersion:'v1',title:{en:'A book'},sections:[{chapterId:'ch1',paragraphs:[{id:'p1',original:'Visible source.'}]}]};
 const reader={getBook:()=>book,isSelectionActive:()=>selected,getExcerpt:()=>({bookId:'book-one',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',language:'en',variant:'literal',start:0,end:7,text:'Visible'}]}),isPassageVisible:()=>true,getAnchor:()=>({passageId:'p1'}),dismissTools:()=>{selected=false;}};
 const chat=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,mountCompanion:()=>({dispose(){}}),integration:{triggerHost:f.triggerHost,companionAnchor:f.pill,onOpen(){},focusReturn(){}},request:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({bookId:'book-one',available:true,contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:'p1',original:'Visible source.'},turns:[]}));}});
 f.onCleanup(()=>chat.dispose());assert.equal(chat.quoteSelection(),true);await flush();assert.equal(f.dialog.open,true);assert.equal(selected,false);assert.equal(f.all(f.dialog).find(node=>node.className==='library-chat-quote-text').textContent,'Visible');assert.equal(requests.some(call=>call.options.method==='POST'),false);
});

test('a hidden old layer snapshot is rejected before opening and is never replaced by its whole paragraph',async t=>{
 const f=realFixture(t),notices=[],book={bookId:'book-one',contentVersion:'v1',title:{en:'A book'},sections:[{chapterId:'ch1',paragraphs:[{id:'p1',original:'Visible source.'}]}]};let opens=0;
 const reader={getBook:()=>book,isSelectionActive:()=>true,getExcerpt:()=>({bookId:'book-one',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',language:'en',start:0,end:7,text:'Visible'}]}),isPassageVisible:()=>true,isQuoteVisible:()=>false,getAnchor:()=>({passageId:'p1'})};
 const chat=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,announce:value=>notices.push(value),mountChat:()=>({update(){},dispose(){},quote(){opens++;return true;}})});f.onCleanup(()=>chat.dispose());assert.equal(chat.quoteSelection(),false);assert.equal(opens,0);assert.equal(notices.length,1);
});

test('reader attachment completes and can select the new chat book while retaining the reader, anchor and original draft',async t=>{
 const f=realFixture(t),requests=[],navigation=[],current={bookId:'book-one',title:{en:'Current'},sections:[{paragraphs:[{id:'p1'}]}]},reader={getBook:()=>current,isSelectionActive:()=>false,getAnchor:()=>({passageId:'p1'}),goToPassage:()=>assert.fail('upload must not move the reader')};
 const previous=globalThis.FileReader;globalThis.FileReader=class{readAsDataURL(){this.result='data:text/plain;base64,Ym9vaw==';this.onload();}};t.after(()=>{globalThis.FileReader=previous;});
 const uploadController=createBookUploadController({getOwner:()=> 'reader-one',getSession:()=>({user:{id:'reader-one'}}),readBase64:async()=> 'Ym9vaw==',api:async()=>({bookId:'new-book',title:{en:'New book'}})});
 const chat=mountReaderConversation({renderMarkdown:renderChatMarkdown,bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader,root:f.dialog,uploadController,mountUpload:mountChatBookUpload,navigate:url=>navigation.push(url),mountCompanion:()=>({dispose(){}}),request:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url==='/api/library/upload'?{bookId:'new-book',title:{en:'New book'}}:url==='/api/library/ingestion'?{jobs:[]}:{bookId:url.includes('new-book')?'new-book':'book-one',available:true,contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:'p1',original:'Source'},turns:[]}));}});f.onCleanup(()=>chat.dispose());chat.open();await flush();const input=f.doc.getElementById('library-chat-input');input.value='Keep my question about the current book.';input.dispatchEvent(new Event('input'));input.focus();chat.upload({name:'new.md',size:4});await flush();await flush();
 assert.equal(input.value,'Keep my question about the current book.');assert.equal(f.doc.activeElement,input);assert.equal(reader.getBook(),current);assert.deepEqual(reader.getAnchor(),{passageId:'p1'});assert.deepEqual(navigation,[]);
 const all=()=>f.all(f.doc.body),select=all().find(n=>n.className.split(' ').includes('chat-book-select'));assert.ok(select);select.click();await flush();assert.ok(requests.some(r=>r.url==='/api/library/books/new-book/chat'));assert.equal(reader.getBook(),current);assert.deepEqual(reader.getAnchor(),{passageId:'p1'});const choice=all().find(n=>n.className==='library-chat-book-choice');choice.value='book-one';choice.dispatchEvent(new Event('change'));await flush();assert.equal(input.value,'Keep my question about the current book.');assert.equal(requests.filter(r=>r.options?.method==='POST'&&r.url.includes('/chat')).length,0);
});


test('reader conversation preserves a terminal billing receipt instead of treating an expired quote as a running question',async()=>{
 const receipt={id:'operation-1',status:'not_started'};
 const f=mount({request:async()=>Response.json({error:'Quote expired',billingOperation:receipt},{status:409})});
 await assert.rejects(f.hooks.api('/api/library/books/book-one/chat',{id:'request-1',text:'Question'}),error=>{assert.deepEqual(error.billingOperation,receipt);return error.status===409;});
 f.instance.dispose();
});
