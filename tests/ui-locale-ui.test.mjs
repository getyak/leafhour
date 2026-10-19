import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import {mountUiLocaleControls} from '../app/ui-locale-controls.mjs';
import {withUiParam,UI_PREFERENCE_KEY,parseUiParam} from '../app/ui-locale-codec.mjs';
import {safeReaderReturn,readerLoginUrl,safeGiftReturn} from '../app/reader-return.mjs';
import {safeAuthReturn} from '../server/auth-policy.mjs';
import {parseLibraryView,writeLibraryView,libraryViewReducer,safeLibraryReturn} from '../app/library-view-state.mjs';
import en from '../app/ui-catalogs/en.mjs';
import zhHans from '../app/ui-catalogs/zh-Hans.mjs';
import zhHant from '../app/ui-catalogs/zh-Hant.mjs';
import ja from '../app/ui-catalogs/ja.mjs';

// Small DOM primitive: enough for bindUi and the language-picker view helper.
class FakeNode extends EventTarget{
  constructor(tag='div'){super();this.tagName=tag;this.attributes=new Map();this.children=[];this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.type='';this.checked=false;this.value='';this.ownerDocument=null;}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  removeAttribute(name){this.attributes.delete(name);}
  append(...nodes){for(const node of nodes){node.ownerDocument=this.ownerDocument;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[...nodes];for(const node of nodes)node.ownerDocument=this.ownerDocument;}
  querySelectorAll(selector){
    const out=[];
    const match=node=>selector.split(',').some(part=>{part=part.trim();if(part.startsWith('[data-ui')){const name=part.slice(1,-1).split('=')[0];return node.attributes.has(name);}return false;});
    const walk=node=>{for(const child of node.children){if(match(child))out.push(child);walk(child);}};
    walk(this);
    return out;
  }
}
const fakeDocument=()=>({createElement:tag=>{const node=new FakeNode(tag);node.ownerDocument=doc;return node;},documentElement:new FakeNode('html')});
const doc=fakeDocument();

const realCatalogues={en,'zh-Hans':zhHans,'zh-Hant':zhHant,ja};
const okCatalogue=code=>realCatalogues[code]||en;
function runtimeFixture({storage=null,href='https://leafhour.com/library'}={}){
  const location={href};
  const history={state:{keep:true},replaceState(state,title,url){this.state=state;location.href=new URL(url,location.href).href;}};
  const calls=[];
  return {
    location,history,calls,
    runtime:createUiLocale({
      loadCatalogue:async(code,{retry=false}={})=>{calls.push(code+(retry?'?retry=1':''));return okCatalogue(code);},
      storage,history,getLocation:()=>({href:location.href,routeCode:'en'}),getHistoryState:()=>history.state
    })
  };
}

test('bindUi relabels explicit data-ui nodes in place and preserves drafts, focus and source text',async()=>{
  const f=runtimeFixture({storage:{getItem:()=>null,setItem(){}}});
  void f.runtime.initialize();
  const root=new FakeNode();root.ownerDocument=doc;
  const label=new FakeNode('span');label.setAttribute('data-ui','ui.language.label');
  const input=new FakeNode('input');input.value='untouched draft';
  const source=new FakeNode('p');source.textContent='Alice was beginning to get very tired…';
  const aria=new FakeNode('button');aria.setAttribute('data-ui-aria-label','ui.locale.retry');
  root.append(label,input,source,aria);
  f.runtime.bindUi(root);
  assert.equal(label.textContent,'Interface language');
  assert.equal(aria.getAttribute('aria-label'),'Retry');
  assert.equal(label.getAttribute('lang'),'en','interactive roots carry their actual language');
  input.value='kept while relabelling';input.focus?.();
  await f.runtime.setUiLocale('ja');
  assert.equal(label.textContent,'表示言語');
  assert.equal(aria.getAttribute('aria-label'),'再試行');
  assert.equal(input.value,'kept while relabelling','form drafts survive in-place relabelling');
  assert.equal(source.textContent,'Alice was beginning to get very tired…','source content is never rewritten');
});

test('the language picker view drives injected runtime callbacks and shows honest states',async()=>{
  const f=runtimeFixture({storage:{getItem:()=>null,setItem(){}}});
  void f.runtime.initialize();
  const root=new FakeNode();root.ownerDocument=doc;
  const stateListeners=[];
  const control=mountUiLocaleControls({root,options:['en','ja'],getState:f.runtime.getUiLocaleState,setLocale:code=>{f.runtime.setUiLocale(code).catch(()=>{});},retry:()=>{f.runtime.retryUiLocale().catch(()=>{});},subscribeState:fn=>{stateListeners.push(fn);return()=>{};},labels:id=>en[id]||id});
  assert.ok(control);
  assert.equal(root.children.length,5,'fieldset, current line, notice, retry and reload');
  const attempt=f.runtime.setUiLocale('ja');
  for(const listener of stateListeners)listener();
  await attempt;
  for(const listener of stateListeners)listener();
  const current=root.children[1];
  assert.match(current.textContent,/Interface language: 中国語|Interface language/,'the current language is disclosed');
  await f.runtime.setUiLocale('en');
  for(const listener of stateListeners)listener();
  assert.equal(root.children[2].hidden,true,'no notice when everything is saved');
});

test('owned links, reader returns and auth returns carry exactly one validated ui on a fresh device',()=>{
  assert.equal(readerLoginUrl({bookId:'alice',ui:'ja'}),'/library?login=1&next=%2Fread%3Fbook%3Dalice%26ui%3Dja&ui=ja');
  assert.equal(safeReaderReturn('/read?book=alice&passage=p3&ui=zh-Hant'),'/read?book=alice&passage=p3&ui=zh-Hant');
  assert.equal(safeReaderReturn('/read?book=alice&ui=ja&ui=en'),null,'duplicate ui rejects the whole safe next');
  assert.equal(safeReaderReturn('/read?book=alice&ui=zz'),null,'unsupported ui never broadens the next');
  assert.equal(safeReaderReturn('/read?book=alice&passage=p1&contentVersion=v2&layer=literal&ui=ja'),'/read?book=alice&passage=p1&contentVersion=v2&layer=literal&ui=ja');
  assert.equal(safeAuthReturn('/library?settings=account&ui=ja'),'/library?settings=account&ui=ja');
  assert.equal(safeAuthReturn('/library?settings=account&ui=ja&ui=en'),null);
  assert.equal(safeAuthReturn('/read?book=alice&ui=ja&passage=p9'),' /read?book=alice&passage=p9&ui=ja'.trim());
  assert.equal(safeAuthReturn('/library?settings=account'),'/library?settings=account','legacy returns stay compatible');
  assert.equal(safeGiftReturn('/gift/'+'A'.repeat(43)),'/gift/'+'A'.repeat(43));
});

test('the production view codec preserves ui with q/topic/source language and overlay writes',()=>{
  const state=parseLibraryView('?q=alice&topic=fiction&language=zh&settings=account&ui=ja');
  assert.equal(state.ui,'ja');
  const written=writeLibraryView('?q=alice&topic=fiction&language=zh&settings=account&ui=ja',libraryViewReducer(state,{type:'set-query',query:'bob'}));
  const params=new URLSearchParams(written.slice(1));
  assert.equal(params.get('q'),'bob');
  assert.equal(params.get('topic'),'fiction');
  assert.equal(params.get('language'),'zh');
  assert.equal(params.get('settings'),'account');
  assert.deepEqual(params.getAll('ui'),['ja'],'exactly one validated ui survives view writes');
  const dropped=writeLibraryView('?ui=ja&ui=en&q=x',{view:parseLibraryView('').view,overlay:null});
  assert.equal(new URLSearchParams(dropped.slice(1)).has('ui'),false,'conflicting ui is never propagated');
  assert.equal(safeLibraryReturn('/library?q=alice&ui=ja&other=x'),'/library?q=alice&ui=ja');
});

test('a locale commit is the only side effect: no API, model, record, upload or audio call happens',async()=>{
  const sideEffects=[];
  const f=runtimeFixture({storage:{getItem:()=>null,setItem:(key,value)=>sideEffects.push(['storage',key,value])}});
  void f.runtime.initialize();
  f.runtime.onUiLocaleChange(()=>sideEffects.push(['language-notify']));
  const result=await f.runtime.setUiLocale('ja');
  assert.equal(result.kind,'committed+saved');
  assert.deepEqual(sideEffects.filter(entry=>entry[0]==='storage'),[['storage',UI_PREFERENCE_KEY,'ja']],'the only write is the one UI preference key');
  assert.deepEqual(sideEffects.filter(entry=>entry[0]==='language-notify').length,1,'one locale notification per transaction');
  assert.match(f.location.href,/ui=ja/);
  assert.equal(f.history.state.keep,true,'history state survives the owned ui merge');
});
