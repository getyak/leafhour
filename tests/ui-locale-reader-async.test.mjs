import test from 'node:test';
import assert from 'node:assert/strict';

test('source provenance can be captured as owned message IDs without altering source metadata',async()=>{
 const module=await import('../app/document-source.mjs'),book=Object.freeze({source:Object.freeze({format:'pdf',processor:'native+paddle-auto-v1',structure:'pdf_outline',filename:'来源 / 阅读.pdf'})});
 assert.equal(typeof module.sourceDescriptionMessages,'function');assert.deepEqual(module.sourceDescriptionMessages(book),['source.description.mixed','source.description.pages','source.description.outline']);assert.equal(book.source.filename,'来源 / 阅读.pdf');
});
test('sample disclosure descriptors keep exact sample counts and provider names outside interface keys',async()=>{
 const module=await import('../app/catalog-sample.mjs'),book=Object.freeze({chineseSample:Object.freeze({paragraphs:6,translator:'Source 阅读 / Provider'})});
 assert.equal(typeof module.sampleNoticeMessage,'function');assert.deepEqual(module.sampleNoticeMessage(book),{id:'sample.notice',params:{count:6}});assert.deepEqual(module.translationDisclosureMessage(book),{id:'sample.disclosure',params:{count:6,translator:'Source 阅读 / Provider'}});
});

import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {randomUUID} from 'node:crypto';
import {prepareCreditRequest} from '../app/credit-client.mjs';
import * as creditLabels from '../app/credit-labels.mjs';
import {t,onUiLocaleChange,uiHref,getUiLocale,createUiLabels,requestUiRoute} from '../app/ui-locale.mjs';
import {sourceDescriptionMessages} from '../app/document-source.mjs';
import {createTranslationPresentation,hasDualDrafts} from '../app/translation-state.mjs';
import {chineseOriginalOnly} from '../app/source-language.mjs';
import {sampleNoticeMessage,translationDisclosureMessage} from '../app/catalog-sample.mjs';
import {readerLoginUrl} from '../app/reader-return.mjs';
const source=await readFile(new URL('../app/reader-translation.js',import.meta.url),'utf8'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),factory=tree.body.find(n=>n.declaration?.id?.name==='mountReaderTranslation').declaration;
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.parentElement=null;this.attrs={};this.dataset={};this._text='';this.hidden=false;this.disabled=false;this.value='';this.scrollTop=0;this.open=false;}
 get isConnected(){return this===this.doc.body||!!this.parentElement?.isConnected;}
 set textContent(value){this._text=String(value??'');for(const child of this.children)child.parentElement=null;this.children=[];}
 get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
 append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
 prepend(...nodes){for(const n of [...nodes].reverse()){n.remove();n.parentElement=this;this.children.unshift(n);}}
 insertBefore(node,before){node.remove();node.parentElement=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}
 replaceChildren(...nodes){this.doc.replacements++;this.textContent='';this.append(...nodes);}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
 closest(selector){for(let node=this;node;node=node.parentElement)if(selector.startsWith('.')&&node.className?.split(/\s+/).includes(selector.slice(1)))return node;return null;}
 click(){if(!this.disabled){this.doc.clicks.push(this);this.dispatchEvent(new Event('click'));}}
 focus(){this.doc.activeElement=this;}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
