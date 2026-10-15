import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {audioHash,audioError} from './audio-content.mjs';
export const emptyAudio=()=>({kind:'marginalia-audio',schemaVersion:1,sessions:[],dialogues:[],preferences:null});
export async function createAudioStore({dataDir}){
 await mkdir(dataDir,{recursive:true,mode:0o700});const queues=new Map();
 const filename=(owner,book)=>path.join(dataDir,audioHash([owner,book])+'.json');
 const read=async(owner,book)=>{try{return JSON.parse(await readFile(filename(owner,book),'utf8'));}catch(e){if(e.code==='ENOENT')return emptyAudio();throw e;}};
 const mutate=async(owner,book,operation)=>{const file=filename(owner,book),prior=queues.get(file)||Promise.resolve(),work=prior.catch(()=>{}).then(async()=>{const data=await read(owner,book),result=await operation(data),temp=file+'.'+randomUUID()+'.pending';await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,file);return structuredClone(result);});queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}};
 const clipPath=key=>{if(!/^[a-f0-9]{64}$/.test(key))throw audioError('声音标识无效。');return path.join(dataDir,key+'.audio');};
 return {read,mutate,async putClip(key,bytes){const file=clipPath(key),tmp=file+'.'+randomUUID()+'.pending';await writeFile(tmp,bytes,{mode:0o600});await rename(tmp,file);},async getClip(key){try{return await readFile(clipPath(key));}catch(e){if(e.code==='ENOENT')throw audioError('声音文件尚未准备好。',404);throw e;}}};
}
