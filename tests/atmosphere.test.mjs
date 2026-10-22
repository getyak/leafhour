import test from 'node:test';
import assert from 'node:assert/strict';
import {atmospheres,normalizeAtmosphere,atmosphereMix,createAtmosphereSession} from '../app/atmosphere-state.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as uiLocale from '../app/ui-locale.mjs';

await uiLocale.requestUiRoute('zh-Hans');

test('atmospheres validate saved playback intent alongside scene and levels',()=>{
  assert.deepEqual(normalizeAtmosphere({scene:'forest',music:0,nature:63,motion:false,playing:true}),{scene:'forest',music:0,nature:63,motion:false,playing:true});
  assert.deepEqual(normalizeAtmosphere({scene:'../../private',music:Infinity,nature:-2,motion:'yes'}),{scene:'none',music:28,nature:32,motion:true,playing:false});
  assert.equal(normalizeAtmosphere(null).scene,'none');
  for(const scene of ['forest','rain','hearth','sea','none'])assert.equal(normalizeAtmosphere({scene}).scene,scene);
});

test('narration ducks both channels without changing saved volume, zero stays silent',()=>{
  const prefs={scene:'forest',music:40,nature:50};
  assert.deepEqual(atmosphereMix(prefs),{music:0.4,nature:0.5});
  const ducked=atmosphereMix(prefs,{narrating:true});
  assert.ok(Math.abs(ducked.music-0.072)<1e-9);assert.equal(ducked.nature,0.09);
  assert.deepEqual(atmosphereMix({...prefs,scene:'none'}),{music:0,nature:0});
  assert.deepEqual(atmosphereMix({...prefs,music:0,nature:0},{narrating:true}),{music:0,nature:0});
});

test('late resource arrival after pause is disposed and cannot resume sound',async()=>{
  let resolve,stopped=0;const statuses=[];
  const session=createAtmosphereSession({start:()=>new Promise(r=>resolve=r),onState:s=>statuses.push(s.status)});
  const pending=session.play('forest');session.stop();resolve({stop:()=>stopped++});await pending;
  assert.equal(stopped,1);assert.equal(session.status,'paused');assert.ok(!statuses.includes('playing'));
});

test('a rapid scene change retains only the last playback, stale failure cannot replace it',async()=>{
  const pending=new Map(),stopped=[];
  const session=createAtmosphereSession({start:scene=>new Promise((resolve,reject)=>pending.set(scene,{resolve,reject}))});
  const old=session.play('forest'),current=session.play('sea');
  pending.get('sea').resolve({stop:()=>stopped.push('sea')});await current;
  pending.get('forest').reject(Error('old request failed'));await old;
  assert.equal(session.status,'playing');assert.equal(session.scene,'sea');
  session.stop();assert.deepEqual(stopped,['sea']);
});

test('current playback failure is visible and can be retried',async()=>{
  let calls=0;const session=createAtmosphereSession({start:async()=>{if(!calls++)throw Error('offline');return {stop(){}};}});
  await session.play('rain');assert.equal(session.status,'error');assert.equal(session.error.message,'offline');
  await session.play('rain');assert.equal(session.status,'playing');assert.equal(session.error,null);
});

test('volume or narration changes made while recordings load reach the accepted playback',async()=>{
  let resolve;const applied=[];
  const session=createAtmosphereSession({start:()=>new Promise(r=>resolve=r)});
  const pending=session.play('forest');session.setMix({music:0,nature:0.09});
  resolve({stop(){},setMix:mix=>applied.push(mix)});await pending;
  assert.deepEqual(applied,[{music:0,nature:0.09}]);
});

