import {readerStorageKey} from './reader-api.mjs';
import {atmospheres,normalizeAtmosphere,atmosphereMix,createAtmosphereSession} from './atmosphere-state.mjs';
import {createAtmosphereAudio} from './atmosphere-audio.mjs';
import {createHearthMotion} from './hearth-motion.mjs';

const $=id=>document.getElementById(id),key=readerStorageKey('marginalia-atmosphere-v1');
let stored;try{stored=JSON.parse(localStorage.getItem(key)||'null');}catch{}
let prefs=normalizeAtmosphere(stored),narrating=false,notice='';
const requested=new URLSearchParams(location.search).get('atmosphere');
if(atmospheres.some(s=>s.id===requested))prefs={...prefs,scene:requested};
const engine=createAtmosphereAudio();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const dialog=document.createElement('dialog');dialog.id='atmosphere-dialog';dialog.className='atmosphere-dialog';dialog.setAttribute('aria-labelledby','atmosphere-title');
dialog.innerHTML=`
  <div class="atmosphere-shell">
    <div class="atmosphere-preview" data-scene="forest">
      <div class="atmosphere-elements" aria-hidden="true"></div>
      <div class="atmosphere-preview-text"><span>Leafhour · 一处安静的地方</span><h2 id="atmosphere-preview-name">林间书页</h2><p id="atmosphere-preview-caption">风过树梢，读到日落。</p></div>
    </div>
    <div class="atmosphere-panel">
      <header class="atmosphere-heading"><div><p>阅读氛围</p><h2 id="atmosphere-title">此刻，想在哪里读？</h2></div><button id="close-atmosphere" aria-label="关闭阅读氛围">关闭</button></header>
      <div class="atmosphere-choices" role="group" aria-label="选择阅读氛围"></div>
      <button id="atmosphere-none" class="atmosphere-none" aria-pressed="true">只留纸面 <span>安静地读，也很好。</span><span class="atmosphere-choice-check" aria-hidden="true">✓</span></button>
      <section class="atmosphere-sound" aria-labelledby="atmosphere-sound-title">
        <div class="atmosphere-sound-heading"><h3 id="atmosphere-sound-title">让声音陪一会儿</h3><span id="atmosphere-sound-kind">无歌词配乐 · 自然环境声</span></div>
        <div class="atmosphere-volume"><label for="atmosphere-music">轻音乐 <span id="atmosphere-music-name"></span></label><input id="atmosphere-music" type="range" min="0" max="100" step="1" value="28"><output for="atmosphere-music" id="atmosphere-music-value">28%</output></div>
        <div class="atmosphere-volume"><label for="atmosphere-nature">环境声 <span id="atmosphere-nature-name"></span></label><input id="atmosphere-nature" type="range" min="0" max="100" step="1" value="32"><output for="atmosphere-nature" id="atmosphere-nature-value">32%</output></div>
        <div class="atmosphere-motion"><label for="atmosphere-motion">场景动效 <span id="atmosphere-motion-hint">让风、雨与潮汐轻轻流动</span></label><input id="atmosphere-motion" type="checkbox" role="switch" aria-describedby="atmosphere-motion-hint" checked></div>
      </section>
      <footer class="atmosphere-footer"><button id="atmosphere-play" class="atmosphere-play" disabled><span aria-hidden="true">▷</span><span id="atmosphere-play-label">先选一种氛围</span></button><button id="atmosphere-return">回到书页 <span aria-hidden="true">↗</span></button></footer>
      <p id="atmosphere-status" class="atmosphere-status" role="status" aria-live="polite">选择场景，配乐与环境声会一起开启。</p>
      <details class="atmosphere-about"><summary>关于声音与素材</summary><p>配乐为本机合成的琴音与和声，环境录音随应用保存。音量调至零即可关闭对应声音。切换网页或应用时继续播放，暂停请使用播放按钮。开始朗读时背景声会自动降低。</p><a href="/assets/atmospheres/NOTICE.md" target="_blank" rel="noopener">查看素材来源</a><p>氛围偏好保存在当前浏览器，暂不随书房备份迁移。</p></details>
    </div>
  </div>`;
