// GET-225: real reader DOM and browser input; public Alice, no model dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

export async function verifyReaderOverlays({browser,contextFactory,base,out,dist,matrix=[['en',1280,800]]}){
 const report={at:new Date().toISOString(),cases:[],limits:['Browser input does not establish physical-device or screen-reader acceptance.','Public Alice; page API writes are blocked; no model output is requested.']};
 await fs.mkdir(out,{recursive:true});
 for(const [locale,width,height]of matrix){
  const row={locale,width,height,checks:[],errors:[],blockedWrites:[]};report.cases.push(row);
  const context=await contextFactory({viewport:{width,height},reducedMotion:'reduce'});context.setDefaultTimeout(10000);
  if(dist)await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base||u.pathname.startsWith('/api/'))return route.continue();
   const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));if(!file.startsWith(path.resolve(dist)+path.sep))return route.abort();
   const body=await fs.readFile(file),contentType=({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
   return route.fulfill({...(u.pathname==='/read'?{response:await route.fetch()}:{status:200}),body,contentType});
  });
  let chatFailure=false;
  await context.route('**/api/**',async route=>{
   if(route.request().method()!=='GET'){row.blockedWrites.push(new URL(route.request().url()).pathname);return route.fulfill({status:403,json:{error:'Read-only overlay verification'}});}
   if(new URL(route.request().url()).pathname.endsWith('/chat')){if(chatFailure)return route.fulfill({status:503,json:{error:'Synthetic GET outage'}});const response=await route.fetch(),data=await response.json();return route.fulfill({response,json:{...data,available:true}});}
   return route.continue();
  });
  const p=await context.newPage();p.on('pageerror',error=>row.errors.push(error.stack));
  const primary=()=>p.evaluate(()=>[...document.querySelectorAll('#settings-dialog[open],#atmosphere-dialog[open],.library-chat-dialog[open],#command-palette[open],#reading-session[data-expanded="true"]')].map(n=>n.id||'chat'));
  const settle=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const one=async id=>{await settle();const actual=await primary();assert.equal(actual.length,1,JSON.stringify(actual));if(id==='chat')assert.ok(actual[0]!=='settings-dialog'&&actual[0]!=='atmosphere-dialog'&&actual[0]!=='command-palette'&&actual[0]!=='reading-session');else assert.equal(actual[0],id);};
  const tools=async()=>{await p.locator('#reading-tools-trigger').focus();await p.keyboard.press('Enter');};
  const settings=async()=>{await tools();await p.locator('#open-settings').click();await one('settings-dialog');};
  const hit=async selector=>{const node=p.locator(selector);await node.scrollIntoViewIfNeeded();await settle();assert.equal(await node.evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===n||n.contains(hit);}),true,selector+' is pointer reachable');return node;};
  try{
   await p.goto(base+'/read?book=gutenberg-alice&ui='+locale);await p.waitForFunction(()=>document.body.dataset.ready==='true');if(width<500)await p.evaluate(()=>window.marginaliaPaletteAdapter.appearance.setTheme('night'));
   await p.locator('#reading-tools-trigger').focus();await p.keyboard.press('Enter');
   await p.locator('#open-settings').click();await p.locator('#settings-dialog[open]').waitFor();
   assert.deepEqual(await primary(),['settings-dialog'],'tools → settings leaves exactly one primary surface');
   row.checks.push('tools → settings');
   const original=await p.evaluate(()=>({inert:[...document.body.children].filter(n=>n.inert).map(n=>n.id||n.className).sort(),state:window.marginaliaReader.getState(),anchor:window.marginaliaReader.getAnchor()}));
   await (await hit('#reading-start-settings>summary')).click();
   await p.waitForFunction(()=>document.querySelector('#reading-purpose').nextElementSibling?.classList.contains('choice-control'));
   const purpose=await p.locator('#reading-purpose').inputValue();await (await hit('#reading-purpose + .choice-control button[aria-pressed="true"]')).click();assert.equal(await p.locator('#reading-purpose').inputValue(),purpose);
   await (await hit('.settings-interface-section summary')).click();
   await (await hit('#reader-ui-language .choice-control button[aria-pressed="true"]')).click();
   await p.locator('#settings-tab-sound').click();await (await hit('#open-voice-settings')).focus();
   await p.locator('#settings-tab-data').click();await hit('#import-listening');await p.screenshot({path:path.join(out,locale+'-settings-data.png')});
   await p.locator('#import-listening').focus();await p.keyboard.press('Tab');assert.equal(await p.locator('#settings-dialog').evaluate(n=>n.contains(document.activeElement)),true);
   row.checks.push('Starting view / Interface language, Sound / Data bottom controls and modal focus');
   // A real in-settings action hands off to Atmosphere. Header controls are
   // intentionally inert beneath a modal; explicit component calls below also
   // exercise same-turn handoffs from keyboard/companion integrations.
   await p.locator('#settings-tab-sound').click();await p.locator('#settings-atmosphere').click();await one('atmosphere-dialog');
   await p.locator('#open-settings').evaluate(n=>n.click());await one('settings-dialog');
   await p.locator('#open-atmosphere').evaluate(n=>n.click());await one('atmosphere-dialog');
   await p.keyboard.press('Control+k');await p.locator('#command-palette[open]').waitFor();await one('command-palette');
   await p.locator('#open-settings').evaluate(n=>n.click());await one('settings-dialog');
   await p.keyboard.press('Control+k');await p.locator('#command-palette[open]').waitFor();await one('command-palette');
   await p.keyboard.press('Escape');await settle();assert.deepEqual(await primary(),[]);
   row.checks.push('Settings ↔ Atmosphere ↔ Palette, Escape no remaining main layer');
   await settings();await p.locator('#settings-tab-sound').click();await p.locator('#open-voice-settings').click();await p.locator('#audio-dialog[open]').waitFor();
   await p.keyboard.press('Control+k');await p.locator('#command-palette[open]').waitFor();assert.equal(await p.locator('#audio-dialog').evaluate(n=>n.open),false);
   await p.locator('#reading-tools-trigger').evaluate(n=>n.click());await one('reading-session');assert.equal(await p.evaluate(()=>document.activeElement.id==='command-palette-input'),false);
   row.checks.push('owned Audio dialog → Palette → Tools without an old modal or focus return');
   // The previous Tools handoff is already open.
   await p.locator('.library-chat-trigger').click();await one('chat');
   await p.locator('#library-chat-input').fill('GET-225 unsent draft');
   await p.locator('.library-chat-menu>summary').click();await p.locator('.library-chat-settings>summary').click();await p.locator('.library-chat-explanation>summary').click();
   for(let i=0;i<3;i++){await p.keyboard.press('Escape');await one('chat');}
   assert.equal(await p.locator('#library-chat-input').inputValue(),'GET-225 unsent draft');
   await p.keyboard.press('Control+k');await p.locator('#command-palette[open]').waitFor();await one('command-palette');
   assert.equal(await p.locator('#command-palette').evaluate(n=>!!n.closest('[inert]')),false);
   await p.locator('.library-chat-trigger').evaluate(n=>n.click());await one('chat');assert.equal(await p.locator('.library-chat-dialog').evaluate(n=>n.contains(document.activeElement)),true,'Palette close must not steal Chat focus');
   await p.locator('#open-settings').evaluate(n=>n.click());await one('settings-dialog');chatFailure=true;
   await p.locator('.library-chat-trigger').evaluate(n=>n.click());await one('chat');await p.locator('#library-chat-status.has-error').waitFor();
   assert.equal(await p.locator('#library-chat-input').inputValue(),'GET-225 unsent draft');
   chatFailure=false;await p.locator('.library-chat-status-row button').click();await p.waitForFunction(()=>!document.querySelector('#library-chat-status').classList.contains('has-error'));
   assert.equal(await p.locator('#library-chat-input').inputValue(),'GET-225 unsent draft');row.checks.push('controlled Chat GET error/retry preserves draft without a model call');
   await p.locator('#open-settings').evaluate(n=>n.click());await one('settings-dialog');
   // Scrim dismissal must not steal an inside-origin drag.
   const box=await p.locator('#settings-dialog').boundingBox();if(box.x>4){await p.mouse.move(box.x+30,box.y+25);await p.mouse.down();await p.mouse.move(2,2);await p.mouse.up();await one('settings-dialog');await p.mouse.click(2,2);}else await p.keyboard.press('Escape');await settle();assert.deepEqual(await primary(),[]);
   assert.deepEqual(await p.evaluate(()=>[...document.body.children].filter(n=>n.inert).map(n=>n.id||n.className).sort()),original.inert);
   assert.equal(await p.evaluate(()=>document.body.style.overflow),'');
   assert.equal(await p.evaluate(()=>{const n=document.activeElement;return !n.closest('[inert],dialog:not([open])')&&getComputedStyle(n).visibility!=='hidden';}),true);
   row.checks.push('Chat nested Escape, unsent draft, mobile inert release, scrim gesture and visible focus');
   assert.equal(await p.evaluate(()=>window.marginaliaReader.getChapterId()),original.state.chapterId);
   assert.equal(await p.evaluate(()=>window.marginaliaReader.getState().pageLayout),original.state.pageLayout);
   assert.deepEqual(row.errors,[]);
   await p.screenshot({path:path.join(out,locale+'-after-close.png')});
   row.passed=true;
  }catch(error){row.failure=error.message;await p.screenshot({path:path.join(out,locale+'-failure.png')});throw error;}
  finally{await context.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 }
 return report;
}

if(process.argv[1]===new URL(import.meta.url).pathname){
 if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Explicit artifact path and installed Playwright module required');
 const out=path.resolve(process.argv[2]),codes=new Map();
 const server=await createReaderServer({bookPath:path.join(out,'missing.json'),recordsPath:path.join(out,'records/records.json'),portalDataDir:path.join(out,'records/portal'),env:{},allowLocal:false,sendCode:async(email,code)=>codes.set(email,code),chatGenerator:null,companionGenerator:null});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE});
  const contextFactory=async options=>{
   const context=await browser.newContext(options),email='get225@example.com';
   assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
   assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
   return context;
  };
  const report=await verifyReaderOverlays({browser,contextFactory,base,out,dist:process.env.LEAFHOUR_VERIFY_DIST,matrix:[['en',1280,800],['zh-Hans',390,844],['zh-Hant',320,740],['ja',800,390]]});console.log(JSON.stringify(report));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