// Run the real UI controller; only the DOM and the audio device are stand-ins.
const controller=await readFile(new URL('../app/reader-atmosphere.js',import.meta.url),'utf8');
async function readerFixture({saved=null,reduced=false,delayed=false,blocked=false,confirmIdentity=async()=>true}={}){
  const elements=new Map(),started=[],stopped=[],pending=[],hearthMotion=[],natureMotion=[];
  class Element extends EventTarget{
    constructor(){super();this.dataset={};this.attributes=new Map();this.children=[];this.firstElementChild={};}
    setAttribute(name,value){this.attributes.set(name,value);}
    getAttribute(name){return this.attributes.get(name);}
    append(...children){this.children.push(...children);}
    set innerHTML(html){for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,new Element());}
    querySelector(selector){if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);}
    querySelectorAll(){return this.querySelector('.atmosphere-choices').children;}
    showModal(){this.open=true;}
    close(){this.open=false;this.dispatchEvent(new Event('close'));}
  }
  for(const id of ['open-atmosphere','settings-atmosphere','settings-dialog','atmosphere-quick-pause',...['toggle','status','scene','levels','music','music-value','nature','nature-value','motion','motion-hint'].map(name=>'settings-atmosphere-'+name)])elements.set(id,new Element());
  const motion=new EventTarget();motion.matches=reduced;
  const hosts=[false,true].map(preview=>{const host=new Element();host.classList={contains:name=>name==='atmosphere-preview'&&preview};return host;});
  const doc=new EventTarget();Object.assign(doc,{hidden:false,documentElement:new Element(),body:new Element(),createElement:()=>new Element(),getElementById:id=>elements.get(id),querySelectorAll:selector=>selector==='.atmosphere-backdrop,.atmosphere-preview'?hosts:[]});
  const win=new EventTarget();win.matchMedia=()=>motion;
  const storage=new Map(saved?[['marginalia-atmosphere-v1',JSON.stringify(saved)]]:[]);
  const engine={start:async(scene,getMix)=>{
    started.push({scene,mix:getMix()});if(blocked){blocked=false;const error=Error('gesture required');error.name='NotAllowedError';throw error;}if(delayed)await new Promise(resolve=>pending.push(resolve));
    return {stop:()=>stopped.push(scene),setMix(){}};
  }};
  await vm.runInNewContext('(async()=>{'+controller.replace(/^import .*;\n/gm,'')+'\nwindow.testGesture=resumeOnGesture;})()',{document:doc,window:win,location:{search:''},URLSearchParams,
    t:uiLocale.t,uiReady:uiLocale.uiReady,bindUi:uiLocale.bindUi,onUiLocaleChange:uiLocale.onUiLocaleChange,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},readerStorageKey:key=>key,confirmReaderIdentity:confirmIdentity,
    atmospheres,normalizeAtmosphere,atmosphereMix,createAtmosphereSession,createAtmosphereAudio:()=>engine,
    createHearthMotion:()=>{const layer={active:false,setActive(value){this.active=!!value;}};hearthMotion.push(layer);return layer;},
    createNatureMotion:()=>{const layer={active:false,scene:null,setActive(value){this.active=!!value;},setScene(value){this.scene=value;}};natureMotion.push(layer);return layer;},requestAnimationFrame:fn=>fn()});
  const dialog=doc.body.children[0],root=doc.documentElement,$=id=>elements.get(id);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const choose=async id=>{(id==='none'?$('atmosphere-none'):dialog.querySelectorAll().find(button=>button.dataset.scene===id)).dispatchEvent(new Event('click'));await tick();};
  return {doc,win,root,dialog,motion,$,started,stopped,pending,storage,tick,choose,hearthMotion,natureMotion};
}

test('selecting a scene starts its matching sound immediately, including after an explicit pause',async()=>{
  const f=await readerFixture();assert.equal(f.started.length,0);
  await f.choose('forest');assert.equal(f.dialog.dataset.playback,'playing');assert.equal(f.started[0].scene,'forest');
  f.$('atmosphere-quick-pause').dispatchEvent(new Event('click'));assert.equal(f.dialog.dataset.playback,'paused');
  await f.choose('sea');assert.equal(f.dialog.dataset.playback,'playing');assert.equal(f.started.at(-1).scene,'sea');
  assert.equal(f.$('atmosphere-music-name').textContent,'晨光和声');
  await f.choose('none');assert.equal(f.dialog.dataset.playback,'paused');assert.deepEqual(f.stopped,['forest','sea']);
});

test('restoring a scene stays silent and selecting another scene respects an individually muted channel',async()=>{
  const f=await readerFixture({saved:{scene:'sea',music:0,nature:50,motion:false}});
  assert.equal(f.root.dataset.atmosphere,'sea');assert.equal(f.started.length,0);
  await f.choose('rain');assert.deepEqual(f.started.at(-1),{scene:'rain',mix:{music:0,nature:0.5}});
  f.$('atmosphere-play').dispatchEvent(new Event('click'));
  f.$('atmosphere-motion').checked=true;f.$('atmosphere-motion').dispatchEvent(new Event('change'));
  assert.equal(f.dialog.dataset.playback,'paused');assert.equal(f.started.length,1);
});

