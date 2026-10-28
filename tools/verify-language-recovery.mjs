import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
const output=process.argv[2];if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Output directory and browser module required');await mkdir(output,{recursive:true});
const data=await mkdtemp(tmpdir()+'/leafhour-language-recovery-'),server=await createReaderServer({bookPath:data+'/missing.json',recordsPath:data+'/records.json',portalDataDir:data+'/portal',allowLocal:false,env:{},companionGenerator:null,chatGenerator:null});
let browser;const report={cases:[],limits:['Isolated local service and anonymous public book; no model calls.','Explicit catalogue transport failure; no changes to the existing language deadline or ownership gate.']};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,{chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const [route,host]of [['/zh-hans','home-view'],['/library?ui=zh-Hans','library-view'],['/read?book=gutenberg-alice&ui=zh-Hans','book-page']]){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();const blocked=route=>route.abort();await page.route('**/ui-catalogs/zh-Hans.mjs*',blocked);
  await page.goto(base+route,{waitUntil:'domcontentloaded'});const error=page.locator('#ui-first-paint-error');await error.waitFor({state:'visible'});assert.equal(await error.evaluate(n=>n.parentElement.id),host);assert.equal(await error.evaluate(n=>!!n.closest('[hidden]')),false);assert.equal(await error.getAttribute('role'),'alert');
  assert.equal(new URL(await error.locator('a').first().getAttribute('href')).href,base+route);await page.screenshot({path:output+'/'+host+'-failure.png'});
  await page.unroute('**/ui-catalogs/zh-Hans.mjs*',blocked);await error.locator('a').first().click();
  if(host==='book-page')await page.waitForFunction(()=>document.body?.dataset.ready==='true');else if(host==='home-view')await page.waitForFunction(()=>document.querySelectorAll('#featured-books .book-card').length===3);else await page.waitForFunction(()=>!document.getElementById('ui-first-paint-error')&&document.querySelector('#library-view')?.hidden===false);
  assert.equal(await error.count(),0);assert.equal(await page.locator('html').getAttribute('lang'),'zh-Hans');report.cases.push({route,host,visibleError:true,nativeRetryRecovered:true});await context.close();
 }
 report.passed=true;await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
