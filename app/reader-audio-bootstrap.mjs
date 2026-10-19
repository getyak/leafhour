import {t,uiReady,createUiLabels,onUiLocaleChange} from './ui-locale.mjs';
import {readerFetch,readerStorageKey,readerSession} from './reader-api.mjs';
import {mountListenChapterEntry} from './reader-navigation.mjs';
import {readAudioMetadata,audioVoiceUi} from './reader-audio-metadata.mjs';

const loadAudio=retry=>retry?import('./reader-audio.js?retry=1'):import('./reader-audio.js');
const owners=new WeakMap();
export function mountAudioBootstrap({document=globalThis.document,window=document.defaultView,storage=globalThis.localStorage,fetchAudio=readerFetch,storageKey=readerStorageKey,session=readerSession,load=loadAudio,ready=uiReady,mountChapter=mountListenChapterEntry}={}){
 if(owners.has(document))return owners.get(document);
 const format=(id,params={})=>t(id,Object.fromEntries(Object.entries(params).map(([key,value])=>[key,value?.id?format(value.id,value.params):value])));
 const $=id=>document.getElementById(id),reader=()=>window.marginaliaReader,labels=createUiLabels(format);
 const cleanup=[];let disposed=false,suspended=false,generation=0,selectionGeneration=0,picker=null,restoration=null,pending=null,scope=null,controller=null,mounting=null,code=null,loading=null,failure=null,attempt=0,committingSelection=false;
 const listen=(target,event,fn,options)=>{target.addEventListener(event,fn,options);cleanup.push(()=>target.removeEventListener(event,fn,options));};
 const notice=$('audio-bootstrap-status'),message=$('audio-bootstrap-message'),retry=$('audio-bootstrap-retry'),cancel=$('audio-bootstrap-cancel'),reload=$('audio-bootstrap-reload'),input=$('audio-import-input');
 const label=(element,id,params)=>{if(!element)return;element.removeAttribute('data-ui');element.removeAttribute('lang');labels.text(element,id,params);};
 for(const [id,key] of [['show-audio','read'],['listen-from-here','fromHere'],['settings-listening-records','records'],['export-listening','exportTitle'],['import-listening','restoreTitle']])label($(id),'audio.'+key);
 label($('open-voice-settings')?.firstElementChild,'audio.preferences');
 labels.attr(input,'aria-label','audioBootstrap.chooseFile');label(retry,'audioBootstrap.retry');label(cancel,'audioBootstrap.cancel');label(reload,'audioBootstrap.reload');
 const offLocale=onUiLocaleChange(()=>labels.refresh({pruneDetached:true}));cleanup.push(()=>{offLocale();labels.clear();});
 const current=()=>{const owner=reader(),book=owner?.getBook();return book?{owner,bookId:book.bookId,contentVersion:book.contentVersion,ownerId:session?.user?.id||null}:null;};
 const same=(a,b)=>a&&b&&a.owner===b.owner&&a.bookId===b.bookId&&a.contentVersion===b.contentVersion&&a.ownerId===b.ownerId;
 const validScope=s=>!disposed&&!suspended&&s===scope&&same(s,current());
 const watchedOverlays=new WeakSet();
 const ownsOverlay=intent=>{const open=[...document.querySelectorAll('dialog[open]')];return !!intent&&open.length===intent.overlays.length&&open.every((node,i)=>node===intent.overlays[i]);};
 function watchOverlay(overlay){if(!overlay||watchedOverlays.has(overlay))return;watchedOverlays.add(overlay);listen(overlay,'close',()=>{if(pending?.overlay===overlay||picker?.overlay===overlay||restoration?.overlay===overlay)clearPending();});}
 function hideStatus(intent,restoreFocus=false){const focused=notice.contains(document.activeElement);notice.hidden=true;document.body.append(notice);if(restoreFocus&&focused&&ownsOverlay(intent)){const target=intent.focus;if(target?.isConnected&&(!intent.overlay||intent.overlay.contains(target)))target.focus({preventScroll:true});else intent.overlay?.querySelector('button')?.focus({preventScroll:true});}}
 // Cancel initialization locally; a ready player remains owned until its normal lifecycle ends.
 function clearPending({retainMount=false,restoreFocus=false}={}){const intent=pending||picker||restoration;if(pending)pending.canceled=true;if(restoration)restoration.canceled=true;restoration=null;pending=null;picker=null;hideStatus(intent,restoreFocus);input.value='';if(mounting&&!retainMount){controller?.dispose();controller=null;mounting=null;}}
 function status(id,intent=pending||restoration){if(!ownsOverlay(intent))return;const overlay=intent.overlay;const focus=!!intent?.action&&(notice.hidden||notice.contains(document.activeElement));watchOverlay(overlay);(overlay||document.body).append(notice);label(message,id);notice.setAttribute('role',id==='audioBootstrap.failed'?'alert':'status');notice.hidden=false;retry.hidden=id!=='audioBootstrap.failed'||attempt>=2;reload.hidden=id!=='audioBootstrap.failed'||attempt<2;cancel.hidden=false;if(focus)(id==='audioBootstrap.failed'?(attempt>=2?reload:retry):cancel).focus({preventScroll:true});}
 function selected(preserveIntent=false){const version=preserveIntent?selectionGeneration:++selectionGeneration;if(!preserveIntent&&pending)clearPending();queueMicrotask(()=>{if(disposed||version!==selectionGeneration)return;const has=!!reader()?.getExcerpt?.();label($('show-audio'),has?'audio.readSelection':'audio.read');});}
 function capture(action,file){
  const s=scope,c=current();if(!validScope(s)||!same(s,c))return null;
  const intent={action,file,scope:s,generation,selectionGeneration,overlay:document.activeElement?.closest?.('dialog[open]')||document.querySelector('dialog[open]'),overlays:[...document.querySelectorAll('dialog[open]')],focus:document.activeElement,canceled:false};
  watchOverlay(intent.overlay);
  // Only the committed dispatcher's synchronous dismissal preserves this intent.
  intent.dismissTools=()=>{committingSelection=true;try{c.owner.dismissTools();}finally{committingSelection=false;}};
  // Capture all content-bearing input before modal/toolbar focus can collapse it.
  if(action==='show-audio'||action==='listen-from-here'){
   const book=c.owner.getBook(),state=c.owner.getState(),selection=c.owner.getAudioSelection?.()||c.owner.getExcerpt();
   if(selection?.parts?.length){const parts=selection.parts.map(part=>Object.freeze({...part})),language=parts[0].language;
    let values=parts;if(action==='listen-from-here'){const rows=book.sections.filter(s=>s.chapterId===selection.chapterId).flatMap(s=>s.paragraphs),at=rows.findIndex(p=>p.id===parts[0].passageId);values=rows.slice(at).map(p=>Object.freeze({passageId:p.id,language}));}
    intent.input=Object.freeze({contentVersion:book.contentVersion,chapterId:selection.chapterId,language,variant:parts[0].variant||state.variant,parts:Object.freeze(values)});
   }
  }
  intent.valid=()=>validScope(s)&&!intent.canceled&&intent.generation===generation&&intent.selectionGeneration===selectionGeneration;
  return intent;
 }
 function codeReady(manual=false){
  if(code)return Promise.resolve(code);if(loading)return loading;
  if(failure&&!manual)return Promise.reject(failure);if(attempt>=2)return Promise.reject(failure||Error('Reload required'));
  attempt++;loading=Promise.resolve().then(()=>load(attempt===2)).then(value=>{code=value;failure=null;return value;},error=>{failure=error;throw error;}).finally(()=>{loading=null;});return loading;
 }
 async function ensure(s,valid,manual=false){
  const module=await codeReady(manual);if(!valid())return null;
  await ready;if(!valid())return null;
  if(controller&&!mounting)return controller;
  if(!mounting){
   const mounted=module.mountReaderAudio({document,window,readerFetch:fetchAudio,readerStorageKey:storageKey,readerSession:session,localStorage:storage,metadata:s.metadata,importInput:input,openImport:()=>activate('import-listening'),validScope:()=>validScope(s)});
   controller=mounted;
   const task=mounted.ready.then(()=>{if(controller===mounted)labels.forget($('settings-listening-summary'));return mounted;},error=>{if(controller===mounted)controller=null;throw error;}).finally(()=>{if(mounting===task)mounting=null;});mounting=task;
  }
  const mounted=await mounting;if(!valid())return null;return mounted;
 }
 async function run(intent,manual=false){
  if(!intent?.valid())return;status('audioBootstrap.loading');
  try{
   const mounted=await ensure(intent.scope,intent.valid,manual);if(!mounted||!intent.valid()||pending!==intent)return;
   // A different overlay opened during loading owns its focus and close action.
   if(!ownsOverlay(intent)){clearPending();return;}
   pending=null;hideStatus(intent);
   await mounted.dispatch(intent.action,intent);
  }catch(error){if(intent.valid()&&pending===intent){if(!ownsOverlay(intent))clearPending();else status('audioBootstrap.failed');}}
 }
 function activate(action,file){
  if(disposed||suspended)return;
  if(action==='import-listening'&&!file){clearPending();picker=capture(action);if(picker)input.click();return;}
  if(pending?.action===action&&pending.valid())return;
  clearPending({retainMount:true});const intent=capture(action,file);if(!intent){clearPending();return;}
  pending=intent;void run(intent);
 }
 async function restore(intent,manual=false){
  try{const mounted=await ensure(intent.scope,intent.valid,manual);if(mounted&&intent.valid()&&restoration===intent){restoration=null;if(!pending)hideStatus(intent);}}
  catch(error){if(intent.valid()&&restoration===intent&&!pending)status('audioBootstrap.failed');}
 }
 function hasRestore(){
  // Only the current owner/book's three existing authorized resume markers.
  try{if(storage.getItem(storageKey('leafhour-guide-job-v1')))return true;}catch{}
  for(const [key,field] of [['leafhour-guide-request-v1','idempotencyKey'],['marginalia-audio-position-v1','sessionId']])try{if(JSON.parse(storage.getItem(storageKey(key))||'null')?.[field])return true;}catch{}
  return false;
 }
 function refresh(){
  if(disposed||suspended)return;generation++;selectionGeneration++;clearPending();
  const next=current();
  if(!same(scope,next)){controller?.dispose();controller=null;mounting=null;scope=next;
   if(scope){const s=scope;s.metadata=ready.then(()=>readAudioMetadata({readerFetch:fetchAudio,readerStorageKey:storageKey,readerSession:session,storage,valid:()=>validScope(s)}));
    label($('settings-listening-summary'),'audioBootstrap.loading');
    s.metadata.then(snapshot=>{if(!validScope(s))return;const p=snapshot.prefs;if(snapshot.error)label($('settings-listening-summary'),'audioBootstrap.metadataFailed');else label($('settings-listening-summary'),'audio.summary',{voice:audioVoiceUi(snapshot.capabilities.voices?.find(v=>v.id===p.narrator))||{id:'audio.narrator'},speed:p.speed,follow:{id:p.follow?'audio.following':'audio.freeReading'}});}).catch(()=>{});
   }
  }
  selected();if(scope&&hasRestore()){const s=scope,stamp=generation,intent={scope:s,overlay:document.querySelector('dialog[open]'),overlays:[...document.querySelectorAll('dialog[open]')],canceled:false};watchOverlay(intent.overlay);intent.valid=()=>validScope(s)&&generation===stamp&&!intent.canceled;restoration=intent;void restore(intent);}
 }
 listen(input,'change',()=>{const file=input.files?.[0],intent=picker;picker=null;if(!file||!intent?.valid()){input.value='';return;}intent.file=file;pending=intent;void run(intent);});
 for(const action of ['show-audio','listen-from-here','open-voice-settings','settings-listening-records','export-listening','import-listening'])listen($(action),'click',()=>activate(action));
 const chapter=mountChapter({document,onListenChapter:()=>activate('listen-chapter')});cleanup.push(()=>chapter?.unmount?.());
 listen(retry,'click',()=>{if(loading)return;if(pending?.valid())void run(pending,true);else if(restoration?.valid())void restore(restoration,true);});listen(cancel,'click',()=>clearPending({restoreFocus:true}));listen(reload,'click',()=>window.location.reload());
 listen(document,'reader:selection',()=>selected());listen(document,'reader:selection-end',()=>selected(committingSelection));listen(document,'reader:ready',refresh);listen(document,'reader:session-changed',()=>{generation++;selectionGeneration++;clearPending();controller?.dispose();controller=null;mounting=null;scope=null;});
 // Explicit closing a source overlay cancels its pending action. Opening a new
 // overlay is rechecked at publication, without closing it or moving focus.
 for(const overlay of document.querySelectorAll('dialog'))watchOverlay(overlay);
 listen(window,'pagehide',event=>{controller?.dispatch('pagehide',event);generation++;selectionGeneration++;clearPending();suspended=true;if(!controller||mounting){controller?.dispose();controller=null;mounting=null;scope=null;}if(!event.persisted)dispose();});
 listen(window,'pageshow',event=>{if(event.persisted&&!disposed){suspended=false;refresh();}});
 function dispose(){if(disposed)return;disposed=true;generation++;clearPending();controller?.dispose();for(const release of cleanup.splice(0).reverse())release();owners.delete(document);}
 const handle={dispose};owners.set(document,handle);
 refresh();void ready.then(()=>{if(!disposed)labels.refresh();});
 return handle;
}
mountAudioBootstrap();
