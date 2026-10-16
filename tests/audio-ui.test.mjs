import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {createPlaybackState} from '../app/audio-state.mjs';
const source=await readFile(new URL('../app/reader-audio.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function resetMedia(')>=0?source.indexOf('function resetMedia('):source.indexOf('async function loadClip('),source.indexOf('async function start('));
function fixture(){const playback=createPlaybackState(),previous=playback.begin({owner:'a',book:'book',session:'s',clip:0}),elements=new Map(),messages=[];const media={src:'blob:previous',paused:false,currentTime:0,pause(){this.paused=true;},removeAttribute(k){delete this[k];},getAttribute(k){return this[k]||null;},load(){},addEventListener(){},async play(){this.paused=false;}};const context=vm.createContext({active:{id:'s',status:'generating',clips:[{id:'first',status:'ready'},{id:'next',status:'pending'}]},index:0,media,playback,blobUrl:'blob:previous',URL:{revokeObjectURL(){},createObjectURL(){return 'blob:next';}},readerSession:{user:{id:'a'}},reader:()=>({getBook:()=>({bookId:'book'})}),prefs:{speed:1,follow:true},$:(id)=>{if(!elements.has(id))elements.set(id,{attributes:{},setAttribute(key,value){this.attributes[key]=value;}});return elements.get(id);},label(){},playerStatus(text){messages.push(text);},mark(){},clearMark(){},remember(){},epoch:1,waitingPlay:null,pollTimer:null,setTimeout(){},readerFetch:async()=>({ok:true,blob:async()=>new Blob(['next'])}),api:async()=>({id:'s',status:'ready',clips:[{id:'first',status:'ready'},{id:'next',status:'ready'}]})});vm.runInContext(functions,context);return {context,previous,media,messages,playback,elements};}
test('waiting for a pending clip invalidates previous audio and continues with the ready clip',async()=>{const f=fixture();await f.context.loadClip(1,true);assert.equal(f.media.getAttribute('src'),null);assert.equal(f.playback.accept(f.previous),false);await f.context.poll('s',1);assert.equal(f.media.src,'blob:next');assert.equal(f.media.paused,false);});
test('interrupted clip never advertises an ongoing generation',async()=>{const f=fixture();f.context.active.status='interrupted';await f.context.loadClip(1,true);assert.match(f.messages.at(-1),/中断|未完成/);assert.doesNotMatch(f.messages.at(-1),/正在准备/);});
test('browsing into a neighboring chapter keeps audio active and releases automatic following',()=>{
 const f=fixture(),listeners=new Map();f.context.document={addEventListener(name,handler){listeners.set(name,handler);}};f.context.window={addEventListener(){}};f.context.autoScrollUntil=0;
 vm.runInContext(source.slice(source.indexOf("document.addEventListener('reader:selection'"),source.indexOf("window.addEventListener('pagehide'")),f.context);
 const active=f.context.active;listeners.get('reader:chapter')();assert.equal(f.context.active,active);assert.equal(f.playback.accept(f.previous),true);assert.equal(f.playback.following,false);
 f.playback.setFollowing(true);f.context.autoScrollUntil=Date.now()+10000;listeners.get('reader:chapter')();assert.equal(f.playback.following,true);
});

test('seek feedback is disabled until media duration is known and describes the current position',()=>{
 const f=fixture();f.context.updateClock();assert.equal(f.elements.get('audio-seek').disabled,true);
 f.media.duration=120;f.media.currentTime=30;f.context.updateClock();
 assert.equal(f.elements.get('audio-seek').disabled,false);assert.equal(f.elements.get('audio-seek').value,'25');assert.equal(f.elements.get('audio-seek').attributes['aria-valuetext'],'0:30，共 2:00');
});
test('preparing audio exposes busy state and restores available controls after failure',async()=>{
 let reject;const pending=new Promise((_,r)=>{reject=r;});const enabled={disabled:false,isConnected:true},unavailable={disabled:true,isConnected:true},attributes={},messages=[];
 const context=vm.createContext({busy:false,panelRevision:1,epoch:1,dialog:{open:true,setAttribute(k,v){attributes[k]=v;}},body:{querySelectorAll:()=>[enabled,unavailable]},stop:async()=>{},status:(message)=>messages.push(message),api:()=>pending,crypto:{randomUUID:()=> 'fixture-id'},prefs:{narrator:'voice'},showPlayer(){},playerStatus(){}});
 vm.runInContext(source.slice(source.indexOf('async function start('),source.indexOf('function estimateLine(')),context);
 const result=context.start({mode:'selection'});await new Promise(setImmediate);
 assert.equal(enabled.disabled,true);assert.equal(attributes['aria-busy'],'true');
 reject(Error('声音服务暂时无法连接'));await result;
 assert.equal(enabled.disabled,false);assert.equal(unavailable.disabled,true);assert.equal(attributes['aria-busy'],'false');assert.match(messages.at(-1),/无法连接/);
});

test('audio action clicks do not become record-list messages, while restore receipts remain visible',async()=>{
 const body={children:[],replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}};
 class Element extends EventTarget{constructor(tag,cls,text){super();this.tag=tag;this.className=cls;this.textContent=text??'';this.children=[];}append(...children){this.children.push(...children);}}
 const context=vm.createContext({body,node:(...args)=>new Element(...args),panelRevision:1,panel:()=>1,unavailable:()=>false,status(){},api:async()=>({sessions:[],dialogues:[]}),exportRecords(){},importInput:{click(){}}});
 const action=source.slice(source.indexOf('const button=('),source.indexOf('\n',source.indexOf('const button=(')));
 const records=source.slice(source.indexOf('async function showRecords('),source.indexOf('function download('));
 vm.runInContext(action+'\n'+records+'\nglobalThis.openRecordsButton=button("已保存的听读",showRecords);',context);
 context.openRecordsButton.dispatchEvent(new Event('click'));await new Promise(setImmediate);
 assert.equal(body.children.filter(child=>child.className==='audio-intro').length,1);
 assert.match(body.children.find(child=>child.className==='audio-intro').textContent,/还没有听读记录/);
 assert.equal(body.children.some(child=>String(child.textContent).includes('[object ')),false);
 await context.showRecords('听读记录已恢复。');assert.equal(body.children.find(child=>child.className==='audio-intro').textContent,'听读记录已恢复。');
});

test('switching an open audio panel preserves a stable focus target without taking focus from outside',()=>{
 const oldControl={},external={},document={body:{},activeElement:oldControl},close={focus(){document.activeElement=this;}};
 const body={contains:node=>node===oldControl,replaceChildren(){if(document.activeElement===oldControl)document.activeElement=document.body;}};
 const dialog={open:true,querySelector:()=>close},context=vm.createContext({body,dialog,document,panelRevision:0,$:()=>({})});
 vm.runInContext(source.slice(source.indexOf('function panel('),source.indexOf('function status(')),context);
 context.panel('准备听读');assert.equal(document.activeElement===close,true);
 document.activeElement=external;context.panel('后台载入');assert.equal(document.activeElement===external,true);
});
