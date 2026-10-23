const prepareCreditRequest=async options=>(await import('./credit-client.mjs')).prepareCreditRequest(options);
import {mountChatBookUpload} from './chat-book-upload.mjs';
import {createBookUploadController} from './book-upload-controller.mjs';
import {t,onUiLocaleChange,onBeforeUiPopstate,getUiLocale,getUiNavigationLocale,uiHref,uiReady,requestUiRoute,adoptUiOwner} from './ui-locale.mjs';
import {uiAuthoredPath} from './ui-locale-codec.mjs';
import {authEntryReturn,safeMcpReturn} from './auth-return.mjs';
import {homeLocale,homeText} from './home-locale.mjs';
import {positionStorageKey} from './reading-progress.mjs';
import {createUploadState} from './upload-state.mjs';
import {createOwnerScope,readOwnerResponse} from './owner-scope.mjs';
import {invalidatePaletteLibraries} from './palette-library.mjs';
import {mountSquirrelPosition} from './squirrel-position.mjs';
import {mountAuthDialog} from './auth-dialog.mjs';
import {safeReaderReturn,safeGiftReturn} from './reader-return.mjs';
import {createLibraryViewHistory,safeLibraryReturn,writeLibraryView,authReturnTarget} from './library-view-state.mjs';
import {chineseTrialUrl} from './catalog-sample.mjs';
import {mountReadingDashboard} from './reading-dashboard.mjs';
import {roomShelf,readingBookUrl,libraryShelf,hasShelfFilters} from './library-workspace.mjs';
import {mountShelfFilters} from './library-filter-controls.mjs';
import {mountLibraryShell,roomIcons} from './library-shell.mjs';
import {mountPreferenceMemory} from './preference-memory-ui.mjs';
import {mountLibraryChat} from './library-chat.mjs';
import {paintBookCover} from './book-binding.mjs';
import {mountLibraryBookActions} from './library-book-actions.mjs';
import {mountShelfDrag,moveShelfBook} from './shelf-order.mjs';
import {mountIncrementalShelf} from './library-incremental.mjs';
import './site-appearance.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {mountHomeNavigation,isHomeNavRoute} from './home-navigation.mjs';
import {homeEntryReady} from './home-entry-bootstrap.mjs';
await homeEntryReady;
// If the replacement is cancelled or interaction keeps this document open,
// retain its English prose and usable controllers. This route activation
// never records an explicit device or account preference.
if(location.pathname==='/')await requestUiRoute('en');
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
// Owned UI label registry (page chrome) and per-physical-node book-card label
// cache. Language commits reformat these nodes in place from cached state: no
// refresh/renderBooks/getBooks/identity/owner adoption/upload start and no
// input value changes ever happen on a language event.
const chromeLabels=new Map(),cardLabels=new Map(),ownedLinks=new Set();
const specText=spec=>typeof spec.render==='function'?spec.render():t(spec.id,spec.params);
const num=value=>new Intl.NumberFormat(getUiLocale()).format(value);
let uploadTitleId='portal.upload.title';
const applySpec=(n,spec)=>{const value=specText(spec);if(spec.attr)n.setAttribute(spec.attr,value);else{n.textContent=value;n.setAttribute('lang',getUiLocale());}};
const own=(n,spec)=>{if(!n)return n;chromeLabels.set(n,spec);applySpec(n,spec);return n;};
let cardPruneScheduled=false;
function scheduleCardPrune(){if(cardPruneScheduled)return;cardPruneScheduled=true;queueMicrotask(()=>{cardPruneScheduled=false;for(const node of [...cardLabels.keys()])if(node.isConnected===false)cardLabels.delete(node);});}
function registerCardNode(node,spec){cardLabels.set(node,spec);applySpec(node,spec);scheduleCardPrune();}
function ownedHref(node,target){node.href=uiHref(target);node.setAttribute('data-ui-owned-href',target);ownedLinks.add(node);return node;}
function mountCardLabels(card){for(const node of card.querySelectorAll('[data-ui-message],[data-ui-aria],[data-ui-drag-hint]')){const id=node.getAttribute('data-ui-message')||node.getAttribute('data-ui-aria')||node.getAttribute('data-ui-drag-hint'),attrName=node.getAttribute('data-ui-aria')?'aria-label':node.getAttribute('data-ui-drag-hint')?'data-drag-hint':null;let params=null;try{params=node.getAttribute('data-ui-message-params')?JSON.parse(node.getAttribute('data-ui-message-params')):null;}catch{params=null;}registerCardNode(node,{id,params,attr:attrName});}scheduleCardPrune();}
// Static card label stamping: kept self-contained so the real card factory can
// also run in isolated extraction fixtures without module-scope references.
const cardLabel=(node,id,params,attrName=null)=>{const value=t(id,params);if(attrName)node.setAttribute(attrName,value);else{node.textContent=value;node.setAttribute('lang',getUiLocale());}node.setAttribute(attrName?'data-ui-aria':'data-ui-message',id);if(params)node.setAttribute('data-ui-message-params',JSON.stringify(params));if(typeof registerCardNode==='function')registerCardNode(node,{id,params,attr:attrName});return node;};
own($('confirm-upload'),{id:'portal.upload.save'});
const ownerScope=createOwnerScope();
let refreshGeneration=0,pdfOnboarding=null,followedPdfId=null;
let session=null,books=[],shelfControls=null,selectedCurrent=null,pendingUpload=false,pendingChat=false,upload=createUploadState(),shell=null,chat=null,dashboard=null,bookActions=null,shelfDrag=null,setupInvite=null,shelfRevision=0,orderOperation=null,homeMenu=null,squirrelPosition=null;
// GET-179: one pure view codec plus one explicit lifecycle adapter own the
// library URL; overlays open/close/tab only through these explicit hooks.
let viewHistory=null,bootstrapped=false,identityResolved=false,syncingOverlay=false;
let uploadProgressMessage=null;
const paintStatus=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('error',error);};
// Replacing this owned slot invalidates its earlier progress descriptor.
const status=(id,text,error=false)=>{if(id==='upload-status')uploadProgressMessage=null;const target=$(id);chromeLabels.delete(target);if(text&&typeof text==='object'){own(target,text);target.classList.toggle('error',error);}else paintStatus(id,text,error);};
function showUploadProgress(update,ticket,operation){
  if(!ownerScope.isCurrent(ticket)||upload!==operation||!operation.busy)return;
  status('upload-status',t(update.id,update.params));
  $('upload-status').setAttribute('lang',getUiLocale());
  uploadProgressMessage={id:update.id,params:update.params,ticket,operation};
}
function updateUploadProgressLabel(){
  const progress=uploadProgressMessage;if(!progress)return;
  if(!ownerScope.isCurrent(progress.ticket)||upload!==progress.operation||!progress.operation.busy){uploadProgressMessage=null;return;}
  paintStatus('upload-status',t(progress.id,progress.params));
  $('upload-status').setAttribute('lang',getUiLocale());
}
const api=async(url,data,ticketOrOptions=ownerScope.capture())=>{
  const options=Object.hasOwn(ticketOrOptions||{},'owner')?{}:ticketOrOptions||{},ticket=Object.hasOwn(ticketOrOptions||{},'owner')?ticketOrOptions:ownerScope.capture();
  const maySubmit=()=>!options.signal?.aborted&&ownerScope.isCurrent(ticket)&&session?.user?.id===ticket.owner;
  const prepared=session?.billing?.enabled&&data!==undefined?await prepareCreditRequest({url,data,session,owner:ticket.owner,isCurrent:maySubmit,locale:getUiLocale()}):data;
  if(options.signal?.aborted)throw Object.assign(new Error('Request cancelled before submission'),{name:'AbortError',preSubmit:true});
  return readOwnerResponse(ownerScope,ticket,()=>{options.onDispatch?.();return fetch(url,{...(options.signal?{signal:options.signal}:{}),...(prepared===undefined?{}:{method:'POST',body:JSON.stringify(prepared)}),headers:{'Content-Type':'application/json',...((url.startsWith('/api/library')||url.startsWith('/api/account')||url.startsWith('/api/book-gifts')||url.startsWith('/api/billing'))?{'X-Reader-Owner':ticket.owner}:{})}}).catch(()=>{throw Object.assign(Error('网络暂时无法连接，请稍后重试。'),{retryable:true});});},()=>{ownerScope.adopt('guest');void adoptUiOwner(null);session={...session,user:null};clearPrivateUI();location.reload();});
};
const isLibrary=location.pathname==='/library';$('home-view').hidden=isLibrary;$('library-view').hidden=!isLibrary;document.body.classList.toggle('library-page',isLibrary);
const entryQuery=new URLSearchParams(location.search),entryReturn=authEntryReturn(entryQuery),returnToReader=safeGiftReturn(entryReturn)||safeReaderReturn(entryReturn)||safeMcpReturn(entryReturn);
let returnToLibrary=!returnToReader?safeLibraryReturn(entryReturn):null;
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
const returnAfterAuth=()=>{if(returnToReader&&!pendingUpload){location.replace(uiHref(returnToReader));return true;}if(!isLibrary){location.href=uiHref('/library');return true;}return false;};
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
if(isLibrary)document.title=t('portal.title.library');
const authDialog=mountAuthDialog({dialog:$('auth-dialog'),api,getSession:()=>session,getReturnTo:()=>authReturnTarget({pendingUpload,readerReturn:returnToReader,libraryReturn:returnToLibrary,current:currentLibraryReturn(),ui:getUiNavigationLocale()}),onSessionSettled:()=>refresh().catch(error=>status('library-status',{id:'ui.generic.error'},true)),onAuthenticated:async()=>{const returnToChat=pendingChat;pendingChat=false;if(returnAfterAuth())return;try{await refresh();adoptPendingReturn();status('library-status','');if(pendingUpload)openUpload();else if(returnToChat)chat?.open();}catch(error){status('library-status',{id:'portal.status.signedInFailed'},true);}}});
const openAuth=message=>authDialog.open(message&&typeof message.messageId==='string'?message:undefined);
$('auth-dialog').addEventListener('close',()=>{pendingChat=false;});
const ensureUser=()=>{if(session?.user)return true;openAuth();return false;};
const getOwner=()=>{const t=ownerScope.capture();return t.owner+':'+t.revision;};
window.marginaliaPaletteAdapter={getOwner:()=>session?.user?.id||null,getOwnerToken:()=>{const t=ownerScope.capture();return t.owner+':'+t.revision;}};
// GET-188 one authored-home navigation controller on the five authored home
// routes; the canonical library keeps its own shell. The palette handoff is the
// explicit document port into the one existing bootstrap instance.
if(isHomeNavRoute(location.pathname))homeMenu=mountHomeNavigation({document,getSession:()=>session,getBooks:()=>books,getOwner:()=>ownerScope.capture(),openAuth,openPalette:opener=>{document.dispatchEvent(new CustomEvent('palette:open',{detail:opener}));}});
dashboard=mountReadingDashboard({root:$('reading-dashboard'),overviewRoot:$('reading-overview'),historyRoot:$('reading-history'),api,getSession:()=>session,getBooks:()=>books,getOwner,openAuth,refresh,onCurrentBook:book=>{selectedCurrent=book?.bookId||null;renderBooks();},onOverlay:overlay=>openOverlayFor(overlay),onClose:kind=>closeOverlayFor(kind,'user')});
let taskStorage=null;try{taskStorage=localStorage;}catch{}
const bookUploads=createBookUploadController({api,getOwner:()=>session?.user?.id||null,getSession:()=>session,storage:taskStorage,onReady:()=>{void refresh().catch(()=>status('library-status',{id:'ui.generic.error'},true));}});
if(!isLibrary){const controls=$('library-filter-controls');controls.classList.add('home-shelf-filters');$('featured-books').before(controls);}
shelfControls=mountShelfFilters({root:$('library-filter-controls'),onOpenChange:open=>{if(!isLibrary)return;if(open)openOverlayFor({kind:'filter'});else closeOverlayFor('filter','dismiss');},onChange:action=>{shelfDrag?.reset();if(!viewHistory){renderBooks();return;}if(action.patch)viewHistory.setView(action.patch,{source:action.source||'user'});else if(action.clear)viewHistory.clearView(action.clear);else if(action.clearAll)viewHistory.clearAll();}});
if(isLibrary){chat=mountLibraryChat({root:$('library-chat'),api,uploadController:bookUploads,mountUpload:mountChatBookUpload,getSession:()=>session,getBooks:()=>books,getOwner:()=>ownerScope.capture().owner,openAuth:message=>{pendingChat=true;openAuth(message);},getCurrentBook:()=>dashboard.getCurrentBook(),positionLauncher:launcher=>{squirrelPosition=mountSquirrelPosition({launcher,labels:{ariaDescription:t('squirrel.drag.description'),title:t('squirrel.title')}});return squirrelPosition;}});shell=mountLibraryShell({getSession:()=>session,api,getBooks:()=>books,getCurrentBook:()=>dashboard.getCurrentBook(),inboxRoot:$('daily-reading-inbox'),onRestored:()=>refresh(),onProfileUpdated:(profile,userId)=>{if(session?.user?.id!==userId)return;Object.assign(session.user,profile);shell.update();},onPreferenceMemorySaved:adoptPreferenceMemory,onReadingPreferencesSaved:saved=>{if(session)session.readingPreferences=saved;void setupInvite?.refresh({changed:true,keys:['mode','preferredLanguage','theme']});},openAuth,onLogout:signOut,onHistory:()=>dashboard.openHistory(),onOpenChat:()=>chat.open(),onSettingsOpen:tab=>openOverlayFor({kind:'settings',tab}),onSettingsClose:()=>closeOverlayFor('settings','user'),onSettingsTab:tab=>{const current=viewHistory?.snapshot().overlay;if(current?.kind==='settings'&&current.tab!==tab)openOverlayFor({kind:'settings',tab});}});$('reading-setup-invite').hidden=true;setupInvite=mountPreferenceMemory({root:chat.surface().onboardingHost,kind:'onboarding',isReady:()=>bootstrapped,api,getSession:()=>session,getBooks:()=>books,open:()=>chat.open(),onSaved:adoptPreferenceMemory});$('library-chat').addEventListener('reading-preferences-changed',()=>{void setupInvite.refresh();});bookActions=mountLibraryBookActions({api,getSession:()=>session,getBooks:()=>libraryShelf(books),getOwner,getRevision:()=>shelfRevision,setRevision:value=>{shelfRevision=value;},onReorder:saveShelfOrder,onChanged:()=>refresh(),openAuth,onOverlay:overlay=>openOverlayFor(overlay),onClose:(kind,reason)=>{if(kind==='trash')closeOverlayFor('trash',reason);}});shelfDrag=mountShelfDrag({grid:$('library-books'),getBooks:()=>libraryShelf(books),getOwner,onReorder:saveShelfOrder,onError:error=>status('library-status',{id:'ui.generic.error'},true)});$('library-trash').addEventListener('click',()=>{shell.closeNavigation();bookActions.trash();});}else roomIcons();
if(isLibrary)viewHistory=createLibraryViewHistory({window,getUiLocale,onBeforeUiPopstate,onChange:(snapshot,meta)=>{
  shelfControls?.apply(snapshot.view);
  renderBooks();
  if(meta.source!=='hydrate')syncOverlay(snapshot.overlay);
}});
const shelfList=isLibrary?mountIncrementalShelf({grid:$('library-books'),controls:$('shelf-more'),renderItem:bookCard}):null;
// Legacy lifecycle name keeps the page's owner/reset seams on one controller.
pdfOnboarding={refresh:()=>bookUploads.refresh(),reset:()=>bookUploads.syncOwner()};
window.addEventListener('pagehide',event=>{if(!event.persisted)bookUploads.dispose();});
function clearPrivateUI({keepAuthDialog=false,preserveView=false}={}){
  // GET-188: the optional home resume row is removed synchronously at the
  // owner transition, before any slower reconciliation can repaint it.
  homeMenu?.clear(ownerScope.capture());
  // GET-178 owner boundary: every real account transition clears any open
  // command-palette cache and rendered private results synchronously.
  invalidatePaletteLibraries();
  if(!preserveView)viewHistory?.adoptOwner();
  bookActions?.clear();shelfDrag?.reset();shelfRevision=0;orderOperation=null;
  for(const id of ['upload-status','library-status','upload-filename'])status(id,'');
  for(const id of preserveView?['book-file']:['book-file','book-search'])$(id).value='';if(!keepAuthDialog){status('auth-status','');authDialog.reset();if($('auth-dialog').open)$('auth-dialog').close();}
  if($('upload-dialog').open)$('upload-dialog').close();$('upload-dialog').removeAttribute('aria-busy');$('confirm-upload').disabled=true;own($('confirm-upload'),{id:'portal.upload.save'});$('book-file').disabled=false;
  if($('reading-history').open)$('reading-history').close();pendingUpload=false;pendingChat=false;selectedCurrent=null;upload=createUploadState();pdfOnboarding?.reset();followedPdfId=null;if(!preserveView)shelfControls?.reset();document.querySelectorAll('[data-shelf]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shelf==='all')));
  books=books.filter(b=>b.visibility==='public').map(b=>({...b,resume:null,journey:null,translationLanguages:[],supportsParallel:false,translatedParagraphs:0,translationCoverage:'none'}));chat?.reset();shell?.update();setupInvite?.update();dashboard?.clear();renderBooks();
}
function landingBookCard(book){
  const cardLabel=(node,id,params,attrName=null)=>{const value=t(id,params);if(attrName)node.setAttribute(attrName,value);else{node.textContent=value;node.setAttribute('lang',getUiLocale());}node.setAttribute(attrName?'data-ui-aria':'data-ui-message',id);if(params)node.setAttribute('data-ui-message-params',JSON.stringify(params));if(typeof registerCardNode==='function')registerCardNode(node,{id,params,attr:attrName});return node;};
  const spaced=!isLibrary&&!/[\u3000-\u30ff\u3400-\u9fff]/.test(t('portal.card.start'));
  const title=spaced&&!isLibrary?(book.title.en||book.title.zh):book.title.zh;
  const card=make('article','book-card'),art=make('a','book-art '+(book.cover||'private'));art.href='/read?book='+encodeURIComponent(book.bookId);
  const cover=make('div','book-cover'),inner=make('div','cover-inner');inner.append(make('small','',book.visibility==='public'?'Leafhour':'MY READING ROOM'),make('strong','',isLibrary&&book.title.zh==='爱丽丝梦游仙境'?'爱丽丝\n梦游仙境':title.slice(0,64)),make('span','cover-ornament',book.cover==='alice'?'❦':book.cover==='walden'?'⌁':'☼'),make('small','',book.visibility==='public'?'ORIGINAL TEXT':'A BOOK OF MY OWN'));cover.append(inner);art.append(cover);
  const meta=make('div','book-meta'),label=make('div','book-label');label.append(cardLabel(make('span'),book.visibility==='public'?'portal.card.public':'portal.card.private',book.visibility==='public'?null:{format:String(book.source.format||'').toUpperCase()}),cardLabel(make('span'),book.chineseSample?'portal.card.sample':book.visibility==='public'?'portal.card.translate':'portal.card.extracted',book.chineseSample?{count:book.chineseSample.paragraphs}:null));
  meta.append(label,make('h3','',title),make('p','book-author',book.author||book.source.filename),book.description?make('p','book-description',book.description):cardLabel(make('p','book-description'),'books.descriptionFallback'));
  let resume=book.resume;if(!session?.user){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)resume={label:local.chapterLabel,passageId:local.passageId};}catch{}}
  const readerTarget=readingBookUrl(book,resume);art.href=readerTarget;typeof ownedHref==='function'&&ownedHref(art,readerTarget);
  if(resume){meta.append(make('p','book-resume',resume.label));}
  cardLabel(art,resume?'portal.card.continueAria':'portal.card.readAria',{title},'aria-label');
  const bottom=make('div','book-bottom'),read=cardLabel(make('a','book-read'),resume?'portal.card.continue':'portal.card.start');read.href=readerTarget;typeof ownedHref==='function'&&ownedHref(read,readerTarget);bottom.append(read);
  if(book.chineseSample){const sampleTarget=chineseTrialUrl(book);const trial=cardLabel(make('a','source-link'),'portal.card.sampleLink');trial.href=sampleTarget;typeof ownedHref==='function'&&ownedHref(trial,sampleTarget);meta.append(trial);}
  if(book.source.url){const source=cardLabel(make('a','source-link'),'portal.card.source');source.href=book.source.url;source.target='_blank';source.rel='noopener noreferrer';bottom.append(source);}else bottom.append(cardLabel(make('span'),'portal.card.paragraphs',{count:book.paragraphs}));
  meta.append(bottom);card.append(art,meta);return card;
}
function bookCard(book){
  const card=make('article','book-card'),art=make('a','book-art '+(book.cover||'private')),readerTarget=readingBookUrl(book);art.href=readerTarget;ownedHref(art,readerTarget);cardLabel(art,book.resume?'portal.card.continueAria':'portal.card.readAria',{title:book.title.zh},'aria-label');
  const cover=make('div','book-cover');paintBookCover(cover,book);art.append(cover);
  const meta=make('div','book-meta'),heading=make('h3'),title=make('a','book-title-link',book.title.zh),author=make('p','book-author',book.author||book.source?.filename||'');title.href=readerTarget;ownedHref(title,readerTarget);heading.append(title);author.title=author.textContent;meta.append(heading,author);
  const label=make('p','book-label');
  if(book.chineseSample){const sampleTarget=chineseTrialUrl(book);const trial=cardLabel(make('a','source-link'),'portal.card.sampleShort',{count:book.chineseSample.paragraphs});trial.href=sampleTarget;ownedHref(trial,sampleTarget);label.append(trial);}else cardLabel(label,book.visibility==='public'?'portal.card.public':'portal.card.private',book.visibility==='public'?null:{format:String(book.source?.format||'文本').toUpperCase()});meta.append(label);
  const bottom=make('div','book-bottom'),read=cardLabel(make('a','book-read'),book.resume?'portal.card.continue':'portal.card.start');read.href=readerTarget;ownedHref(read,readerTarget);
  bottom.append(read);meta.append(bottom);card.append(art,meta);bookActions?.decorate(card,book);
  const grip=make('button','book-drag-handle');grip.type='button';cardLabel(grip,'portal.drag.aria',{title:book.title.zh},'aria-label');cardLabel(grip,'portal.drag.hint',null,'data-drag-hint');grip.setAttribute('aria-describedby','shelf-order-help');const symbol=make('span');symbol.dataset.icon='grip-vertical';symbol.setAttribute('aria-hidden','true');grip.append(symbol);card.append(grip);mountCardLabels(card);grip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const ids=libraryShelf(books).map(b=>b.bookId),index=ids.indexOf(book.bookId),target=ids[index+(event.key==='ArrowLeft'?-1:1)];if(target)saveShelfOrder(moveShelfBook(ids,book.bookId,target,event.key==='ArrowLeft'?'before':'after')).catch(error=>status('library-status',{id:'ui.generic.error'},true));});grip.addEventListener('click',event=>{if(event.detail===0)card.querySelector('.book-action-trigger').click();});shelfDrag?.decorate(card);roomIcons(card);return card;
}
async function saveShelfOrder(ids){
  if(orderOperation)return;const owner=getOwner(),operation={owner},previousOrder=libraryShelf(books).map(book=>book.bookId),focused=document.activeElement,focusBook=focused?.closest('[data-book-id]')?.dataset.bookId,focusClass=focused?.classList.contains('book-drag-handle')?'book-drag-handle':focused?.classList.contains('book-action-trigger')?'book-action-trigger':null;orderOperation=operation;bookActions?.closeMenu();const rank=new Map(ids.map((id,index)=>[id,index]));books=books.map(b=>({...b,shelfPosition:rank.get(b.bookId)}));renderBooks();if(focusBook&&focusClass){const restored=[...document.querySelectorAll('[data-book-id]')].find(card=>card.dataset.bookId===focusBook);restored?.querySelector('.'+focusClass)?.focus({preventScroll:true});}status('library-status',{id:'portal.order.saving'});const focus=focusBook&&focusClass?trackActionFocus(document,document.activeElement):null;
  try{if(session?.user){const saved=await api('/api/library/order',{bookIds:ids,baseRevision:shelfRevision});if(owner!==getOwner())return;shelfRevision=saved.revision;}else{localStorage.setItem('marginalia-shelf-order:guest',JSON.stringify(ids));}if(owner===getOwner())status('library-status',{id:'portal.order.saved'});}
  catch(error){if(owner===getOwner()){try{await refresh();}catch{if(owner===getOwner()){const previousRank=new Map(previousOrder.map((id,index)=>[id,index]));books=books.map((book,index)=>({...book,shelfPosition:previousRank.get(book.bookId)??previousOrder.length+index}));renderBooks();}}if(owner===getOwner())status('library-status',{id:'portal.order.failed'},true);}}
  finally{if(orderOperation===operation)orderOperation=null;if(focus){if(owner===getOwner()){const card=[...document.querySelectorAll('[data-book-id]')].find(node=>node.dataset.bookId===focusBook);focus.restore(card?.querySelector('.'+focusClass));}else focus.stop();}}
}
function shelfEmptyHelpId({query='',language='all',form='all'}={}){
  if(query.trim())return 'portal.empty.filteredHelp';
  return language!=='all'||form!=='all'?'filter.languageEmptyHelp':'portal.empty.filteredHelp';
}
function renderHomeBooks(){
  const visible=books.filter(book=>book.visibility==='public');
  shelfControls?.update(visible);
  if(!bootstrapped&&!visible.length)return;
  const filters=shelfControls?.read()||{},matches=libraryShelf(visible,filters);
  $('search-clear').hidden=!filters.query;
  if(matches.length){$('featured-books').replaceChildren(...(hasShelfFilters(filters)?matches:matches.slice(0,3)).map(landingBookCard));return;}
  const empty=make('div','home-shelf-empty'),title=own(make('h3'),{id:'portal.empty.filtered'}),help=own(make('p'),{id:shelfEmptyHelpId(filters)}),clear=own(make('button','outline'),{id:'filter.clearAll'});
  clear.type='button';clear.addEventListener('click',()=>shelfControls.clearAll());empty.append(title,help,clear);$('featured-books').replaceChildren(empty);
}
function renderBooks(){
  if(!isLibrary){renderHomeBooks();return;}
  const filters=shelfControls?.read()||{query:$('book-search').value},query=filters.query.trim(),filtered=hasShelfFilters(filters),room=roomShelf(books,{...filters,selectedBookId:selectedCurrent});shelfControls?.update(books);
  const anchorId=document.activeElement?.closest('[data-book-id]')?.dataset.bookId;
  if(shelfList)shelfList.setItems(room.books,{key:JSON.stringify([getOwner(),filters]),anchorId});else $('library-books').replaceChildren();
  $('library-books').setAttribute('aria-busy','false');$('reading-dashboard').hidden=!room.featured&&!dashboard?.isLoading();$('shelf-title').hidden=!room.books.length;own($('shelf-title'),{render:()=>room.featured?t('portal.shelf.titleMore'):t('portal.shelf.title')});$('shelf-title').classList.toggle('sr-only',!room.featured);$('library-shelf').classList.toggle('with-current',!!room.featured);$('library-shelf').hidden=dashboard?.isLoading()||!!room.featured&&!room.books.length;
  const roomLoading=!!dashboard?.isLoading(),bookCount=books.length;
  const currentBook=dashboard?.getCurrentBook(),todayHeading=$('reading-dashboard').querySelector('.today-heading');if(currentBook&&todayHeading)bookActions?.decorate(todayHeading,currentBook);
  own($('room-title'),{render:()=>query?t('portal.room.search'):filters.scope==='private'?t('portal.room.private'):t('portal.room.library')});own($('room-count'),{render:()=>roomLoading?'':filtered?t('portal.count.filtered',{shown:num(room.total),total:num(bookCount)}):t('portal.count.books',{count:num(room.total)})});$('sidebar-book-count').textContent=num(books.length);$('search-clear').hidden=!query;
  $('empty-shelf').hidden=!!room.total;const signedIn=!!session?.user;own($('empty-shelf').querySelector('h2'),{render:()=>filtered?t('portal.empty.filtered'):t('portal.empty.none')});own($('empty-shelf').querySelector('p'),{render:()=>filtered?t(shelfEmptyHelpId(filters)):signedIn?t('portal.empty.uploadHelp'):t('portal.empty.signInHelp')});$('empty-upload').hidden=filtered;$('empty-clear').hidden=!filtered;own($('empty-clear'),{render:()=>query?t('portal.empty.clearSearch'):t('portal.empty.clearFilters')});
  chat?.update();
}
function adoptPreferenceMemory(view){
  if(!session?.user||view.revision<Math.max(session.preferenceMemory?.revision||0,session.readingPreferences?.revision||0))return;
  // Account defaults never rewrite the reader's explicit URL or shelf view.
  session.preferenceMemory=view;session.readingPreferences={revision:view.revision,updatedAt:view.updatedAt,preferences:view.preferences};
  setupInvite?.update();shell?.update();
}
async function refresh(knownSession){
  const generation=++refreshGeneration,arrivalTicket=isLibrary?dashboard.begin():null;
  // GET-188: every refresh generation clears the optional home resume rows
  // synchronously at its start; they return only after this generation's books
  // assignment and validated guest resume hydration, never from stale data.
  homeMenu?.clear(ownerScope.capture());
  try{
  const next=knownSession||await api('/api/auth/session');if(generation!==refreshGeneration)return;
  const firstIdentity=!identityResolved;identityResolved=true;
  const continueUpload=!session?.user&&next.user&&pendingUpload,continueChat=!session?.user&&next.user&&pendingChat,changed=ownerScope.adopt(next.user?.id||'guest');session=next;void adoptUiOwner(next.user?.id||null);
  // GET-188: identity rows follow the settled session immediately, independent
  // of the optional library request below.
  homeMenu?.updateIdentity(ownerScope.capture());
  if(changed){clearPrivateUI({keepAuthDialog:authDialog.isSettingPasswordFor(next.user?.id),preserveView:firstIdentity});pendingUpload=!!continueUpload;pendingChat=!!continueChat;}authDialog.updateCapabilities();shell?.update();
  own($('account-button'),{id:session?.user?'portal.account.library':'portal.account.signIn'});own($('library-description'),{id:session?.user?'portal.description.user':'portal.description.guest'});
  const library=await api('/api/library');if(generation!==refreshGeneration)return;books=library.books;shelfRevision=library.shelfRevision||0;
  if(!session.user){try{const order=JSON.parse(localStorage.getItem('marginalia-shelf-order:guest')||'null');if(Array.isArray(order)&&order.length<=1000){const rank=new Map(order.filter(id=>typeof id==='string').map((id,index)=>[id,index]));if(rank.size)books=books.map((book,index)=>({...book,shelfPosition:rank.get(book.bookId)??order.length+index}));}}catch{}}
  if(!session.user)for(const book of books){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)book.resume={label:local.chapterLabel,passageId:local.passageId,updatedAt:local.updatedAt,mode:local.mode,variant:local.variant};}catch{}}
  // GET-188: the menu rows render only after the current refresh generation,
  // books assignment and validated guest resume hydration, against the exact
  // captured owner revision.
  homeMenu?.update(ownerScope.capture());
  bootstrapped=true;setupInvite?.update();
  $('library-retry').hidden=true;status('library-status','');renderBooks();
  pdfOnboarding.refresh();if(isLibrary){dashboard.update(arrivalTicket);shell.refreshDaily();}
  bootstrapped=true;
  }catch(error){if(generation!==refreshGeneration)return;if(isLibrary){dashboard.fail(error,arrivalTicket);$('library-retry').hidden=false;$('library-books').setAttribute('aria-busy','false');}throw error;}
}
async function signOut(){
  const ticket=ownerScope.capture();await api('/api/auth/logout',{},ticket);session={...session,user:null};ownerScope.adopt('guest');void adoptUiOwner(null);clearPrivateUI();
  try{await refresh();}catch{status('library-status',{id:'portal.status.signedOut'},true);$('library-retry').hidden=false;}
}
$('account-button').addEventListener('click',()=>{if(!session?.user){openAuth();return;}if(isLibrary)shell.openSettings('account');else location.href=uiHref('/library');});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
document.addEventListener('click',event=>{for(const details of document.querySelectorAll('.book-details[open]'))if(!details.contains(event.target))details.open=false;});
function openUpload(){$('upload-dialog').classList.remove('pdf-saved');uploadTitleId='portal.upload.title';$('upload-title').textContent=t(uploadTitleId);shell?.closeNavigation();pendingUpload=true;if(!ensureUser())return;pendingUpload=false;if(!upload.file){$('book-file').value='';$('upload-filename').textContent='';status('upload-status','');own($('confirm-upload'),{id:'portal.upload.save'});}$('confirm-upload').disabled=upload.busy||!upload.file;$('upload-progress-slot').append($('pdf-ingestion-jobs'));pdfOnboarding.refresh();if(!$('upload-dialog').open){openOverlayFor({kind:'upload'});$('upload-dialog').showModal();}}
for(const id of ['upload-button','empty-upload'])$(id).addEventListener('click',openUpload);
function selectFile(file){
  if(!file)return;
  try{
    upload.select(file);
    if(!chat){location.href=uiHref('/library');return;}
    // Picking from the shelf and attaching in chat enter the same operation.
    const id=chat.upload(file);if(!id)return;
    upload.reset();$('book-file').value='';if($('upload-dialog').open)$('upload-dialog').close();chat.open();
  }catch{status('upload-status',{id:'portal.upload.invalid'},true);}
}
$('book-file').addEventListener('change',e=>selectFile(e.target.files[0]));
onUiLocaleChange(updateUploadProgressLabel);
const drop=$('drop-zone');drop.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('book-file').click();}});
$('upload-dialog').addEventListener('close',()=>closeOverlayFor('upload','user'));
for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});
for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');if(event==='drop')selectFile(e.dataTransfer.files[0]);});
$('confirm-upload').hidden=true;
$('confirm-upload').addEventListener('click',()=>selectFile(upload.file));
document.querySelectorAll('[data-shelf]').forEach(button=>{button.setAttribute('aria-label',button.dataset.shelf==='all'?t('portal.room.library'):t('portal.room.private'));button.addEventListener('click',()=>shelfControls?.set({scope:button.dataset.shelf}));});
$('book-search').addEventListener('input',()=>{shelfDrag?.reset();viewHistory?.setQuery($('book-search').value);renderBooks();});
// Unfinished IME text never reaches the URL: composition suspends the search
// commit and only the final composed query is scheduled.
$('book-search').addEventListener('compositionstart',()=>viewHistory?.compositionStart());
$('book-search').addEventListener('compositionend',()=>{if(viewHistory)viewHistory.compositionEnd($('book-search').value);renderBooks();});
$('search-clear').addEventListener('click',()=>{$('book-search').value='';shelfDrag?.reset();viewHistory?.setQuery('');renderBooks();$('book-search').focus();});
$('empty-clear').addEventListener('click',()=>{if(viewHistory)viewHistory.clearAll();else shelfControls?.reset();shelfDrag?.reset();renderBooks();$('book-search').focus();});
$('library-retry').addEventListener('click',async event=>{const focus=trackActionFocus(document,event.currentTarget);status('library-status',{id:'portal.retry.opening'});try{await refresh();}catch(error){status('library-status',{id:'ui.generic.error'},true);}finally{focus.restore($('library-retry').hidden?$('main'):$('library-retry'));}});
if(isLibrary)viewHistory.hydrate();
refresh().then(()=>{
  // One bounded session-ready reconciliation from the CURRENT snapshot, so a
  // stale hydrate target can never resurrect an overlay the user replaced.
  if(isLibrary){const overlay=viewHistory?.takeSessionOverlay();if(overlay)syncOverlay(overlay);}
  if(isLibrary&&pendingSettings){pendingSettings=false;shell.openSettings('account');}
  if(isLibrary&&entryQuery.get('login')==='1'){if(session?.user){if(!returnAfterAuth())adoptPendingReturn();}else if(!session?.user){const messages={cancelled:{messageId:'auth.return.cancelled'},expired:{messageId:'auth.return.expired'},unavailable:{messageId:'auth.return.unavailable'}};openAuth(messages[entryQuery.get('auth_error')]);}}}).catch(error=>{status('library-status',{id:'ui.generic.error'},true);$('featured-books').replaceChildren(own(make('p','muted'),{id:'portal.books.failed'}));});

