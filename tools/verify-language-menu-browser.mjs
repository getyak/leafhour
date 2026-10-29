// Local isolated UI acceptance; no real accounts or model calls.
// LEAFHOUR_PLAYWRIGHT_MODULE=/absolute/path/playwright-core/index.mjs node tools/verify-language-menu-browser.mjs <output-directory>
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
if(!process.env.LEAFHOUR_PLAYWRIGHT_MODULE||!process.argv[2])throw Error('Explicit browser module and output directory required');
const {chromium,webkit}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const output=path.resolve(process.argv[2]);await mkdir(output,{recursive:true});
const data=await mkdtemp(path.join(tmpdir(),'leafhour-language-menu-'));
const server=await createReaderServer({recordsPath:path.join(data,'records.json'),portalDataDir:path.join(data,'portal'),env:{},allowLocal:false,translator:null,sendCode:null});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,report={checks:[],errors:[],expectedErrors:[],failedRequests:[],limits:['Headless browser touch emulation does not prove physical iPhone or screen-reader speech.']};
let browser;
try{
 for(const [engine,options,name] of [[chromium,{channel:'chrome'},'chromium'],[webkit,{},'webkit']]){
  browser=await engine.launch({headless:true,...options});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage();
  let phase='',blockedPortal=false;
  page.on('pageerror',e=>{
   const item={engine:name,phase,message:e.message};
   if(phase==='cold entry works while private library bootstrap is unavailable'&&blockedPortal&&/Importing a module script failed/.test(e.message))report.expectedErrors.push({...item,reason:'The test explicitly aborted /portal.js.'});
   else report.errors.push(item);
  });
  page.on('requestfailed',r=>report.failedRequests.push({engine:name,phase,path:new URL(r.url()).pathname,failure:r.failure()?.errorText}));
  const navigate=page.goto.bind(page);page.goto=async(...args)=>{const response=await navigate(...args);await page.waitForLoadState('networkidle');return response;};
  const trigger=page.locator('#home-menu-trigger'),menu=page.locator('#home-menu');
  const open=()=>menu.evaluate(n=>n.open);
  const check=async(label,fn)=>{phase=label;await fn();report.checks.push({engine:name,label});console.log(name,label,'PASS');};
  await check('cold entry works while private library bootstrap is unavailable',async()=>{
   await page.route('**/portal.js',r=>{blockedPortal=true;return r.abort();});await page.goto(base+'/en');
   await trigger.click();assert.equal(await open(),true);await page.keyboard.press('Escape');
   await page.unroute('**/portal.js');
  });
  await check('hover reveals without focus movement, survives the gap and click pins',async()=>{
   await page.goto(base+'/en');await page.locator('.brand').first().focus();
   await trigger.hover();await menu.waitFor({state:'visible'});
   assert.equal(await page.locator('.brand').first().evaluate(n=>n===document.activeElement),true);
   assert.equal(await page.evaluate(()=>!!document.querySelector('dialog:modal')),false);
   const t=await trigger.boundingBox(),m=await menu.boundingBox();
   assert.ok(m.y>=t.y+t.height&&m.y<=t.y+t.height+9);
   await page.mouse.move(t.x+t.width/2,t.y+t.height+4);await page.waitForTimeout(80);
   await page.mouse.move(m.x+m.width/2,m.y+24);
   await page.locator('#home-menu a[hreflang="ja"]').hover();await page.waitForTimeout(250);assert.equal(await open(),true);
   await trigger.click();await page.mouse.move(300,600);await page.waitForTimeout(260);assert.equal(await open(),true);
   await page.screenshot({path:path.join(output,name+'-desktop.png')});
   await trigger.click();await page.mouse.move(300,600);assert.equal(await open(),false);
   await trigger.hover();await menu.waitFor({state:'visible'});await page.mouse.move(300,600);await page.waitForTimeout(260);assert.equal(await open(),false);
  });
  await check('keyboard and outside dismissal keep focus natural',async()=>{
   await trigger.focus();await page.keyboard.press('Enter');assert.equal(await open(),true);
   assert.equal(await page.locator('#home-menu a[aria-current]').evaluate(n=>n===document.activeElement),true);
   await page.keyboard.press('Tab');assert.equal(await open(),true);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement===document.getElementById('home-menu-trigger'));assert.equal(await trigger.evaluate(n=>n===document.activeElement),true);
   await trigger.evaluate(n=>{n.click();n.click();n.click();});await page.waitForTimeout(100);
   assert.equal(await open(),true);assert.equal(await trigger.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
   await page.mouse.move(300,600);await trigger.click();await page.locator('.brand').first().focus();assert.equal(await open(),false);
   await trigger.click();await page.mouse.click(600,700);assert.equal(await open(),false);
  });
  await check('all four language links navigate and disclose the current language',async()=>{
   for(const [lang,route]of [['zh-Hans','/zh-hans'],['zh-Hant','/zh-hant'],['ja','/ja'],['en','/en']]){
    await trigger.click();await page.locator('#home-menu a[hreflang="'+lang+'"]').click();
    await page.waitForURL(base+route);await page.waitForLoadState('networkidle');assert.equal(await page.locator('html').getAttribute('lang'),lang);
    await trigger.click();assert.equal(await page.locator('#home-menu a[hreflang="'+lang+'"]').getAttribute('aria-current'),'true');
    await page.keyboard.press('Escape');await page.mouse.move(300,600);
   }
  });
  await check('mobile bounds, touch click and reduced motion',async()=>{
   await page.emulateMedia({reducedMotion:'reduce'});
   for(const width of [320,390,768,1024]){
    await page.setViewportSize({width,height:850});await page.goto(base+'/ja');await trigger.click();
    assert.equal(await open(),true);const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const rows=await menu.locator('a:visible').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));assert.ok(rows.every(h=>h>=44));
    assert.equal(await menu.evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
    if(width===390)await page.screenshot({path:path.join(output,name+'-mobile.png')});
    await page.keyboard.press('Escape');
   }
   const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),p=await touch.newPage();
   await p.goto(base+'/en');await p.locator('#home-menu-trigger').tap();assert.equal(await p.locator('#home-menu').evaluate(n=>n.open),true);
   await p.locator('#home-menu a[hreflang="ja"]').tap();await p.waitForURL(base+'/ja');await p.waitForLoadState('networkidle');await touch.close();
  });
  await check('same controller serves pricing and support document language routes',async()=>{
   for(const route of ['/en/pricing','/mcp','/privacy']){
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+route);await trigger.hover();await menu.waitFor({state:'visible'});
    const target=await page.locator('#home-menu a[hreflang="ja"]').getAttribute('href');assert.ok(target.includes('/ja/'));
    await page.locator('#home-menu a[hreflang="ja"]').click();await page.waitForURL(base+target);await page.waitForLoadState('networkidle');
   }
  });
  await context.close();await browser.close();browser=null;
 }
 assert.deepEqual(report.errors,[]);
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(data,{recursive:true,force:true});
 await writeFile(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
}
