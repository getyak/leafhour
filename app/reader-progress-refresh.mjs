import {createForegroundRefresh} from './account-shelf-sync.mjs';
import {mergeLoadedReadingRecords} from './reading-load.mjs';

// Network reconciliation is optional after the reader is usable. The synchronous
// reader still owns real-event checkpoints, durable local storage and editors.
export function adoptForegroundProgress(host,{fresh,revision}){
 const current=host.current(),book=current.book,changedSource=fresh.bookId!==book.bookId||fresh.contentVersion!==book.contentVersion;
 const remoteRevision=Number.isSafeInteger(fresh.position?.revision)?fresh.position.revision:0;
 if(!changedSource){
  const records=mergeLoadedReadingRecords(fresh,current.records);
  if(remoteRevision<revision)records.position=current.records.position;
  host.adopt(records);
 }
 if(changedSource||remoteRevision>revision){
  let local=null;try{local=host.local();}catch{}
  if(local?.pending)host.retain({bookId:book.bookId,local,remote:fresh.position});
  host.sync.pause();host.conflict(changedSource);
 }
 host.updated();
}
export function createReaderProgressRefresh(host){
 return createForegroundRefresh({
  capture:()=>{const value=host.current();return {owner:value.owner,epoch:value.epoch,bookId:value.book?.bookId,version:value.book?.contentVersion};},
  isCurrent:ticket=>{const value=host.current();return value.ready&&!!ticket.owner&&ticket.owner===value.owner&&ticket.epoch===value.epoch&&ticket.bookId===value.book?.bookId&&ticket.version===value.book?.contentVersion;},
  read:async()=>{
   await host.sync.settle();const revision=host.sync.revision,version=host.current().book.contentVersion;
   const fresh=await host.read();
   if(host.sync.pending||host.sync.revision!==revision||host.current().book.contentVersion!==version)return null;
   return {fresh,revision};
  },apply:value=>adoptForegroundProgress(host,value)
 });
}
