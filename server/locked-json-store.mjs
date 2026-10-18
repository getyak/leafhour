import {mkdir,readFile,writeFile,rename,unlink,readdir,rmdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {digest,fail} from './document-import.mjs';

// Short JSON mutations, never held across model generation. Hosted instances
// supply their own reader_document_cas store; local instances share an OS lock
// so independent Node processes cannot mutate the same key at once. Extracted
// unchanged from the book introduction store so both keep identical semantics.
export function createLockedJsonStore({dataDir,busyMessage='正在保存，请稍后重试'}){
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
      if(Date.now()-start>5000)throw fail(busyMessage,503);
      await delay(10);
    }
  }
  return {read,mutate:async(key,fallback,fn)=>{
    const file=filename(key),release=await lock(file);let pending;
    try{const row=await read(key,fallback),result=await fn(row);pending=file+'.'+randomUUID()+'.pending';await writeFile(pending,JSON.stringify(row),{mode:0o600});await rename(pending,file);pending=null;return structuredClone(result);}
    finally{if(pending)await unlink(pending).catch(()=>{});await release();}
  }};
}
