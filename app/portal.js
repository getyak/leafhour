import {uploadPdf} from './pdf-ingestion.mjs';
import {mountPdfOnboarding} from './pdf-onboarding.mjs';
import {homeLocale,homeText} from './home-locale.mjs';
import {positionStorageKey} from './reading-progress.mjs';
import {createUploadState} from './upload-state.mjs';
import {createOwnerScope,readOwnerResponse} from './owner-scope.mjs';
import {mountAuthDialog} from './auth-dialog.mjs';
import {safeReaderReturn,safeGiftReturn} from './reader-return.mjs';
import {createLibraryViewHistory,safeLibraryReturn,writeLibraryView,authReturnTarget} from './library-view-state.mjs';
import {chineseTrialUrl} from './catalog-sample.mjs';
import {mountReadingDashboard} from './reading-dashboard.mjs';
import {roomShelf,readingBookUrl,libraryShelf,hasShelfFilters} from './library-workspace.mjs';
import {mountShelfFilters} from './library-filter-controls.mjs';
import {mountLibraryShell,roomIcons} from './library-shell.mjs';
import {mountReadingSetupInvite} from './library-reading-preferences.mjs';
import {mountLibraryChat} from './library-chat.mjs';
import {paintBookCover} from './book-binding.mjs';
import {mountLibraryBookActions} from './library-book-actions.mjs';
import {mountShelfDrag,moveShelfBook} from './shelf-order.mjs';
import {mountIncrementalShelf} from './library-incremental.mjs';
import './site-appearance.mjs';
import {trackActionFocus} from './action-focus.mjs';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const ownerScope=createOwnerScope();
let refreshGeneration=0,pdfOnboarding=null,followedPdfId=null;
let session=null,books=[],shelfControls=null,selectedCurrent=null,pendingUpload=false,pendingChat=false,upload=createUploadState(),shell=null,chat=null,dashboard=null,bookActions=null,shelfDrag=null,setupInvite=null,shelfRevision=0,orderOperation=null;
// GET-179: one pure view codec plus one explicit lifecycle adapter own the
// library URL; overlays open/close/tab only through these explicit hooks.
let viewHistory=null,bootstrapped=false,syncingOverlay=false;
const status=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('error',error);};
const api=(url,data,ticket=ownerScope.capture())=>readOwnerResponse(ownerScope,ticket,()=>fetch(url,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{'Content-Type':'application/json',...((url.startsWith('/api/library')||url.startsWith('/api/account')||url.startsWith('/api/book-gifts'))?{'X-Reader-Owner':ticket.owner}:{})}}).catch(()=>{throw Object.assign(Error('网络暂时无法连接，请稍后重试。'),{retryable:true});}),()=>{ownerScope.adopt('guest');session={...session,user:null};clearPrivateUI();location.reload();});
const isLibrary=location.pathname==='/library';$('home-view').hidden=isLibrary;$('library-view').hidden=!isLibrary;document.body.classList.toggle('library-page',isLibrary);
const entryQuery=new URLSearchParams(location.search),returnToReader=safeGiftReturn(entryQuery.get('next'))||safeReaderReturn(entryQuery.get('next'));
let returnToLibrary=!returnToReader?safeLibraryReturn(entryQuery.get('next')):null;
let pendingSettings=isLibrary&&location.hash==='#agent';
const adoptPendingReturn=()=>{
  if(!isLibrary||!returnToLibrary||pendingUpload)return;
  const target=returnToLibrary;returnToLibrary=null;
  const overlay=viewHistory?.adoptReturn(target);
  if(overlay)syncOverlay(overlay);
};
const currentLibraryReturn=()=>viewHistory?safeLibraryReturn('/library'+writeLibraryView('',viewHistory.snapshot()))||'/library':'/library';
// Auth returns adopt the validated safe next only after identity settles, so a
// login handoff can never be erased by the owner change it triggers, and the
// adoption never calls history.back().
const returnAfterAuth=()=>{if(returnToReader&&!pendingUpload){location.replace(returnToReader);return true;}if(!isLibrary){location.href='/library';return true;}return false;};
const overlayMatches=(a,b)=>!!a&&!!b&&a.kind===b.kind&&(a.tab||null)===(b.tab||null);
const openOverlayFor=overlay=>{if(!viewHistory)return;if(overlayMatches(viewHistory.snapshot().overlay,overlay))return;viewHistory.openOverlay(overlay);};
const closeOverlayFor=(kind,reason='user')=>{if(viewHistory?.snapshot().overlay?.kind===kind)viewHistory.closeOverlay(reason);};
function syncOverlay(target){
  if(syncingOverlay||!isLibrary)return;syncingOverlay=true;
  try{
    const kind=target?.kind||null;
    if(kind!=='filter')shelfControls?.close();
    if(kind!=='settings'&&$('library-settings-dialog').open)$('library-settings-dialog').close();
    if(kind!=='calendar'&&$('reading-history').open)$('reading-history').close();
    if(kind!=='upload'&&$('upload-dialog').open)$('upload-dialog').close();
    if(kind!=='trash'&&bookActions?.getOverlayKind()==='trash')bookActions.closeDialog();
    if(kind==='filter')shelfControls?.open();
    else if(kind==='settings')shell?.openSettings(target.tab);
    else if(kind==='calendar')dashboard?.openHistory();
    else if(kind==='upload'&&!$('upload-dialog').open)openUpload();
    else if(kind==='trash'&&bookActions?.getOverlayKind()!=='trash')bookActions?.trash();
  }finally{syncingOverlay=false;}
}
if(isLibrary)document.title='我的书房 · Leafhour';
const authDialog=mountAuthDialog({dialog:$('auth-dialog'),api,getSession:()=>session,getReturnTo:()=>authReturnTarget({pendingUpload,readerReturn:returnToReader,libraryReturn:returnToLibrary,current:currentLibraryReturn()}),onSessionSettled:()=>refresh().catch(error=>status('library-status',error.message,true)),onAuthenticated:async()=>{const returnToChat=pendingChat;pendingChat=false;if(returnAfterAuth())return;try{await refresh();adoptPendingReturn();status('library-status','');if(pendingUpload)openUpload();else if(returnToChat)chat?.open();}catch(error){status('library-status','已登录，书架暂时无法刷新。'+error.message,true);}}});
const openAuth=message=>authDialog.open(typeof message==='string'?message:undefined);
$('auth-dialog').addEventListener('close',()=>{pendingChat=false;});
const ensureUser=()=>{if(session?.user)return true;openAuth();return false;};
const getOwner=()=>{const t=ownerScope.capture();return t.owner+':'+t.revision;};
dashboard=mountReadingDashboard({root:$('reading-dashboard'),overviewRoot:$('reading-overview'),historyRoot:$('reading-history'),api,getSession:()=>session,getBooks:()=>books,getOwner,openAuth,refresh,onCurrentBook:book=>{selectedCurrent=book?.bookId||null;renderBooks();},onOverlay:overlay=>openOverlayFor(overlay),onClose:kind=>closeOverlayFor(kind,'user')});
if(isLibrary){shelfControls=mountShelfFilters({root:$('library-filter-controls'),onOpenChange:open=>{if(open)openOverlayFor({kind:'filter'});else closeOverlayFor('filter','dismiss');},onChange:action=>{shelfDrag?.reset();if(!viewHistory){renderBooks();return;}if(action.patch)viewHistory.setView(action.patch);else if(action.clear)viewHistory.clearView(action.clear);else if(action.clearAll)viewHistory.clearAll();}});chat=mountLibraryChat({root:$('library-chat'),api,getSession:()=>session,getBooks:()=>books,getOwner:()=>ownerScope.capture().owner,openAuth:message=>{pendingChat=true;openAuth(message);},getCurrentBook:()=>dashboard.getCurrentBook()});shell=mountLibraryShell({getSession:()=>session,api,getBooks:()=>books,getCurrentBook:()=>dashboard.getCurrentBook(),inboxRoot:$('daily-reading-inbox'),onRestored:()=>refresh(),onProfileUpdated:(profile,userId)=>{if(session?.user?.id!==userId)return;Object.assign(session.user,profile);shell.update();},onReadingPreferencesSaved:saved=>{if(session)session.readingPreferences=saved;setupInvite?.update();},openAuth,onLogout:signOut,onHistory:()=>dashboard.openHistory(),onOpenChat:()=>chat.open(),onSettingsOpen:tab=>openOverlayFor({kind:'settings',tab}),onSettingsClose:()=>closeOverlayFor('settings','user'),onSettingsTab:tab=>{const current=viewHistory?.snapshot().overlay;if(current?.kind==='settings'&&current.tab!==tab)openOverlayFor({kind:'settings',tab});}});setupInvite=mountReadingSetupInvite({root:$('reading-setup-invite'),api,getSession:()=>session,openSettings:tab=>shell.openSettings(tab),onSaved:saved=>{if(session)session.readingPreferences=saved;setupInvite?.update();},onError:message=>status('library-status',message,true)});bookActions=mountLibraryBookActions({api,getSession:()=>session,getBooks:()=>libraryShelf(books),getOwner,getRevision:()=>shelfRevision,setRevision:value=>{shelfRevision=value;},onReorder:saveShelfOrder,onChanged:()=>refresh(),openAuth,onOverlay:overlay=>openOverlayFor(overlay),onClose:(kind,reason)=>{if(kind==='trash')closeOverlayFor('trash',reason);}});shelfDrag=mountShelfDrag({grid:$('library-books'),getBooks:()=>libraryShelf(books),getOwner,onReorder:saveShelfOrder,onError:error=>status('library-status',error.message,true)});$('library-trash').addEventListener('click',()=>{shell.closeNavigation();bookActions.trash();});}else roomIcons();
if(isLibrary)viewHistory=createLibraryViewHistory({window,onChange:(snapshot,meta)=>{
  shelfControls?.apply(snapshot.view);
  renderBooks();
  if(meta.source!=='hydrate')syncOverlay(snapshot.overlay);
}});
const shelfList=isLibrary?mountIncrementalShelf({grid:$('library-books'),controls:$('shelf-more'),renderItem:bookCard}):null;
pdfOnboarding=mountPdfOnboarding({document,root:$('pdf-ingestion-jobs'),api,getSession:()=>session,capture:()=>ownerScope.capture(),isCurrent:ticket=>ownerScope.isCurrent(ticket),onOpen:bookId=>{location.href='/read?book='+encodeURIComponent(bookId);},onDone:job=>{if(followedPdfId===job.id&&$('upload-dialog').open){pdfOnboarding.opened(job);location.href='/read?book='+encodeURIComponent(job.bookId);}else refresh().catch(error=>status('library-status',error.message,true));}});
function clearPrivateUI({keepAuthDialog=false,preserveView=false}={}){
  if(!preserveView)viewHistory?.adoptOwner();
  bookActions?.clear();shelfDrag?.reset();shelfRevision=0;orderOperation=null;
  for(const id of ['upload-status','library-status','upload-filename'])status(id,'');
  for(const id of preserveView?['book-file']:['book-file','book-search'])$(id).value='';if(!keepAuthDialog){status('auth-status','');authDialog.reset();if($('auth-dialog').open)$('auth-dialog').close();}
  if($('upload-dialog').open)$('upload-dialog').close();$('upload-dialog').removeAttribute('aria-busy');$('confirm-upload').disabled=true;$('book-file').disabled=false;
  if($('reading-history').open)$('reading-history').close();pendingUpload=false;pendingChat=false;selectedCurrent=null;upload=createUploadState();pdfOnboarding?.reset();followedPdfId=null;if(!preserveView)shelfControls?.reset();document.querySelectorAll('[data-shelf]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shelf==='all')));
  books=books.filter(b=>b.visibility==='public').map(b=>({...b,resume:null,journey:null}));chat?.reset();shell?.update();setupInvite?.update();dashboard?.clear();renderBooks();$('featured-books').replaceChildren(...books.slice(0,3).map(landingBookCard));
}
function landingBookCard(book){
  const locale=homeLocale(document),spaced=locale!=='zh-Hans'&&locale!=='zh-Hant';
  const title=spaced&&!isLibrary?(book.title.en||book.title.zh):book.title.zh;
  const landingMake=(tag,cls,text)=>make(tag,cls,homeText(text,homeLocale(document)));
  const card=landingMake('article','book-card'),art=landingMake('a','book-art '+(book.cover||'private'));art.href='/read?book='+encodeURIComponent(book.bookId);art.setAttribute('aria-label',homeText('阅读',homeLocale(document))+(spaced?' ':'')+title);
  const cover=landingMake('div','book-cover'),inner=landingMake('div','cover-inner');inner.append(landingMake('small','',book.visibility==='public'?'Leafhour':'MY READING ROOM'),landingMake('strong','',isLibrary&&book.title.zh==='爱丽丝梦游仙境'?'爱丽丝\n梦游仙境':title.slice(0,64)),landingMake('span','cover-ornament',book.cover==='alice'?'❦':book.cover==='walden'?'⌁':'☼'),landingMake('small','',book.visibility==='public'?'ORIGINAL TEXT':'A BOOK OF MY OWN'));cover.append(inner);art.append(cover);
  const meta=landingMake('div','book-meta'),label=landingMake('div','book-label');label.append(landingMake('span','',book.visibility==='public'?'公版 · 英文原文':'自己的书 · '+book.source.format.toUpperCase()),landingMake('span','',book.chineseSample?'双译开篇 · '+book.chineseSample.paragraphs+' 段':book.visibility==='public'?'按需翻译':'已提取'));
  meta.append(label,landingMake('h3','',title),landingMake('p','book-author',book.author||book.source.filename),landingMake('p','book-description',book.description||'原文已保留。译文和思考，从这一页开始。'));
  let resume=book.resume;if(!session?.user){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)resume={label:local.chapterLabel,passageId:local.passageId};}catch{}}
  art.href=readingBookUrl(book,resume);
  if(resume){meta.append(landingMake('p','book-resume',resume.label));art.setAttribute('aria-label',homeText('继续阅读',homeLocale(document))+(spaced?' ':'')+title);}
  const bottom=landingMake('div','book-bottom'),read=landingMake('a','book-read',resume?'继续阅读 →':'开始阅读 →');read.href=art.href;bottom.append(read);
  if(book.chineseSample){const trial=landingMake('a','source-link','中文试读 ↗');trial.href=chineseTrialUrl(book);meta.append(trial);}
  if(book.source.url){const source=landingMake('a','source-link','来源 ↗');source.href=book.source.url;source.target='_blank';source.rel='noopener noreferrer';bottom.append(source);}else bottom.append(landingMake('span','',book.paragraphs+' 段'));
  meta.append(bottom);card.append(art,meta);return card;
}
function bookCard(book){
  const card=make('article','book-card'),art=make('a','book-art '+(book.cover||'private'));art.href=readingBookUrl(book);art.setAttribute('aria-label',(book.resume?'继续阅读':'阅读')+book.title.zh);
  const cover=make('div','book-cover');paintBookCover(cover,book);art.append(cover);
  const meta=make('div','book-meta'),heading=make('h3'),title=make('a','book-title-link',book.title.zh),author=make('p','book-author',book.author||book.source?.filename||'');title.href=art.href;heading.append(title);author.title=author.textContent;meta.append(heading,author);
  const label=make('p','book-label');
  if(book.chineseSample){const trial=make('a','source-link','中文试读 · '+book.chineseSample.paragraphs+' 段 ↗');trial.href=chineseTrialUrl(book);label.append(trial);}else label.textContent=book.visibility==='public'?'英文原文 · 按需翻译':'原文已保存 · '+String(book.source?.format||'文本').toUpperCase();meta.append(label);
  const bottom=make('div','book-bottom'),read=make('a','book-read',book.resume?'继续阅读 →':'开始阅读 →');read.href=art.href;
  bottom.append(read);meta.append(bottom);card.append(art,meta);bookActions?.decorate(card,book);
  const grip=make('button','book-drag-handle');grip.type='button';grip.setAttribute('aria-label','拖动《'+book.title.zh+'》调整位置');grip.setAttribute('aria-describedby','shelf-order-help');const symbol=make('span');symbol.dataset.icon='grip-vertical';symbol.setAttribute('aria-hidden','true');grip.append(symbol);card.append(grip);grip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const ids=libraryShelf(books).map(b=>b.bookId),index=ids.indexOf(book.bookId),target=ids[index+(event.key==='ArrowLeft'?-1:1)];if(target)saveShelfOrder(moveShelfBook(ids,book.bookId,target,event.key==='ArrowLeft'?'before':'after')).catch(error=>status('library-status',error.message,true));});grip.addEventListener('click',event=>{if(event.detail===0)card.querySelector('.book-action-trigger').click();});shelfDrag?.decorate(card);roomIcons(card);return card;
}
async function saveShelfOrder(ids){
  if(orderOperation)return;const owner=getOwner(),operation={owner},previousOrder=libraryShelf(books).map(book=>book.bookId),focused=document.activeElement,focusBook=focused?.closest('[data-book-id]')?.dataset.bookId,focusClass=focused?.classList.contains('book-drag-handle')?'book-drag-handle':focused?.classList.contains('book-action-trigger')?'book-action-trigger':null;orderOperation=operation;bookActions?.closeMenu();const rank=new Map(ids.map((id,index)=>[id,index]));books=books.map(b=>({...b,shelfPosition:rank.get(b.bookId)}));renderBooks();if(focusBook&&focusClass){const restored=[...document.querySelectorAll('[data-book-id]')].find(card=>card.dataset.bookId===focusBook);restored?.querySelector('.'+focusClass)?.focus({preventScroll:true});}status('library-status','正在摆好书架…');const focus=focusBook&&focusClass?trackActionFocus(document,document.activeElement):null;
  try{if(session?.user){const saved=await api('/api/library/order',{bookIds:ids,baseRevision:shelfRevision});if(owner!==getOwner())return;shelfRevision=saved.revision;}else{localStorage.setItem('marginalia-shelf-order:guest',JSON.stringify(ids));}if(owner===getOwner())status('library-status','书架顺序已保存。');}
  catch(error){if(owner===getOwner()){try{await refresh();}catch{if(owner===getOwner()){const previousRank=new Map(previousOrder.map((id,index)=>[id,index]));books=books.map((book,index)=>({...book,shelfPosition:previousRank.get(book.bookId)??previousOrder.length+index}));renderBooks();}}if(owner===getOwner())status('library-status','顺序暂未保存。'+error.message,true);}}
  finally{if(orderOperation===operation)orderOperation=null;if(focus){if(owner===getOwner()){const card=[...document.querySelectorAll('[data-book-id]')].find(node=>node.dataset.bookId===focusBook);focus.restore(card?.querySelector('.'+focusClass));}else focus.stop();}}
}
function renderBooks(){
  const filters=shelfControls?.read()||{query:$('book-search').value},query=filters.query.trim(),filtered=hasShelfFilters(filters),room=roomShelf(books,{...filters,selectedBookId:selectedCurrent});shelfControls?.update(books);
  const anchorId=document.activeElement?.closest('[data-book-id]')?.dataset.bookId;
  if(shelfList)shelfList.setItems(room.books,{key:JSON.stringify([getOwner(),filters]),anchorId});else $('library-books').replaceChildren();
  $('library-books').setAttribute('aria-busy','false');$('reading-dashboard').hidden=!room.featured&&!dashboard?.isLoading();$('shelf-title').hidden=!room.books.length;$('shelf-title').textContent=room.featured?'书架上的其他书':'书架';$('shelf-title').classList.toggle('sr-only',!room.featured);$('library-shelf').classList.toggle('with-current',!!room.featured);$('library-shelf').hidden=dashboard?.isLoading()||!!room.featured&&!room.books.length;
  const currentBook=dashboard?.getCurrentBook(),todayHeading=$('reading-dashboard').querySelector('.today-heading');if(currentBook&&todayHeading)bookActions?.decorate(todayHeading,currentBook);
  $('room-title').textContent=query?'搜索结果':filters.scope==='private'?'我上传的':'我的书房';$('room-count').textContent=dashboard?.isLoading()?'':filtered?room.total+' / '+books.length+' 本书':room.total+' 本书';$('sidebar-book-count').textContent=books.length;$('search-clear').hidden=!query;
  $('empty-shelf').hidden=!!room.total;$('empty-shelf').querySelector('h2').textContent=filtered?'没有符合条件的书':'还没有自己的书';$('empty-shelf').querySelector('p').textContent=filtered?'换一个书名，或减少一些筛选条件。':session?.user?'带来一份 PDF、EPUB、TXT 或 Markdown，从自己的书开始。':'登录后，带来自己的书，留下自己的阅读记录。';$('empty-upload').hidden=filtered;$('empty-clear').hidden=!filtered;$('empty-clear').textContent=query?'清除搜索和筛选':'清除筛选';
  chat?.update();
}
async function refresh(knownSession){
  const generation=++refreshGeneration,arrivalTicket=isLibrary?dashboard.begin():null;
  try{
  const next=knownSession||await api('/api/auth/session');if(generation!==refreshGeneration)return;
  const continueUpload=!session?.user&&next.user&&pendingUpload,continueChat=!session?.user&&next.user&&pendingChat,changed=ownerScope.adopt(next.user?.id||'guest');session=next;
  if(changed){clearPrivateUI({keepAuthDialog:authDialog.isSettingPasswordFor(next.user?.id),preserveView:!bootstrapped});pendingUpload=!!continueUpload;pendingChat=!!continueChat;}authDialog.updateCapabilities();shell?.update();setupInvite?.update();
  $('account-button').textContent=homeText(session.user?'我的书房 ↗':'登录 / 注册 ↗',homeLocale(document));$('library-description').textContent=homeText(session.user?'自己的书与阅读记录。':'先选一本书，读几页。',homeLocale(document));
  const library=await api('/api/library');if(generation!==refreshGeneration)return;books=library.books;shelfRevision=library.shelfRevision||0;
  if(!session.user){try{const order=JSON.parse(localStorage.getItem('marginalia-shelf-order:guest')||'null');if(Array.isArray(order)&&order.length<=1000){const rank=new Map(order.filter(id=>typeof id==='string').map((id,index)=>[id,index]));if(rank.size)books=books.map((book,index)=>({...book,shelfPosition:rank.get(book.bookId)??order.length+index}));}}catch{}}
  if(!session.user)for(const book of books){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)book.resume={label:local.chapterLabel,passageId:local.passageId,updatedAt:local.updatedAt,mode:local.mode,variant:local.variant};}catch{}}
  $('library-retry').hidden=true;status('library-status','');renderBooks();$('featured-books').replaceChildren(...books.filter(b=>b.visibility==='public').slice(0,3).map(landingBookCard));
  pdfOnboarding.refresh();if(isLibrary){dashboard.update(arrivalTicket);shell.refreshDaily();}
  bootstrapped=true;
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
function openUpload(){$('upload-dialog').classList.remove('pdf-saved');$('upload-title').textContent='这次，你想读什么？';shell?.closeNavigation();pendingUpload=true;if(!ensureUser())return;pendingUpload=false;if(!upload.file){$('book-file').value='';$('upload-filename').textContent='';status('upload-status','');$('confirm-upload').textContent='放进我的书房 →';}$('confirm-upload').disabled=upload.busy||!upload.file;$('upload-progress-slot').append($('pdf-ingestion-jobs'));pdfOnboarding.refresh();if(!$('upload-dialog').open){openOverlayFor({kind:'upload'});$('upload-dialog').showModal();}}
for(const id of ['upload-button','empty-upload'])$(id).addEventListener('click',openUpload);
function selectFile(file){if(!file||upload.busy)return;$('upload-filename').textContent='';$('confirm-upload').disabled=true;$('book-file').value='';try{upload.select(file);$('upload-filename').textContent=file.name+' · '+(file.size>=1024*1024?(file.size/1024/1024).toFixed(2)+' MB':Math.max(1,Math.ceil(file.size/1024))+' KB');$('confirm-upload').textContent='放进我的书房 →';$('confirm-upload').disabled=false;status('upload-status','');}catch(error){status('upload-status',error.message,true);}}
$('book-file').addEventListener('change',e=>selectFile(e.target.files[0]));
const drop=$('drop-zone');drop.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!upload.busy)$('book-file').click();}});$('upload-dialog').addEventListener('close',()=>{closeOverlayFor('upload','user');followedPdfId=null;$('library-import-slot').append($('pdf-ingestion-jobs'));if(upload.busy)status('library-status','正在导入 '+upload.file.name+'，完成后会更新书架。');});for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');if(event==='drop')selectFile(e.dataTransfer.files[0]);});
$('confirm-upload').addEventListener('click',async()=>{
  if(!upload.file||upload.busy)return;const ticket=ownerScope.capture(),operation=upload,file=operation.begin(),b=$('confirm-upload'),focus=trackActionFocus(document,b);let succeeded=false;b.disabled=true;$('book-file').disabled=true;b.textContent='正在放进书房…';$('upload-dialog').setAttribute('aria-busy','true');status('upload-status',file.name.toLowerCase().endsWith('.pdf')?'正在提取 PDF 文字，请稍等…':'正在整理段落…');
  try{
    let book;
    if(/\.pdf$/i.test(file.name)){
      const scopedApi=(path,body)=>api(path,body,ticket);
      const job=await uploadPdf({file,api:scopedApi,onProgress:message=>status('upload-status',message),assertCurrent:()=>ownerScope.assertCurrent(ticket)});
      ownerScope.assertCurrent(ticket);succeeded=true;
      if(job.state==='done'){pdfOnboarding.opened(job);if($('upload-dialog').open)location.href='/read?book='+encodeURIComponent(job.bookId);else{await refresh();status('library-status',file.name+' 已在书房，可直接阅读。');}return;}
      if($('upload-dialog').open){followedPdfId=job.id;$('upload-dialog').classList.add('pdf-saved');$('upload-title').textContent='书已收到';}pdfOnboarding.track(job);status('upload-status','原文件已保存在书房。进度会自动保存，可随时回来查看。');b.textContent='放进我的书房 →';return;
    }else if(session.directUpload){
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
  finally{operation.finish();if(succeeded)operation.reset();if(ownerScope.isCurrent(ticket)){b.disabled=!operation.file;$('book-file').disabled=false;$('upload-dialog').removeAttribute('aria-busy');if($('upload-dialog').open)focus.restore(succeeded?$('pdf-ingestion-jobs').querySelector('button')||$('upload-dialog').querySelector('.dialog-close'):b);else focus.stop();}else focus.stop();}
});
document.querySelectorAll('[data-shelf]').forEach(button=>{button.setAttribute('aria-label',button.dataset.shelf==='all'?'我的书房':'我上传的');button.addEventListener('click',()=>shelfControls?.set({scope:button.dataset.shelf}));});
$('book-search').addEventListener('input',()=>{shelfDrag?.reset();viewHistory?.setQuery($('book-search').value);renderBooks();});
// Unfinished IME text never reaches the URL: composition suspends the search
// commit and only the final composed query is scheduled.
$('book-search').addEventListener('compositionstart',()=>viewHistory?.compositionStart());
$('book-search').addEventListener('compositionend',()=>{if(viewHistory)viewHistory.compositionEnd($('book-search').value);renderBooks();});
$('search-clear').addEventListener('click',()=>{$('book-search').value='';shelfDrag?.reset();viewHistory?.setQuery('');renderBooks();$('book-search').focus();});
$('empty-clear').addEventListener('click',()=>{if(viewHistory)viewHistory.clearAll();else shelfControls?.reset();shelfDrag?.reset();renderBooks();$('book-search').focus();});
$('library-retry').addEventListener('click',async event=>{const focus=trackActionFocus(document,event.currentTarget);status('library-status','正在重新打开书房…');try{await refresh();}catch(error){status('library-status',error.message,true);}finally{focus.restore($('library-retry').hidden?$('main'):$('library-retry'));}});
if(isLibrary)viewHistory.hydrate();
refresh().then(()=>{
  // One bounded session-ready reconciliation from the CURRENT snapshot, so a
  // stale hydrate target can never resurrect an overlay the user replaced.
  if(isLibrary){const overlay=viewHistory?.takeSessionOverlay();if(overlay)syncOverlay(overlay);}
  if(isLibrary&&pendingSettings){pendingSettings=false;shell.openSettings('account');}
  if(isLibrary&&entryQuery.get('login')==='1'){if(session?.user){if(!returnAfterAuth())adoptPendingReturn();}else if(!session?.user){const messages={cancelled:'登录已取消，可以重新选择。',expired:'登录链接已过期，请重新开始。',unavailable:'登录服务暂时无法连接，请稍后重试。'};openAuth(messages[entryQuery.get('auth_error')]);}}}).catch(error=>{status('library-status',error.message,true);$('featured-books').replaceChildren(make('p','muted',homeText('书架暂时无法连接，请稍后重试。',homeLocale(document))));});

const checkOwner=async()=>{if(document.hidden||authDialog.hasPendingSessionChange())return;try{const current=await api('/api/auth/session');if(authDialog.hasPendingSessionChange())return;if((current.user?.id||'guest')!==(session?.user?.id||'guest'))await refresh(current);}catch{}};
window.addEventListener('focus',checkOwner);document.addEventListener('visibilitychange',checkOwner);
