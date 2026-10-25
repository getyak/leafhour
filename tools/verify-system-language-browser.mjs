// GET-219 real-browser acceptance. Local synthetic accounts only; no providers.
// LEAFHOUR_PLAYWRIGHT_MODULE=/absolute/path/playwright-core/index.mjs
// LEAFHOUR_WEBKIT_EXECUTABLE=/absolute/path/pw_run.sh
// node tools/verify-system-language-browser.mjs <registered-artifact-directory>
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
const output=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Explicit artifact directory and Playwright module are required.');
const {chromium,webkit}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
await mkdir(output,{recursive:true});
const baseline=process.env.LEAFHOUR_BASELINE_CONSOLE_REPORT?JSON.parse(await readFile(process.env.LEAFHOUR_BASELINE_CONSOLE_REPORT,'utf8')):null;
const runDirectory=path.join(output,'browser-'+Date.now());
const codes=new Map(),server=await createReaderServer({bookPath:path.join(output,'absent.json'),recordsPath:path.join(runDirectory,'records.json'),portalDataDir:path.join(runDirectory,'portal'),allowLocal:false,generator:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,annotationGenerator:null,sendCode:async(email,code)=>codes.set(email,code),env:{}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const report={kind:'GET-219-real-browser',at:new Date().toISOString(),engines:[],limits:['CompositionEvent coverage does not prove physical OS IME operation.','CSS zoom 2 is a layout stress proxy; native browser toolbar zoom is platform UI.','Synthetic pageshow exercises application BFCache recovery; real cache admission is browser-controlled.']};
let browser;
const state=page=>page.evaluate(async()=>{const m=await import('/ui-locale.mjs');await m.uiReady;return m.getUiLocaleState();});
async function settle(page,pref,effective){await page.waitForFunction(async([p,e])=>{const m=await import('/ui-locale.mjs'),s=m.getUiLocaleState();return s.phase==='ready'&&s.preference===p&&(!e||s.effective===e);},[pref,effective]);return state(page);}
async function saved(page){await page.waitForFunction(async()=>{const m=await import('/ui-locale.mjs');return m.getUiLocaleState().account.phase==='saved';});}
async function choose(page,code){await page.locator('.ui-locale-choice').filter({has:page.locator('input[value="'+code+'"]')}).click();await settle(page,code);}
async function login(context,email){
 const a=await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}});assert.equal(a.status(),200);
 const b=await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,code:codes.get(email),purpose:'login'}});assert.equal(b.status(),200);
 const session=await (await context.request.get(base+'/api/auth/session')).json();assert.ok(session.user?.id);return session.user;
}
try{
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  browser=await engine.launch({headless:true,...(name==='webkit'&&process.env.LEAFHOUR_WEBKIT_EXECUTABLE?{executablePath:process.env.LEAFHOUR_WEBKIT_EXECUTABLE}:{})});
  const result={engine:name,version:browser.version(),locale:'ja-JP',checks:[],layout:[],screenshots:[],requests:[],errors:[],navigationCancellations:[],consoleErrors:[],expectedRequestFailures:[],expectedResponses:[]};report.engines.push(result);
  let phase='initial',pageCount=0;const requestPhases=new WeakMap(),requestDocuments=new WeakMap(),expectedRequests=new WeakMap(),consoleBudgets=new Map(),telemetry=new Set();
  function expectFailure(route,{status=null,reason}){
   const request=route.request(),pathname=new URL(request.url()).pathname;
   expectedRequests.set(request,{status,reason});
   const key=JSON.stringify([phase,pathname,status]);consoleBudgets.set(key,(consoleBudgets.get(key)||0)+1);
   result.expectedResponses.push({phase,path:pathname,method:request.method(),status,reason});
  }
  async function newContext(options){
   const context=await browser.newContext(options);let contextClosing=false;
   const close=context.close.bind(context);context.close=async(...args)=>{contextClosing=true;return close(...args);};
   context.on('page',page=>{
    const pageId=++pageCount;let generation=0,navigating=0,closing=false;
    const close=page.close.bind(page);page.close=async(...args)=>{closing=true;return close(...args);};
    for(const method of ['goto','reload','goBack']){const original=page[method].bind(page);page[method]=async(...args)=>{generation++;navigating++;try{return await original(...args);}finally{navigating--;}};}
    page.on('pageerror',error=>result.errors.push({phase,page:pageId,message:error.message}));
    page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())generation++;requestPhases.set(request,phase);requestDocuments.set(request,generation);if(new URL(request.url()).origin===base)result.requests.push({phase,page:pageId,method:request.method(),path:new URL(request.url()).pathname});});
    page.on('console',message=>{
     if(message.type()!=='error')return;
     const item={phase,page:pageId,text:message.text(),path:message.location().url?new URL(message.location().url).pathname:null};
     const statusMatch=/\bstatus(?: code)?(?: of)?\s*:?\s*([1-5]\d{2})\b/i.exec(item.text);
     const httpStatus=statusMatch?Number(statusMatch[1]):null;
     const injectedAbort=/net::ERR_(?:FAILED|INTERNET_DISCONNECTED)|Load failed|The Internet connection appears to be offline|The network connection was lost/i.test(item.text);
     if(item.text.startsWith('Failed to load resource:')&&(httpStatus!==null||injectedAbort)){
      const status=httpStatus;
      const key=JSON.stringify([phase,item.path,status]),remaining=consoleBudgets.get(key)||0;
      if(remaining){consoleBudgets.set(key,remaining-1);item.expectedInjection=status??'request-abort';}
     }
     result.consoleErrors.push(item);
    });
    page.on('requestfailed',request=>{
     const activeNavigation=navigating>0,wasClosing=closing||contextClosing,stamp=generation;
     const task=(async()=>{
      const item={phase,startedPhase:requestPhases.get(request),page:pageId,document:requestDocuments.get(request),currentDocument:stamp,method:request.method(),path:new URL(request.url()).pathname,failure:request.failure()?.errorText,httpStatus:(await request.response())?.status()??null};
      const expected=expectedRequests.get(request),cancelled=['net::ERR_ABORTED','cancelled'].includes(item.failure);
      if(expected)result.expectedRequestFailures.push({...item,explanation:expected.reason});
      else if(cancelled&&item.method==='GET'&&(wasClosing||activeNavigation||item.document<item.currentDocument))result.navigationCancellations.push({...item,explanation:wasClosing?'Test explicitly closed this page/context.':activeNavigation?'Test was awaiting this page navigation.':'A subsequent document navigation cancelled the previous document read.'});
      else result.errors.push(item);
     })();telemetry.add(task);void task.finally(()=>telemetry.delete(task));
    });
   });
   return context;
  }
  const context=await newContext({locale:'ja-JP',viewport:{width:1440,height:1100},reducedMotion:'reduce'}),page=await context.newPage();
  async function check(label,fn){phase=label;await fn();result.checks.push(label);console.log(name,label,'PASS');}
  await check('new visitor defaults to system and current browser language',async()=>{await page.goto(base+'/library?settings=appearance');await page.locator('.ui-locale-choice').first().waitFor();await settle(page,'system','ja');assert.equal(await page.locator('.ui-locale-choice input:checked').count(),1);assert.equal(await page.locator('.ui-locale-choice input:checked').inputValue(),'system');for(const width of [320,1440]){await page.setViewportSize({width,height:1100});await page.locator('.ui-locale-choices').scrollIntoViewIfNeeded();const file=name+'-'+width+'-system.png';await page.screenshot({caret:'initial',path:path.join(output,file)});result.screenshots.push(file);}});
  await check('four explicit languages survive full reload then return to system',async()=>{
   for(const code of ['en','zh-Hans','zh-Hant','ja']){await choose(page,code);await page.reload();await settle(page,code,code);}
   await choose(page,'system');await settle(page,'system','ja');assert.equal(new URL(page.url()).searchParams.has('ui'),false);
  });
  await check('four languages at 320 390 768 1440 and zoom 2 have five unique choices and 44px targets',async()=>{
   for(const width of [320,390,768,1440])for(const code of ['en','zh-Hans','zh-Hant','ja']){
    await page.setViewportSize({width,height:1100});await choose(page,code);
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,checked:document.querySelectorAll('.ui-locale-choice input:checked').length,choices:[...document.querySelectorAll('.ui-locale-choice')].map(n=>({text:n.textContent,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,clipped:[...n.querySelectorAll('span')].some(s=>s.scrollWidth>s.clientWidth+1)}))}));
    assert.equal(metrics.overflow,false);assert.equal(metrics.checked,1);assert.equal(await page.locator('.ui-locale-current').isVisible(),true);assert.ok((await page.locator('.ui-locale-current').innerText()).length>0);assert.equal(metrics.choices.length,5);assert.ok(metrics.choices.every(x=>x.width>=44&&x.height>=44&&!x.clipped));result.layout.push({width,code,...metrics});
    if(width===320&&code==='ja'||width===1440&&code==='zh-Hant'){const file=name+'-'+width+'-'+code+'.png';await page.locator('.ui-locale-choices').scrollIntoViewIfNeeded();await page.screenshot({caret:'initial',path:path.join(output,file)});result.screenshots.push(file);}
   }
   await page.evaluate(()=>document.documentElement.style.zoom='2');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).zoom),'2');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({caret:'initial',path:path.join(output,name+'-zoom-2.png')});result.screenshots.push(name+'-zoom-2.png');await page.evaluate(()=>document.documentElement.style.zoom='');
   const radio=page.locator('.ui-locale-choice input[value="en"]');await radio.focus();await page.keyboard.press('ArrowRight');await settle(page,'zh-Hans','zh-Hans');assert.equal(await page.locator('.ui-locale-choice input:checked').inputValue(),'zh-Hans');
  });
  await check('signed-in system stores the mode and another locale context resolves independently',async()=>{
   await page.setViewportSize({width:1440,height:1100});await login(context,name+'-get219-a@example.test');await page.reload();await page.locator('.ui-locale-choice').first().waitFor();await choose(page,'system');await settle(page,'system','ja');await saved(page);
   const second=await newContext({locale:'zh-CN'});await login(second,name+'-get219-a@example.test');const other=await second.newPage();await other.goto(base+'/library?settings=appearance');await settle(other,'system','zh-Hans');assert.equal((await state(other)).preferenceSource,'account');await second.close();
  });
  await check('languagechange rereads system only and another tab cannot replace a current picker',async()=>{
   const start=result.requests.length;
   await page.evaluate(()=>{Object.defineProperty(navigator,'languages',{configurable:true,value:['zh-Hant-TW']});dispatchEvent(new Event('languagechange'));});await settle(page,'system','zh-Hant');assert.deepEqual(result.requests.slice(start).filter(r=>r.method!=='GET'),[]);
   await choose(page,'en');await saved(page);await page.evaluate(()=>{Object.defineProperty(navigator,'languages',{configurable:true,value:['ja-JP']});dispatchEvent(new Event('languagechange'));});await settle(page,'en','en');await choose(page,'system');await saved(page);
   const other=await context.newPage();await other.goto(base+'/library');await other.evaluate(()=>localStorage.setItem('leafhour.ui.locale.v1','en'));await page.waitForTimeout(100);await settle(page,'system','ja');await other.close();
  });
  await check('history root full-document and billing links never pin system',async()=>{
   await page.goto(base+'/library?settings=appearance&ui=en');await settle(page,'system','en');await choose(page,'system');await settle(page,'system','ja');
   await page.evaluate(()=>{history.pushState(null,'','/library?settings=appearance&ui=zh-Hant');dispatchEvent(new PopStateEvent('popstate'));});await settle(page,'system','zh-Hant');await page.goBack();await settle(page,'system','ja');
   await page.goto(base+'/');await page.waitForURL('**/ja');await settle(page,'system','ja');
   await page.goto(base+'/billing');await page.locator('#billing-back').waitFor();await settle(page,'system','ja');assert.equal(await page.locator('#billing-back').getAttribute('href'),'/library');
   await page.locator('#billing-back').click();await settle(page,'system','ja');
   await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await settle(page,'system','ja');
  });
  await check('storage refusal stays session-only across full document and retries saving',async()=>{
   const denied=await newContext({locale:'ja-JP'});await denied.addInitScript(()=>{if(location.protocol==='about:')return;const native=Storage.prototype.setItem;window.__get219NativeSet=native;native.call(localStorage,'leafhour.ui.locale.v1','en');Storage.prototype.setItem=function(k,v){if(this===localStorage&&k==='leafhour.ui.locale.v1')throw new DOMException('Denied','SecurityError');return native.call(this,k,v);};});
   const p=await denied.newPage();await p.goto(base+'/library?settings=appearance');await settle(p,'en','en');await choose(p,'system');assert.equal((await state(p)).persistence,'session-only');
   await p.reload();await settle(p,'system','ja');assert.equal((await state(p)).persistence,'session-only');assert.equal(await p.evaluate(async()=>(await import('/ui-locale.mjs')).uiHref('/library?ui=ja')),'/library');await p.evaluate(()=>Storage.prototype.setItem=window.__get219NativeSet);await p.locator('.ui-locale-retry').click();await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().persistence==='saved');assert.equal(await p.evaluate(()=>localStorage.getItem('leafhour.ui.locale.v1')),'system');await denied.close();
  });
  await check('reader native enhancement selection annotation scroll draft focus and composition survive language changes',async()=>{
   await page.goto(base+'/read?book=gutenberg-alice');await page.locator('#chapter-text .passage').nth(3).waitFor();await settle(page,'system','ja');
   await page.locator('#reading-tools-trigger').click();await page.locator('#open-settings').click();await page.locator('.settings-interface-section summary').click();await page.locator('#reader-ui-language [data-value="en"]').waitFor();await page.locator('#reader-ui-language [data-value="en"]').click();await settle(page,'en','en');await page.locator('#reader-ui-language [data-value="system"]').click();await settle(page,'system','ja');await page.keyboard.press('Escape');
   const passage=page.locator('#chapter-text .passage').nth(3);await passage.scrollIntoViewIfNeeded();await passage.click();
   const selection=await passage.locator('p[lang]').first().evaluate(n=>{const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);const text=walker.nextNode(),range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(15,text.length));getSelection().removeAllRanges();getSelection().addRange(range);window.__get219SelectedNode=n;return getSelection().toString();});
   assert.ok(selection.length>0);await page.evaluate(async()=>(await import('/ui-locale.mjs')).setUiLocale('en'));assert.equal(await page.evaluate(()=>getSelection().toString()),selection);assert.equal(await passage.locator('p[lang]').first().evaluate(n=>n===window.__get219SelectedNode),true);await page.evaluate(async()=>(await import('/ui-locale.mjs')).setUiLocale('system'));
   await page.locator('#show-comment').click();assert.equal(await page.locator('#note-panel').isVisible(),true);await page.locator('#panel-tab-annotations').click();assert.ok((await page.locator('#panel-content').innerText()).length>0);await page.locator('#panel-tab-comment').click();await page.locator('#thought-text').fill('未发送草稿 · 読書中 · unsent draft');await page.locator('#thought-text').focus();
   await page.evaluate(()=>{const area=document.querySelector('#thought-text');area.setSelectionRange(2,8);area.addEventListener('compositionstart',()=>window.__get219Composing=true);area.addEventListener('compositionend',()=>window.__get219Composing=false);area.dispatchEvent(new CompositionEvent('compositionstart',{data:'読'}));window.__get219={area,node:document.querySelector('#chapter-text .passage:nth-child(4)'),text:document.querySelector('#chapter-text').textContent,top:scrollY,anchor:window.marginaliaReader.getAnchor(),start:area.selectionStart,end:area.selectionEnd};});
   await page.waitForTimeout(700);const start=result.requests.length;
   for(const code of ['zh-Hant','ja','en','system'])await page.evaluate(async c=>(await import('/ui-locale.mjs')).setUiLocale(c),code);
   const actual=await page.evaluate(()=>{const b=window.__get219,a=document.querySelector('#thought-text');return {composing:window.__get219Composing,same:a===b.area,focused:document.activeElement===a,draft:a.value,start:a.selectionStart,end:a.selectionEnd,textSame:document.querySelector('#chapter-text').textContent===b.text,scrollDelta:Math.abs(scrollY-b.top),anchorSame:JSON.stringify(window.marginaliaReader.getAnchor())===JSON.stringify(b.anchor)};});
   assert.deepEqual(actual,{composing:true,same:true,focused:true,draft:'未发送草稿 · 読書中 · unsent draft',start:2,end:8,textSame:true,scrollDelta:0,anchorSame:true});
   const writes=result.requests.slice(start).filter(r=>r.method!=='GET'&&r.path!=='/api/account/ui-preferences');assert.deepEqual(writes,[]);result.languageActionWrites=writes;
   await saved(page);await page.screenshot({caret:'initial',path:path.join(output,name+'-reader-draft.png')});result.screenshots.push(name+'-reader-draft.png');
  });
  await check('account conflict is explicit and retry saves once after readback',async()=>{
   await page.goto(base+'/library?settings=appearance');await settle(page,'system','ja');let posts=0;
   await page.route('**/api/account/ui-preferences',async route=>{if(route.request().method()==='POST'&&++posts===1){expectFailure(route,{status:409,reason:'Explicit injected account CAS conflict'});return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'conflict'})});}await route.continue();});
   await choose(page,'en');await page.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().account.phase==='conflict');assert.equal((await state(page)).effective,'en');await page.locator('.ui-locale-retry').click();await saved(page);assert.equal(posts,2);await page.unroute('**/api/account/ui-preferences');
  });
  await check('failure catalogue base and retry are bounded and keep readable English',async()=>{
   const broken=await newContext({locale:'ja-JP'}),p=await broken.newPage();let imports=0;await p.route('**/ui-catalogs/ja.mjs*',route=>{imports++;expectFailure(route,{reason:'Explicit injected catalogue failure'});return route.abort('failed');});await p.goto(base+'/library?settings=appearance');await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().phase==='error');assert.equal((await state(p)).effective,'en');await p.locator('.ui-locale-retry').click();await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().offerReload);assert.equal(imports,2);assert.equal(await p.locator('.ui-locale-reload').isVisible(),true);await broken.close();result.expectedCatalogueFailures=2;
  });
  await check('failure account offline and 401 never claim saved; explicit retry recovers',async()=>{
   const isolated=await newContext({locale:'ja-JP'});await login(isolated,name+'-get219-failures@example.test');const p=await isolated.newPage();await p.goto(base+'/library?settings=appearance');await settle(p,'system','ja');await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().account.phase==='idle');
   let posts=0;await p.route('**/api/account/ui-preferences',route=>{if(route.request().method()==='POST'){posts++;expectFailure(route,{reason:'Explicit injected offline account POST'});return route.abort('internetdisconnected');}return route.continue();});await choose(p,'en');await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().account.phase==='error');assert.equal(posts,1);await p.unroute('**/api/account/ui-preferences');await p.locator('.ui-locale-retry').click();await saved(p);
   await p.route('**/api/account/ui-preferences',route=>{if(route.request().method()==='POST'){expectFailure(route,{status:401,reason:'Explicit injected unauthorized account POST'});return route.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'});}return route.continue();});await choose(p,'ja');await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().account.phase==='error');assert.equal((await state(p)).effective,'ja');await isolated.close();result.expectedAccountFailures={offlinePosts:posts,unauthorized:1};
  });
  await check('failure catalogue deadline keeps English and explicit retry loads one fixed variant',async()=>{
   const isolated=await newContext({locale:'ja-JP'}),p=await isolated.newPage();let release;const gate=new Promise(r=>release=r);let baseImports=0,retryImports=0;
   await p.route('**/ui-catalogs/ja.mjs*',async route=>{if(new URL(route.request().url()).searchParams.has('retry')){retryImports++;return route.continue();}baseImports++;await gate;try{await route.continue();}catch{}});
   await p.goto(base+'/library?settings=appearance',{waitUntil:'commit'});await p.waitForFunction(async()=>(await import('/ui-locale.mjs')).getUiLocaleState().fallbackReason==='timeout');assert.equal((await state(p)).effective,'en');await p.locator('.ui-locale-retry').click();await settle(p,'system','ja');release();assert.deepEqual([baseImports,retryImports],[1,1]);await isolated.close();result.expectedCatalogueTimeouts=1;
  });
  await check('native Aa select remains usable when its enhancement cannot load',async()=>{
   const isolated=await newContext({locale:'en-US'}),p=await isolated.newPage();await p.route('**/reader-settings-choices.mjs',route=>{expectFailure(route,{reason:'Explicit injected enhancement load failure'});return route.abort('failed');});await p.goto(base+'/read?book=gutenberg-alice');await p.locator('#chapter-text .passage').nth(3).waitFor();await p.locator('#reading-tools-trigger').click();await p.locator('#open-settings').click();await p.locator('.settings-interface-section summary').click();await p.locator('#reader-ui-choice').waitFor({state:'visible'});assert.equal(await p.locator('#reader-ui-choice option').count(),5);await p.locator('#reader-ui-choice').selectOption('ja');await settle(p,'ja','ja');await isolated.close();result.expectedEnhancementFailure=1;
  });
  await check('logout and alternate account do not reuse the previous account choice',async()=>{
   await context.request.post(base+'/api/auth/logout',{headers:{Origin:base},data:{}});await page.goto(base+'/library?settings=appearance');await settle(page,'en','en');assert.equal((await state(page)).preferenceSource,'device');
   await login(context,name+'-get219-b@example.test');await page.reload();await page.locator('.ui-locale-choice').first().waitFor();await choose(page,'zh-Hant');await saved(page);await login(context,name+'-get219-a@example.test');await page.reload();await settle(page,'en','en');assert.equal((await state(page)).preferenceSource,'account');
  });
  await context.close();await browser.close();browser=null;await Promise.all([...telemetry]);
  result.observedPages=pageCount;assert.deepEqual(result.errors,[],'unexplained browser error');
  assert.equal(baseline?.sourceVerification?.kind,'git-tree-blob-check');assert.equal(baseline.engines.find(e=>e.engine===name)?.version,result.version);
  const fingerprints=new Map();
  for(const item of baseline?.engines.find(e=>e.engine===name)?.errors||[]){const key=JSON.stringify([item.path,item.text]);fingerprints.set(key,(fingerprints.get(key)||0)+1);}
  result.baselineConsoleErrors=[];const unexplained=[];
  for(const item of result.consoleErrors){if(item.expectedInjection!==undefined)continue;const key=JSON.stringify([item.path,item.text]),remaining=fingerprints.get(key)||0;if(remaining){fingerprints.set(key,remaining-1);result.baselineConsoleErrors.push(item);}else unexplained.push(item);}
  result.baselineSource=baseline?.source??null;assert.deepEqual(unexplained,[],'unexplained console error');
 }
 report.passed=true;
}catch(error){report.passed=false;report.failure={message:error.message,stack:error.stack};for(const [i,c]of(browser?.contexts()||[]).entries())for(const [j,p]of c.pages().entries()){try{await p.screenshot({caret:'initial',path:path.join(output,'failure-'+i+'-'+j+'.png')});}catch{}}throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
