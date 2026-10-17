import {paintBookCover} from './book-binding.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {createGiftSpring} from './gift-ritual.mjs';
import {createGiftWavesController,createGiftWaveScene} from './gift-waves.mjs';
import {readGiftQuote,giftQuoteLabel} from './gift-quote.mjs';
import {readGiftPreview} from './gift-preview.mjs';

const MAX_PACKAGE_BYTES=20*1024*1024;
const hex=bytes=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
async function sha256(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes));}
// Exported so the actual browser download protocol is also exercised in isolation.
export async function downloadGiftPackage({token,request,onProgress=()=>{}}){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('赠书链接不完整，未下载阅读包。');
  const chunks=[];let offset=0,snapshot=null,totalBytes=null;
  for(let count=0;count<32;count++){
    const query=new URLSearchParams({offset:String(offset)});if(snapshot)query.set('snapshot',snapshot);
    const part=await request('/api/book-gifts/'+token+'/download-part?'+query);
    if(part?.kind!=='marginalia-book-gift-part'||part.schemaVersion!==1||part.offset!==offset||!Number.isInteger(part.totalBytes)||part.totalBytes<1||part.totalBytes>MAX_PACKAGE_BYTES||typeof part.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(part.snapshot)||snapshot!==null&&snapshot!==part.snapshot||totalBytes!==null&&totalBytes!==part.totalBytes||typeof part.data!=='string'||part.data.length>1000000)throw Error('阅读包分段或版本无法对应，请重新下载。');
    snapshot=part.snapshot;totalBytes=part.totalBytes;
    let bytes;try{const binary=atob(part.data);if(btoa(binary)!==part.data)throw Error();bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));}catch{throw Error('阅读包分段无法读取，请重新下载。');}
    const end=offset+bytes.length;
    if(!bytes.length||bytes.length>700*1024||end>totalBytes||part.nextOffset!==(end<totalBytes?end:null)||await sha256(bytes)!==part.sha256)throw Error('阅读包分段校验未通过，请重新下载。');
    chunks.push(bytes);offset=end;onProgress({received:offset,total:totalBytes});
    if(part.nextOffset===null){
      const full=new Uint8Array(totalBytes);let index=0;for(const chunk of chunks){full.set(chunk,index);index+=chunk.length;}
      if(await sha256(full)!==snapshot)throw Error('阅读包校验未通过，请重新下载。');
      let backup;try{backup=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(full));}catch{throw Error('阅读包内容无法读取，请重新下载。');}
      if(backup?.kind!=='marginalia-library'||backup.schemaVersion!==1||!Array.isArray(backup.books)||backup.books.length!==1)throw Error('阅读包格式无法核验，请重新下载。');
      return new Blob([full],{type:'application/json;charset=utf-8'});
    }
  }
  throw Error('阅读包分段过多，未生成不完整的下载。');
}

