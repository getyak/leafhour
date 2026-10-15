import {paintBookCover} from './book-binding.mjs';

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
let generation=0,gift=null,receiving=false,downloading=false;
async function request(url,{body,owner}={}){
  let response;try{response=await fetch(url,{credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(owner?{'X-Reader-Owner':owner}:{})}});}catch{throw Error('网络暂时无法连接，请稍后再试。');}
  if(response.headers.get('X-Reader-Session-Changed')==='1')throw Object.assign(Error('账户已切换，请重新打开信笺再收书。'),{status:409});
  let data;try{data=await response.json();}catch{throw Error('信笺暂时无法读取，请稍后再试。');}
  if(!response.ok)throw Object.assign(Error(data.error||'暂时无法完成，请稍后再试。'),{status:response.status});return data;
}
function setOpen(open){
  $('gift-scene').dataset.open=String(open);$('gift-open').setAttribute('aria-expanded',String(open));
  $('gift-letter-wrap').inert=!open;$('gift-letter-wrap').setAttribute('aria-hidden',String(!open));
  $('gift-envelope-wrap').inert=open;$('gift-envelope-wrap').setAttribute('aria-hidden',String(open));
  (open?$('gift-title'):$('gift-open')).focus({preventScroll:true});
}
function showError(error){
  $('gift-loading').hidden=true;$('gift-scene').hidden=true;$('gift-error').hidden=false;
  $('gift-error-title').textContent=error.status===404?'这封赠书信已收回':'这封信暂时无法打开';
  $('gift-error-message').textContent=error.status===404?'链接可能不完整，也可能已被寄信人收回。可以请对方重新寄一封。':error.message;
  $('gift-retry').hidden=error.status===404;
}
function present(data){
  gift=data;const bookTitle=data.title?.zh||data.title?.en||'一本书',recipient=data.recipient||'你',sender=data.sender||'一位读者';
  document.title=bookTitle+' · 一封赠书信 · 循页';
  $('envelope-recipient').textContent=recipient;$('envelope-sender').textContent=sender;
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
  $('gift-download').href='/api/book-gifts/'+token+'/download';
  $('gift-public-read').hidden=!data.readUrl;if(data.readUrl)$('gift-public-read').href='/read?book='+encodeURIComponent(data.bookId);
  $('gift-package-scope').textContent=data.includeTranslations?'阅读包收录全书提取文字与寄信时已有的译文，不含原文件、个人笔记和阅读记录。':'阅读包收录全书提取文字，不含译文、原文件、个人笔记和阅读记录。';
  $('gift-loading').hidden=true;$('gift-error').hidden=true;$('gift-scene').hidden=false;
}
async function load(){
  const ticket=++generation;$('gift-loading').hidden=false;$('gift-error').hidden=true;
  try{if(!token)throw Object.assign(Error('链接不完整'),{status:404});const data=await request('/api/book-gifts/'+token);if(ticket===generation)present(data);}catch(error){if(ticket===generation)showError(error);}
}
async function accept(){
  if(receiving||!gift)return;receiving=true;$('gift-accept').disabled=true;$('gift-action-status').classList.remove('error');$('gift-action-status').textContent='正在放进你的书架…';
  try{
    const session=await request('/api/auth/session');
    if(!session.user?.id){location.assign('/library?login=1&next='+encodeURIComponent('/gift/'+token));return;}
    const saved=await request('/api/book-gifts/'+token+'/accept',{body:{},owner:session.user.id});
    if(typeof saved.bookId!=='string'||!saved.bookId||saved.readUrl!=='/read?book='+encodeURIComponent(saved.bookId))throw Error('收书结果无法核验，请回到书房确认。');
    $('gift-accept').hidden=true;$('gift-saved-read').href=saved.readUrl;$('gift-saved-read').hidden=false;
    $('gift-action-status').textContent=saved.alreadyOwned?'这本书已在你的书架上，自己的译文和笔记都已保留。':'已放进你的书架。从第一页开始，写下自己的旁注。';
    $('gift-saved-read').focus({preventScroll:true});
  }catch(error){
    if(error.status===401){location.assign('/library?login=1&next='+encodeURIComponent('/gift/'+token));return;}
    if(error.status===404){showError(error);return;}
    $('gift-action-status').classList.add('error');$('gift-action-status').textContent=error.message;
  }finally{receiving=false;$('gift-accept').disabled=false;}
}
$('gift-open').addEventListener('click',()=>setOpen(true));$('gift-close').addEventListener('click',()=>setOpen(false));
$('gift-accept').addEventListener('click',accept);$('gift-retry').addEventListener('click',load);
$('gift-download').addEventListener('click',async event=>{
  event.preventDefault();if(downloading||!gift)return;downloading=true;const link=$('gift-download'),status=$('gift-download-status');
  link.setAttribute('aria-disabled','true');link.setAttribute('aria-busy','true');status.classList.remove('error');status.textContent='正在准备阅读包…';
  try{
    const blob=await downloadGiftPackage({token,request,onProgress:({received,total})=>{status.textContent='正在核对阅读包 · '+Math.round(received/total*100)+'%';}}),url=URL.createObjectURL(blob),save=document.createElement('a');
    save.href=url;save.download='marginalia-reading-package.json';save.hidden=true;document.body.append(save);save.click();save.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent='阅读包已校验，已交给浏览器保存。';
  }catch(error){if(error.status===404)showError(error);else{status.classList.add('error');status.textContent=error.message;}}
  finally{downloading=false;link.removeAttribute('aria-disabled');link.removeAttribute('aria-busy');}
});
await load();

}
