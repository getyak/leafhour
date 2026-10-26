import {formatNoteSaveReceipt as noteSaveReceipt,formatReadingSessionReceipt as readingSessionReceipt,matchingSessionSnapshot,formatDraftSaveReceipt as draftSaveReceipt,formatCurrentSessionReceipt as currentSessionReceipt} from './save-receipts.mjs';
import {createPaperCompanion} from './paper-companion.mjs';
import {readerFetch,readerSession,readerStorageKey,selectedBookId} from './reader-api.mjs';
import {readerLoginUrl} from './reader-return.mjs';
import {createReadingClock} from './reading-clock.mjs';
import {readingTimeSourceLabel} from './reading-time-policy.mjs';
import {manualReadingSession,createManualReadingAction} from './reading-manual.mjs';
import {mountManualReading} from './reading-manual-ui.mjs';
import {createReadingOutbox} from './reading-outbox.mjs';
import {createReadingQueueStore} from './reading-queue-store.mjs';
import {createReadingSessionCoordinator} from './reading-session-coordinator.mjs';
import {createReadingMarkActions} from './reading-mark-actions.mjs';
import {createReadingDraftStore} from './reading-draft-store.mjs';
import {createReadingMarkStore} from './reading-mark-store.mjs';
import {readingJourney} from './reading-journey.mjs';
import {pendingReadingBackup,completeReadingBackupBook} from './reading-pending-backup.mjs';
import {restoreReadingEnding,latestReadingEnding} from './reading-ending-context.mjs';
import {readerToolsReady} from './reader-tools.mjs';
import {getUiLinkLocale,t,uiReady,onUiLocaleChange,getUiLocale,uiHref,createUiLabels} from './ui-locale.mjs';
await uiReady;

const tools=await readerToolsReady;
import {trackActionFocus} from './action-focus.mjs';
document.getElementById('ending-companion').append(createPaperCompanion(document,{pose:'bookmark'}));
// GET-184: the coordinator owns the single pill, its timer and holds; this
// script only reports timing status, attention and draft counts into it.
const toolbar=tools.toolbar;
const SESSION_UI='reader.session.',READER_UI='reader.b1.',READER_SHELL='reader.shell.';

const listenerDisposers=[],markFocusOwners=new Set();
function listen(target,event,handler,options){const owned=e=>{if(!disposed)return handler(e);};target.addEventListener(event,owned,options);listenerDisposers.push(()=>target.removeEventListener(event,owned,options));}
// A dynamic node owns its handler. No page-lifetime closure retains a replaced
// draft-list tree; detached targets and disposed owners cannot dispatch actions.
function listenNode(target,event,handler){target.addEventListener(event,e=>{if(!disposed&&target.isConnected!==false)return handler(e);});}

