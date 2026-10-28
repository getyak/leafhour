import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const modulePath=name=>JSON.stringify('./'+name);
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'leafhour-offline-build-')),outputDir=path.join(root,'dist');
 t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'app'),{recursive:true});await mkdir(path.join(outputDir,'reader-web'),{recursive:true});
 const files={'offline.html':'<!doctype html><html><head><link rel="stylesheet" href="/offline.css"></head><body><script type="module" src="/offline-shelf.mjs"></script></body></html>','offline.css':'body{color:#123}','offline-shelf.mjs':`import {store} from ${modulePath('offline-book-store.mjs')};console.log(store);`,'offline-book-store.mjs':'export const store={};','ui-locale.mjs':'export const locale="en";','lazy.mjs':`import ${modulePath('nested.mjs')};export const extra=1;`,'nested.mjs':'export const nested=true;','lazy.css':'body{font-size:20px}','reading-worker.js':await readFile(new URL('../app/reading-worker.js',import.meta.url),'utf8')};
 for(const code of ['en','zh-Hans','zh-Hant','ja'])files['ui-catalogs/'+code+'.mjs']='export default '+JSON.stringify({locale:code});
 for(const [file,contents]of Object.entries(files)){await mkdir(path.dirname(path.join(root,'app',file)),{recursive:true});await writeFile(path.join(root,'app',file),contents);await mkdir(path.dirname(path.join(outputDir,file)),{recursive:true});await cp(path.join(root,'app',file),path.join(outputDir,file));}
 await writeFile(path.join(root,'release-files.json'),JSON.stringify(Object.keys(files).map(file=>'app/'+file)));
 const script='export const open=()=>import("/lazy.mjs");const sheet="/lazy.css";console.log(open,sheet);',readerFile='reader-web/reader-'+digest(script).slice(0,16)+'.js';await writeFile(path.join(outputDir,readerFile),script);
 await writeFile(path.join(outputDir,'private.mjs'),'export const secret="not public";');
 const readerHtml='<!doctype html><html lang="en"><head><script data-ui-first-paint>location.replace("/_ui/read")</script><script type="module" src="/'+readerFile+'"></script></head><body><main id="chapter-text"></main></body></html>';
 return {root,outputDir,readerHtml,readerFiles:[readerFile]};
}

test('offline build follows public read dependencies and binds every byte to one release',async t=>{
 const {buildOfflineReading}=await import('../tools/build-offline-reading.mjs');const f=await fixture(t),result=await buildOfflineReading(f);
 const manifest=JSON.parse(await readFile(path.join(f.outputDir,'offline-resources.json'),'utf8')),urls=manifest.resources.map(resource=>resource.url);
 for(const url of ['/lazy.mjs','/nested.mjs','/lazy.css','/offline-book-store.mjs','/ui-locale.mjs','/offline-reader.html','/offline.html',...['en','zh-Hans','zh-Hant','ja'].map(code=>'/ui-catalogs/'+code+'.mjs')])assert.ok(urls.includes(url),url+' must work without network');
 assert.ok(!urls.includes('/private.mjs'),'an output file never authorizes itself');assert.ok(!urls.some(url=>url.startsWith('/api/')));
 for(const entry of manifest.resources){const bytes=await readFile(path.join(f.outputDir,entry.url.slice(1)));assert.equal(entry.sha256,digest(bytes));assert.equal(entry.bytes,bytes.length);}
 assert.equal(result.version,manifest.version);assert.match(manifest.version,/^[a-f0-9]{64}$/);
 const shell=await readFile(path.join(f.outputDir,'offline-reader.html'),'utf8');assert.doesNotMatch(shell,/location\.replace|data-ui-first-paint/);assert.match(shell,/data-leafhour-offline-shell/);
 assert.match(await readFile(path.join(f.outputDir,'reading-worker.js'),'utf8'),new RegExp(manifest.version));
 await writeFile(path.join(f.outputDir,'nested.mjs'),'export const nested="changed";');const updated=await buildOfflineReading(f);assert.notEqual(updated.version,result.version,'raw dependency changes advance the whole release group');
});

test('offline build refuses an unreviewed dependency even when present in the public directory',async t=>{
 const {buildOfflineReading}=await import('../tools/build-offline-reading.mjs');const f=await fixture(t);await writeFile(path.join(f.outputDir,'lazy.mjs'),`import ${modulePath('private.mjs')};`);
 await assert.rejects(buildOfflineReading(f),/Non-public offline resource/);
});

test('offline build rejects generated reader files whose content no longer matches their name',async t=>{
 const {buildOfflineReading}=await import('../tools/build-offline-reading.mjs');const f=await fixture(t);await writeFile(path.join(f.outputDir,f.readerFiles[0]),'changed reader');
 await assert.rejects(buildOfflineReading(f),/Reader resource digest/);
});

test('offline build retains compact and url-form CSS imports with their font dependencies',async t=>{
 const {buildOfflineReading}=await import('../tools/build-offline-reading.mjs');const f=await fixture(t),extra={'font-entry.css':'@im'+'port"./font-face.css";','font-face.css':'@font-face{font-family:reading;src:url("./glyphs.woff2") format("woff2")}','glyphs.woff2':'approved-font-bytes'};
 for(const [name,source]of Object.entries(extra))await writeFile(path.join(f.outputDir,name),source);
 await writeFile(path.join(f.outputDir,'offline.css'),'@import url("./font-entry.css");body{color:#123}');
 const allowed=JSON.parse(await readFile(path.join(f.root,'release-files.json'),'utf8'));await writeFile(path.join(f.root,'release-files.json'),JSON.stringify([...allowed,...Object.keys(extra).map(name=>'app/'+name)]));await buildOfflineReading(f);
 const manifest=JSON.parse(await readFile(path.join(f.outputDir,'offline-resources.json'),'utf8'));for(const url of ['/font-entry.css','/font-face.css','/glyphs.woff2'])assert.ok(manifest.resources.some(entry=>entry.url===url),url+' remains in the complete public graph');
});
