import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPortal} from '../server/portal.mjs';

test('compiled offline metadata is served as exact JSON bytes for GET and without a body for HEAD',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'leafhour-offline-http-')),webDir=path.join(root,'web'),manifest={version:'a'.repeat(64),resources:[]},bytes=Buffer.from(JSON.stringify(manifest)+'\n');await mkdir(webDir);await writeFile(path.join(webDir,'offline-resources.json'),bytes);
 const portal=await createPortal({dataDir:path.join(root,'data'),compiledWeb:true,webDir,env:{},translator:null,chatGenerator:null,speechProvider:null});
 t.after(async()=>{await portal.chat.close();await portal.audio?.close();await portal.ingestionRunner.close();await rm(root,{recursive:true,force:true});});
 for(const method of ['GET','HEAD']){
  const headers={},res={statusCode:0,setHeader(key,value){headers[key.toLowerCase()]=value;},end(body){this.body=body;}};
  const send=(status,value,type='application/json')=>{res.statusCode=status;res.setHeader('Content-Type',type);res.end(type==='application/json'?JSON.stringify(value):value);};
  assert.equal(await portal.handle({req:{method,headers:{host:'localhost'}},res,url:new URL('http://localhost/offline-resources.json'),send}),true);assert.equal(res.statusCode,200);assert.match(headers['content-type'],/^application\/json/);assert.equal(headers['cache-control'],'no-cache');
  if(method==='GET')assert.deepEqual(JSON.parse(res.body.toString('utf8')),manifest);else assert.equal(res.body,undefined);
 }
});
