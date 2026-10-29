import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildReaderWeb} from '../tools/build-reader-web.mjs';
const modulePath=name=>JSON.stringify('./'+name);

test('only the reader API static offline edge is external and remains release gated',async t=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'leafhour-offline-boundary-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'app'));
 const files={'reader.js':`import {ready} from ${modulePath('reader-api.mjs')};console.log(ready);`,'reader-api.mjs':`import {offline} from ${modulePath('offline-reading.mjs')};export const ready=offline;`,'offline-reading.mjs':`import {store} from ${modulePath('offline-book-store.mjs')};export const offline=store;`,'offline-book-store.mjs':'export const store={offline:true};','reader-translation.js':'export {};','styles.css':'body{color:#123}','browser-globals.mjs':await readFile(new URL('../app/browser-globals.mjs',import.meta.url),'utf8')};
 const allowed=Object.keys(files).map(file=>'app/'+file);for(const [file,source]of Object.entries(files))await writeFile(path.join(root,'app',file),source);await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed));
 const html='<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><link rel="stylesheet" href="/styles.css"></head>';
 const result=await buildReaderWeb({root,outputDir:path.join(root,'out'),html});assert.equal(result.inputs.includes('app/offline-reading.mjs'),false);assert.equal(result.inputs.includes('app/offline-book-store.mjs'),false);assert.match(await readFile(path.join(root,'out',result.files[0]),'utf8'),/from["']\/offline-reading\.mjs["']/);
 await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed.filter(file=>file!=='app/offline-reading.mjs')));await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'not-allowed'),html}),/Non-public lazy reader module/);
 await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed));await writeFile(path.join(root,'app/reader.js'),`import {offline} from ${modulePath('offline-reading.mjs')};console.log(offline);`);const otherCaller=await buildReaderWeb({root,outputDir:path.join(root,'other-caller'),html});assert.equal(otherCaller.inputs.includes('app/offline-reading.mjs'),true,'another caller does not gain an external module exception');
 await writeFile(path.join(root,'app/reader.js'),`import {ready} from ${modulePath('reader-api.mjs')};console.log(ready);`);await writeFile(path.join(root,'app/reader-api.mjs'),`export const ready=()=>import(${modulePath('offline-reading.mjs')});`);const dynamic=await buildReaderWeb({root,outputDir:path.join(root,'dynamic'),html});assert.equal(dynamic.inputs.includes('app/offline-reading.mjs'),true,'the edge exception does not extend to dynamic import');
});
