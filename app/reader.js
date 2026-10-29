import {prepareReaderStyles} from './reader-style-ready.mjs';
import {readingChatExcerptIsVisible} from './reading-chat-quote.mjs';
import {mountReaderPresence} from './reader-presence.mjs';
import {createReadingBook,createReadingNavigation} from './reading-book.mjs';
import {appearanceDefaults,appearanceBounds,normalizeAppearance,openingReadingPreferences,preferredReadingMode} from './reading-preferences.mjs';
import {captureDOMSelection,paragraphSnapshot} from './share-model.mjs';
import {placeFloatingToolbar,placeFloatingMenu} from './toolbar-placement.mjs';
import {readerFetch,readerStorageKey,selectedBookId,readerSession,readerObservability,readerOffline} from './reader-api.mjs';
import {chooseReadingPosition,resolveReadingPosition,resumeSummary,acknowledgePosition,recoveredPositionNeedsChoice} from './reading-progress.mjs';
import {offlinePositionChoice,createOfflinePositionRecovery,resolveReaderOpening} from './offline-position.mjs';
import {createProgressSync} from './progress-sync.mjs';
import {chineseOriginalOnly} from './source-language.mjs';
import {captureParagraphAnchor,paragraphScrollDelta} from './paragraph-anchor.mjs';
import {createNoteDrafts} from './note-drafts.mjs';
import {createReadingDraftStore} from './reading-draft-store.mjs';
import {readerLoginUrl} from './reader-return.mjs';
import {passagePresentation,visibleQuoteLanguage,applySourceLineation,quotePanelSourceNodes} from './passage-layers.mjs';
import {sourceEmphasisEligible} from './source-emphasis.mjs';
import {createChapterFlow,isReadingDivider} from './reading-flow.mjs';
import {startReadingLoad,mergeLoadedReadingRecords} from './reading-load.mjs';
import {formatNoteSaveReceipt as noteSaveReceipt,positionSaveState,formatDraftSaveReceipt as draftSaveReceipt} from './save-receipts.mjs';
import {mountReaderLoading} from './reader-loading.mjs';
import {applySourceFormat,sourceResourcesNode,loadSourceStyles} from './source-resources.mjs';
import {mountBookIntroduction,mountChapterEntry,mountContentsDialog} from './reader-navigation.mjs';
import {mountReaderBookActionsBootstrap} from './reader-book-actions-bootstrap.mjs';
import {mountParallelSettings,applyParallelAppearance,createParallelPair} from './parallel-reading.mjs';
import {mountReaderPagination} from './reader-pagination.mjs';
import {mountReaderImmersion} from './reader-immersion.mjs';
import {mountReaderTools} from './reader-tools.mjs';
import {mountReaderConversation,readerInteractionBlocked} from './reader-conversation.mjs';
import {mountReaderSettings,mountReadingDefaults} from './reader-settings.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {createPersonalRecordRenderer} from './personal-record-editor.mjs';
import {personalRecordRevision} from './personal-records.mjs';
import {activeHighlights,highlightKey} from './highlights.mjs';
import {mountReaderHighlights,textRange} from './reader-highlights.mjs';
import {getUiLinkLocale,t,uiReady,bindUi,onUiLocaleChange,uiHref,getUiLocaleState,setUiLocale,retryUiLocale,onUiLocaleStateChange,createUiLabels} from './ui-locale.mjs';
import {mountNativeUiLocaleControl} from './ui-locale-controls.mjs';
await prepareReaderStyles(document);
await uiReady;

const READER_UI='reader.b1.',READER_SHELL='reader.shell.';
const readerOwner=()=>readerSession?.user?.id||readerSession?.offlineOwner||null;

const listenerDisposers=[];
function listen(target,event,handler,options){const owned=e=>{if(!readerDisposed)return handler(e);};target.addEventListener(event,owned,options);listenerDisposers.push(()=>target.removeEventListener(event,owned,options));}
// Replaced views retain handlers only through their own nodes, allowing their
// DOM/closures to be collected instead of retaining them in the page registry.
function listenNode(target,event,handler){target.addEventListener(event,e=>{if(!readerDisposed&&target.isConnected!==false)return handler(e);});}
const ownerSubscribers=new Set();

const $=id=>document.getElementById(id);
let readerOpening=null;
const reportReadingResume=(position,options={})=>{readerOpening={position,...options};dispatchReaderEvent('reader:resume');};
// Keep the same synchronous, non-bubbling reader events without duplicating their constructor at every layout/record seam.
const dispatchReaderEvent=(name,detail)=>document.dispatchEvent(new CustomEvent(name,{detail}));
function afterReaderPaint(callback){window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{if(window.requestIdleCallback)window.requestIdleCallback(callback,{timeout:2000});else setTimeout(callback,0);}));}
let observabilityStarted=false;
const observeReader=()=>{if(observabilityStarted)return;observabilityStarted=true;afterReaderPaint(()=>{if(readerDisposed)return;const operation=readerObservability.operationId;void import('./observability-bridge.mjs').then(module=>{if(!readerDisposed&&readerObservability.operationId===operation)module.mountReaderObservability({facade:readerObservability,operationId:operation,getOwner:readerOwner,document,window,getRoot:()=>$('chapter-text'),getViewport:()=>pagination.active?$('reading-pages'):null,isPaginated:()=>pagination.active,getStatus:()=>readerOpening,isInteracted:()=>entryInteracted});}).catch(()=>{});});};
listen(document,'reader:ready',observeReader);listen(document,'reader:failed',observeReader);
const ownedLabels=createUiLabels(),ownedLoginLinks=new Map();
const loginLink=(node,params)=>{for(const [old]of ownedLoginLinks)if(old.isConnected===false)ownedLoginLinks.delete(old);ownedLoginLinks.set(node,params);return node.href=readerLoginUrl({...params,ui:getUiLinkLocale()});};
let readerDisposed=false,readerEpoch=0,excerptTimer;
// Per-mount slots retain only owned chrome and semantic parameters. Detached
// dynamic views are pruned, never walked or rebuilt on a locale commit.
function pruneLabels(){ownedLabels.prune();}
function label(node,id,params,attribute){if(node.tagName==='OPTION'&&!attribute)node.setAttribute('data-ui',id);if(attribute)ownedLabels.attr(node,attribute,id,params);else ownedLabels.text(node,id,params);return node;}
function refreshLabels(){ownedLabels.refresh({pruneDetached:true});}
const unbindShell=bindUi(document.body);
label($('chapter-text'),READER_SHELL+'bookText',null,'aria-label');
let syncLocaleChoice=()=>{};
const localeControls=mountNativeUiLocaleControl({root:$('reader-ui-language'),getState:getUiLocaleState,setLocale:setUiLocale,retry:retryUiLocale,subscribeState:onUiLocaleStateChange,labels:t,onState:()=>syncLocaleChoice()});
listen(document,'reader:ready',()=>readerOffline.mount({document,getBook:()=>book,t,subscribe:onUiLocaleChange}));
const offLocale=onUiLocaleChange(()=>{refreshLabels();for(const [link,params]of ownedLoginLinks){if(link.isConnected===false)ownedLoginLinks.delete(link);else link.href=readerLoginUrl({...params,ui:getUiLinkLocale()});}for(const link of document.querySelectorAll('[data-reader-ui-link]'))link.href=uiHref(link.dataset.readerUiLink);});
for(const link of document.querySelectorAll('a[href="/library"],a[href="/library?calendar=1"],[data-reader-ui-link]')){link.dataset.readerUiLink??=link.getAttribute('href');link.href=uiHref(link.dataset.readerUiLink);}
const receiptFor=node=>(id,params)=>{label(node,id,params);return t(id,params);};
const arrival=mountReaderLoading($('loading'));
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const fixed=(tag,cls,id,params)=>label(el(tag,cls),id,params);
const button=(text,action)=>{const b=el('button','',text);b.type='button';if(action)listenNode(b,'click',action);return b;};
const announce=text=>{ownedLabels.forget($('announcement'));$('announcement').textContent=text;};
const announceUi=(id,params)=>label($('announcement'),id,params);
let readingBook,readingNavigation;
let book,readerPresenceReady=false,records,recordsUnavailable=false,paragraphs=[],paragraphMap=new Map(),notesMap=new Map(),termsMap=new Map(),selectedId=null,selectedQuote='',selectedQuoteLanguage='zh',selectedExcerpt=null,selectionKind='passage',panelTab='annotations',allRecords=false,persistTimer=null,overrides={};
let recordsRetryBusy=false,recordsRetryNotice='',recordsPositionUnresolved=false,recordsPending=false,loadGeneration=0,entryInteracted=false,flow=null,flowIdle=null,flowFrame=false,deferredProgress=false;
let continuous=true;try{continuous=localStorage.getItem(readerStorageKey('marginalia-continuous-v1'))!=='false';}catch{}
$('continuous-reading').checked=continuous;document.body.dataset.continuous=String(continuous);
const state={chapterId:'ch01',...openingReadingPreferences()};
const revealedTranslations=new Set();
const pagination=mountReaderPagination({document,isBlocked:target=>readerInteractionBlocked(document,target)||!$('note-panel').hidden,hasBoundary:direction=>!!book&&!!book.chapters[book.chapters.findIndex(c=>c.id===state.chapterId)+direction],onTurn:source=>{dismissTools();persist();dispatchReaderEvent('reader:page',source);},onBoundary:(direction,source)=>{const chapter=book?.chapters[book.chapters.findIndex(c=>c.id===state.chapterId)+direction];if(!chapter)return false;changeChapter(chapter.id).then(changed=>{if(changed){if(direction<0)pagination.last();dispatchReaderEvent('reader:page',source);persist();}});return true;}});
const settingsUI=mountReaderSettings({document});
syncLocaleChoice=()=>settingsUI.choices['reader-ui-choice']?.sync();
let readerToolsHandle=null;
const immersion=mountReaderImmersion({document,announce,beforeLayout:()=>anchor(),afterLayout:a=>{restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();dispatchReaderEvent('reader:layout');},onToolsLayout:()=>{if(!$('paragraph-tools').hidden)positionTools();},focusReturn:()=>readerToolsHandle?.toolFocusTarget,onToolsCloseRequest:target=>readerToolsHandle?.closeRequest?.(target)});
const readerTools=readerToolsHandle=mountReaderTools({sessionRoot:$('reading-session'),immersion,document});
void import('./reader-location.mjs').then(m=>!readerDisposed&&m.mountReaderLocation({document,tools:readerTools})).catch(()=>{});
// GET-178 page adapter: reader appearance actions run through the existing
// appearance API so paragraph position and progress stay preserved.
window.marginaliaPaletteAdapter={getOwner:readerOwner,appearance:{setTheme:theme=>adjustAppearance({theme}),adjustFont:d=>adjustAppearance({font:state.font+d})},fullscreen:immersion.toggleFullscreen,
  prepareOverlay:readerTools.prepareOverlay,getOverlayRevision:readerTools.getOverlayRevision,
  subscribe:fn=>{if(readerDisposed)return ()=>{};ownerSubscribers.add(fn);return ()=>ownerSubscribers.delete(fn);}};
