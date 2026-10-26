// GET-227: isolated public-book browser matrix; never points at Production.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Explicit registered artifact path and Playwright module required');
const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const dist=process.env.LEAFHOUR_VERIFY_DIST?path.resolve(process.env.LEAFHOUR_VERIFY_DIST):null;
if(dist){
 const html=await fs.readFile(path.join(dist,'read.html'),'utf8');
 const entries=[...html.matchAll(/(?:src|href)="(\/reader-web\/[^"?#]+\.(?:js|css))"/g)].map(m=>m[1]);
 if(entries.length!==2||!entries.some(p=>p.endsWith('.js'))||!entries.some(p=>p.endsWith('.css')))throw Error('Packaged reader entries are missing');
 for(const file of [...entries,'/command-palette.mjs','/palette-book.mjs','/command-palette.css','/ui-locale.mjs'])if(!(await fs.stat(path.join(dist,file.slice(1)))).isFile())throw Error('Packaged reader asset is missing: '+file);
}
const engines=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const codes=new Map();
const server=await createReaderServer({bookPath:path.join(out,'missing.json'),recordsPath:path.join(out,'records/records.json'),portalDataDir:path.join(out,'records/portal'),env:{},allowLocal:false,sendCode:async(email,code)=>codes.set(email,code),chatGenerator:null,companionGenerator:null});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const report={kind:'isolated synthetic server, real browser',at:new Date().toISOString(),cases:[],limits:['Actual native jump, focus and generated paint are observed first. After its natural expiry, a reversible CSS class A/B probe checks stable pixels without changing product timers.','Automated browser keyboard/mouse/touch events do not assert physical devices, OS IME candidates or spoken assistive output.']};let browser,context;
const tools=async p=>{if(await p.evaluate(()=>document.body.dataset.readingTools!=='open')){await p.locator('#reading-tools-trigger').focus();await p.keyboard.press('Enter');}await p.waitForFunction(()=>document.body.dataset.readingTools==='open');};
const palette=async p=>{await p.keyboard.press('Control+k');await p.locator('#command-palette[open]').waitFor();await p.locator('#command-palette-input').fill('Alice');await p.waitForFunction(()=>[...document.querySelectorAll('#command-palette-list li')].some(n=>n.textContent.includes('Alice was beginning')));};
try{
 for(const [engine,exe]of [['chromium',process.env.LEAFHOUR_CHROMIUM_EXECUTABLE],['webkit',process.env.LEAFHOUR_WEBKIT_EXECUTABLE]]){
  browser=await engines[engine].launch({headless:true,...(exe?{executablePath:exe}:{})});
  for(const [locale,width,theme]of (process.env.LEAFHOUR_VERIFY_DIST?[['en',1280,'paper'],['ja',320,'night']]:[['en',1280,'paper'],['zh-Hans',390,'night'],['zh-Hant',320,'paper'],['ja',320,'night']])){
   context=await browser.newContext({viewport:{width,height:800},hasTouch:width<500,reducedMotion:'reduce'});context.setDefaultTimeout(10000);
   // Packaged replay retains the actual server document CSP and all real APIs.
   const packageFailures=[];
   if(dist){await context.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!==base||u.pathname.startsWith('/api/'))return route.continue();
    const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));if(!file.startsWith(dist+path.sep))return route.continue();
    try{const body=await fs.readFile(file),contentType=({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.jpg':'image/jpeg','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream';
     if(u.pathname==='/read')return route.fulfill({response:await route.fetch(),body,contentType});
     return route.fulfill({status:200,body,contentType});
    }catch(error){packageFailures.push({path:u.pathname,error:error.code||error.message});return route.abort('failed');}
   });}
   const p=await context.newPage();
   const row={engine,version:browser.version(),locale,width,theme,checks:[],errors:[],writes:[]};report.cases.push(row);
   p.on('pageerror',e=>row.errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')row.writes.push(new URL(r.url()).pathname);});
   await p.goto(base+'/read?book=gutenberg-alice&ui='+locale);await p.waitForFunction(()=>document.body.dataset.ready==='true');
   await p.evaluate(theme=>window.marginaliaPaletteAdapter.appearance.setTheme(theme),theme);
   await palette(p);assert.equal(await p.locator('#command-palette-input').inputValue(),'Alice');
   const loadingHint={'en':'Loading the catalogue…','zh-Hans':'正在载入书目…','zh-Hant':'正在載入書目…','ja':'書誌を読み込んでいます…'}[locale];await p.waitForFunction(text=>!document.querySelector('#command-palette-status').textContent.includes(text),loadingHint);
   row.status=await p.locator('#command-palette-status').textContent();assert.doesNotMatch(row.status,/1 results/);
   await p.locator('#command-palette').evaluate(async n=>{await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})));});
   await p.screenshot({path:path.join(out,engine+'-'+locale+'-'+width+'-search.png')});
   const before=row.status;await p.keyboard.press('ArrowDown');assert.equal(await p.locator('#command-palette-status').textContent(),before);await p.keyboard.press('Home');
   if(width<500)await p.locator('#command-palette-list li').first().tap();else await p.keyboard.press('Enter');
   const jump=await p.waitForFunction(()=>{const n=document.activeElement;if(!n.matches('.passage.is-locating'))return false;const paint=getComputedStyle(n,'::before');if(paint.content==='none'||paint.position!=='absolute')return false;return {id:n.id,text:n.textContent.slice(0,90),rect:n.getBoundingClientRect().toJSON(),paint:{content:paint.content,position:paint.position,background:paint.backgroundColor}};});row.jump=await jump.jsonValue();await jump.dispose();row.nativeLocationObserved=true;row.locationPaint=row.jump.paint;assert.ok(row.jump.rect.bottom>0&&row.jump.rect.y<800);row.checks.push('real book hit, retained query, stable count, actual jump focus and paint');
   if(locale==='en'||locale==='ja'){
    const n=p.locator('[id="'+row.jump.id+'"]');
    // First observe the real jump and its natural expiry. Then isolate CSS
    // paint in a stable class A/B probe, without racing or changing its timer.
    await p.waitForFunction(id=>!document.getElementById(id).classList.contains('is-locating'),row.jump.id);row.nativeLocationExpired=true;
    const rect=await n.boundingBox(),x=Math.max(0,rect.x-12),y=Math.max(0,rect.y-12),clip={x,y,width:Math.min(width-x,rect.width+24),height:Math.min(800-y,rect.height+24)};
    try{await n.evaluate(node=>node.classList.add('is-locating'));
     const located=await p.screenshot({path:path.join(out,engine+'-'+locale+'-'+width+'-located.png'),clip});
     await n.evaluate(node=>node.classList.remove('is-locating'));
     const ordinary=await p.screenshot({path:path.join(out,engine+'-'+locale+'-'+width+'-ordinary.png'),clip});
     row.locationPixelsChanged=!located.equals(ordinary);assert.equal(row.locationPixelsChanged,true,'location highlight must change actual passage pixels');
    }finally{await n.evaluate(node=>node.classList.remove('is-locating'));}
   }
   assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme,'jump retains the actual reader theme');
   for(const target of ['settings','tools','account','atmosphere']){
    await tools(p);
    if(target==='settings')await p.locator('#open-settings').click();
    if(target==='account'){if(width<500)await p.locator('#open-reader-account').tap();else await p.locator('#open-reader-account').click();await p.locator('#reader-account[open]').waitFor();}
    if(target==='atmosphere'){await p.locator('#open-atmosphere').click();await p.locator('#atmosphere-dialog[open]').waitFor();}
    await palette(p);assert.equal(await p.locator('dialog[open]').count(),1);assert.equal(await p.evaluate(()=>document.activeElement.id),'command-palette-input');
    for(let i=0;i<4;i++)await p.keyboard.press('Tab');assert.equal(await p.locator('#command-palette').evaluate(n=>n.contains(document.activeElement)),true);
    await p.keyboard.press('Escape');assert.equal(await p.locator('#command-palette').evaluate(n=>n.open),false);assert.equal(await p.evaluate(()=>document.activeElement.id),'reading-tools-trigger');assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme);row.checks.push(target+' handoff, Tab containment, Escape/focus return');
   }
   row.packageFailures=packageFailures;assert.equal(packageFailures.length,0,'all packaged resources must be served from the build');assert.equal(row.errors.length,0);await context.close();context=null;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify({engine,locale,width,checks:row.checks.length}));
  }
  await browser.close();browser=null;
 }
}catch(error){report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.log(error.message);}
finally{const cleanup=await Promise.allSettled([context?.close(),browser?.close(),new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))]);report.cleanup=cleanup.map(r=>r.status==='fulfilled'?{status:r.status}:{status:r.status,error:r.reason?.message});if(cleanup.some(r=>r.status==='rejected'))process.exitCode=1;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
