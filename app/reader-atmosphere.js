import {readerStorageKey,confirmReaderIdentity} from './reader-api.mjs';
import {atmospheres,normalizeAtmosphere,atmosphereMix,createAtmosphereSession} from './atmosphere-state.mjs';
import {createAtmosphereAudio} from './atmosphere-audio.mjs';

import {t,uiReady,bindUi,onUiLocaleChange} from './ui-locale.mjs';
await uiReady;

const SCENE_UI='reader.atmosphere.',READER_SHELL='reader.shell.';
const imageLabel=state=>t(SCENE_UI+(state==='error'?'imageError':'imageLoading'));
let atmosphereDisposed=false,pageGeneration=0,motionPagePresent=true;
const listenerDisposers=[];
function listen(target,event,handler,options){const owned=e=>{if(!atmosphereDisposed)return handler(e);};target.addEventListener(event,owned,options);listenerDisposers.push(()=>target.removeEventListener(event,owned,options));}

const $=id=>document.getElementById(id),key=readerStorageKey('marginalia-atmosphere-v1');
let stored;try{stored=JSON.parse(localStorage.getItem(key)||'null');}catch{}
let prefs=normalizeAtmosphere(stored),narrating=false,notice='';
let playback=null,motionReduced=false,cachedScene='none';
const requested=new URLSearchParams(location.search).get('atmosphere');
if(atmospheres.some(s=>s.id===requested))prefs={...prefs,scene:requested};
const engine=createAtmosphereAudio();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const dialog=document.createElement('dialog');dialog.id='atmosphere-dialog';dialog.className='atmosphere-dialog';dialog.setAttribute('aria-labelledby','atmosphere-title');
dialog.innerHTML=`
  <div class="atmosphere-shell">
    <div class="atmosphere-preview" data-scene="forest">
      <div class="atmosphere-elements" aria-hidden="true"></div>
      <div class="atmosphere-preview-text"><span data-ui="reader.atmosphere.brand"></span><h2 id="atmosphere-preview-name" data-ui="reader.atmosphere.forest.name"></h2><p id="atmosphere-preview-caption" data-ui="reader.atmosphere.forest.caption"></p></div>
    </div>
    <div class="atmosphere-panel">
      <header class="atmosphere-heading"><div><p data-ui="reader.shell.readingAtmosphere"></p><h2 id="atmosphere-title" data-ui="reader.atmosphere.heading"></h2></div><button id="close-atmosphere" aria-label="Close reading atmosphere" data-ui-aria-label="reader.atmosphere.close" data-ui="reader.shell.close"></button></header>
      <div class="atmosphere-choices" role="group" aria-label="Choose a reading atmosphere" data-ui-aria-label="reader.atmosphere.choices"></div>
      <button id="atmosphere-none" class="atmosphere-none" aria-pressed="true"><span data-ui="reader.atmosphere.none" class="ui-inline"></span> <span data-ui="reader.atmosphere.quiet"></span><span class="atmosphere-choice-check" aria-hidden="true">✓</span></button>
      <section class="atmosphere-sound" aria-labelledby="atmosphere-sound-title">
        <div class="atmosphere-sound-heading"><h3 id="atmosphere-sound-title" data-ui="reader.atmosphere.withSound"></h3><span id="atmosphere-sound-kind" data-ui="reader.atmosphere.soundKind"></span></div>
        <div class="atmosphere-volume"><label for="atmosphere-music"><span data-ui="reader.shell.music" class="ui-inline"></span> <span id="atmosphere-music-name"></span></label><input id="atmosphere-music" type="range" min="0" max="100" step="1" value="28"><output for="atmosphere-music" id="atmosphere-music-value">28%</output></div>
        <div class="atmosphere-volume"><label for="atmosphere-nature"><span data-ui="reader.shell.nature" class="ui-inline"></span> <span id="atmosphere-nature-name"></span></label><input id="atmosphere-nature" type="range" min="0" max="100" step="1" value="32"><output for="atmosphere-nature" id="atmosphere-nature-value">32%</output></div>
        <div class="atmosphere-motion"><label for="atmosphere-motion"><span data-ui="reader.shell.motion" class="ui-inline"></span> <span id="atmosphere-motion-hint" data-ui="reader.atmosphere.motionHint"></span></label><input id="atmosphere-motion" type="checkbox" role="switch" aria-describedby="atmosphere-motion-hint" checked></div>
      </section>
      <footer class="atmosphere-footer"><button id="atmosphere-play" class="atmosphere-play" disabled><span aria-hidden="true">▷</span><span id="atmosphere-play-label" data-ui="reader.atmosphere.choose"></span></button><button id="atmosphere-return"><span data-ui="reader.shell.returnPage" class="ui-inline"></span> <span aria-hidden="true">↗</span></button></footer>
      <p id="atmosphere-status" class="atmosphere-status" role="status" aria-live="polite" data-ui="reader.atmosphere.pick"></p>
      <details class="atmosphere-about"><summary data-ui="reader.atmosphere.about"></summary><p data-ui="reader.atmosphere.aboutHelp"></p><a href="/assets/atmospheres/NOTICE.md" target="_blank" rel="noopener" data-ui="reader.atmosphere.sources"></a><p data-ui="reader.atmosphere.localPrefs"></p></details>
    </div>
  </div>`;