function updatePortalLabels(){
  // Language commits relabel owned nodes in place only: no refresh(), no
  // renderBooks(), no identity/book reads, no owner adoption, no upload start
  // and no input value changes.
  for(const [n,spec] of chromeLabels){if(n.isConnected===false){chromeLabels.delete(n);continue;}applySpec(n,spec);}
  for(const [n,spec] of cardLabels){if(n.isConnected===false){cardLabels.delete(n);continue;}applySpec(n,spec);}
  for(const link of [...ownedLinks]){if(link.isConnected===false){ownedLinks.delete(link);continue;}link.href=uiHref(link.getAttribute('data-ui-owned-href')||'');}
  if(isLibrary)document.title=t('portal.title.library');
  for(const [id,key] of [['library-retry','portal.retry.open'],['empty-upload','portal.empty.bringFirst']])$(id).textContent=t(key);
  $('shelf-order-help').textContent=t('portal.drag.help');
  $('upload-title').textContent=t(uploadTitleId);
  $('upload-intro').textContent=t('portal.upload.intro');
  $('upload-drop-label').textContent=t('portal.upload.drop');
  $('upload-limits').textContent=t('portal.upload.limits');
  $('upload-explanation').textContent=t('portal.upload.explanation');
  $('drop-zone').setAttribute('aria-label',t('portal.upload.choose'));
  $('upload-dialog').querySelector('.dialog-close')?.setAttribute('aria-label',t('portal.upload.close'));
  for(const [id,key] of [['sidebar-search-open','palette.title'],['library-calendar','nav.calendar'],['library-chat-open','nav.chat'],['upload-button','nav.bring'],['library-trash','nav.trash'],['library-settings','shell.settings.title']]){
    const button=$(id),label=button?.querySelector?.('.sidebar-label');if(!button)continue;
    if(label)label.textContent=t(key);button.setAttribute('aria-label',t(key));button.dataset.hint=t(key);
  }
  $('library-menu')?.setAttribute('aria-label',t('nav.roomMenu'));
  $('daily-reading-inbox')?.setAttribute('aria-label',t('nav.dailyNotes'));
  $('library-shelf')?.setAttribute('aria-label',t('portal.shelf.title'));
  $('reading-overview')?.setAttribute('aria-label',t('dash.entry.other'));
  $('reading-history')?.setAttribute('aria-label',t('nav.calendar'));
  $('library-nav-dialog')?.setAttribute('aria-label',t('nav.roomMenu'));
  for(const button of document.querySelectorAll('[data-shelf]')){
    const value=t(button.dataset.shelf==='all'?'portal.room.library':'portal.room.private');
    const label=button.querySelector('.sidebar-label');if(label)label.textContent=value;
    button.setAttribute('aria-label',value);button.dataset.hint=value;
  }
  document.querySelector('.shelf-tabs')?.setAttribute('aria-label',t('portal.shelf.filters'));
  $('library-filter-controls')?.setAttribute('aria-label',t('filter.bookshelf'));
  if(isLibrary)for(const brand of document.querySelectorAll('a.brand')){
    brand.setAttribute('href',uiAuthoredPath('/',getUiLocale()));
    brand.setAttribute('aria-label',t('portal.brand.home'));
  }
  squirrelPosition?.updateLabels({ariaDescription:t('squirrel.drag.description'),title:t('squirrel.title')});
  shell?.updateLabels?.();
  updateUploadProgressLabel();
}
onUiLocaleChange(updatePortalLabels);void uiReady.then(updatePortalLabels);
const checkOwner=async()=>{if(document.hidden||authDialog.hasPendingSessionChange())return;try{const current=await api('/api/auth/session');if(authDialog.hasPendingSessionChange())return;if((current.user?.id||'guest')!==(session?.user?.id||'guest'))await refresh(current);else void adoptUiOwner(current.user?.id||null);}catch{}};
window.addEventListener('focus',checkOwner);window.addEventListener('pageshow',checkOwner);document.addEventListener('visibilitychange',checkOwner);
