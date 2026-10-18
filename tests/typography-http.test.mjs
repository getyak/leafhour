import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'app/fonts/newsreader/manifest.json'),'utf8'));
const upright=manifest.fonts.find(entry=>entry.file==='newsreader-var.woff2');
const italic=manifest.fonts.find(entry=>entry.file==='newsreader-italic-var.woff2');
const preloadRe=/<link rel="preload" href="(\/fonts\/newsreader\/[^"]+)" as="font" type="font\/woff2" crossorigin>/g;

const dir=await mkdtemp(path.join(tmpdir(),'leafhour-typography-http-'));
const server=await createReaderServer({bookPath:path.join(dir,'missing-book.json'),recordsPath:path.join(dir,'records.json'),allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
test.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});

test('the served font routes return the exact reviewed WOFF2 bytes with font MIME',async()=>{
  for(const [route,entry]of [['/fonts/newsreader/newsreader-var.woff2',upright],['/fonts/newsreader/newsreader-italic-var.woff2',italic]]){
    const response=await fetch(base+route);
    assert.equal(response.status,200,route);
    assert.equal(response.headers.get('content-type'),'font/woff2',route+' must be served as font/woff2');
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length,entry.bytes,route);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,route);
    assert.equal(bytes.subarray(0,4).toString('latin1'),'wOF2',route);
    const head=await fetch(base+route,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'font/woff2');
    assert.equal(Number(head.headers.get('content-length')),entry.bytes,route);
  }
  const css=await fetch(base+'/typography.css');
  assert.equal(css.status,200);
  assert.match(css.headers.get('content-type'),/^text\/css/);
  const text=await css.text();
  assert.match(text,/@font-face/);assert.match(text,/font-display:\s*swap/);
  assert.ok(text.includes('newsreader-var.woff2')&&text.includes('newsreader-italic-var.woff2'));
  assert.doesNotMatch(text,/https?:\/\//,'the served stylesheet must not reference external fonts');
  const license=await fetch(base+'/fonts/newsreader/OFL.txt');
  assert.equal(license.status,200);
  assert.match(license.headers.get('content-type'),/^text\/plain/);
  assert.match(await license.text(),/SIL Open Font License/);
});

test('the homepage and reader preload only the upright first-screen face',async()=>{
  for(const route of ['/','/zh-hans','/read']){
    const response=await fetch(base+route);
    assert.equal(response.status,200,route);
    const html=await response.text();
    const preloads=[...html.matchAll(preloadRe)].map(match=>match[1]);
    assert.deepEqual(preloads,['/fonts/newsreader/newsreader-var.woff2'],route+' must preload exactly the upright face with type and crossorigin');
    assert.ok(html.includes('<link rel="stylesheet" href="/typography.css">'),route+' must load the shared typography module');
    assert.doesNotMatch(html,/newsreader-italic-var\.woff2" as="font"/,route+' must leave italic lazy');
    assert.doesNotMatch(html,/fonts\.(?:googleapis|gstatic)\.com/,route+' must not request external fonts');
  }
});

test('support and gift pages load the shared typography module without preloading fonts',async()=>{
  for(const route of ['/en/privacy','/zh-hans/mcp','/zh-hant/privacy','/ja/mcp','/gift-preview']){
    const response=await fetch(base+route);
    assert.equal(response.status,200,route);
    const html=await response.text();
    assert.ok(html.includes('<link rel="stylesheet" href="/typography.css">'),route+' must load the shared typography module');
    assert.deepEqual([...html.matchAll(preloadRe)].map(match=>match[1]),[],route+' keeps fonts lazy outside the first-screen entry pages');
  }
});

test('font and CSS serving keeps the CSP and privacy boundaries intact',async()=>{
  for(const route of ['/read','/','/typography.css','/fonts/newsreader/newsreader-var.woff2']){
    const response=await fetch(base+route);
    assert.equal(response.status,200,route);
    const csp=response.headers.get('content-security-policy');
    assert.ok(csp.includes("default-src 'self'"),route+' must keep the self-only default source');
    assert.ok(csp.includes("style-src 'self'")&&csp.includes("script-src 'self'"),route+' must not loosen script or style sources');
    assert.ok(!/font-src\s+[^;]*https?:/.test(csp),route+' must not open font sources to the network');
    assert.ok(!csp.includes('unsafe-inline'),route+' must not add inline execution');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff',route);
  }
});
