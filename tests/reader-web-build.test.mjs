import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
test('paper-turn rendering loads only after page mode while the ordinary reader keeps its fixed startup budget',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'leafhour-paper-web-'));
 try{const result=await buildReaderWeb({root,outputDir:out,html:await readFile(path.join(root,'app/index.html'),'utf8')});
  for(const file of ['app/reader-page-surface.mjs','app/reader-page-turn.mjs'])assert.equal(result.inputs.includes(file),false,file+' must not execute in the ordinary reader');
  const js=await readFile(path.join(out,result.files.find(file=>file.endsWith('.js'))),'utf8');assert.match(js,/import\(["']\/reader-page-surface\.mjs["']\)/);
  assert.equal(result.inputs.includes('app/reader-paper.css'),false,'the optional paper surface must not enlarge ordinary reading styles');
 }finally{await rm(out,{recursive:true,force:true});}
});
test('hosted reader starts from one bundled script and one stylesheet without retaining old script execution',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'leafhour-reader-web-'));
 try{const source=await readFile(path.join(root,'app/index.html'),'utf8'),result=await buildReaderWeb({root,outputDir:out,html:source});const scripts=[...result.html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(x=>x[1]),styles=[...result.html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(x=>x[1]);assert.equal(scripts.length,1);assert.equal(styles.length,1);assert.match(scripts[0],/^\/reader-web\/reader-[a-f0-9]{16}\.js$/);assert.match(styles[0],/^\/reader-web\/style-[a-f0-9]{16}\.css$/);assert.ok(!scripts.includes('/reader.js'));assert.ok(result.inputs.includes('app/reader.js'));assert.ok(result.inputs.includes('app/reader-translation.js'));assert.ok(result.inputs.includes('app/share.js'));assert.ok(result.inputs.includes('app/reader-book-actions-bootstrap.mjs'),'the real user-open bootstrap ships with the page');assert.ok(!result.inputs.includes('app/reader-book-actions.mjs'),'the optional AI introduction and gifting enhancement waits for the real bookplate open');assert.ok(!result.inputs.includes('app/book-introduction-controller.mjs'),'the private introduction controller waits inside the lazy enhancement');for(const file of result.files){const bytes=await readFile(path.join(out,file));assert.ok(bytes.length>0);assert.ok(bytes.length<=(file.endsWith('.js')?320:200)*1024,file+' exceeds the public asset budget');}const css=await readFile(path.join(out,result.files.find(file=>file.endsWith('.css'))),'utf8');assert.deepEqual([...css.matchAll(/@import\s*(?:url\()?['\"]([^'\"]+)['\"]\)?/g)].map(match=>match[1]),['/fonts/noto-serif-sc/font-faces.css'],'only the exact same-origin font-face declaration stays external; all reader styles are bundled');assert.match(css,/\.passage/);assert.match(css,/url\(\/?brand-assets\/leafhour-mark\.svg\)/);for(const stylesheet of ['styles.css','reader-pagination.css','reader-settings.css','choice-control.css','leafhour-brand.css'])assert.ok(result.inputs.includes('app/'+stylesheet),'missing bundled style '+stylesheet);assert.ok(!result.inputs.includes('app/choice-control.mjs'),'the shared choice primitive waits for the Aa drawer');assert.ok(!result.inputs.includes('app/reader-settings-choices.mjs'),'Aa enhancement stays outside initial reader JS');assert.ok(result.inputs.includes('app/reader-settings.mjs'),'the Aa drawer controller ships inside the reader bundle');assert.ok(css.length>50000,'the output must contain the actual reading styles');assert.match(result.html,/id="chapter-text"/);}
 finally{await rm(out,{recursive:true,force:true});}
});

test('the bookplate enhancement and gift composer remain allowed public modules loaded outside the initial reader bundle',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'leafhour-reader-gift-web-'));
 try{
  const result=await buildReaderWeb({root,outputDir:out,html:await readFile(path.join(root,'app/index.html'),'utf8')}),js=await readFile(path.join(out,result.files.find(file=>file.endsWith('.js'))),'utf8');
  assert.match(js,/import\(["']\/reader-book-actions\.mjs["']\)/,'the optional bookplate enhancement waits for the real open');
  assert.equal((js.match(/\/reader-book-actions\.mjs/g)||[]).length,1,'exactly one lazy edge to the enhancement');
  const actions=await readFile(path.join(root,'app/reader-book-actions.mjs'),'utf8');
  assert.match(actions,/import\(["']\.\/gift-compose\.mjs["']\)/,'the gift composer keeps its original lazy path inside the book-actions module');
  assert.match(actions,/import\(["']\.\/book-binding\.mjs["']\)/);
  assert.ok(!/from\s*["']\.\/popover-controls\.mjs["']/.test(actions),'the lazy module never carries a second controller registry copy');
  assert.match(js,/import\(["']\/command-palette\.mjs["']\)/,'the palette module waits for a real gesture');
  assert.ok(result.inputs.includes('app/palette-bootstrap.mjs'),'the small shared trigger is bundled with the page');
  for(const file of ['command-palette.mjs','palette-library.mjs'])assert.ok(!result.inputs.includes('app/'+file),file+' must wait for the palette trigger');
  assert.match(js,/import\(["']\/reader-settings-choices\.mjs["']\)/);
  for(const file of ['reader-book-actions.mjs','book-introduction-controller.mjs','gift-compose.mjs','gift-compose-state.mjs','gift-preview.mjs','book-binding.mjs'])assert.ok(!result.inputs.includes('app/'+file),file+' must wait for the explicit user gesture');
  assert.match(js,/import\(["']\/share-fonts\.mjs["']\)/);assert.ok(!js.includes('normal 48px'),'on-demand font loader bodies must be tree-shaken from initial JS, even though the compatibility re-export is parsed');
  assert.match(js,/from\s*["']\/arrival-catalog\.mjs["']/);assert.equal((js.match(/\/arrival-catalog\.mjs/g)||[]).length,1);assert.ok(!result.inputs.includes('app/arrival-catalog.mjs'),'the public catalog stays a single separate module');
  assert.ok(result.inputs.includes('app/gift-compose.css'),'the shared gift styles stay in the single reader stylesheet');
  const allowed=JSON.parse(await readFile(path.join(root,'release-files.json'),'utf8'));
  for(const file of ['reader-book-actions.mjs','reader-book-actions-bootstrap.mjs','gift-compose.mjs','book-binding.mjs','arrival-catalog.mjs']){assert.ok(allowed.includes('app/'+file));assert.ok((await readFile(path.join(root,'app',file))).length>0);}
  assert.ok((await readFile(path.join(root,'app/gift-compose.mjs'),'utf8')).includes('export function mountGiftComposer'));
 }finally{await rm(out,{recursive:true,force:true});}
});

test('external reader modules require the release allowlist and only resolve from their exact callers',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=await realpath(await mkdtemp(path.join(tmpdir(),'leafhour-reader-module-policy-')));
 const html='<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><script type="module" src="/reader-book-actions-bootstrap.mjs"></script><script type="module" src="/palette-bootstrap.mjs"></script><link rel="stylesheet" href="/styles.css"></head>';
 const modulePath=name=>JSON.stringify('./'+name);
 const files={'reader.js':`import ${modulePath('reader-book-actions.mjs')};import ${modulePath('reading-arrival.mjs')};import ${modulePath('reader-settings.mjs')};console.log('boot');`,'reader-translation.js':'export {};','reader-book-actions.mjs':`export const share=()=>import(${modulePath('gift-compose.mjs')});console.log(share);`,'reading-arrival.mjs':`import {arrivalCatalog} from ${modulePath('arrival-catalog.mjs')};console.log(arrivalCatalog);`,'reader-settings.mjs':`export const enhance=()=>import(${modulePath('reader-settings-choices.mjs')});console.log(enhance);`,'reader-settings-choices.mjs':'export const onlyOnOpen=true;','gift-compose.mjs':'export const marker="public gift module";','arrival-catalog.mjs':'export const arrivalCatalog={public:true};','palette-bootstrap.mjs':`export const open=()=>import(${modulePath('command-palette.mjs')});console.log(open);`,'reader-book-actions-bootstrap.mjs':`export const open=()=>import(${modulePath('reader-book-actions.mjs')});console.log(open);`,'command-palette.mjs':'export const palette={lazy:true};','styles.css':'body{color:#123}'};
 try{
  await mkdir(path.join(root,'app'));for(const [file,contents]of Object.entries(files))await writeFile(path.join(root,'app',file),contents);
  const allowed=Object.keys(files).map(file=>'app/'+file);
  for(const excluded of ['app/reader-book-actions.mjs','app/gift-compose.mjs','app/arrival-catalog.mjs','app/reader-settings-choices.mjs','app/command-palette.mjs']){
   await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed.filter(file=>file!==excluded)));
   await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out'),html}),/Non-public lazy reader module/);
  }
  await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed.filter(file=>file!=='app/palette-bootstrap.mjs')));
  await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out'),html}),/Non-public reader bundle input/,'the bundled bootstrap is allowlist-gated like every bundle input');
  await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed.filter(file=>file!=='app/reader-book-actions-bootstrap.mjs')));
  await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out'),html}),/Non-public reader bundle input/,'the bundled bookplate bootstrap is allowlist-gated like every bundle input');
  await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed));
  const lazy=await buildReaderWeb({root,outputDir:path.join(root,'lazy'),html});assert.ok(!lazy.inputs.includes('app/reader-settings-choices.mjs'));
  assert.ok(lazy.inputs.includes('app/palette-bootstrap.mjs'),'the small trigger is statically bundled');
  assert.ok(!lazy.inputs.includes('app/command-palette.mjs'),'the palette module waits for a real gesture');
  const lazyJs=await readFile(path.join(root,'lazy',lazy.files.find(file=>file.endsWith('.js'))),'utf8');
  assert.match(lazyJs,/import\(["']\/reader-settings-choices\.mjs["']\)/);
  assert.match(lazyJs,/import\(["']\/command-palette\.mjs["']\)/,'command-palette is only reachable through the bundled bootstrap on demand');
  assert.equal(/import\(["']\/palette-bootstrap\.mjs["']\)/.test(lazyJs),false,'no reader-to-bootstrap lazy edge exists');
  assert.ok(lazy.inputs.includes('app/reader-book-actions-bootstrap.mjs'),'the bookplate bootstrap is statically bundled');
  assert.match(lazyJs,/import\(["']\/reader-book-actions\.mjs["']\)/,'the one exact lazy edge comes from the bookplate bootstrap');
  await writeFile(path.join(root,'app/reader.js'),'console.log("boot");');
  await writeFile(path.join(root,'app/reader-book-actions-bootstrap.mjs'),`import ${modulePath('reader-book-actions.mjs')};console.log("static");`);
  const staticKind=await buildReaderWeb({root,outputDir:path.join(root,'static-kind'),html});
  assert.ok(staticKind.inputs.includes('app/reader-book-actions.mjs'),'a static book-actions import stays bundled: the fence is dynamic-import kind only');
  await writeFile(path.join(root,'app/reader-book-actions-bootstrap.mjs'),'export const open=()=>null;');
  await writeFile(path.join(root,'app/reader.js'),`export const open=()=>import(${modulePath('reader-book-actions.mjs')});console.log(open);`);
  const otherCaller=await buildReaderWeb({root,outputDir:path.join(root,'other-caller'),html});
  assert.ok(otherCaller.inputs.includes('app/reader-book-actions.mjs'),'a book-actions import from any other importer stays bundled');
  await writeFile(path.join(root,'app/reader-book-actions.mjs'),`import {marker} from ${modulePath('gift-compose.mjs')};console.log(marker);`);
  await writeFile(path.join(root,'app/reader.js'),`import ${modulePath('reader-book-actions.mjs')};import {arrivalCatalog} from ${modulePath('arrival-catalog.mjs')};import {onlyOnOpen} from ${modulePath('reader-settings-choices.mjs')};import {palette} from ${modulePath('command-palette.mjs')};console.log(arrivalCatalog,onlyOnOpen,palette);`);
  await writeFile(path.join(root,'app/palette-bootstrap.mjs'),`export const open=()=>import(${modulePath('command-palette.mjs')});console.log(open);`);
  const result=await buildReaderWeb({root,outputDir:path.join(root,'out'),html});
  assert.ok(result.inputs.includes('app/gift-compose.mjs'),'a static gift import must remain subject to normal bundle validation');
  assert.ok(result.inputs.includes('app/arrival-catalog.mjs'),'a catalog import from another caller must remain bundled');
  assert.ok(result.inputs.includes('app/reader-settings-choices.mjs'),'a static Aa import from another caller must remain bundled');
  assert.ok(result.inputs.includes('app/command-palette.mjs'),'a palette import from another caller must remain bundled');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the authored-home navigation stays outside the reader graph and the fixed budgets hold',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'leafhour-home-nav-web-'));
 try{
  const result=await buildReaderWeb({root,outputDir:out,html:await readFile(path.join(root,'app/index.html'),'utf8')});
  for(const file of ['home-navigation.mjs','home-navigation.css','home-locale.mjs','home.html'])assert.ok(!result.inputs.includes('app/'+file),file+' stays outside the reader graph');
  for(const file of result.files){const bytes=await readFile(path.join(out,file));assert.ok(bytes.length<=(file.endsWith('.js')?320:200)*1024,file+' exceeds the fixed public asset budget');}
 }finally{await rm(out,{recursive:true,force:true});}
});

test('the exact palette retry edge is the one amended external import and stays fenced everywhere else',async()=>{
 const {buildReaderWeb}=await import('../tools/build-reader-web.mjs'),root=await realpath(await mkdtemp(path.join(tmpdir(),'leafhour-palette-retry-')));
 const html='<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><script type="module" src="/palette-bootstrap.mjs"></script><link rel="stylesheet" href="/styles.css"></head>';
 const base={'reader.js':'console.log("boot");','reader-translation.js':'export {};','styles.css':'body{color:#123}','command-palette.mjs':'export const palette={lazy:true};'};
 const allow=[...Object.keys(base).map(file=>'app/'+file),'app/palette-bootstrap.mjs'];
 try{
  await mkdir(path.join(root,'app'));
  const write=async(files,allowed)=>{await writeFile(path.join(root,'release-files.json'),JSON.stringify(allowed));for(const file of Object.keys(base))if(!(file in files))files[file]=base[file];for(const [file,contents]of Object.entries(files))await writeFile(path.join(root,'app',file),contents);};
  // 1. the exact retry URL from the bundled bootstrap, dynamic-import kind: allowed, same release entry.
  const lazyEdge=(name,specifier)=>'export const '+name+'=()=>import('+JSON.stringify(specifier)+');';
  await write({'palette-bootstrap.mjs':lazyEdge('open','./command-palette.mjs')+lazyEdge('retry','./command-palette.mjs?retry=1')+'console.log(open,retry);'},allow);
  const built=await buildReaderWeb({root,outputDir:path.join(root,'out'),html});
  assert.ok(!built.inputs.includes('app/command-palette.mjs'),'the retry edge stays external like the original edge');
  const js=await readFile(path.join(root,'out',built.files.find(file=>file.endsWith('.js'))),'utf8');
  assert.match(js,/import\(["']\/command-palette\.mjs\?retry=1["']\)/,'the exact retry URL survives as its own external edge');
  assert.match(js,/import\(["']\/command-palette\.mjs["']\)/,'the original lazy edge is unchanged');
  // 2. no other query is resolvable.
  await write({'palette-bootstrap.mjs':lazyEdge('retry','./command-palette.mjs?retry=2')+'console.log(retry);'},allow);
  await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out2'),html}),/Non-public lazy reader module/,'a different query stays rejected by policy');
  // 3. no other caller may use the retry edge.
  await write({'reader.js':lazyEdge('retry','./command-palette.mjs?retry=1')+'console.log(retry);','palette-bootstrap.mjs':'export const open=()=>null;'},allow);
  await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out3'),html}),/Non-public lazy reader module/,'the retry edge is exclusive to palette-bootstrap.mjs');
  // 4. the retry edge exists only as a dynamic import.
  await write({'palette-bootstrap.mjs':'import '+JSON.stringify('./command-palette.mjs?retry=1')+';export const open=()=>null;'},allow);
  await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out4'),html}),/Non-public lazy reader module/,'a static retry import stays rejected');
  // 5. the same release entry backs the retry edge.
  await write({'palette-bootstrap.mjs':lazyEdge('retry','./command-palette.mjs?retry=1')+'console.log(retry);'},allow.filter(file=>file!=='app/command-palette.mjs'));
  await assert.rejects(buildReaderWeb({root,outputDir:path.join(root,'out5'),html}),/Non-public lazy reader module/,'without the shared release entry nothing is externalized');
 }finally{await rm(root,{recursive:true,force:true});}
});