test('settings and scene controls share volume, motion and manual playback without restarting sound',async()=>{
  const f=await readerFixture();assert.equal(f.$('settings-atmosphere-levels').hidden,true);
  await f.choose('rain');assert.equal(f.$('settings-atmosphere-levels').hidden,false);
  assert.equal(f.$('settings-atmosphere-scene').textContent,atmospheres.find(s=>s.id==='rain').name);
  f.$('settings-atmosphere-music').value='0';f.$('settings-atmosphere-music').dispatchEvent(new Event('input'));
  assert.equal(f.$('atmosphere-music').value,0);assert.equal(f.$('settings-atmosphere-music-value').value,'0%');
  f.$('atmosphere-nature').value='61';f.$('atmosphere-nature').dispatchEvent(new Event('input'));
  assert.equal(f.$('settings-atmosphere-nature').value,61);assert.equal(f.started.length,1);
  f.$('settings-atmosphere-motion').checked=false;f.$('settings-atmosphere-motion').dispatchEvent(new Event('change'));
  assert.equal(f.$('atmosphere-motion').checked,false);
  f.$('settings-atmosphere-toggle').dispatchEvent(new Event('click'));assert.equal(f.dialog.dataset.playback,'paused');
  assert.equal(f.$('settings-atmosphere-toggle').textContent,'播放');assert.equal(f.$('atmosphere-play-label').textContent,'开启声音');
  f.$('settings-atmosphere-toggle').dispatchEvent(new Event('click'));await f.tick();assert.equal(f.dialog.dataset.playback,'playing');
  await f.choose('none');assert.equal(f.$('settings-atmosphere-toggle').disabled,true);assert.equal(f.$('settings-atmosphere-levels').hidden,true);
});

test('quick pause cancels a scene selected while its recording is still loading',async()=>{
  const f=await readerFixture({delayed:true});await f.choose('rain');assert.equal(f.dialog.dataset.playback,'loading');
  f.$('atmosphere-quick-pause').dispatchEvent(new Event('click'));f.pending[0]();await f.tick();
  assert.equal(f.dialog.dataset.playback,'paused');assert.deepEqual(f.stopped,['rain']);
});

test('switching tabs pauses visual motion but keeps the selected sound playing without restarting it',async()=>{
  const f=await readerFixture();await f.choose('sea');
  assert.equal(f.root.dataset.atmosphereActive,'true');
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.root.dataset.atmosphereActive,'false');assert.equal(f.dialog.dataset.playback,'playing');assert.equal(f.stopped.length,0);
  f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.root.dataset.atmosphereActive,'true');assert.equal(f.started.length,1);
  f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));
  assert.equal(f.root.dataset.atmosphereMotion,'false');assert.equal(f.$('atmosphere-motion').disabled,true);
  f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));
  assert.equal(f.root.dataset.atmosphereMotion,'true');assert.equal(f.$('atmosphere-motion').disabled,false);
  assert.equal(f.started.length,1);assert.equal(JSON.parse(f.storage.get('marginalia-atmosphere-v1')).motion,true);
});

test('a background load may finish playing; an explicit pause stays paused on return and leaving the document stops it',async()=>{
  const f=await readerFixture({delayed:true});await f.choose('rain');
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.pending[0]();await f.tick();
  assert.equal(f.dialog.dataset.playback,'playing');assert.equal(f.stopped.length,0);
  f.$('atmosphere-quick-pause').dispatchEvent(new Event('click'));
  f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.dialog.dataset.playback,'paused');assert.equal(f.started.length,1);
  await f.choose('sea');f.pending[1]();await f.tick();f.win.dispatchEvent(new Event('pagehide'));
  assert.equal(f.dialog.dataset.playback,'paused');assert.deepEqual(f.stopped,['rain','sea']);
});

test('the hearth controller starts only visible layers and stops them for motion preferences, other scenes and page exit',async()=>{
  const f=await readerFixture({saved:{scene:'hearth',motion:true}}),active=()=>f.hearthMotion?.map(layer=>layer.active);
  assert.deepEqual(active(),[true,false]);
  f.$('open-atmosphere').dispatchEvent(new Event('click'));assert.deepEqual(active(),[true,true]);
  f.dialog.close();assert.deepEqual(active(),[true,false]);
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(active(),[false,false]);
  f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(active(),[true,false]);
  f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));assert.deepEqual(active(),[false,false]);
  f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));assert.deepEqual(active(),[true,false]);
  f.$('atmosphere-motion').checked=false;f.$('atmosphere-motion').dispatchEvent(new Event('change'));assert.deepEqual(active(),[false,false]);
  f.$('atmosphere-motion').checked=true;f.$('atmosphere-motion').dispatchEvent(new Event('change'));assert.deepEqual(active(),[true,false]);
  await f.choose('rain');assert.deepEqual(active(),[false,false]);
  await f.choose('hearth');assert.deepEqual(active(),[true,false]);
  f.win.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));assert.deepEqual(active(),[false,false]);
  f.win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));assert.deepEqual(active(),[true,false]);
  f.win.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));assert.deepEqual(active(),[false,false]);
  f.win.dispatchEvent(new Event('pageshow'));assert.deepEqual(active(),[false,false],'a disposed document cannot resume its visual controllers');
});

