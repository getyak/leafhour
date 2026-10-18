import path from 'node:path';
import {digest,fail} from './document-import.mjs';
import {createLockedJsonStore} from './locked-json-store.mjs';
import {validateBookIntroduction} from '../app/book-introduction.mjs';

// Leases are short JSON mutations, never held while a model is running. The
// hosted store supplies its transaction; local instances share an OS lock.
function localStore(dataDir){
  return createLockedJsonStore({dataDir,busyMessage:'简介正在保存，请稍后重试'});
}
export function createBookIntroductionStore({dataDir,dataStore=null}){
  const store=dataStore||localStore(dataDir);
  const account=user=>{if(typeof user?.id!=='string'||!user.id||user.id.length>512||user.is_anonymous)throw fail('请先进入自己的书房',401);return digest(user.id);};
  const key=(user,book)=>path.join(dataDir,'users',account(user),'introductions',digest(book.bookId));
  const valid=(row,book)=>row.value?.contentVersion===book.contentVersion?validateBookIntroduction(row.value,book):null;
  async function get(user,book){return valid(await store.read(key(user,book),{}),book);}
  async function claim(user,book,nonce,now,ttl){
    return store.mutate(key(user,book),{},row=>{
      const value=valid(row,book);if(value)return {value};
      if(row.lease?.expiresAt>now)throw fail('这本书的 AI 简介正在生成，请稍后再打开',409);
      row.lease={nonce,contentVersion:book.contentVersion,expiresAt:now+ttl};return {claimed:true};
    });
  }
  async function complete(user,book,nonce,value,now,isActive=()=>true){
    return store.mutate(key(user,book),{},row=>{
      if(!isActive())throw fail('这次简介已取消，尚未保存',409);
      if(row.lease?.nonce!==nonce||row.lease.contentVersion!==book.contentVersion||row.lease.expiresAt<=now)throw fail('这次简介已过期，请重新打开后重试',409);
      row.value=validateBookIntroduction(value,book);row.completedBy=nonce;delete row.lease;return row.value;
    });
  }
  // A CAS already dispatched to durable storage cannot be aborted locally.
  // Compensate a late commit only when this exact generation still owns it;
  // a subsequent restore or another generation must remain untouched.
  async function discard(user,book,nonce){return store.mutate(key(user,book),{},row=>{if(row.completedBy===nonce){delete row.value;delete row.completedBy;}return null;});}
  async function release(user,book,nonce){return store.mutate(key(user,book),{},row=>{if(row.lease?.nonce===nonce)delete row.lease;return null;});}
  const quotaKey=path.join(dataDir,'limits','book-introductions');
  async function reserve(user,nonce,now,ttl){
    const owner=account(user);
    return store.mutate(quotaKey,{requests:[],active:{}},row=>{
      row.requests=row.requests.filter(r=>r.at>now-86400000);
      for(const [id,lease]of Object.entries(row.active))if(lease.expiresAt<=now)delete row.active[id];
      const hour=row.requests.filter(r=>r.at>now-3600000);
      if(hour.filter(r=>r.owner===owner).length>=5||hour.length>=50||row.requests.length>=200||Object.keys(row.active).length>=2)throw fail('AI 简介的生成额度暂时用完，请稍后再试',429);
      row.requests.push({owner,nonce,at:now});row.active[nonce]={expiresAt:now+ttl};return null;
    });
  }
  async function releaseQuota(nonce){return store.mutate(quotaKey,{requests:[],active:{}},row=>{delete row.active[nonce];return null;});}
  async function restore(user,book,{preserveExisting=false}={}){
    if(!book.introduction)return;
    const value=validateBookIntroduction(book.introduction,book);
    return store.mutate(key(user,book),{},row=>{if(!preserveExisting||!valid(row,book)){row.value=value;delete row.completedBy;delete row.lease;}return null;});
  }
  return {get,claim,complete,discard,release,reserve,releaseQuota,restore};
}
