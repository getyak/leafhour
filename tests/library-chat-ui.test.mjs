import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLibraryChat} from '../app/library-chat.mjs';
import {safeChatUrl} from '../app/library-chat-markdown.mjs';

// Minimal DOM contract for event/state regressions; layout is verified in a browser.
class Element extends EventTarget {
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.attrs={};this.style={setProperty(k,v){this[k]=v;}};this.value='';this.open=false;this.isConnected=true;this.scrollHeight=1000;this.clientHeight=300;this.scrollTop=700;this.className='';this.classList={add:(s)=>this.className+=' '+s,toggle:(s,on)=>{const names=new Set(this.className.split(' ').filter(Boolean));if(on)names.add(s);else names.delete(s);this.className=[...names].join(' ');}};}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.replacements=(this.replacements||0)+1;this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(n=>n!==this);this.parentElement=null;}}
  insertBefore(n,before){n.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,n);n.parentElement=this;}
  after(n){this.parentElement.append(n);}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k];}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  focus(){this.doc.activeElement=this;}
  show(){this.open=true;this.mode='nonmodal';this.focus();}
  showModal(){this.open=true;this.mode='modal';}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
  click(){this.dispatchEvent(new Event('click',{cancelable:true}));}
  getBoundingClientRect(){return {top:0};}
  get clientTop(){return this._clientTop||0;}
  set clientTop(value){this._clientTop=value;}
  querySelector(){return null;}
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(t,{handler,navigate}={}){
 const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>{const n=new Element('#text',doc);n.textContent=text;return n;};doc.body=doc.createElement('body');const all=()=>{const visit=n=>[n,...n.children.flatMap(visit)];return visit(doc.body);};doc.getElementById=id=>all().find(n=>n.id===id);doc.querySelectorAll=()=>[];
 const previous={document:globalThis.document,localStorage:globalThis.localStorage,window:globalThis.window};const storage=new Map();globalThis.document=doc;globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};const viewport=new EventTarget();viewport.height=800;viewport.offsetTop=0;globalThis.window={matchMedia:()=>({matches:false}),visualViewport:viewport};t.after(()=>Object.assign(globalThis,previous));
 const root=doc.createElement('dialog');root.id='chat';doc.body.append(root);const external=doc.createElement('button');doc.body.append(external);external.focus();let owner='alice',passage='p1',turns=[];const calls=[];
 const api=async(url,payload)=>{calls.push({url,payload});if(handler)return handler(url,payload,{turns,setTurns:v=>turns=v});if(payload){const turn={...payload,status:'running',answer:null};turns=[...turns,turn];return turn;}return {bookId:'one',available:true,contentVersion:'v1',context:{passageId:new URL(url,'http://local').searchParams.get('passageId')||'p1',chapterTitle:'章节',original:'Source'},turns};};
 const chat=mountLibraryChat({root,api,getSession:()=>owner?{user:{id:owner}}:null,getOwner:()=>owner,getBooks:()=>[{bookId:'one',title:{zh:'书名'}}],openAuth(){},getCurrentBook:()=> 'one',getCurrentPassage:()=>passage,onNavigateToPassage:navigate||(()=>true)});t.after(()=>chat.close());
 return {root,chat,doc,calls,external,viewport,all,find:cls=>all().find(n=>n.className.split(' ').includes(cls)),input:()=>doc.getElementById('library-chat-input'),setTurns:v=>turns=v,setOwner:v=>owner=v,setPassage:v=>passage=v,complete:()=>{turns=turns.map(turn=>turn.status==='completed'?turn:({...turn,status:'completed',answer:{summary:'真实回答',sourceRefs:[]}}));}};
}
function type(el,text){el.value=text;el.dispatchEvent(new Event('input'));}

test('companion opens as an AI-only message, locates inside IM and preserves the existing draft',async t=>{
  const s=setup(t);s.chat.open();await flush();type(s.input(),'尚未发出的原话');s.chat.close();
  s.setTurns([{id:'squirrel-one',kind:'companion',origin:'ai',text:null,status:'completed',passageId:'p2',answer:{summary:'这里让我想到前面读到的一段。',sourceRefs:[]}}]);
  s.chat.open({messageId:'squirrel-one',passageId:'p2'});await flush();
  assert.equal(s.input().value,'尚未发出的原话');assert.equal(s.find('library-chat-question'),undefined);assert.equal(s.find('library-chat-attribution').textContent,'AI · 陪读');
  assert.equal(s.find('library-chat-turn').getAttribute('data-message-id'),'squirrel-one');assert.equal(s.chat.surface().launcher,s.find('library-chat-launcher'));
});

