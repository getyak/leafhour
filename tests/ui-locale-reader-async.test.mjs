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
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 closest(){return null;}
 click(){if(!this.disabled){this.doc.clicks.push(this);this.dispatchEvent(new Event('click'));}}
 focus(){this.doc.activeElement=this;}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
function fixture({visibility='public',request,session={user:{id:'owner-one'},translationAvailable:true},book:initialBook}={}){
 const doc=new EventTarget();doc.replacements=0;doc.clicks=[];doc.body=new Element('body',doc);doc.createElement=tag=>new Element(tag,doc);doc.querySelectorAll=()=>[];doc.getElementById=id=>descendants(doc.body).find(n=>n.id===id)||null;
 for(const id of ['paragraph-tools','chapter-heading','translation-about','chapter-invitations']){const e=doc.createElement('div');e.id=id;doc.body.append(e);}
 let book=initialBook||{bookId:'fixture-book',contentVersion:'v1',visibility,source:{format:'pdf',processor:'pdfjs-native',structure:'pdf_outline',filename:'来源 / 阅读.pdf'},chapters:[{id:'c1'}],sections:[{chapterId:'c1',paragraphs:[{id:'p1',original:'Original source one.',translations:{}},{id:'p2',original:'Original source two.',translations:{}}]}]},selected='p1',bridgeReads=0,viewReads=0;
 const context=vm.createContext({t,onUiLocaleChange,uiHref,getUiLocale,createUiLabels,sourceDescriptionMessages,createTranslationPresentation:()=>{const tasks=createTranslationPresentation(),view=tasks.view;tasks.view=(...args)=>{viewReads++;return view(...args);};return tasks;},hasDualDrafts,chineseOriginalOnly,sampleNoticeMessage,translationDisclosureMessage,readerLoginUrl,AbortController,CustomEvent,Response,downloadOriginalParts:()=>assert.fail('Not a multipart download fixture')});
 vm.runInContext(source.slice(factory.start,factory.end),context);
 const requests=[],navigations=[],urls=[],timers=[],clears=[];
 const handle=context.mountReaderTranslation({bookId:'fixture-book',session,document:doc,getReader:()=>{bridgeReads++;return {getBook:()=>book,getSelectedId:()=>selected};},request:async(url,options)=>{requests.push({url,options});return request(url,options);},navigate:url=>navigations.push(url),urlApi:{createObjectURL:blob=>{urls.push({kind:'create',blob});return 'blob:fixture';},revokeObjectURL:url=>urls.push({kind:'revoke',url})},timers:{setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:id=>clears.push(id)}});
 const select=id=>{selected=id;doc.dispatchEvent(new Event('reader:selection'));};
 return {doc,handle,requests,navigations,urls,timers,clears,select,getBook:()=>book,setBook:value=>book=value,counts:()=>({bridgeReads,viewReads,requests:requests.length,replacements:doc.replacements}),all:()=>descendants(doc.body)};
}

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
