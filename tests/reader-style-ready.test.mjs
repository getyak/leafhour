import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReaderStyles} from '../app/reader-style-ready.mjs';
function fixture(){
 const view=Object.assign(new EventTarget(),{location:{reload(){reloads++;}}}),back={dataset:{}},events=new EventTarget(),retry=new EventTarget(),skeleton={hidden:false},status={textContent:'Opening the book…'},jobs=new Map();let id=0,reloads=0;
 const loading={querySelector:s=>s==='.reading-skeleton'?skeleton:s==='[role="status"]'?status:s==='a'?back:retry},style=Object.assign(events,{remove(){this.removed=true;}});
 const document={body:{dataset:{}},head:{append(node){assert.equal(node,style);}},createElement:()=>style,querySelector:s=>s==='link[data-reader-styles]'?{href:'https://reader.invalid/reader-web/style.css'}:{textContent:'This book could not open right now.'},getElementById:()=>loading,defaultView:view};
 const options={schedule:fn=>{jobs.set(++id,fn);return id;},cancel:id=>jobs.delete(id)};
 return {document,style,retry,skeleton,status,jobs,options,back,dispose:()=>view.dispatchEvent(new Event('pagehide')),reloads:()=>reloads};
}
test('full stylesheet load settles before reading UI is exposed',async()=>{
 const f=fixture(),pending=prepareReaderStyles(f.document,f.options);
 assert.equal(f.style.media,'print');assert.equal(f.document.body.dataset.readerStyled,undefined);assert.equal(f.skeleton.hidden,false);
 f.style.dispatchEvent(new Event('load'));await pending;
 assert.equal(f.style.media,'all');assert.equal(f.document.body.dataset.readerStyled,'true');assert.equal(f.jobs.size,0);
 f.style.dispatchEvent(new Event('error'));assert.equal(f.skeleton.hidden,false);
});
test('cached stylesheet failure preserves the library exit and offers a real reload',async()=>{
 const f=fixture(),pending=prepareReaderStyles(f.document,f.options);f.style.dispatchEvent(new Event('error'));
 await assert.rejects(pending,/Reader styles unavailable/);assert.equal(f.document.body.dataset.readerStyled,undefined);assert.equal(f.style.removed,true);assert.equal(f.skeleton.hidden,true);assert.equal(f.jobs.size,0);assert.equal(f.status.textContent,'This book could not open right now.');assert.equal(f.retry.hidden,false);
 f.retry.dispatchEvent(new Event('click'));assert.equal(f.reloads(),1);f.dispose();
});
test('a stylesheet that never settles has bounded recovery; raw local pages keep existing CSS',async()=>{
 const f=fixture(),pending=prepareReaderStyles(f.document,f.options);[...f.jobs.values()][0]();await assert.rejects(pending,/Reader styles unavailable/);assert.equal(f.retry.hidden,false);assert.equal(f.jobs.size,0);f.dispose();
 await prepareReaderStyles({querySelector:()=>null,createElement(){assert.fail('raw local reader does not create another stylesheet');}});
});

test('the inline shell is permitted only by its exact hash on reader documents',async()=>{
 const {createHash}=await import('node:crypto'),{readFile}=await import('node:fs/promises');
 const {READER_CRITICAL_CSS}=await import('../server/reader-shell.mjs'),{contentSecurityPolicy}=await import('../server/content-security.mjs');
 const hash="'sha256-"+createHash('sha256').update(READER_CRITICAL_CSS).digest('base64')+"'";
 for(const policy of [contentSecurityPolicy('/read'),contentSecurityPolicy('/read.html')]){assert.ok(policy.includes(hash));assert.ok(!policy.includes('unsafe-inline'));assert.ok(policy.includes("script-src 'self'"));}
 assert.ok(!contentSecurityPolicy('/library').includes(hash));assert.ok(!/@import|url\(|@font-face/.test(READER_CRITICAL_CSS),'critical shell has no secondary resource dependencies');
});


test('standalone CSS failure follows late locale commits without restarting recovery',async()=>{
 const {requestUiRoute,t,getUiLinkLocale}=await import('../app/ui-locale.mjs');await requestUiRoute('en');const f=fixture();
 try{const pending=prepareReaderStyles(f.document,f.options);f.style.dispatchEvent(new Event('error'));await assert.rejects(pending,/Reader styles unavailable/);
  for(const code of ['ja','zh-Hans','zh-Hant','en']){await requestUiRoute(code);assert.equal(f.status.textContent,t('reader.shell.loadError'));assert.equal(f.retry.textContent,t('reader.shell.retryOpen'));assert.equal(f.back.textContent,t('reader.shell.backLibrary'));const url=new URL(f.back.href,'https://reader.invalid');assert.equal(url.pathname,'/library');assert.equal(url.searchParams.get('ui'),getUiLinkLocale());assert.equal(f.skeleton.hidden,true);assert.equal(f.jobs.size,0);}
  f.dispose();const text=f.status.textContent;await requestUiRoute('ja');assert.equal(f.status.textContent,text);f.retry.dispatchEvent(new Event('click'));assert.equal(f.reloads(),0);
 }finally{f.dispose();await requestUiRoute('en');}
});

test('reader handoff refreshes registered exits after fast CSS and a late saved language',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const {createUiLocale}=await import('../app/ui-locale.mjs'),{UI_PREFERENCE_KEY}=await import('../app/ui-locale-codec.mjs'),ja=(await import('../app/ui-catalogs/ja.mjs')).default;
 let release;const catalogue=new Promise(resolve=>release=resolve),runtime=createUiLocale({loadCatalogue:()=>catalogue,storage:{getItem:key=>key===UI_PREFERENCE_KEY?'ja':null,setItem(){}},getLocation:()=>({href:'https://leafhour.com/read?book=gutenberg-alice&ui=ja'}),history:{state:null,replaceState(){}}}),ready=runtime.initializeOnce();
 const f=fixture(),source=await readFile(new URL('../app/reader-style-ready.mjs',import.meta.url),'utf8');
 const context={t:runtime.t,uiReady:ready,onUiLocaleChange:runtime.onUiLocaleChange,uiHref:runtime.uiHref,setTimeout,clearTimeout,Error};vm.createContext(context);vm.runInContext(source.replace(/^import[^\n]+\n/,'').replace('export async function','async function')+'\nthis.prepare=prepareReaderStyles;',context);
 const prepared=context.prepare(f.document,f.options);f.style.dispatchEvent(new Event('load'));await prepared;assert.equal(f.back.href,'/library?ui=en');
 release(ja);await ready;assert.equal(runtime.uiHref('/library'),'/library?ui=ja');
 f.back.getAttribute=()=>f.back.href;
 f.document.querySelectorAll=selector=>selector.split(',').some(s=>s==='[data-reader-ui-link]'?Object.hasOwn(f.back.dataset,'readerUiLink'):s.match(/^a\[href="([^"]+)"\]$/)?.[1]===f.back.href)?[f.back]:[];
 const reader=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),start=reader.indexOf("for(const link of document.querySelectorAll('a[href=\"/library\"]");assert.ok(start>=0);const loop=reader.slice(start,reader.indexOf('\n',start));
 vm.runInNewContext(loop,{document:f.document,uiHref:runtime.uiHref});assert.equal(f.back.href,'/library?ui=ja');assert.equal(f.back.dataset.readerUiLink,'/library');f.dispose();
});
