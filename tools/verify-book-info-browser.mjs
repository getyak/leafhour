// GET-228: real browser + real isolated services. Error responses are explicit
// transport fixtures; successful/empty metadata comes from the domain service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Registered artifact and existing browser module required');
const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const engines=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const server=await createReaderServer({bookPath:path.join(out,'missing.json'),recordsPath:path.join(out,'records.json'),portalDataDir:path.join(out,'portal'),env:{},allowLocal:true,sendCode:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null});
const session=await server.portal.auth.localSession();
const book=await server.portal.library.importDocument(session.user,{filename:'Book info test.txt',bytes:Buffer.from('A synthetic opening for the introduction state tests.\n\nA second original paragraph.')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const report={kind:'real isolated server and browser; synthetic transport faults',cases:[],limits:['No real model generation, public gift creation or external sending.','Text zoom doubles computed text sizes in the Book info surface; no physical assistive output is claimed.']};let browser,context,activePage;
const dist=process.env.LEAFHOUR_VERIFY_DIST?path.resolve(process.env.LEAFHOUR_VERIFY_DIST):null;
const settle=p=>p.waitForFunction(()=>!document.querySelector('#book-intro-status').textContent.match(/Loading|Preparing|正在|読み込んで/));
const open=async p=>{if(await p.evaluate(()=>document.body.dataset.readingTools!=='open'))await p.locator('#reading-tools-trigger').click();await p.locator('#open-book-info').click();await p.locator('#book-info').waitFor({state:'visible'});};
const visibleText=async p=>p.locator('#book-info-description').evaluate(n=>({text:n.textContent,hidden:n.hidden}));
try{
 for(const [engine,exe]of [['chromium',process.env.LEAFHOUR_CHROMIUM_EXECUTABLE],['webkit',process.env.LEAFHOUR_WEBKIT_EXECUTABLE]]){
  browser=await engines[engine].launch({headless:true,...(exe?{executablePath:exe}:{})});
  for(const [locale,width,theme]of [['en',1280,'paper'],['zh-Hans',390,'night'],['zh-Hant',320,'paper'],['ja',320,'night']]){
   context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'});context.setDefaultTimeout(10000);
   await context.addCookies([{name:'marginalia_session',value:session.token,url:base}]);
   let mode='real',delayed=null,reads=0;const row={engine,version:browser.version(),locale,width,theme,checks:[],errors:[],requests:[]};report.cases.push(row);
   let releaseChunk,chunkStarted;const chunkGate=new Promise(r=>releaseChunk=r),chunkRequested=new Promise(r=>chunkStarted=r);let holdChunk=true;
   const p=activePage=await context.newPage();p.on('pageerror',e=>row.errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/introduction')){row.requests.push({method:r.method(),mode});assert.equal(r.method(),'GET');}});
   if(dist)await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!==base||u.pathname.startsWith('/api/'))return route.continue();
    const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname==='/gift-preview'?'book-gift.html':u.pathname.slice(1));if(!file.startsWith(dist+path.sep))throw Error('Package path escaped');
    const body=await fs.readFile(file),contentType=({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream';
    if(u.pathname==='/read')return route.fulfill({response:await route.fetch(),body,contentType});return route.fulfill({status:200,body,contentType});
   });
   await context.route('**/reader-book-actions.mjs',async route=>{if(holdChunk){chunkStarted();await chunkGate;}return route.fallback();});
   await context.route('**/api/library/books/*/introduction',async route=>{
    reads++;if(mode==='real')return route.continue();if(mode==='delay'){delayed=route;return;}
    if(mode==='json')return route.fulfill({status:200,contentType:'application/json',body:'not-json'});
    if(mode==='null')return route.fulfill({json:null});
    return route.fulfill({status:Number(mode),json:{error:'PRIVATE PROVIDER DETAIL'}});
   });
   const goto=async id=>{await p.goto(base+'/read?book='+encodeURIComponent(id)+'&ui='+locale,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.body.dataset.ready==='true');await p.evaluate(theme=>window.marginaliaPaletteAdapter.appearance.setTheme(theme),theme);};
   await goto(book.bookId);await open(p);await chunkRequested;
   await p.evaluate(()=>{document.dispatchEvent(new Event('reader:ready'));document.dispatchEvent(new Event('reader:chapter'));});
   assert.equal((await visibleText(p)).hidden,true);assert.equal(await p.locator('#book-info-share').isEnabled(),false);assert.equal(await p.locator('#book-info-share').getAttribute('aria-describedby'),'book-intro-status');assert.ok((await p.locator('#book-intro-status').textContent()).length>0);holdChunk=false;releaseChunk();await p.locator('#book-intro-retry').waitFor({state:'visible'});assert.equal(await p.locator('#book-intro-status').getAttribute('role'),'alert');assert.equal((await visibleText(p)).hidden,true);await p.keyboard.press('Escape');await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='empty');assert.equal(row.requests.length,1);row.checks.push('cold lazy module; real chapter event collapses parent tools; visible error, preserved unknown and close/reopen recovery with one GET');
   await p.keyboard.press('Escape');
   await goto('gutenberg-alice');await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='ready');
   assert.equal((await visibleText(p)).hidden,false);assert.ok((await visibleText(p)).text.length>0);assert.equal(await p.locator('#book-info-share').isEnabled(),true);
   assert.equal(await p.locator('#book-info-share').getAttribute('aria-describedby'),null);row.checks.push('real public-domain description; enabled sharing independent of introduction');
   await p.screenshot({path:path.join(out,engine+'-'+locale+'-'+width+'-ready.png')});await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'open-book-info');
   await goto(book.bookId);await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='empty');
   assert.equal((await visibleText(p)).hidden,false);assert.equal(await p.locator('#book-intro-retry').isVisible(),false);assert.equal(await p.locator('#book-intro-generate').isEnabled(),false);row.checks.push('real missing metadata; explicit empty state; unavailable generator disabled');
   for(const fault of ['500','429','403','json','null']){
    await p.keyboard.press('Escape');mode=fault;await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='error');
    assert.equal((await visibleText(p)).hidden,true);assert.equal(await p.locator('#book-intro-retry').isVisible(),true);assert.equal(await p.locator('#book-intro-status').getAttribute('role'),'alert');assert.doesNotMatch(await p.locator('#book-intro-status').textContent(),/PRIVATE/);assert.equal(await p.locator('#book-info-share').isEnabled(),true);assert.equal(await p.locator('#book-intro-generate').isEnabled(),false);
    if(fault==='429')await p.screenshot({path:path.join(out,engine+'-'+locale+'-'+width+'-error.png')});
    mode='real';await p.locator('#book-intro-retry').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='empty');assert.equal(await p.evaluate(()=>document.activeElement.id),'book-info');row.checks.push(fault+' error, safe reason, explicit GET retry, panel focus retained');
   }
   // A slow old answer after close/reopen cannot overwrite the new read.
   await p.keyboard.press('Escape');mode='delay';await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='loading');
   await p.keyboard.press('Escape');mode='real';await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='empty');
   if(delayed){await delayed.fulfill({json:{source:'provided',text:'STALE ANSWER',introduction:null,available:true}}).catch(()=>{});delayed=null;}
   assert.doesNotMatch((await visibleText(p)).text,/STALE/);row.checks.push('close/reopen cancels old read; late answer cannot paint');
   if(locale==='en'){
    await p.keyboard.press('Escape');mode='delay';await open(p);await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='error',null,{timeout:18000});assert.match(await p.locator('#book-intro-status').textContent(),/timed out/);if(delayed){await delayed.abort().catch(()=>{});delayed=null;}mode='real';await p.locator('#book-intro-retry').click();await p.waitForFunction(()=>document.querySelector('#book-info').dataset.introductionState==='empty');row.checks.push('real 15s client deadline and explicit recovery');
   }
   // Existing gift path opens and can be cancelled without creating a link.
   const beforeGifts=await server.portal.gifts.list(session.user,book.bookId);await p.locator('#book-info-share').click();await p.locator('#reader-book-gift[open] #gift-message').waitFor();await p.locator('#gift-message').fill('Synthetic unsent draft');await p.keyboard.press('Escape');await open(p);await p.locator('#book-info-share').click();assert.equal(await p.locator('#gift-message').inputValue(),'Synthetic unsent draft');await p.keyboard.press('Escape');assert.deepEqual(await server.portal.gifts.list(session.user,book.bookId),beforeGifts);row.checks.push('existing gift composer, draft survives cancellation, no published link');
   await open(p);await p.screenshot({path:path.join(out,engine+'-'+locale+'-'+width+'-empty.png')});
   await p.locator('#book-info').evaluate(n=>{for(const node of [n,...n.querySelectorAll('*')]){const size=parseFloat(getComputedStyle(node).fontSize);node.style.fontSize=size*2+'px';}});
   const geometry=await p.locator('#book-info').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth,rect:n.getBoundingClientRect().toJSON()}));assert.ok(geometry.scroll<=geometry.client+1);assert.ok(geometry.rect.x>=0&&geometry.rect.right<=width+1);await p.locator('#close-book-info').click();row.checks.push('200% text sizing, scrollable close action, no horizontal clipping');
   await open(p);await p.mouse.click(width-6,790);assert.equal(await p.locator('#book-info').isVisible(),false);row.checks.push('outside dismissal');
   assert.equal(row.errors.length,0);row.reads=reads;await context.close();context=null;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({engine,locale,width,checks:row.checks.length}));
  }
  await browser.close();browser=null;
 }
}catch(error){report.debug=await activePage?.evaluate(()=>({tools:document.body.dataset.readingTools,status:document.querySelector('#book-intro-status')?.textContent,retryHidden:document.querySelector('#book-intro-retry')?.hidden,open:document.querySelector('#book-info')?.hasAttribute('data-popover-open'),state:document.querySelector('#book-info')?.dataset.introductionState,trigger:{visibility:getComputedStyle(document.querySelector('#open-book-info')).visibility,rect:document.querySelector('#open-book-info').getBoundingClientRect().toJSON()},dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.id)})).catch(()=>null);report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.log(error.message);}
finally{const cleanup=await Promise.allSettled([context?.close(),browser?.close(),new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))]);report.cleanup=cleanup.map(x=>({status:x.status}));if(cleanup.some(x=>x.status==='rejected'))process.exitCode=1;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
