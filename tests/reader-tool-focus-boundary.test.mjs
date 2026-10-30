import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as builder from '../tools/build-reader-web.mjs';
import {buildOfflineReading} from '../tools/build-offline-reading.mjs';
import {releaseFiles} from '../tools/release-policy.mjs';
import {createReaderServer} from '../server/server.mjs';
import {handoffReadingToolFocus} from '../app/reading-tool-focus.mjs';
import {fixture} from './annotation-dom-fixture.mjs';

const root=path.resolve(import.meta.dirname,'..'),focus='app/reading-tool-focus.mjs';
test('the shared keyboard owner only accepts reviewed static callers and its closed public dependency graph',()=>{
 assert.equal(typeof builder.assertReadingToolFocusBoundaryEdges,'function');
 const edge={importer:'app/reading-toolbar.mjs',specifier:'./reading-tool-focus.mjs',kind:'import-statement'},release=new Set([focus,'app/popover-controls.mjs']);
 assert.deepEqual(builder.assertReadingToolFocusBoundaryEdges({edges:[edge],release}),[focus]);
 for(const patch of [{importer:'app/reader.js'},{kind:'dynamic-import'},{kind:'require-call'},{specifier:'/reading-tool-focus.mjs'},{specifier:'./reading-tool-focus.mjs?retry=1'},{specifier:'./x/../reading-tool-focus.mjs'},{specifier:'./x/%2e%2e/reading-tool-focus.mjs'},{specifier:'https://leafhour.invalid/reading-tool-focus.mjs'}])assert.throws(()=>builder.assertReadingToolFocusBoundaryEdges({edges:[{...edge,...patch}],release}),/Unauthorized.*focus/);
 assert.throws(()=>builder.assertReadingToolFocusBoundaryEdges({edges:[edge],release:new Set()}),/Non-public.*focus/);
 assert.throws(()=>builder.assertReadingToolFocusBoundaryEdges({edges:[edge,{importer:focus,specifier:'./reader-api.mjs',kind:'import-statement'}],release}),/Unauthorized.*focus/);
 assert.throws(()=>builder.assertReadingToolFocusBoundaryEdges({edges:[edge,{importer:focus,specifier:'./popover-controls.mjs',kind:'import-statement'}],release}),/Unauthorized.*focus/,'the first-paint owner must have no transitive module request');
});

test('the dependency-free owner requires an explicit blocking guard and yields to it before focus',()=>{
 const {document,win}=fixture('<body><button id="opener"></button><button id="target"></button></body>'),frames=new Map(),timers=new Map();let sequence=0;
 win.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};win.cancelAnimationFrame=id=>frames.delete(id);win.setTimeout=fn=>{timers.set(++sequence,fn);return sequence;};win.clearTimeout=id=>timers.delete(id);win.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1'});
 const target=()=>document.getElementById('target');document.getElementById('opener').focus();
 assert.throws(()=>handoffReadingToolFocus({document,target}),/blocking guard/);assert.equal(frames.size,0);assert.equal(timers.size,0);
 let blocked=false;handoffReadingToolFocus({document,target,blocked:()=>blocked});blocked=true;
 const pending=[...frames.values()];frames.clear();for(const run of pending)run();
 assert.equal(document.activeElement.id,'opener');assert.equal(frames.size,0);assert.equal(timers.size,0);
});

