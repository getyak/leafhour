import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const specifier=name=>JSON.stringify('./'+name);
const build=async options=>(await import('../tools/build-portal-web.mjs')).buildPortalWeb(options);
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'leafhour-portal-web-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'app'));const files={
 'portal.js':`import {read,bump} from ${specifier('shared.mjs')};import ${specifier('only.mjs')};import {late} from ${specifier('late-shared.mjs')};bump();export const value=()=>read()+late();export const open=()=>import(${specifier('lazy.mjs?retry=1#checked')});`,
 'sibling.mjs':`import {read} from ${specifier('shared.mjs')};globalThis.siblingRead=read;`,
 'shared.mjs':`globalThis.sharedRuns=(globalThis.sharedRuns||0)+1;let count=0;export const bump=()=>++count;export const read=()=>count;`,
 'only.mjs':`globalThis.onlyRuns=(globalThis.onlyRuns||0)+1;`,
 'late-shared.mjs':`globalThis.lateRuns=(globalThis.lateRuns||0)+1;export const late=()=>0;`,
 'lazy.mjs':`import {bump} from ${specifier('shared.mjs')};import {late} from ${specifier('late-shared.mjs')};globalThis.lazyRuns=(globalThis.lazyRuns||0)+1;bump();export const value=late();`
 };for(const [name,source]of Object.entries(files))await writeFile(path.join(root,'app',name),source);await writeFile(path.join(root,'release-files.json'),JSON.stringify(Object.keys(files).map(x=>'app/'+x)));return {root,outputDir:path.join(root,'out'),html:'<script type="module" src="/portal.js"></script><script type="module" src="/sibling.mjs"></script>'};}
test('compiled portal shares state with sibling and lazy entries and does not eagerly evaluate lazy code',async t=>{
 const f=await fixture(t);f.additionalEntries=['only.mjs'];const result=await build(f);assert.equal(result.bundles.length,2);assert.ok(result.inputs.includes('app/only.mjs'));assert.ok(!result.inputs.includes('app/shared.mjs'));assert.ok(!result.inputs.includes('app/late-shared.mjs'));const code=await readFile(path.join(f.outputDir,'portal.js'),'utf8');assert.match(code,/\/lazy\.mjs\?retry=1#checked/);assert.doesNotMatch(code,/lazyRuns/);
 const probe=`import vm from 'node:vm';import{readFile}from'node:fs/promises';import{strict as a}from'node:assert';const root=${JSON.stringify(f.root)},out=${JSON.stringify(f.outputDir)},context=vm.createContext({}),cache=new Map();async function load(spec,ref){const url=new URL(spec,ref?.identifier||'https://fixture.invalid/');if(cache.has(url.href))return cache.get(url.href);const source=await readFile(out+url.pathname,'utf8').catch(()=>readFile(root+'/app'+url.pathname,'utf8'));const m=new vm.SourceTextModule(source,{context,identifier:url.href,importModuleDynamically:async(s,r)=>{const d=await load(s,r);if(d.status==='unlinked')await d.link(load);if(d.status==='linked')await d.evaluate();return d;}});cache.set(url.href,m);return m;}const sibling=await load('/sibling.mjs');await sibling.link(load);await sibling.evaluate();const portal=await load('/portal.js');await portal.link(load);await portal.evaluate();a.equal(context.sharedRuns,1);a.equal(context.lateRuns,1);a.equal(context.onlyRuns,1);a.equal(context.lazyRuns,undefined);a.equal(context.siblingRead(),1);await portal.namespace.open();a.equal(context.lazyRuns,1);a.equal(context.siblingRead(),2);a.equal(portal.namespace.value(),2);a.equal(context.lateRuns,1);`;
 execFileSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',probe],{stdio:['ignore','pipe','pipe']});
});
test('unlisted lazy backing and opaque imports fail the build instead of silently entering production',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'release-files.json'),JSON.stringify(['app/portal.js','app/sibling.mjs','app/shared.mjs','app/only.mjs','app/late-shared.mjs']));await assert.rejects(build(f),/release|public/i);
 await writeFile(path.join(f.root,'app','portal.js'),'export const open=name=>import(name);');await assert.rejects(build(f),/literal/i);
});

test('the real cover entry folds its renderer and edition tables into one bounded chunk with a shared locale owner',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),outputDir=await mkdtemp(path.join(tmpdir(),'leafhour-cover-web-'));
 t.after(()=>rm(outputDir,{recursive:true,force:true}));
 const result=await build({root,outputDir,html:await readFile(path.join(root,'app/home.html'),'utf8'),additionalEntries:['library-shell.mjs','book-cover-ui.mjs']});
 const cover=result.bundles.find(bundle=>bundle.file==='book-cover-ui.mjs');assert.ok(cover);
 for(const file of ['book-cover-ui.mjs','book-binding.mjs','book-cover-labels.mjs','book-cover-artwork.mjs'])assert.ok(cover.inputs.includes('app/'+file),file+' belongs to the one cover chunk');
 for(const bundle of result.bundles){
  assert.ok(bundle.bytes<=200*1024,bundle.file+' keeps the existing public JavaScript budget');
  assert.ok(!bundle.inputs.includes('app/ui-locale.mjs'),bundle.file+' must reuse the physical locale owner');
  if(bundle!==cover)for(const file of ['book-binding.mjs','book-cover-labels.mjs','book-cover-artwork.mjs'])assert.ok(!bundle.inputs.includes('app/'+file),file+' must not be copied into '+bundle.file);
 }
 const coverCode=await readFile(path.join(outputDir,'book-cover-ui.mjs'),'utf8'),portalCode=await readFile(path.join(outputDir,'portal.js'),'utf8');
 assert.match(coverCode,/from["']\/ui-locale\.mjs["']/);
 assert.doesNotMatch(coverCode,/from["'][^"']*book-(?:binding|cover-(?:labels|artwork))\.mjs["']/,'cover data must not create a second source-module waterfall');
 assert.match(portalCode,/from["']\/book-cover-ui\.mjs["']/);
});
