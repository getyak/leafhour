import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
const output=process.argv[2];
if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Output path and browser module required');
await mkdir(output,{recursive:true});
const data=await mkdtemp(path.join(tmpdir(),'leafhour-chat-sidebar-')),codes=new Map();
const server=await createReaderServer({bookPath:path.join(data,'missing.json'),recordsPath:path.join(data,'records.json'),portalDataDir:path.join(data,'portal'),allowLocal:false,env:{},sendCode:async(email,code)=>codes.set(email,code),companionGenerator:null,chatGenerator:null});
const report={cases:[],errors:[],limits:['Local synthetic account; no provider calls or production records.','Chromium only; physical mobile keyboard and screen reader not tested.']};
if(process.argv.includes('--paginated-only')){const previous=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));report.cases=previous.cases;}
let browser;console.log('Local server created');
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const wake=async page=>{if(await page.locator('body').getAttribute('data-reading-tools')!=='open'){await page.locator('#reading-tools-trigger').focus();await page.keyboard.press('Enter');}};
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});report.browser=browser.version();console.log('Browser started');
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),email='sidebar-local@example.com';
 assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
 assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
 console.log('Synthetic account ready');const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 for(const [width,height,locale]of (process.argv.includes('--paginated-only')?[]:[[1440,900,'zh-Hans'],[1200,700,'en'],[1100,700,'ja'],[768,1024,'zh-Hant'],[390,844,'zh-Hans']])){
  console.log('Checking',width,locale);await page.setViewportSize({width,height});await page.goto(base+'/read?book=gutenberg-alice&ui='+locale,{waitUntil:'networkidle'});
  const trigger=page.locator('.library-chat-trigger'),dialog=page.locator('#reader-conversation');await trigger.waitFor({state:'attached'});await wake(page);
  await page.evaluate(()=>window.scrollTo(0,500));await settle(page);const before=await page.evaluate(()=>window.marginaliaReader.getAnchor());
  await page.screenshot({path:path.join(output,`${width}-closed.png`)});await wake(page);await trigger.click();await dialog.waitFor({state:'visible'});await settle(page);
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
  assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  if(width>=1100){
   assert.equal(bounds.y,0);assert.equal(bounds.height,height);assert.equal(bounds.x+bounds.width,width);
   const book=await page.locator('#book-page').boundingBox();assert.ok(book.x+book.width<=bounds.x+1,'book does not overlap sidebar');
   const anchor=await page.evaluate(()=>window.marginaliaReader.getAnchor());assert.equal(anchor.passageId,before.passageId);assert.ok(Math.abs(anchor.withinParagraph-before.withinParagraph)<.02||Math.abs(anchor.offset-before.offset)<2,'source position survives reflow');
   await page.locator('#book-page').click({position:{x:10,y:180}});assert.equal(await dialog.evaluate(e=>e.open),true,'reading does not dismiss sidebar');
   const header=await page.locator('#reading-header').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(header.scroll<=header.width+1,'reader header fits remaining width');
   const sep=page.locator('.reader-chat-separator');await sep.focus();await page.keyboard.press('ArrowLeft');await settle(page);assert.equal(Math.round((await dialog.boundingBox()).width),Math.round(bounds.width)+16);
   await page.keyboard.press('Home');await settle(page);assert.equal(Math.round((await dialog.boundingBox()).width),320);for(let i=0;i<5;i++)await sep.press('ArrowLeft');await settle(page);await page.evaluate(()=>window.marginaliaReader.dismissTools());await page.locator('.library-chat-close').focus();
  }else{assert.equal(await dialog.getAttribute('aria-modal'),'true');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');}
  await page.screenshot({path:path.join(output,`${width}-open.png`)});
  await page.locator('.library-chat-close').click();await settle(page);assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.body.classList.contains('has-reader-chat')),false);
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('library-chat-trigger')),true);assert.equal(await page.locator('#reading-session').getAttribute('data-expanded'),'false','closing chat keeps tools collapsed');await trigger.waitFor({state:'visible'});
  // The entry remains usable after the reading tools collapse.
  await page.evaluate(async()=>{const {readerTools}=await import('/reader-tools.mjs');readerTools().toolbar.conceal({restoreFocus:false});});await trigger.waitFor({state:'visible'});
  report.cases.push({width,height,locale,passed:true});
 }
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/read?book=gutenberg-alice&ui=zh-Hans',{waitUntil:'networkidle'});
 await wake(page);await page.locator('#open-settings').click();await page.locator('#page-layout').selectOption('spread',{force:true});await page.locator('[data-close-dialog="settings-dialog"]').first().click();await page.waitForFunction(()=>document.body.dataset.paginated==='true');
 await wake(page);await page.locator('.library-chat-trigger').click();await settle(page);let book=await page.locator('#book-page').boundingBox(),panel=await page.locator('#reader-conversation').boundingBox();assert.ok(book.x+book.width<=panel.x+1);assert.equal(panel.height,900);
 await page.screenshot({path:path.join(output,'1440-paginated.png')});
 await page.setViewportSize({width:390,height:420});await settle(page);assert.equal(await page.locator('#reader-conversation').getAttribute('aria-modal'),'true');
 await page.setViewportSize({width:1440,height:900});await settle(page);assert.equal(await page.locator('#reader-conversation').getAttribute('aria-modal'),'false');assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 await page.locator('#book-page').focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#reader-conversation').open);
 assert.deepEqual(report.errors,[]);report.passed=true;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){report.failure=error.message;await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
