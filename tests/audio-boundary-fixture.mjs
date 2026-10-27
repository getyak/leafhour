import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import * as locale from '../app/ui-locale.mjs';
import {fixture,Element,syntheticBook} from './reader-audio-fixture.mjs';
export {locale};
export const flush=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
Object.defineProperty(Element.prototype,'innerHTML',{configurable:true,set(value){const parsed=fixture('<body>'+value+'</body>');this.replaceChildren(...parsed.document.body.childNodes);const adopt=n=>{n.ownerDocument=this.ownerDocument;n.childNodes.forEach(adopt);};this.childNodes.forEach(adopt);}});
Element.prototype.click=function(){if(!this.disabled){const event=new Event('click');this.onclick?.(event);this.dispatchEvent(event);}};
async function moduleFactory(name,globals,overrides={}){
 let source=await readFile(new URL('../app/'+name,import.meta.url),'utf8');const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),bindings={},names=[];
 for(const n of ast.body)if(n.type==='ImportDeclaration'){const values=overrides[n.source.value]??await import(new URL('../app/'+n.source.value.slice(2),import.meta.url));for(const s of n.specifiers)bindings[s.local.name]=values[s.imported.name];}else if(n.type==='ExportNamedDeclaration')names.push(n.declaration.id.name);
 for(const n of [...ast.body].reverse())if(n.type==='ImportDeclaration')source=source.slice(0,n.start)+source.slice(n.end);else if(n.type==='ExportNamedDeclaration')source=source.slice(0,n.start)+source.slice(n.declaration.start);
 if(name==='reader-audio-bootstrap.mjs')source=source.replace('\nmountAudioBootstrap();','');
 return vm.runInNewContext(source+';({'+names.join(',')+'})',{...globals,...bindings});
}
export async function audioBoundaryFixture({ready=Promise.resolve(),loader,request,markers={},bookReady=true,failObserver=false,storageFail=false,anonymous=false}={}){
 const f=fixture(await readFile(new URL('../app/index.html',import.meta.url),'utf8'));const book=syntheticBook();let currentBook=bookReady?book:null,selection={chapterId:'ch01',parts:[{passageId:'p1',language:'en',start:3,end:9,text:'literal source'}]};
 const counts={imports:0,uuid:0,play:0,pause:0,picker:0,reads:0,storage:0,observers:0,disconnected:0,subscriptions:0,unsubscribed:0},calls=[],loads=[],timers=new Map(),storage=new Map(Object.entries(markers)),session={user:anonymous?null:{id:'owner-a'}};
 const $=id=>f.document.getElementById(id);
 const reader={getBook(){counts.reads++;return currentBook;},getState(){counts.reads++;return {mode:'en',variant:'literal',chapterId:'ch01'};},getChapterId:()=> 'ch01',getExcerpt(){counts.reads++;return selection;},getAudioSelection(){counts.reads++;return selection;},getSelectedId:()=> 'p1',getAnchor:()=>({passageId:'p1'}),dismissTools(){},ensurePassages:async()=>{},goToPassage(){}};
 f.win.marginaliaReader=reader;f.win.location={reload(){counts.reload=(counts.reload||0)+1;}};
 const data={getItem(key){counts.storage++;if(storageFail)throw Error('storage unavailable');return storage.get(key)||null;},setItem(key,value){counts.storage++;storage.set(key,value);},removeItem(key){counts.storage++;storage.delete(key);}};
 const fetchAudio=async(url,options={})=>{calls.push({url,options});if(request){const value=await request(url,options);if(value!==undefined)return value;}if(url.endsWith('/capabilities'))return Response.json({local:true,speechAvailable:true,dialogueAvailable:true,voices:[{id:'Puck',label:'Real voice 原名'}]});if(url.endsWith('/preferences'))return Response.json({narrator:'Puck',speed:1.5,follow:false});if(url.endsWith('/prepare'))return Response.json({clips:[],estimate:{seconds:1}});if(url.endsWith('/records'))return Response.json({sessions:[],dialogues:[],guideJobs:[]});return Response.json({});};
 const api={readerFetch:fetchAudio,readerStorageKey:key=>key,readerSession:session};
 let media;const create=f.document.createElement;
 f.document.createElement=tag=>{const node=create(tag);if(tag==='audio'){media=node;Object.assign(node,{paused:true,currentTime:0,duration:120,playbackRate:1,pause(){counts.pause++;this.paused=true;this.dispatchEvent(new Event('pause'));},play(){counts.play++;this.paused=false;this.dispatchEvent(new Event('play'));return Promise.resolve();},load(){}});}return node;};
 const createMedia=f.document.createElement;f.document.createElement=tag=>{const node=createMedia(tag);if(tag==='audio')Object.defineProperty(node,'src',{get(){return this.getAttribute('src')||'';},set(value){this.setAttribute('src',value);}});return node;};
 $('audio-import-input').click=()=>{counts.picker++;};
 const localeDep={...locale,uiReady:ready,onUiLocaleChange:fn=>{counts.subscriptions++;const off=locale.onUiLocaleChange(fn);return()=>{counts.unsubscribed++;off();};}};
 const globals={document:f.document,window:f.win,navigator:{},ResizeObserver:class{constructor(){counts.observers++;}observe(){if(failObserver===true||typeof failObserver==='function'&&failObserver(counts))throw Error('Synthetic setup failure');}disconnect(){counts.disconnected++;}},localStorage:data,location:f.win.location,crypto:{randomUUID(){counts.uuid++;return 'uuid';}},innerHeight:900,setTimeout:(fn,ms)=>{const id=timers.size+1;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),queueMicrotask,Blob,URL:{createObjectURL:()=>{counts.downloads=(counts.downloads||0)+1;return 'blob:synthetic';},revokeObjectURL(){}},CustomEvent:class extends Event{constructor(name,options){super(name);this.detail=options?.detail;}}};
 const audio=await moduleFactory('reader-audio.js',globals,{'./ui-locale.mjs':localeDep});
 const bootstrap=await moduleFactory('reader-audio-bootstrap.mjs',globals,{'./ui-locale.mjs':localeDep,'./reader-api.mjs':api});
 const load=async retry=>{counts.imports++;loads.push(retry);return loader?loader(retry,audio):audio;};
 const params={document:f.document,window:f.win,storage:data,fetchAudio,storageKey:api.readerStorageKey,session,load,ready};
 const handle=bootstrap.mountAudioBootstrap(params);
 return {...f,$,book,reader,session,counts,calls,storage,loads,timers,handle,audio,params,bootstrap,get media(){return media;},setBook(value,event=true){currentBook=value;if(event)f.document.dispatchEvent(new Event('reader:ready'));},select(value){selection=value;f.document.dispatchEvent(new Event('reader:selection'));},file(file){$('audio-import-input').files=[file];$('audio-import-input').dispatchEvent(new Event('change'));},event(type,values={}){const event=new Event(type);Object.assign(event,values);f.win.dispatchEvent(event);},close(){handle.dispose();}};
}
