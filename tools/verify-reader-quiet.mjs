// Public package and public-domain content. Page API mutations are blocked;
// explicitly seeded local auth/logout writes use only the isolated fixture.
// CSS-state fixtures are explicitly named; they do not prove persistence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Registered artifact and existing browser runtime required');
const out=path.resolve(process.argv[2]),dist=path.resolve(process.env.LEAFHOUR_VERIFY_DIST||'dist');
await fs.mkdir(out,{recursive:true});
const engines=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const server=await createReaderServer({bookPath:out+'/missing.json',recordsPath:out+'/records.json',portalDataDir:out+'/portal',env:{},allowLocal:true,chatGenerator:null,companionGenerator:null,introductionGenerator:null});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const report={at:new Date().toISOString(),packaged:true,cases:[],limits:['Synthetic local owner and public-domain Alice; no production-account acceptance.','Page API mutations blocked before dispatch; explicit isolated local auth/logout fixture allowed. No model, translation or shared-resource write.','Unread/unsaved/long-title/text-scale states are named in-memory fixtures.','Driver input is not physical device, Safari or screen-reader speech acceptance.']};
const wait=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const settled=locator=>locator.evaluate(n=>Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
const state=p=>p.evaluate(()=>({anchor:window.marginaliaReader.getAnchor(),mode:window.marginaliaReader.getState().mode,pageLayout:window.marginaliaReader.getState().pageLayout,location:document.querySelector('#reading-location')?.textContent,tools:document.body.dataset.readingTools,overflow:document.documentElement.scrollWidth>innerWidth}));
async function show(p){if(await p.evaluate(()=>document.body.dataset.readingTools!=='open')){await p.locator('#reading-tools-trigger').focus();await p.keyboard.press('Enter');}await p.waitForFunction(()=>document.body.dataset.readingTools==='open');}
async function hide(p){if(await p.evaluate(()=>document.body.dataset.readingTools==='open'))await p.locator('#reading-tools-close').click();await p.waitForFunction(()=>document.body.dataset.readingTools==='closed');}
let browser,context;
try{
for(const engine of (process.env.LEAFHOUR_BROWSER_ENGINES||'chromium').split(',')){
 browser=await engines[engine].launch({headless:true,executablePath:process.env[engine==='chromium'?'LEAFHOUR_CHROMIUM_EXECUTABLE':'LEAFHOUR_WEBKIT_EXECUTABLE']});
 const matrix=process.argv.includes('--smoke')?[['en',1280,800,'paper',1]]:[...['en','zh-Hans','zh-Hant','ja'].flatMap(locale=>[[locale,1280,800,'paper',1],[locale,390,800,'night',1]]),['zh-Hant',320,800,'paper',2],['en',800,390,'night',1]];
 for(const [locale,width,height,theme,scale]of matrix){
  const row={engine,version:browser.version(),locale,width,height,theme,scale,checks:[],writes:[],errors:[]};report.cases.push(row);
  context=await browser.newContext({viewport:{width,height},hasTouch:width<=390,reducedMotion:width<=390?'reduce':'no-preference'});context.setDefaultTimeout(15000);
  let failReading=false,failChoices=false,emptyReading=false;
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
   if(u.pathname.startsWith('/api/')){
    if(req.method()!=='GET'){row.writes.push({path:u.pathname,blocked:true});return route.fulfill({status:403,json:{error:'Read-only verification'}});}
    if(failReading&&u.pathname.endsWith('/reading')){failReading=false;return route.fulfill({status:503,json:{error:'Injected reading outage'}});}
    if(emptyReading&&u.pathname.endsWith('/reading')){const response=await route.fetch(),book=await response.json();book.sections=[];return route.fulfill({response,json:book});}
    return route.continue();
   }
   if(failChoices&&u.pathname==='/reader-settings-choices.mjs')return route.abort();
   const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));assert.ok(file.startsWith(dist+path.sep));
   return route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream'});
  });
  const p=await context.newPage();p.on('pageerror',e=>row.errors.push(e.message));
  try{
   await p.goto(base+'/read?book=gutenberg-alice&ui='+locale);await p.waitForFunction(()=>document.body.dataset.ready==='true');await p.evaluate(theme=>window.marginaliaPaletteAdapter.appearance.setTheme(theme),theme);await p.evaluate(()=>document.fonts.ready);await wait(p);
   await p.locator('#reading-location').waitFor();await hide(p);
   const ai=p.locator('#reading-tools-chat-slot .library-chat-trigger'),pill=p.locator('#reading-tools-trigger');
   assert.equal(await ai.isVisible(),false);assert.equal(await p.locator('#reading-header').getAttribute('aria-hidden'),'true');assert.equal(await p.locator('dialog[open]').count(),0);
   row.initial=await state(p);assert.match(row.initial.location,/0%/);assert.equal(row.initial.overflow,false);
   row.pill=await pill.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,background:s.backgroundColor,opacity:s.opacity};});
   assert.ok(row.pill.height>=44&&row.pill.x>=0&&row.pill.x+row.pill.width<=width);assert.doesNotMatch(row.pill.background,/rgba\([^)]*,\s*0\)|transparent/);assert.equal(row.pill.opacity,'1');
   await p.screenshot({path:out+'/'+engine+'-'+locale+'-'+width+'-quiet.png'});row.checks.push('default-text-and-measured-progress-only-opaque-44px-entry');
   if(locale==='en'&&width===1280){await pill.hover();await ai.hover();await p.waitForTimeout(350);assert.equal(await ai.isVisible(),true);await p.mouse.move(400,300);await p.waitForTimeout(350);assert.equal(await ai.isVisible(),false);row.checks.push('native-pointer-crossing-holds-agent-preview');}
   // A meaningful unread state is allowed to surface the same Agent entry.
   await p.locator('#reading-tools-chat-slot').evaluate(n=>n.classList.add('has-companion-message'));assert.equal(await ai.isVisible(),true);
   await p.locator('#reading-tools-chat-slot').evaluate(n=>n.classList.remove('has-companion-message'));assert.equal(await ai.isVisible(),false);row.checks.push('unread-fixture-preserves-discoverable-agent');
   await show(p);assert.equal(await ai.isVisible(),true);assert.equal((await state(p)).anchor.passageId,row.initial.anchor.passageId);
   await ai.click();await p.locator('#reader-conversation').waitFor({state:'visible'});assert.equal(await p.locator('.library-chat-empty').isVisible(),true);
   await p.locator('.library-chat-close').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.classList.contains('library-chat-trigger'));assert.equal(await ai.isVisible(),true);assert.equal((await state(p)).tools,'open');
   if(locale==='en'&&width===1280){await p.waitForTimeout(5200);assert.equal(await ai.isVisible(),true);assert.equal(await ai.evaluate(n=>document.activeElement===n),true);row.checks.push('keyboard-focus-survives-five-second-deadline');}
   row.checks.push('agent-empty-open-close-restores-visible-entry-without-anchor-shift');
   await p.locator('#open-settings').click();await p.locator('#settings-dialog').waitFor({state:'visible'});await p.locator('#page-layout-setting .choice-control').waitFor();await settled(p.locator('#settings-dialog'));
   await p.locator('#reading-tools-panel').waitFor({state:'hidden'});
   assert.equal(await p.locator('.font-choices').isVisible(),false);assert.equal(await p.locator('#view-mode').evaluate(n=>!!n.closest('details:not([open])')),true);assert.equal(await p.locator('#page-layout-setting').isVisible(),true);
   row.settingsHeight=await p.locator('#settings-reading').evaluate(n=>n.scrollHeight);row.initialSettings=await p.locator('#settings-dialog').innerText();
   await p.screenshot({path:out+'/'+engine+'-'+locale+'-'+width+'-settings.png'});
   await p.locator('.typography-details>summary').click();await p.locator('[data-font-family=sans]').click();assert.equal(await p.locator('[data-font-family=sans]').getAttribute('aria-pressed'),'true');
   await p.locator('.typography-details>summary').click();await p.locator('#reading-content-settings>summary').focus();await p.keyboard.press('Enter');
   await p.locator('#reading-content-settings .choice-chip[data-value=parallel]').first().click();await p.locator('#parallel-settings').waitFor({state:'visible'});assert.equal((await state(p)).mode,'parallel');
   await p.locator('#reading-content-settings .choice-chip[data-value=en]').first().click();assert.equal((await state(p)).mode,'en');
   await p.locator('#translation-details>summary').click();assert.equal(await p.locator('#translation-about').isVisible(),true);row.sourceDisclosure=await p.locator('#translation-about').innerText();assert.ok(row.sourceDisclosure.length>20);
   await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('#settings-dialog').open);assert.equal(await p.evaluate(()=>document.activeElement.id),'open-settings');
   await hide(p);assert.equal((await state(p)).anchor.passageId,row.initial.anchor.passageId);row.checks.push('native-disclosures-choices-and-source-provenance-retain-values-and-focus');
   if(locale==='en'&&width===1280){
    await show(p);await p.locator('#open-settings').click();await p.locator('#page-layout-setting .choice-chip[data-value=spread]').click();await p.keyboard.press('Escape');await hide(p);await p.waitForFunction(()=>document.body.dataset.paginated==='true');await wait(p);
    const first=await p.locator('#page-position').textContent();await p.locator('#page-next').click();await p.waitForFunction(first=>document.querySelector('#page-position').textContent!==first,first);row.checks.push('existing-page-mode-real-count-and-turn');
    await show(p);await p.locator('#open-settings').click();await p.locator('#page-layout-setting .choice-chip[data-value=scroll]').click();await p.keyboard.press('Escape');await hide(p);
    await p.reload();await p.waitForFunction(()=>document.body.dataset.ready==='true');await p.locator('#reading-location').waitFor();assert.equal(await ai.isVisible(),false);assert.equal((await state(p)).mode,'en');assert.equal((await state(p)).pageLayout,'scroll');row.checks.push('reload-retains-view-and-quiet-entry');
    failChoices=true;const fallback=await context.newPage();await fallback.goto(base+'/read?book=gutenberg-alice&ui='+locale);await fallback.waitForFunction(()=>document.body.dataset.ready==='true');await show(fallback);await fallback.locator('#open-settings').click();await fallback.locator('#reading-content-settings>summary').click();await fallback.locator('#view-mode').waitFor({state:'visible'});await fallback.locator('#view-mode').selectOption('zh');assert.equal((await state(fallback)).mode,'zh');row.checks.push('optional-module-failure-native-select-remains-usable');await fallback.close();failChoices=false;
    failReading=true;const recovery=await context.newPage();await recovery.goto(base+'/read?book=gutenberg-alice&ui='+locale);await recovery.locator('#load-error').waitFor({state:'visible'});assert.equal(await recovery.locator('#retry-load').isEnabled(),true);await recovery.locator('#retry-load').click();await recovery.waitForFunction(()=>document.body.dataset.ready==='true');row.checks.push('actual-load-error-retry-recovers');await recovery.close();
    emptyReading=true;const empty=await context.newPage();await empty.goto(base+'/read?book=gutenberg-alice&ui='+locale);await empty.waitForFunction(()=>document.body.dataset.ready==='true');await empty.locator('#reading-location').waitFor();assert.doesNotMatch((await state(empty)).location,/%/);row.checks.push('empty-content-fixture-keeps-location-unknown');await empty.close();emptyReading=false;
   }
   // GET-226 attention remains a visible caption, even while all tools tuck away.
   row.attention=await p.evaluate(()=>{const root=document.querySelector('#reading-session'),label=document.querySelector('#reading-tools-label'),old=root.dataset.attention,text=label.textContent;root.dataset.attention='true';label.textContent='Unsaved';const result={fixture:'attention CSS state',caption:getComputedStyle(label).display,position:getComputedStyle(document.querySelector('#reading-location')).display};root.dataset.attention=old;label.textContent=text;return result;});assert.notEqual(row.attention.caption,'none');assert.equal(row.attention.position,'none');row.checks.push('unsaved-caption-fixture-remains-visible');
   if(scale===2){await p.evaluate(()=>{const nodes=[...document.querySelectorAll('#reading-header *,#reading-session *,#settings-dialog *,#reader-exit-fullscreen *')].map(n=>[n,parseFloat(getComputedStyle(n).fontSize)]);for(const [n,size]of nodes)n.style.fontSize=size*2+'px';});}
   // Long names remain available through the existing book-info/contents paths.
   const longTitle='长书名 A long chapter 日本語 🌿 '.repeat(8);
   await p.evaluate(title=>{const r=window.marginaliaReader,b=r.getBook();b.title.zh=title;b.chapters.find(c=>c.id===r.getChapterId()).title.zh=title;document.querySelector('#running-book-title').textContent=title;document.dispatchEvent(new CustomEvent('reader:chapter'));},longTitle);await wait(p);
   await show(p);await p.locator('#open-chapter').click();assert.ok((await p.locator('.toc-chapter[aria-current=location]').textContent()).includes(longTitle));await p.keyboard.press('Escape');
   await p.locator('#open-book-info').click();await p.locator('#book-info').waitFor({state:'visible'});assert.equal(await p.locator('#book-info-title').textContent(),longTitle);await p.keyboard.press('Escape');await hide(p);
   await p.locator('body').evaluate(n=>{n.tabIndex=-1;n.focus({preventScroll:true});});await p.keyboard.press('f');await p.waitForFunction(()=>!!document.fullscreenElement);await p.locator('#reader-exit-fullscreen').waitFor({state:'visible'});
   const exit=await p.locator('#reader-exit-fullscreen').boundingBox();assert.ok(exit.height>=44&&exit.width>=44&&exit.x>=0&&exit.x+exit.width<=width);await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.fullscreenElement);
   row.checks.push('long-title-disclosure-and-existing-real-F-Escape-exit');
   await p.screenshot({path:out+'/'+engine+'-'+locale+'-'+width+'-final.png'});assert.equal((await state(p)).overflow,false);
   if(locale==='en'&&width===1280){
    // Local fixture auth only; the isolated server has no production secrets.
    const auth=await context.request.post(base+'/api/auth/local',{data:{},headers:{Origin:base}});assert.equal(auth.ok(),true);const owner=(await auth.json()).user.id;assert.ok(owner);
    const draftPage=await context.newPage();await draftPage.goto(base+'/read?book=gutenberg-alice&ui='+locale);await draftPage.waitForFunction(()=>document.body.dataset.ready==='true');
    assert.equal(await draftPage.evaluate(async()=>((await (await fetch('/api/auth/session')).json()).user.id)),owner);
    await show(draftPage);await draftPage.locator('#reading-tools-chat-slot .library-chat-trigger').click();const input=draftPage.locator('.library-chat-composer textarea');await input.fill('GET-252 isolated draft, never sent');
    await draftPage.locator('.library-chat-close').click();await draftPage.reload();await draftPage.waitForFunction(()=>document.body.dataset.ready==='true');await show(draftPage);await draftPage.locator('#reading-tools-chat-slot .library-chat-trigger').click();assert.equal(await input.inputValue(),'GET-252 isolated draft, never sent');await input.fill('');await draftPage.close();
    const logout=await context.request.post(base+'/api/auth/logout',{data:{},headers:{Origin:base,'X-Reader-Owner':owner}});assert.equal(logout.ok(),true);assert.equal((await (await context.request.get(base+'/api/auth/session')).json()).user,null);row.checks.push('isolated-local-auth-draft-close-reload-restore-and-session-revocation');
   }
   assert.deepEqual(row.errors,[]);row.passed=true;
  }finally{await context.close();context=null;await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
 }
 await browser.close();browser=null;
}
}finally{await context?.close();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.cases.map(({engine,locale,width,passed,settingsHeight})=>({engine,locale,width,passed,settingsHeight}))));