test('forest light and sea water follow scene, visibility and motion preferences without ever starting sound',async()=>{
  const f=await readerFixture({saved:{scene:'forest',motion:true}}),active=()=>f.natureMotion.map(layer=>layer.active);
  assert.deepEqual(active(),[true,false]);assert.deepEqual(f.natureMotion.map(layer=>layer.scene),['forest','forest']);
  assert.equal(f.started.length,0,'Enabling the visual renderer must never start sound.');
  f.$('open-atmosphere').dispatchEvent(new Event('click'));assert.deepEqual(active(),[true,true]);
  f.dialog.close();assert.deepEqual(active(),[true,false]);
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(active(),[false,false]);
  f.doc.hidden=false;f.doc.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(active(),[true,false]);
  f.motion.matches=true;f.motion.dispatchEvent(new Event('change'));assert.deepEqual(active(),[false,false]);
  f.motion.matches=false;f.motion.dispatchEvent(new Event('change'));assert.deepEqual(active(),[true,false]);
  f.$('atmosphere-motion').checked=false;f.$('atmosphere-motion').dispatchEvent(new Event('change'));assert.deepEqual(active(),[false,false]);
  f.$('atmosphere-motion').checked=true;f.$('atmosphere-motion').dispatchEvent(new Event('change'));assert.deepEqual(active(),[true,false]);
  await f.choose('rain');assert.deepEqual(active(),[false,false]);assert.deepEqual(f.natureMotion.map(layer=>layer.scene),['rain','rain']);
  await f.choose('sea');assert.deepEqual(active(),[true,false]);assert.deepEqual(f.natureMotion.map(layer=>layer.scene),['sea','sea']);
  assert.deepEqual(f.started.map(start=>start.scene),['rain','sea']);
  await f.choose('none');assert.deepEqual(active(),[false,false]);
  f.win.dispatchEvent(new Event('pagehide'));assert.deepEqual(active(),[false,false]);
  f.win.dispatchEvent(new Event('pageshow'));assert.deepEqual(active(),[false,false]);
});

// A reload must restore intent; an explicit pause must clear it, while page exit must not.
test('saved sound resumes on entry and page exit retains intent until an explicit pause',async()=>{
  const f=await readerFixture({saved:{scene:'rain',music:0,nature:50,playing:true}});await f.tick();
  assert.equal(f.dialog.dataset.playback,'playing');assert.equal(f.started[0].scene,'rain');
  f.win.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));
  assert.equal(JSON.parse(f.storage.get('marginalia-atmosphere-v1')).playing,true);
  f.win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await f.tick();
  assert.equal(f.dialog.dataset.playback,'playing');
  f.$('atmosphere-quick-pause').dispatchEvent(new Event('click'));
  assert.equal(JSON.parse(f.storage.get('marginalia-atmosphere-v1')).playing,false);
  f.win.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));
  f.win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await f.tick();
  assert.equal(f.dialog.dataset.playback,'paused');
});

test('autoplay denial is waiting for a gesture rather than reported as playing or a network failure',async()=>{
  const session=createAtmosphereSession({start:async()=>{const error=Error('gesture required');error.name='NotAllowedError';throw error;}});
  await session.play('rain');assert.equal(session.status,'blocked');
});

test('a trusted pointerdown on the start control does not turn its following click into a pause',async()=>{
  const f=await readerFixture({saved:{scene:'rain',playing:true},blocked:true});await f.tick();
  assert.equal(f.dialog.dataset.playback,'blocked');
  f.win.testGesture({isTrusted:true,target:{closest:()=>f.$('atmosphere-play')}});
  f.$('atmosphere-play').dispatchEvent(new Event('click'));await f.tick();
  assert.equal(f.dialog.dataset.playback,'playing');
  assert.equal(JSON.parse(f.storage.get('marginalia-atmosphere-v1')).playing,true);
});


test('bfcache playback waits for same-account confirmation and rejects a changed account',async()=>{
  let confirm;const f=await readerFixture({saved:{scene:'rain',playing:true},confirmIdentity:()=>new Promise(resolve=>confirm=resolve)});await f.tick();
  f.win.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));
  f.win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await f.tick();
  assert.equal(f.started.length,1,'no old-account sound before identity response');
  confirm(false);await f.tick();assert.equal(f.started.length,1);
  f.win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await f.tick();
  f.$('atmosphere-quick-pause').dispatchEvent(new Event('click'));confirm(true);await f.tick();
  assert.equal(f.started.length,1,'pause while identity check is pending stays silent');
});


test('a late same-account confirmation does not restart a manually selected scene',async()=>{
  let confirm;const f=await readerFixture({saved:{scene:'rain',playing:true},confirmIdentity:()=>new Promise(resolve=>confirm=resolve)});await f.tick();
  f.win.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));
  f.win.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));await f.tick();
  await f.choose('sea');const starts=f.started.length;confirm(true);await f.tick();
  assert.equal(f.started.length,starts);assert.equal(f.started.at(-1).scene,'sea');
});
