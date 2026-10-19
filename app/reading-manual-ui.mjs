import {localReadingTimestamp} from './reading-manual.mjs';
import {t,getUiLocale,onUiLocaleChange} from './ui-locale.mjs';

const localMinute=stamp=>{const d=new Date(stamp),pad=n=>String(n).padStart(2,'0');return String(d.getFullYear()).padStart(4,'0')+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());};
const actualRange=row=>{const f=new Intl.DateTimeFormat(getUiLocale(),{timeZone:row.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'});return f.format(new Date(row.startedAt))+' → '+f.format(new Date(row.endedAt));};
export function mountManualReading({root,getContext,getAction,onOpen=()=>{},onSaved=()=>{},onFailure=()=>{},now=Date.now}){
 const $=selector=>root.querySelector(selector),start=$('#manual-reading-start'),end=$('#manual-reading-end'),save=$('#manual-reading-save'),status=$('#manual-reading-status'),preview=$('#manual-reading-preview'),close=$('[data-manual-close]'),form=$('form');
 let context=null,busy=false,done=false,disposed=false,generation=0,pendingRow=null,previewRow=null,statusId=null,contextInvalid=false,openedAction=null;
 // Only cached UI descriptors are read here. In particular, locale publication
 // must not reread the action, alter a datetime-local input, or resubmit a UUID.
 function updateLabels(){
  if(disposed)return;
  save.textContent=t(busy?'manual.saving':!contextInvalid&&pendingRow?'manual.retry':'manual.save');
  status.textContent=statusId?t(statusId):'';
  if(context)$('#manual-reading-zone').textContent=t('manual.zone',{zone:context.timeZone,title:context.book.title.zh||context.book.title.en||''});
  if(previewRow)preview.textContent=actualRange(previewRow);else if(context)preview.textContent=t('manual.preview');
 }
 const offLocale=onUiLocaleChange(updateLabels);
 function refresh(){
  if(disposed)return;const action=getAction();
  if(context&&!contextInvalid){const next=getContext();if(action!==openedAction||next?.book?.bookId!==context.book.bookId||next.book.contentVersion!==context.book.contentVersion){contextInvalid=true;generation++;busy=false;statusId='manual.bookChanged';}}
  pendingRow=contextInvalid?null:action?.pending()||null;start.disabled=end.disabled=contextInvalid||busy||!!pendingRow||done;save.disabled=contextInvalid||busy||done;if(pendingRow)previewRow=structuredClone(pendingRow);updateLabels();
 }
 function confirm(row){if(disposed||!row)return;refresh();if(contextInvalid||context&&(row.bookId!==context.book.bookId||row.contentVersion!==context.book.contentVersion))return;done=true;statusId='manual.saved';previewRow=structuredClone(row);refresh();onSaved(row);}
 function current(stamp,action,snapshot){
  if(disposed||contextInvalid||!root.open||stamp!==generation||getAction()!==action)return false;
  const next=getContext();return next?.book?.bookId===snapshot.book.bookId&&next.book.contentVersion===snapshot.book.contentVersion;
 }
 const ui={confirm,refresh,open(){
  if(disposed||busy||!getAction())return false;generation++;onOpen();const next=getContext();context={...next,book:{...next.book,title:{...next.book.title}}};openedAction=getAction();contextInvalid=false;done=false;statusId=null;
  const pending=getAction().pending(),at=Math.floor(now()/60000)*60000;
  start.value=localMinute(pending?.startedAt||at-15*60000);end.value=localMinute(pending?.endedAt||at);
  previewRow=pending?structuredClone(pending):null;if(pending)statusId='manual.pending';refresh();root.showModal();(pending?save:start).focus();return true;
 },unmount(){if(disposed)return;disposed=true;generation++;offLocale();close.removeEventListener('click',closeDialog);root.removeEventListener('close',closed);root.removeEventListener('cancel',cancelled);form.removeEventListener('submit',submit);}};
 const invalidate=()=>{generation++;busy=false;};
 const closeDialog=()=>{if(disposed)return;invalidate();root.close();};
 const cancelled=()=>{if(!disposed)invalidate();};
 const closed=()=>{if(disposed||root.open)return;invalidate();refresh();};
 async function submit(event){
  event.preventDefault();if(disposed||contextInvalid||busy||done)return;
  // Check the opened action before constructing an ID or handing any input
  // to a queue. Guarding only its eventual callback is too late for an owner
  // change: enqueue is already a write.
  refresh();if(disposed||contextInvalid||busy||done)return;busy=true;
  const stamp=generation,action=getAction(),snapshot=context;let failureId='manual.failed',submitted=false;
  if(action!==openedAction){contextInvalid=true;generation++;busy=false;statusId='manual.bookChanged';refresh();return;}
  try{
   const next=getContext();if(!context||next.book.bookId!==context.book.bookId||next.book.contentVersion!==context.book.contentVersion){failureId='manual.bookChanged';throw Error('Manual reading context changed');}
   let input;
   if(!action.pending()){
    if(context.timeZone!==Intl.DateTimeFormat().resolvedOptions().timeZone){failureId='manual.zoneChanged';throw Error('Device time zone changed');}
    let startedAt,endedAt;try{startedAt=localReadingTimestamp(start.value);endedAt=localReadingTimestamp(end.value);}catch(error){failureId='manual.invalidDate';throw error;}
    input={...context,id:crypto.randomUUID(),startedAt,endedAt};previewRow=structuredClone(input);
   }
   refresh();if(disposed||contextInvalid||stamp!==generation)return;submitted=true;const row=await action.submit(input);if(current(stamp,action,snapshot))confirm(row);
  }catch(error){
   if(disposed||stamp!==generation||submitted&&!current(stamp,action,snapshot))return;
   const pending=action?.pending();statusId=pending?(action.durable()?'manual.unconfirmedLocal':'manual.unconfirmedMemory'):failureId;updateLabels();onFailure(error);
  }finally{
   if(!disposed&&stamp===generation){busy=false;if(!submitted||current(stamp,action,snapshot)){refresh();if(root.open&&root.ownerDocument.activeElement===root.ownerDocument.body)(done?close:save).focus();}}
  }
 }
 close.addEventListener('click',closeDialog);root.addEventListener('close',closed);root.addEventListener('cancel',cancelled);form.addEventListener('submit',submit);
 return ui;
}
