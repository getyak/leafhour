import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createReaderServer} from '../server/server.mjs';
import {createPortal} from '../server/portal.mjs';
import {ANNOTATION_PUBLIC_FILES,RETAINED_BACKUP_PUBLIC_FILES} from '../tools/build-reader-web.mjs';

class Response extends EventEmitter{
 constructor(){super();this.statusCode=200;this.headers={};this.chunks=[];this.writableEnded=false;}
 setHeader(key,value){this.headers[key.toLowerCase()]=value;}
 getHeader(key){return this.headers[key.toLowerCase()];}
 writeHead(status,headers={}){this.statusCode=status;for(const [key,value]of Object.entries(headers))this.setHeader(key,value);return this;}
 end(value){if(value!==undefined)this.chunks.push(Buffer.from(value));this.writableEnded=true;}
 get body(){return Buffer.concat(this.chunks);}
}

test('both actual server handlers serve every raw annotation and retained-backup dependency byte-exactly',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reader-annotation-assets-'));
 const store={read:async(key,fallback)=>structuredClone(fallback),mutate:async()=>assert.fail('Static requests must not mutate data')};
 const options={dataStore:store,authService:{userFor:async()=>null},allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,annotationGenerator:null,generator:null,paddleProvider:null};
 const server=await createReaderServer({...options,bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json'),portalDataDir:dir});
 // Exercise actual request listeners without opening sockets or browser resources.
 server.address=()=>({port:8330});
 const portal=await createPortal({...options,dataDir:dir,catalogDir:null});
 t.after(async()=>{await server.experiences.close();await server.portal.chat.close();await server.portal.ingestionRunner.close();await portal.chat.close();await portal.ingestionRunner.close();await rm(dir,{recursive:true,force:true});});
 for(const file of new Set([...ANNOTATION_PUBLIC_FILES,...RETAINED_BACKUP_PUBLIC_FILES])){
  const route='/'+file.slice(4),expected=await readFile(new URL('../'+file,import.meta.url));
  for(const kind of ['readerServer','isolatedPortal']){
   const req=new EventEmitter();Object.assign(req,{method:'GET',url:route,headers:{host:'127.0.0.1:8330'},socket:{localAddress:'127.0.0.1',localPort:8330}});const res=new Response();
   if(kind==='readerServer')await server.listeners('request')[0](req,res);
   else {const handled=await portal.handle({req,res,url:new URL('http://127.0.0.1:8330'+route),send:(status,data,type='application/json')=>{res.statusCode=status;res.setHeader('Content-Type',type+'; charset=utf-8');res.end(type==='application/json'?JSON.stringify(data):data);}});assert.equal(handled,true,kind+' handles '+route);}
   assert.equal(res.statusCode,200,kind+' status '+route);assert.match(res.getHeader('Content-Type'),file.endsWith('.css')?/^text\/css/:/^text\/javascript/,kind+' MIME '+route);assert.deepEqual(res.body,expected,kind+' bytes '+route);
  }
 }
});
