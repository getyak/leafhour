import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import {createHash,webcrypto} from 'node:crypto';
import * as locale from '../app/ui-locale.mjs';
import * as giftPage from '../app/book-gift.mjs';
import {readGiftQuote} from '../app/gift-quote.mjs';
import {createGiftPreview,readGiftPreview} from '../app/gift-preview.mjs';
import {paintBookCover,paintBookIdentity} from '../app/book-cover-ui.mjs';
import {bookCoverLabel} from '../app/book-binding.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';
import {uiAuthoredPath} from '../app/ui-locale-codec.mjs';
import {trackActionFocus} from '../app/action-focus.mjs';
import english from '../app/ui-catalogs/en.mjs';
const source=await readFile(new URL('../app/book-gift.mjs',import.meta.url),'utf8'),html=await readFile(new URL('../app/book-gift.html',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),block=ast.body.find(n=>n.type==='IfStatement'&&source.slice(n.test.start,n.test.end).includes("typeof document"));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};},flush=()=>new Promise(setImmediate),all=n=>[n,...n.children.flatMap(all)];
class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.dataset={};this.style={setProperty(){}};this.textContent='';this.hidden=false;this.offsetHeight=400;this.className='';this.classList={add(){},remove(){},toggle(){}};}
 get isConnected(){return this===this.ownerDocument.documentElement||!!this.parentElement?.isConnected;}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}replaceChildren(...nodes){for(const n of this.children)n.parentElement=null;this.children=[];this.append(...nodes);}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}querySelectorAll(s){return all(this).slice(1).filter(n=>s.startsWith('.')?n.className.split(' ').includes(s.slice(1)):s.startsWith('a[href=')?n.tagName==='a'&&n.href===s.slice(8,-2):s.includes('[data-ui')?Object.keys(n.attrs).some(k=>k.startsWith('data-ui')):n.tagName===s);}
 focus(){this.ownerDocument.activeElement=this;}contains(n){return all(this).includes(n);}click(){const e=new Event('click',{cancelable:true});this.dispatchEvent(e);}
}
async function fixture({preview=true}={}){
 await locale.requestUiRoute('en');const oldDoc=globalThis.document,doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.documentElement=doc.createElement('html');doc.documentElement.lang='en';doc.body=doc.createElement('body');doc.documentElement.append(doc.body);doc.querySelectorAll=s=>doc.documentElement.querySelectorAll(s);const nodes=new Map(),el=id=>nodes.get(id);doc.getElementById=el;
 for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){const n=doc.createElement(match[1]);n.id=match[3];for(const [,key,value]of match[2].matchAll(/([\w-]+)="([^"]*)"/g))n.setAttribute(key,value);nodes.set(n.id,n);doc.body.append(n);}
 for(const id of ['gift-loading','gift-error']){const child=doc.createElement(id==='gift-loading'?'p':'a');nodes.get(id).append(child);}const env=doc.createElement('div');env.className='gift-envelope';nodes.get('gift-envelope-wrap').append(env);
 const home=doc.createElement('a');home.href='/';const library=doc.createElement('a');library.href='/library';doc.body.append(home,library);globalThis.document=doc;
 const counters={ritual:0,waves:0,fetch:0,focus:0,storage:0},posted=[],blobs=[],timeouts=[],assignments=[],pendingGift=deferred(),parts=[deferred(),deferred()],partRequests=[deferred(),deferred()],downloaded=deferred();let partIndex=0;
 const parent={postMessage(...a){posted.push(a);}},win=Object.assign(new EventTarget(),{parent}),loc={pathname:preview?'/gift-preview':'/gift/'+'A'.repeat(43),origin:'https://leafhour.invalid',assign(url){assignments.push(url);}};
 const media=Object.assign(new EventTarget(),{matches:false});const context={...locale,document:doc,window:win,parent,location:loc,readGiftQuote,readGiftPreview,inferSourceLanguage,uiAuthoredPath,paintBookCover,paintBookIdentity,bookCoverLabel,trackActionFocus,downloadGiftPackage:giftPage.downloadGiftPackage,mountGiftPreviewUiLocale:()=>giftPage.mountGiftPreviewUiLocale({window:win,location:loc,runtime:locale.uiLocale}),matchMedia:()=>media,ResizeObserver:class{observe(){}},createGiftWavesController:()=>({}),createGiftWaveScene:()=>Object.fromEntries(['letter','relayout','reducedChanged','visibility','pageHide','pageShow','failed','presented'].map(k=>[k,()=>{counters.waves++;}])),createGiftSpring:()=>({setOpen(){counters.ritual++;},finish(){counters.ritual++;}}),URLSearchParams,Intl,Date,Event,crypto:webcrypto,URL:{createObjectURL(blob){blobs.push(blob);downloaded.resolve(blob);return 'blob:synthetic-gift';},revokeObjectURL(){}},sessionStorage:{getItem(){counters.storage++;return null;},setItem(){counters.storage++;},removeItem(){counters.storage++;}},setTimeout(fn,ms){timeouts.push([fn,ms]);},async fetch(url){counters.fetch++;const index=url.includes('/download-part?')?partIndex++:null;if(index!==null)partRequests[index].resolve();const data=await (index!==null?parts[index].promise:pendingGift.promise);return {ok:true,headers:{get:()=>null},json:async()=>data};}};
 vm.createContext(context);const started=vm.runInContext('(async()=>{'+source.slice(block.consequent.start+1,block.consequent.end-1).replace("await import('./site-appearance.mjs')",'({})')+'})()',context);
 return {el,doc,win,parent,loc,home,library,counters,posted,blobs,timeouts,assignments,pendingGift,parts,partRequests,downloaded,started,async dispose(){win.dispatchEvent(new Event('pagehide'));globalThis.document=oldDoc;await locale.requestUiRoute('en');}};
}
const message=(f,data)=>{const e=new Event('message');Object.assign(e,{data,origin:f.loc.origin,source:f.parent});f.win.dispatchEvent(e);};
const payload=()=>createGiftPreview({bookId:'b',title:{zh:'来源',en:'Literal English title'},author:'阅读',description:'Literal description',visibility:'public'},{displayName:'阅读'},{recipient:'你',message:'Literal message 阅读',quote:{receipt:'q'.repeat(32),selection:'ai-selected',text:'Literal source quote.',chapterTitle:'Source chapter',passageId:'p1'}},{now:new Date('2026-10-18T12:00:00Z')});
test('public gift preview localizes only the shared cover and preserves the letter and source metadata',async()=>{
 const f=await fixture();try{await f.started;const data=payload();data.gift.bookId='gutenberg-walden';message(f,data);
  const cover=f.el('gift-cover'),title=cover.querySelector('.cover-title'),image=cover.querySelector('img'),letter=f.el('gift-message').textContent,source=f.el('gift-title').textContent;
  assert.ok(image,'the public preview carries a bundled illustrated cover');assert.equal(title.textContent,'Walden');
  const before={...f.counters};await locale.requestUiRoute('ja');assert.equal(title.textContent,'森の生活');assert.equal(cover.querySelector('img'),image);assert.deepEqual(f.counters,before);assert.equal(f.el('gift-message').textContent,letter);assert.equal(source,'Walden');assert.equal(f.el('gift-title').textContent,'森の生活');
 }finally{await f.dispose();}
});
test('actual gift preview relabels UI without presenting again, moving focus or touching letter/source/ritual',async()=>{
 const f=await fixture();try{await f.started;for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.equal(f.el('gift-loading').querySelector('p').textContent,locale.t('gift.preview.loading'));assert.equal(f.doc.title,locale.t('gift.pageTitle'));assert.equal(f.counters.fetch,0);}
 message(f,payload());const ids=['gift-message','gift-title','gift-original-title','gift-author','gift-description','envelope-recipient','envelope-sender','gift-quote-text','gift-quote-source'],literals=ids.map(id=>[id,f.el(id),f.el(id).textContent,f.el(id).lang]);f.el('gift-message').focus();const focus=f.doc.activeElement,before={...f.counters},posted=f.posted.length;
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.deepEqual(f.counters,before);assert.equal(f.posted.length,posted);assert.ok(f.doc.activeElement===focus);for(const [id,n,text,lang]of literals){assert.ok(f.el(id)===n);assert.equal(n.textContent,text);assert.equal(n.lang,lang);}assert.equal(f.el('gift-quote-label').textContent,locale.t('gift.quote.ai'));assert.equal(f.home.href,uiAuthoredPath('/',code));assert.equal(f.library.href,"/library");}
 f.el('gift-download').click();assert.equal(f.el('gift-download-status').textContent,locale.t('gift.preview.download'));await locale.requestUiRoute('ja');assert.equal(f.el('gift-download-status').textContent,locale.t('gift.preview.download'));assert.equal(f.counters.fetch,0);assert.equal(f.blobs.length,0);
 }finally{await f.dispose();}
});
test('actual gift chunk download keeps the same operation and exact verified package while UI changes',{timeout:10000},async()=>{
 const f=await fixture({preview:false});try{await flush();await locale.requestUiRoute('ja');const data=payload().gift;f.pendingGift.resolve({...data,bookId:'b',readUrl:'/read?book=b'});await f.started;const before={...f.counters};f.el('gift-download').click();await flush();assert.equal(f.counters.fetch,before.fetch+1);const count=f.counters.fetch;await locale.requestUiRoute('zh-Hant');assert.equal(f.counters.fetch,count);assert.equal(f.el('gift-download-status').textContent,locale.t('gift.download.preparing'));
 const bytes=Buffer.from(JSON.stringify({kind:'marginalia-library',schemaVersion:1,books:[{title:'Literal source 阅读'}]})),hash=b=>createHash('sha256').update(b).digest('hex'),snapshot=hash(bytes),split=Math.floor(bytes.length/2);const part=(start,end)=>({kind:'marginalia-book-gift-part',schemaVersion:1,offset:start,totalBytes:bytes.length,snapshot,data:bytes.subarray(start,end).toString('base64'),sha256:hash(bytes.subarray(start,end)),nextOffset:end<bytes.length?end:null});f.parts[0].resolve(part(0,split));await f.partRequests[1].promise;assert.equal(f.counters.fetch,count+1);await locale.requestUiRoute('ja');assert.equal(f.counters.fetch,count+1);assert.equal(f.el('gift-download-status').textContent,locale.t('gift.download.progress',{percent:Math.round(split/bytes.length*100)}));f.parts[1].resolve(part(split,bytes.length));await f.downloaded.promise;assert.equal(f.blobs.length,1);assert.deepEqual(Buffer.from(await f.blobs[0].arrayBuffer()),bytes);assert.equal(f.el('gift-download-status').textContent,locale.t('gift.download.saved'));const snapshotCounts={...f.counters};await locale.requestUiRoute('en');assert.deepEqual(f.counters,snapshotCounts);assert.equal(f.blobs.length,1);
 }finally{await f.dispose();}
});
test('gift shell has English defaults and known explicit UI markers',async()=>{
 assert.match(html,/<html lang="en"/);assert.ok(!/\p{Script=Han}/u.test(html));for(const [,id]of html.matchAll(/data-ui(?:-aria-label)?="([^"]+)"/g))assert.equal(typeof english[id],'string',id);

});

