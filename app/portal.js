import {positionStorageKey} from './reading-progress.mjs';
import {createUploadState} from './upload-state.mjs';
import {createOwnerScope,readOwnerResponse} from './owner-scope.mjs';
import {mountAuthDialog} from './auth-dialog.mjs';
import {safeReaderReturn} from './reader-return.mjs';
import {chineseTrialUrl} from './catalog-sample.mjs';
import {mountReadingDashboard} from './reading-dashboard.mjs';
import {roomShelf,readingBookUrl} from './library-workspace.mjs';
import {mountLibraryShell,roomIcons} from './library-shell.mjs';
import {mountLibraryChat} from './library-chat.mjs';
import {paintBookCover} from './book-binding.mjs';
import './site-appearance.mjs';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const ownerScope=createOwnerScope();
let refreshGeneration=0;
let session=null,books=[],shelf='all',selectedCurrent=null,pendingUpload=false,pendingChat=false,upload=createUploadState(),shell=null,chat=null,dashboard=null;
const status=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('error',error);};
const api=(url,data,ticket=ownerScope.capture())=>readOwnerResponse(ownerScope,ticket,()=>fetch(url,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{'Content-Type':'application/json',...(url.startsWith('/api/library')?{'X-Reader-Owner':ticket.owner}:{})}}).catch(()=>{throw Error('网络暂时无法连接，请稍后重试。');}),()=>{ownerScope.adopt('guest');session={...session,user:null};clearPrivateUI();location.reload();});
const isLibrary=location.pathname==='/library';$('home-view').hidden=isLibrary;$('library-view').hidden=!isLibrary;document.body.classList.toggle('library-page',isLibrary);
const entryQuery=new URLSearchParams(location.search),returnToReader=safeReaderReturn(entryQuery.get('next'));
let pendingCalendar=isLibrary&&entryQuery.get('calendar')==='1',pendingSettings=isLibrary&&(entryQuery.get('settings')||location.hash==='#agent');
const returnAfterAuth=()=>{if(returnToReader&&!pendingUpload){location.replace(returnToReader);return true;}if(!isLibrary){location.href='/library';return true;}return false;};
if(isLibrary)document.title='我的书房 · 循页 Page by Page';
const authDialog=mountAuthDialog({dialog:$('auth-dialog'),api,getSession:()=>session,getReturnTo:()=>pendingUpload?'/library?upload=1':returnToReader||'/library',onSessionSettled:()=>refresh().catch(error=>status('library-status',error.message,true)),onAuthenticated:async()=>{const returnToChat=pendingChat;pendingChat=false;if(returnAfterAuth())return;try{await refresh();status('library-status','');if(pendingUpload)openUpload();else if(returnToChat)chat?.open();}catch(error){status('library-status','已登录，书架暂时无法刷新。'+error.message,true);}}});
const openAuth=message=>authDialog.open(typeof message==='string'?message:undefined);
$('auth-dialog').addEventListener('close',()=>{pendingChat=false;});
const ensureUser=()=>{if(session?.user)return true;openAuth();return false;};
const getOwner=()=>{const t=ownerScope.capture();return t.owner+':'+t.revision;};
dashboard=mountReadingDashboard({root:$('reading-dashboard'),overviewRoot:$('reading-overview'),historyRoot:$('reading-history'),api,getSession:()=>session,getBooks:()=>books,getOwner,openAuth,refresh,onCurrentBook:book=>{selectedCurrent=book?.bookId||null;renderBooks();}});
if(isLibrary){chat=mountLibraryChat({root:$('library-chat'),api,getSession:()=>session,getBooks:()=>books,getOwner:()=>ownerScope.capture().owner,openAuth:message=>{pendingChat=true;openAuth(message);},getCurrentBook:()=>dashboard.getCurrentBook()});shell=mountLibraryShell({getSession:()=>session,openAuth,onLogout:signOut,onHistory:()=>dashboard.openHistory(),onOpenChat:()=>chat.open()});}else roomIcons();
function clearPrivateUI({keepAuthDialog=false}={}){
  for(const id of ['upload-status','library-status','upload-filename'])status(id,'');
  for(const id of ['book-file','book-search'])$(id).value='';if(!keepAuthDialog){status('auth-status','');authDialog.reset();if($('auth-dialog').open)$('auth-dialog').close();}
  if($('upload-dialog').open)$('upload-dialog').close();$('upload-dialog').removeAttribute('aria-busy');$('confirm-upload').disabled=true;$('book-file').disabled=false;
  if($('reading-history').open)$('reading-history').close();pendingUpload=false;pendingChat=false;selectedCurrent=null;upload=createUploadState();shelf='all';document.querySelectorAll('[data-shelf]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shelf==='all')));
  books=books.filter(b=>b.visibility==='public').map(b=>({...b,resume:null,journey:null}));chat?.reset();shell?.update();dashboard?.clear();renderBooks();$('featured-books').replaceChildren(...books.slice(0,3).map(landingBookCard));
}
function landingBookCard(book){
  const card=make('article','book-card'),art=make('a','book-art '+(book.cover||'private'));art.href='/read?book='+encodeURIComponent(book.bookId);art.setAttribute('aria-label','阅读'+book.title.zh);
  const cover=make('div','book-cover'),inner=make('div','cover-inner');inner.append(make('small','',book.visibility==='public'?'PAGE BY PAGE':'MY READING ROOM'),make('strong','',isLibrary&&book.title.zh==='爱丽丝梦游仙境'?'爱丽丝\n梦游仙境':book.title.zh.slice(0,28)),make('span','cover-ornament',book.cover==='alice'?'❦':book.cover==='walden'?'⌁':'☼'),make('small','',book.visibility==='public'?'ORIGINAL TEXT':'A BOOK OF MY OWN'));cover.append(inner);art.append(cover);
  const meta=make('div','book-meta'),label=make('div','book-label');label.append(make('span','',book.visibility==='public'?'公版 · 英文原文':'自己的书 · '+book.source.format.toUpperCase()),make('span','',book.chineseSample?'双译开篇 · '+book.chineseSample.paragraphs+' 段':book.visibility==='public'?'按需翻译':'已提取'));
  meta.append(label,make('h3','',book.title.zh),make('p','book-author',book.author||book.source.filename),make('p','book-description',book.description||'原文已保留。译文和思考，从这一页开始。'));
  let resume=book.resume;if(!session?.user){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)resume={label:local.chapterLabel,passageId:local.passageId};}catch{}}
  art.href=readingBookUrl(book,resume);
  if(resume){meta.append(make('p','book-resume',resume.label));art.setAttribute('aria-label','继续阅读'+book.title.zh);}
  const bottom=make('div','book-bottom'),read=make('a','book-read',resume?'继续阅读 →':'开始阅读 →');read.href=art.href;bottom.append(read);
  if(book.chineseSample){const trial=make('a','source-link','中文试读 ↗');trial.href=chineseTrialUrl(book);meta.append(trial);}
  if(book.source.url){const source=make('a','source-link','来源 ↗');source.href=book.source.url;source.target='_blank';source.rel='noopener noreferrer';bottom.append(source);}else bottom.append(make('span','',book.paragraphs+' 段'));
  meta.append(bottom);card.append(art,meta);return card;
}
function bookCard(book){
  const card=make('article','book-card'),art=make('a','book-art '+(book.cover||'private'));art.href=readingBookUrl(book);art.setAttribute('aria-label',(book.resume?'继续阅读':'阅读')+book.title.zh);
  const cover=make('div','book-cover');paintBookCover(cover,book);art.append(cover);
  const meta=make('div','book-meta');meta.append(make('h3','',book.title.zh),make('p','book-author',book.author||book.source?.filename||''));
  const description=book.chineseSample?'中文双译开篇 · '+book.chineseSample.paragraphs+' 段':book.visibility==='public'?'英文原文 · 按需翻译':'原文已保存 · '+String(book.source?.format||'文本').toUpperCase();meta.append(make('p','book-label',description));
  const bottom=make('div','book-bottom'),read=make('a','book-read',book.resume?'继续阅读 →':'开始阅读 →');read.href=art.href;
  const details=make('details','book-details'),summary=make('summary','','书籍信息'),detail=make('div','book-details-body');details.append(summary,detail);details.addEventListener('toggle',()=>positionBookDetails(details));details.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){event.preventDefault();details.open=false;summary.focus();}});
  if(book.resume?.label)detail.append(make('p','',book.resume.label));
  detail.append(make('p','',book.visibility==='public'?'公版底本 · 英文原文':'个人上传 · '+(book.paragraphs||0)+' 段原文'));
  if(book.chineseSample){const trial=make('a','','中文试读 ↗');trial.href=chineseTrialUrl(book);detail.append(trial,make('p','','已保存的双译为 AI 草稿。其余段落保留原文，按需翻译。'));}
  if(book.source?.url){const source=make('a','','查看来源与许可 ↗');source.href=book.source.url;source.target='_blank';source.rel='noopener noreferrer';detail.append(source);}else detail.append(make('p','','原件与阅读记录归入自己的书房。'));
  bottom.append(read,details);meta.append(bottom);card.append(art,meta);return card;
}
function positionBookDetails(details){
  if(!details.open)return;const panel=details.querySelector('.book-details-body');panel.style.transform='';
  const bounds=$('library-view').getBoundingClientRect(),rect=panel.getBoundingClientRect(),left=Math.max(12,bounds.left+12),right=Math.min(innerWidth-12,bounds.right-12);
  const shift=rect.left<left?left-rect.left:rect.right>right?right-rect.right:0;panel.style.transform='translateX('+shift+'px)';
}
window.addEventListener('resize',()=>{for(const details of document.querySelectorAll('.book-details[open]'))positionBookDetails(details);});
function renderBooks(){
  const query=$('book-search').value.trim(),room=roomShelf(books,{scope:shelf,query,selectedBookId:selectedCurrent});
  $('library-books').replaceChildren(...room.books.map(bookCard));$('library-books').setAttribute('aria-busy','false');$('reading-dashboard').hidden=!room.featured&&!dashboard?.isLoading();$('shelf-title').hidden=!room.books.length;$('shelf-title').textContent=room.featured?'书架上的其他书':'书架';$('shelf-title').classList.toggle('sr-only',!room.featured);$('library-shelf').classList.toggle('with-current',!!room.featured);$('library-shelf').hidden=dashboard?.isLoading()||!!room.featured&&!room.books.length;
  $('room-title').textContent=query?'搜索结果':shelf==='private'?'我上传的':'我的书房';$('room-count').textContent=dashboard?.isLoading()?'':room.total+' 本书';$('sidebar-book-count').textContent=books.length;$('search-clear').hidden=!query;
  $('empty-shelf').hidden=!!room.total;$('empty-shelf').querySelector('h2').textContent=query?'没有找到这本书':'还没有自己的书';$('empty-shelf').querySelector('p').textContent=query?'换一个书名或作者，再找找看。':session?.user?'带来一份 PDF、TXT 或 Markdown，从自己的书开始。':'登录后，带来自己的书，留下自己的阅读记录。';$('empty-upload').hidden=!!query;$('empty-clear').hidden=!query;
  chat?.update();
}
async function refresh(knownSession){
  const generation=++refreshGeneration,arrivalTicket=isLibrary?dashboard.begin():null;
  try{
  const next=knownSession||await api('/api/auth/session');if(generation!==refreshGeneration)return;
  const continueUpload=!session?.user&&next.user&&pendingUpload,continueChat=!session?.user&&next.user&&pendingChat,changed=ownerScope.adopt(next.user?.id||'guest');session=next;
  if(changed){clearPrivateUI({keepAuthDialog:authDialog.isSettingPasswordFor(next.user?.id)});pendingUpload=!!continueUpload;pendingChat=!!continueChat;}authDialog.updateCapabilities();shell?.update();
  $('account-button').textContent=session.user?'我的书房 ↗':'登录 / 注册 ↗';$('library-description').textContent=session.user?'自己的书与阅读记录。':'先选一本书，读几页。';
  const library=await api('/api/library');if(generation!==refreshGeneration)return;books=library.books;
  if(!session.user)for(const book of books){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)book.resume={label:local.chapterLabel,passageId:local.passageId,updatedAt:local.updatedAt,mode:local.mode,variant:local.variant};}catch{}}
  $('library-retry').hidden=true;status('library-status','');renderBooks();$('featured-books').replaceChildren(...books.filter(b=>b.visibility==='public').slice(0,3).map(landingBookCard));
  if(isLibrary){dashboard.update(arrivalTicket);if(pendingCalendar){pendingCalendar=false;dashboard.openHistory();}if(pendingSettings){const tab=pendingSettings;pendingSettings=false;shell.openSettings(typeof tab==='string'?tab:'account');}}
  }catch(error){if(generation!==refreshGeneration)return;if(isLibrary){dashboard.fail(error,arrivalTicket);$('library-retry').hidden=false;$('library-books').setAttribute('aria-busy','false');}throw error;}
}
async function signOut(){
  const ticket=ownerScope.capture();await api('/api/auth/logout',{},ticket);session={...session,user:null};ownerScope.adopt('guest');clearPrivateUI();
  try{await refresh();}catch{status('library-status','已退出。书架暂时无法刷新，可以重新打开。',true);$('library-retry').hidden=false;}
}
$('account-button').addEventListener('click',()=>{if(!session?.user){openAuth();return;}if(isLibrary)shell.openSettings('account');else location.href='/library?settings=account';});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
document.addEventListener('click',event=>{for(const details of document.querySelectorAll('.book-details[open]'))if(!details.contains(event.target))details.open=false;});
function openUpload(){shell?.closeNavigation();pendingUpload=true;if(!ensureUser())return;pendingUpload=false;if(!upload.file){$('book-file').value='';$('upload-filename').textContent='';status('upload-status','');$('confirm-upload').textContent='放进我的书房 →';}$('confirm-upload').disabled=upload.busy||!upload.file;if(!$('upload-dialog').open)$('upload-dialog').showModal();}
for(const id of ['upload-button','empty-upload'])$(id).addEventListener('click',openUpload);
function selectFile(file){if(!file||upload.busy)return;$('upload-filename').textContent='';$('confirm-upload').disabled=true;$('book-file').value='';try{upload.select(file);$('upload-filename').textContent=file.name+' · '+(file.size>=1024*1024?(file.size/1024/1024).toFixed(2)+' MB':Math.max(1,Math.ceil(file.size/1024))+' KB');$('confirm-upload').textContent='放进我的书房 →';$('confirm-upload').disabled=false;status('upload-status','');}catch(error){status('upload-status',error.message,true);}}
$('book-file').addEventListener('change',e=>selectFile(e.target.files[0]));
const drop=$('drop-zone');drop.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!upload.busy)$('book-file').click();}});$('upload-dialog').addEventListener('close',()=>{if(upload.busy)status('library-status','正在导入 '+upload.file.name+'，完成后会更新书架。');});for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');if(event==='drop')selectFile(e.dataTransfer.files[0]);});
$('confirm-upload').addEventListener('click',async()=>{
  if(!upload.file||upload.busy)return;const ticket=ownerScope.capture(),operation=upload,file=operation.begin(),b=$('confirm-upload');let succeeded=false;b.disabled=true;$('book-file').disabled=true;b.textContent='正在放进书房…';$('upload-dialog').setAttribute('aria-busy','true');status('upload-status',file.name.toLowerCase().endsWith('.pdf')?'正在提取 PDF 文字，请稍等…':'正在整理段落…');
  try{
    let book;
    if(session.directUpload){
      status('upload-status','正在将原文件存入你的私人书房…');
      const target=await api('/api/library/upload/start',{filename:file.name,bytes:file.size},ticket);
      ownerScope.assertCurrent(ticket);
      const sent=await fetch(target.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});
      if(!sent.ok)throw Error('原文件上传未完成。');
      ownerScope.assertCurrent(ticket);
      status('upload-status','原文件已收到，正在提取并整理段落…');
      book=await api('/api/library/upload/complete',{id:target.id},ticket);
    }else{
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('文件无法读取，请重新选择。'));reader.readAsDataURL(file);});
      book=await api('/api/library/upload',{filename:file.name,base64},ticket);
    }
    succeeded=true;
    if($('upload-dialog').open){status('upload-status','已放进书房，正在打开第一段。');location.href='/read?book='+encodeURIComponent(book.bookId);}else{await refresh();if(ownerScope.isCurrent(ticket))status('library-status',file.name+' 已放进书房。');}
  }catch(error){if(!ownerScope.isCurrent(ticket))return;status('upload-status',error.message+' 你可以重试，或选择另一份文件。',true);b.textContent='重试上传 →';if(!$('upload-dialog').open)status('library-status',file.name+' 上传未完成。打开上传窗口可重试。',true);}
  finally{operation.finish();if(succeeded)operation.reset();if(ownerScope.isCurrent(ticket)){b.disabled=!operation.file;$('book-file').disabled=false;$('upload-dialog').removeAttribute('aria-busy');}}
});
document.querySelectorAll('[data-shelf]').forEach(button=>{button.setAttribute('aria-label',button.dataset.shelf==='all'?'我的书房':'我上传的');button.addEventListener('click',()=>{shelf=button.dataset.shelf;document.querySelectorAll('[data-shelf]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderBooks();});});
$('book-search').addEventListener('input',renderBooks);
for(const id of ['search-clear','empty-clear'])$(id).addEventListener('click',()=>{$('book-search').value='';renderBooks();$('book-search').focus();});
$('library-retry').addEventListener('click',()=>{status('library-status','正在重新打开书房…');refresh().catch(error=>status('library-status',error.message,true));});
refresh().then(()=>{if(isLibrary&&entryQuery.get('upload')==='1')openUpload();if(isLibrary&&entryQuery.get('login')==='1'){if(session?.user&&returnToReader)location.replace(returnToReader);else if(!session?.user){const messages={cancelled:'登录已取消，可以重新选择。',expired:'登录链接已过期，请重新开始。',unavailable:'登录服务暂时无法连接，请稍后重试。'};openAuth(messages[entryQuery.get('auth_error')]);}}}).catch(error=>{status('library-status',error.message,true);$('featured-books').replaceChildren(make('p','muted','书架暂时无法连接，请稍后重试。'));});

const checkOwner=async()=>{if(document.hidden||authDialog.hasPendingSessionChange())return;try{const current=await api('/api/auth/session');if(authDialog.hasPendingSessionChange())return;if((current.user?.id||'guest')!==(session?.user?.id||'guest'))await refresh(current);}catch{}};
window.addEventListener('focus',checkOwner);document.addEventListener('visibilitychange',checkOwner);