test('opening is nonmodal and collapse preserves the draft and returns focus',async t=>{const s=setup(t);s.chat.open();await flush();assert.equal(s.root.mode,'nonmodal');assert.notEqual(s.doc.activeElement,s.input());type(s.input(),'留下的问题');s.chat.close();assert.equal(s.doc.activeElement,s.external);s.setPassage('p2');s.chat.open();await flush();assert.equal(s.input().value,'留下的问题');assert.ok(s.calls.at(-1).url.includes('p1'));assert.equal(s.calls.filter(c=>c.payload).length,0);});
test('keyboard viewport shrink reveals the active composer by scrolling only its frame',async t=>{
 const s=setup(t);s.chat.open();await flush();s.input().focus();const frame=s.find('library-chat-frame');frame.scrollTop=0;
 frame.getBoundingClientRect=()=>({bottom:384});s.find('library-chat-composer').getBoundingClientRect=()=>({bottom:510});
 s.viewport.height=400;s.viewport.dispatchEvent(new Event('resize'));assert.equal(frame.scrollTop,126);
 s.external.focus();s.viewport.dispatchEvent(new Event('resize'));assert.equal(frame.scrollTop,126,'resizing must not move an unfocused conversation');
});
test('typing preserves messages, source content, and book options DOM',async t=>{const s=setup(t);s.chat.open();await flush();const log=s.find('library-chat-messages'),chooser=s.find('library-chat-book-choice'),context=s.find('library-chat-context-body');const counts=[log.replacements,chooser.replacements,context.replacements];type(s.input(),'新问题');assert.deepEqual([log.replacements,chooser.replacements,context.replacements],counts);});
test('composition Enter never sends; collapsed running request resumes without a duplicate send',async t=>{const s=setup(t);s.chat.open();await flush();type(s.input(),'我的问题');s.input().dispatchEvent(new Event('compositionstart'));const enter=new Event('keydown',{cancelable:true});Object.assign(enter,{key:'Enter'});s.input().dispatchEvent(enter);await flush();assert.equal(s.calls.filter(c=>c.payload).length,0);s.input().dispatchEvent(new Event('compositionend'));s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();const sent=s.calls.find(c=>c.payload);assert.ok(sent.payload.id);s.chat.close();s.complete();s.chat.open();await flush();assert.equal(s.calls.filter(c=>c.payload).length,1);assert.equal(s.input().disabled,false);});
test('account change clears visible private text; current passage refreshes only without a draft',async t=>{const s=setup(t);s.chat.open();await flush();s.chat.close();s.setPassage('p2');s.chat.open();await flush();assert.ok(s.calls.at(-1).url.includes('p2'));type(s.input(),'私人草稿');s.setOwner('bob');s.chat.update();await flush();assert.equal(s.input().value,'');});
test('Escape outside the conversation does not collapse it and source navigation can stay in page',async t=>{const s=setup(t);s.chat.open();await flush();s.external.focus();const key=new Event('keydown',{cancelable:true});Object.assign(key,{key:'Escape'});s.doc.dispatchEvent(key);assert.equal(s.root.open,true);const source=s.find('library-chat-source-link');const click=new Event('click',{cancelable:true});source.dispatchEvent(click);assert.equal(click.defaultPrevented,true);assert.equal(s.root.open,false);});
test('Escape inside the conversation collapses it and single book has a static title',async t=>{const s=setup(t);s.chat.open();await flush();assert.equal(s.find('library-chat-book-choice').hidden,true);assert.equal(s.find('library-chat-book-title').textContent,'书名');const key=new Event('keydown',{cancelable:true});Object.assign(key,{key:'Escape'});s.root.dispatchEvent(key);assert.equal(s.root.open,false);assert.equal(key.defaultPrevented,true);});
test('new answer preserves a reader position near the top of message history',async t=>{const s=setup(t);s.chat.open();await flush();type(s.input(),'我的问题');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();const messages=s.find('library-chat-messages');messages.scrollTop=20;s.complete();s.find('library-chat-text-button');s.chat.close();s.chat.open();await flush();assert.equal(messages.scrollTop,20);});

test('context disclosure stays available to assistive technology and in the more menu',async t=>{const s=setup(t);s.chat.open();await flush();const hint=s.doc.getElementById('library-chat-hint');assert.ok(s.input().getAttribute('aria-describedby').split(' ').includes(hint.id));assert.ok(hint.className.split(' ').includes('sr-only'));assert.equal(s.find('library-chat-menu-hint').textContent,hint.textContent);assert.ok(!hint.textContent.includes('相邻段'));});