document.body.append(dialog);
const hearthLayers=[...document.querySelectorAll('.atmosphere-backdrop,.atmosphere-preview')].map(host=>({
  preview:host.classList.contains('atmosphere-preview'),motion:createHearthMotion(host.querySelector('.atmosphere-elements')),
}));
const session=createAtmosphereSession({start:scene=>engine.start(scene,()=>atmosphereMix(prefs,{narrating})),onState:()=>renderPlayback()});
for(const scene of atmospheres){
  const button=document.createElement('button');button.className='atmosphere-choice';button.dataset.scene=scene.id;button.setAttribute('aria-pressed','false');
  const image=document.createElement('img');image.src=scene.image;image.alt='';image.loading='lazy';image.decoding='async';image.width=220;image.height=90;
  const label=document.createElement('span');label.className='atmosphere-choice-name';label.textContent=scene.name;
  const check=document.createElement('span');check.className='atmosphere-choice-check';check.textContent='✓';check.setAttribute('aria-hidden','true');
  button.append(image,label,check);button.addEventListener('click',()=>choose(scene.id));dialog.querySelector('.atmosphere-choices').append(button);
}
function save(){try{localStorage.setItem(key,JSON.stringify(prefs));}catch{notice='这个浏览器暂时无法保存氛围偏好。';}}
function renderMotion(){
  document.documentElement.dataset.atmosphereMotion=String(prefs.motion&&!reducedMotion.matches);
  document.documentElement.dataset.atmosphereActive=String(!document.hidden);
  for(const layer of hearthLayers)layer.motion.setActive(prefs.scene==='hearth'&&prefs.motion&&!reducedMotion.matches&&!document.hidden&&(!layer.preview||dialog.open));
  for(const prefix of ['atmosphere-','settings-atmosphere-']){
    const control=$(prefix+'motion');if(!control)continue;
    control.checked=prefs.motion&&!reducedMotion.matches;
    control.disabled=prefs.scene==='none'||reducedMotion.matches;
    $(prefix+'motion-hint').textContent=reducedMotion.matches?'已跟随系统减少动态效果':'让风、雨与潮汐轻轻流动';
  }
}
function render(){
  const scene=atmospheres.find(s=>s.id===prefs.scene);
  document.documentElement.dataset.atmosphere=prefs.scene;renderMotion();
  dialog.querySelector('.atmosphere-preview').dataset.scene=prefs.scene;
  $('atmosphere-preview-name').textContent=scene?.name||'只留纸面';$('atmosphere-preview-caption').textContent=scene?.caption||'把这一刻，留给书里的世界。';
  for(const button of dialog.querySelectorAll('[data-scene].atmosphere-choice'))button.setAttribute('aria-pressed',String(button.dataset.scene===prefs.scene));
  $('atmosphere-none').setAttribute('aria-pressed',String(prefs.scene==='none'));
  for(const name of ['music','nature']){
    for(const prefix of ['atmosphere-','settings-atmosphere-']){
      const control=$(prefix+name);if(!control)continue;
      control.value=prefs[name];control.disabled=!scene;$(prefix+name+'-value').value=prefs[name]+'%';
    }
    $('atmosphere-'+name+'-name').textContent=scene?.[name]||'';
  }
  if($('settings-atmosphere-levels'))$('settings-atmosphere-levels').hidden=!scene;
  if($('settings-atmosphere-scene'))$('settings-atmosphere-scene').textContent=scene?.name||'只留纸面';
  $('open-atmosphere').setAttribute('aria-label','阅读氛围'+(scene?'：'+scene.name:''));session.setMix(atmosphereMix(prefs,{narrating}));renderPlayback();
}
function renderPlayback(){
  const playing=session.status==='playing',loading=session.status==='loading',hasScene=prefs.scene!=='none',silent=!prefs.music&&!prefs.nature;
  dialog.dataset.playback=session.status;dialog.dataset.narrating=String(narrating);
  $('atmosphere-play').disabled=!hasScene;$('atmosphere-play').setAttribute('aria-pressed',String(playing||loading));
  $('atmosphere-play').firstElementChild.textContent=playing||loading?'Ⅱ':'▷';
  $('atmosphere-play-label').textContent=!hasScene?'先选一种氛围':loading?'取消准备':playing?'暂停声音':session.status==='error'?'重试播放':'开启声音';
  $('atmosphere-quick-pause').hidden=!playing&&!loading;$('open-atmosphere').dataset.playing=String(playing&&!silent);
  $('atmosphere-status').textContent=notice||(session.status==='error'?(session.error?.message||'声音暂时无法播放，请重试。'):loading?'正在准备声音，书页已经就绪。':playing?(silent?'两路声音已静音。':narrating?'朗读进行中，背景声音已降低。':'声音已开启，合上面板就可以继续读。'):hasScene?'声音已暂停。点击开启，慢慢读。':'选择场景，配乐与环境声会一起开启。');
  const quick=$('settings-atmosphere-toggle');
  if(quick){quick.disabled=!hasScene;quick.textContent=loading?'取消准备':playing?'暂停':'播放';quick.setAttribute('aria-pressed',String(playing||loading));}
  if($('settings-atmosphere-status'))$('settings-atmosphere-status').textContent=$('atmosphere-status').textContent;
}
function choose(id){
  const anchor=window.marginaliaReader?.getAnchor();notice='';prefs={...prefs,scene:id};save();render();
  requestAnimationFrame(()=>{if(anchor)window.marginaliaReader?.restoreAnchor(anchor);});
  if(id==='none')session.stop();else session.play(id);
}
function open(){window.marginaliaReader?.dismissTools();notice='';render();dialog.showModal();renderMotion();$('open-atmosphere').setAttribute('aria-expanded','true');}
$('open-atmosphere').addEventListener('click',open);
$('settings-atmosphere').addEventListener('click',()=>{$('settings-dialog').close();open();});
for(const id of ['close-atmosphere','atmosphere-return'])$(id).addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{$('open-atmosphere').setAttribute('aria-expanded','false');renderMotion();});
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
$('atmosphere-none').addEventListener('click',()=>choose('none'));
function toggleSound(){notice='';if(['playing','loading'].includes(session.status))session.stop();else session.play(prefs.scene);}
for(const id of ['atmosphere-play','settings-atmosphere-toggle'])$(id)?.addEventListener('click',toggleSound);
$('atmosphere-quick-pause').addEventListener('click',()=>{notice='';session.stop();});
for(const name of ['music','nature'])for(const prefix of ['atmosphere-','settings-atmosphere-'])$(prefix+name)?.addEventListener('input',event=>{notice='';prefs=normalizeAtmosphere({...prefs,[name]:Number(event.target.value)});save();render();});
for(const prefix of ['atmosphere-','settings-atmosphere-'])$(prefix+'motion')?.addEventListener('change',event=>{prefs={...prefs,motion:event.target.checked};save();render();});
reducedMotion.addEventListener('change',renderMotion);
// Native media events cover play, pause, end, source replacement, and future narration players.
function syncNarration(){narrating=[...document.querySelectorAll('audio:not([data-atmosphere])')].some(audio=>!audio.paused&&!audio.ended);session.setMix(atmosphereMix(prefs,{narrating}));renderPlayback();}
for(const event of ['play','pause','ended','emptied'])document.addEventListener(event,syncNarration,true);
// Visibility controls visual motion, never the listener's playback choice.
document.addEventListener('visibilitychange',renderMotion);
window.addEventListener('pagehide',()=>{session.stop();for(const layer of hearthLayers)layer.motion.setActive(false);});
window.addEventListener('pageshow',renderMotion);
render();syncNarration();
