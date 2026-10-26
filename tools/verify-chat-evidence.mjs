// Exercise the packaged reader and real DOM with explicitly synthetic chat GETs.
// All page API mutations are blocked. No provider or real account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE||!process.env.LEAFHOUR_VERIFY_DIST)throw Error('Registered artifact, existing browser runtime and built package required');
const out=path.resolve(process.argv[2]),dist=path.resolve(process.env.LEAFHOUR_VERIFY_DIST);
await fs.mkdir(out,{recursive:true});
const server=await createReaderServer({bookPath:out+'/missing.json',recordsPath:out+'/records.json',portalDataDir:out+'/portal',env:{},allowLocal:true,chatGenerator:null,companionGenerator:null,introductionGenerator:null});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const report={at:new Date().toISOString(),packaged:true,cases:[],limits:['Chat answers, failed lookups and load outages are synthetic GET fixtures. All page API mutations are blocked.','Driver input is not physical keyboard, OS IME or screen-reader speech acceptance.','Production revision and real-account acceptance are separate receipts.']};
let browser,context;
const state=p=>p.evaluate(()=>({anchor:window.marginaliaReader.getAnchor(),scroll:scrollY,paragraph:document.querySelector('.passage').getBoundingClientRect().toJSON()}));
try{
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
 browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE});
 const matrix=[...['en','zh-Hans','zh-Hant','ja'].flatMap(locale=>[[locale,1440,900],[locale,390,844]]),['en',768,1024],['zh-Hans',390,420],['zh-Hant',320,740]];
 for(const [locale,width,height]of matrix){
  const row={locale,width,height,checks:[],errors:[],blockedWrites:[]};report.cases.push(row);
  context=await browser.newContext({viewport:{width,height},hasTouch:width<=390,reducedMotion:width<=390?'reduce':'no-preference'});context.setDefaultTimeout(15000);
  const auth=await context.request.post(base+'/api/auth/local',{data:{},headers:{Origin:base}});assert.equal(auth.ok(),true);assert.ok((await auth.json()).user.id);
  let failLoad=false,chatGets=0;
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
   if(u.pathname.startsWith('/api/')){
    if(req.method()!=='GET'){row.blockedWrites.push(u.pathname);return route.fulfill({status:403,json:{error:'Read-only verification'}});}
    if(u.pathname.endsWith('/chat')){
     chatGets++;if(failLoad){failLoad=false;return route.fulfill({status:503,json:{error:'Injected chat outage'}});}
     const response=await route.fetch(),data=await response.json();assert.ok(data.context?.passageId);
     const ref={bookId:'gutenberg-alice',passageId:data.context.passageId,quote:data.context.original.slice(0,32),layer:'literal',translationStatus:'draft'};
     data.available=true;data.turns=[{id:'get261-synthetic-answer',status:'completed',text:'Synthetic question about this sentence.',passageId:ref.passageId,activity:[{tool:'reader_get_context',status:'completed'},{tool:'reader_search_web',status:'failed'}],answer:{summary:'Synthetic answer grounded in the current public passage.',sourceRefs:[ref]}},{id:'get261-synthetic-failure',status:'failed',failureCode:'generation_failed',text:'Synthetic failed question.',passageId:ref.passageId}];
     return route.fulfill({response,json:data});
    }
    return route.continue();
   }
   const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));assert.ok(file.startsWith(dist+path.sep));
   return route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream'});
  });
  const p=await context.newPage();p.on('pageerror',error=>row.errors.push(error.message));
  try{
   await p.goto(base+'/read?book=gutenberg-alice&ui='+locale);await p.waitForFunction(()=>document.body.dataset.ready==='true');
   const root=p.locator('#reader-conversation'),trigger=p.locator('.library-chat-trigger'),input=p.locator('#library-chat-input');
   const open=async()=>{if(await p.evaluate(()=>document.body.dataset.readingTools!=='open')){await p.locator('#reading-tools-trigger').focus();await p.keyboard.press('Enter');}await trigger.click();};
   assert.equal(await p.locator('dialog[open]').count(),0);assert.equal(chatGets,0);
   const before=await state(p);await open();await p.locator('.library-chat-evidence').waitFor();
   const evidence=p.locator('.library-chat-evidence'),refs=p.locator('.library-chat-references'),activity=p.locator('.library-chat-activity-details');
   assert.equal(await evidence.evaluate(n=>n.open),false);assert.equal(await refs.locator('summary').isVisible(),false);assert.equal(await activity.locator('summary').isVisible(),false);assert.equal(await p.locator('.library-chat-context>summary').isVisible(),false);assert.equal(await p.locator('.library-chat-evidence-warning').isVisible(),true);
   const bounds=await root.boundingBox();row.bounds=bounds;assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
   if(width>=1100){const after=await state(p);assert.equal(after.scroll,before.scroll);assert.equal(after.anchor.passageId,before.anchor.passageId);for(const key of ['x','y','width'])assert.ok(Math.abs(after.paragraph[key]-before.paragraph[key])<1);}
   else if(height>500)assert.ok(bounds.y>=height*.2,'book remains visible above the sheet');
   row.checks.push('closed-default-no-chat-fetch; one-evidence-entry; visible-failure-qualification; book-layout-preserved');
   await input.fill('Retained draft');await evidence.locator(':scope>summary').focus();await p.keyboard.press('Enter');await refs.locator('summary').focus();await p.keyboard.press('Enter');assert.equal(await refs.locator('blockquote').isVisible(),true);
   await p.keyboard.press('Escape');assert.equal(await refs.evaluate(n=>n.open),false);assert.equal(await refs.locator('summary').evaluate(n=>n===document.activeElement),true);
   await activity.locator('summary').focus();await p.keyboard.press('Enter');assert.equal(await activity.locator('p').first().isVisible(),true);await p.keyboard.press('Escape');await p.keyboard.press('Escape');assert.equal(await evidence.evaluate(n=>n.open),false);assert.equal(await root.evaluate(n=>n.open),true);
   row.checks.push('native-keyboard-disclosure-and-nested-Escape-focus-return');
   await p.locator('.library-chat-menu>summary').click();await p.locator('.library-chat-context>summary').focus();await p.keyboard.press('Enter');await p.locator('.library-chat-layer-choice').selectOption('literal');assert.equal(await input.inputValue(),'Retained draft');assert.equal(await p.locator('.library-chat-context-body .library-chat-source p').last().isVisible(),true);
   await p.keyboard.press('Escape');assert.equal(await p.locator('.library-chat-context').evaluate(n=>n.open),false);assert.equal(await p.locator('.library-chat-context>summary').evaluate(n=>n===document.activeElement),true);await p.keyboard.press('Escape');
   await p.locator('.library-chat-retry').click();assert.equal(await input.inputValue(),'Synthetic failed question.');await input.fill('Retained draft');
   await evidence.locator(':scope>summary').click();await refs.locator('summary').click();await refs.locator('.library-chat-source-link').click();
   if(width>=1100)assert.equal(await root.evaluate(n=>n.open),true);else{assert.equal(await root.evaluate(n=>n.open),false);await open();}
   row.checks.push('current-passage-on-demand; missing-translation-explicit; failed-question-edit; reference-return');
   await input.fill('Retained draft');await p.locator('.library-chat-close').click();assert.equal(await trigger.evaluate(n=>n===document.activeElement),true);await open();assert.equal(await input.inputValue(),'Retained draft');
   failLoad=true;await p.locator('.library-chat-close').click();await open();await p.locator('.library-chat-status.has-error').waitFor();await p.locator('.library-chat-status-row button').click();await p.waitForFunction(()=>!document.querySelector('.library-chat-status').classList.contains('has-error'));assert.equal(await input.inputValue(),'Retained draft');
   row.checks.push('close-reopen-preserves-draft; load-error-retry-recovers');
   await p.reload();await p.waitForFunction(()=>document.body.dataset.ready==='true');assert.equal(await p.locator('dialog[open]').count(),0);await open();assert.equal(await input.inputValue(),'Retained draft');await p.locator('.library-chat-evidence').waitFor();
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(row.errors,[]);row.checks.push('reload-quiet-with-draft; no-horizontal-overflow; no-page-errors');
   await p.screenshot({path:out+`/${locale}-${width}-${height}-quiet-chat.png`});row.passed=true;
  }catch(error){row.failure=error.message;await p.screenshot({path:out+`/${locale}-${width}-${height}-failure.png`});throw error;}
  finally{await context.close();context=null;await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));}
 }
 report.passed=true;await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,cases:report.cases.length}));
}finally{await context?.close();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