const draftKey=readerStorageKey('marginalia-focus-drafts-v2');let savedDrafts=null,legacyDrafts={};try{savedDrafts=JSON.parse(localStorage.getItem(draftKey)||'null');legacyDrafts=JSON.parse(localStorage.getItem(readerStorageKey('marginalia-focus-drafts-v1'))||'{}');}catch{}
let noteDrafts=createNoteDrafts(savedDrafts,legacyDrafts),noteDraftError=null;
const persistDrafts=()=>{try{if(noteDraftError)return false;if(noteDrafts.persist)noteDrafts.persist();else localStorage.setItem(draftKey,JSON.stringify(noteDrafts.snapshot()));dispatchReaderEvent('reader:drafts-updated');return true;}catch{return false;}};
const api=async(url,data,options={})=>{const response=await readerFetch(url,{...options,...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||t(READER_UI+'unknownError')),{status:response.status});return body;};
const dailyPresence=mountReaderPresence({api,getUserId:readerOwner,enabled:()=>readerPresenceReady&&!!selectedBookId&&!readerOffline.isOffline()});
const settingsDefaults=mountReadingDefaults({document,api,getState:()=>state,getSession:()=>readerSession,onSaved:saved=>{if(readerSession)readerSession.readingPreferences=saved;},onAnnounce:text=>announce(text)});
const personalRecordsUI=createPersonalRecordRenderer({document,getBook:()=>book,scope:readerStorageKey('marginalia-record-edit-drafts-v1'),api,onUpdate:(record,type)=>{const key=type==='question'?'questions':'comments',index=records[key].findIndex(row=>row.id===record.id);if(index>=0&&personalRecordRevision(record)>=personalRecordRevision(records[key][index]))records[key][index]=record;dispatchReaderEvent('reader:records-updated');},onJump:async(record,type,anchor)=>{closePanel();if(await changeChapter(anchor.chapterId,record.passageId)){choosePassage(record.passageId);openPanel(type);}}});
const highlights=mountReaderHighlights({document,getSession:()=>readerSession,getRecords:()=>records,signedIn:()=>!selectedBookId||!!readerOwner(),available:()=>!recordsUnavailable,selectionMatches:snapshot=>{try{const native=captureDOMSelection(getSelection(),paragraphMap,book);return !!native&&highlightKey(native)===highlightKey(snapshot);}catch{return false;}},api,onSelect:selectHighlight,onNote:()=>openPanel('comment'),onChange:()=>{flow?.invalidatePrepared();if(!$('note-panel').hidden)renderPanel();dispatchReaderEvent('reader:records-updated');},announce,loginUrl:link=>link?loginLink(link,{bookId:selectedBookId,passageId:selectedId}):readerLoginUrl({ui:getUiLinkLocale(),bookId:selectedBookId,passageId:selectedId})});
const progressKey=readerStorageKey('marginalia-focus-position-v1'),localWriterId=crypto.randomUUID();let progressSequence=0,restoringProgress=true,allowScrollSave=false;
let positionStorage=null;try{positionStorage=localStorage;}catch{}
const positionRecovery=createOfflinePositionRecovery({storage:positionStorage,key:progressKey,bookId:selectedBookId});
let latestPositionAttempt=null,latestPositionDurable=false,confirmedPosition=null;
const positionChanged=()=>dispatchReaderEvent('reader:position-status');
const cachePosition=(position,{track=true}={})=>{const durable=positionRecovery.write(position,{protectPending:recordsPositionUnresolved});if(track){latestPositionAttempt=position;latestPositionDurable=durable;}positionChanged();refreshPositionRecovery();return durable;};
function refreshPositionRecovery(){positionRecovery.refreshBackup({document,createButton:()=>button(''),label:node=>label(node,READER_SHELL+'backupPending'),onFailure:()=>announceUi('reader.session.backupFailed')});}
function preparePositionOpening(local,remote,remoteAvailable){
 const choice=offlinePositionChoice({book,local,remote,remoteAvailable});
 if(!choice)return {local,remoteAvailable};
 positionRecovery.retain(choice);recordsPositionUnresolved=true;clearTimeout(persistTimer);$('progress-notice').hidden=false;announceUi(READER_UI+(choice.unmapped?'savedSourceFailed':'progressConflict'));refreshPositionRecovery();
 return {local,remoteAvailable:choice.position?false:remoteAvailable};
}
function prepareOfflineFallback(opening,local,remote){
 if(!opening.offlineFallback)return;
 if(local)positionRecovery.retain({bookId:book.bookId,local,remote});
 recordsPositionUnresolved=true;deferredProgress=false;clearTimeout(persistTimer);$('progress-notice').hidden=true;
 for(const id of ['progress-use-remote','progress-keep-here'])$(id).disabled=true;
 announceUi('offline.chapterMissing');refreshPositionRecovery();
}
listen(document,'reader:ready',refreshPositionRecovery);
const progressSync=createProgressSync({
  send:({localSequence,localWriterId,...position})=>api('/api/progress',position),
  beforeSend:position=>{if(position.localSequence===progressSequence)cachePosition({...position,pending:true});},
  onSaved:(saved,submitted)=>{confirmedPosition={...submitted,...saved};try{const cached=JSON.parse(localStorage.getItem(progressKey)||'null'),next=acknowledgePosition(cached,saved,submitted);if(next){const durable=cachePosition({...next,chapterLabel:resumeSummary(book,next)?.label},{track:false});if(latestPositionAttempt?.localWriterId===submitted.localWriterId&&latestPositionAttempt?.localSequence===submitted.localSequence)latestPositionDurable=durable;}}catch{}positionChanged();},
  onConflict:()=>{$('progress-notice').hidden=false;announceUi(READER_UI+'progressConflict');positionChanged();},
  onFailure:error=>{announceUi(latestPositionDurable?READER_UI+'progressLocal':READER_UI+'progressMemory');positionChanged();}
});
const currentChapter=()=>book.chapters.find(c=>c.id===state.chapterId);
const activeSections=()=>book.sections.filter(s=>s.chapterId===state.chapterId);
const chapterDescriptor=chapter=>({id:book.source?.structure==='automatic_groups'?READER_UI+'fragment':'navigation.chapter',params:{number:chapter.number}});
const chapterLabel=chapter=>chapter.kind&&chapter.kind!=='body'?chapter.title.zh:t(chapterDescriptor(chapter).id,chapterDescriptor(chapter).params);
const chapterChrome=(node,chapter)=>{if(chapter.kind&&chapter.kind!=='body'){ownedLabels.forget(node);node.textContent=chapter.title.zh;return node;}const d=chapterDescriptor(chapter);return label(node,d.id,d.params);};
const contents=mountContentsDialog({document,getBook:()=>book,getChapterId:()=>state.chapterId,onNavigate:changeChapter,onBeforeOpen:dismissTools});
const chapterEntry=mountChapterEntry({document,getBook:()=>book,getChapter:()=>book&&currentChapter(),onOpen:openContents});
// GET-173: the bookplate's one shared popover handle is injected into the
// real user-open lazy enhancement; the optional AI introduction and gifting
// code loads only when the reader actually opens book-info.
const bookInfo=mountBookIntroduction({document,getBook:()=>book,getChapter:()=>book&&currentChapter(),onOpen:dismissTools});
let accountSurface,accountLoad,accountRetry;
listen($('open-reader-account'),'click',async()=>{
  const trigger=$('open-reader-account');
  if(accountLoad)return;
  if(accountSurface){bookInfo.close({focus:false});accountSurface.open();return;}
  bookInfo.close({focus:false});const active=document.activeElement;
  trigger.setAttribute('aria-busy','true');
  try{
    accountLoad=accountRetry?import('./reader-account.mjs?retry=1'):import('./reader-account.mjs');const {mountReaderAccount}=await accountLoad;
    if(readerDisposed||document.activeElement!==active||trigger.closest('[inert]')||document.querySelector('dialog[open],[popover][data-popover-open]'))return;
    accountSurface=mountReaderAccount({document,trigger,session:readerSession,request:readerFetch,loginHref:()=>readerLoginUrl({bookId:selectedBookId,passageId:anchor()?.passageId,ui:getUiLinkLocale()})});
    accountSurface.open();
  }catch{accountRetry=true;if(!readerDisposed)announceUi('ui.generic.error');}
  finally{accountLoad=null;trigger.removeAttribute('aria-busy');}
});
const bookActions=mountReaderBookActionsBootstrap({document,info:bookInfo,getBook:()=>book,getReader:()=>window.marginaliaReader,api,session:readerSession,bookId:selectedBookId,getOwner:()=>readerOwner()||'guest'});
function anchor(){
  if(pagination.active)return pagination.anchor();
  const threshold=document.body.classList.contains('is-focused')?24:80;
  const node=[...$('chapter-text').querySelectorAll('.passage')].find(n=>n.getBoundingClientRect().bottom>threshold);
  return node?{passageId:node.dataset.id,...captureParagraphAnchor(node.getBoundingClientRect(),threshold)}:null;
}
function restoreAnchor(a){
  if(pagination.active){pagination.restore(a);return;}
  if(!a)return;const node=$('chapter-text').querySelector('[data-id="'+a.passageId+'"]'),threshold=document.body.classList.contains('is-focused')?24:80;if(!node)return;
  // Make room below an end-of-chapter anchor before the browser clamps scrolling.
  while(continuous&&flow?.nextId&&scrollY+paragraphScrollDelta(node.getBoundingClientRect(),a,threshold)>document.documentElement.scrollHeight-innerHeight+.5){if(!insertFollowingChapter())break;}
  window.scrollBy(0,paragraphScrollDelta(node.getBoundingClientRect(),a,threshold));
}
function captureProgress(){
  if(!book||restoringProgress)return null;const a=anchor();if(!a)return null;
  return {...state,...a,chapterId:paragraphMap.get(a.passageId)?.chapterId||state.chapterId,contentVersion:book.contentVersion,baseRevision:progressSync.revision,localWriterId,localSequence:++progressSequence,chapterLabel:resumeSummary(book,{...state,...a})?.label};
}
function persist(){
  if(book?.reading?.offlineFallback)return;
  const position=captureProgress();if(!position)return;
  cachePosition({...position,pending:!!readerOwner()||!selectedBookId});
  clearTimeout(persistTimer);if(recordsUnavailable||recordsPositionUnresolved){deferredProgress=true;return;}deferredProgress=false;persistTimer=setTimeout(()=>progressSync.save(position).catch(()=>{}),450);
}
const typographyFields=[['lineHeight',''],['paragraphGap','px'],['letterSpacing','em'],['wordSpacing','em'],['fontWeight','']];
// Resolve per-book choices through the same self-hosted families as the page.
// Keep the explicit sans choice; serif/Kai retain their CJK fallback glyphs.
const fonts={song:'var(--font-serif)',kai:'var(--font-hand)',sans:'var(--interface)'};
const prettyValue=(key,value)=>['letterSpacing','wordSpacing'].includes(key)?value.toFixed(2):key==='lineHeight'?Number(value.toFixed(2)).toString():String(value);
function applyAppearance(){
  const night=state.theme==='night'||(state.theme==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.dataset.theme=state.theme==='system'?(night?'night':'paper'):state.theme;
  const page=$('book-page');page.style.setProperty('--size',state.font+'px');page.style.setProperty('--book',fonts[state.fontFamily]);page.style.setProperty('--english',state.fontFamily==='sans'?'var(--interface)':'var(--font-latin)');
  for(const [key,property,unit] of [['lineHeight','--reading-line',''],['paragraphGap','--paragraph-gap','px'],['letterSpacing','--reading-tracking','em'],['wordSpacing','--word-spacing','em'],['fontWeight','--reading-weight','']])page.style.setProperty(property,state[key]+unit);
  page.style.setProperty('--reading-indent',state.indent?'2em':'0');document.body.dataset.mode=state.mode;
  $('reading-purpose').value=state.readingPurpose;$('preferred-language').value=state.preferredLanguage;
  $('view-mode').value=state.mode;$('translation-variant').value=state.variant;$('translation-variant').disabled=state.mode==='en';$('font-size').value=state.font;$('font-size-label').value=String(state.font);
  for(const b of document.querySelectorAll('[data-theme-choice]')){const active=b.dataset.themeChoice===state.theme;b.setAttribute('aria-pressed',String(active));if(active)label($('theme-label'),b.getAttribute('data-ui-aria-label'));}
  for(const b of document.querySelectorAll('[data-font-family]'))b.setAttribute('aria-pressed',String(b.dataset.fontFamily===state.fontFamily));
  for(const [key] of typographyFields){$('setting-'+key).value=prettyValue(key,state[key]);for(const b of document.querySelectorAll('[data-adjust="'+key+'"]'))b.disabled=Number(b.dataset.direction)<0?state[key]<=appearanceBounds[key][0]:state[key]>=appearanceBounds[key][1];}
  $('first-line-indent').checked=state.indent;
  applyParallelAppearance(document,state);
  pagination.update(state);settingsUI.update(state);settingsUI.sync();
}
function adjustAppearance(patch){
  const a=anchor();Object.assign(state,normalizeAppearance({...state,...patch}));dispatchReaderEvent('reader:jump');applyAppearance();restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();persist();dispatchReaderEvent('reader:layout');
}
for(const [key,unit] of typographyFields){
  const row=el('div','setting-row typography-row'),name=fixed('span','',READER_UI+'type.'+key),controls=el('div','type-stepper');name.id='label-'+key;
  const minus=button('−',()=>step(-1)),plus=button('+',()=>step(1)),value=el('output');value.id='setting-'+key;value.setAttribute('aria-labelledby',name.id);value.title=unit;
  function step(direction){const [min,max,increment]=appearanceBounds[key];adjustAppearance({[key]:Math.max(min,Math.min(max,Number((state[key]+direction*increment).toFixed(2))))});}
  for(const [b,direction] of [[minus,-1],[plus,1]]){b.dataset.adjust=key;b.dataset.direction=direction;label(b,READER_UI+'type.'+key+(direction<0?'.decrease':'.increase'),null,'aria-label');}
  controls.append(minus,value,plus);row.append(name,controls);$('typography-controls').append(row);
}
function passageView(p){return {mode:overrides[p.id]?.mode||(state.mode==='en'?'en':'zh'),variant:overrides[p.id]?.variant||state.variant};}
function prose(layer,variant){const n=el('p',layer.fallback?'untranslated-original':'',layer.text);if(layer.kind==='original')applySourceLineation(n,layer.lineBreaks,document,layer.emphasis);n.lang=layer.lang;n.dataset.readingLayer=layer.kind;n.dataset.variant=variant;return applySourceFormat(n,layer);}
function fillPassage(node,p){
  if(node.contains($('note-panel')))document.body.append($('note-panel'));
  node.replaceChildren();const v=passageView(p),view=passagePresentation(p,{...v,mode:state.mode==='parallel'?'parallel':v.mode,sourceLanguage:book.sourceLanguage,sourceEmphasis:sourceEmphasisEligible(book)});
  if(state.mode==='parallel'){
    node.append(createParallelPair({document,layers:view.layers,variant:v.variant,prose,passageId:p.id,revealed:revealedTranslations,onReveal:change=>{const a=anchor();change();restoreAnchor(a);dispatchReaderEvent('reader:layout');}}));
  }else node.append(prose(view.layers[0],v.variant));
  const resources=sourceResourcesNode(document,p.source?.resources,globalThis.location?.href);if(resources)node.append(resources);
  if(p.source?.labelBefore)node.prepend(el('span','source-passage-label',p.source.labelBefore));
  for(const text of node.querySelectorAll('p[data-reading-layer]'))highlights.paint(text,p.id);
}
function buildChapter(chapter){
  const wrapper=el('section','flow-chapter');wrapper.dataset.chapterId=chapter.id;label(wrapper,READER_UI+'chapterName',{chapter:chapter.kind&&chapter.kind!=='body'?'':chapter.number,title:chapter.title.zh},'aria-label');
  const heading=el('header','flow-heading');heading.append(chapterChrome(el('p','chapter-number'),chapter),el(chapter.id===state.chapterId?'h1':'h2','',chapter.title.zh));wrapper.append(heading);
  for(const s of book.sections.filter(s=>s.chapterId===chapter.id)){
    const section=el('section','reading-section');section.id='section-'+s.number;if(book.source?.structure!=='source_chapters')section.append(el('p','section-number','§'+s.number));
    for(const raw of s.paragraphs){
      const p=paragraphMap.get(raw.id),divider=isReadingDivider(p.original),node=el('div',p.kind==='source_heading'?'passage source-chapter-heading':divider?'passage reading-divider':'passage');node.id=p.id;node.dataset.id=p.id;node.tabIndex=0;node.setAttribute('aria-describedby','reading-instructions');fillPassage(node,p);section.append(node);
      if(p.id===book.chineseSample?.endPassageId){const end=el('aside','sample-boundary');end.append(fixed('strong','',READER_UI+'sampleEnd'),fixed('p','',READER_UI+'sampleHelp',{count:book.chineseSample.paragraphs}));section.append(end);}
    }wrapper.append(section);
  }
  const ending=el('div','flow-chapter-end');ending.append(fixed('span','',READER_UI+'chapterEndNumber',{number:chapter.number}));
  if(!chapter.kind||chapter.kind==='body'){const mark=button(t(READER_UI+'markChapter'),()=>document.dispatchEvent(new CustomEvent('reader:mark-chapter',{detail:{chapterId:chapter.id}})));mark.dataset.markChapter=chapter.id;mark.hidden=true;ending.append(mark);}
  wrapper.append(ending);return wrapper;
}
function updateChapterNavigation(){
  const chapter=currentChapter(),index=book.chapters.findIndex(c=>c.id===chapter.id),bodyCount=book.chapters.filter(c=>c.kind==='body').length;
  document.title=chapter.title.zh+' · Leafhour';
  $('chapter-fraction').textContent=chapter.kind==='body'?chapter.number+' / '+bodyCount:chapter.kind?chapter.title.zh:(index+1)+' / '+book.chapters.length;
  $('previous-chapter').disabled=index===0;$('next-chapter').disabled=index===book.chapters.length-1;
  renderToc();document.dispatchEvent(new CustomEvent('reader:chapter',{detail:{chapterId:state.chapterId}}));
}
function queueReadingFlow(){if(flowFrame)return;flowFrame=true;requestAnimationFrame(()=>{flowFrame=false;syncFlowChapter();extendReadingFlow();});}
function prepareFollowingChapter(){
  if(!readerOffline.canPrefetch())return;
  if(pagination.active||!continuous){readerOffline.prefetchNext(book,state.chapterId,readingBook?.ensure);return;}
  if(!flow?.nextId)return;
  if(flowIdle!==null){if(window.cancelIdleCallback)cancelIdleCallback(flowIdle);else clearTimeout(flowIdle);}
  const prepare=()=>{flowIdle=null;const id=flow?.nextId,owner=flow;if(!continuous||!id)return;readerOffline.prefetch(id,readingBook.ensure).then(()=>{if(flow===owner&&continuous){flow.prepareNext();queueReadingFlow();}}).catch(()=>{});};
  flowIdle=window.requestIdleCallback?requestIdleCallback(prepare,{timeout:800}):setTimeout(prepare,80);
}
function extendReadingFlow(){
  if(pagination.active||!continuous||restoringProgress||!flow?.nextId||document.hidden||document.querySelector('dialog[open]:not(.library-chat-dialog)')||!$('note-panel').hidden||$('chapter-footer').contains(document.activeElement))return;
  const last=$('chapter-text').lastElementChild;if(!last||last.getBoundingClientRect().bottom>innerHeight*2.5)return;
  insertFollowingChapter();
}
function insertFollowingChapter(){
  if(flow?.nextId&&!readingBook.isLoaded(flow.nextId)){prepareFollowingChapter();return false;}
  const next=flow?.appendNext();if(!next)return false;$('chapter-text').append(next.node);prepareFollowingChapter();dispatchReaderEvent('reader:layout');dispatchReaderEvent('reader:flow-extended');queueReadingFlow();return true;
}
function syncFlowChapter(){
  if(pagination.active||!continuous||restoringProgress||!book||document.querySelector('dialog[open]:not(.library-chat-dialog)')||!$('note-panel').hidden||document.querySelector('.experience-surface'))return;
  const id=paragraphMap.get(anchor()?.passageId)?.chapterId;if(id&&id!==state.chapterId){state.chapterId=id;updateChapterNavigation();}
}
function renderChapter(){
  pruneLabels();
  if($('chapter-text').contains($('note-panel')))document.body.append($('note-panel'));
  flow=createChapterFlow({chapters:book.chapters,render:buildChapter});const first=flow.start(state.chapterId);first.dataset.first='true';$('chapter-text').replaceChildren(first);const chapter=currentChapter();
  chapterChrome($('chapter-number'),chapter);$('chapter-title').textContent=chapter.title.zh;$('chapter-original-title').textContent=chapter.title.en;
  $('chapter-heading').hidden=false;$('chapter-footer').hidden=false;applyAppearance();updateChapterNavigation();prepareFollowingChapter();
}
function renderToc(){contents.render();$('open-toc').disabled=false;$('settings-chapters').disabled=false;}
function changeChapter(id,target=null,options){if(!book?.chapters.some(c=>c.id===id))return Promise.resolve(false);return readingNavigation.navigate(id,target,options);}
function commitChapter(id,target=null){
  if(!book.chapters.some(c=>c.id===id))return;persist();closePanel();dismissTools();state.chapterId=id;selectedId=null;
  const existing=continuous&&flow?.renderedIds.includes(id);
  if(existing)updateChapterNavigation();else{overrides={};renderChapter();}$('toc-dialog').close();
  target=target||currentChapter().startPassageId||book.sections.find(s=>s.chapterId===id)?.paragraphs[0]?.id;
  if(target)restoreAnchor({passageId:target,offset:document.body.classList.contains('is-focused')?45:100});else window.scrollTo(0,0);
  persist();prepareFollowingChapter();announceUi(READER_UI+(currentChapter().kind&&currentChapter().kind!=='body'?'enteredNamed':book.source?.structure==='automatic_groups'?'enteredFragment':'entered'),{number:currentChapter().number,title:currentChapter().title.zh});
}
function dismissTools({preserveSelection=false}={}){
  clearTimeout(excerptTimer);excerptTimer=undefined;
  highlights.updateTools(null);
  $('paragraph-tools').hidden=true;$('paragraph-tools').dataset.excerpt='false';$('show-share').hidden=true;$('paragraph-more').hidden=true;$('more-actions').setAttribute('aria-expanded','false');
  if(!preserveSelection){clearPanelTextHighlight();selectedExcerpt=null;selectionKind='passage';for(const node of $('chapter-text').querySelectorAll('.is-selected,.is-panel-anchor'))node.classList.remove('is-selected','is-panel-anchor');dispatchReaderEvent('reader:selection-end');}
}
function selectedRangeRect(){
  const selection=getSelection();if(!selection||selection.isCollapsed||selection.rangeCount!==1){
    if(selectionKind!=='excerpt'||!selectedExcerpt)return null;
    const rects=selectedExcerpt.parts.flatMap(part=>{const prose=proseForPart(part);if(!prose||prose.textContent.slice(part.start,part.end)!==part.text)return [];return [...(textRange(document,prose,part.start,part.end)?.getClientRects()||[])];});
    return rects.find(rect=>rect.bottom>80&&rect.top<innerHeight-60)||rects[0]||null;
  }
  const range=selection.getRangeAt(0),container=range.commonAncestorContainer.nodeType===Node.TEXT_NODE?range.commonAncestorContainer.parentElement:range.commonAncestorContainer;
  if(!container||!$('chapter-text').contains(container))return null;
  const rect=range.getBoundingClientRect();return rect.width||rect.height?rect:null;
}
function positionTools(){
  const tools=$('paragraph-tools'),id=tools.dataset.excerpt==='true'?selectedExcerpt?.parts.at(-1)?.passageId||selectedId:selectedId;
  const node=document.getElementById(id);if(!node)return;
  const nodeRect=(pagination.active&&pagination.visibleRect(node))||node.getBoundingClientRect();tools.hidden=false;tools.inert=false;tools.style.visibility='hidden';tools.style.opacity='0';tools.style.maxWidth=Math.min(nodeRect.width,innerWidth-24)+'px';
  const rangeRect=tools.dataset.excerpt==='true'?selectedRangeRect():null,anchorRect=rangeRect||nodeRect;
  const header=$('reading-header').getBoundingClientRect().bottom;
  const placement=placeFloatingToolbar({anchor:anchorRect,fallbackAnchor:rangeRect?nodeRect:anchorRect,toolbar:{width:tools.offsetWidth,height:tools.offsetHeight},viewport:{width:innerWidth,height:innerHeight},headerBottom:header,gap:rangeRect?10:24});
  tools.style.left=placement.left+'px';tools.style.top=placement.top+'px';tools.dataset.placement=placement.placement;tools.inert=!placement.visible;tools.setAttribute('aria-hidden',String(!placement.visible));tools.style.visibility=placement.visible?'visible':'hidden';tools.style.opacity=placement.visible?'1':'0';
  const menu=$('paragraph-more');if(!menu.hidden){menu.style.maxHeight='';const at=placeFloatingMenu({toolbar:tools.getBoundingClientRect(),menu:{width:menu.offsetWidth,height:menu.scrollHeight+2},viewport:{width:innerWidth,height:innerHeight},headerBottom:header});Object.assign(menu.style,{position:'absolute',left:(at.left-tools.getBoundingClientRect().left)+'px',top:(at.top-tools.getBoundingClientRect().top)+'px',right:'auto',bottom:'auto',maxHeight:at.maxHeight+'px'});}
}
function choosePassage(id,y=null,quote='',quoteLanguage=null){
  if(!paragraphMap.has(id))return;const p=paragraphMap.get(id),v=passageView(p);quoteLanguage=visibleQuoteLanguage(p,{...v,mode:state.mode==='parallel'?'parallel':v.mode,translationHidden:state.mode==='parallel'&&state.parallelStyle==='reveal'&&!revealedTranslations.has(id+':'+v.variant)},quoteLanguage);const node=$('chapter-text').querySelector('[data-id="'+id+'"]'),pin=pagination.active?anchor():{passageId:id,offset:node.getBoundingClientRect().top};dismissTools();selectedId=id;selectedQuote=quote;selectedQuoteLanguage=quoteLanguage;selectionKind='passage';node.classList.add('is-selected');
  try{selectedExcerpt=paragraphSnapshot(book,p,p.chapterId,quoteLanguage,v.variant);}catch{selectedExcerpt=null;}$('show-share').hidden=true;$('paragraph-tools').dataset.excerpt='false';$('show-original').hidden=state.mode==='parallel'||chineseOriginalOnly(book);label($('show-original'),v.mode==='en'?READER_UI+'translation':'lo');$('show-annotations').hidden=!p.annotationIds.length&&!p.termIds.length;
  document.dispatchEvent(new CustomEvent('reader:selection',{detail:{passageId:id}}));positionTools();if(!$('note-panel').hidden&&!allRecords)renderPanel();restoreAnchor(pin);positionTools();
}
function proseForPart(part){const passage=document.getElementById(part.passageId);return passage&&[...passage.querySelectorAll('p[data-reading-layer]')].find(node=>(node.dataset.readingLayer==='original'?'en':'zh')===part.language&&(part.language==='en'||node.dataset.variant===part.variant));}
async function selectHighlight(row,{passageId}={}){
  const current=readingNavigation.begin();
  try{for(const id of new Set(row.parts.map(part=>paragraphMap.get(part.passageId)?.chapterId).filter(Boolean)))await readingBook.ensure(id);}catch(error){if(current())highlights.notify(error.message,{error:true});return false;}
  if(!current())return false;closePanel();const first=row.parts[0],target=row.parts.find(part=>part.passageId===passageId)||first,p=paragraphMap.get(first.passageId);if(!p)return false;
  state.mode=first.language==='en'?'en':'zh';state.variant=first.variant;overrides={};
  if(!document.getElementById(p.id)||state.chapterId!==p.chapterId){if(!await changeChapter(p.chapterId,p.id,{current})||!current())return false;}overrides=Object.fromEntries(row.parts.map(part=>[part.passageId,{mode:part.language==='en'?'en':'zh',variant:part.variant}]));updateText();
  restoreAnchor({passageId:p.id,offset:document.body.classList.contains('is-focused')?45:100});choosePassage(p.id,null,row.parts.map(part=>part.text).join('\n\n'),first.language);
  selectedExcerpt=structuredClone(row);selectionKind='excerpt';$('paragraph-tools').dataset.excerpt='true';$('show-share').hidden=false;highlights.updateTools(selectedExcerpt);positionTools();
  const prose=proseForPart(target),rect=prose&&prose.textContent.slice(target.start,target.end)===target.text&&textRange(document,prose,target.start,target.end)?.getClientRects()[0];if(rect){if(pagination.active)pagination.revealRect(rect,target.passageId);else window.scrollBy(0,rect.top-160);persist();positionTools();}
  if(row.parts.some(part=>{const source=paragraphMap.get(part.passageId),text=part.language==='en'?source?.original:source?.translations?.[part.variant]?.text;return text?.slice(part.start,part.end)!==part.text;}))highlights.notify('',{id:READER_UI+'highlightChanged'});
  return true;
}
function mountPanel(){
  const panel=$('note-panel'),node=$('chapter-text').querySelector('[data-id="'+selectedId+'"]');
  const inline=!pagination.active&&(innerWidth<1320||state.mode==='parallel');panel.classList.toggle('is-inline',inline);
  if(inline&&node)node.after(panel);else if(panel.parentNode!==document.body)document.body.append(panel);
}
function closePanel(){queueReadingFlow();
  const a=anchor();$('note-panel').hidden=true;document.body.classList.remove('has-panel');clearPanelTextHighlight();for(const node of $('chapter-text').querySelectorAll('.is-selected,.is-panel-anchor'))node.classList.remove('is-selected','is-panel-anchor');if($('note-panel').parentNode!==document.body)document.body.append($('note-panel'));restoreAnchor(a);dispatchReaderEvent('reader:selection-end');
}
function recordNode(record,type,withAnchor=false){
  return personalRecordsUI.recordNode(record,type,withAnchor);
}
function clearPanelTextHighlight(){
  if(typeof CSS!=='undefined'&&CSS.highlights)CSS.highlights.delete('panel-reference');
  for(const mark of $('chapter-text').querySelectorAll('.panel-reference-mark')){const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize();}
}
function syncPanelTextHighlight(){
  clearPanelTextHighlight();if(selectionKind!=='excerpt'||!selectedExcerpt?.parts?.length)return;
  const entries=[];for(const part of selectedExcerpt.parts){const passage=$('chapter-text').querySelector('[data-id="'+part.passageId+'"]');if(!passage)continue;const candidates=[...passage.querySelectorAll('p[lang]')],prose=candidates.find(node=>(node.dataset.readingLayer==='original'?'en':node.lang==='en'?'en':'zh')===part.language&&(part.language==='en'||node.dataset.variant===part.variant));if(!prose||part.start<0||part.end>prose.textContent.length||prose.textContent.slice(part.start,part.end)!==part.text)continue;entries.push({prose,part});}
  if(typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight!=='undefined'){const ranges=[];for(const {prose,part}of entries){const range=textRange(document,prose,part.start,part.end);if(range)ranges.push(range);}if(ranges.length)CSS.highlights.set('panel-reference',new Highlight(...ranges));return;}
  for(const {prose,part}of entries){const range=textRange(document,prose,part.start,part.end);if(!range)continue;const mark=el('mark','panel-reference-mark');mark.append(range.extractContents());range.insertNode(mark);}
}
function renderPanelSource(p){
  const excerpt=selectionKind==='excerpt'&&selectedExcerpt?.parts?.length?selectedExcerpt:null,v=passageView(p),language=excerpt?.parts[0]?.language||visibleQuoteLanguage(p,v,selectedQuoteLanguage),variant=excerpt?.parts[0]?.variant||v.variant;
  label($('panel-source-label'),READER_UI+'sourceLabel.'+(excerpt?'excerpt':'passage')+'.'+(language==='en'?(book.sourceLanguage==='zh'?'zh':'en'):variant));
  // GET-186/190 quote panel: one shared helper formats each raw slice from its
  // full immutable source when the snapshot identity and slice still validate,
  // and keeps historical excerpts literal. Raw part.text, joins and snapshot
  // metadata stay exact; the accessible name describes what is presented.
  const currentText=language==='en'?p.original:p.translations[variant]?.text||t(READER_UI+'missing.'+variant);
  const parts=excerpt?excerpt.parts:[{passageId:p.id,language,variant,start:0,end:currentText.length,text:currentText}];
  const {nodes,displayText}=quotePanelSourceNodes(document,{book,snapshot:excerpt,parts,originalFor:part=>paragraphMap.get(part.passageId)?.original});
  const target=$('panel-source-text');target.replaceChildren(...nodes);
  target.lang=language==='en'?(book.sourceLanguage||'und'):'zh-Hans';label($('panel-source'),READER_UI+'returnQuote',{quote:displayText.slice(0,120)},'aria-label');
}
function returnToPanelSource(){
  const id=selectionKind==='excerpt'?selectedExcerpt?.parts?.[0]?.passageId:selectedId,node=id&&$('chapter-text').querySelector('[data-id="'+id+'"]');if(!node)return;
  node.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});node.focus({preventScroll:true});node.classList.remove('is-locating');requestAnimationFrame(()=>node.classList.add('is-locating'));setTimeout(()=>node.classList.remove('is-locating'),850);
}
function renderRecordsAccess(content){
  if(selectedBookId&&!readerOwner()){
    if(!readerSession?.emailAvailable&&!readerSession?.localAvailable&&!readerSession?.providers?.google&&!readerSession?.providers?.apple){content.append(fixed('p','empty-state',READER_UI+'loginPreparing'));return;}
    content.append(fixed('p','empty-state',READER_UI+'loginNotes'));const login=fixed('a','quiet-button',READER_UI+'loginPassage');loginLink(login,{bookId:selectedBookId,passageId:selectedId,note:allRecords?'records':panelTab==='question'?'question':'comment'});content.append(login);return;
  }
  if(recordsPending){content.append(fixed('p','empty-state',READER_UI+'recordsLoading'));return;}
  content.append(fixed('p','empty-state',READER_UI+'recordsUnavailable'));const retry=button('',recoverRecords);retry.className='records-retry';retry.disabled=recordsRetryBusy;label(retry,recordsRetryBusy?READER_UI+'recordsReading':READER_UI+'recordsRetry');content.append(retry);if(recordsRetryNotice){const notice=fixed('p','form-status',READER_UI+'recordsFailed');notice.setAttribute('role','status');content.append(notice);}
}
async function recoverRecords(event){
  if(book.reading?.offlineFallback||typeof readerOffline!=='undefined'&&readerOffline.isOffline()){announceUi(book.reading?.offlineFallback?'offline.chapterMissing':'offline.needsNetwork');return;}
  event?.stopPropagation();if(recordsRetryBusy)return;const focus=trackActionFocus(document,event?.currentTarget);recordsRetryBusy=true;recordsRetryNotice='';renderPanel();
  try{const fresh=await api('/api/records');if(!Array.isArray(fresh.comments)||!Array.isArray(fresh.questions))throw Error('记录格式不完整');let local=null;try{local=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
    const choice=offlinePositionChoice({book,local,remote:fresh.position,remoteAvailable:!fresh.offline});recordsPositionUnresolved=!!choice||recoveredPositionNeedsChoice(progressSync.revision,fresh.position);records=fresh;recordsUnavailable=false;if(choice)preparePositionOpening(local,fresh.position,!fresh.offline);dispatchReaderEvent('reader:records-updated');if(recordsPositionUnresolved){clearTimeout(persistTimer);$('progress-notice').hidden=false;announceUi(READER_UI+'progressConflict');}else{progressSync.adopt(fresh.position?.revision||0);persist();}}
  catch{recordsRetryNotice=READER_UI+'recordsFailed';}
  finally{recordsRetryBusy=false;if(!$('note-panel').hidden){renderPanel();focus.restore(recordsUnavailable?$('panel-content').querySelector('button'):recordsPositionUnresolved?$('progress-use-remote'):document.querySelector('[data-panel-tab="'+panelTab+'"]'));}else focus.stop();}
}
function renderPanel(){
  pruneLabels();
  const content=$('panel-content');content.replaceChildren();if(records?.offline)content.append(fixed('p','empty-state','offline.drafts'));const p=paragraphMap.get(selectedId);if(!p)return;
  label($('panel-title'),allRecords?READER_SHELL+'myRecords':panelTab==='annotations'?READER_UI+'annotationTitle':panelTab==='question'?READER_SHELL+'leaveQuestion':READER_UI+'writeThought');
  const sourcePage=p.source?.printedPage||p.source?.pdfPage;
  $('panel-anchor').hidden=!sourcePage;
  if(sourcePage)label($('panel-anchor'),READER_UI+(p.source?.printedPage?'sourcePrintedPage':'sourcePdfPage'),{page:sourcePage});
  else{ownedLabels.forget($('panel-anchor'));$('panel-anchor').textContent='';}
  for(const tab of document.querySelectorAll('[data-panel-tab]')){const active=tab.dataset.panelTab===panelTab;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}content.setAttribute('aria-labelledby','panel-tab-'+panelTab);
  document.querySelector('.panel-tabs').hidden=allRecords;$('panel-source').hidden=allRecords;
  if(!allRecords){renderPanelSource(p);syncPanelTextHighlight();}else clearPanelTextHighlight();
  if(allRecords){
    content.append(fixed('h2','all-records-title',READER_SHELL+'myRecords'));
    if(recordsUnavailable){renderRecordsAccess(content);mountPanel();return;}
    const marks=activeHighlights(records);for(const row of marks)content.append(highlights.recordNode(row));
    if(!marks.length&&!records.comments.length&&!records.questions.length)content.append(fixed('p','empty-state',READER_UI+'noRecords'));
    for(const record of records.comments)content.append(recordNode(record,'comment',true));for(const record of records.questions)content.append(recordNode(record,'question',true));mountPanel();return;
  }
  if(panelTab==='annotations'){
    for(const id of p.annotationIds){const n=notesMap.get(id);if(!n)continue;const block=el('section','annotation');block.append(fixed('p','attribution',READER_UI+'annotation.'+(['difficulty','paradox','example','context','cross_reference','term'].includes(n.kind)?n.kind:'note')+'.'+(n.attribution==='editorial'?'editorial':'source')),el('h3','',n.title),el('p','',n.text));content.append(block);}
    if(p.termIds.length){const details=el('details','term-definition');details.append(fixed('summary','',READER_UI+'keyTerms'));for(const id of p.termIds){const t=termsMap.get(id);if(!t)continue;const line=el('p');line.append(el('strong','',t.zh+' · '+t.en),el('br'),document.createTextNode(t.definition));details.append(line);}content.append(details);}
    if(!p.annotationIds.length&&!p.termIds.length)content.append(fixed('p','empty-state',READER_UI+'noAnnotations'));mountPanel();return;
  }
  const type=panelTab==='question'?'question':'comment',key=type==='question'?'questions':'comments',draftId=type+':'+p.id;
  const scopeDrafts=noteDrafts,scopeBook=book,scopeOwner=readerSession?.user,scopeEpoch=readerEpoch;
  const currentComposer=()=>!readerDisposed&&readerEpoch===scopeEpoch&&book===scopeBook&&readerSession?.user===scopeOwner;
  if(recordsUnavailable){renderRecordsAccess(content);mountPanel();return;}
  noteDrafts.activate?.(draftId);if(noteDrafts.reconcile(draftId,records[key]))persistDrafts();
  const form=el('form','composer'),composerLabel=fixed('label','',type==='question'?READER_UI+'questionLabel':READER_UI+'thoughtLabel'),area=el('textarea');area.id='thought-text';area.maxLength=2000;label(area,type==='question'?READER_UI+'questionPlaceholder':READER_UI+'thoughtPlaceholder',null,'placeholder');composerLabel.htmlFor=area.id;area.value=noteDrafts.text(draftId);
  const save=button(''),pendingHint=el('p','form-status'),status=el('p','form-status');save.type='submit';status.setAttribute('aria-live','polite');
  const updateComposer=()=>{const pending=noteDrafts.pending(draftId),busy=noteDrafts.busy(draftId);save.disabled=busy||!noteDrafts.text(draftId).trim()&&!pending;label(save,busy?'record.saving':pending?'record.retry':type==='question'?READER_SHELL+'saveQuestion':READER_UI+'saveThought');pendingHint.hidden=!pending;label(pendingHint,pending?READER_UI+'pendingNote':READER_UI+'empty',{text:pending?pending.text.slice(0,80)+(pending.text.length>80?'…':''):''});};
  updateComposer();form.append(composerLabel,area,pendingHint,save,status);content.append(form);
  listenNode(area,'input',()=>{noteDrafts.edit(draftId,area.value);updateComposer();status.textContent=draftSaveReceipt({durable:persistDrafts()},receiptFor(status));});
  listenNode(form,'submit',async e=>{
    e.preventDefault();if(!currentComposer()||noteDrafts.busy(draftId)||!area.value.trim()&&!noteDrafts.pending(draftId))return;
    const draftEntryId=noteDrafts.activeId?.(draftId);noteDrafts.edit(draftId,area.value);const submission=noteDrafts.begin(draftId,{passageId:p.id,contentVersion:book.contentVersion,quote:selectedQuote,quoteLanguage:selectedQuoteLanguage==='en'?book.sourceLanguage||'en':'zh',quoteOrigin:selectedQuoteLanguage==='en'?'original':'translation'},()=>crypto.randomUUID());const durable=persistDrafts();updateComposer();label(status,durable?'record.saving':'record.savingNotDurable');
    try{const record=await api('/api/'+key,submission);if(!currentComposer())return;if(!noteDrafts.acknowledge(draftId,record,draftEntryId))throw Error('服务尚未确认这次提交。');if(!records[key].some(r=>r.id===record.id))records[key].push(record);const cached=persistDrafts();if(form.isConnected){area.value=noteDrafts.text(draftId);status.setAttribute('role','status');status.textContent=noteSaveReceipt({confirmed:true,durable:cached,hasDraft:!!area.value},receiptFor(status));content.append(recordNode(record,type));}}
    catch(error){if(currentComposer()&&form.isConnected){status.setAttribute('role','alert');status.textContent=noteSaveReceipt({durable:persistDrafts()},receiptFor(status));}}
    finally{scopeDrafts.finish(draftId,draftEntryId);if(!currentComposer())return;if(form.isConnected)updateComposer();else if(!allRecords&&!$('note-panel').hidden&&selectedId===p.id&&panelTab===type)renderPanel();}
  });
  for(const record of records[key].filter(r=>r.passageId===p.id))content.append(recordNode(record,type));mountPanel();
}
function openPanel(tab){
  if(!selectedId)return;readerConversation?.close?.();const a=anchor();panelTab=tab;allRecords=false;$('note-panel').hidden=false;document.body.classList.add('has-panel');for(const node of $('chapter-text').querySelectorAll('.is-selected'))node.classList.add('is-panel-anchor');renderPanel();restoreAnchor(a);dismissTools({preserveSelection:true});document.querySelector('[data-panel-tab="'+tab+'"]')?.focus({preventScroll:true});if($('note-panel').classList.contains('is-inline'))$('note-panel').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function updateText(){flow?.invalidatePrepared();prepareFollowingChapter();const a=anchor();for(const node of $('chapter-text').querySelectorAll('.passage'))fillPassage(node,paragraphMap.get(node.dataset.id));applyAppearance();if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();persist();dispatchReaderEvent('reader:layout');}
function indexBook(){
 paragraphs=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,section:s.number,chapterId:s.chapterId})));paragraphMap=new Map(paragraphs.map(p=>[p.id,p]));notesMap=new Map(book.annotations.map(n=>[n.id,n]));termsMap=new Map(book.glossary.map(t=>[t.id,t]));
}
function openingBook(){
 if(!selectedBookId)return api('/api/book');
 const query=new URLSearchParams(),requested=new URLSearchParams(location.search).get('passage');let cached;
 try{cached=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
 if(requested||cached?.passageId)query.set('passageId',requested||cached.passageId);
 if(cached?.chapterId)query.set('chapterId',cached.chapterId);
 return api('/api/reading?'+query);
}
async function boot(){
  readerOpening=null;dispatchReaderEvent('reader:opening');
  const generation=++loadGeneration,arrivalTicket=arrival.start();readerPresenceReady=false;dailyPresence.refresh();entryInteracted=false;restoringProgress=true;
  const loading=startReadingLoad({readBook:()=>openingBook(),readRecords:()=>api('/api/records')});
  try{
    book=await loading.book;if(generation!==loadGeneration)return;if(book.source?.formattedTables||book.source?.resources?.length){await loadSourceStyles(document);if(generation!==loadGeneration)return;}if(selectedBookId){try{noteDrafts=createReadingDraftStore({storage:localStorage,scope:readerStorageKey('marginalia-reading-ending-drafts-v1'),book});noteDraftError=null;}catch(error){noteDraftError=error;announceUi(READER_UI+'draftUnavailable');}}if(book.title?.zh){$('running-book-title').textContent=book.title.zh;$('toc-book-title').textContent=book.title.zh;}if(selectedBookId)state.chapterId=book.readingStart?.chapterId||book.chapters[0].id;const initialRecords=loading.peekRecords();recordsPending=initialRecords===undefined;records=initialRecords||{comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null};recordsUnavailable=selectedBookId&&!readerOwner()||!initialRecords;
    readingBook=createReadingBook({book,readChapter:(id,version,options)=>api('/api/chapters/'+encodeURIComponent(id)+'?contentVersion='+encodeURIComponent(version),undefined,options),onContent:()=>{indexBook();dispatchReaderEvent('reader:content');}});indexBook();
    readingNavigation=createReadingNavigation({isLoaded:readingBook.isLoaded,ensure:readingBook.ensure,commit:commitChapter,onPending:()=>announceUi(READER_UI+'chapterLoading'),onError:error=>announceUi(readerOffline.chapterError(error))});
    let localPosition=null;try{localPosition=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
    // GET-186 entry policy: the real boot decision lives in reader-entry.mjs.
    // Valid resumes and explicit entries keep their anchors; a genuinely fresh
    // or invalid-position opening renders the chapter top (full chapter number
    // and title) instead of clipping the generated heading.
    const positionPolicy=preparePositionOpening(localPosition,records.position,!recordsUnavailable&&!records.offline);
    const opening=resolveReaderOpening({book,query:new URLSearchParams(location.search),remote:records.position,local:positionPolicy.local,remoteAvailable:positionPolicy.remoteAvailable,hasPassage:id=>paragraphMap.has(id),chapterOf:id=>paragraphMap.get(id)?.chapterId,state,account:readerOwner()?readerSession.readingPreferences?.preferences:null,sourceOnly:chineseOriginalOnly(book)});
    if(opening.offlineFallback)prepareOfflineFallback(opening,localPosition,records.position);
    let position=opening.position;deferredProgress=!!position?.pending;const requestedEntry=opening.requestedEntry,sampleEntry=opening.sampleEntry;
    progressSync.adopt(recordsUnavailable||records.offline?(opening.chosen?.baseRevision??opening.chosen?.revision??0):(records.position?.revision||0));
    state.chapterId=opening.chapterId;
    // Opening precedence: valid per-book saved view over the account defaults, else safe guest defaults.
    Object.assign(state,opening.preferences);
    if(sampleEntry){const query=new URLSearchParams(location.search);query.delete('sample');history.replaceState(null,'',location.pathname+'?'+query);}
    if(selectedBookId){const onlyOriginal=chineseOriginalOnly(book)&&!['literal','interpretive'].includes(requestedEntry?.layer);for(const option of $('view-mode').options){option.disabled=onlyOriginal&&option.value!=='en';if(option.value==='en')label(option,book.sourceLanguage==='zh'?READER_UI+'chineseOriginal':book.sourceLanguage==='en'?READER_SHELL+'englishOriginal':'lo');if(option.value==='zh')label(option,READER_SHELL+'chineseTranslation');if(option.value==='parallel')label(option,book.sourceLanguage==='en'?READER_SHELL+'bilingual':READER_UI+'sourceAndTranslation');}if(onlyOriginal)state.mode='en';settingsUI.sync();}
    await readingBook.ensure(state.chapterId);if(generation!==loadGeneration)return;
    renderChapter();arrival.finish(arrivalTicket);$('load-error').hidden=true;await document.fonts.ready;if(position){restoreAnchor(position);cachePosition({...position,contentVersion:book.contentVersion,chapterLabel:resumeSummary(book,position)?.label});}else window.scrollTo(0,0);restoringProgress=false;document.body.dataset.ready='true';readerPresenceReady=true;dailyPresence.refresh();document.body.dataset.readableMs=String(Math.round(performance.now()));document.body.dataset.recordsState=recordsPending?'pending':recordsUnavailable?'unavailable':'ready';dispatchReaderEvent('reader:ready');if(!recordsPending||requestedEntry||sampleEntry)reportReadingResume(position,{explicitEntry:!!requestedEntry||!!sampleEntry,hadSaved:!!(records.position||localPosition)});performance.mark('reader:readable');queueReadingFlow();if(recordsPending)loading.records.then(fresh=>adoptLoadedRecords(fresh,{generation,explicitEntry:!!requestedEntry||!!sampleEntry,initialPosition:position,hadSaved:!!(records.position||localPosition)}));if(requestedEntry){const query=new URLSearchParams(location.search);query.delete('passage');query.delete('note');query.delete('action');query.delete('contentVersion');query.delete('layer');history.replaceState(null,'',location.pathname+'?'+query);if(requestedEntry.note){choosePassage(requestedEntry.passageId,null,paragraphMap.get(requestedEntry.passageId).original,'en');openPanel(requestedEntry.note==='question'?'question':'comment');if(requestedEntry.note==='records'){allRecords=true;renderPanel();}}else if(requestedEntry.action==='translate'){choosePassage(requestedEntry.passageId,null,'','en');}}
  }catch(error){if(generation===loadGeneration){readerOpening={failure:{name:['TypeError','TimeoutError','SyntaxError','QuotaExceededError','SecurityError'].includes(error.name)?error.name:'Error',expected:error.name==='AbortError'||error.status>=400&&error.status<500}};readerPresenceReady=false;dailyPresence.refresh();arrival.finish(arrivalTicket);const notice=$('load-error');label(notice.querySelector('p'),error.code==='READER_CITATION_INVALID'?READER_UI+'citationInvalid':READER_SHELL+'loadError');let login=notice.querySelector('a');if(!readerOwner()&&selectedBookId){if(!login){login=fixed('a','quiet-button',READER_UI+'loginCitation');notice.append(login);}const query=new URLSearchParams(location.search);loginLink(login,{bookId:selectedBookId,passageId:query.get('passage'),contentVersion:query.has('contentVersion')?query.get('contentVersion'):undefined,layer:query.has('layer')?query.get('layer'):undefined});}else login?.remove();notice.hidden=false;dispatchReaderEvent('reader:failed');}}
}
async function adoptLoadedRecords(fresh,{generation,explicitEntry,initialPosition=null,hadSaved=false}){
  if(generation!==loadGeneration)return;recordsPending=false;document.body.dataset.recordsState=fresh?'ready':'unavailable';
  if(!fresh||!Array.isArray(fresh.comments)||!Array.isArray(fresh.questions)){reportReadingResume(initialPosition,{explicitEntry,hadSaved,failed:true});if(!$('note-panel').hidden)renderPanel();return;}
  records=mergeLoadedReadingRecords(fresh,records);recordsUnavailable=!!selectedBookId&&!readerOwner();
  let pendingPosition=null;try{pendingPosition=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
  if(book.reading?.offlineFallback){prepareOfflineFallback({offlineFallback:book.reading.offlineFallback},pendingPosition,fresh.position);reportReadingResume(null,{explicitEntry:false,hadSaved,skipped:true});if(!$('note-panel').hidden)renderPanel();dispatchReaderEvent('reader:records-updated');queueReadingFlow();return;}
  if(pendingPosition?.pending&&offlinePositionChoice({book,local:pendingPosition,remote:fresh.position,remoteAvailable:!fresh.offline})){
    preparePositionOpening(pendingPosition,fresh.position,!fresh.offline);reportReadingResume(initialPosition,{explicitEntry,hadSaved:true,skipped:true});if(!$('note-panel').hidden)renderPanel();dispatchReaderEvent('reader:records-updated');queueReadingFlow();return;
  }
  const remote=resolveReadingPosition(book,fresh.position);let restoredPosition=initialPosition,skipped=false;
  if(remote&&!explicitEntry){
    if(entryInteracted)skipped=true;
    if(!entryInteracted){
      let local=null;try{local=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
      const chosen=chooseReadingPosition({book,remote,local});
      if(chosen){try{await readingBook.ensure(chosen.chapterId);}catch{reportReadingResume(null,{failed:true});recordsPositionUnresolved=true;$('progress-notice').hidden=false;announceUi(READER_UI+'savedSourceFailed');return;}if(generation!==loadGeneration)return;if(entryInteracted){reportReadingResume(null,{skipped:true});recordsPositionUnresolved=true;$('progress-notice').hidden=false;return;}restoringProgress=true;Object.assign(state,{chapterId:chosen.chapterId},openingReadingPreferences(chosen,{sourceOnly:chineseOriginalOnly(book)}));renderChapter();restoreAnchor(chosen);restoredPosition=chosen;cachePosition({...chosen,chapterLabel:resumeSummary(book,chosen)?.label});restoringProgress=false;}
    }else if(recoveredPositionNeedsChoice(progressSync.revision,fresh.position)){
      skipped=true;
      recordsPositionUnresolved=true;clearTimeout(persistTimer);$('progress-notice').hidden=false;announceUi(READER_UI+'savedPositionReady');
    }
  }
  reportReadingResume(restoredPosition,{explicitEntry,hadSaved:hadSaved||!!fresh.position,skipped});
  if(!recordsPositionUnresolved){progressSync.adopt(fresh.position?.revision||0);if(deferredProgress)persist();}
  if(!$('note-panel').hidden)renderPanel();dispatchReaderEvent('reader:records-updated');queueReadingFlow();
}
for(const type of ['pointerdown','wheel','touchstart','keydown'])listen(document,type,event=>{if(event.isTrusted)entryInteracted=true;},{capture:true,passive:true});
listen($('continuous-reading'),'change',event=>{
  const a=anchor();if(a&&paragraphMap.has(a.passageId))state.chapterId=paragraphMap.get(a.passageId).chapterId;continuous=event.target.checked;document.body.dataset.continuous=String(continuous);try{localStorage.setItem(readerStorageKey('marginalia-continuous-v1'),String(continuous));}catch{}
  closePanel();dismissTools();renderChapter();restoreAnchor(a);queueReadingFlow();persist();
});
// Track input rather than viewport width so hybrid devices retain mouse use.
// Older Safari supplies a MouseEvent for the compatibility click after touch.
let passagePointerType='';
listen(document,'pointerdown',event=>{passagePointerType=event.pointerType||'';},{capture:true,passive:true});
listen(document,'touchstart',()=>{passagePointerType='touch';},{capture:true,passive:true});
function touchPassageClick(event){
  if(event.sourceCapabilities?.firesTouchEvents)return true;
  // WebKit may label the compatibility click as mouse, with a new pointer ID.
  // A genuine subsequent mouse pointerdown replaces the recorded touch source.
  if(event.detail!==0&&passagePointerType==='touch')return true;
  if(event.pointerType)return event.pointerType==='touch';
  return false;
}
listen(document,'click',e=>{
  if(e.target.closest('#note-panel,#paragraph-tools,#audio-bootstrap-status,#audio-import-input,#reading-session,dialog,.library-chat-launcher,.reading-header,.focus-actions,.experience-surface,.source-evidence,.source-resource-links,.page-turner,.paper-turn-handle'))return;
  const selection=getSelection();if(selection?.toString().trim()&&selectedExcerpt&&$('paragraph-tools').dataset.excerpt==='true')return;
  const node=e.target.closest('.passage');if(node){if(!touchPassageClick(e)&&!getSelection()?.toString()){const layer=e.target.closest('p')?.dataset.readingLayer;choosePassage(node.dataset.id,e.clientY,'',layer==='original'?'en':layer==='translation'?'zh':null);}return;}
  dismissTools();closePanel();
});
function captureExcerpt(y){
  try{const excerpt=captureDOMSelection(getSelection(),paragraphMap,book);if(!excerpt){if(getSelection()?.toString().trim()){selectedExcerpt=null;dismissTools();}return;}if(selectionKind==='excerpt'&&!$('paragraph-tools').hidden&&selectedExcerpt&&highlightKey(selectedExcerpt)===highlightKey(excerpt))return;const first=excerpt.parts[0];choosePassage(first.passageId,y,excerpt.parts.map(part=>part.text).join('\n\n'),first.language);selectedExcerpt=excerpt;selectionKind='excerpt';for(const part of excerpt.parts)document.getElementById(part.passageId)?.classList.add('is-selected');$('show-share').hidden=false;$('paragraph-tools').dataset.excerpt='true';highlights.updateTools(excerpt);positionTools();}
  catch(error){selectedExcerpt=null;dismissTools();announceUi(READER_UI+'selectAgain');}
}
// Native long press/handle changes report selectionchange. Touch release can
// still expose the selection from before a tap/scroll, so it must not recapture.
listen(document,'pointerup',e=>{if(e.pointerType==='touch'||e.button!==0||e.target.closest('#note-panel,#paragraph-tools,#audio-bootstrap-status,#reading-session,dialog,.library-chat-launcher,[popover],.experience-surface,.source-evidence,.source-resource-links,.page-turner,.paper-turn-handle')||!book)return;captureExcerpt(e.clientY);});
listen(document,'selectionchange',()=>{clearTimeout(excerptTimer);excerptTimer=undefined;if(book&&getSelection()?.toString().trim()&&$('chapter-text').contains(getSelection().anchorNode))excerptTimer=setTimeout(()=>{excerptTimer=undefined;captureExcerpt();},120);});
// Reading intent owns dismissal; layout restoration also emits scroll and
// must not cancel the action that caused that restoration. Native text stays
// selected so copying and extending a quote remain browser-owned operations.
const paragraphInputIsOwned=target=>!!target?.closest?.('#paragraph-tools,#note-panel,#reading-session,.reading-header,dialog,[popover],.page-turner,.paper-turn-handle,#audio-player,input,textarea,select,button,a,[contenteditable]');
const dismissForReading=()=>{if(!$('paragraph-tools').hidden||excerptTimer!==undefined)dismissTools({preserveSelection:!$('note-panel').hidden});};
listen(document,'wheel',event=>{if(!event.ctrlKey&&!event.metaKey&&(event.deltaX||event.deltaY)&&!paragraphInputIsOwned(event.target))dismissForReading();},{capture:true,passive:true});
listen(document,'pointerdown',event=>{if(event.button===0&&!paragraphInputIsOwned(event.target))dismissForReading();},{capture:true,passive:true});
listen(document,'touchmove',event=>{if(!paragraphInputIsOwned(event.target)&&getSelection()?.isCollapsed!==false)dismissForReading();},{capture:true,passive:true});
listen(document,'reader:tools-open',dismissForReading);
listen(document,'keyup',e=>{if(book&&!e.target.closest('#audio-bootstrap-status,input,textarea,select,dialog,.library-chat-launcher,[popover]')&&(e.key==='Shift'||e.shiftKey))captureExcerpt();});
listen(document,'keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.keyCode===229||readerInteractionBlocked(document,e.target))return;
  if(e.target.closest('#audio-bootstrap-status,input,textarea,select')||e.target.isContentEditable)return;
  if(e.key==='Escape'){
    if(!$('paragraph-tools').hidden){e.preventDefault();if(!$('paragraph-more').hidden){$('paragraph-more').hidden=true;$('more-actions').setAttribute('aria-expanded','false');$('more-actions').focus({preventScroll:true});return;}const restore=$('paragraph-tools').contains(document.activeElement),id=selectedId;dismissTools();if(restore)document.getElementById(id)?.focus({preventScroll:true});return;}if(!$('note-panel').hidden){closePanel();$('chapter-text').querySelector('[data-id="'+selectedId+'"]')?.focus({preventScroll:true});return;}
    if(document.fullscreenElement)immersion.handleKeydown(e);else readerTools.toolbar.conceal();return;
  }
  if(!e.shiftKey&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)&&!paragraphInputIsOwned(e.target))dismissForReading();
  if(e.key==='Enter'&&e.target.matches('.passage')){e.preventDefault();choosePassage(e.target.dataset.id);$('paragraph-tools').querySelector('button:not([hidden]):not(:disabled)')?.focus();}
  immersion.handleKeydown(e);
});
function openContents(trigger){if(!book)return;$('open-toc').disabled=false;$('settings-chapters').disabled=false;if(!contents.open(trigger))return;const list=$('toc-list'),active=list.querySelector('[aria-current=location]');if(active){const top=active.offsetTop-list.offsetTop;if(top<list.scrollTop||top+active.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=Math.max(0,top-list.clientHeight/3);}}
listen($('open-toc'),'click',event=>openContents(event.currentTarget));listen($('open-settings'),'click',()=>{readerTools.prepareOverlay('settings-dialog');dismissTools();settingsUI.enhance();$('settings-dialog').showModal();});
for(const b of document.querySelectorAll('[data-close-dialog]'))listen(b,'click',()=>$(b.dataset.closeDialog).close());
for(const dialog of document.querySelectorAll('dialog'))listen(dialog,'click',e=>{if(e.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();});
listen($('page-layout'),'change',e=>{const a=anchor();state.chapterId=paragraphMap.get(a?.passageId)?.chapterId||state.chapterId;Object.assign(state,normalizeAppearance({...state,pageLayout:e.target.value}));dismissTools();closePanel();renderChapter();restoreAnchor(a);persist();dispatchReaderEvent('reader:layout');});
listen($('view-mode'),'change',e=>{state.mode=e.target.value;overrides={};dismissTools();updateText();});
for(const [id,key] of [['reading-purpose','readingPurpose'],['preferred-language','preferredLanguage']])listen($(id),'change',event=>{
  Object.assign(state,normalizeAppearance({...state,[key]:event.target.value}));state.mode=preferredReadingMode(state,{sourceOnly:!!book&&chineseOriginalOnly(book)});overrides={};dismissTools();updateText();
});
mountParallelSettings({document,onChange:adjustAppearance});
listen($('translation-variant'),'change',e=>{state.variant=e.target.value;for(const value of Object.values(overrides))delete value.variant;updateText();});
for(const b of document.querySelectorAll('[data-theme-choice]'))listen(b,'click',()=>adjustAppearance({theme:b.dataset.themeChoice}));
for(const b of document.querySelectorAll('[data-font-family]'))listen(b,'click',()=>adjustAppearance({fontFamily:b.dataset.fontFamily}));
listen($('font-size'),'input',e=>adjustAppearance({font:Number(e.target.value)}));
listen($('first-line-indent'),'change',e=>adjustAppearance({indent:e.target.checked}));
listen($('reset-appearance'),'click',()=>{adjustAppearance({...appearanceDefaults,readingPurpose:state.readingPurpose,preferredLanguage:state.preferredLanguage});announceUi(READER_UI+'appearanceReset');});
listen($('settings-chapters'),'click',()=>{$('settings-dialog').close();openContents($('settings-chapters'));});
listen(matchMedia('(prefers-color-scheme:dark)'),'change',()=>applyAppearance());
listen($('show-original'),'click',()=>{if(!selectedId)return;const a=anchor(),p=paragraphMap.get(selectedId),v=passageView(p);overrides[selectedId]={...overrides[selectedId],mode:v.mode==='en'?'zh':'en'};fillPassage($('chapter-text').querySelector('[data-id="'+selectedId+'"]'),p);if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);label($('show-original'),v.mode==='en'?'lo':READER_UI+'translation');positionTools();});
listen($('quote-to-ai'),'click',()=>readerConversation?.quoteSelection?.());
listen($('show-annotations'),'click',()=>openPanel('annotations'));listen($('show-comment'),'click',()=>openPanel('comment'));listen($('show-question'),'click',()=>openPanel('question'));
listen($('more-actions'),'click',()=>{$('paragraph-more').hidden=!$('paragraph-more').hidden;$('more-actions').setAttribute('aria-expanded',String(!$('paragraph-more').hidden));positionTools();});
for(const b of document.querySelectorAll('[data-passage-variant]'))listen(b,'click',()=>{if(!selectedId)return;overrides[selectedId]={mode:'zh',variant:b.dataset.passageVariant};const a=anchor();fillPassage($('chapter-text').querySelector('[data-id="'+selectedId+'"]'),paragraphMap.get(selectedId));if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);dismissTools();});
for(const b of document.querySelectorAll('[data-panel-tab]')){
  const activate=()=>{panelTab=b.dataset.panelTab;allRecords=false;renderPanel();};
  listen(b,'click',activate);
  listen(b,'keydown',event=>{
    if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
    const tabs=[...document.querySelectorAll('[data-panel-tab]')],index=tabs.indexOf(b),next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
    if(next===null)return;event.preventDefault();panelTab=tabs[next].dataset.panelTab;allRecords=false;renderPanel();tabs[next].focus({preventScroll:true});
  });
}
listen($('panel-source'),'click',returnToPanelSource);
listen($('close-panel'),'click',()=>{closePanel();$('chapter-text').querySelector('[data-id="'+selectedId+'"]')?.focus({preventScroll:true});});
listen($('show-all-records'),'click',()=>{$('settings-dialog').close();selectedId=anchor()?.passageId||activeSections()[0].paragraphs[0].id;allRecords=true;$('note-panel').hidden=false;document.body.classList.add('has-panel');renderPanel();});
listen($('export-records'),'click',async e=>{
  e.preventDefault();const link=e.currentTarget;if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');
  try{if(recordsUnavailable)throw Error('请先重新读取个人记录，再导出。');if(recordsPositionUnresolved||progressSync.paused)throw Error('请先选择从哪里继续，再导出当前阅读记录。');clearTimeout(persistTimer);const position=captureProgress();if(position){cachePosition({...position,pending:true});if(!await progressSync.save(position))throw Error('阅读位置正在确认，请确认后再导出。');}const data=await api('/api/records/export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),download=document.createElement('a');download.href=url;download.download='marginalia-records.json';download.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('import-status').setAttribute('role','status');label($('import-status'),READER_UI+'exported');}
  catch(error){label($('import-status'),READER_UI+'exportFailed');$('import-status').setAttribute('role','alert');}finally{link.removeAttribute('aria-busy');}
});
listen($('import-records'),'click',()=>$('records-file').click());listen($('records-file'),'change',async e=>{const file=e.target.files[0];if(!file)return;clearTimeout(persistTimer);try{if(file.size>4*1024*1024)throw Error('记录包过大');const imported=JSON.parse(await file.text());await api('/api/records/import',imported);records=await api('/api/records');dispatchReaderEvent('reader:records-updated');if(imported.position&&records.position){state.mode=records.position.mode;state.variant=records.position.variant;overrides={};dispatchReaderEvent('reader:jump');updateText();adjustAppearance(records.position);}$('import-status').setAttribute('role','status');label($('import-status'),READER_UI+'imported');}catch(error){label($('import-status'),READER_UI+'importFailed');$('import-status').setAttribute('role','alert');}finally{e.target.value='';}});
listen($('previous-chapter'),'click',()=>{const n=book.chapters.findIndex(c=>c.id===state.chapterId)-1;if(book.chapters[n])changeChapter(book.chapters[n].id);});listen($('next-chapter'),'click',()=>{const n=book.chapters.findIndex(c=>c.id===state.chapterId)+1;if(book.chapters[n])changeChapter(book.chapters[n].id);});
for(const type of ['wheel','touchmove'])listen(document,type,event=>{if(event.isTrusted)allowScrollSave=true;},{passive:true});
listen(document,'keydown',event=>{if(event.isTrusted&&!event.target.closest('input,textarea,select')&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))allowScrollSave=true;});
let scrollFrame=false;listen(document,'scroll',()=>{if(scrollFrame)return;scrollFrame=true;requestAnimationFrame(()=>{scrollFrame=false;syncFlowChapter();extendReadingFlow();if(!$('paragraph-tools').hidden)positionTools();if(allowScrollSave)persist();});},{passive:true});
async function reconcileProgress(useRemote,event){
  if(book.reading?.offlineFallback||typeof readerOffline!=='undefined'&&readerOffline.isOffline()){announceUi(book.reading?.offlineFallback?'offline.chapterMissing':'offline.needsNetwork');return;}
  const current=readingNavigation.begin(),trigger=event?.currentTarget,focus=trackActionFocus(document,trigger);
  const buttons=[$('progress-use-remote'),$('progress-keep-here')];buttons.forEach(b=>b.disabled=true);restoringProgress=true;progressSequence++;clearTimeout(persistTimer);
  try{
    const fresh=await api('/api/records'),position=resolveReadingPosition(book,fresh.position);focus.stop();if(!current())return;
    let local=null;try{local=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
    if(local?.pending){const durable=positionRecovery.retain({bookId:book.bookId,local,remote:fresh.position});refreshPositionRecovery();if(!durable){recordsPositionUnresolved=true;$('progress-notice').hidden=false;throw Error('Position recovery is not durable');}}
    const localPosition=local?.pending?resolveReadingPosition(book,local):null,target=useRemote?position:localPosition;
    if(useRemote&&!position)throw Error('较新的位置暂时无法对应原文，请继续读这里。');if(target)await readingBook.ensure(target.chapterId);if(!current())return;
    let latest=null;try{latest=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
    if(latest?.pending&&JSON.stringify(latest)!==JSON.stringify(local)){positionRecovery.retain({bookId:book.bookId,local:latest,remote:fresh.position});refreshPositionRecovery();recordsPositionUnresolved=true;$('progress-notice').hidden=false;throw Error('The local reading position changed');}
    clearTimeout(persistTimer);progressSync.adopt(fresh.position?.revision||0);recordsPositionUnresolved=false;
    if(target){closePanel();dismissTools();if(useRemote)records=fresh;Object.assign(state,{chapterId:target.chapterId},openingReadingPreferences(target,{sourceOnly:chineseOriginalOnly(book)}));overrides={};selectedId=null;renderChapter();restoreAnchor(target);}
    if(useRemote){cachePosition({...position,contentVersion:book.contentVersion,chapterLabel:resumeSummary(book,position)?.label,pending:false});allowScrollSave=false;announceUi(READER_UI+'positionReturned');}
    else{restoringProgress=false;persist();announceUi(READER_UI+'positionKept');}
    $('progress-notice').hidden=true;
  }catch(error){if(current())announceUi(READER_UI+'progressConflict');}finally{restoringProgress=false;buttons.forEach(b=>b.disabled=false);if(current())focus.restore($('progress-notice').hidden?document.getElementById(anchor()?.passageId)||$('book-page'):trigger);}
}
listen($('progress-use-remote'),'click',event=>reconcileProgress(true,event));listen($('progress-keep-here'),'click',event=>reconcileProgress(false,event));
const toolsResizeObserver=new ResizeObserver(()=>{if(!$('paragraph-tools').hidden)positionTools();});toolsResizeObserver.observe($('paragraph-tools'));
listen(document,'reader:layout',queueReadingFlow);for(const dialog of document.querySelectorAll('dialog'))listen(dialog,'close',queueReadingFlow);
listen(window,'resize',()=>{queueReadingFlow();if(!$('note-panel').hidden)mountPanel();if(!$('paragraph-tools').hidden)positionTools();});
listen($('retry-load'),'click',async event=>{const focus=trackActionFocus(document,event.currentTarget);$('load-error').hidden=true;$('loading').hidden=false;await boot();focus.restore($('load-error').hidden?$('book-page'):$('retry-load'));});
window.marginaliaReader={getBook:()=>book,captureLayout:()=>{const active=readingNavigation?.capture()||(()=>false),epoch=readerEpoch,chapter=state.chapterId;return ()=>!readerDisposed&&readerEpoch===epoch&&state.chapterId===chapter&&active();},restoreLayoutAnchor:a=>{if(a&&document.getElementById(a.passageId)){restoreAnchor(a);persist();}},closeNotes:()=>{if(!$('note-panel').hidden)closePanel();},retryPositionSave:()=>{if(recordsUnavailable||recordsPositionUnresolved||progressSync.paused)return Promise.resolve(null);clearTimeout(persistTimer);const position=captureProgress();if(!position)return Promise.resolve(null);cachePosition({...position,pending:true});return progressSync.save(position);},getPositionSaveState:()=>positionSaveState(latestPositionAttempt,confirmedPosition||records?.position,{durable:latestPositionDurable,unresolved:recordsPositionUnresolved||progressSync.paused}),getPersonalRecords:()=>records,areRecordsAvailable:()=>!recordsUnavailable,getState:()=>({...state}),getAudioSelection:()=>{if($('paragraph-tools').hidden&&$('note-panel').hidden)return null;if(selectedExcerpt)return structuredClone(selectedExcerpt);const p=paragraphMap.get(selectedId);if(!p)return null;const v=passageView(p);return paragraphSnapshot(book,p,p.chapterId,selectedQuoteLanguage,v.variant);},getExcerpt:()=>selectedExcerpt?structuredClone(selectedExcerpt):null,isQuoteVisible:snapshot=>readingChatExcerptIsVisible(snapshot,part=>{const prose=proseForPart(part);return prose?{text:prose.textContent,visible:!!prose.getClientRects().length}:null;}),getChapterId:()=>state.chapterId,isPassageVisible:id=>{const node=document.getElementById(id);return !!node&&(pagination.active?!!pagination.visibleRect(node):node.getBoundingClientRect().bottom>0&&node.getBoundingClientRect().top<innerHeight);},getSelectedId:()=>selectedId,isSelectionActive:()=>!$('paragraph-tools').hidden||!$('note-panel').hidden,getAnchor:()=>{const a=anchor();return a?{...a,chapterId:paragraphMap.get(a.passageId)?.chapterId||state.chapterId}:null;},restoreAnchor:a=>{if(a&&document.getElementById(a.passageId)){readingNavigation.invalidate();restoreAnchor(a);persist();}},ensurePassages:async ids=>{for(const id of new Set(ids.map(id=>paragraphMap.get(id)?.chapterId).filter(Boolean)))await readingBook.ensure(id);},goToPassage:async(id,{validate,preserveSelection}={})=>{const selection=selectedId,p=paragraphMap.get(id);if(!p)return false;if(!await changeChapter(p.chapterId,id,{validate}))return false;if(preserveSelection)selectedId=selection;document.dispatchEvent(new CustomEvent('reader:jump',{detail:{passageId:id}}));return true;},dismissTools};
listen(document,'reader:translation',e=>{const p=paragraphMap.get(e.detail.id);if(!p)return;p.translations=e.detail.translations;const raw=book.sections.flatMap(s=>s.paragraphs).find(x=>x.id===p.id);if(raw)raw.translations=p.translations;const reveal=e.detail.reveal!==false&&selectedId===p.id;if(reveal)state.mode='parallel';if(document.getElementById(p.id))updateText();announceUi(reveal?READER_UI+'translationSaved':READER_UI+'previousTranslationSaved');});
const readerConversation=mountReaderConversation({bookId:selectedBookId,request:readerFetch,session:readerSession,getReader:()=>window.marginaliaReader,root:$('reader-conversation'),integration:readerTools.chatIntegration,announce});
readerTools.setChat(readerConversation);
$('quote-to-ai').hidden=typeof readerConversation?.quoteSelection!=='function';
boot();

listen(document,'reader:record-saved',e=>{const {type,record}=e.detail||{},field=type==='comment'?'comments':type==='question'?'questions':null;if(!field||!record||record.origin!=='user'||!paragraphMap.has(record.passageId)||record.bookId!==book?.bookId||record.contentVersion!==book?.contentVersion)return;if(!records[field].some(r=>r.id===record.id))records[field].push(record);if(!$('note-panel').hidden)renderPanel();dispatchReaderEvent('reader:records-updated');});
listen(document,'reader:milestone-saved',e=>{const record=e.detail?.record;if(!record||record.origin!=='user'||record.bookId!==book?.bookId||record.contentVersion!==book?.contentVersion)return;records.readingMilestones??=[];if(!records.readingMilestones.some(m=>m.id===record.id))records.readingMilestones.push(record);dispatchReaderEvent('reader:records-updated');});

function disposeReader(){if(readerDisposed)return;readerDisposed=true;readerObservability.dispose();ownerSubscribers.clear();for(const off of listenerDisposers)off();listenerDisposers.length=0;toolsResizeObserver.disconnect();readerEpoch++;loadGeneration++;clearTimeout(persistTimer);clearTimeout(excerptTimer);clearTimeout(flowIdle);offLocale();unbindShell();localeControls?.unmount();ownedLabels.clear();ownedLoginLinks.clear();for(const owner of [arrival,accountSurface,contents,chapterEntry,bookInfo,bookActions,readerConversation,personalRecordsUI,highlights,settingsUI,settingsDefaults,pagination,immersion,readerTools]){if(owner?.unmount)owner.unmount();else owner?.dispose?.();}}
listen(window,'pagehide',event=>{if(!event.persisted)disposeReader();});
listen(document,'reader:session-changed',()=>{
  try{for(const subscriber of [...ownerSubscribers]){if(!ownerSubscribers.has(subscriber))continue;try{subscriber();}catch(error){globalThis.reportError?.(error);}}}
  finally{disposeReader();}
});
