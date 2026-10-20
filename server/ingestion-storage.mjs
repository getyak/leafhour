import {mkdir,readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {digest} from './document-import.mjs';
export function createIngestionStorage({dataDir}){
 const queues=new Map(),file=k=>path.join(dataDir,digest(k));
 const read=async(k,d)=>{try{return JSON.parse(await readFile(file(k),'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(d);throw e;}};
 const write=async(k,b)=>{await mkdir(dataDir,{recursive:true,mode:0o700});const tmp=file(k)+'.'+randomUUID();await writeFile(tmp,b,{mode:0o600});await rename(tmp,file(k));};
 return {read,mutate:async(k,d,fn)=>{const prior=queues.get(k)||Promise.resolve(),p=prior.catch(()=>{}).then(async()=>{const row=await read(k,d),r=await fn(row);await write(k,JSON.stringify(row));return r;});queues.set(k,p);try{return await p;}finally{if(queues.get(k)===p)queues.delete(k);}},putBlob:write,blob:k=>readFile(file(k)),adoptToFile:async(k,target)=>{await mkdir(path.dirname(target),{recursive:true,mode:0o700});const tmp=target+'.'+randomUUID()+'.pending';await copyFile(file(k),tmp,constants.COPYFILE_FICLONE);await rename(tmp,target);}};
}
