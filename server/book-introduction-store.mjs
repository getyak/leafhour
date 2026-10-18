import {mkdir,readFile,writeFile,rename,unlink,readdir,rmdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {digest,fail} from './document-import.mjs';
import {validateBookIntroduction} from '../app/book-introduction.mjs';

// Leases are short JSON mutations, never held while a model is running. The
// hosted store supplies its transaction; local instances share an OS lock.
function localStore(dataDir){
  const filename=key=>path.join(dataDir,digest(key)+'.json');
  const read=async(key,fallback)=>{try{return JSON.parse(await readFile(filename(key),'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw e;}};
  async function lock(file){
    const dir=file+'.lock',owner=path.join(dir,process.pid+'-'+randomUUID()),start=Date.now();
    await mkdir(path.dirname(file),{recursive:true,mode:0o700});
    for(;;){
      try{
        await mkdir(dir,{mode:0o700});
        try{await writeFile(owner,'',{flag:'wx',mode:0o600});}catch(e){await rmdir(dir).catch(()=>{});throw e;}
        return async()=>{await unlink(owner);await rmdir(dir).catch(e=>{if(!['ENOENT','ENOTEMPTY'].includes(e.code))throw e;});};
      }catch(e){if(e.code!=='EEXIST')throw e;}
      try{
        if(Date.now()-(await stat(dir)).mtimeMs>30000){
          const rows=await readdir(dir);
          if(rows.length===1&&/^\d+-[a-f0-9-]+$/.test(rows[0])){
            const pid=Number(rows[0].split('-')[0]);let dead=false;
            try{process.kill(pid,0);}catch(e){dead=e.code==='ESRCH';}
            if(dead){try{await unlink(path.join(dir,rows[0]));await rmdir(dir);}catch(e){if(!['ENOENT','ENOTEMPTY'].includes(e.code))throw e;}}
          }else if(!rows.length)await rmdir(dir).catch(()=>{});
        }
      }catch(e){if(e.code!=='ENOENT')throw e;}
      if(Date.now()-start>5000)throw fail('简介正在保存，请稍后重试',503);
      await delay(10);
    }
  }
  return {read,mutate:async(key,fallback,fn)=>{
    const file=filename(key),release=await lock(file);let pending;
    try{const row=await read(key,fallback),result=await fn(row);pending=file+'.'+randomUUID()+'.pending';await writeFile(pending,JSON.stringify(row),{mode:0o600});await rename(pending,file);pending=null;return structuredClone(result);}
    finally{if(pending)await unlink(pending).catch(()=>{});await release();}
  }};
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
      row.value=validateBookIntroduction(value,book);delete row.lease;return row.value;
    });
  }
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
    return store.mutate(key(user,book),{},row=>{if(!preserveExisting||!valid(row,book)){row.value=value;delete row.lease;}return null;});
  }
  return {get,claim,complete,release,reserve,releaseQuota,restore};
}
