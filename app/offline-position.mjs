import {resolveReadingPosition} from './reading-progress.mjs';
import {resolveReaderOpening as resolveOnlineReaderOpening} from './reader-entry.mjs';

const copy=value=>structuredClone(value);
export function resolveReaderOpening(options={}){
 const book=options.book,fallback=book?.reading?.offlineFallback;
 if(!fallback)return resolveOnlineReaderOpening(options);
 const source=book.sections.filter(section=>section.chapterId===fallback.chapterId).flatMap(section=>section.paragraphs).find(paragraph=>paragraph.id===fallback.passageId);
 if(!book.reading.loadedChapters?.includes(fallback.chapterId)||!source||source.unloaded||typeof source.original!=='string')throw Object.assign(Error('offline_missing'),{code:'offline_missing'});
 // Keep the caller's URL intact so reconnect can retry the original citation.
 // Saved preferences still apply; the temporary chapter is not a resume point.
 const query=new URLSearchParams(options.query||'');
 for(const name of ['passage','note','action','contentVersion','layer','sample'])query.delete(name);
 const opening=resolveOnlineReaderOpening({...options,query});
 return {...opening,chapterId:fallback.chapterId,position:null,chosen:null,saved:null,requestedEntry:null,sampleEntry:null,offlineFallback:copy(fallback)};
}
export function offlinePositionChoice({book,local,remote,remoteAvailable=true}){
 if(local?.pending!==true)return null;
 const position=resolveReadingPosition(book,local);
 if(position&&(!remoteAvailable||(local.baseRevision||0)===(remote?.revision||0)))return null;
 return {bookId:book.bookId,local:copy(local),remote:remote?copy(remote):null,position,unmapped:!position};
}

// Recovery data belongs to the existing account/book position key. It is never
// part of ordinary chapter-cache eviction and is kept after an explicit choice.
export function createOfflinePositionRecovery({storage,key,bookId=null}){
 const recoveryKey=key+'|recovery-v1',memory=new Map();
 const remember=value=>{const row={bookId:value.bookId||bookId,local:copy(value.local),remote:value.remote?copy(value.remote):null};memory.set(JSON.stringify(row),row);return row;};
 function stored(){const raw=storage.getItem(recoveryKey);if(raw===null)return [];const value=JSON.parse(raw);if(value?.schemaVersion!==1||!Array.isArray(value.positions))throw Error('Position recovery data is unreadable');return value.positions;}
 function retain(value){
  remember(value);
  try{const rows=new Map(stored().map(row=>[JSON.stringify(row),row]));for(const [id,row]of memory)rows.set(id,row);storage.setItem(recoveryKey,JSON.stringify({schemaVersion:1,positions:[...rows.values()]}));return true;}catch{return false;}
 }
 function write(position,{protectPending=false}={}){
  try{
   const raw=storage.getItem(key),previous=raw===null?null:JSON.parse(raw);
   if(previous?.pending&&JSON.stringify(previous)!==JSON.stringify(position)){
    if(protectPending)return false;
    if(previous.contentVersion!==position.contentVersion&&!retain({bookId,local:previous,remote:position}))return false;
   }
   storage.setItem(key,JSON.stringify(position));return true;
  }catch{return false;}
 }
 function has(){try{return memory.size>0||storage.getItem(recoveryKey)!==null;}catch{return memory.size>0;}}
 function backup(){
  const rows=new Map(),rawStores={};
  for(const name of [key,recoveryKey])try{const raw=storage.getItem(name);if(raw!==null)rawStores[name]=raw;}catch{}
  try{for(const row of stored())rows.set(JSON.stringify(row),row);}catch{}
  for(const [id,row]of memory)rows.set(id,row);
  return {kind:'leafhour-position-recovery',schemaVersion:1,bookId,positions:copy([...rows.values()]),rawStores};
 }
 function refreshBackup({document,createButton,label,onFailure}){
  let action=document.getElementById('progress-recovery-backup');
  if(!action&&has()){
   const host=document.querySelector('.book-info-actions');if(!host)return;
   action=createButton();action.id='progress-recovery-backup';label(action);host.append(action);
   action.addEventListener('click',()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify(backup(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='leafhour-reading-position-recovery.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{onFailure();}});
  }
  if(action)action.hidden=!has();
 }
 return {retain,write,has,backup,refreshBackup};
}