test('actual gift failure stays generic and follows current UI without retrying',async()=>{
 const f=await fixture({preview:false});try{await flush();await locale.requestUiRoute('ja');f.pendingGift.reject(Error('UNTRUSTED transport failure'));await f.started;assert.equal(f.el('gift-error-message').textContent,locale.t('gift.unavailable'));const calls=f.counters.fetch;for(const code of ['zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.equal(f.counters.fetch,calls);assert.equal(f.el('gift-error-title').textContent,locale.t('gift.errorTitle'));assert.equal(f.el('gift-error-message').textContent,locale.t('gift.unavailable'));assert.equal(f.el('gift-error-message').lang,code);assert.equal(f.assignments.length,0);}}finally{await f.dispose();}
});
test('explicit gift accept login carries the same effective UI outside and inside the safe gift return',async()=>{
 const f=await fixture({preview:false});try{f.pendingGift.resolve({...payload().gift,readUrl:'/read?book=b'});await f.started;await locale.requestUiRoute('ja');assert.equal(f.assignments.length,0);const calls=f.counters.fetch;f.el('gift-accept').click();await flush();assert.equal(f.counters.fetch,calls+1);assert.equal(f.assignments.length,1);const url=new URL(f.assignments[0],f.loc.origin),next=new URL(url.searchParams.get('next'),f.loc.origin);assert.equal(url.pathname,'/library');assert.deepEqual(url.searchParams.getAll('ui'),[]);assert.equal(next.pathname,'/gift/'+'A'.repeat(43));assert.deepEqual(next.searchParams.getAll('ui'),[]);}finally{await f.dispose();}
});

test('gift source scripts remain unknown unless declared and the salutation keeps its literal recipient node',async()=>{
 const f=await fixture();try{await f.started;const data=payload();data.gift.message='こんにちは、あなたへの本です。';data.gift.description='Русское описание книги';data.gift.quote.text='هذه جملة من المصدر الأصلي.';message(f,data);
 assert.equal(f.el('gift-message').lang,'und');assert.equal(f.el('gift-description').lang,'und');assert.equal(f.el('gift-quote-text').lang,'und');const name=f.el('letter-salutation').children.find(n=>n.className==='gift-salutation-name');assert.ok(name);const literal=name.textContent;Object.defineProperty(name,'textContent',{get:()=>literal,set(){assert.fail('locale must not replace the recipient text');},configurable:true});for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.ok(f.el('letter-salutation').children.includes(name));assert.equal(name.textContent,data.gift.recipient);assert.equal(f.el('gift-message').textContent,data.gift.message);assert.equal(f.el('gift-quote-text').textContent,data.gift.quote.text);}
 }finally{await f.dispose();}
});
