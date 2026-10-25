// GET-220: actual reader DOM, native browser events, synthetic isolated accounts.
// No provider, purchases, production data or iOS simulators are used.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
const output=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Explicit registered artifact path and Playwright module required');
await mkdir(output,{recursive:true});
const codes=new Map();let dispatches=0;
const server=await createReaderServer({bookPath:path.join(output,'missing.json'),recordsPath:path.join(output,'browser-records/records.json'),portalDataDir:path.join(output,'browser-records/portal'),allowLocal:false,sendCode:async(email,code)=>codes.set(email,code),env:{},companionGenerator:null,chatGenerator:async job=>{
 dispatches++;const context=await job.tools.execute('reader_get_context',{}),p=context.passages[0];
 await job.tools.execute('reader_cite',{bookId:job.book.bookId,passageId:p.passageId,layer:'original',quote:p.original.slice(0,24)});
 return {kind:'conversation',summary:'Synthetic browser answer. The saved reference identifies the public source.\n\n'+('A bounded long answer for scroll recovery. '.repeat(20))};
}});
let base,browser;
const report={kind:'GET-220-browser',at:new Date().toISOString(),engine:null,cases:[],checks:[],failures:[],limits:['Synthetic local generator proves HTTP, validation and persistence, not the production provider.','CompositionEvent tests do not prove a physical OS IME.','A half CSS viewport at DPR 2 models 200 percent layout; native browser toolbar zoom and physical soft keyboards remain unverified.']};
const pause=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const sessions=new Map();
async function login(context,id){
 id=typeof id==='number'?'matrix-'+Math.floor((id-1)/10):id;const cached=sessions.get(id);if(cached){await context.addCookies(cached.cookies);return cached.user;}
 const email='get220-'+id+'@example.com';
 assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
 assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,code:codes.get(email),purpose:'login'}})).status(),200);
 const session=await(await context.request.get(base+'/api/auth/session')).json();assert.ok(session.user?.id);sessions.set(id,{user:session.user,cookies:await context.cookies()});return session.user;
}
async function state(page){return page.evaluate(()=>{const p=document.querySelector('.passage'),tools=document.querySelector('.reading-session');return {paragraph:p?.getBoundingClientRect().toJSON(),tools:tools?.getBoundingClientRect().toJSON(),scroll:scrollY,selection:getSelection()?.toString(),padding:getComputedStyle(document.body).paddingRight};});}
function stable(a,b){for(const key of ['x','y','width'])assert.ok(Math.abs(a.paragraph[key]-b.paragraph[key])<1,`Paragraph ${key}: ${a.paragraph[key]} -> ${b.paragraph[key]}`);assert.equal(b.scroll,a.scroll);assert.equal(b.selection,a.selection);assert.equal(b.padding,a.padding);}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,...(process.env.LEAFHOUR_CHROMIUM_EXECUTABLE?{executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE}:{})});report.engine=browser.version();
 let number=0;
 for(const [width,height]of (process.argv.includes('--events-only')?[]:[[1440,900],[1200,600],[768,1024],[390,844],[390,420]]))for(const locale of ['en','zh-Hans','zh-Hant','ja'])for(const theme of ['light','dark']){
  const id=++number,context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),user=await login(context,id),page=await context.newPage();
  const item={id,width,height,locale,theme,ownerVerified:!!user.id,states:[],errors:[]};report.cases.push(item);
  page.on('pageerror',e=>item.errors.push(e.message));
  try{
   await page.goto(base+'/read?book=gutenberg-alice&ui='+locale,{waitUntil:'networkidle'});
   await page.locator('.library-chat-trigger').waitFor({state:'visible'});
   await page.evaluate(async([locale,theme])=>{const m=await import('/ui-locale.mjs');await m.requestUiRoute(locale);document.documentElement.dataset.theme=theme==='dark'?'night':'paper';if(m.getUiLocale()!==locale)throw Error('Interface locale did not commit');},[locale,theme]);
   await pause(page);item.themeObserved=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()}));assert.equal(item.themeObserved.theme,theme==='dark'?'night':'paper');assert.ok(item.themeObserved.paper);
   const shot=async state=>{const file=`${id}-${width}x${height}-${locale}-${theme}-${state}.png`;await page.screenshot({path:path.join(output,file)});item.states.push({state,file});};
   await shot('closed');const initialInert=await page.evaluate(()=>[...document.body.children].filter(n=>n.inert).map(n=>n.id||n.className).sort());const before=await state(page);await page.locator('.library-chat-trigger').click();await page.locator('.library-chat-dialog[open]').waitFor();await pause(page);
   const root=page.locator('.library-chat-dialog'),input=page.locator('#library-chat-input');
   if(width>=1100)stable(before,await state(page));
   assert.equal(await root.evaluate(e=>e.getAttribute('aria-modal')),width<1100?'true':'false');
   await input.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#library-chat-input').disabled);
   await shot('open');await page.locator('.library-chat-menu>summary').click();await page.locator('.library-chat-settings>summary').click();
   const bounds=await page.locator('.library-chat-menu-items').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),height:e.clientHeight,scroll:e.scrollHeight}));
   assert.ok(bounds.rect.left>=0&&bounds.rect.right<=width+1&&bounds.rect.bottom<=height+1,'More stays in viewport');
   await shot('more');await page.keyboard.press('Escape');assert.equal(await page.locator('.library-chat-settings').evaluate(e=>e.open),false);assert.equal(await page.locator('.library-chat-menu').evaluate(e=>e.open),true);
   await page.keyboard.press('Escape');assert.equal(await page.locator('.library-chat-menu').evaluate(e=>e.open),false);assert.equal(await root.evaluate(e=>e.open),true);
   await input.fill('Explain this public paragraph in one sentence.');await shot('input');
   const count=dispatches;await input.dispatchEvent('compositionstart');await input.press('Enter');assert.equal(dispatches,count);await input.dispatchEvent('compositionend');await input.fill('Explain this public paragraph in one sentence.');
   await page.evaluate(()=>{const form=document.querySelector('.library-chat-composer');form.requestSubmit();form.requestSubmit();});
   const newId=await page.locator('.library-chat-turn').last().getAttribute('data-message-id');assert.ok(newId);await page.locator('[data-message-id="'+newId+'"] .library-chat-answer').waitFor();assert.equal(dispatches,count+1,'one local generation');await shot('sent');
   const requestId=await page.locator('.library-chat-turn').last().getAttribute('data-message-id');assert.ok(requestId);
   const response=await context.request.get(base+'/api/library/books/gutenberg-alice/chat');const saved=await response.json();assert.equal(saved.turns.find(t=>t.id===requestId)?.status,'completed');
   await page.reload({waitUntil:'networkidle'});await page.locator('.library-chat-trigger').click();await page.locator('[data-message-id="'+requestId+'"] .library-chat-answer').waitFor();assert.equal(dispatches,count+1,'reload only reads');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.library-chat-dialog').open);
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.deepEqual(await page.evaluate(()=>[...document.body.children].filter(n=>n.inert).map(n=>n.id||n.className).sort()),initialInert);
   assert.deepEqual(item.errors,[]);item.passed=true;
  }catch(error){item.passed=false;item.failure=error.message;report.failures.push({id,message:error.message});await page.screenshot({path:path.join(output,`failure-${id}.png`)});throw error;}
  finally{await context.close();await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));}
 }
 // Native pointer sequences and keyboard navigation use one additional account.
 const context=await browser.newContext({viewport:{width:1440,height:900}});const eventUser=await login(context,'events');const page=await context.newPage();
 await page.goto(base+'/read?book=gutenberg-alice',{waitUntil:'networkidle'});await page.locator('.library-chat-trigger').waitFor();
 await page.evaluate(()=>{const button=document.createElement('button');button.id='outside-target';button.textContent='Outside action';button.style='position:fixed;left:10px;top:100px;z-index:1000';window.outsideCount=0;button.addEventListener('click',e=>{window.outsideCount++;e.stopPropagation();});document.body.append(button);});
 const root=page.locator('.library-chat-dialog'),open=async()=>{await page.locator('.library-chat-trigger').click();await page.waitForFunction(()=>document.querySelector('.library-chat-dialog').open);};
 await open();await page.locator('#library-chat-input').fill('Retained draft.');await page.locator('#outside-target').click();assert.equal(await root.evaluate(e=>e.open),false);assert.equal(await page.evaluate(()=>window.outsideCount),1);assert.equal(await page.evaluate(()=>document.activeElement.id),'outside-target');await open();assert.equal(await page.locator('#library-chat-input').inputValue(),'Retained draft.');report.checks.push('capture outside target executes once, keeps focus and draft');
 await page.mouse.move(20,400);assert.equal(await root.evaluate(e=>e.open),true);await page.mouse.click(20,400,{button:'right'});assert.equal(await root.evaluate(e=>e.open),true);
 const inputRect=await page.locator('#library-chat-input').boundingBox();await page.mouse.move(inputRect.x+20,inputRect.y+10);await page.mouse.down();await page.mouse.move(30,450);await page.mouse.up();assert.equal(await root.evaluate(e=>e.open),true);report.checks.push('pointer exit, right click and inside drag do not dismiss');
 await page.mouse.move(20,450);await page.mouse.down();await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));await page.mouse.up();assert.equal(await root.evaluate(e=>e.open),true);report.checks.push('cancelled exterior pointer gesture does not dismiss');
 await page.locator('#outside-target').focus();await page.keyboard.press('Enter');assert.equal(await root.evaluate(e=>e.open),false);assert.equal(await page.evaluate(()=>window.outsideCount),2);assert.equal(await page.evaluate(()=>document.activeElement.id),'outside-target');await open();report.checks.push('keyboard outside activation executes once and preserves focus');
 await page.evaluate(ownerId=>{const button=document.createElement('button');button.id='audio-handoff';button.className='squirrel-companion-bubble';button.textContent='Audio handoff';button.style='position:fixed;left:10px;top:160px;z-index:1000';button.addEventListener('click',e=>{e.stopPropagation();document.dispatchEvent(new CustomEvent('reader:audio-question',{detail:{ownerId,bookId:'gutenberg-alice',passageId:window.marginaliaReader.getAnchor().passageId,draft:'Audio question'}}));});document.body.append(button);},eventUser.id);
 await page.locator('#audio-handoff').click();assert.equal(await root.evaluate(e=>e.open),true);assert.equal(await page.locator('#library-chat-input').inputValue(),'Retained draft.');report.checks.push('same-click audio handoff stays open and preserves an existing draft');
 const before=await state(page),separator=page.locator('.reader-chat-separator'),rect=await separator.boundingBox();await page.mouse.move(rect.x+5,rect.y+40);await page.mouse.down();await page.mouse.move(rect.x-55,rect.y+40);await page.mouse.up();assert.equal(await root.evaluate(e=>e.open),true);stable(before,await state(page));report.checks.push('native separator resize keeps body and reading position');
 await page.setViewportSize({width:1200,height:600});await page.locator('.library-chat-menu>summary').click();await page.locator('.library-chat-settings>summary').click();await page.locator('.library-chat-explanation>summary').click();
 const menu=page.locator('.library-chat-menu-items');await menu.evaluate(e=>{e.scrollTop=e.scrollHeight;});const menuRect=await menu.boundingBox(),scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.move(menuRect.x+menuRect.width/2,menuRect.y+menuRect.height-15);await page.mouse.wheel(0,700);await pause(page);assert.equal(await page.evaluate(()=>scrollY),scrollBefore);report.checks.push('More boundary wheel stays inside the menu');
 for(let level=0;level<3;level++){await page.keyboard.press('Escape');assert.equal(await root.evaluate(e=>e.open),true);}await page.keyboard.press('Escape');assert.equal(await root.evaluate(e=>e.open),false);await page.setViewportSize({width:1440,height:900});await pause(page);report.checks.push('Escape unwinds explanation, settings, More and chat in order');
 await page.evaluate(()=>{const p=document.querySelector('.passage p'),text=[...p.childNodes].find(n=>n.nodeType===3&&n.textContent.length>5);if(!text)throw Error('No source text for selection');const range=document.createRange();range.setStart(text,0);range.setEnd(text,5);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 const selected=await state(page);assert.ok(selected.selection);await open();stable(selected,await state(page));await page.keyboard.press('Escape');stable(selected,await state(page));report.checks.push('native source selection survives opening and closing without a layout change');
 await open();await page.setViewportSize({width:390,height:420});await page.waitForFunction(()=>document.querySelector('.library-chat-dialog').getAttribute('aria-modal')==='true');assert.equal(await root.getAttribute('aria-modal'),'true');assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');await page.locator('#library-chat-input').fill('A mobile draft');await page.locator('.library-chat-send').focus();await page.keyboard.press('Tab');assert.equal(await root.evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press('Shift+Tab');assert.equal(await root.evaluate(e=>e.contains(document.activeElement)),true);await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('.library-chat-dialog').getAttribute('aria-modal')==='false');assert.equal(await root.getAttribute('aria-modal'),'false');assert.equal(await page.evaluate(()=>document.body.style.overflow),'');await page.keyboard.press('Escape');report.checks.push('mobile focus containment and desktop breakpoint restore inert and scroll ownership');
 const zoomContext=await browser.newContext({viewport:{width:720,height:450},deviceScaleFactor:2});await login(zoomContext,'zoom');const zoomPage=await zoomContext.newPage();await zoomPage.goto(base+'/read?book=gutenberg-alice',{waitUntil:'networkidle'});await zoomPage.locator('.library-chat-trigger').click();const zoomBounds=await zoomPage.locator('.library-chat-dialog').evaluate(e=>e.getBoundingClientRect().toJSON());assert.ok(zoomBounds.x>=0&&zoomBounds.y>=0&&zoomBounds.right<=720&&zoomBounds.bottom<=450);await zoomPage.screenshot({path:path.join(output,'zoom-200-equivalent.png')});await zoomPage.keyboard.press('Escape');await zoomContext.close();report.checks.push('half CSS viewport at DPR 2 keeps close and composer within 200 percent equivalent bounds');
 await context.close();report.passed=report.cases.every(c=>c.passed);await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.length,checks:report.checks,failures:report.failures,passed:report.passed}));
}finally{try{await browser?.close();}finally{await new Promise(r=>server.close(r));}}
