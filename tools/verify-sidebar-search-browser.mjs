// Real library shell regression: a collapsed search entry has only a centered icon.
// Requires an existing Playwright installation; no browser or package downloads.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Artifact output path and LEAFHOUR_PLAYWRIGHT_MODULE required');
const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const data=await fs.mkdtemp(path.join(os.tmpdir(),'leafhour-sidebar-search-'));
const server=await createReaderServer({bookPath:path.join(data,'missing.json'),recordsPath:path.join(data,'records.json'),portalDataDir:path.join(data,'portal'),env:{},sendCode:null,translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,annotationGenerator:null,paddleProvider:null,speechProvider:null});
const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const report={cases:[],limits:['Chromium only; no physical keyboard, touch device or spoken screen reader output.','Isolated guest library, no external provider calls or real account data.']};
let browser;
const settled=page=>page.locator('#library-sidebar').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
async function measure(entry){return entry.evaluate(node=>{
 const button=node.getBoundingClientRect(),icon=node.querySelector('[data-icon]').getBoundingClientRect();
 return {text:node.innerText,centerOffset:Math.abs(icon.x+icon.width/2-button.x-button.width/2),iconFits:icon.left>=button.left&&icon.right<=button.right,height:button.height};
});}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.LEAFHOUR_CHROMIUM_EXECUTABLE?{executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE}:{})});
 report.version=browser.version();
 for(const [width,locale,motion,touch] of [[1440,'en','no-preference',false],[1024,'zh-Hans','reduce',false],[981,'en','no-preference',false],[980,'en','no-preference',false],[768,'zh-Hans','reduce',false],[390,'en','no-preference',true]]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:motion,isMobile:touch,hasTouch:touch});
  try{
   // Persisted desktop collapse must not hide labels/keycaps in a mobile sheet.
   await context.addInitScript(()=>localStorage.setItem('marginalia-library-sidebar','collapsed'));
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const page=await context.newPage(),row={width,locale,motion,touch,errors:[],consoleErrors:[],checks:[]};report.cases.push(row);
   page.on('pageerror',error=>row.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')row.consoleErrors.push(message.text());});
   await page.goto(base+'/library?ui='+locale);assert.match(await page.title(),/Leafhour/);
   await page.locator('#book-search').waitFor();await page.waitForFunction(()=>document.body.dataset.sidebarCollapsed==='true');
   const entry=page.locator('#sidebar-search-open'),toggle=page.locator('#sidebar-toggle'),keycap=entry.locator('[data-palette-keycap]');
   await page.waitForFunction(()=>document.querySelector('[data-palette-keycap]').textContent.length>0);
   assert.ok((await page.locator('#main').innerText()).trim());assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
   await page.locator('#book-search').fill('Alice');
   if(width>980){
    row.collapsed=await measure(entry);await page.screenshot({path:path.join(out,width+'-collapsed.png')});
    assert.equal(await keycap.isVisible(),false,'collapsed keycap must not paint');
    assert.equal(row.collapsed.text.trim(),'','collapsed entry must have no painted text');assert.ok(row.collapsed.iconFits);assert.ok(row.collapsed.centerOffset<1,'icon must be centered');assert.ok(row.collapsed.height<=48,'one icon row stays compact');
    await entry.focus();assert.ok(await entry.getAttribute('aria-label'));assert.equal(await entry.evaluate(n=>n.matches(':focus-visible')),true);
    const hint=await entry.evaluate(n=>{const style=getComputedStyle(n,'::after');return {content:style.content,position:getComputedStyle(n).position,left:style.left};});
    assert.notEqual(hint.content,'none');assert.equal(hint.position,'relative','tooltip is anchored to its entry');
    await page.screenshot({path:path.join(out,width+'-focused.png')});
    for(let cycle=0;cycle<6;cycle++){
     await toggle.click();await settled(page);assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await keycap.isVisible(),true);assert.ok((await entry.locator('.sidebar-label').innerText()).trim());
     assert.equal(await page.locator('#book-search').inputValue(),'Alice');
     await toggle.click();await settled(page);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await keycap.isVisible(),false);assert.ok((await measure(entry)).centerOffset<1);
    }
    await toggle.focus();await page.keyboard.press('Enter');await settled(page);assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebar-toggle');
    await page.screenshot({path:path.join(out,width+'-expanded.png')});
    await entry.click();await page.locator('#command-palette[open]').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'command-palette-input');
    await page.locator('#command-palette-input').fill('Alice');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='sidebar-search-open');
    assert.equal(await page.locator('#book-search').inputValue(),'Alice');row.checks.push('expanded desktop palette activation and focus return');
    await toggle.focus();await page.keyboard.press('Space');await settled(page);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    // Inspect real animation frames; text must stay absent while narrowing.
    await toggle.click();await settled(page);await page.evaluate(()=>{window.sidebarFrames=[];const toggle=document.querySelector('#sidebar-toggle'),entry=document.querySelector('#sidebar-search-open');toggle.click();const start=performance.now();window.sidebarTransition=new Promise(resolve=>{function frame(){const b=entry.getBoundingClientRect(),i=entry.querySelector('[data-icon]').getBoundingClientRect();window.sidebarFrames.push({text:entry.innerText,offset:Math.abs(i.x+i.width/2-b.x-b.width/2)});if(performance.now()-start<250)requestAnimationFrame(frame);else resolve(window.sidebarFrames);}requestAnimationFrame(frame);});});
    row.frames=await page.evaluate(()=>window.sidebarTransition);assert.ok(row.frames.every(frame=>frame.text.trim()===''&&frame.offset<1));
    row.checks.push('centered compact icon, hidden hint, anchored tooltip, focus ring, repeated toggles, transition frames, retained shelf query');
   }else{
    await page.locator('#library-menu').click();await page.locator('#library-nav-dialog[open]').waitFor();assert.equal(await entry.locator('.sidebar-label').isVisible(),true);assert.equal(await keycap.isVisible(),!touch);
    await page.screenshot({path:path.join(out,width+'-navigation.png')});row.checks.push('mobile navigation restores label and keyboard hint; coarse-only touch hides hint');
   }
   // Native activation opens the real palette and returns focus to a visible control.
   if(touch)await entry.tap();else{await entry.focus();await page.keyboard.press('Enter');}
   await page.locator('#command-palette[open]').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'command-palette-input');
   await page.locator('#command-palette-input').fill('Alice');await page.waitForFunction(()=>document.querySelectorAll('#command-palette-list li').length>0);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#command-palette').open);
   assert.equal(await page.locator('#book-search').inputValue(),'Alice');
   if(width>980){assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebar-search-open');await entry.click();}
   else{assert.equal(await page.evaluate(()=>{const node=document.activeElement;return node.matches('a.brand')&&!node.closest('dialog:not([open])')&&node.getClientRects().length>0;}),true,'closed navigation sheet returns focus to the visible brand');await page.locator('#library-menu').click();await entry.click();}
   await page.locator('#command-palette[open]').waitFor();assert.equal(await page.locator('#command-palette-input').inputValue(),'Alice');await page.keyboard.press('Escape');
   await page.locator('#book-search').focus();await page.keyboard.press('Tab');await page.keyboard.press('Control+k');await page.locator('#command-palette[open]').waitFor();await page.keyboard.press('Escape');
   row.checks.push('keyboard/touch and click palette activation, existing palette query, Escape focus return, Ctrl K');
   if(width===1440){
    await page.reload();await page.waitForFunction(()=>document.body.dataset.sidebarCollapsed==='true');assert.equal(await keycap.isVisible(),false);
    await page.setViewportSize({width:390,height:900});await page.locator('#library-menu').click();assert.equal(await entry.locator('.sidebar-label').isVisible(),true);assert.equal(await keycap.isVisible(),true);
    await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>!document.querySelector('#library-nav-dialog').open);assert.equal(await keycap.isVisible(),false);assert.ok((await measure(entry)).centerOffset<1);row.checks.push('reload persistence and desktop/mobile/desktop resize');
   }
   assert.deepEqual(row.errors,[]);assert.deepEqual(row.consoleErrors,[]);row.passed=true;console.log(JSON.stringify({width,locale,passed:true,checks:row.checks}));
  }finally{await context.close();}
 }
}catch(error){report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error);}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(data,{recursive:true,force:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
