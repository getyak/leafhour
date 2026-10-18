import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
test('hosted reader starts from one bundled script and one stylesheet without retaining old script execution',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'leafhour-reader-web-'));
 try{const source=await readFile(path.join(root,'app/index.html'),'utf8'),result=await buildReaderWeb({root,outputDir:out,html:source});const scripts=[...result.html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(x=>x[1]),styles=[...result.html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(x=>x[1]);assert.equal(scripts.length,1);assert.equal(styles.length,1);assert.match(scripts[0],/^\/reader-web\/reader-[a-f0-9]{16}\.js$/);assert.match(styles[0],/^\/reader-web\/style-[a-f0-9]{16}\.css$/);assert.ok(!scripts.includes('/reader.js'));assert.ok(result.inputs.includes('app/reader.js'));assert.ok(result.inputs.includes('app/reader-translation.js'));assert.ok(result.inputs.includes('app/share.js'));for(const file of result.files){const bytes=await readFile(path.join(out,file));assert.ok(bytes.length>0);assert.ok(bytes.length<=(file.endsWith('.js')?320:200)*1024,file+' exceeds the public asset budget');}const css=await readFile(path.join(out,result.files.find(file=>file.endsWith('.css'))),'utf8');assert.deepEqual([...css.matchAll(/@import\s*(?:url\()?['\"]([^'\"]+)['\"]\)?/g)].map(match=>match[1]),['/fonts/noto-serif-sc/font-faces.css'],'only the exact same-origin font-face declaration stays external; all reader styles are bundled');assert.match(css,/\.passage/);assert.match(css,/url\(\/?brand-assets\/leafhour-mark\.svg\)/);for(const stylesheet of ['styles.css','reader-pagination.css','reader-settings.css','leafhour-brand.css'])assert.ok(result.inputs.includes('app/'+stylesheet),'missing bundled style '+stylesheet);assert.ok(css.length>50000,'the output must contain the actual reading styles');assert.match(result.html,/id="chapter-text"/);}
 finally{await rm(out,{recursive:true,force:true});}
});

test('the gift composer remains an allowed public module loaded outside the initial reader bundle',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'leafhour-reader-gift-web-'));
 try{
  const result=await buildReaderWeb({root,outputDir:out,html:await readFile(path.join(root,'app/index.html'),'utf8')}),js=await readFile(path.join(out,result.files.find(file=>file.endsWith('.js'))),'utf8');
  assert.match(js,/import\(["']\/gift-compose\.mjs["']\)/);
  assert.match(js,/import\(["']\/book-binding\.mjs["']\)/);
  assert.match(js,/import\(["']\/share-fonts\.mjs["']\)/);assert.ok(!js.includes('normal 48px'),'on-demand font loader bodies must be tree-shaken from initial JS, even though the compatibility re-export is parsed');for(const file of ['gift-compose.mjs','gift-compose-state.mjs','gift-preview.mjs','book-binding.mjs'])assert.ok(!result.inputs.includes('app/'+file),file+' must wait for explicit sharing');
  assert.match(js,/from\s*["']\/arrival-catalog\.mjs["']/);assert.equal((js.match(/\/arrival-catalog\.mjs/g)||[]).length,1);assert.ok(!result.inputs.includes('app/arrival-catalog.mjs'),'the public catalog stays a single separate module');
  assert.ok(result.inputs.includes('app/gift-compose.css'),'the shared gift styles stay in the single reader stylesheet');
  const allowed=JSON.parse(await readFile(path.join(root,'release-files.json'),'utf8'));
  for(const file of ['gift-compose.mjs','book-binding.mjs','arrival-catalog.mjs']){assert.ok(allowed.includes('app/'+file));assert.ok((await readFile(path.join(root,'app',file))).length>0);}
  assert.ok((await readFile(path.join(root,'app/gift-compose.mjs'),'utf8')).includes('export function mountGiftComposer'));
 }finally{await rm(out,{recursive:true,force:true});}
});

test('external reader modules require the release allowlist and only resolve from their exact callers',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=await realpath(await mkdtemp(path.join(tmpdir(),'leafhour-reader-module-policy-')));
 const html='<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><link rel="stylesheet" href="/styles.css"></head>';
 const modulePath=name=>JSON.stringify('./'+name);
 const files={'reader.js':`import ${modulePath('reader-book-actions.mjs')};import ${modulePath('reading-arrival.mjs')};`,'reader-translation.js':'export {};','reader-book-actions.mjs':`export const share=()=>import(${modulePath('gift-compose.mjs')});console.log(share);`,'reading-arrival.mjs':`import {arrivalCatalog} from ${modulePath('arrival-catalog.mjs')};console.log(arrivalCatalog);`,'gift-compose.mjs':'export const marker="public gift module";','arrival-catalog.mjs':'export const arrivalCatalog={public:true};','styles.css':'body{color:#123}'};
 try{
  await mkdir(path.join(root,'app'));for(const [file,contents]of Object.entries(files))await writeFile(path.join(root,'app',file),contents);
  const allowed=Object.keys(files).map(file=>'app/'+file);
  for(const excluded of ['app/gift-compose.mjs','app/arrival-catalog.mjs']){
   await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed.filter(file=>file!==excluded)));
   await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out'),html}),/Non-public lazy reader module/);
  }
  await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed));
  await writeFile(path.join(root,'app/reader-book-actions.mjs'),`import {marker} from ${modulePath('gift-compose.mjs')};console.log(marker);`);
  await writeFile(path.join(root,'app/reader.js'),`import ${modulePath('reader-book-actions.mjs')};import {arrivalCatalog} from ${modulePath('arrival-catalog.mjs')};console.log(arrivalCatalog);`);
  const result=await buildReaderWeb({root,outputDir:path.join(root,'out'),html});
  assert.ok(result.inputs.includes('app/gift-compose.mjs'),'a static gift import must remain subject to normal bundle validation');
  assert.ok(result.inputs.includes('app/arrival-catalog.mjs'),'a catalog import from another caller must remain bundled');
 }finally{await rm(root,{recursive:true,force:true});}
});