test('the compiled header and actual raw hub supersede and cancel one keyboard owner',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-packaged-focus-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(path.join(directory,'app'));const names=['reading-toolbar.mjs','reading-hub.mjs','popover-controls.mjs','browser-globals.mjs'];
 for(const file of ['reading-tool-focus.mjs'])try{await readFile(path.join(root,'app',file));names.push(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const file of names)await cp(path.join(root,'app',file),path.join(directory,'app',file));
 const entryImport='import {handoffReadingToolFocus,cancelReadingToolFocus} from '+JSON.stringify('./reading-toolbar.mjs')+';';
 await writeFile(path.join(directory,'app/reader.js'),entryImport+'globalThis.coreFocus={handoff:handoffReadingToolFocus,cancel:cancelReadingToolFocus};');
 await writeFile(path.join(directory,'app/reader-translation.js'),'export {};');await writeFile(path.join(directory,'app/styles.css'),'body{color:#123}');
 await writeFile(path.join(directory,'release-files.json'),JSON.stringify([...names.map(file=>'app/'+file),'app/reader.js','app/reader-translation.js','app/styles.css',...builder.UI_LOCALE_RELEASE_ENTRIES]));
 const out=path.join(directory,'out'),built=await builder.buildReaderWeb({root:directory,outputDir:out,html:'<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><link rel="stylesheet" href="/styles.css"></head>'});
 const result=spawnSync(process.execPath,['--experimental-vm-modules',path.join(root,'tests/helpers/packaged-tool-focus.mjs'),directory,out,built.files.find(file=>file.endsWith('.js'))],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const proof=JSON.parse(result.stdout.trim());assert.equal(proof.sharedOwnerUrl,'https://packaged.leafhour.invalid/reading-tool-focus.mjs');assert.equal(proof.frames,0);assert.equal(proof.timers,0);
 await symlink('reading-tool-focus.mjs',path.join(directory,'app/focus-alias.mjs'));
 const aliasImport='import {handoffReadingToolFocus,cancelReadingToolFocus} from '+JSON.stringify('./focus-alias.mjs')+';';
 await writeFile(path.join(directory,'app/reader.js'),aliasImport+'globalThis.coreFocus={handoff:handoffReadingToolFocus,cancel:cancelReadingToolFocus};');
 await assert.rejects(builder.buildReaderWeb({root:directory,outputDir:path.join(directory,'alias-out'),html:'<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><link rel="stylesheet" href="/styles.css"></head>'}),/Shared reading tool focus bundled by alias/,'an unrecognized filesystem alias must never create another owner');
});

test('the shared owner is served byte-for-byte by both source static route owners',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-focus-http-'));
 const server=await createReaderServer({bookPath:path.join(directory,'absent-public-book.json'),recordsPath:path.join(directory,'records.json'),portalDataDir:path.join(directory,'portal'),env:{},translator:null,chatGenerator:null,companionGenerator:null,speechProvider:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+server.address().port+'/reading-tool-focus.mjs';
 const normal=await fetch(url);assert.equal(normal.status,200);assert.match(normal.headers.get('content-type'),/javascript/);const source=await readFile(path.join(root,focus),'utf8');assert.equal(await normal.text(),source);
 const handle=server.portal.handle;server.portal.handle=async input=>input.url.pathname==='/reading-tool-focus.mjs'?false:handle(input);
 const fallback=await fetch(url);assert.equal(fallback.status,200);assert.equal(await fallback.text(),source);
});

test('the real fixed-budget reader and its offline release include one canonical public keyboard owner',async t=>{
 const outputDir=await mkdtemp(path.join(tmpdir(),'leafhour-focus-offline-'));t.after(()=>rm(outputDir,{recursive:true,force:true}));
 const allowed=await releaseFiles(root);assert.ok(allowed.includes(focus));
 for(const file of allowed.filter(file=>file.startsWith('app/'))){const destination=path.join(outputDir,file.slice(4));await mkdir(path.dirname(destination),{recursive:true});await cp(path.join(root,file),destination);}
 const built=await builder.buildReaderWeb({root,outputDir,html:await readFile(path.join(root,'app/index.html'),'utf8')}),js=await readFile(path.join(outputDir,built.files.find(file=>file.endsWith('.js'))),'utf8');
 assert.ok(Buffer.byteLength(js)<=320*1024);assert.ok(!built.inputs.includes(focus),'the shared owner must not have a second inlined copy');assert.match(js,/from["']\/reading-tool-focus\.mjs["']/);
 assert.match(built.html,/<link rel="modulepreload" href="\/reading-tool-focus\.mjs">/,'the one static owner starts fetching beside its importing bundle');
 await buildOfflineReading({root,outputDir,readerHtml:built.html,readerFiles:built.files});
 const manifest=JSON.parse(await readFile(path.join(outputDir,'offline-resources.json'),'utf8'));
 for(const url of ['/reading-tool-focus.mjs','/popover-controls.mjs'])assert.equal(manifest.resources.filter(entry=>entry.url===url).length,1,url+' is cached once with its public backing');
 const worker=await readFile(path.join(outputDir,'reading-worker.js'),'utf8');assert.ok(worker.includes('/reading-tool-focus.mjs'));
});
