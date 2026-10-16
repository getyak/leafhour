import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('the local reader serves its bundled atmosphere assets with correct types and no arbitrary file access',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-atmosphere-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bookPath=path.join(dir,'book.json');
  await writeFile(bookPath,JSON.stringify({bookId:'atmosphere-book',chapters:[{id:'ch01'}],sections:[{chapterId:'ch01',paragraphs:[{id:'p1'}]}]}));
  const server=await createReaderServer({bookPath,recordsPath:path.join(dir,'records.json')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  for(const scene of ['forest','rain','hearth','sea']){
    const response=await fetch(base+'/assets/atmospheres/'+scene+'.jpg');
    assert.equal(response.status,200,scene);assert.equal(response.headers.get('content-type'),'image/jpeg');
    const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(0,2)],[255,216]);
  }
  for(const sound of ['wind','birds','rain','fire','waves']){
    const response=await fetch(base+'/assets/atmospheres/'+sound+'.mp3');
    assert.equal(response.status,200,sound);assert.equal(response.headers.get('content-type'),'audio/mpeg');
    assert.ok((await response.arrayBuffer()).byteLength>1000);
  }
  for(const pathname of ['/reader-atmosphere.js','/reader-atmosphere.css','/atmosphere-audio.mjs','/atmosphere-state.mjs','/hearth-motion.mjs'])assert.equal((await fetch(base+pathname)).status,200,pathname);
  for(const pathname of ['/assets/atmospheres/private.json','/assets/atmospheres/..%2f..%2f.env'])assert.equal((await fetch(base+pathname)).status,404);
});