function fixture({visibility='public',request,session={user:{id:'owner-one'},translationAvailable:true},book:initialBook,intentStorage}={}){
 if(intentStorage===undefined){const values=new Map();intentStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
 const doc=new EventTarget();doc.replacements=0;doc.clicks=[];doc.body=new Element('body',doc);doc.createElement=tag=>new Element(tag,doc);doc.querySelectorAll=()=>[];doc.getElementById=id=>descendants(doc.body).find(n=>n.id===id)||null;
 for(const id of ['paragraph-tools','chapter-heading','translation-about']){const e=doc.createElement('div');e.id=id;doc.body.append(e);}
 const invitationGroup=doc.createElement('section'),invitationRow=doc.createElement('div'),invitation=doc.createElement('input'),invitationHelp=doc.createElement('p');
 invitationGroup.className='settings-habit';invitationRow.className='setting-row';invitation.id='chapter-invitations';invitationHelp.textContent='Offers prompts during ordinary reading.';
 invitationRow.append(invitation);invitationGroup.append(invitationRow,invitationHelp);doc.body.append(invitationGroup);
 let book=initialBook||{bookId:'fixture-book',contentVersion:'v1',visibility,source:{format:'pdf',processor:'pdfjs-native',structure:'pdf_outline',filename:'来源 / 阅读.pdf'},chapters:[{id:'c1'}],sections:[{chapterId:'c1',paragraphs:[{id:'p1',original:'Original source one.',translations:{}},{id:'p2',original:'Original source two.',translations:{}}]}]},selected='p1',bridgeReads=0,viewReads=0;
 const context=vm.createContext({t,onUiLocaleChange,uiHref,getUiLocale,createUiLabels,crypto:{randomUUID},creditErrorId:creditLabels.creditErrorId,creditActionLabel:(action,locale)=>{assert.equal(action,'translation');return '1 point ['+locale+']';},sourceDescriptionMessages,createTranslationPresentation:()=>{const tasks=createTranslationPresentation(),view=tasks.view;tasks.view=(...args)=>{viewReads++;return view(...args);};return tasks;},hasDualDrafts,chineseOriginalOnly,sampleNoticeMessage,translationDisclosureMessage,readerLoginUrl,AbortController,CustomEvent,Response,downloadOriginalParts:()=>assert.fail('Not a multipart download fixture')});
 vm.runInContext(source.slice(factory.start,factory.end),context);
 const requests=[],navigations=[],urls=[],timers=[],clears=[];
 const handle=context.mountReaderTranslation({bookId:'fixture-book',session,intentStorage,document:doc,getReader:()=>{bridgeReads++;return {getBook:()=>book,getSelectedId:()=>selected};},request:async(url,options)=>{requests.push({url,options});return request(url,options);},navigate:url=>navigations.push(url),urlApi:{createObjectURL:blob=>{urls.push({kind:'create',blob});return 'blob:fixture';},revokeObjectURL:url=>urls.push({kind:'revoke',url})},timers:{setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:id=>clears.push(id)}});
 const select=id=>{selected=id;doc.dispatchEvent(new Event('reader:selection'));};
 return {doc,handle,requests,navigations,urls,timers,clears,select,invitationGroup,invitationHelp,getBook:()=>book,setBook:value=>book=value,counts:()=>({bridgeReads,viewReads,requests:requests.length,replacements:doc.replacements}),all:()=>descendants(doc.body)};
}

test('hosted reading hides the unavailable chapter-prompt setting including its orphan help',async tctx=>{
 const f=fixture({request:async()=>Response.json({available:false})});tctx.after(()=>f.handle.dispose());
 assert.equal(f.invitationGroup.hidden,true,'the unavailable habit must not leave its description and divider visible');
 assert.equal(f.invitationHelp.textContent,'Offers prompts during ordinary reading.','hiding presentation does not delete local reading guidance');
 assert.equal(f.requests.length,0,'removing unavailable controls does not start translation or any other request');
});

for(const outcome of ['success','conflict','incomplete'])test('translation '+outcome+' keeps the submitted passage and current draft stable through all UI languages',async tctx=>{
 await requestUiRoute('en');const pending=deferred(),f=fixture({request:()=>pending.promise});tctx.after(async()=>{f.handle.dispose();await requestUiRoute('en');});
 const events=[];f.doc.addEventListener('reader:translation',e=>{events.push(e.detail);});f.select('p1');const button=f.doc.getElementById('translate-passage');button.click();await flush();
 assert.equal(button.textContent,'Translating…');assert.equal(button.disabled,true);assert.equal(f.requests.length,1);const submitted=f.requests[0].options.body;assert.deepEqual(JSON.parse(submitted),{passageId:'p1'});
 const input=f.doc.createElement('textarea');Object.defineProperty(input,'value',{get:()=> '来源 / 阅读 · unsaved draft',set:()=>assert.fail('Locale wrote a draft')});input.selectionStart=2;input.selectionEnd=5;input.scrollTop=37;f.doc.body.append(input);f.doc.activeElement=input;
 const original=JSON.stringify(f.getBook()),before=f.counts();
 for(const [locale,label]of [['ja','翻訳中…'],['zh-Hant','正在翻譯…'],['zh-Hans','正在翻译…'],['en','Translating…']]){await requestUiRoute(locale);assert.equal(button.textContent,label);assert.equal(button.disabled,true);assert.deepEqual(f.counts(),before);assert.equal(f.doc.activeElement,input);assert.equal(input.value,'来源 / 阅读 · unsaved draft');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(input.scrollTop,37);assert.equal(JSON.stringify(f.getBook()),original);assert.equal(f.requests[0].options.body,submitted);}
 if(outcome==='success'){f.select('p2');pending.resolve(Response.json({id:'p1',original:'Original source one.',translations:{literal:{text:'Literal 来源'},interpretive:{text:'Interpretive 阅读'}}}));await flush();assert.equal(events.length,1);assert.equal(events[0].id,'p1');assert.equal(events[0].reveal,false);assert.equal(events[0].translations.literal.text,'Literal 来源');assert.equal(button.textContent,'Translate passage');}
 else{pending.resolve(Response.json(outcome==='conflict'?{error:'Untrusted remote prose'}:{id:'wrong',translations:{}},{status:outcome==='conflict'?409:200}));await flush();assert.equal(events.length,0);assert.equal(button.textContent,'Retry translation');const hint=f.all().find(n=>n.className==='translation-notice');assert.ok(!hint.textContent.includes('Untrusted remote prose'));assert.match(hint.textContent,outcome==='conflict'?/could not be completed/:/two complete translations/);await requestUiRoute('ja');assert.equal(button.textContent,'翻訳を再試行');}
 assert.equal(f.requests.length,1);assert.equal(f.doc.activeElement,input);assert.equal(input.value,'来源 / 阅读 · unsaved draft');
});

test('source download and review controls retain their nodes, source metadata and request during locale commits',async tctx=>{
 await requestUiRoute('en');const download=deferred(),f=fixture({visibility:'private',request:async url=>url==='/api/original/info'?Response.json({available:true,filename:'来源 / 阅读.pdf',bytes:4}):download.promise});tctx.after(async()=>{f.handle.dispose();await requestUiRoute('en');});await flush();
 const review=f.all().find(n=>n.className==='source-review'),filename=f.all().find(n=>n.className==='source-filename'),button=f.all().find(n=>n.className==='source-download'&&n.tagName==='BUTTON'),reviewLink=f.all().find(n=>n.className==='source-download'&&n.tagName==='A');assert.ok(button);assert.equal(filename.textContent,'来源 / 阅读.pdf');review.open=true;review.scrollTop=87;
 Object.defineProperty(filename,'textContent',{get:()=> '来源 / 阅读.pdf',set:()=>assert.fail('Locale rewrote the source filename')});const children=[...review.children],before=f.counts();await requestUiRoute('ja');assert.deepEqual(f.counts(),before);assert.deepEqual(review.children,children);assert.equal(review.open,true);assert.equal(review.scrollTop,87);assert.equal(button.textContent,'元のファイルをダウンロードして照合 ↗');assert.ok(reviewLink.href.includes('ui=ja'));assert.equal(f.urls.length,0);
 button.click();await flush();assert.equal(button.disabled,true);const during=f.counts();await requestUiRoute('zh-Hant');assert.deepEqual(f.counts(),during);assert.equal(button.disabled,true);assert.equal(f.all().includes(button),true);assert.equal(f.urls.length,0);download.resolve(new Response('file'));await flush();assert.equal(button.disabled,false);assert.equal(f.urls.filter(x=>x.kind==='create').length,1);const anchor=f.doc.clicks.find(n=>n.tagName==='A');assert.equal(anchor.download,'来源 / 阅读.pdf');assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,1000);
});

