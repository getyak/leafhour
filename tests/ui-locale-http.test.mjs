import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'ui-locale-http-'));
  const server=await createReaderServer({bookPath:path.join(directory,'missing-book.json'),recordsPath:path.join(directory,'records.json'),portalDataDir:path.join(directory,'portal'),env:{},allowLocal:false,sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null,generator:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});});
  return 'http://127.0.0.1:'+server.address().port;
}

test('local library and reader can fetch the same physical locale modules, including finite retry URLs',async t=>{
  const base=await fixture(t);
  const files=['ui-locale.mjs','ui-locale-codec.mjs','ui-locale-controls.mjs','ui-catalogs/en.mjs','ui-catalogs/zh-Hans.mjs','ui-catalogs/zh-Hant.mjs','ui-catalogs/ja.mjs'];
  const cases=files.map(file=>({url:'/'+file,file}));
  for(const code of ['zh-Hans','zh-Hant','ja'])cases.push({url:'/ui-catalogs/'+code+'.mjs?retry=1',file:'ui-catalogs/'+code+'.mjs'});
  for(const entry of cases){
    const expected=await readFile(new URL('../app/'+entry.file,import.meta.url));
    const response=await fetch(base+entry.url);
    assert.equal(response.status,200,entry.url+' must be served by the actual shared local route');
    assert.match(response.headers.get('content-type'),/^text\/javascript(?:;|$)/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected,entry.url+' must return its exact public module, not HTML or another dictionary');
    const head=await fetch(base+entry.url,{method:'HEAD'});
    assert.equal(head.status,200,entry.url+' HEAD');assert.match(head.headers.get('content-type'),/^text\/javascript(?:;|$)/);assert.equal((await head.arrayBuffer()).byteLength,0);
  }
});

test('locale module routes retain exact public paths and the existing static request method policy',async t=>{
  const base=await fixture(t);
  for(const pathname of ['/ui-catalogs/no-such-locale.mjs','/ui-catalogs/ja.js','/UI-Locale.mjs','/server/auth-policy.mjs']){
    const response=await fetch(base+pathname);assert.equal(response.status,404,pathname);await response.arrayBuffer();
  }
  for(const pathname of ['/ui-locale.mjs','/ui-catalogs/ja.mjs?retry=1']){
    const response=await fetch(base+pathname,{method:'POST',headers:{Origin:base}});assert.equal(response.status,405,pathname);await response.arrayBuffer();
  }
});
