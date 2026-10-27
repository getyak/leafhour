import {choosePassage,openNavigation,openProgress,openCompanion} from './browser-interactions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {captureDOM} from '../2026-10-26-ios-half-sheet/capture-dom.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
if(!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Set an existing Playwright module');
const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const key='leafhour-ios-half-sheet-prototype-v1';
// A600px fixture keeps this four-paragraph chapter scrollable after pure reading
// claims its safe-area height. Full-height clamping remains covered below.
const SCROLLABLE_HEIGHT=600;
const identity={bookId:'walden-public-sample',sourceVersion:'prototype-20261026',layer:'interpretive'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(url.endsWith('/')?url+'index.html':url));
    if(!file.startsWith(root+path.sep))throw Error('Outside prototype');
    const bytes=await fs.readFile(file);
    res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
const report={at:new Date().toISOString(),checks:[],errors:[],externalRequests:[]};
const settled=async p=>p.locator('#reader-sheet[data-motion="settled"]').waitFor({state:'attached'});
const layoutSettled=async p=>{
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await p.waitForFunction(()=>!document.getElementById('reading-scroll').hasAttribute('data-restoring'));
};
const snapshot=p=>p.evaluate(()=>window.leafhourPrototype.snapshot());
const visible=p=>p.evaluate(()=>{
  const view=document.getElementById('reading-scroll'),top=view.getBoundingClientRect().top+20;
  const node=[...document.querySelectorAll('[data-passage]')].find(n=>n.querySelector('.passage-text').getBoundingClientRect().bottom>top);
  return node?.id;
});
async function page(width=402,saved=null){
  const c=await browser.newContext({viewport:{width,height:SCROLLABLE_HEIGHT},hasTouch:true,isMobile:true});
  await c.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)||u.startsWith('data:'))return r.continue();report.externalRequests.push(u);return r.abort();});
  if(saved)await c.addInitScript(({key,saved})=>{if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,JSON.stringify(saved));},{key,saved});
  const p=await c.newPage();p.setDefaultTimeout(Number(process.env.LEAFHOUR_BROWSER_TIMEOUT_MS) || 10000);p.on('pageerror',e=>report.errors.push(e.message));await p.goto(base+'/prototype/');await layoutSettled(p);return {c,p};
}
async function check(name,fn){
  const owned=[];
  const open=async(w,s,options={})=>{const value=await page(w,s);owned.push(value.c);if(options.reducedMotion)await value.p.emulateMedia({reducedMotion:options.reducedMotion});return value.p;};
  try{await fn(open);report.checks.push({name,status:'pass'});console.log('PASS',name);}
  catch(e){report.checks.push({name,status:'fail',message:e.message});console.log('FAIL',name,e.message);}
  finally{await Promise.all(owned.map(c=>c.close()));}
}
async function atSecondParagraph(p){
  await openNavigation(p);await p.getByRole('button',{name:'排版设置',exact:true}).click();await settled(p);
  for(let i=0;i<6;i++)await p.getByRole('button',{name:'增大字号',exact:true}).click();
  await p.getByRole('button',{name:'完成',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
  await p.locator('#reading-scroll').evaluate(n=>{n.scrollTop=document.getElementById('walden-2-002').offsetTop-24;});
  await p.waitForFunction(key=>JSON.parse(sessionStorage.getItem(key)||'{}').readingTop===document.getElementById('reading-scroll').scrollTop,key);
  assert.equal(await visible(p),'walden-2-002','the fixture must actually reach the second paragraph');
  return p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
}
try{
  await check('cold-resume-keeps-the-source-paragraph-across-widths',async open=>{
    const p=await open(402);const saved=await atSecondParagraph(p);
    await p.locator('#phone').screenshot({path:path.join(root,'evidence','resume-wide-before.png')});
    const narrow=await open(320,saved);assert.equal(await visible(narrow),'walden-2-002');
    assert.equal((await snapshot(narrow)).route,'closed');
    await narrow.locator('#phone').screenshot({path:path.join(root,'evidence','resume-narrow-after.png')});
    await fs.mkdir(path.join(root,'exports'),{recursive:true});
    await fs.copyFile(path.join(root,'evidence','resume-narrow-after.png'),path.join(root,'exports','14-resume-narrow.png'));
    await fs.mkdir(path.join(root,'captures'),{recursive:true});
    const scene=await narrow.evaluate(captureDOM,{name:'14 · 窄屏续读'});
    await fs.writeFile(path.join(root,'captures','14-resume-narrow.json'),JSON.stringify(scene,null,2));
  });
  await check('live-resize-does-not-rewrite-the-logical-character-anchor',async open=>{
    const p=await open(402);await atSecondParagraph(p);const before=(await snapshot(p)).readingPosition;
    assert.ok(before?.offsetUtf16>=0,'a logical locator is required');
    await p.setViewportSize({width:320,height:SCROLLABLE_HEIGHT});
    await layoutSettled(p);
    assert.equal(await visible(p),'walden-2-002');
    const after=(await snapshot(p)).readingPosition;assert.equal(after.passageId,before.passageId);assert.equal(after.offsetUtf16,before.offsetUtf16);
    await p.setViewportSize({width:402,height:SCROLLABLE_HEIGHT});await p.setViewportSize({width:320,height:SCROLLABLE_HEIGHT});
    await layoutSettled(p);
    assert.equal((await snapshot(p)).readingPosition.offsetUtf16,before.offsetUtf16);
  });
  await check('legacy-pixels-migrate-without-dropping-the-current-session',async open=>{
    const p=await open(402,{size:28,layer:'interpretive',readingTop:497,draft:'保留旧问题草稿'});
    const s=await snapshot(p);assert.ok(s.readingPosition?.passageId);assert.equal(s.draft,'保留旧问题草稿');
    const stored=await p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
    assert.equal(stored.readingPosition?.passageId,s.readingPosition.passageId,'the migrated locator must be saved before reopening');
    await p.reload();
    assert.equal((await snapshot(p)).readingPosition.passageId,s.readingPosition.passageId);
  });
  await check('a-foreign-document-locator-falls-back-to-the-start-safely',async open=>{
    const p=await open(402,{size:28,layer:'interpretive',readingTop:497,readingPosition:{schema:1,...identity,bookId:'different-book',passageId:'walden-2-002',offsetUtf16:0,fraction:0,viewportOffsetPx:0}});
    assert.equal(await p.locator('#reading-scroll').evaluate(n=>n.scrollTop),0);
    assert.equal((await snapshot(p)).route,'closed');
  });
  await check('restoring-reading-does-not-rebind-a-previous-question-or-draft',async open=>{
    const first=await open(402);const saved=await atSecondParagraph(first);
    saved.quote={passageId:'walden-2-001',text:'原来提问的那一句',layer:'interpretive',version:'prototype-20261026',startUtf16:0,endUtf16:8};saved.draft='还没有问完';saved.question='已有问题';
    const p=await open(320,saved);const s=await snapshot(p);
    assert.equal(await visible(p),'walden-2-002');assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.draft,'还没有问完');assert.equal(s.question,'已有问题');
  });
  await check('the-entry-marker-follows-the-restored-paragraph',async open=>{
    const first=await open(402);const saved=await atSecondParagraph(first);const p=await open(320,saved);
    assert.equal(await p.locator('.resume-mark').evaluate(n=>n.closest('[data-passage]').id),'walden-2-002');
  });
  await check('smaller-type-keeps-the-target-word-and-logical-offset-even-at-the-book-end',async open=>{
    const p=await open(402);await atSecondParagraph(p);const before=(await snapshot(p)).readingPosition;
    await openNavigation(p);await p.getByRole('button',{name:'排版设置',exact:true}).click();await settled(p);
    for(let i=0;i<10;i++)await p.getByRole('button',{name:'减小字号',exact:true}).click();
    await p.getByRole('button',{name:'完成',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    const after=(await snapshot(p)).readingPosition;
    assert.equal(after.passageId,before.passageId);assert.equal(after.offsetUtf16,before.offsetUtf16);
    const onPage=await p.locator('#walden-2-002 .passage-text').evaluate(n=>{const r=n.getBoundingClientRect(),v=document.getElementById('reading-scroll').getBoundingClientRect();return r.bottom>v.top && r.top<v.bottom;});
    assert.ok(onPage,'The bookmarked text must still be visible when the short sample clamps the scroll range');
  });
  await check('changing-text-layer-uses-the-same-paragraph-with-a-new-layer-offset',async open=>{
    const p=await open(402);await atSecondParagraph(p);
    await openNavigation(p);await p.getByRole('button',{name:'排版设置',exact:true}).click();await settled(p);
    for(let i=0;i<10;i++)await p.getByRole('button',{name:'减小字号',exact:true}).click();
    await p.getByRole('button',{name:'直译',exact:true}).click();
    await p.getByRole('button',{name:'完成',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    const position=(await snapshot(p)).readingPosition;
    assert.equal(position.passageId,'walden-2-002');assert.equal(position.layer,'literal');
    const length=await p.locator('#walden-2-002 .passage-text').evaluate(n=>n.textContent.length);
    assert.ok(position.offsetUtf16>=0 && position.offsetUtf16<length);
  });
  for(const reducedMotion of ['no-preference','reduce'])await check('directory-jump-survives-panel-close-and-reopen-'+reducedMotion,async open=>{
    const p=await open(320,{size:28,layer:'interpretive'},{reducedMotion});
    await openNavigation(p);await p.locator('#contents-button').click();await settled(p);
    await p.locator('[data-jump="walden-2-002"]').click();await p.locator('#reader-sheet').waitFor({state:'hidden'});await layoutSettled(p);
    assert.equal(await visible(p),'walden-2-002');
    assert.equal((await snapshot(p)).readingPosition.passageId,'walden-2-002');
    const saved=await p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);assert.equal(saved.readingPosition.passageId,'walden-2-002');
    await p.reload();await layoutSettled(p);assert.equal((await snapshot(p)).readingPosition.passageId,'walden-2-002');assert.equal(await visible(p),'walden-2-002');
  });
  await check('a-note-record-jump-updates-reading-without-changing-its-bound-source',async open=>{
    const quote={passageId:'walden-2-002',text:'固定样章第二段',layer:'interpretive',version:'prototype-20261026',startUtf16:0,endUtf16:8};
    const p=await open(320,{size:28,layer:'interpretive',notes:[{text:'定位测试：第二段',author:'user',quote}]});
    await openNavigation(p);await p.locator('#library-button').click();await settled(p);await p.locator('[data-action="records"]').click();await settled(p);
    await p.locator('[data-record="0"]').click();await p.locator('#reader-sheet').waitFor({state:'hidden'});await layoutSettled(p);
    assert.equal((await snapshot(p)).readingPosition.passageId,'walden-2-002');
    const saved=await p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);assert.equal(saved.notes[0].quote.passageId,'walden-2-002');assert.equal(saved.notes[0].author,'user');
  });
  await check('a-nonzero-character-anchor-survives-reflow-and-reentry',async open=>{
    const position={schema:1,...identity,passageId:'walden-2-002',offsetUtf16:16,fraction:0.3,viewportOffsetPx:8};
    const p=await open(320,{size:28,layer:'interpretive',readingPosition:position});
    for(const width of [402,320,402,320]){
      await p.setViewportSize({width,height:874});await layoutSettled(p);
      const stored=(await snapshot(p)).readingPosition;assert.equal(stored.passageId,'walden-2-002');assert.equal(stored.offsetUtf16,16);
    }
    await p.reload();await layoutSettled(p);assert.equal((await snapshot(p)).readingPosition.offsetUtf16,16);
    const onScreen=await p.locator('#walden-2-002 .passage-text').evaluate(n=>{const range=document.createRange();range.setStart(n.firstChild,16);range.setEnd(n.firstChild,17);const r=range.getBoundingClientRect(),v=document.getElementById('reading-scroll').getBoundingClientRect();return r.bottom>v.top && r.top<v.bottom;});
    assert.ok(onScreen,'The same character must remain in the readable viewport');
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status=report.checks.every(c=>c.status==='pass')?'pass':'fail';
}finally{
  await fs.mkdir(path.join(root,'evidence'),{recursive:true});
  await fs.writeFile(path.join(root,'evidence',process.env.LEAFHOUR_READING_REPORT||'reading-position-verification.json'),JSON.stringify(report,null,2));
  await browser.close();await new Promise(r=>server.close(r));
}
if(report.status!=='pass')process.exitCode=1;