const $=id=>document.getElementById(id),clock=createReadingClock({heartbeatGapMs:5000});
const deviceTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const queueKey=readerStorageKey('marginalia-reading-outbox-v1'),markKey=readerStorageKey('marginalia-reading-marks-v1'),draftKey=readerStorageKey('marginalia-reading-ending-drafts-v1'),endingKey=readerStorageKey('marginalia-reading-ending-context-v1');
let book=null,outbox=null,queueStore=null,syncing=false,coordinator=null,manualAction=null,marks=null,markStore=null,drafts=null,endingAnchor=null,lastEnding=null,guidePaused=false,ready=false,storageFailure=null,lastRenderedStatus=null,frozen=false,endingIsDraft=false,endingOpening=0;
const bridge=()=>window.marginaliaReader,loadJSON=(key,fallback)=>JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback)),saveJSON=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
let disposed=false,loginTarget=null,sessionEpoch=0;
const sourceText=source=>readingTimeSourceLabel(source,Object.fromEntries(['reader_focus','reader_estimate','manual','legacy'].map(code=>[code,t('reading.time.source.'+code)])));
const textFor=(id,params)=>t(id,params?.source?{...params,source:sourceText(params.source)}:params);
const ownedLabels=createUiLabels(textFor);
function label(node,id,params){ownedLabels.text(node,id,params);return node.textContent;}
const notice=(id,params)=>({id,params});
const receiptFor=node=>(id,params)=>{label(node,id,params);return textFor(id,params);};
let endingDate=null;
function endingDateLabel(){if(!endingDate)return;const d=endingDate,time=Number.isFinite(Date.parse(d.at))?new Intl.DateTimeFormat(getUiLocale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(d.at)):'';$('ending-duration').textContent=t(d.old?SESSION_UI+'oldDraft':d.draft?SESSION_UI+'draftDate':SESSION_UI+'endingDate',{time,source:sourceText(d.source),duration:formatTime(d.seconds||0)});}
const offLocale=onUiLocaleChange(()=>{ownedLabels.refresh({pruneDetached:true});endingDateLabel();$('reading-login').href=loginTarget?readerLoginUrl({...loginTarget,ui:getUiLinkLocale()}):uiHref('/library');});
const message=(value,error=false)=>{if(disposed)return;const d=value||notice(READER_UI+'empty');label($('reading-sync'),d.id,d.params);$('reading-sync').classList.toggle('error',error);toolbar.update({attention:error||!$('reading-retry').hidden});};
async function apiReadBook(){const r=await readerFetch('/api/book');if(!r.ok)throw Error('完整原文暂时无法读取');return r.json();}
async function api(path,data){const response=await readerFetch('/api/'+path,{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||'暂时无法保存。'),{status:response.status});return body;}
function actualAnchor(){const chosen=bridge()?.getSelectedId(),chosenNode=chosen&&document.getElementById(chosen),chosenSection=chosen&&book.sections.find(s=>s.paragraphs.some(p=>p.id===chosen));if(chosenNode?.matches('.is-selected,.is-panel-anchor')&&chosenSection)return {chapterId:chosenSection.chapterId,passageId:chosen};const a=bridge()?.getAnchor();if(a&&book.sections.some(s=>s.chapterId===a.chapterId&&s.paragraphs.some(p=>p.id===a.passageId)))return {chapterId:a.chapterId,passageId:a.passageId};const start=book.readingStart||{chapterId:book.sections[0].chapterId,passageId:book.sections[0].paragraphs[0].id};return {...start};}
function records(){return bridge()?.getPersonalRecords?.()||{readingSessions:[],readingMilestones:[]};}
const formatTime=seconds=>{const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');};
const manualUi=mountManualReading({root:$('manual-reading'),getContext:()=>({book,anchor:actualAnchor(),timeZone:deviceTimeZone()}),getAction:()=>manualAction,onOpen:()=>{if(clock.view().status==='active'){clock.pause();checkpoint();}bridge()?.dismissTools({preserveSelection:true});},onSaved:()=>{message(notice('manual.saved'));render();},onFailure:error=>{if(manualAction?.pending()){if(!manualAction.durable())storageFailure=error;message(notice(manualAction.durable()?'manual.unconfirmedLocal':'manual.unconfirmedMemory'),true);render();}}});
function renderTimeSource(view,allowed){
 const ongoing=['active','paused'].includes(view.status),source=ongoing?view.source:$('reading-time-source').value;
 $('reading-timer-settings').hidden=$('reading-time-options').hidden=$('reading-time-help').hidden=$('manual-reading-open').hidden=!allowed;$('reading-time-source').disabled=ongoing;$('manual-reading-open').disabled=!manualAction||!marks||!drafts||!!storageFailure||!allowed;if(ongoing)$('reading-time-source').value=source;
 label($('reading-state'),SESSION_UI+'state.'+(view.status==='paused'&&view.idle?'idlePaused':view.status),{source});
 label($('reading-toggle'),SESSION_UI+'toggle.'+(ongoing?view.status:'idle'),{source});
 label($('reading-time-help'),source==='reader_estimate'?SESSION_UI+'estimateHelp':SESSION_UI+'focusHelp');manualUi.refresh();
}
function pendingCount(){try{return queueStore?.pendingCount||0;}catch{return outbox?.size||0;}}
function render(){if(disposed||!ready)return;ownedLabels.prune();renderDraftCount();renderEndingReceipt();const view=clock.view();if(view.status==='finished'&&view.reason&&lastEnding?.snapshot.id!==view.id)finishCurrentReading();lastRenderedStatus=view.status;const allowed=!!readerSession?.user&&!!selectedBookId;$('reading-time').textContent=formatTime(view.elapsedSeconds);$('reading-toggle').disabled=!coordinator||!!storageFailure;$('reading-end').disabled=!drafts||!['active','paused'].includes(view.status)&&!lastEnding;label($('reading-end'),['active','paused'].includes(view.status)?READER_SHELL+'end':SESSION_UI+'afterReading');$('reading-controls').hidden=!allowed;$('reading-login').hidden=allowed;loginTarget=selectedBookId?{bookId:selectedBookId,passageId:actualAnchor().passageId}:null;$('reading-login').href=loginTarget?readerLoginUrl({...loginTarget,ui:getUiLinkLocale()}):uiHref('/library');label($('reading-login'),selectedBookId?READER_SHELL+'loginReading':SESSION_UI+'startLibrary');$('reading-retry').hidden=!storageFailure&&!coordinator?.pending()&&!pendingCount()&&!manualAction?.pending();$('reading-backup').hidden=$('reading-retry').hidden;renderTimeSource(view,allowed);
  toolbar.update({status:view.status,attention:!!storageFailure||!$('reading-retry').hidden||$('reading-sync').classList.contains('error')});
  const chapter=book.chapters.find(c=>c.id===bridge().getChapterId()),journey=readingJourney(book,records()),canMark=allowed&&marks&&bridge().areRecordsAvailable()&&(!chapter?.kind||chapter.kind==='body');$('chapter-reading-actions').hidden=!canMark||document.body.dataset.continuous==='true';
  for(const control of document.querySelectorAll('[data-mark-chapter]')){control.hidden=!canMark;const id=control.dataset.markChapter;control.setAttribute('aria-pressed',String(journey.chapterStatuses[id]==='read'));label(control,marks?.pending(id)?SESSION_UI+'retryMark':journey.chapterStatuses[id]==='read'?SESSION_UI+'reopenMark':READER_UI+'markChapter');}
  if(canMark){const pending=marks.pending(chapter.id),read=journey.chapterStatuses[chapter.id]==='read';$('mark-chapter-read').setAttribute('aria-pressed',String(read));label($('mark-chapter-read'),pending?SESSION_UI+'retryMark':read?SESSION_UI+'reopenChapter':READER_SHELL+'chapterRead');label($('chapter-read-state'),read?SESSION_UI+'chapterMarked':SESSION_UI+'chapterConfirm');}
}
function endingSessionState(){
  const snapshot=lastEnding?.snapshot;if(!snapshot)return {confirmed:false,durable:false};
  const confirmed=outbox?.confirmed(snapshot)||(records().readingSessions||[]).some(row=>matchingSessionSnapshot(snapshot,row));
  let durable=false;try{durable=queueStore?.all().some(row=>matchingSessionSnapshot(snapshot,row))||false;}catch{}
  return {confirmed:!!confirmed,durable};
}
function renderEndingReceipt(){
  if(!lastEnding||endingIsDraft){label($('ending-session-status'),READER_UI+'empty');label($('ending-position-status'),READER_UI+'empty');$('ending-retry').hidden=true;return;}
  const state=endingSessionState();$('ending-session-status').textContent=readingSessionReceipt(state,receiptFor($('ending-session-status')));const position=bridge()?.getPositionSaveState?.();$('ending-retry').hidden=state.confirmed&&(position?.confirmed||position?.unresolved);label($('ending-position-status'),position?.unresolved?SESSION_UI+'positionConflict':position?.confirmed?SESSION_UI+'positionSaved':position?.durable?SESSION_UI+'positionLocal':SESSION_UI+'positionMemory');
}
async function sync(){if(disposed)return;if(!coordinator||!marks||!drafts){if(storageFailure){ready=false;storageFailure=null;setup();}return;}if(syncing)return;syncing=true;try{let result;for(let batch=0;batch<2;batch++){outbox.refresh();result=await coordinator.retry();if(result.error||!pendingCount())break;}if(result?.error)message(notice(endingSessionState().confirmed?SESSION_UI+'queueCleanup':coordinator.pending()?'receipt.session.pendingMemory':'receipt.session.pendingLocal'),true);else if(!coordinator.pending()){message(pendingCount()?notice(SESSION_UI+'pendingCount',{count:pendingCount()}):currentSessionReceipt(clock.view(),lastEnding?.snapshot,endingSessionState(),(id,params)=>notice(id,params)));storageFailure=null;}const manualReceipt=manualAction?.reconcile();if(manualReceipt)manualUi.confirm(manualReceipt);}catch(error){storageFailure=error;message(notice(SESSION_UI+'storageFailed'),true);}finally{syncing=false;render();}}

function checkpoint(){if(disposed||!coordinator||['idle','finished'].includes(clock.view().status))return;try{coordinator.checkpoint(actualAnchor());sync();}catch(error){storageFailure=error;message(notice(SESSION_UI+'storageFailed'),true);}render();}
function lifecycle(){if(disposed)return;clock.setVisible(!frozen&&!document.hidden);clock.setFocused(!frozen&&document.hasFocus());checkpoint();render();}
function renderDraftCount(){let count=0;try{count=drafts?.list().length||0;}catch{}$('reading-drafts-open').hidden=!count;label($('reading-drafts-open'),SESSION_UI+'drafts',{count});toolbar.update({draftCount:count});}
function persistDrafts(){try{drafts.persist();renderDraftCount();return true;}catch{return false;}}
function sourceFor(anchor){return book.sections.find(s=>s.chapterId===anchor.chapterId)?.paragraphs.find(p=>p.id===anchor.passageId);}
function showSource(prefix,anchor){const chapter=book.chapters.find(c=>c.id===anchor.chapterId),source=sourceFor(anchor);label($(prefix+'-source-label'),SESSION_UI+'source',{chapter:chapter?.title.zh||''});ownedLabels.forget($(prefix+'-source'));if(source?.original)$(prefix+'-source').textContent=source.original.slice(0,350);else label($(prefix+'-source'),SESSION_UI+'sourceUnavailable');$(prefix+'-source').lang=book.sourceLanguage==='zh'?'zh-Hans':'en';}
function updateEnding(){for(const type of ['comment','question']){const key=type+':'+endingAnchor.passageId,pending=drafts.pending(key),busy=drafts.busy(key);$('ending-'+type).value=drafts.text(key);$('save-ending-'+type).disabled=busy||!drafts.text(key).trim()&&!pending;label($('save-ending-'+type),busy?'record.saving':pending?'record.retry':type==='comment'?READER_SHELL+'saveUnderstanding':READER_SHELL+'saveQuestion');label($('ending-'+type+'-pending'),pending?READER_UI+'pendingNote':READER_UI+'empty',{text:pending?.text.slice(0,100)});}}
function cacheEnding(snapshot){const ending=restoreReadingEnding(snapshot,book);if(!ending)return;lastEnding=ending;try{saveJSON(endingKey,ending.snapshot);}catch{message(notice(SESSION_UI+'endingStorageFailed'),true);}}
function finishCurrentReading(){let snapshot;try{snapshot=coordinator.finish(actualAnchor());}catch(error){snapshot=coordinator.pending();storageFailure=error;message(notice(SESSION_UI+'finishedPending'),true);}if(snapshot)cacheEnding(snapshot);bridge()?.retryPositionSave?.().catch(()=>{});sync();}
async function openEnding(options={}){
  if(disposed||!drafts)return;const scope=endingScope(),ticket=++endingOpening;
  if(!scope.current())return;const draft=options.draft;endingIsDraft=!!draft;
  if(draft){if(clock.view().status==='active'){clock.pause();checkpoint();}const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===draft.key.split(':').slice(1).join(':')));if(!section)return;endingAnchor={chapterId:section.chapterId,passageId:draft.key.split(':').slice(1).join(':')};}
  else{if(['active','paused'].includes(clock.view().status))finishCurrentReading();if(!lastEnding)return;endingAnchor={...lastEnding.anchor};}
  const anchor={...endingAnchor};try{await scope.reader.ensurePassages([anchor.passageId]);}catch{if(scope.current()&&ticket===endingOpening)message(notice(SESSION_UI+'sourceDraft'),true);return;}if(!scope.current()||ticket!==endingOpening)return;endingAnchor=anchor;
  showSource('ending',endingAnchor);bridge().dismissTools({preserveSelection:true});
  endingDate={at:draft?.updatedAt||lastEnding.snapshot.endedAt,draft:!!draft,old:!!draft&&Date.parse(draft.updatedAt)<946684800000,source:draft?'legacy':lastEnding.snapshot.source,seconds:draft?0:lastEnding.durationSeconds};endingDateLabel();
  label($('ending-source-summary'),SESSION_UI+'stoppedQuote',{quote:sourceFor(endingAnchor)?.original?.slice(0,44)||''});
  for(const type of ['comment','question']){const key=type+':'+endingAnchor.passageId;drafts.activate(key,draft?.key===key?draft.id:undefined);label($('ending-'+type+'-status'),READER_UI+'empty');const field=type==='comment'?'comments':'questions';drafts.reconcile(key,records()[field]||[]);}
  if(!persistDrafts())message(notice('record.copyFirst'),true);updateEnding();render();$('reading-ending').showModal();
}
function openDraftList(){
  if(!drafts)return;if(clock.view().status==='active'){clock.pause();checkpoint();}
  const list=$('reading-drafts-list');list.replaceChildren();
  for(const row of drafts.list()){
    const passageId=row.key.split(':').slice(1).join(':'),section=book.sections.find(s=>s.paragraphs.some(p=>p.id===passageId)),source=section?.paragraphs.find(p=>p.id===passageId),button=document.createElement('button'),kind=document.createElement('span'),text=document.createElement('strong'),quote=document.createElement('small');
    label(kind,SESSION_UI+'draft.'+(row.key.startsWith('comment:')?'thought':'question')+(row.pending?'.pending':'.local'));text.textContent=(row.text||row.pending?.text||'').slice(0,140);label(quote,SESSION_UI+'sourceQuote',{quote:source?.original?.slice(0,80)||''});button.type='button';button.append(kind,text,quote);listenNode(button,'click',()=>{$('reading-drafts').close();openEnding({draft:row});});list.append(button);
  }
  if(!list.childElementCount){const p=document.createElement('p');label(p,SESSION_UI+'noDrafts');list.append(p);}$('reading-drafts').showModal();render();
}
// Each explicit ending operation captures the actual owner, book, store and
// bridge. A readiness reset invalidates ABA even if the old objects return.
function endingScope(){
  const scope={epoch:sessionEpoch,reader:bridge(),book,bookId:book?.bookId,version:book?.contentVersion,store:drafts,owner:readerSession?.user,ownerId:readerSession?.user?.id};
  scope.current=()=>!disposed&&sessionEpoch===scope.epoch&&bridge()===scope.reader&&book===scope.book&&drafts===scope.store&&readerSession?.user===scope.owner&&readerSession?.user?.id===scope.ownerId&&scope.reader?.getBook()===scope.book&&scope.book?.bookId===scope.bookId&&scope.book?.contentVersion===scope.version;
  return scope;
}
async function saveEnding(type){
  if(disposed||!drafts||!endingAnchor)return;
  const scope=endingScope(),store=scope.store,anchor={...endingAnchor},key=type+':'+anchor.passageId,draftId=store.activeId(key);
  if(!scope.current()||store.busy(key))return;
  store.edit(key,$('ending-'+type).value);if(!store.text(key).trim()&&!store.pending(key))return;
  try{await scope.reader.ensurePassages([anchor.passageId]);}
  catch{if(scope.current())label($('ending-'+type+'-status'),SESSION_UI+'sourceDraft');return;}
  if(!scope.current()||store.activeId(key)!==draftId||store.busy(key))return;
  const original=sourceFor(anchor)?.original;if(typeof original!=='string'){message(notice(SESSION_UI+'sourceDraft'),true);return;}
  const keepDrafts=()=>{if(!scope.current())return false;try{store.persist();if(scope.current())renderDraftCount();return true;}catch{return false;}};
  const payload=store.begin(key,{passageId:anchor.passageId,contentVersion:scope.version,quote:original.slice(0,1000),quoteOrigin:'original',quoteLanguage:scope.book.sourceLanguage||'en'},()=>crypto.randomUUID());
  try{
    const durable=keepDrafts();if(!scope.current())return;updateEnding();label($('ending-'+type+'-status'),durable?'record.saving':'record.copyFirst');
    const record=await api(type==='comment'?'comments':'questions',payload);
    if(!scope.current())return;
    if(!store.acknowledge(key,record,draftId))throw Error('服务尚未确认这次提交。');
    const cached=keepDrafts();if(!scope.current())return;
    document.dispatchEvent(new CustomEvent('reader:record-saved',{detail:{type,record}}));
    if(scope.current()&&endingAnchor?.passageId===anchor.passageId&&store.activeId(key)===draftId)$('ending-'+type+'-status').textContent=noteSaveReceipt({confirmed:true,durable:cached,hasDraft:!!store.text(key)},receiptFor($('ending-'+type+'-status')));
  }catch(error){
    if(scope.current()&&endingAnchor?.passageId===anchor.passageId&&store.activeId(key)===draftId)$('ending-'+type+'-status').textContent=noteSaveReceipt({durable:keepDrafts()},receiptFor($('ending-'+type+'-status')));
  }finally{
    // Busy is in-memory state on the original store; never persist or render
    // during stale cleanup, including when a replacement store is active.
    store.finish(key,draftId);
    if(scope.current()&&endingAnchor?.passageId===anchor.passageId&&store.activeId(key)===draftId)updateEnding();
  }
}
async function markChapter(chapterId=bridge().getChapterId()){if(disposed)return;const chapter=book.chapters.find(c=>c.id===chapterId);if(!marks||!chapter)return;const buttons=[$('mark-chapter-read'),...document.querySelectorAll('[data-mark-chapter]')].filter(b=>b.id==='mark-chapter-read'||b.dataset.markChapter===chapterId),trigger=buttons.find(b=>b===document.activeElement),focus=trackActionFocus(document,trigger);markFocusOwners.add(focus);buttons.forEach(b=>b.disabled=true);try{const read=readingJourney(book,records()).chapterStatuses[chapter.id]==='read',record=await marks.submit(read?'chapter_reopened':'chapter_read',chapter.id);if(disposed)return;document.dispatchEvent(new CustomEvent('reader:milestone-saved',{detail:{record}}));message(notice(record.type==='chapter_read'?SESSION_UI+'marked':SESSION_UI+'reopened'));}catch(error){message(notice(SESSION_UI+'markFailed'),true);}finally{if(!disposed){buttons.forEach(b=>b.disabled=false);render();focus.restore(!trigger?.hidden&&bridge().getChapterId()===chapterId?trigger:null);}else focus.stop();markFocusOwners.delete(focus);}}
function setup(){if(disposed||ready||!bridge()?.getBook()||document.body.dataset.ready!=='true')return;book=bridge().getBook();ready=true;$('reading-session').hidden=false;clock.setVisible(!document.hidden);clock.setFocused(document.hasFocus());if(readerSession?.user&&selectedBookId){try{queueStore??=createReadingQueueStore({storage:localStorage,scope:queueKey,book});outbox??=createReadingOutbox({load:queueStore.load,save:queueStore.save,send:row=>api('reading-sessions',row)});coordinator??=createReadingSessionCoordinator({clock,outbox});manualAction??=createManualReadingAction({build:manualReadingSession,own:queueStore.own,enqueue:outbox.enqueue,flush:outbox.flush,confirmed:outbox.confirmed});markStore??=createReadingMarkStore({storage:localStorage,scope:markKey,book});marks??=createReadingMarkActions({book,...markStore,send:row=>api('reading-milestones',row)});drafts??=createReadingDraftStore({storage:localStorage,scope:draftKey,book});try{lastEnding=restoreReadingEnding(loadJSON(endingKey,null),book);}catch{}if(!lastEnding)lastEnding=latestReadingEnding(queueStore.all().concat(records().readingSessions||[]),book);sync();}catch(error){storageFailure=error;message(notice(SESSION_UI+'storageFailed'),true);}}render();}
listen($('reading-toggle'),'click',()=>{if(!coordinator)return;try{const state=clock.view().status;if(['idle','finished'].includes(state)){const id=crypto.randomUUID();queueStore.own(id);coordinator.start({id,bookId:book.bookId,contentVersion:book.contentVersion,timeZone:deviceTimeZone(),anchor:actualAnchor(),source:$('reading-time-source').value});}else if(state==='active')clock.pause();else clock.resume();checkpoint();sync();}catch(error){storageFailure=error;message(notice(SESSION_UI+'storageFailed'),true);}render();});
listen($('reading-end'),'click',openEnding);listen($('reading-drafts-open'),'click',openDraftList);listen($('reading-retry'),'click',async()=>{const retry=$('reading-retry'),focus=trackActionFocus(document,retry);await sync();if(manualAction?.pending()&&!manualAction.durable()){try{manualUi.confirm(await manualAction.retry());storageFailure=null;}catch(error){message(notice('manual.unconfirmedMemory'),true);}render();}if(!frozen)focus.restore(retry.hidden?$('reading-toggle'):retry);else focus.stop();});listen($('ending-retry'),'click',async()=>{const retry=$('ending-retry'),focus=trackActionFocus(document,retry);await Promise.allSettled([sync(),bridge()?.retryPositionSave?.()]);if($('reading-ending').open&&!frozen)focus.restore(retry.hidden?$('ending-comment'):retry);else focus.stop();});listen(document,'reader:position-status',renderEndingReceipt);listen($('mark-chapter-read'),'click',()=>markChapter());listen(document,'reader:mark-chapter',event=>markChapter(event.detail.chapterId));listen(document,'reader:flow-extended',render);
listen($('reading-backup'),'click',async()=>{
 const pendingMemory=[coordinator?.pending(),manualAction?.pending()].filter(Boolean),ticket={epoch:sessionEpoch,owner:readerSession?.user?.id||null,id:book?.bookId,version:book?.contentVersion};
 const assertOwner=()=>{const live=bridge()?.getBook?.();if(disposed||frozen||ticket.epoch!==sessionEpoch||ticket.owner!==(readerSession?.user?.id||null)||window.marginaliaPaletteAdapter?.getOwner&&ticket.owner!==(window.marginaliaPaletteAdapter.getOwner()||null)||live?.bookId!==ticket.id||live?.contentVersion!==ticket.version)throw Error('Backup owner changed');};
 try{
  assertOwner();let data,rawExport=false,loaderFailed=false;
  try{
   if(!coordinator||!marks||!drafts)throw Error('Cache unavailable');
   let retained;try{retained=await import('./reading-retained-backup.mjs');}catch(error){loaderFailed=true;throw error;}assertOwner();
   const rows=queueStore.all(),pending=[coordinator?.pending(),manualAction?.pending()].filter(Boolean);
   const backupBook=await completeReadingBackupBook(book,async()=>{assertOwner();const value=await apiReadBook();assertOwner();return value;});assertOwner();
   data=retained.retainedLibraryBackup({backup:pendingReadingBackup(backupBook,[...rows,...pending]),storage:localStorage,owner:ticket.owner}).backup;
  }catch(error){
   assertOwner();if(loaderFailed)throw error;
   rawExport=true;data={kind:'marginalia-unreadable-pending',book,pendingReadingSessions:[...new Map([...pendingMemory,coordinator?.pending(),manualAction?.pending()].filter(Boolean).map(row=>[row.id,row])).values()],localReadingDrafts:{version:1,entries:drafts?.memoryRecovery?.()||[]},rawStores:{...(queueStore?.rawRecovery()||{[queueKey]:localStorage.getItem(queueKey)}),...(markStore?.rawRecovery()||{[markKey]:localStorage.getItem(markKey)}),...(drafts?.rawRecovery()||{[draftKey]:localStorage.getItem(draftKey)}),[endingKey]:localStorage.getItem(endingKey)}};
  }
  assertOwner();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='leafhour-pending-reading.json';assertOwner();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(notice(rawExport?SESSION_UI+'rawBackup':SESSION_UI+'backedUp'));
 }catch{try{assertOwner();message(notice(SESSION_UI+'backupFailed'),true);}catch{}}
});
listen($('reading-guide-open'),'click',()=>{guidePaused=clock.view().status==='active';if(guidePaused){clock.pause();checkpoint();}showSource('guide',actualAnchor());bridge().dismissTools({preserveSelection:true});$('guide-session-state').hidden=!guidePaused;$('reading-guide').showModal();render();});
listen($('reading-guide-return'),'click',()=>{$('reading-guide').close();});
listen($('reading-guide'),'close',()=>{const resume=guidePaused;guidePaused=false;if(resume&&clock.view().status==='paused'&&!document.hidden&&!frozen){clock.resume();checkpoint();}render();});
for(const b of document.querySelectorAll('[data-reading-close]'))listen(b,'click',()=>$(b.dataset.readingClose).close());
for(const type of ['comment','question']){listen($('ending-'+type),'input',()=>{if(!drafts||!endingAnchor)return;const key=type+':'+endingAnchor.passageId;drafts.edit(key,$('ending-'+type).value);$('save-ending-'+type).disabled=drafts.busy(key)||!drafts.text(key).trim()&&!drafts.pending(key);$('ending-'+type+'-status').textContent=draftSaveReceipt({durable:persistDrafts()},receiptFor($('ending-'+type+'-status')));});listen($('save-ending-'+type),'click',()=>saveEnding(type));}
listen($('reading-time-source'),'change',render);listen($('manual-reading-open'),'click',()=>manualUi.open());
for(const type of ['pointerdown','keydown','scroll'])listen(document,type,event=>{if(!event.isTrusted||!ready||frozen||event.target?.closest?.('#reading-toggle'))return;const before=clock.view().status;clock.activity();if(before!==clock.view().status)render();},{passive:true,capture:true});
listen(document,'reader:ready',()=>{sessionEpoch++;endingOpening++;setup();});listen(document,'reader:chapter',()=>{if(ready){clock.setContext(actualAnchor());render();}});listen(document,'reader:records-updated',()=>{if(ready&&!lastEnding)lastEnding=latestReadingEnding(records().readingSessions||[],book);render();});listen(document,'reader:drafts-updated',renderDraftCount);
listen(document,'freeze',()=>{frozen=true;lifecycle();});listen(document,'resume',()=>{frozen=false;lifecycle();if(pendingCount())sync();});listen(document,'visibilitychange',lifecycle);listen(window,'blur',lifecycle);listen(window,'focus',()=>{lifecycle();if(pendingCount())sync();});listen(window,'online',sync);listen(window,'storage',event=>{if(!readerSession?.user)return;if(queueStore?.matchesKey(event.key))sync();if(queueStore?.matchesKey(event.key)||markStore?.matchesKey(event.key)||drafts?.matchesKey(event.key))render();});
listen(window,'pagehide',()=>{if(coordinator&&!['idle','finished'].includes(clock.view().status)){try{cacheEnding(coordinator.finish(actualAnchor()));coordinator.retry();}catch{const pending=coordinator.pending();if(pending)cacheEnding(pending);}}});listen(window,'pageshow',()=>{lifecycle();if(pendingCount())sync();});
const tickTimer=setInterval(()=>{if(!ready)return;const view=clock.view();if(view.status!==lastRenderedStatus)render();else{const label=formatTime(view.elapsedSeconds);if($('reading-time').textContent!==label)$('reading-time').textContent=label;}},1000);const checkpointTimer=setInterval(checkpoint,30000);setup();
function disposeSession(){if(disposed)return;disposed=true;for(const focus of markFocusOwners)focus.stop();markFocusOwners.clear();sessionEpoch++;endingOpening++;for(const off of listenerDisposers)off();listenerDisposers.length=0;ready=false;offLocale();ownedLabels.clear();manualUi.unmount();clearInterval(tickTimer);clearInterval(checkpointTimer);}
listen(window,'pagehide',event=>{if(!event.persisted)disposeSession();});listen(document,'reader:session-changed',disposeSession);
