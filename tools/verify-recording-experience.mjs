import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';

const output=process.argv[2];
if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Output directory and browser module required');
await mkdir(output,{recursive:true});
const data=await mkdtemp(path.join(tmpdir(),'leafhour-recording-')),codes=new Map();
const server=await createReaderServer({bookPath:path.join(data,'missing.json'),recordsPath:path.join(data,'records.json'),portalDataDir:path.join(data,'portal'),allowLocal:false,env:{},sendCode:async(email,code)=>codes.set(email,code),companionGenerator:null,chatGenerator:null});
const report={checks:[],errors:[],limits:['Synthetic local account and public Alice; no model calls or production writes.','Chromium only; provider audio, physical devices and screen-reader speech are not exercised.']};
let browser;
const check=async(name,fn)=>{try{await fn();report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false,error:error.message});}console.log(report.checks.at(-1));};
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
 browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const email='recording-local@example.com';
 assert.equal((await context.request.post(base+'/api/auth/code',{headers:{Origin:base},data:{email,purpose:'login'}})).status(),200);
 assert.equal((await context.request.post(base+'/api/auth/verify',{headers:{Origin:base},data:{email,purpose:'login',code:codes.get(email)}})).status(),200);
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 const open=async(locale='zh-Hans')=>{await page.goto(base+'/read?book=gutenberg-alice&ui='+locale);await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.evaluate(()=>document.fonts.ready);};
 const paragraph=()=>page.locator('.passage').nth(2),tools=()=>page.locator('#paragraph-tools');
 const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const select=async()=>{await paragraph().click();await tools().waitFor({state:'visible'});};
 await open();
 await check('reading wheel dismisses paragraph tools without altering the book',async()=>{
  await select();const text=await paragraph().textContent();await page.mouse.move(1200,400);await page.mouse.wheel(0,180);await settle();
  assert.equal(await tools().isVisible(),false);assert.equal(await paragraph().textContent(),text);
 });
 await open();
 await check('programmatic paragraph layout restoration keeps its action available',async()=>{await select();await settle();assert.equal(await tools().isVisible(),true);});
 await check('Escape returns keyboard focus to the passage and closes More first',async()=>{
  await page.evaluate(()=>window.marginaliaReader.dismissTools());await paragraph().focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.querySelector('#paragraph-tools').contains(document.activeElement)),true,'Enter focuses an enabled action');
  await page.locator('#more-actions').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#paragraph-more').isVisible(),false,'Escape closes nested menu');assert.equal(await tools().isVisible(),true);
  assert.equal(await page.locator('#more-actions').evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await tools().isVisible(),false);assert.equal(await paragraph().evaluate(node=>node===document.activeElement),true);
 });
 await open();
 await check('global reading tools replace paragraph actions',async()=>{await select();await page.locator('#reading-tools-trigger').focus();await page.keyboard.press('Enter');assert.equal(await tools().isVisible(),false);});
 await open();
 await check('new drag selection dismisses old controls and preserves exact source text',async()=>{
  await select();const selected=await paragraph().evaluate(node=>{const prose=node.querySelector('p'),text=prose.firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,36);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return range.toString();});
  await page.waitForFunction(()=>document.querySelector('#paragraph-tools').dataset.excerpt==='true');
  await page.mouse.move(1200,400);await page.mouse.wheel(0,130);await settle();
  assert.equal(await tools().isVisible(),false);assert.equal(await page.evaluate(()=>getSelection().toString()),selected,'scroll dismissal preserves selected book text');
  assert.equal(await page.evaluate(()=>window.marginaliaReader.getAudioSelection()),null,'dismissed selection cannot become a later listening action');
  await page.evaluate(()=>getSelection().removeAllRanges());
 });
 await open();
 await check('reading within the selection debounce does not reopen dismissed controls',async()=>{
  await paragraph().evaluate(node=>{const text=node.querySelector('p').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,24);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.mouse.move(1200,400);await page.mouse.wheel(0,80);await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,240)));
  assert.equal(await tools().isVisible(),false);assert.equal(await page.evaluate(()=>getSelection().toString().length),24);
  await page.evaluate(()=>getSelection().removeAllRanges());
 });
 await open();
 await check('keyboard reading closes tools while Shift extension retains native selection',async()=>{
  await select();await paragraph().focus();await page.keyboard.press('PageDown');await settle();assert.equal(await tools().isVisible(),false);
  await paragraph().evaluate(node=>{const text=node.querySelector('p').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,8);getSelection().removeAllRanges();getSelection().addRange(range);});
  await page.waitForFunction(()=>document.querySelector('#paragraph-tools').dataset.excerpt==='true');
  const before=await page.evaluate(()=>getSelection().toString());await page.keyboard.press('Shift+ArrowRight');
  assert.ok((await page.evaluate(()=>getSelection().toString())).length>before.length);await page.evaluate(()=>getSelection().removeAllRanges());
 });
 for(const [width,height,locale] of [[320,700,'ja'],[390,844,'zh-Hans'],[768,1024,'zh-Hant'],[1440,900,'en']]){
  await page.setViewportSize({width,height});await open(locale);await select();
  await check(`${width}px ${locale}: base controls wrap, fit and exclude interface text from selection`,async()=>{
   const result=await tools().evaluate(node=>({wrap:getComputedStyle(node).flexWrap,userSelect:getComputedStyle(node).userSelect,rect:node.getBoundingClientRect().toJSON(),buttons:[...node.children].filter(n=>n.tagName==='BUTTON'&&!n.hidden).map(n=>n.getBoundingClientRect().toJSON()),audioCSS:!!document.querySelector('link[href*="reader-audio.css"]')}));
   assert.equal(result.wrap,'wrap');assert.equal(result.userSelect,'none');
   assert.ok(result.rect.left>=0&&result.rect.right<=width+1);
   for(const rect of result.buttons){assert.ok(rect.height>=44&&rect.width>=44,'44px action target');assert.ok(rect.left>=0&&rect.right<=width+1,'action stays inside viewport');}
   await page.screenshot({path:path.join(output,`${width}-${locale}-tools.png`)});
  });
  await check(`${width}px ${locale}: nested menu scroll does not dismiss paragraph tools`,async()=>{await page.locator('#more-actions').click();const menu=page.locator('#paragraph-more');await menu.hover();await page.mouse.wheel(0,130);await settle();assert.equal(await tools().isVisible(),true);const rect=await menu.boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=height+1);});
 }
 await page.setViewportSize({width:320,height:700});await open('ja');
 await check('320px Japanese controls work with audio styling disabled',async()=>{
  const disabled=await page.evaluate(()=>{const link=document.querySelector('link[href*="reader-audio.css"]');if(!link)return false;link.disabled=true;return true;});assert.equal(disabled,true,'the independent audio stylesheet was disabled');
  await select();const result=await tools().evaluate(node=>({wrap:getComputedStyle(node).flexWrap,buttons:[...node.children].filter(n=>n.tagName==='BUTTON'&&!n.hidden).map(n=>n.getBoundingClientRect().toJSON())}));assert.equal(result.wrap,'wrap');for(const r of result.buttons){assert.ok(r.height>=44&&r.width>=44);assert.ok(r.left>=0&&r.right<=320);}
 });
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900});await open();
  const specimen=await page.evaluate(()=>{const book=window.marginaliaReader.getBook(),p=book.sections.flatMap(section=>section.paragraphs).find(p=>p.original?.toLowerCase().includes('what is the use of a book')),chapter=book.sections.find(section=>section.paragraphs.includes(p));return {bookId:book.bookId,available:true,contentVersion:book.contentVersion,scope:{mode:'book',revision:0},context:{passageId:p.id,original:p.original,chapterTitle:chapter.title},turns:[{id:'recording-layout-fixture',status:'completed',text:'Local layout specimen: explain this source.',quote:{kind:'leafhour-reading-quote',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:chapter.chapterId,parts:[{passageId:p.id,layer:'original',start:0,end:36,text:p.original.slice(0,36)}]},answer:{summary:'Local layout specimen. No model was called.',sourceRefs:[]}}]};});
  const handler=route=>route.request().method()==='GET'?route.fulfill({json:specimen}):route.abort();
  await page.route('**/api/library/books/gutenberg-alice/chat**',handler);
  await check(`${width}px: real historical quote link returns to the source and retains an unsent draft`,async()=>{
   await page.locator('#reading-tools-trigger').focus();await page.keyboard.press('Enter');await page.locator('.library-chat-trigger').click();
   const input=page.locator('#library-chat-input');await input.fill('Keep this unsent question.');
   const link=page.locator('.library-chat-selected-snapshot .library-chat-source-link');await link.waitFor({state:'visible'});await link.scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(output,`${width}-source-return.png`)});await link.click();
   await page.waitForFunction(id=>document.activeElement?.id===id,specimen.context.passageId);
   assert.equal(await input.inputValue(),'Keep this unsent question.');
   assert.equal(await page.locator('#reader-conversation').evaluate(node=>node.open),width>=1100);
   assert.equal(await page.evaluate(()=>window.marginaliaReader.getAnchor().passageId),specimen.context.passageId);
  });
  await page.unroute('**/api/library/books/gutenberg-alice/chat**',handler);
 }
 for(const [width,locale] of [[1440,'zh-hans'],[390,'ja']]){
  await page.setViewportSize({width,height:900});await page.goto(base+'/'+locale);await page.locator('.sample-footer a').waitFor();
  await check(`${width}px ${locale}: visible sample action opens the exact real source`,async()=>{
   const link=page.locator('.sample-footer a');assert.ok((await link.textContent()).trim().length>1);const rect=await link.boundingBox();assert.ok(rect.height>=44&&rect.x+rect.width<=width);const alignment=await link.evaluate(node=>{const range=document.createRange();range.selectNode(node.firstChild);return {text:range.getBoundingClientRect().top,arrow:node.querySelector('span').getBoundingClientRect().top};});assert.ok(Math.abs(alignment.text-alignment.arrow)<3,'sample label and arrow share a line');
   await page.screenshot({path:path.join(output,`${width}-${locale}-home.png`)});await link.click();await page.waitForFunction(()=>document.body.dataset.ready==='true');
   const result=await page.evaluate(()=>{const node=document.getElementById('01b38ea4c710a84b-p00008');return {top:node.getBoundingClientRect().top,text:node.textContent};});
   assert.ok(Math.abs(result.top-160)<3,'explicit source is restored at its requested position');assert.ok(result.text.toLowerCase().includes('what is the use of a book'));
  });
 }
 await open();
 await check('hidden paragraph controls do not emit repeated selection-end events while reading',async()=>{
  await page.evaluate(()=>{window.recordingSelectionEnds=0;document.addEventListener('reader:selection-end',()=>window.recordingSelectionEnds++);});
  await page.mouse.move(300,400);await page.mouse.wheel(0,90);await settle();
  assert.equal(await page.evaluate(()=>window.recordingSelectionEnds),0);
 });
 await context.close();report.passed=report.checks.every(check=>check.passed)&&!report.errors.length;
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:report.checks.length,failed:report.checks.filter(check=>!check.passed),errors:report.errors,passed:report.passed}));
 if(!report.passed)process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
