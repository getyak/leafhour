// GET-230: packaged reader, real isolated library, explicitly delayed transport.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
import {requestUiRoute,t} from '../app/ui-locale.mjs';
if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE||!process.env.LEAFHOUR_VERIFY_DIST)throw Error('Registered artifact, existing browser module and packaged reader required');
const out=path.resolve(process.argv[2]),dist=path.resolve(process.env.LEAFHOUR_VERIFY_DIST);
await fs.mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const server=await createReaderServer({bookPath:path.join(out,'missing.json'),recordsPath:path.join(out,'records.json'),portalDataDir:path.join(out,'portal'),env:{},allowLocal:true,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null});
const session=await server.portal.auth.localSession();
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const report={kind:'packaged browser with real isolated services and deliberate network gates',cases:[],limits:['Synthetic delays and 503 are transport fixtures, not real provider failures.','Local timings are observations, not a production latency guarantee. No model call, iOS or assistive speech test.']};
let browser,context;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
try{
 browser=await chromium.launch({headless:true,...(process.env.LEAFHOUR_CHROMIUM_EXECUTABLE?{executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE}:{})});
 for(const [locale,width,motion]of [['en',1280,'no-preference'],['zh-Hans',390,'reduce'],['zh-Hant',320,'reduce'],['ja',390,'reduce']]){
  await requestUiRoute(locale);
  context=await browser.newContext({viewport:{width,height:800},reducedMotion:motion});context.setDefaultTimeout(15000);
  await context.addCookies([{name:'marginalia_session',value:session.token,url:base}]);
  const p=await context.newPage(),scripts=deferred(),auth=deferred(),reading=deferred(),assets=deferred(),styles=deferred();
  const row={locale,width,motion,version:browser.version(),checks:[],errors:[],catalogueRequests:0};report.cases.push(row);
  p.on('pageerror',e=>row.errors.push(e.message));let mode='hold';
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
   if(u.pathname==='/arrival-catalog.mjs'){row.catalogueRequests++;await assets.promise;}
   if(u.pathname==='/api/auth/session')await auth.promise;
   if(u.pathname.endsWith('/reading')){
    if(mode==='hold')await reading.promise;
    if(mode==='fail')return route.fulfill({status:503,json:{error:'Synthetic reading transport failure'}});
   }
   if(u.pathname.startsWith('/api/'))return route.continue();
   if(mode==='style-error'&&/\/reader-web\/style-.*\.css$/.test(u.pathname))return route.fulfill({status:503,body:'Synthetic stylesheet transport failure'});
   if(/\.(?:js|mjs)$/.test(u.pathname))await scripts.promise;
   if(u.pathname.endsWith('.css'))await styles.promise;
   if(/\.(?:svg|png|webp|jpg)$/.test(u.pathname))await assets.promise;
   const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));if(!file.startsWith(dist+path.sep))throw Error('Package path escaped');
   const body=await fs.readFile(file),contentType=({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream';
   return route.fulfill({...u.pathname==='/read'?{response:await route.fetch()}:{status:200},body,contentType});
  });
  try{
   const url=base+'/read?book=gutenberg-alice&ui='+locale;
   await p.goto(url,{waitUntil:'commit'});await p.locator('#loading .reading-skeleton').waitFor({state:'visible'});
   await p.waitForFunction(()=>performance.getEntriesByType('paint').some(p=>p.name==='first-contentful-paint'));
   const measure=()=>p.evaluate(()=>({atMs:Math.round(performance.now()),skeleton:!!document.querySelector('.reading-skeleton')?.getClientRects().length,passages:document.querySelectorAll('.passage').length,overflow:document.documentElement.scrollWidth>innerWidth}));
   row.beforeScripts=await measure();row.firstPaintBeforeStyles=await p.evaluate(()=>performance.getEntriesByType('paint').find(p=>p.name==='first-contentful-paint').startTime);assert.equal(row.beforeScripts.skeleton,true);assert.equal(row.beforeScripts.passages,0);assert.equal(row.beforeScripts.overflow,false);
   assert.equal(await p.locator('#loading a').getAttribute('href'),'/library');
   await p.screenshot({path:path.join(out,locale+'-skeleton.png')});row.checks.push('text-column skeleton and working library exit before full CSS, JavaScript, auth or book data');
   const starting=p.waitForRequest(r=>new URL(r.url()).pathname.endsWith('/reading'));
   styles.resolve();scripts.resolve();auth.resolve();await starting;
   assert.equal(await p.locator('#loading .reading-skeleton').isVisible(),true);
   if(locale==='en'){
    await p.locator('[data-loading-retry]').waitFor({state:'visible'});
    const status=await p.locator('#loading [role=status]').textContent();assert.equal(status,'Opening the book…');
    await p.locator('[data-loading-retry]').focus();assert.equal(await p.locator('[data-loading-retry]').evaluate(n=>n===document.activeElement),true);
    row.checks.push('slow read keeps the same short status; keyboard-accessible reopen appears');
   }
   reading.resolve();await p.locator('.passage').first().waitFor({state:'visible'});await p.waitForFunction(()=>document.body.dataset.ready==='true');
   assert.equal(await p.locator('#loading').isVisible(),false);assert.equal(await p.locator('#loading .arrival-scene').count(),0);assert.equal(row.catalogueRequests,0);
   await p.evaluate(()=>scrollTo(0,400));await p.waitForFunction(()=>scrollY>100);
   row.withImagesPending=await measure();assert.equal(row.withImagesPending.skeleton,false);assert.ok(row.withImagesPending.passages>0);assert.equal(row.withImagesPending.overflow,false);
   const selection=await p.locator('.passage p[data-reading-layer]').first().evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(range);return s.toString();});assert.ok(selection.length>20);
   row.checks.push('real book text is scrollable and selectable while all images are still held; no arrival catalogue request');
   assets.resolve();await p.screenshot({path:path.join(out,locale+'-ready.png')});
   // Keep a real account-scoped draft sentinel through failure, retry and reload.
   const key='marginalia-focus-drafts-v2|'+session.user.id+'|gutenberg-alice',draft='GET-230 synthetic unsaved thought';
   await p.evaluate(({key,draft})=>localStorage.setItem(key,JSON.stringify({sentinel:draft})),{key,draft});
   const saved=await p.evaluate(async()=>{await window.marginaliaReader.retryPositionSave();return {anchor:window.marginaliaReader.getAnchor(),state:window.marginaliaReader.getState()};});assert.ok(saved.anchor?.passageId);
   mode='fail';await p.goto(url,{waitUntil:'domcontentloaded'});await p.locator('#load-error').waitFor({state:'visible'});assert.equal(await p.locator('#loading').isVisible(),false);assert.ok((await p.locator('#load-error p').textContent()).length>0);
   mode='real';await p.locator('#retry-load').click();await p.waitForFunction(()=>document.body.dataset.ready==='true');assert.equal(await p.locator('#load-error').isVisible(),false);assert.equal(await p.locator('#loading').isVisible(),false);
   assert.equal(await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).sentinel,key),draft);
   const restored=await p.evaluate(()=>({anchor:window.marginaliaReader.getAnchor(),state:window.marginaliaReader.getState()}));assert.equal(restored.anchor?.passageId,saved.anchor.passageId);assert.equal(restored.state.chapterId,saved.state.chapterId);assert.equal(restored.state.mode,saved.state.mode);assert.equal(restored.state.variant,saved.state.variant);
   assert.equal(await p.locator('#book-page').evaluate(n=>n===document.activeElement),true);
   row.checks.push('503 remains a real error; explicit retry restores text and focus with saved passage/chapter/view and account-scoped draft storage intact');
   {
    mode='style-error';const failure=p.waitForEvent('pageerror',{predicate:e=>e.message==='Reader styles unavailable'});
    await p.goto(url,{waitUntil:'domcontentloaded'});await failure;await p.locator('[data-loading-retry]').waitFor({state:'visible'});
    assert.equal(await p.locator('#loading .reading-skeleton').isVisible(),false);assert.equal(await p.locator('#loading a').isVisible(),true);await p.waitForFunction(expected=>document.querySelector('#loading [role=status]').textContent===expected,t('reader.shell.loadError'));assert.equal(await p.locator('[data-loading-retry]').textContent(),t('reader.shell.retryOpen'));assert.equal(await p.locator('#loading a').textContent(),t('reader.shell.backLibrary'));
    mode='real';await p.locator('[data-loading-retry]').click();await p.waitForFunction(()=>document.body?.dataset.ready==='true');assert.equal(await p.locator('#loading').isVisible(),false);
    row.expectedStyleError='Reader styles unavailable';row.checks.push('synthetic full stylesheet failure keeps library exit and readable failure; explicit reopen fetches real CSS and restores the reader');
   }
   assert.deepEqual(row.errors,['Reader styles unavailable']);console.log(locale+' '+width+': passed');
  }finally{styles.resolve();scripts.resolve();auth.resolve();reading.resolve();assets.resolve();await context.close();context=null;}
 }
}finally{
 await fs.writeFile(path.join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();await new Promise(r=>server.close(r));
}