test('visual viewport resize enables a scrollable compact layout independently of screen width',async t=>{const s=setup(t);s.chat.open();await flush();assert.equal(s.root.className.includes('is-compact-viewport'),false);s.viewport.height=300;s.viewport.offsetTop=45;s.viewport.dispatchEvent(new Event('resize'));assert.equal(s.root.style['--chat-viewport-height'],'300px');assert.equal(s.root.style['--chat-viewport-top'],'45px');assert.equal(s.root.className.includes('is-compact-viewport'),true);s.viewport.offsetTop=75;s.viewport.dispatchEvent(new Event('scroll'));assert.equal(s.root.style['--chat-viewport-top'],'75px');s.viewport.height=800;s.viewport.offsetTop=0;s.viewport.dispatchEvent(new Event('resize'));assert.equal(s.root.className.includes('is-compact-viewport'),false);assert.equal(s.root.open,true);assert.equal(s.calls.filter(c=>c.payload).length,0);});

test('completed turn nodes and expanded citations survive refresh and another answer',async t=>{const s=setup(t);s.setTurns([{id:'previous',passageId:'p1',status:'completed',text:'旧问题',answer:{summary:'旧回答',sourceRefs:[{passageId:'p1',quote:'Source'}]}}]);s.chat.open();await flush();const row=s.find('library-chat-turn'),reference=s.find('library-chat-references');reference.open=true;s.chat.open();await flush();assert.equal(s.find('library-chat-turn'),row);assert.equal(s.find('library-chat-references'),reference);type(s.input(),'新问题');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(s.find('library-chat-turn'),row);s.complete();s.chat.open();await flush();assert.equal(s.find('library-chat-turn'),row);assert.equal(s.find('library-chat-references'),reference);assert.equal(reference.open,true);assert.equal(s.find('library-chat-messages').children.length,2);});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=turns=>({bookId:'one',available:true,contentVersion:'v1',context:{passageId:'p1',chapterTitle:'章节',original:'Source'},turns});
const plain=n=>String(n.textContent||'')+n.children.map(plain).join('');
test('pending POST is polled immediately, early empty GET retains local question, terminal GET wins over late POST',async t=>{
  const post=deferred();let posted=false,getCount=0,receipt;
  const s=setup(t,{handler:async(url,payload)=>{if(payload){posted=true;receipt={...payload,status:'running',answer:null};return post.promise;}getCount++;return response(posted&&getCount>2?[{...receipt,status:'completed',answer:{summary:'已完成',sourceRefs:[]}}]:[]);}});
  s.chat.open();await flush();type(s.input(),'我的问题');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
  assert.ok(getCount>=2,'GET starts before pending POST resolves');assert.ok(s.find('library-chat-question'));assert.equal(s.input().disabled,true);
  s.chat.close();s.chat.open();await flush();assert.equal(s.input().disabled,false);assert.ok(s.find('library-chat-answer'));
  post.resolve(receipt);await flush();assert.equal(s.input().disabled,false);assert.ok(plain(s.find('library-chat-answer')).includes('已完成'));
});
test('cancel receipt defeats a delayed POST and pending tool activity updates preserve row DOM',async t=>{
  const post=deferred();let receipt,activity=[];
  const s=setup(t,{handler:async(url,payload)=>{if(url.endsWith('/cancel'))return {...receipt,status:'cancelled',activity};if(payload){receipt={...payload,status:'running',answer:null};return post.promise;}return response(receipt?[{...receipt,activity}]:[]);}});
  s.chat.open();await flush();type(s.input(),'我的问题');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();const row=s.find('library-chat-turn');
  activity=[{tool:'reader_read_chapter',label:'正在阅读章节',status:'running',chapterId:'ch2'}];s.chat.close();s.chat.open();await flush();assert.equal(s.find('library-chat-turn'),row);assert.ok(plain(row).includes('正在阅读章节'));
  s.find('library-chat-stop').click();await flush();post.resolve({...receipt,status:'completed',answer:{summary:'迟到回答'}});await flush();assert.equal(s.find('library-chat-answer'),undefined);assert.equal(s.input().disabled,false);assert.ok(!s.find('library-chat-activity'),'cancelled tools cannot look active');
});
test('Markdown renders real headings tables quotes and code safely with only registered internal links',async t=>{
  const navigated=[];const s=setup(t,{navigate:(...args)=>{navigated.push(args);return true;}});
  s.setTurns([{id:'md',status:'completed',text:'比较章节',answer:{summary:'## 两章的联系\n\n| 章节 | 观点 |\n| --- | --- |\n| 第一章 | **开始** |\n| 第二章 | *变化* |\n\n> 一段引用\n\n```js\n<img src=x onerror=alert(1)>\n```\n\n[原文](/read?book=two&passage=p4) [伪造](/read?book=secret&passage=p5) [坏链接](javascript:alert(1)) [网站](https://example.org/a) `inline`',sourceRefs:[{bookId:'two',passageId:'p4',quote:'真实引用',layer:'literal',translationStatus:'draft',url:'/read?book=two&passage=p4'}],recommendations:[{bookId:'two',title:'已有书',owned:true,url:'/read?book=two',source:'library'},{bookId:'public',title:'公版',owned:false,url:'/read?book=public',source:'catalog'},{title:'外部',owned:false,url:'https://openlibrary.org/works/OL1W',source:'openlibrary'}]}}]);
  s.chat.open();await flush();const tags=s.all().map(n=>n.tagName);for(const tag of ['H2','TABLE','BLOCKQUOTE','PRE','CODE','STRONG','EM'])assert.ok(tags.includes(tag),tag);assert.ok(!tags.includes('IMG'));
  const links=s.all().filter(n=>n.tagName==='A');assert.ok(!links.some(n=>String(n.href).includes('secret')||String(n.href).startsWith('javascript:')));assert.ok(links.some(n=>n.href==='/read?book=two&passage=p4'));assert.ok(plain(s.find('library-chat-references')).includes('直译 · 草稿'));assert.ok(plain(s.find('library-chat-recommendations')).includes('可直接阅读'));assert.ok(plain(s.find('library-chat-recommendations')).includes('外部书目'));
  links.find(n=>n.href==='/read?book=two&passage=p4').click();assert.equal(navigated.length,0,'other-book links use normal navigation');
});
test('automatic progress reads continue beyond twelve polls throughout the run lease',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const post=deferred();let receipt,reads=0;
 const s=setup(t,{handler:async(url,payload)=>{if(payload){receipt={...payload,status:'running',answer:null};return post.promise;}reads++;return response(receipt?[receipt]:[]);}});
 s.chat.open();await flush();type(s.input(),'长任务');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 for(let i=0;i<17;i++){t.mock.timers.tick(5000);await flush();}
 assert.ok(reads>14,'progress must not freeze at the old twelve-poll cutoff');assert.equal(s.input().disabled,true);
 post.resolve({...receipt,status:'completed',answer:{summary:'完成',sourceRefs:[]}});await flush();assert.equal(s.input().disabled,false);
});

