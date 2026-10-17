import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import path from 'node:path';

// Never replace variables supplied by the host. The single .env is canonical;
// older .env.audio settings are read first as a compatibility fallback.
export async function loadLocalEnvironment({directory=process.cwd(),env=process.env}={}){
 const inherited=new Set(Object.keys(env));let legacyAudio=false;
 for(const filename of ['.env.audio','.env']){
  let content;try{content=await readFile(path.join(directory,filename),'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(filename==='.env.audio')legacyAudio=true;
  for(const [key,value]of Object.entries(parseEnv(content)))if(!inherited.has(key))env[key]=value;
 }
 return {legacyAudio};
}