test('disposed translation consumes late success and failure and permits a fresh mount',async tctx=>{
 await requestUiRoute('en');tctx.after(()=>requestUiRoute('en'));
 for(const outcome of ['success','failure']){const pending=deferred(),f=fixture({request:()=>pending.promise}),events=[];f.doc.addEventListener('reader:translation',e=>events.push(e.detail));f.select('p1');f.doc.getElementById('translate-passage').click();await flush();f.handle.dispose();const before=f.counts();if(outcome==='success')pending.resolve(Response.json({id:'p1',translations:{literal:{text:'a'},interpretive:{text:'b'}}}));else pending.reject(Error('Late provider prose'));await flush();await requestUiRoute('ja');assert.equal(events.length,0);assert.deepEqual(f.counts(),before);assert.equal(f.doc.getElementById('translate-passage'),null);}
 const fresh=fixture({request:()=>assert.fail('Mounting public controls does not translate')});assert.equal(fresh.doc.getElementById('translate-passage').textContent,'この段落を翻訳');fresh.handle.dispose();
});

test('book/version transitions invalidate translation completions even when the original version returns',async tctx=>{
 await requestUiRoute('en');tctx.after(()=>requestUiRoute('en'));
 for(const transition of ['version-ABA','same-object-ABA','other-book']){
  const pending=deferred(),f=fixture({request:()=>pending.promise}),events=[];f.doc.addEventListener('reader:translation',e=>events.push(e.detail));f.select('p1');f.doc.getElementById('translate-passage').click();await flush();
  const original=f.getBook();if(transition==='same-object-ABA'){original.contentVersion='v2';f.doc.dispatchEvent(new Event('reader:ready'));original.contentVersion='v1';f.doc.dispatchEvent(new Event('reader:ready'));}else{f.setBook({...original,...(transition==='version-ABA'?{contentVersion:'v2'}:{bookId:'other-book'})});f.doc.dispatchEvent(new Event('reader:ready'));if(transition==='version-ABA'){f.setBook(original);f.doc.dispatchEvent(new Event('reader:ready'));}}
  pending.resolve(Response.json({id:'p1',translations:{literal:{text:'Old result'},interpretive:{text:'Old result variant'}}}));await flush();assert.equal(events.length,0,transition+' consumes the old completion');f.handle.dispose();
 }
});
test('paid untranslated button uses the shared point label in every locale and posts the captured source version',async tctx=>{
 await requestUiRoute('en');const pending=deferred(),f=fixture({session:{user:{id:'owner-one'},translationAvailable:true,billing:{enabled:true}},request:()=>pending.promise});tctx.after(async()=>{f.handle.dispose();await requestUiRoute('en');});
 f.select('p1');const button=f.doc.getElementById('translate-passage');
 for(const locale of ['en','zh-Hans','zh-Hant','ja']){await requestUiRoute(locale);assert.ok(button.textContent.endsWith('1 point ['+locale+']'));}
 button.click();await flush();const body=JSON.parse(f.requests[0].options.body);assert.equal(body.passageId,'p1');assert.equal(body.contentVersion,'v1');assert.match(body.id,/^[A-Za-z0-9_-]+$/);pending.resolve(Response.json({id:'p1',translations:{literal:{text:'Literal'},interpretive:{text:'Interpretive'}}}));await flush();
 const book=f.getBook();book.sections[0].paragraphs[0].translations={literal:{text:'Saved literal'},interpretive:{text:'Saved interpretive'}};f.doc.dispatchEvent(new Event('reader:ready'));f.select('p1');assert.equal(button.textContent,t('translation.viewDrafts'));assert.doesNotMatch(button.textContent,/point/);const count=f.requests.length;button.click();await flush();assert.equal(f.requests.length,count);
});
test('paid translation intent survives unknown response and remount, with owner and source isolation',async tctx=>{
 await requestUiRoute('en');tctx.after(()=>requestUiRoute('en'));const saved=new Map(),intentStorage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},session={user:{id:'owner-one'},translationAvailable:true,billing:{enabled:true}};
 const first=fixture({session,intentStorage,request:async()=>{throw Error('Unknown transport outcome');}});first.select('p1');first.doc.getElementById('translate-passage').click();await flush();const original=JSON.parse(first.requests[0].options.body);assert.ok(original.id);first.doc.getElementById('translate-passage').click();await flush();assert.equal(JSON.parse(first.requests[1].options.body).id,original.id);first.handle.dispose();
 const next=fixture({session,intentStorage,request:async()=>Response.json({billingOperation:{id:'credit-'+'a'.repeat(64),status:'released'}},{status:502})});next.select('p1');next.doc.getElementById('translate-passage').click();await flush();assert.equal(JSON.parse(next.requests[0].options.body).id,original.id);next.doc.getElementById('translate-passage').click();await flush();assert.notEqual(JSON.parse(next.requests[1].options.body).id,original.id);next.handle.dispose();
 const foreign=fixture({session:{...session,user:{id:'owner-two'}},intentStorage,request:async()=>{throw Error('unknown');}});foreign.select('p1');foreign.doc.getElementById('translate-passage').click();await flush();assert.notEqual(JSON.parse(foreign.requests[0].options.body).id,original.id);foreign.handle.dispose();
 const revised=fixture({session,intentStorage,book:{...first.getBook(),contentVersion:'v2'},request:async()=>{throw Error('unknown');}});revised.select('p1');revised.doc.getElementById('translate-passage').click();await flush();assert.notEqual(JSON.parse(revised.requests[0].options.body).id,original.id);revised.handle.dispose();
 assert.doesNotMatch(JSON.stringify([...saved]),/Original source|Unknown transport|Literal/);
});
test('reader translation remount with the real credit helper reuses the persisted quote and idempotency pair',{timeout:5000},async tctx=>{
 await requestUiRoute('en');tctx.after(()=>requestUiRoute('en'));const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},session={user:{id:'owner-reload'},translationAvailable:true,billing:{enabled:true,mode:'test',unitsPerPoint:1_000_000,prices:{translation:1_000_000,conversation:4_000_000,annotation:4_000_000}}},prepared=[];let quotes=0,requestPrepared;
 const fetcher=async(url,options)=>{
  if(url==='/api/auth/session')return Response.json({user:{id:'owner-reload'}});
  assert.equal(url,'/api/billing/quotes');quotes++;const request=JSON.parse(options.body);return Response.json({id:'quote-reload',ownerId:'owner-reload',action:'translation',units:1_000_000,expiresAt:'2099-01-01T00:00:00Z',scope:{bookId:'fixture-book',contentVersion:'v1',passageId:'p1',requestId:request.input.id}});
 };
 const request=async(url,options)=>{
  assert.equal(url,'/api/translate');const data=await prepareCreditRequest({url:'/api/library/books/fixture-book/translate',data:JSON.parse(options.body),session,owner:'owner-reload',isCurrent:()=>!options.signal.aborted,fetcher,confirm:()=>true,storage});prepared.push(data);requestPrepared.resolve();throw Error('Lost generation acknowledgement');
 };
 for(let mount=0;mount<2;mount++){requestPrepared=deferred();const f=fixture({session,intentStorage:storage,request});f.select('p1');f.doc.getElementById('translate-passage').click();await requestPrepared.promise;await flush();f.handle.dispose();}
 assert.equal(prepared.length,2);assert.equal(quotes,1);assert.equal(prepared[0].id,prepared[1].id);assert.deepEqual(prepared[0].billing,prepared[1].billing);assert.equal(prepared[0].billing.quoteId,'quote-reload');
});
test('paid translation cannot start without durable browser identity storage',async tctx=>{
 await requestUiRoute('en');tctx.after(()=>requestUiRoute('en'));const f=fixture({session:{user:{id:'owner-one'},translationAvailable:true,billing:{enabled:true}},intentStorage:null,request:()=>assert.fail('No paid request without a recoverable identity')});tctx.after(()=>f.handle.dispose());f.select('p1');f.doc.getElementById('translate-passage').click();await flush();assert.equal(f.requests.length,0);assert.match(f.doc.getElementById('translate-passage').textContent,/Retry/);
});
test('translation explains insufficient points and cancelled consent without claiming a model failure',async tctx=>{
 await requestUiRoute('en');tctx.after(()=>requestUiRoute('en'));
 for(const error of [Object.assign(Error('Internal billing failure'),{status:402,preSubmit:true}),Object.assign(Error('Internal consent event'),{code:'BILLING_CONSENT_CANCELLED',status:409,preSubmit:true})]){
  const f=fixture({session:{user:{id:'owner-one'},translationAvailable:true,billing:{enabled:true}},request:async()=>{throw error;}});
  try{f.select('p1');f.doc.getElementById('translate-passage').click();await flush();const hint=f.all().find(n=>n.className==='translation-notice');
   assert.match(hint.textContent,error.status===402?/Not enough reading points/:/cancelled.*No reading points/i);assert.doesNotMatch(hint.textContent,/could not be completed|Internal/);
   const link=f.all().find(n=>n.className==='billing-link');assert.equal(link.hidden,error.status!==402);
   if(error.status===402){assert.equal(link.href,'/billing?ui=en');await requestUiRoute('ja');assert.match(hint.textContent,/ポイントが不足/);assert.equal(link.href,'/billing?ui=ja');await requestUiRoute('en');}
   assert.deepEqual(f.getBook().sections[0].paragraphs[0].translations,{});
  }finally{f.handle.dispose();}
 }
});
test('routine translation guidance folds away while task feedback stays visible',async tctx=>{
 await requestUiRoute('en');const f=fixture({request:async()=>{throw Error('Offline');}});tctx.after(async()=>{f.handle.dispose();await requestUiRoute('en');});
 const hint=f.all().find(n=>n.className==='translation-notice');
 assert.equal(hint.parentElement.tagName,'DETAILS');assert.equal(hint.parentElement.open,false);
 assert.match(hint.textContent,/one on either side/,'the sending boundary remains available');
 const scope=f.doc.getElementById('translation-action-scope');assert.equal(scope.hidden,true);assert.equal(f.doc.getElementById('translate-passage').getAttribute('aria-describedby'),null);
 f.select('p1');assert.equal(hint.parentElement.id,'chapter-heading');assert.equal(scope.hidden,false);assert.match(scope.textContent,/cloud model.*drafts/);assert.equal(f.doc.getElementById('translate-passage').getAttribute('aria-describedby'),scope.id);
 f.doc.getElementById('translate-passage').click();await flush();assert.equal(hint.parentElement.id,'chapter-heading');assert.match(hint.textContent,/could not be completed/);
 f.select(null);assert.equal(hint.parentElement.id,'chapter-heading','background failure must remain visible');assert.equal(f.doc.getElementById('translate-passage').getAttribute('aria-describedby'),null);
});
test('sample scope is never folded into routine translation guidance',async tctx=>{
 await requestUiRoute('en');const f=fixture({book:{bookId:'fixture-book',contentVersion:'v1',visibility:'public',chineseSample:{paragraphs:6,translator:'Source / Provider'},sections:[],chapters:[]},request:()=>assert.fail('No generation')});tctx.after(()=>f.handle.dispose());
 const hint=f.all().find(n=>n.className==='translation-notice');assert.equal(hint.parentElement.id,'chapter-heading');assert.match(hint.textContent,/6/);
});