test('unsafe URLs and same-origin absolute navigation cannot bypass the citation allowlist',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,x','https://name:password@example.org/','//example.org/','/read?book=secret','https://reader.example/read?book=secret&passage=p1','https://reader.example/library'])assert.equal(safeChatUrl(value,{origin:'https://reader.example'}),null,value);
 assert.equal(safeChatUrl('https://example.org/article',{origin:'https://reader.example'}),'https://example.org/article');
});

test('an explicit successful reload restores the composer when its retry disappears',async t=>{
 let first=true;const next=deferred();const s=setup(t,{handler:async()=>{if(first){first=false;throw Error('503');}return next.promise;}});
 s.chat.open();await flush();const retry=s.all().find(n=>n.textContent==='重新载入');retry.focus();retry.click();s.doc.activeElement=s.doc.body;
 next.resolve(response([]));await flush();assert.equal(retry.hidden,true);assert.equal(s.doc.activeElement===s.input(),true);
});

test('a completed explicit stop restores the cancelled question and composer focus',async t=>{
 const cancelled=deferred();let running;const s=setup(t,{handler:async(url,payload)=>{if(url.endsWith('/cancel'))return cancelled.promise;if(payload){running={...payload,status:'running',answer:null};return running;}return response(running?[running]:[]);}});
 s.chat.open();await flush();type(s.input(),'保留的问题');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 const stop=s.find('library-chat-stop');stop.focus();stop.click();s.doc.activeElement=s.doc.body;cancelled.resolve({...running,status:'cancelled'});await flush();
 assert.equal(stop.hidden,true);assert.equal(s.input().value,'保留的问题');assert.equal(s.doc.activeElement===s.input(),true);
});

