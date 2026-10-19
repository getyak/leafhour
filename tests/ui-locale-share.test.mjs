import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import * as locale from '../app/ui-locale.mjs';
import * as share from '../app/share-model.mjs';
import {prepareShareFonts} from '../app/share-fonts.mjs';
import {chineseOriginalOnly} from '../app/source-language.mjs';
const source=await readFile(new URL('../app/share.js',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};},flush=()=>new Promise(setImmediate);
class Element extends EventTarget{
 constructor(){super();this.value='';this.checked=false;this.options=[];this.children=[];this.attrs={};this.open=false;this.isConnected=true;this.classList={add(){},remove(){}};}
 setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}append(...n){for(const child of n){child.parentElement=this;this.children.push(child);}}replaceChildren(...n){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...n);}remove(){}getClientRects(){return [{}];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}click(){this.dispatchEvent(new Event('click'));}
}
async function fixture(){
 await locale.requestUiRoute('en');const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},fontsReady=deferred(),draws=[],writes=[],events=[],timers=[],downloads=[],reads={book:0,excerpt:0,state:0,selected:0,anchor:0,chapter:0,fonts:0};
 const canvas=el('share-canvas'),ctx={fillRect(...a){draws.push(['rect',...a]);},fillText(...a){draws.push(['text',...a]);},measureText(text){return {width:[...text].length*18};},save(){},beginPath(){},rect(){},clip(){},restore(){},createLinearGradient(){return {addColorStop(){}};}};canvas.getContext=()=>ctx;canvas.toBlob=fn=>fn(new Blob([JSON.stringify(draws)],{type:'image/png'}));
 const doc=new EventTarget();doc.getElementById=el;doc.body=new Element();doc.activeElement=new Element();doc.fonts={ready:fontsReady.promise,async load(){reads.fonts++;return [{}];}};doc.createElement=tag=>{const n=new Element();if(tag==='a')n.click=()=>downloads.push(n.download);return n;};doc.dispatchEvent=e=>{events.push(e.type);return true;};
 const book={bookId:'b',contentVersion:'v1',sourceLanguage:'en',title:{zh:'阅读',en:'Literal title'},author:'Literal author',chapters:[{id:'c',number:1}],sections:[{number:1,chapterId:'c',paragraphs:[{id:'p1',original:'Literal source text.',translations:{interpretive:{text:'原意译 阅读'},literal:{text:'原直译 来源'}}}]}]};const p=book.sections[0].paragraphs[0],reader={getBook(){reads.book++;return book;},getExcerpt(){reads.excerpt++;return null;},getState(){reads.state++;return {mode:'en',variant:'interpretive'};},getSelectedId(){reads.selected++;return 'p1';},getChapterId(){reads.chapter++;return 'c';},getAnchor(){reads.anchor++;return {passageId:'p1'};},dismissTools(){},restoreAnchor(){}};
 const win=Object.assign(new EventTarget(),{marginaliaReader:reader}),context={...locale,...share,shareFontsModule:{prepareShareFonts},chineseOriginalOnly,document:doc,window:win,navigator:{},Blob,File,URL:{createObjectURL(){return 'blob:synthetic-share';},revokeObjectURL(){}},CustomEvent:class extends Event{constructor(type,o){super(type);this.detail=o?.detail;}},localStorage:{getItem:()=>null,setItem(...a){writes.push(a);}},setTimeout(fn,ms){timers.push([fn,ms]);},console};vm.createContext(context);
 const executable=ast.body.filter(n=>n.type!=='ImportDeclaration').map(n=>source.slice(n.start,n.end)).join('\n').replace("await import('./share-fonts.mjs')",'globalThis.shareFontsModule');await vm.runInContext('(async()=>{'+executable+'\n})()',context);
 for(const [id,values] of Object.entries({'share-language':['en','zh','bilingual'],'share-variant':['literal','interpretive'],'share-theme':['paper','warm','night'],'share-ratio':['portrait','square','story'],'share-layout':['stack','columns'],'share-above':['hide','fade','keep'],'share-below':['hide','fade','keep']})){el(id).options=values.map(value=>Object.assign(new Element(),{value}));el(id).value=values[0];}el('share-size').value='48';el('share-source').checked=true;
 return {el,win,doc,reads,draws,writes,events,timers,downloads,fontsReady,p,reader};
}
test('actual share language updates leave pending fonts, canvas, snapshot, controls and generated image intact',async()=>{
 const f=await fixture();try{
 f.el('show-share').click();await flush();const before={...f.reads},pendingEvents=f.events.slice();const size=f.el('share-size'),value=size.value;Object.defineProperty(size,'value',{get:()=>value,set(){assert.fail('locale must not write share input');},configurable:true});
 for(const code of ['ja','zh-Hant','zh-Hans','en']){await locale.requestUiRoute(code);assert.deepEqual(f.reads,before);assert.equal(f.draws.length,0);assert.equal(f.writes.length,0);assert.deepEqual(f.events,pendingEvents);assert.equal(f.el('share-language').options[0].textContent,locale.t('share.artifact.originalEn'));}
 f.fontsReady.resolve();await flush();await flush();assert.ok(f.draws.some(d=>d.includes('Literal source text.')));const generated=JSON.stringify(f.draws),accessibility=f.el('share-preview-description').textContent,completedReads={...f.reads},writes=f.writes.length,events=f.events.length,timers=f.timers.length;
 for(const code of ['zh-Hans','ja','zh-Hant','en']){await locale.requestUiRoute(code);assert.equal(JSON.stringify(f.draws),generated);assert.equal(f.el('share-preview-description').textContent,accessibility);assert.deepEqual(f.reads,completedReads);assert.equal(f.writes.length,writes);assert.equal(f.events.length,events);assert.equal(f.timers.length,timers);assert.equal(f.el('share-status').textContent,locale.t('share.localPreview'));}
 f.el('share-download').click();await flush();assert.deepEqual(f.downloads,['阅读-excerpt.png']);assert.equal(JSON.stringify(f.draws),generated);
 }finally{f.win.dispatchEvent(new Event('pagehide'));await locale.requestUiRoute('en');}
});

test('share preparation errors relabel only their owned announcement leaf and never expose raw failures',async()=>{
 const f=await fixture();try{f.reader.getExcerpt=()=>{throw Error('UNTRUSTED remote prose');};f.el('show-share').click();const child=f.el('announcement').children[0];assert.equal(child.textContent,locale.t('share.chooseFirst'));const before={...f.reads};await locale.requestUiRoute('ja');assert.equal(child.textContent,locale.t('share.chooseFirst'));assert.deepEqual(f.reads,before);f.el('announcement').replaceChildren(new Element());child.textContent='detached';await locale.requestUiRoute('en');assert.equal(child.textContent,'detached');assert.equal(f.draws.length,0);assert.equal(f.writes.length,0);}finally{f.win.dispatchEvent(new Event('pagehide'));await locale.requestUiRoute('en');}
});
