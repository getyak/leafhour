// Actual reader + isolated synthetic accounts and public-domain Alice. No model jobs.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readerWriteKind,compareReaderConsole} from './reader-verification-evidence.mjs';
const output=process.argv[2],root=process.env.LEAFHOUR_SOURCE_ROOT||process.cwd(),publicBuild=process.env.LEAFHOUR_PUBLIC_BUILD;
if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Registered output and existing Playwright module required');
await mkdir(output,{recursive:true});
const {createReaderServer}=await import(pathToFileURL(path.join(root,'server/server.mjs')));
const engines=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const codes=new Map(),server=await createReaderServer({bookPath:path.join(output,'absent.json'),recordsPath:path.join(output,'data/records.json'),portalDataDir:path.join(output,'data/portal'),env:{},allowLocal:false,sendCode:async(email,code)=>codes.set(email,code),chatGenerator:null,companionGenerator:null});
const baseline=process.argv.includes('--baseline'),boundary=process.argv.includes('--boundary-only'),report={kind:'GET-231 actual local reader',baseline,cases:[],limits:['Synthetic isolated identities, public-domain book; separate from Production acceptance.']};
const consoleBaseline=process.env.LEAFHOUR_CONSOLE_BASELINE?JSON.parse(await readFile(process.env.LEAFHOUR_CONSOLE_BASELINE,'utf8')):null;
let browser,context;
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(item,name,value)=>{item.checks[name]=value;if(!baseline)assert.equal(value,true,name);};
const contrast=([r,g,b])=>{const c=[r,g,b].map(v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
const ready=page=>page.waitForFunction(()=>document.body.dataset.ready==='true');
async function showTools(page){if(await page.evaluate(()=>document.body.dataset.readingTools!=='open')){await page.locator('#reading-tools-trigger').focus();await page.keyboard.press('Enter');}await page.waitForFunction(()=>document.body.dataset.readingTools==='open');}
async function hideTools(page){if(await page.evaluate(()=>document.body.dataset.readingTools==='open'))await page.locator('#reading-tools-close').click();await page.waitForFunction(()=>document.body.dataset.readingTools==='closed');}
async function dockLayouts(page,item){
 item.dockLayouts=[];
 for(const state of ['audio','notice','audio-and-notice']){
  await page.evaluate(state=>{document.body.classList.toggle('has-audio',state.includes('audio'));if(state.includes('audio'))document.body.style.setProperty('--audio-player-clearance','160px');const notice=document.createElement('p');notice.id='get231-layout-notice';notice.className='translation-notice';notice.textContent='Translation unavailable. Retry when ready.';notice.hidden=!state.includes('notice');document.querySelector('#reading-session').append(notice);},state);
  await page.locator('#reading-tools-panel').evaluate(async n=>{getComputedStyle(n).height;await Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const geometry=await page.locator('#open-reader-account').evaluate(n=>{const r=n.getBoundingClientRect(),header=document.querySelector('#reading-header').getBoundingClientRect(),panel=document.querySelector('#reading-tools-panel').getBoundingClientRect();return {account:r.toJSON(),header:header.toJSON(),panel:panel.toJSON(),hit:[[.5,.05],[.95,.5],[.5,.95],[.05,.5],[.15,.15],[.85,.15],[.15,.85],[.85,.85],[.5,.5]].every(([x,y])=>n.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)))};});
  item.dockLayouts.push({state,kind:'synthetic layout class/notice on real reader CSS, no audio/translation provider',...geometry});if(!geometry.hit)await page.screenshot({path:path.join(output,item.engine+'-'+state+'-obscured.png')});
  await page.evaluate(()=>{document.querySelector('#get231-layout-notice')?.remove();document.body.classList.remove('has-audio');document.body.style.removeProperty('--audio-player-clearance');});
 }
 for(const row of item.dockLayouts)check(item,'accountReachable-'+row.state,row.hit);
}
async function settledScroll(page){return page.evaluate(()=>new Promise((resolve,reject)=>{let last=scrollY,since=performance.now();const start=since;function sample(now){if(scrollY!==last){last=scrollY;since=now;}if(now-since>=120){resolve(last);return;}if(now-start>3000){reject(Error('Reader scroll did not settle'));return;}requestAnimationFrame(sample);}requestAnimationFrame(sample);}));}
async function exerciseBoundaries(page,item,context,base){
 const url=base+'/read?book=gutenberg-alice&ui='+item.locale;
 let mode='hold';const held=[];
 await page.route('**/assets/atmospheres/*.jpg*',route=>{if(mode==='hold'){held.push(route);return;}if(mode==='error')return route.fulfill({status:404,body:'Image unavailable'});return route.continue();});
 await page.reload();await ready(page);await showTools(page);await page.locator('#open-atmosphere').click();
 check(item,'artworkLoadingVisible',await page.locator('.atmosphere-choice[data-image-state=loading] .atmosphere-image-status:visible').count()===4);
 mode='error';await Promise.all(held.map(route=>route.fulfill({status:404,body:'Image unavailable'})));
 await page.waitForFunction(()=>[...document.querySelectorAll('.atmosphere-choice img')].every(n=>n.complete));
 check(item,'artworkFailureVisible',await page.locator('.atmosphere-choice[data-image-state=error] .atmosphere-image-status:visible').count()===4);
 await page.locator('#atmosphere-dialog').evaluate(async n=>{getComputedStyle(n).opacity;await Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:path.join(output,item.engine+'-'+item.width+'-'+(item.zoom||1)+'-image-error.png')});
 mode='ready';for(const retry of await page.locator('.atmosphere-image-retry').all())await retry.click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.atmosphere-choice img')].every(n=>n.complete&&n.naturalWidth>0));
 check(item,'artworkRetryRestored',await page.locator('.atmosphere-choice[data-image-state=ready]').count()===4&&await page.locator('.atmosphere-image-retry:visible').count()===0);
 check(item,'imageRetryDoesNotChooseScene',await page.locator('#atmosphere-none').getAttribute('aria-pressed')==='true');
 await page.locator('.atmosphere-choice').first().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.documentElement.dataset.atmosphere==='forest');
 await page.locator('#atmosphere-none').focus();await page.keyboard.press('Enter');check(item,'keyboardSceneSelection',await page.locator('#atmosphere-none').getAttribute('aria-pressed')==='true');
 await page.keyboard.press('Escape');await showTools(page);await page.locator('#open-settings').click();await page.locator('#settings-tab-sound').click();
 check(item,'settingsQuietPlayHidden',await page.locator('#settings-atmosphere-toggle').isHidden());check(item,'settingsQuietPromptHidden',await page.locator('#settings-atmosphere-status').isHidden());await page.keyboard.press('Escape');await hideTools(page);
 // Actual Thought composer; never submit the synthetic draft.
 const passage=page.locator('#chapter-text .passage').nth(1);await passage.click();await page.locator('#show-comment').click();
 const draft=page.locator('#panel-content textarea');await draft.fill('GET-231 unsent local thought');check(item,'thoughtHasNoGeneratedId',await page.locator('#panel-anchor').isHidden());
 await showTools(page);item.thoughtArrival={initialY:await page.evaluate(()=>scrollY),inline:await page.locator('#note-panel').evaluate(n=>n.classList.contains('is-inline')),settledY:await settledScroll(page)};const before=await page.evaluate(()=>({id:window.marginaliaReader.getSelectedId(),anchor:window.marginaliaReader.getAnchor()?.passageId,y:scrollY}));
 item.thoughtSteps=[];const thoughtStep=async name=>item.thoughtSteps.push({name,...await page.evaluate(()=>({y:scrollY,active:document.activeElement?.id,dialog:document.querySelector('#reader-account')?.getBoundingClientRect().toJSON(),position:document.querySelector('#reader-account')?getComputedStyle(document.querySelector('#reader-account')).position:null,buttons:[...document.querySelectorAll('#reader-account button,#reader-account a')].map(n=>({id:n.id,hidden:n.hidden,disabled:n.disabled,rects:n.getClientRects().length,tab:n.tabIndex})),scrollTarget:document.scrollingElement?.tagName}))});await thoughtStep('before-open');await page.locator('#open-reader-account').click();await page.locator('#reader-account[open]').waitFor();await thoughtStep('after-open');await page.keyboard.press('Tab');await thoughtStep('after-tab');await page.keyboard.press('Shift+Tab');await thoughtStep('after-shift-tab');await page.keyboard.press('Escape');await thoughtStep('after-escape');
 await settledScroll(page);const after=await page.evaluate(()=>({id:window.marginaliaReader.getSelectedId(),anchor:window.marginaliaReader.getAnchor()?.passageId,y:scrollY}));
 item.thoughtPreservation={before,after,draft:await draft.inputValue()};check(item,'accountPreservesThought',JSON.stringify(before)===JSON.stringify(after)&&item.thoughtPreservation.draft==='GET-231 unsent local thought');
 for(let i=0;i<5;i++){await page.locator('#open-reader-account').tap();await page.locator('#reader-account[open]').waitFor();await page.mouse.click(2,2);await page.waitForFunction(()=>!document.querySelector('#reader-account').open);}
 check(item,'accountOutsideClose',await page.locator('#open-reader-account').evaluate(n=>n===document.activeElement));
 await hideTools(page);await page.locator('#close-panel').click();await passage.scrollIntoViewIfNeeded();
 await settledScroll(page);
 const geometry=await passage.evaluate(node=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(text.textContent.trim().length<40||text.parentElement.closest('button,a,summary'))continue;const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(35,text.length));for(const r of range.getClientRects())if(r.width>60&&r.top>=8&&r.bottom<innerHeight-20)return {x:r.left+3,end:Math.min(r.right-3,r.left+120),y:r.top+r.height/2};}return null;});
 check(item,'visibleSelectableText',!!geometry);item.selectionGeometry=geometry;item.selectionHit=await page.evaluate(({x,y})=>{const n=document.elementFromPoint(x,y);return {tag:n?.tagName,id:n?.id,cls:n?.className,userSelect:n?getComputedStyle(n).userSelect:null,webkitUserSelect:n?getComputedStyle(n).webkitUserSelect:null};},geometry);await page.mouse.move(geometry.x,geometry.y);await page.mouse.down();await page.evaluate(()=>new Promise(requestAnimationFrame));await page.mouse.move(geometry.end,geometry.y,{steps:12});await page.mouse.up();item.selectionAfterDrag=await page.evaluate(()=>({length:document.getSelection().toString().length,excerpt:window.marginaliaReader.getExcerpt(),active:document.activeElement?.id}));await showTools(page);
 const selection=await page.evaluate(()=>document.getSelection().toString());item.selectionAfterTools=await page.evaluate(()=>({length:document.getSelection().toString().length,excerpt:window.marginaliaReader.getExcerpt()}));
 check(item,'nativeTextSelection',item.selectionAfterDrag.length>0);check(item,'typedSelectionRetained',!!item.selectionAfterTools.excerpt&&JSON.stringify(item.selectionAfterTools.excerpt)===JSON.stringify(item.selectionAfterDrag.excerpt));
 await page.locator('#open-reader-account').click();await page.locator('#reader-account[open]').waitFor();await page.keyboard.press('Escape');
 const afterMenuSelection=await page.evaluate(()=>({native:document.getSelection().toString(),excerpt:window.marginaliaReader.getExcerpt()}));check(item,'accountPreservesSelection',JSON.stringify(afterMenuSelection.excerpt)===JSON.stringify(item.selectionAfterTools.excerpt)&&(!selection.length||afterMenuSelection.native===selection));
 // Stale captured owner must not revoke the current cookie's account.
 const current=(await (await context.request.get(base+'/api/auth/session')).json()).user;
 const stale=await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-Reader-Owner':'different-owner'},data:{}});
 check(item,'staleLogoutRejected',stale.status()===409&&stale.headers()['x-reader-session-changed']==='1'&&!stale.headers()['set-cookie']);
 check(item,'staleLogoutPreservesIdentity',(await (await context.request.get(base+'/api/auth/session')).json()).user.id===current.id);
 // Delay the actual optional module, then activate newer book information.
 const race=await context.newPage();let release;const gate=new Promise(resolve=>{release=resolve;});
 await race.route('**/reader-account.mjs*',async route=>{await gate;await route.continue();});await race.goto(url);await ready(race);await showTools(race);await race.locator('#open-reader-account').click();await race.locator('#open-book-info').click();release();
 await race.waitForFunction(()=>!document.querySelector('#open-reader-account').hasAttribute('aria-busy'));
 check(item,'lateAccountDoesNotReplaceBookInfo',await race.locator('#book-info').evaluate(n=>n.hasAttribute('data-popover-open'))&&await race.locator('#reader-account[open]').count()===0);await race.close();
 // A failed module request has one explicit retry, with a fresh module URL.
 const retryPage=await context.newPage();let attempts=0;const requested=[];
 await retryPage.route('**/reader-account.mjs*',route=>{requested.push(new URL(route.request().url()).search);return attempts++===0?route.abort('failed'):route.continue();});await retryPage.goto(url);await ready(retryPage);await showTools(retryPage);await retryPage.locator('#open-reader-account').click();await retryPage.waitForFunction(()=>!document.querySelector('#open-reader-account').hasAttribute('aria-busy'));await retryPage.locator('#open-reader-account').click();await retryPage.locator('#reader-account[open]').waitFor();
 check(item,'accountModuleExplicitRetry',attempts===2&&requested[1]==='?retry=1');await retryPage.close();
 // A failed logout remains in the reader; only explicit confirmation exits.
 let logoutRequests=0;await page.route('**/api/auth/logout',route=>{logoutRequests++;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});});
 await page.locator('#open-reader-account').click();await page.locator('#reader-account[open]').waitFor();await page.locator('#reader-account-logout').click();await page.locator('#reader-account-cancel').click();check(item,'cancelDoesNotLogout',logoutRequests===0);await page.locator('#reader-account-logout').click();await page.locator('#reader-account-logout').click();await page.waitForFunction(()=>document.querySelector('#reader-account-status').textContent.length>0);
 check(item,'logoutFailureRetainsReader',logoutRequests===1&&await page.locator('#reader-account').evaluate(n=>n.open)&&new URL(page.url()).pathname==='/read');await page.locator('#reader-account').evaluate(async n=>{getComputedStyle(n).opacity;await Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:path.join(output,item.engine+'-'+item.width+'-'+(item.zoom||1)+'-account.png')});await page.keyboard.press('Escape');await page.unroute('**/api/auth/logout');
 await page.locator('#open-reader-account').click();await page.locator('#reader-account-logout').click();await page.locator('#reader-account-logout').click();await page.waitForURL('**/library*');
 check(item,'explicitLogoutConfirmed',(await (await context.request.get(base+'/api/auth/session')).json()).user===null);
 await page.goto(url);await ready(page);await showTools(page);await page.locator('#open-reader-account').tap();await page.locator('#reader-account[open]').waitFor();
 const href=await page.locator('#reader-account-login').getAttribute('href');check(item,'anonymousAccountReturn',await page.locator('#reader-account-logout').isHidden()&&href.includes('next=')&&decodeURIComponent(href).includes('book=gutenberg-alice'));
 check(item,'anonymousNoOverflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.keyboard.press('Escape');
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 for(const engine of (process.env.LEAFHOUR_BROWSER_ENGINES||'chromium,webkit').split(',')){
  const executablePath=process.env[engine==='webkit'?'LEAFHOUR_WEBKIT_EXECUTABLE':'LEAFHOUR_CHROMIUM_EXECUTABLE'];browser=await engines[engine].launch({headless:true,...(executablePath?{executablePath}:{})});
  const cases=baseline?[{width:1280,locale:'en',theme:'paper',scene:'none'},...['forest','rain','hearth','sea'].flatMap(scene=>['paper','night'].map(theme=>({width:1280,locale:'en',theme,scene})))]:boundary?[{width:1280,locale:'en',theme:'paper',scene:'none'},{width:320,locale:'ja',theme:'night',scene:'none'},{width:1280,locale:'en',theme:'paper',scene:'none',zoom:2}]:[...[1280,390,320].flatMap(width=>['en','zh-Hans','zh-Hant','ja'].flatMap(locale=>['paper','night'].map(theme=>({width,locale,theme,scene:'none'})))),...['forest','rain','hearth','sea'].flatMap(scene=>['paper','night'].map(theme=>({width:1280,locale:'en',theme,scene})))];
  for(const spec of cases.filter(spec=>(!process.argv.includes('--matrix-only')||spec.scene==='none')&&(!process.argv.includes('--scenes-only')||spec.scene!=='none')&&(!process.argv.includes('--smoke-only')||spec.width===1280&&spec.locale==='en'&&spec.theme==='paper'&&spec.scene==='none')&&(!process.argv.includes('--zoom-only')||spec.zoom===2)&&(!process.argv.includes('--narrow-only')||spec.width===320)&&(!process.argv.includes('--desktop-only')||spec.width===1280&&!spec.zoom))){
   const item={engine,version:browser.version(),...spec,checks:{},errors:[],consoleErrors:[],writes:[]};report.cases.push(item);
   context=await browser.newContext({viewport:{width:spec.width/(spec.zoom||1),height:800/(spec.zoom||1)},deviceScaleFactor:spec.zoom||1,hasTouch:true});
   context.setDefaultTimeout(10000);
   if(publicBuild)await context.route('**/*',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/read'){const response=await route.fetch();return route.fulfill({response,body:await readFile(path.join(publicBuild,'read.html'))});}
    if(/^\/reader-web\/(?:reader|style)-[a-f0-9]{16}\.(?:js|css)$/.test(pathname))return route.fulfill({status:200,contentType:pathname.endsWith('.css')?'text/css':'text/javascript',body:await readFile(path.join(publicBuild,pathname))});
    return route.continue();
   });
   const email='get231-'+engine+'-'+report.cases.length+'@example.test';
   assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
   assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
   const page=await context.newPage();page.on('pageerror',error=>item.errors.push(error.message));page.on('console',message=>{if(message.type()==='error'){const location=message.location();let path=null;try{path=new URL(location.url).pathname;}catch{}item.consoleErrors.push({text:message.text(),path,line:location.lineNumber});}});
   await page.addInitScript(()=>{
    const rows=new Map(),owners=new WeakMap(),add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
    const key=(type,options)=>type+':'+!!(options===true||options?.capture);
    EventTarget.prototype.addEventListener=function(type,fn,options){if(!rows.has(this))rows.set(this,new Map());const map=rows.get(this),k=key(type,options);if(!map.has(k))map.set(k,new Set());map.get(k).add(fn);if(typeof fn==='function')owners.set(fn,/(?:reader-account\.mjs|reader-atmosphere\.js|\/reader\.js)(?:\?retry=1)?:/.test(new Error().stack));return add.call(this,type,fn,options);};
    EventTarget.prototype.removeEventListener=function(type,fn,options){rows.get(this)?.get(key(type,options))?.delete(fn);return remove.call(this,type,fn,options);};
    const timers=new Set(),intervals=new Set(),frames=new Set(),set=window.setTimeout,clear=window.clearTimeout,repeat=window.setInterval,stop=window.clearInterval,frame=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
    window.setTimeout=(fn,ms,...args)=>{let id;id=set(()=>{timers.delete(id);fn(...args);},ms);timers.add(id);return id;};window.clearTimeout=id=>{timers.delete(id);clear(id);};
    window.setInterval=(fn,ms,...args)=>{const id=repeat(fn,ms,...args);intervals.add(id);return id;};window.clearInterval=id=>{intervals.delete(id);stop(id);};
    window.requestAnimationFrame=fn=>{let id;id=frame(time=>{frames.delete(id);fn(time);});frames.add(id);return id;};window.cancelAnimationFrame=id=>{frames.delete(id);cancel(id);};
    window.cleanupProbe=()=>({ownedListeners:[...rows].filter(([n])=>typeof n.matches==='function'&&n.matches('#open-reader-account,#reader-account,#reader-account button,.atmosphere-choice img,.atmosphere-image-retry')).reduce((sum,[,map])=>sum+[...map.values()].reduce((n,set)=>n+[...set].filter(fn=>owners.get(fn)).length,0),0),timers:timers.size,intervals:intervals.size,frames:frames.size});
   });
   page.on('request',request=>{if(request.method()==='POST')item.writes.push(new URL(request.url()).pathname);});
   item.builtRequests=[];if(publicBuild)page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/reader-web/')||p==='/reader-account.mjs')item.builtRequests.push(p);});
   await page.goto(base+'/read?book=gutenberg-alice&ui='+spec.locale+'&atmosphere='+spec.scene);await page.waitForFunction(()=>document.body.dataset.ready==='true');
   await page.evaluate(async theme=>{document.documentElement.dataset.theme=theme;await Promise.all(document.body.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));},spec.theme);
   await page.locator('#reading-tools-trigger').click();await page.locator('#open-atmosphere').click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.atmosphere-choice img')].every(i=>i.complete&&i.naturalWidth>0));
   item.images=await page.locator('.atmosphere-choice img').evaluateAll(nodes=>nodes.map(n=>({complete:n.complete,width:n.naturalWidth,height:n.getBoundingClientRect().height})));
   check(item,'imagesLoaded',item.images.length===4&&item.images.every(i=>i.width>0&&i.height>0));
   check(item,'soundVisibility',(await page.locator('.atmosphere-sound').isHidden())===(spec.scene==='none'));
   check(item,'playVisibility',(await page.locator('#atmosphere-play').isHidden())===(spec.scene==='none'));
   check(item,'promptVisibility',(await page.locator('#atmosphere-status').isHidden())===(spec.scene==='none'));
   await page.locator('#atmosphere-dialog').evaluate(async n=>{getComputedStyle(n).opacity;await Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
   await page.screenshot({path:path.join(output,engine+'-'+spec.width+'-'+spec.locale+'-'+spec.theme+'-atmosphere.png')});
   await page.keyboard.press('Escape');await hideTools(page);
   const mark=page.locator('[data-mark-chapter]').first();await mark.scrollIntoViewIfNeeded();
   item.markStyle=await mark.evaluate(node=>{const s=getComputedStyle(node);const rgba=value=>(value.match(/[\d.]+/g)||[]).map(Number);let out=[255,255,255];const ancestors=[];for(let n=node;n;n=n.parentElement)ancestors.push(n);for(const n of ancestors.reverse()){const c=rgba(getComputedStyle(n).backgroundColor),a=c[3]??1;if(c.length>=3)out=out.map((v,i)=>c[i]*a+v*(1-a));}return {color:s.color,background:out,opacity:s.opacity,computedBackground:s.backgroundColor};});
   const rgb=value=>value.startsWith('#')?value.slice(1).match(/../g).map(v=>parseInt(v,16)):value.match(/[\d.]+/g).slice(0,3).map(Number);
   const l=[contrast(rgb(item.markStyle.color)),contrast(item.markStyle.background)].sort((a,b)=>b-a);item.markContrast=(l[0]+.05)/(l[1]+.05);
   check(item,'markContrast',item.markContrast>=4.5&&item.markStyle.opacity==='1');
   const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('milestones')).catch(error=>({error}));await mark.focus();await page.keyboard.press('Enter');const receipt=await saved;if(receipt.error)throw receipt.error;
   await page.waitForFunction(()=>document.querySelector('[data-mark-chapter]')?.disabled===false);
   check(item,'markState',await mark.getAttribute('aria-pressed')==='true');item.markFocus=await mark.evaluate(n=>({focused:n===document.activeElement,active:document.activeElement?.id}));check(item,'markKeyboardFocus',item.markFocus.focused);
   await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');
   check(item,'markReload',await page.locator('[data-mark-chapter]').first().getAttribute('aria-pressed')==='true');
   await page.locator('#reading-tools-trigger').click();
   check(item,'headerLocation',await page.locator('#running-progress').count()===1&&await page.locator('#running-progress').isVisible());
   await page.evaluate(async()=>{const nodes=[document.querySelector('#reading-tools-panel'),document.querySelector('#reading-header')];for(const n of nodes)getComputedStyle(n).transform;await Promise.all(nodes.flatMap(n=>n.getAnimations({subtree:true})).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   check(item,'accountEntry',await page.locator('#open-reader-account').count()===1);
   item.backBounds=await page.locator('.reader-navigation>a').boundingBox();check(item,'backTarget44',item.backBounds.width>=44&&item.backBounds.height>=44);
   if(await page.locator('#open-reader-account').count()){item.accountTarget=await page.locator('#open-reader-account').evaluate(n=>{const r=n.getBoundingClientRect();return {rect:r.toJSON(),radius:getComputedStyle(n).borderRadius,cornerOwner:document.elementFromPoint(r.x+r.width*.05,r.y+r.height*.05)?.tagName,centerHit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),centerOwner:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300),headerPointer:getComputedStyle(n.closest('header')).pointerEvents,inner:innerWidth,svgBoxes:[...document.querySelectorAll('.reader-navigation svg')].map(s=>({rect:s.getBoundingClientRect().toJSON(),owner:s.parentElement.id||s.parentElement.tagName,position:getComputedStyle(s).position,width:getComputedStyle(s).width,height:getComputedStyle(s).height,pointer:getComputedStyle(s).pointerEvents}))};});const hit=await page.locator('#open-reader-account').evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44&&[[.5,.05],[.95,.5],[.5,.95],[.05,.5],[.15,.15],[.85,.15],[.15,.85],[.85,.85],[.5,.5]].every(([x,y])=>n.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)));});if(!hit)await page.screenshot({path:path.join(output,'account-obscured.png')});check(item,'accountHitArea',hit);}
   if(await page.locator('#open-reader-account').count()){
    const before=await page.evaluate(()=>({anchor:window.marginaliaReader.getAnchor(),y:scrollY}));
    await page.locator('#open-reader-account').tap();await page.locator('#reader-account[open]').waitFor();
    check(item,'accountCloseSingleLine',await page.locator('#reader-account-close').evaluate(n=>{const s=getComputedStyle(n);return s.whiteSpace==='nowrap'&&n.scrollHeight<=Math.max(parseFloat(s.minHeight)||0,parseFloat(s.lineHeight)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom))+1;}));
    check(item,'accountIdentity',(await page.locator('#reader-account-email').textContent())===email);
    check(item,'oneOverlay',await page.locator('dialog[open]').count()===1);
    await page.keyboard.press('Escape');
    check(item,'accountFocus',await page.locator('#open-reader-account').evaluate(n=>n===document.activeElement));
    const after=await page.evaluate(()=>({anchor:window.marginaliaReader.getAnchor(),y:scrollY}));check(item,'accountAnchor',before.y===after.y&&before.anchor?.passageId===after.anchor?.passageId);
   }
   check(item,'noHorizontalOverflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(spec.zoom)await dockLayouts(page,item);
   if(boundary&&!process.argv.includes('--layout-only'))await exerciseBoundaries(page,item,context,base);
   check(item,'noModelRequests',!item.writes.some(p=>readerWriteKind(p)==='model'));check(item,'onlyExplicitChapterRecord',item.writes.filter(p=>readerWriteKind(p)==='reading-record').every(p=>p.endsWith('/reading-milestones')));
   check(item,'noPageErrors',item.errors.length===0);if(publicBuild)check(item,'builtBundleAndLazyAccount',item.builtRequests.some(p=>p.endsWith('.js'))&&item.builtRequests.some(p=>p.endsWith('.css'))&&item.builtRequests.includes('/reader-account.mjs'));if(!baseline&&!boundary){item.console=compareReaderConsole({baseline:consoleBaseline,engine,version:item.version,errors:item.consoleErrors});check(item,'noNewConsoleErrors',item.console.verified&&item.console.newErrors.length===0);}
   item.unmount=await page.evaluate(async()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));await new Promise(resolve=>requestAnimationFrame(resolve));return {event:'synthetic non-persisted pagehide on actual reader',...window.cleanupProbe()};});
   check(item,'ownedListenersReleased',item.unmount.ownedListeners===0);
   item.passed=Object.values(item.checks).every(Boolean);console.log(JSON.stringify({engine,...spec,passed:item.passed,contrast:item.markContrast}));
   await context.close();context=null;await save();
  }
  await browser.close();browser=null;
 }
}catch(error){report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await context?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await save();}