if(typeof document!=='undefined'){
await import('./site-appearance.mjs');
const $=id=>document.getElementById(id);
const token=location.pathname.match(/^\/gift\/([A-Za-z0-9_-]{43})\/?$/)?.[1];
const preview=location.pathname==='/gift-preview';
let generation=0,gift=null,receiving=false,downloading=false,openTarget=false,progress=0,focusedLetter=false;
if(preview)document.body.dataset.preview='true';
async function request(url,{body,owner}={}){
  if(preview)throw Error('收信预览不会创建分享或收取书籍。');
  let response;try{response=await fetch(url,{credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(owner?{'X-Reader-Owner':owner}:{})}});}catch{throw Error('网络暂时无法连接，请稍后再试。');}
  if(response.headers.get('X-Reader-Session-Changed')==='1')throw Object.assign(Error('账户已切换，请重新打开信笺再收书。'),{status:409});
  let data;try{data=await response.json();}catch{throw Error('信笺暂时无法读取，请稍后再试。');}
  if(!response.ok)throw Object.assign(Error(data.error||'暂时无法完成，请稍后再试。'),{status:response.status});return data;
}
const scene=$('gift-scene'),envelope=$('gift-envelope-wrap'),letter=$('gift-letter-wrap'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const phase=(p,start,end)=>Math.max(0,Math.min(1,(p-start)/(end-start)));
// The wave field is decorative and stationary behind the reading text. The
// scene factory owns the real page wiring: one renderer at a time, rebuilt on
// every presentation after the DOM shows the scene, restarted only while the
// letter is open and visible and the page, scene and motion preferences allow.
const waves=createGiftWavesController({canvas:$('gift-waves-canvas'),isReduced:()=>reduced.matches,isHidden:()=>document.hidden});
const waveScene=createGiftWaveScene({waves,isSceneVisible:()=>!scene.hidden,onMode:mode=>{$('gift-waves').dataset.waves=mode;}});
function paintRitual(p,target){
  progress=p;const envelopeHeight=envelope.querySelector('.gift-envelope').offsetHeight,letterHeight=$('gift-letter').offsetHeight,reveal=phase(p,.2,.7),visible=p>.6;
  scene.style.height=(envelopeHeight+(letterHeight-envelopeHeight)*phase(p,.16,1))+'px';
  for(const [name,value]of Object.entries({p,flap:phase(p,0,.42),lift:phase(p,.12,.65),reveal,depart:phase(p,.48,.9),spread:phase(p,.4,1)}))scene.style.setProperty('--'+name,String(value));
  scene.style.setProperty('--visible-height',String(letterHeight*reveal)+'px');scene.dataset.settled=String(p===target);
  letter.inert=!visible;letter.setAttribute('aria-hidden',String(!visible));letter.style.pointerEvents=visible?'':'none';
  envelope.inert=visible;envelope.setAttribute('aria-hidden',String(visible));
  waveScene.letter(target&&visible);
  if(target&&visible&&!focusedLetter){focusedLetter=true;$('gift-title').focus({preventScroll:true});}
  if(!target&&!visible&&focusedLetter){focusedLetter=false;$('gift-open').focus({preventScroll:true});}
}
const ritual=createGiftSpring({onFrame:paintRitual,isReduced:()=>reduced.matches});
function setOpen(open){openTarget=open;scene.dataset.open=String(open);$('gift-open').setAttribute('aria-expanded',String(open));ritual.setOpen(open);}
const resize=()=>{paintRitual(progress,openTarget?1:0);waveScene.relayout();};
if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resize);observer.observe($('gift-letter'));observer.observe(envelope.querySelector('.gift-envelope'));}else window.addEventListener('resize',resize);
reduced.addEventListener('change',()=>{if(reduced.matches)ritual.finish();waveScene.reducedChanged();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)ritual.finish();waveScene.visibility(document.hidden);});
window.addEventListener('pagehide',()=>{ritual.finish();waveScene.pageHide();});
window.addEventListener('pageshow',()=>waveScene.pageShow());
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!scene.hidden){if(openTarget||progress>.01){event.preventDefault();setOpen(false);}else if(preview){event.preventDefault();parent.postMessage({kind:'marginalia-gift-preview-close'},location.origin);}}});
function rememberReturn(){try{sessionStorage.setItem('marginalia-gift-return',token);}catch{}}
function resumeReturn(){try{if(sessionStorage.getItem('marginalia-gift-return')===token){sessionStorage.removeItem('marginalia-gift-return');setOpen(true);ritual.finish();}}catch{}}
function showError(error){
  $('gift-loading').hidden=true;$('gift-scene').hidden=true;$('gift-error').hidden=false;$('gift-arrival').hidden=true;
  // The error scene is marked unavailable first, then its renderer detaches;
  // visibility or pageshow can never restart waves behind a hidden scene.
  waveScene.failed();
  $('gift-error-title').textContent=error.status===404?'这封赠书信已收回':'这封信暂时无法打开';
  $('gift-error-message').textContent=error.status===404?'链接可能不完整，也可能已被寄信人收回。可以请对方重新寄一封。':error.message;
  $('gift-retry').hidden=error.status===404;
}
function present(data){
  gift=data;const bookTitle=data.title?.zh||data.title?.en||'一本书',recipient=data.recipient||'你',sender=data.sender||'一位读者';
  document.title=bookTitle+' · 一封赠书信 · Leafhour';
  $('envelope-recipient').textContent=recipient;$('envelope-recipient').title=recipient;$('envelope-sender').textContent=sender;$('arrival-sender').textContent=sender;
  $('letter-salutation').textContent='给'+(data.recipient?' '+data.recipient:'你')+'：';
  $('gift-message').textContent=data.message;$('gift-message').hidden=!data.message;
  $('gift-title').textContent=bookTitle;$('gift-original-title').textContent=data.title?.en!==bookTitle?data.title?.en||'':'';
  $('gift-original-title').hidden=!$('gift-original-title').textContent;
  $('gift-author').textContent=data.author;$('gift-author').hidden=!data.author;
  $('gift-description').textContent=data.description;$('gift-description').hidden=!data.description;
  paintBookCover($('gift-cover'),data);
  $('letter-sender').textContent=sender;
  const date=new Date(data.createdAt);$('gift-date').textContent=Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric'}).format(date):'';
  $('gift-date').dateTime=data.createdAt;
  $('envelope-date').textContent=Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replaceAll('/','.') :'';
  if(!preview)$('gift-download').href='/api/book-gifts/'+token+'/download';
  $('gift-public-read').hidden=preview?!data.publicRead:!data.readUrl;
  if(preview){$('gift-public-read').href='#gift-main';$('gift-public-read').setAttribute('aria-disabled','true');}
  else if(data.readUrl)$('gift-public-read').href='/read?book='+encodeURIComponent(data.bookId);
  $('gift-package-scope').textContent=data.includeTranslations?'阅读包收录全书提取文字与寄信时已有的译文，不含原文件、个人笔记和阅读记录。':'阅读包收录全书提取文字，不含译文、原文件、个人笔记和阅读记录。';
  const quote=readGiftQuote(data.quote);
  $('gift-quote').hidden=!quote;
  if(quote){$('gift-quote-text').textContent=quote.text;$('gift-quote-source').textContent=quote.chapterTitle||'本书原文';$('gift-quote-label').textContent=giftQuoteLabel(quote.selection);}
  else{$('gift-quote-text').textContent='';$('gift-quote-source').textContent='';$('gift-quote-label').textContent='';}
  $('gift-loading').hidden=true;$('gift-error').hidden=true;$('gift-scene').hidden=false;$('gift-arrival').hidden=false;
  // The DOM shows the scene before the renderer is rebuilt: it measures the
  // real visible surface instead of a hidden 1x1 placeholder.
  resize();
  waveScene.presented();
  if(!preview)resumeReturn();
}
async function load(){
  const ticket=++generation,focus=trackActionFocus(document,$('gift-retry'));$('gift-loading').hidden=false;$('gift-error').hidden=true;
  try{if(!token)throw Object.assign(Error('链接不完整'),{status:404});const data=await request('/api/book-gifts/'+token);if(ticket===generation)present(data);}catch(error){if(ticket===generation)showError(error);}finally{if(ticket===generation)focus.restore($('gift-scene').hidden?$('gift-retry').hidden?$('gift-error').querySelector('a'):$('gift-retry'):$('gift-scene').dataset.open==='true'?$('gift-title'):$('gift-open'));else focus.stop();}
}
async function accept(){
  if(preview){$('gift-action-status').textContent='这是收信预览，书籍不会加入书架。';return;}
  if(receiving||!gift)return;const focus=trackActionFocus(document,$('gift-accept'));receiving=true;$('gift-accept').disabled=true;$('gift-action-status').classList.remove('error');$('gift-action-status').textContent='正在放进你的书架…';
  try{
    const session=await request('/api/auth/session');
    if(!session.user?.id){rememberReturn();location.assign('/library?login=1&next='+encodeURIComponent('/gift/'+token));return;}
    const saved=await request('/api/book-gifts/'+token+'/accept',{body:{},owner:session.user.id});
    if(typeof saved.bookId!=='string'||!saved.bookId||saved.readUrl!=='/read?book='+encodeURIComponent(saved.bookId))throw Error('收书结果无法核验，请回到书房确认。');
    $('gift-accept').hidden=true;$('gift-saved-read').href=saved.readUrl;$('gift-saved-read').hidden=false;
    $('gift-action-status').textContent=saved.alreadyOwned?'这本书已在你的书架上，自己的译文和笔记都已保留。':'已放进你的书架。从第一页开始，写下自己的旁注。';
  }catch(error){
    if(error.status===401){rememberReturn();location.assign('/library?login=1&next='+encodeURIComponent('/gift/'+token));return;}
    if(error.status===404){showError(error);return;}
    $('gift-action-status').classList.add('error');$('gift-action-status').textContent=error.message;
  }finally{receiving=false;$('gift-accept').disabled=false;focus.restore(!$('gift-error').hidden?$('gift-error').querySelector('a'):$('gift-accept').hidden?$('gift-saved-read'):$('gift-accept'));}
}
$('gift-open').addEventListener('click',()=>setOpen(true));$('gift-close').addEventListener('click',()=>setOpen(false));
$('gift-accept').addEventListener('click',accept);$('gift-retry').addEventListener('click',load);
$('gift-public-read').addEventListener('click',event=>{if(preview){event.preventDefault();$('gift-action-status').textContent='这是收信预览，不会离开信笺。';}});
$('gift-download').addEventListener('click',async event=>{
  event.preventDefault();if(preview){$('gift-download-status').textContent='这是收信预览，不会下载或公开书籍。';return;}if(downloading||!gift)return;downloading=true;const link=$('gift-download'),status=$('gift-download-status');
  link.setAttribute('aria-disabled','true');link.setAttribute('aria-busy','true');status.classList.remove('error');status.textContent='正在准备阅读包…';
  try{
    const blob=await downloadGiftPackage({token,request,onProgress:({received,total})=>{status.textContent='正在核对阅读包 · '+Math.round(received/total*100)+'%';}}),url=URL.createObjectURL(blob),save=document.createElement('a');
    save.href=url;save.download='leafhour-reading-package.json';save.hidden=true;document.body.append(save);save.click();save.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent='阅读包已校验，已交给浏览器保存。';
  }catch(error){if(error.status===404)showError(error);else{status.classList.add('error');status.textContent=error.message;}}
  finally{downloading=false;link.removeAttribute('aria-disabled');link.removeAttribute('aria-busy');}
});
if(preview){
  $('gift-preview-label').hidden=false;$('gift-accept').setAttribute('aria-disabled','true');$('gift-download').setAttribute('aria-disabled','true');
  if(parent===window){showError(Error('请从书房的赠书窗口打开收信预览。'));$('gift-retry').hidden=true;}
  else{
    $('gift-loading').querySelector('p').textContent='正在展开收信预览…';
    window.addEventListener('message',event=>{const data=readGiftPreview(event,{origin:location.origin,source:parent});if(data)present(data);});
    parent.postMessage({kind:'marginalia-gift-preview-ready'},location.origin);
  }
}else await load();

}
