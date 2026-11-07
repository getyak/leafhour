import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('public beta routes work without an account and preserve trial language on first paint',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-beta-routes-'));
 const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),env:{},translator:null,sendCode:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 for(const [slug,locale]of [['en','en'],['zh-hans','zh-Hans'],['zh-hant','zh-Hant'],['ja','ja']]){
  const response=await fetch(base+'/'+slug+'/beta');assert.equal(response.status,200,'Missing public beta route: '+slug);
  const html=await response.text();assert.match(html,new RegExp('<html lang="'+locale+'"'));
  assert.ok(html.includes('href="/read?book=gutenberg-alice&amp;ui='+locale+'"'));
  assert.ok(html.includes('href="https://leafhour.com/'+slug+'/beta"'));
  assert.match(html,/mailto:support@leafhour\.com/);
  assert.equal((html.match(/id="site-theme"/g)||[]).length,1);
  assert.ok(html.includes('href="/'+slug+'/beta" aria-current="page"'));
  if(slug==='en')assert.equal(await(await fetch(base+'/beta')).text(),html);
 }
 for(const file of ['beta.css','beta-feedback.mjs','beta-channel.mjs'])assert.equal((await fetch(base+'/'+file)).status,200,file+' must be public');
 assert.equal((await fetch(base+'/beta',{method:'POST'})).status,405,'An email composer must not accidentally accept stored feedback');
});

test('hosted beta flat files and directory aliases match the local renderer',async t=>{
 const {buildBetaPages}=await import('../tools/build-vercel.mjs');assert.equal(typeof buildBetaPages,'function');
 const {betaPage}=await import('../app/beta-page.mjs');
 const outputDir=await mkdtemp(path.join(tmpdir(),'leafhour-beta-static-'));t.after(()=>rm(outputDir,{recursive:true,force:true}));
 await buildBetaPages({outputDir});
 for(const [slug,locale]of [['en','en'],['zh-hans','zh-Hans'],['zh-hant','zh-Hant'],['ja','ja']]){
  const html=await readFile(path.join(outputDir,slug,'beta.html'),'utf8');
  assert.equal(html,betaPage({locale}));assert.equal(html,await readFile(path.join(outputDir,slug,'beta/index.html'),'utf8'));
  assert.ok(html.includes('hreflang="x-default" href="https://leafhour.com/en/beta"'));
 }
 assert.equal(await readFile(path.join(outputDir,'beta.html'),'utf8'),await readFile(path.join(outputDir,'en/beta.html'),'utf8'));
 assert.equal(await readFile(path.join(outputDir,'beta/index.html'),'utf8'),await readFile(path.join(outputDir,'beta.html'),'utf8'));
});
