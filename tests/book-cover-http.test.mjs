import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {bookCoverArtwork} from '../app/book-cover-artwork.mjs';

test('anonymous self-hosted covers serve exact static modules and approved image bytes while unknown paths stay closed',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-book-covers-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},translator:null,sendCode:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  for(const file of ['book-cover-ui.mjs','book-binding.mjs','book-cover-labels.mjs','book-cover-artwork.mjs','book-binding.css']){
    const response=await fetch(base+'/'+file);assert.equal(response.status,200,file+' must be available without signing in');
    assert.match(response.headers.get('content-type'),file.endsWith('.css')?/text\/css/:/javascript/);
    assert.equal(await response.text(),await readFile(new URL('../app/'+file,import.meta.url),'utf8'));
  }
  for(const entry of bookCoverArtwork['gutenberg-walden'].srcSet.split(', ')){
    const url=entry.split(' ')[0],response=await fetch(base+url),expected=await readFile(new URL('../app'+url.split('?')[0],import.meta.url));
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/webp/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    const head=await fetch(base+url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  }
  for(const url of ['/book-covers/unlisted-640.webp','/book-covers/walden-999.webp','/book-covers/%2e%2e%2fAGENTS.md','/book-covers/walden-640.webp%2f..%2f..%2fserver%2fportal.mjs','/book-cover-private.mjs','/server/portal.mjs'])assert.equal((await fetch(base+url)).status,404,url);
});
