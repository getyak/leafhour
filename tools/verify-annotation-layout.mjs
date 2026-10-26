// Public Alice + synthetic saved annotations. All page API writes are blocked.
// Production mode verifies a separately supplied in-memory authenticated context;
// credentials are never read by this reusable verifier or saved with evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

export async function verifyAnnotationLayout({browser,contextFactory,base,dist,out,matrix,baseline=false}){
 const report={at:new Date().toISOString(),baseline,packaged:!!dist,cases:[],limits:['Public-domain Alice with synthetic annotation GET fixtures; no saved-note, progress or model write.','Browser input and reduced viewport checks do not establish physical-device, OS keyboard or screen-reader acceptance.']};
 await fs.mkdir(out,{recursive:true});
 const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const rect=el=>el.getBoundingClientRect().toJSON();
 const inside=(r,w,h)=>assert.ok(r.x>=-1&&r.y>=-1&&r.right<=w+1&&r.bottom<=h+1,JSON.stringify({r,w,h}));
 const openTools=async p=>{if(await p.evaluate(()=>document.body.dataset.readingTools!=='open')){await p.locator('#reading-tools-trigger').focus();await p.keyboard.press('Enter');}};
 for(const [locale,width,height,theme='paper',scale=1]of matrix){
  const row={locale,width,height,theme,scale,checks:[],errors:[],blockedWrites:[]};report.cases.push(row);
  const context=await contextFactory({viewport:{width,height},hasTouch:width<400,reducedMotion:width<400?'reduce':'no-preference'});context.setDefaultTimeout(15000);
  let book,failAnnotations=false;
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.origin!==base)return route.abort();
   if(u.pathname.startsWith('/api/')){
    if(req.method()!=='GET'){row.blockedWrites.push(u.pathname);return route.fulfill({status:403,json:{error:'Read-only GET-223 verification'}});}
    if(u.pathname.endsWith('/reading')){const response=await route.fetch();book=await response.json();return route.fulfill({response,json:book});}
    if(u.pathname.endsWith('/annotations')&&book){
     if(failAnnotations){return route.fulfill({status:503,json:{error:'Synthetic annotation outage'}});}
     const section=book.sections.find(s=>s.paragraphs.some(p=>p.original&&!p.unloaded)),paragraphs=section.paragraphs.filter(p=>p.original&&!p.unloaded);
     const threads=Array.from({length:15},(_,i)=>{const p=paragraphs[Math.floor(i/3)%paragraphs.length],text=p.original.slice(0,40);return {id:'get223-note-'+i,quote:{kind:'leafhour-reading-quote',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:section.chapterId,parts:[{passageId:p.id,layer:'original',start:0,end:text.length,text}]},messages:[{id:'get223-message-'+i,origin:'ai',body:'Synthetic GET-223 annotation '+i+'. '+('A readable thought about Alice. '.repeat(120))+' END OF ANNOTATION '+i,provenance:{source:'external-agent',label:'Layout fixture'}}]};});
     return route.fulfill({status:200,json:{archive:{kind:'leafhour-reader-annotations',bookId:book.bookId,threads},requests:[]}});
    }
    if(u.pathname.endsWith('/chat')){const response=await route.fetch(),data=await response.json();data.available=true;data.turns=[];return route.fulfill({response,json:data});}
    return route.continue();
   }
   if(!dist)return route.continue();
   const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));assert.ok(file.startsWith(dist+path.sep));return route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'});
  });
  const p=await context.newPage();p.on('pageerror',e=>row.errors.push(e.message));
  const card=p.locator('#reader-annotation-card'),scroll=p.locator('.reader-annotation-scroll'),chat=p.locator('#reader-conversation');
  async function checkCard(label){
   await settle(p);const r=await card.evaluate(rect);inside(r,(await p.viewportSize()).width,(await p.viewportSize()).height);row[label]={rect:r,placement:await card.getAttribute('data-placement')};
   await scroll.evaluate(n=>{n.scrollTop=n.scrollHeight;});await settle(p);
   const end=await scroll.evaluate(n=>({top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight,overflow:n.scrollWidth>n.clientWidth+1}));assert.ok(end.top>0&&end.top+end.height>=end.total-2);assert.equal(end.overflow,false);
   await p.locator('.reader-annotation-message').last().evaluate(n=>n.scrollIntoView({block:'end'}));
   const tail=await p.locator('.reader-annotation-message').last().evaluate(n=>{const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let last;while(walker.nextNode())last=walker.currentNode;const range=document.createRange();range.setStart(last,Math.max(0,last.length-20));range.setEnd(last,last.length);const r=range.getBoundingClientRect(),s=n.closest('.reader-annotation-scroll').getBoundingClientRect();return {text:range.toString(),top:r.top,bottom:r.bottom,visibleTop:s.top,visibleBottom:s.bottom};});
   assert.ok(tail.text.includes('ANNOTATION'));assert.ok(tail.top>=tail.visibleTop-1&&tail.bottom<=tail.visibleBottom+1,'the final annotation text is reachable and visible');await scroll.evaluate(n=>{n.scrollTop=0;});return r;
  }
  try{
   await p.goto(base+'/read?book=gutenberg-alice&ui='+locale);await p.waitForFunction(()=>document.body.dataset.ready==='true'&&document.body.dataset.annotationsState==='ready');
   await p.evaluate(theme=>window.marginaliaPaletteAdapter.appearance.setTheme(theme),theme);await p.evaluate(()=>document.fonts.ready);
   await openTools(p);if(await p.locator('#reader-annotations-toggle').getAttribute('aria-pressed')!=='true')await p.locator('#reader-annotations-toggle').click();await p.locator('#reading-tools-close').click();await p.evaluate(()=>scrollTo(0,0));await settle(p);
   const marks=p.locator('.reader-annotation-summary:visible');await marks.first().waitFor();row.marks=await marks.evaluateAll(nodes=>nodes.map(n=>({side:n.dataset.side,rect:n.getBoundingClientRect().toJSON()})));
   if(!baseline&&width<1400)assert.ok(row.marks.every(n=>n.side==='compact'));
   for(const n of row.marks)assert.ok(n.rect.left>=0&&n.rect.right<=width+1);
   await marks.first().focus();await p.keyboard.press('Enter');await card.waitFor();
   if(scale>1)await p.evaluate(scale=>{const nodes=[...document.querySelectorAll('#reader-annotation-card *')].map(n=>[n,parseFloat(getComputedStyle(n).fontSize)]);for(const [n,size]of nodes)n.style.fontSize=size*scale+'px';},scale);
   await checkCard('annotation');await p.screenshot({path:out+`/${locale}-${width}-${height}-annotation.png`});
   const thought='Unsent isolated GET-223 thought';await p.locator('#reader-annotation-followup').fill(thought);
   await p.locator('.reader-annotation-next').click();assert.ok((await card.innerText()).includes('annotation 1.'));await p.locator('.reader-annotation-previous').click();assert.equal(await p.locator('#reader-annotation-followup').inputValue(),thought);
   row.checks.push('compact-marks-and-keyboard-open; header-and-edges-in-viewport; long-body-and-bottom-actions-scroll; neighbor-list-and-draft-retained');
   await openTools(p);await p.locator('.library-chat-trigger').click();await chat.locator('.library-chat-empty').waitFor();await settle(p);
   const r=await checkCard('withChat'),c=await chat.evaluate(rect);
   if(width>=1100)assert.ok(r.right<=c.left||r.left>=c.right||r.bottom<=c.top||r.top>=c.bottom,'annotation and chat must not overlap');
   else{assert.equal(await card.getAttribute('data-placement'),'chat');assert.equal(await card.evaluate(n=>!!n.closest('dialog[open]')&&!n.inert&&!n.closest('[inert]')),true);inside(r,width,height);assert.ok(r.bottom<= (await p.locator('.library-chat-messages').evaluate(rect)).top+1);}
   await p.screenshot({path:out+`/${locale}-${width}-${height}-with-chat.png`});
   if(width<1100){await p.locator('#library-chat-input').focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#reader-conversation')),true);await p.locator('.reader-annotation-close').focus();await p.keyboard.press('Shift+Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#reader-conversation')),true);}
   if(width===1280){
    for(const w of [1600,1280]){await p.setViewportSize({width:w,height});await settle(p);await checkCard('resize'+w);const sides=await marks.evaluateAll(ns=>ns.map(n=>n.dataset.side));assert.ok(sides.every(side=>w<1400?side==='compact':side!=='compact'));}
    const separator=p.locator('.reader-chat-separator');await separator.focus();await p.keyboard.press('End');await settle(p);const a=await checkCard('maximumChatWidth'),b=await chat.evaluate(rect);assert.ok(a.right<=b.left-1);await separator.focus();await p.keyboard.press('Home');
    await p.locator('#reader-annotation-followup').focus();await p.setViewportSize({width:640,height:400});await settle(p);await checkCard('browserZoomEquivalent');assert.equal(await p.evaluate(()=>document.activeElement.id),'reader-annotation-followup');await p.setViewportSize({width,height});await settle(p);assert.equal(await p.evaluate(()=>document.activeElement.id),'reader-annotation-followup');row.checks.push('editing-focus-retained-across-both-mobile-desktop-reparents');
   }
   row.checks.push('Ask-AI-coexists-with-readable-scrollable-annotation; responsive-reparenting-and-resizer; focus-remains-in-mobile-dialog');
   await p.locator('.library-chat-close').click();await settle(p);assert.equal(await card.isVisible(),true);assert.notEqual(await card.getAttribute('data-placement'),'chat');assert.equal(await p.locator('#reader-annotation-followup').inputValue(),thought);
   await p.locator('#reader-annotation-followup').focus();await p.keyboard.press('Escape');assert.equal(await card.isVisible(),false);assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('reader-annotation-summary')),true);
   // A GET failure must remain recoverable through existing reading tools.
   if(width===1280){failAnnotations=true;await p.reload();await p.waitForFunction(()=>document.body.dataset.annotationsState==='error');await openTools(p);await p.waitForFunction(()=>!!document.querySelector('.reader-annotation-load-status').textContent);failAnnotations=false;await p.locator('#reader-annotations-toggle').click();await p.waitForFunction(()=>document.body.dataset.annotationsState==='ready');row.checks.push('annotation-load-error-stays-visible-and-retry-recovers');}
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(row.errors,[]);row.checks.push('chat-close-returns-annotation-with-draft; Escape-returns-to-mark; no-horizontal-overflow-or-page-error');row.passed=true;
  }catch(error){row.failure=error.message;await p.screenshot({path:out+`/${locale}-${width}-${height}-failure.png`});throw error;}
  finally{await context.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
 }
 report.passed=true;await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const out=process.argv[2],dist=process.env.LEAFHOUR_VERIFY_DIST;if(!out||!dist||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Registered artifact, packaged assets and installed browser runtime required');
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));let browser;
 const server=await createReaderServer({bookPath:out+'/missing.json',recordsPath:out+'/records.json',portalDataDir:out+'/portal',env:{},allowLocal:true,chatGenerator:null,companionGenerator:null,introductionGenerator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE});const report=await verifyAnnotationLayout({browser,base,dist,out,matrix:process.argv.includes('--smoke')?[['en',1280,800]]:[['en',1280,800],['zh-Hans',390,844,'night'],['zh-Hant',320,740,'paper',2],['ja',800,390,'night']],contextFactory:async options=>{const context=await browser.newContext(options);const auth=await context.request.post(base+'/api/auth/local',{data:{},headers:{Origin:base}});assert.equal(auth.ok(),true);assert.ok((await auth.json()).user.id);return context;}});console.log(JSON.stringify({passed:report.passed,cases:report.cases.length}));}
 finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
