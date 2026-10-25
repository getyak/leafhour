// Real local reader page + isolated synthetic identity. Never sends a model job.
// Set an existing Playwright module and browser executables; no downloads.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';
import {readerWriteKind,compareReaderConsole} from './reader-verification-evidence.mjs';
const output=process.argv[2];
if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Registered output and existing Playwright module required');
await mkdir(output,{recursive:true});
const codes=new Map(),server=await createReaderServer({bookPath:path.join(output,'missing.json'),recordsPath:path.join(output,'data/records.json'),portalDataDir:path.join(output,'data/portal'),env:{},allowLocal:false,sendCode:async(email,code)=>codes.set(email,code),chatGenerator:null,companionGenerator:null});
const engines=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const coreOnly=process.argv.includes('--core-only');
const consoleBaseline=process.env.LEAFHOUR_CONSOLE_BASELINE?JSON.parse(await readFile(process.env.LEAFHOUR_CONSOLE_BASELINE,'utf8')):null;
const report={kind:'GET-221 real local reader',mode:coreOnly?'core-only':'core-and-holds',at:new Date().toISOString(),consoleBaselineProvided:!!consoleBaseline,cases:[],limits:['Local synthetic account and public catalog; no production acceptance claim.','Console acceptance is unverified unless an explicit matching-version main baseline is supplied.','Listener counters cover document/window only. Pen/cancel/window lifecycle DOM injections are labeled separately from native pointer/touch/keyboard actions.']};
let browser,context;
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
async function open(page){await page.locator('#reading-tools-trigger').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#reading-tools-trigger').getAttribute('aria-expanded')==='true');}
async function closed(page){await page.waitForFunction(()=>document.querySelector('#reading-tools-trigger').getAttribute('aria-expanded')==='false',undefined,{timeout:750});}
const expanded=page=>page.locator('#reading-tools-trigger').getAttribute('aria-expanded');
const pause=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 for(const engine of (process.env.LEAFHOUR_BROWSER_ENGINES||'chromium,webkit').split(',')){
  const executablePath=engine==='webkit'?process.env.LEAFHOUR_WEBKIT_EXECUTABLE:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE;
  browser=await engines[engine].launch({headless:true,...(executablePath?{executablePath}:{})});
  for(const width of (process.env.LEAFHOUR_BROWSER_WIDTHS||'1440,768,390,320').split(',').map(Number)){
   const item={engine,version:browser.version(),width,height:900,cycles:[],errors:[],consoleErrors:[],writes:[],passed:false};report.cases.push(item);
   context=await browser.newContext({viewport:{width,height:900},hasTouch:true,recordVideo:width===1440?{dir:path.join(output,'video-'+engine),size:{width:960,height:600}}:undefined});
   const email='get221-'+engine+'-'+width+'@example.test';
   assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
   assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
   let phase='setup';const page=await context.newPage();page.on('pageerror',e=>item.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')item.consoleErrors.push({text:m.text(),path:m.location().url?new URL(m.location().url).pathname:null,line:m.location().lineNumber});});
   page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())){const pathname=new URL(r.url()).pathname;item.writes.push({phase,method:r.method(),path:pathname,kind:readerWriteKind(pathname)});}});
   await page.addInitScript(()=>{
    const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,owned=new Map();
    const registry=(target,type,capture)=>{const key=(target===window?'window:':'document:')+type+':'+capture;if(!owned.has(key))owned.set(key,new Set());return owned.get(key);};
    EventTarget.prototype.addEventListener=function(type,fn,options){if(this===window||this===document)registry(this,type,!!(options===true||options?.capture)).add(fn);return add.call(this,type,fn,options);};
    EventTarget.prototype.removeEventListener=function(type,fn,options){if(this===window||this===document)registry(this,type,!!(options===true||options?.capture)).delete(fn);return remove.call(this,type,fn,options);};
    window.listenerCounts=()=>Object.fromEntries([...owned].filter(([,set])=>set.size).map(([k,set])=>[k,set.size]));
   });
   await page.goto(base+'/read?book=gutenberg-alice&ui=en');await page.locator('#chapter-text .passage').first().waitFor();await page.locator('.library-chat-trigger').waitFor();
   await page.evaluate(()=>{const b=document.createElement('input');b.type='text';b.id='get221-outside';b.value='Outside action';b.setAttribute('aria-label','Outside action');Object.assign(b.style,{position:'fixed',top:'160px',left:'12px',zIndex:'1000'});window.outsideActions=0;b.addEventListener('click',e=>{window.outsideActions++;e.stopPropagation();});document.body.append(b);});
   await page.evaluate(()=>{
    const pill=document.querySelector('#reading-tools-trigger'),panel=document.querySelector('#reading-tools-panel');let leave=0;
    for(const node of [pill,panel])node.addEventListener('pointerleave',()=>{leave=performance.now();});
    window.beginExit=()=>{leave=0;window.exitResult=new Promise(resolve=>{const frames=[],start=performance.now();let closing=null,release=null,ended=[];const end=e=>ended.push({property:e.propertyName,at:performance.now()});panel.addEventListener('transitionend',end);const sample=()=>{const now=performance.now(),s=getComputedStyle(panel),r=panel.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),open=pill.getAttribute('aria-expanded')==='true';frames.push({at:now,open,opacity:Number(s.opacity),visibility:s.visibility,inert:panel.inert,hidden:panel.getAttribute('aria-hidden'),hit:panel.contains(hit)});if(leave&&!open&&closing===null)closing=now;if(leave&&!open&&!panel.contains(hit)&&release===null)release=now;if(leave&&!open&&s.opacity==='0'&&s.visibility==='hidden'||now-start>1500){panel.removeEventListener('transitionend',end);resolve({leave,closing,release,complete:now,total:now-leave,ended,frames});}else requestAnimationFrame(sample);};requestAnimationFrame(sample);});};
   });
   // Warm Playwright's own once-per-page hit-target listeners before sampling.
   await page.locator('#get221-outside').click();await page.locator('#get221-outside').tap();await page.evaluate(()=>window.outsideActions=0);
   await page.screenshot({caret:'initial',path:path.join(output,engine+'-'+width+'-baseline.png')});
   await page.mouse.move(10,500);await pause(page);item.listenersBefore=await page.evaluate(()=>window.listenerCounts());
   const pill=page.locator('#reading-tools-trigger'),panel=page.locator('#reading-tools-panel'),ai=page.locator('#reading-tools-chat-slot');
   const cross=async selector=>{const r=await page.locator(selector).boundingBox();assert.ok(r,selector);await page.mouse.move(r.x+r.width/2,r.y+r.height/2);};
   for(let round=0;round<20;round++){
    phase='hover';
    const cycle={round:round+1};item.cycles.push(cycle);
    await cross('#reading-tools-trigger');await pause(page);assert.equal(await expanded(page),'true');assert.equal(await page.evaluate(()=>document.body.dataset.readingTools),'closed');
    assert.equal(await ai.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+1));}),true,'card gap must not cover the AI entry hit area');
    await cross('#reading-tools-panel');await cross('#reading-tools-trigger');assert.equal(await expanded(page),'true');
    await page.evaluate(()=>window.beginExit());await cross('#reading-tools-chat-slot');
    cycle.exit=await page.evaluate(()=>window.exitResult);assert.ok(cycle.exit.total<=500,'exit total '+cycle.exit.total);assert.ok(cycle.exit.leave>0);assert.ok(cycle.exit.frames.at(-1).inert);assert.equal(cycle.exit.frames.at(-1).hidden,'true');assert.equal(cycle.exit.frames.at(-1).hit,false);
    await cross('#reading-tools-trigger');await cross('#reading-tools-panel');await cross('#reading-tools-trigger');await page.evaluate(()=>window.beginExit());await page.mouse.move(10,500);cycle.bodyExit=await page.evaluate(()=>window.exitResult);assert.ok(cycle.bodyExit.total<=500);assert.equal(cycle.bodyExit.frames.at(-1).hit,false);
    // Reentry during the actual exit animation must cancel the old deadline.
    await cross('#reading-tools-trigger');await page.mouse.move(10,500);await page.waitForTimeout(235);await cross('#reading-tools-trigger');await page.waitForTimeout(210);assert.equal(await expanded(page),'true');
    phase='explicit';await pill.click();assert.equal(await page.evaluate(()=>document.body.dataset.readingTools),'open');
    await page.locator('#get221-outside').click();await closed(page);assert.equal(await page.evaluate(()=>document.activeElement.id),'get221-outside');
    // Native keyboard open, Tab, Shift+Tab and Escape, then native touch taps.
    await open(page);await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await expanded(page),'true');await page.keyboard.press('Escape');await closed(page);
    const touchStart=await page.evaluate(()=>performance.now());await pill.tap();await page.waitForFunction(()=>document.querySelector('#reading-tools-trigger').getAttribute('aria-expanded')==='true');cycle.touchOpenMs=await page.evaluate(start=>performance.now()-start,touchStart);await pill.tap();await closed(page);await pill.tap();await page.waitForFunction(()=>document.querySelector('#reading-tools-trigger').getAttribute('aria-expanded')==='true');await page.locator('#get221-outside').tap();await closed(page);
    assert.equal(await page.evaluate(()=>window.outsideActions),(round+1)*2);cycle.passed=true;
    if(round===0)item.listenersAfterFirstCycle=await page.evaluate(()=>window.listenerCounts());
    if((round+1)%5===0)console.log(JSON.stringify({engine,width,rounds:round+1,stage:'core'}));
   }
   item.listenersAfterCycles=await page.evaluate(()=>window.listenerCounts());assert.deepEqual(item.listenersAfterCycles,item.listenersAfterFirstCycle,'repeating core paths cannot accumulate listeners');
   phase='holds';
   if(!coreOnly){
   // Editing/selection and a real nested dialog retain their actual opener.
   await open(page);await page.locator('#reading-timer-settings>summary').click();const select=page.locator('#reading-time-source');await select.focus();await page.mouse.move(10,500);await page.waitForTimeout(5200);assert.equal(await expanded(page),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('#reading-timer-settings').evaluate(n=>n.open),false);assert.equal(await expanded(page),'true');await page.keyboard.press('Escape');await closed(page);
   await open(page);await page.locator('#open-settings').click();await page.locator('#settings-dialog[open]').waitFor();await page.mouse.move(10,500);await page.waitForTimeout(5200);assert.equal(await expanded(page),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('#settings-dialog').evaluate(n=>n.open),false);assert.equal(await expanded(page),'true');await page.keyboard.press('Escape');await closed(page);
   // Chat owns its draft and remains open after pointer exit.
   await ai.locator('.library-chat-trigger').click();await page.locator('#library-chat-input').fill('GET-221 retained local draft');await page.mouse.move(10,500);await cross('#reading-tools-trigger');assert.equal(await expanded(page),'false');assert.equal(await page.locator('.library-chat-dialog').evaluate(n=>n.open),true);await page.keyboard.press('Escape');
   await ai.locator('.library-chat-trigger').click();assert.equal(await page.locator('#library-chat-input').inputValue(),'GET-221 retained local draft');await page.keyboard.press('Escape');
   await page.emulateMedia({reducedMotion:'reduce'});await cross('#reading-tools-trigger');await pause(page);await page.evaluate(()=>window.beginExit());await page.mouse.move(10,500);item.reducedExit=await page.evaluate(()=>window.exitResult);assert.ok(item.reducedExit.total<=300);await page.emulateMedia({reducedMotion:'no-preference'});
   }
   await page.screenshot({caret:'initial',path:path.join(output,engine+'-'+width+'-closed.png')});await open(page);await page.screenshot({caret:'initial',path:path.join(output,engine+'-'+width+'-explicit.png')});await page.keyboard.press('Escape');await page.mouse.move(10,500);await page.waitForTimeout(500);
   item.listenersAfter=await page.evaluate(()=>window.listenerCounts());assert.deepEqual(item.errors,[]);
   item.hoverWrites=item.writes.filter(r=>r.phase==='hover');item.forbiddenWrites=item.writes.filter(r=>['model','reading-record'].includes(r.kind)||r.phase==='hover'&&r.kind==='progress');assert.deepEqual(item.forbiddenWrites,[]);
   item.console=compareReaderConsole({baseline:consoleBaseline,engine,version:item.version,errors:item.consoleErrors});if(item.console.verified)assert.deepEqual(item.console.newErrors,[],'no new console errors relative to the matching main baseline');
   item.passed=true;console.log(JSON.stringify({engine,width,rounds:item.cycles.length,maximumExit:Math.max(...item.cycles.map(c=>c.exit.total)),passed:true}));await context.close();context=null;await save();
  }
  await browser.close();browser=null;
 }
}catch(error){report.failure={message:error.message,stack:error.stack};throw error;}
finally{await context?.close();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await save();}