document.body.append(dialog);
const hearthLayers=[...document.querySelectorAll('.atmosphere-backdrop,.atmosphere-preview')].map(host=>({
  preview:host.classList.contains('atmosphere-preview'),target:host.querySelector('.atmosphere-elements'),motion:null,nature:null,
}));
let motionLoad=null;
function ensureMotion(){
  if(motionLoad||hearthLayers.every(layer=>layer.motion))return;
  const generation=pageGeneration;
  motionLoad=import('./atmosphere-motion.mjs').then(({createHearthMotion,createNatureMotion})=>{
    if(atmosphereDisposed)return;
    if(generation!==pageGeneration){motionLoad=null;if(motionPagePresent&&!document.hidden)renderMotion();return;}
    for(const layer of hearthLayers){layer.motion=createHearthMotion(layer.target);layer.nature=createNatureMotion(layer.target);}
    renderMotion();
  }).catch(()=>{motionLoad=null;});
}
const session=createAtmosphereSession({start:scene=>engine.start(scene,()=>atmosphereMix(prefs,{narrating})),onState:()=>renderPlayback()});
function sceneNode(tag,className){const node=document.createElement(tag);node.className=className;return node;}
for(const scene of atmospheres){
  const button=sceneNode('button','atmosphere-choice');button.dataset.scene=scene.id;button.setAttribute('aria-pressed','false');
  const image=sceneNode('img','');image.alt='';image.loading='lazy';
  const artwork=sceneNode('span','atmosphere-artwork');
  const imageStatus=sceneNode('span','atmosphere-image-status');
  const retry=sceneNode('button','atmosphere-image-retry');retry.type='button';retry.dataset.ui=SCENE_UI+'imageRetry';
  const imageState=state=>{button.dataset.imageState=state;imageStatus.textContent=imageLabel(state);imageStatus.hidden=state==='ready';retry.hidden=state!=='error';};
  imageState('loading');listen(image,'load',()=>imageState(image.naturalWidth?'ready':'error'));listen(image,'error',()=>imageState('error'));
  listen(retry,'click',()=>{imageState('loading');retry.hidden=true;image.src=scene.image+'?retry='+Date.now();button.focus({preventScroll:true});});
  image.src=scene.image;artwork.append(image,imageStatus);
  const label=sceneNode('span','atmosphere-choice-name');label.dataset.ui=SCENE_UI+''+scene.id+'.name';label.textContent=t(label.dataset.ui);
  const check=sceneNode('span','atmosphere-choice-check');check.textContent='✓';check.setAttribute('aria-hidden','true');
  button.append(artwork,label,check);listen(button,'click',()=>choose(scene.id));
  const choice=sceneNode('div','atmosphere-choice-group');choice.append(button,retry);dialog.querySelector('.atmosphere-choices').append(choice);
}
function save(){try{localStorage.setItem(key,JSON.stringify(prefs));}catch{notice=SCENE_UI+'storageError';}}
function renderMotion(){
  const still=reducedMotion.matches,running=prefs.motion&&!still&&!document.hidden&&motionPagePresent;
  document.documentElement.dataset.atmosphereMotion=String(prefs.motion&&!still);
  document.documentElement.dataset.atmosphereActive=String(!document.hidden);
  if(running&&['hearth','forest','sea'].includes(prefs.scene))ensureMotion();
  for(const layer of hearthLayers){
    const visible=!layer.preview||dialog.open;
    layer.motion?.setActive(prefs.scene==='hearth'&&running&&visible);
    // Forest light and sea water move on their own layer; sound never follows it.
    layer.nature?.setScene(prefs.scene);
    layer.nature?.setActive((prefs.scene==='forest'||prefs.scene==='sea')&&running&&visible);
  }
  for(const prefix of ['atmosphere-','settings-atmosphere-']){
    const control=$(prefix+'motion');if(!control)continue;
    control.checked=prefs.motion&&!reducedMotion.matches;
    control.disabled=prefs.scene==='none'||reducedMotion.matches;
    motionReduced=reducedMotion.matches;$(prefix+'motion-hint').textContent=t(motionReduced?SCENE_UI+'reduced':SCENE_UI+'motionHint');
  }
}
function render(){
  const scene=atmospheres.find(s=>s.id===prefs.scene);
  document.documentElement.dataset.atmosphere=prefs.scene;renderMotion();
  dialog.querySelector('.atmosphere-preview').dataset.scene=prefs.scene;
  cachedScene=prefs.scene;sceneLabels();
  for(const button of dialog.querySelectorAll('[data-scene].atmosphere-choice'))button.setAttribute('aria-pressed',String(button.dataset.scene===prefs.scene));
  $('atmosphere-none').setAttribute('aria-pressed',String(prefs.scene==='none'));
  for(const name of ['music','nature']){
    for(const prefix of ['atmosphere-','settings-atmosphere-']){
      const control=$(prefix+name);if(!control)continue;
      control.value=prefs[name];control.disabled=!scene;$(prefix+name+'-value').value=prefs[name]+'%';
    }
    $('atmosphere-'+name+'-name').textContent=scene?t(SCENE_UI+''+scene.id+'.'+name):'';
  }
  if($('settings-atmosphere-levels'))$('settings-atmosphere-levels').hidden=!scene;

  session.setMix(atmosphereMix(prefs,{narrating}));renderPlayback();
}
function renderPlayback(){if(atmosphereDisposed)return;
  const playing=session.status==='playing',loading=session.status==='loading',hasScene=prefs.scene!=='none',silent=!prefs.music&&!prefs.nature;
  dialog.querySelector('.atmosphere-sound').hidden=!hasScene;$('atmosphere-play').hidden=!hasScene;
  dialog.dataset.playback=session.status;dialog.dataset.narrating=String(narrating);
  $('atmosphere-play').disabled=!hasScene;$('atmosphere-play').setAttribute('aria-pressed',String(playing||loading));
  $('atmosphere-play').firstElementChild.textContent=playing||loading?'Ⅱ':'▷';
  playback={playing,loading,hasScene,silent,status:session.status,narrating,notice};playbackLabels();
  $('atmosphere-quick-pause').hidden=!playing&&!loading;$('open-atmosphere').dataset.playing=String(playing&&!silent);
  const quick=$('settings-atmosphere-toggle');
  if(quick){quick.hidden=!hasScene;quick.disabled=!hasScene;quick.setAttribute('aria-pressed',String(playing||loading));}
}
function sceneLabels(){
  for(const choice of dialog.querySelectorAll('.atmosphere-choice'))if(choice.dataset.imageState!=='ready')choice.querySelector('.atmosphere-image-status').textContent=imageLabel(choice.dataset.imageState);
  const hasScene=cachedScene!=='none',name=t(hasScene?SCENE_UI+''+cachedScene+'.name':SCENE_UI+'none');
  $('atmosphere-preview-name').textContent=name;
  $('atmosphere-preview-caption').textContent=t(hasScene?SCENE_UI+''+cachedScene+'.caption':SCENE_UI+'noneCaption');
  for(const part of ['music','nature'])$('atmosphere-'+part+'-name').textContent=hasScene?t(SCENE_UI+''+cachedScene+'.'+part):'';
  if($('settings-atmosphere-scene'))$('settings-atmosphere-scene').textContent=name;
  $('open-atmosphere').setAttribute('aria-label',t(SCENE_UI+'trigger',{scene:name}));
  for(const prefix of ['atmosphere-','settings-atmosphere-'])if($(prefix+'motion-hint'))$(prefix+'motion-hint').textContent=t(motionReduced?SCENE_UI+'reduced':SCENE_UI+'motionHint');
}
function playbackLabels(){
  if(!playback)return;
  const {playing,loading,hasScene,silent,status,narrating,notice}=playback;
  $('atmosphere-play-label').textContent=t(!hasScene?SCENE_UI+'choose':loading?SCENE_UI+'cancel':playing?SCENE_UI+'pause':status==='error'?SCENE_UI+'retry':SCENE_UI+'start');
  $('atmosphere-status').textContent=t(notice||(status==='blocked'?SCENE_UI+'waitingGesture':status==='error'?SCENE_UI+'error':loading?SCENE_UI+'loading':playing?(silent?SCENE_UI+'silent':narrating?SCENE_UI+'ducked':SCENE_UI+'playing'):hasScene?SCENE_UI+'paused':SCENE_UI+'pick'));
  $('atmosphere-status').hidden=!hasScene&&!notice;
  if($('settings-atmosphere-toggle'))$('settings-atmosphere-toggle').textContent=t(loading?SCENE_UI+'cancel':playing?SCENE_UI+'pauseShort':READER_SHELL+'play');
  if($('settings-atmosphere-status')){ $('settings-atmosphere-status').hidden=$('atmosphere-status').hidden;$('settings-atmosphere-status').textContent=$('atmosphere-status').textContent;}
}
function choose(id){
  const anchor=window.marginaliaReader?.getAnchor();notice='';prefs={...prefs,scene:id,playing:id!=='none'};save();render();
  requestAnimationFrame(()=>{if(anchor)window.marginaliaReader?.restoreAnchor(anchor);});
  if(id==='none')session.stop();else session.play(id);
}
function open(){window.marginaliaPaletteAdapter?.prepareOverlay?.('atmosphere-dialog');window.marginaliaReader?.dismissTools();notice='';render();dialog.showModal();renderMotion();$('open-atmosphere').setAttribute('aria-expanded','true');}
listen($('open-atmosphere'),'click',open);
listen($('settings-atmosphere'),'click',()=>{$('settings-dialog').close();open();});
for(const id of ['close-atmosphere','atmosphere-return'])listen($(id),'click',()=>dialog.close());
listen(dialog,'close',()=>{$('open-atmosphere').setAttribute('aria-expanded','false');renderMotion();});
listen(dialog,'click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
listen($('atmosphere-none'),'click',()=>choose('none'));
function pauseSound(){notice='';prefs={...prefs,playing:false};save();session.stop();}
function toggleSound(){notice='';if(['playing','loading'].includes(session.status))pauseSound();else {prefs={...prefs,playing:prefs.scene!=='none'};save();session.play(prefs.scene);}}
for(const id of ['atmosphere-play','settings-atmosphere-toggle'])listen($(id),'click',toggleSound);
listen($('atmosphere-quick-pause'),'click',pauseSound);
for(const name of ['music','nature'])for(const prefix of ['atmosphere-','settings-atmosphere-'])listen($(prefix+name),'input',event=>{notice='';prefs=normalizeAtmosphere({...prefs,[name]:Number(event.target.value)});save();render();});
for(const prefix of ['atmosphere-','settings-atmosphere-'])listen($(prefix+'motion'),'change',event=>{prefs={...prefs,motion:event.target.checked};save();render();});
listen(reducedMotion,'change',renderMotion);
// Native media events cover play, pause, end, source replacement, and future narration players.
function syncNarration(){narrating=[...document.querySelectorAll('audio:not([data-atmosphere])')].some(audio=>!audio.paused&&!audio.ended);session.setMix(atmosphereMix(prefs,{narrating}));renderPlayback();}
for(const event of ['play','pause','ended','emptied'])listen(document,event,syncNarration,true);
// Visibility controls visual motion, never the listener's playback choice.
listen(document,'visibilitychange',renderMotion);
listen(window,'pagehide',()=>{motionPagePresent=false;pageGeneration++;session.stop();for(const layer of hearthLayers){layer.motion?.setActive(false);layer.nature?.setActive(false);}});
listen(window,'pageshow',async event=>{motionPagePresent=true;renderMotion();if(!event.persisted||!prefs.playing)return;const generation=pageGeneration;if(await confirmReaderIdentity()&&generation===pageGeneration&&!atmosphereDisposed&&prefs.playing&&session.status==='paused')session.play(prefs.scene);});
// Only browser-delivered activation can satisfy autoplay restrictions.
function resumeOnGesture(event){if(!event.isTrusted||!prefs.playing)return;if(event.target?.closest?.('#atmosphere-play,#settings-atmosphere-toggle,#atmosphere-quick-pause,.atmosphere-choice,#atmosphere-none'))return;if(session.status==='blocked')session.play(prefs.scene);else if(session.status==='loading')engine.unlock().catch(()=>{});}
listen(document,'pointerdown',resumeOnGesture);listen(document,'keydown',resumeOnGesture);
listen(document,'reader:session-changed',()=>{pageGeneration++;session.stop();});
const unbind=bindUi(dialog);const offLocale=onUiLocaleChange(()=>{sceneLabels();playbackLabels();});
listen(window,'pagehide',event=>{if(!event.persisted){atmosphereDisposed=true;for(const off of listenerDisposers)off();listenerDisposers.length=0;offLocale();unbind();}});
render();syncNarration();
if(prefs.playing)session.play(prefs.scene);
