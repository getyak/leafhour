// Rendered GET-281 acceptance. Synthetic auth and public-domain text only.
// --base verifies production without login, API writes or model calls.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

const output=process.argv[2],external=process.argv.find(a=>a.startsWith('--base='))?.slice(7);
if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Output path and browser module required');
await mkdir(output,{recursive:true});
const report={cases:[],errors:[],blockedWrites:[],limits:['Browser input, not physical iPhone, Safari or screen-reader acceptance.','Answer/unread specimens are labelled DOM fixtures, not model outputs.','No production login, personal data or model calls.']};
let server,browser;
try{
 let base=external;
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
 browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',...(process.env.LEAFHOUR_CDP_PORT?{args:['--remote-debugging-port='+process.env.LEAFHOUR_CDP_PORT]}:{})});
 report.browser=browser.version();
 const context=await browser.newContext({reducedMotion:'reduce'});
 if(!base){
  const data=await mkdtemp(path.join(tmpdir(),'leafhour-get281-')),codes=new Map(),email='get281-local@example.com';
  server=await createReaderServer({bookPath:data+'/missing.json',recordsPath:data+'/records.json',portalDataDir:data+'/portal',allowLocal:false,env:{},sendCode:async(email,code)=>codes.set(email,code),companionGenerator:null,chatGenerator:null});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
  assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
 }
 await context.route('**/api/**',route=>{
  if(route.request().method()==='GET')return route.continue();
  report.blockedWrites.push(new URL(route.request().url()).pathname);
  return route.fulfill({status:403,json:{error:'Read-only acceptance'}});
 });
 if(process.env.LEAFHOUR_VERIFY_DIST&&!external){
  const dist=path.resolve(process.env.LEAFHOUR_VERIFY_DIST);report.packaged=true;
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
   if(u.pathname.startsWith('/api/'))return route.fallback();
   const file=u.pathname==='/read'?path.resolve('.ui-entry/read.html'):path.resolve(dist,u.pathname.slice(1));assert.ok(u.pathname==='/read'||file.startsWith(dist+path.sep));
   return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream'});
  });
 }
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const matrix=process.argv.includes('--smoke')?[[1440,900,'zh-Hans','paper']]:[[1440,900,'zh-Hans','paper'],[1200,800,'en','leaf'],[768,1024,'zh-Hant','paper'],[390,844,'zh-Hans','night'],[320,700,'ja','paper']];
 for(const [width,height,locale,theme]of matrix){
  await page.setViewportSize({width,height});
  await page.goto(base+'/read?book=gutenberg-alice&ui='+locale);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.evaluate(theme=>window.marginaliaPaletteAdapter.appearance.setTheme(theme),theme);assert.equal(await page.evaluate(()=>window.marginaliaReader.getState().theme),theme);await page.evaluate(()=>document.fonts.ready);await settle();
  const row={width,height,locale,theme,checks:[]};report.cases.push(row);
  const pill=page.locator('#reading-tools-trigger'),entry=page.locator('#reading-tools-chat-slot .library-chat-trigger'),dialog=page.locator('#reader-conversation');
  await entry.waitFor({state:'attached'});
  const shell=await page.locator('#reading-session').evaluate(n=>{const s=getComputedStyle(n);return {background:s.backgroundColor,shadow:s.boxShadow,border:s.borderTopColor};});
  const entryPainted=()=>page.locator('#reading-tools-chat-slot').evaluate(n=>getComputedStyle(n).opacity!=='0');
  assert.match(shell.background,/rgba\(0, 0, 0, 0\)|transparent/,'sleeping launcher has no painted shell');assert.equal(shell.shadow,'none');assert.equal(await entryPainted(),false);
  assert.equal(await pill.evaluate(n=>getComputedStyle(n).position),'fixed','lazy reading hub cannot restore the sleeping pill');
  assert.equal(await pill.locator('svg').evaluate(n=>getComputedStyle(n).opacity),'0');
  assert.equal(await page.locator('#reading-session').evaluate(n=>getComputedStyle(n).pointerEvents),'none','sleeping shell does not intercept book input');
  await page.screenshot({path:path.join(output,width+'-sleep.png')});row.checks.push('sleeping-shell-and-chat-hidden');
  // Real pointer hover must not wake chrome; a completed edge click does.
  await page.mouse.move(width/2,height-8);assert.equal(await page.locator('body').getAttribute('data-reading-tools'),'closed');
  await page.mouse.click(12,height-12);await page.waitForFunction(()=>document.body.dataset.readingTools==='open');
  assert.equal(await entryPainted(),true);await page.screenshot({path:path.join(output,width+'-tools.png')});
  await page.locator('#reading-tools-close').click();await page.waitForFunction(()=>document.body.dataset.readingTools==='closed');
  // Unread entry and programmatic focus return are explicit visibility exceptions.
  await page.locator('#reading-tools-chat-slot').evaluate(n=>n.classList.add('has-companion-message'));assert.equal(await entryPainted(),true);
  await page.locator('#reading-tools-chat-slot').evaluate(n=>n.classList.remove('has-companion-message'));await page.locator('#book-page').focus();assert.equal(await entryPainted(),false);
  await page.keyboard.press('Tab');await pill.focus();assert.equal(await pill.evaluate(n=>getComputedStyle(n).color==='rgba(0, 0, 0, 0)'),false);await page.keyboard.press('Enter');await page.waitForFunction(()=>document.body.dataset.readingTools==='open');
  row.checks.push('edge-keyboard-and-unread-recovery');
  const before=await page.evaluate(()=>window.marginaliaReader.getAnchor());
  await entry.click();await dialog.waitFor({state:'visible'});await settle();
  const bounds=await dialog.boundingBox();row.chat=bounds;
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
  if(width<1100){assert.ok(Math.abs(bounds.height-Math.max(360,height*.5))<2,'conversation is half of the visual viewport');assert.equal(await dialog.getAttribute('aria-modal'),'true');assert.equal(await page.locator('#book-page').evaluate(n=>n.inert),true);}
  else{assert.equal(bounds.height,height);const book=await page.locator('#book-page').boundingBox();assert.ok(book.x+book.width<=bounds.x+1);assert.equal((await page.evaluate(()=>window.marginaliaReader.getAnchor())).passageId,before.passageId);}
  // Fixed specimen isolates answer styling without generating or saving anything.
  await page.locator('.library-chat-messages').evaluate(n=>{const answer=document.createElement('article');answer.className='library-chat-answer';answer.dataset.fixture='get281-answer';const p=document.createElement('p');p.className='library-chat-markdown';p.textContent='GET-281 layout specimen. The book remains the starting point for this conversation. A long passage and its source should be easy to read without an enclosing card.';answer.append(p);n.replaceChildren(answer);});
  const answer=await page.locator('[data-fixture=get281-answer]').evaluate(n=>{const s=getComputedStyle(n);return {border:s.borderTopWidth,background:s.backgroundColor};});assert.equal(answer.border,'0px');assert.match(answer.background,/rgba\(0, 0, 0, 0\)|transparent/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,width+'-chat.png')});
  await page.locator('.library-chat-close').click();await settle();assert.equal(await entry.evaluate(n=>n===document.activeElement),true);assert.equal(await entryPainted(),true);assert.equal((await page.evaluate(()=>window.marginaliaReader.getAnchor())).passageId,before.passageId);assert.equal(await page.locator('body').getAttribute('data-reading-tools'),'closed');
  row.checks.push('half-sheet-or-wide-reflow','plain-answer-specimen','anchor-and-focus-return');
  if(width===390){
   await entry.click();
   await page.locator('.library-chat-composer textarea').fill('A multiline local layout draft.\nReturn to the same passage after asking.');
   for(const short of [620,568,501]){await page.setViewportSize({width,height:short});await settle();assert.ok(Math.abs((await dialog.boundingBox()).height-360)<2);const messages=await page.locator('.library-chat-messages').boundingBox(),composer=await page.locator('.library-chat-composer').boundingBox();assert.ok(messages.height>=96,'short-sheet answer remains scrollable');assert.ok(composer.y+composer.height<=short,'short-sheet composer remains inside viewport');await page.screenshot({path:path.join(output,'390-'+short+'.png')});}
   await page.setViewportSize({width,height:420});await settle();assert.ok(Math.abs((await dialog.boundingBox()).height-420)<2);await page.screenshot({path:path.join(output,'390-compact.png')});
   await page.setViewportSize({width,height});await settle();assert.ok(Math.abs((await dialog.boundingBox()).height-height*.5)<2);await page.locator('.library-chat-close').click();row.checks.push('compact-viewport-recovers-half-sheet');
   // The real quote composer has source metadata and more fixed-height content.
   await page.evaluate(()=>{const n=[...document.querySelectorAll('.passage p')].find(n=>n.textContent.length>150);n.scrollIntoView({block:'start'});const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT),nodes=[];let text;while(text=walker.nextNode())nodes.push(text);text=nodes.sort((a,b)=>b.length-a.length)[0];const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(400,text.length));getSelection().removeAllRanges();getSelection().addRange(range);});
   await page.locator('#quote-to-ai').click();await page.locator('.library-chat-quote-chip').waitFor({state:'visible'});
   for(const short of [844,568,501]){await page.setViewportSize({width,height:short});await settle();const composer=await page.locator('.library-chat-composer').boundingBox(),messages=await page.locator('.library-chat-messages').boundingBox();assert.ok(Math.abs((await dialog.boundingBox()).height-short)<2,'selected source expands the sheet');assert.ok(composer.y+composer.height<=short,'quoted composer and send remain reachable');assert.ok(messages.height>=96,'quoted source leaves a readable answer area');await page.screenshot({path:path.join(output,'390-quote-'+short+'.png')});}
   await page.locator('.library-chat-quote-remove').click();await settle();assert.ok(Math.abs((await dialog.boundingBox()).height-360)<2);row.checks.push('real-quote-expands-and-removal-restores-sheet');
   // Named annotation layout specimen; no note is created or read.
   await page.locator('.library-chat-frame').evaluate(frame=>{const n=document.createElement('section');n.className='reader-annotation-card';n.dataset.placement='chat';n.dataset.fixture='get281-annotation';n.textContent='Annotation layout specimen';frame.insertBefore(n,frame.querySelector('.library-chat-messages'));});
   await settle();assert.ok(Math.abs((await dialog.boundingBox()).height-501)<2);assert.equal(await page.locator('.library-chat-frame').evaluate(n=>getComputedStyle(n).overflowY),'auto');
   await page.locator('.library-chat-composer').scrollIntoViewIfNeeded();const composer=await page.locator('.library-chat-composer').boundingBox();assert.ok(composer.y+composer.height<=501);await page.locator('[data-fixture=get281-annotation]').evaluate(n=>n.remove());await settle();assert.ok(Math.abs((await dialog.boundingBox()).height-360)<2);await page.locator('.library-chat-close').click();row.checks.push('annotation-layout-specimen-scrolls-and-restores-sheet');
  }
 }
 // Verify the actual guest login action, independently of synthetic auth.
 await context.clearCookies();await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/read?book=gutenberg-alice&ui=zh-Hans');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 await page.locator('#reading-tools-chat-slot .library-chat-trigger').waitFor({state:'attached'});await page.locator('#reading-tools-trigger').focus();await page.keyboard.press('Enter');await page.locator('#reading-tools-chat-slot .library-chat-trigger').click();
 report.guestContrast=[];
 for(const theme of ['paper','warm','mist','leaf','night']){
  await page.evaluate(theme=>window.marginaliaPaletteAdapter.appearance.setTheme(theme),theme);
  const colors=await page.locator('.library-chat-empty .library-chat-send').evaluate(n=>{const s=getComputedStyle(n);return {color:s.color,background:s.backgroundColor};});
  assert.doesNotMatch(colors.background,/rgba\(0, 0, 0, 0\)|transparent/,'guest login button has a real background');
  const luminance=c=>{const rgb=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const a=luminance(colors.color),b=luminance(colors.background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert.ok(ratio>=4.5,'guest login text meets contrast');report.guestContrast.push({theme,...colors,ratio});
 }
 await page.screenshot({path:path.join(output,'390-guest.png')});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();if(server)await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
