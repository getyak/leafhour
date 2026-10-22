import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('only checkout pages permit the official embedded payment script and frames',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-checkout-headers-'));
 const server=await createReaderServer({bookPath:path.join(dir,'missing.json'),recordsPath:path.join(dir,'records.json'),allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['/pricing','/en/pricing','/zh-hans/pricing','/zh-hant/pricing','/ja/pricing','/billing']){
   const response=await fetch(base+route);assert.equal(response.status,200,route);
   const policy=response.headers.get('content-security-policy');
   assert.match(policy,/script-src 'self' https:\/\/www\.creem\.io(?:;|\s)/,route);
   assert.match(policy,/frame-src [^;]*https:\/\/\*\.creem\.io/,route);
   assert.match(policy,/frame-ancestors 'none'/);assert.doesNotMatch(policy,/unsafe-eval|script-src[^;]*unsafe-inline/);
  }
  for(const file of ['pricing-checkout.mjs','pricing-checkout-flow.mjs','pricing-checkout-markup.mjs','checkout-embed.mjs','pricing-checkout.css']){
   const response=await fetch(base+'/'+file);assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),file.endsWith('.css')?/text\/css/:/(?:text|application)\/javascript/);assert.equal(await response.text(),await readFile(new URL('../app/'+file,import.meta.url),'utf8'),file);
  }
  for(const route of ['/','/library','/read','/en/terms','/api/auth/session']){
   const policy=(await fetch(base+route)).headers.get('content-security-policy');assert.ok(!policy.includes('creem.io'),route);assert.ok(!policy.includes('unsafe-inline'),route);
  }
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  for(const source of ['/pricing','/:locale(en|zh-hans|zh-hant|ja)/pricing','/billing']){
   const policy=config.headers.find(h=>h.source===source)?.headers.find(h=>h.key==='Content-Security-Policy')?.value;
   assert.ok(policy?.includes("script-src 'self' https://www.creem.io"),source);
   assert.ok(policy?.includes('frame-src'),source);
  }
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