test('reload completion does not take focus after the reader chose another control',async t=>{
 let first=true;const next=deferred();const s=setup(t,{handler:async()=>{if(first){first=false;throw Error('503');}return next.promise;}});
 s.chat.open();await flush();const retry=s.all().find(n=>n.textContent==='重新载入');retry.focus();retry.click();s.external.focus();
 const moved=new Event('focusin');Object.defineProperty(moved,'target',{value:s.external});s.doc.dispatchEvent(moved);s.doc.activeElement=s.doc.body;
 next.resolve(response([]));await flush();assert.equal(s.doc.activeElement===s.doc.body,true);
});
test('completed POST survives a delayed pre-claim empty GET in the view and exported conversation',async t=>{
 const post=deferred(),earlyGet=deferred();let reads=0,receipt;
 const s=setup(t,{handler:async(url,payload)=>{if(payload){receipt={...payload,status:'running',answer:null};return post.promise;}reads++;return reads===1?response([]):earlyGet.promise;}});
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL;let exported;
 URL.createObjectURL=blob=>{exported=blob;return 'blob:chat-export';};URL.revokeObjectURL=()=>{};t.after(()=>{URL.createObjectURL=create;URL.revokeObjectURL=revoke;});
 s.chat.open();await flush();type(s.input(),'先完成这个问题');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(reads,2);
 post.resolve({...receipt,status:'completed',answer:{summary:'已经保存的完整回答',sourceRefs:[]}});await flush();assert.ok(s.find('library-chat-answer'));assert.equal(s.input().disabled,false);
 earlyGet.resolve(response([]));await flush();assert.ok(s.find('library-chat-answer'),'old empty snapshot cannot erase completed POST');assert.ok(plain(s.find('library-chat-answer')).includes('已经保存的完整回答'));
 const exportButton=s.all().find(n=>n.tagName==='BUTTON'&&n.textContent==='导出这段对话');exportButton.click();const data=JSON.parse(await exported.text());assert.equal(data.turns.length,1);assert.equal(data.turns[0].answer.summary,'已经保存的完整回答');
 type(s.input(),'下一个问题');assert.equal(s.find('library-chat-send').disabled,false);assert.equal(s.input().value,'下一个问题');
});
test('a newly completed long answer opens at its beginning without moving the page or resetting reopened history',async t=>{
 const post=deferred();let receipt;
 const s=setup(t,{handler:async(url,payload)=>{if(payload){receipt={...payload,status:'running',answer:null};return post.promise;}return response(receipt?[receipt]:[]);}});
 s.chat.open();await flush();type(s.input(),'你最喜欢哪一句？');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 const messages=s.find('library-chat-messages');messages.scrollTop=700;messages.clientHeight=300;messages.clientTop=0;messages.getBoundingClientRect=()=>({top:100});
 Object.defineProperty(messages,'scrollHeight',{get:()=>s.find('library-chat-answer')?1800:1000});
 const create=s.doc.createElement;s.doc.createElement=tag=>{const element=create(tag);element.getBoundingClientRect=()=>({top:element.className==='library-chat-answer'?100+420-messages.scrollTop:100});element.scrollIntoView=()=>assert.fail('completion may scroll only the message container');return element;};
 const longAnswer=Array.from({length:20},(_,i)=>'第 '+i+' 段：这一句值得从开头慢慢读。').join('\n\n');
 receipt={...receipt,status:'completed',answer:{summary:longAnswer,sourceRefs:[]}};post.resolve(receipt);await flush();
 assert.equal(messages.scrollTop,420,'align the new AI answer beginning, not its long tail');
 messages.scrollTop=180;s.chat.close();s.chat.open();await flush();assert.equal(messages.scrollTop,180,'reopening existing completed history preserves its position');
});
test('pending turn has one stable status for neutral thinking and real tool activity',async t=>{
 const s=setup(t);s.chat.open();await flush();type(s.input(),'读这一章');s.find('library-chat-composer').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 const row=s.find('library-chat-turn'),pending=s.find('library-chat-turn-status');assert.equal(plain(row).split('正在思考…').length-1,1);
 const receipt=s.calls.find(c=>c.payload).payload;
 for(const activity of [[{tool:'reader_read_chapter',label:'正在阅读章节',status:'running',bookId:'one',chapterId:'ch1'}],[{tool:'reader_read_chapter',label:'正在阅读章节',status:'completed',bookId:'one',chapterId:'ch1'}]]){
  s.setTurns([{...receipt,status:'running',answer:null,activity}]);s.chat.close();s.chat.open();await flush();
  assert.ok(s.find('library-chat-turn-status')===pending,'status DOM remains stable across activities');
  const visibleStatuses=row.children.filter(n=>n.className.includes('library-chat-turn-status')||n.className==='library-chat-activity');assert.equal(visibleStatuses.length,1,'one visual status per pending turn');
  assert.equal(plain(pending),activity[0].status==='running'?'正在阅读章节':'正在思考…');
 }
});
