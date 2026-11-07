// Synthetic input + native DOM Selection in the actual built reader. This is
// deliberately not evidence of a trusted iOS long press or physical handles.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createReaderServer} from '../server/server.mjs';
import {chapterHash} from '../app/offline-book-codec.mjs';
const output=process.argv[2];
if(!output||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Output path and browser module required');
await mkdir(path.join(output,'data'),{recursive:true});
const original='The 🌱 grows slowly. A second sentence remains.',translation='幼苗慢慢长大。第二句话仍在。';
const paragraphs=Array.from({length:10},(_,i)=>({id:'fixture-p'+i,kind:'body',original:i===0?original:i===1?'Literal **user Markdown** stays literal. Another sentence.':original.repeat(6),translations:{literal:{text:translation,status:'draft'},interpretive:{text:translation,status:'draft'}},annotationIds:[],termIds:[]}));
const book={bookId:'touch-fixture',contentVersion:'fixture-v1',visibility:'private',title:{en:'Synthetic selection fixture',zh:'合成选区夹具'},author:'Test fixture',sourceLanguage:'en',targetLanguage:'zh',source:{format:'txt'},chapters:[{id:'fixture-c',number:1,title:{en:'Test chapter',zh:'测试章节'},sectionNumbers:[1]}],sections:[{number:1,chapterId:'fixture-c',paragraphs}],annotations:[],glossary:[]};
book.readingCache={schemaVersion:1,snapshotId:'fixture-snapshot',chapters:{'fixture-c':await chapterHash({bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'fixture-c',sections:book.sections})}};book.reading={loadedChapters:['fixture-c']};
const bookPath=path.join(output,'data/book.json');await writeFile(bookPath,JSON.stringify(book));
const server=await createReaderServer({bookPath,recordsPath:path.join(output,'data/records.json'),portalDataDir:path.join(output,'data/portal'),env:{},allowLocal:false,compiledWeb:true,companionGenerator:null,chatGenerator:null});
const report={cases:[],errors:[],limits:['Synthetic touch events and real DOM Selection in desktop Chromium.','No account created: mocked isolated identity and data APIs. No provider calls or production data.','Trusted iOS long press, physical handles and VoiceOver remain unverified.']};
const record=message=>{report.cases.push(message);console.log(message);};
let browser,activePage;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),requests=[];report.requests=requests;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==base){report.errors.push('External request: '+url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,method:request.method()});let value={};
  if(url.pathname==='/api/account/ui-preferences')value={revision:0,updatedAt:null,uiLocale:null};
  else if(url.pathname==='/api/auth/session')value={user:{id:'synthetic-touch-owner',email:'fixture@example.invalid'}};
  else if((url.pathname==='/api/book'||url.pathname.endsWith('/reading')||url.pathname.endsWith('/reading-manifest')))value=book;
  else if(url.pathname.endsWith('/records'))value={bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],highlights:[],position:null};
  else if(url.pathname==='/api/library/books')value={books:[{bookId:book.bookId,title:book.title,contentVersion:book.contentVersion}]};
  else if(url.pathname.endsWith('/chat'))value={bookId:book.bookId,available:true,contentVersion:book.contentVersion,scope:{mode:'book',revision:0},context:{passageId:'fixture-p0',original},turns:[]};
  else if(url.pathname.endsWith('/companion'))value={enabled:false,revision:1,contentVersion:book.contentVersion};
  else if(url.pathname==='/api/library/reading-guide'&&request.postDataJSON()?.action==='view')value={state:'unknown'};
  else if(request.method()==='POST'&&/chat|translat|generat|annotation|guide|introduc/.test(url.pathname)){report.errors.push('Unexpected generation/write: '+url.pathname);return route.abort();}
  return route.fulfill({json:value});
 });
 const page=await context.newPage();activePage=page;page.on('pageerror',error=>report.errors.push(error.message));page.on('response',response=>{if(response.status()>=400)report.errors.push(response.status()+' '+new URL(response.url()).pathname);});page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 if(process.env.LEAFHOUR_SELECTION_DEBUG){const debug=await context.newCDPSession(page);report.caught=[];await debug.send('Debugger.enable');await debug.send('Debugger.setPauseOnExceptions',{state:'all'});debug.on('Debugger.paused',async event=>{report.caught.push({description:event.data?.description,frames:event.callFrames.slice(0,3).map(f=>({functionName:f.functionName,url:f.url,line:f.location.lineNumber}))});await debug.send('Debugger.resume');});}
 const ready=async()=>{await page.goto(base+'/read?book=touch-fixture&ui=en');await page.waitForFunction(()=>document.body.dataset.ready==='true',{},{timeout:15000}).catch(async error=>{await writeFile(path.join(output,'failed-page.html'),await page.content());await page.screenshot({path:path.join(output,'failure.png')});report.failedPage={url:page.url(),body:await page.locator('body').innerText()};throw error;});await page.selectOption('#view-mode','en',{force:true});await page.locator('#fixture-p0').scrollIntoViewIfNeeded();};
 const event=async(type,options={})=>page.evaluate(({type,options})=>{
  const prose=document.querySelector('#fixture-p0 p[data-reading-layer]');let rect=prose.getBoundingClientRect();
  if(options.offset!==undefined){const point=document.createRange();point.setStart(prose.firstChild,options.offset);point.setEnd(prose.firstChild,options.offset+1);rect=point.getBoundingClientRect();}
  const touches=type==='touchend'?[]:[new Touch({identifier:0,target:prose,clientX:rect.x+20,clientY:rect.y+20+(options.move||0)})];
  prose.dispatchEvent(new TouchEvent(type,{bubbles:true,touches,targetTouches:touches,changedTouches:touches}));
 },{type,options});
 const range=async(start,end,{last=0}={})=>page.evaluate(({start,end,last})=>{
  const find=(id,offset)=>{const root=document.querySelector('#fixture-p'+id+' p[data-reading-layer]'),walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){if(offset<=node.length)return {node,offset};offset-=node.length;}throw Error('offset outside fixture');};
  const a=find(0,start),z=find(last,end);document.getSelection().setBaseAndExtent(a.node,a.offset,z.node,z.offset);
 },{start,end,last});
 const hold=async(start=7,end=12,{clear=true,offset}={})=>{if(clear)await page.evaluate(()=>getSelection().removeAllRanges());await event('touchstart',{offset});await page.waitForTimeout(400);await range(start,end);await page.waitForTimeout(220);await event('touchend');await page.locator('#touch-selection-actions').waitFor({state:'visible'});};
 const excerpt=()=>page.evaluate(()=>window.marginaliaReader.getExcerpt());
 await ready();
 await page.locator('#fixture-p0 p').tap();assert.equal(await page.locator('#paragraph-tools').isVisible(),false);record('ordinary touch tap stays quiet');
 await event('touchstart');await event('touchmove',{move:40});await page.waitForTimeout(400);await range(7,12);await page.waitForTimeout(200);assert.equal(await page.locator('#paragraph-tools').isVisible(),false);record('scroll intent cannot expand or open tools from a late selection');
 await hold();assert.equal((await excerpt()).parts[0].text,'The 🌱 grows slowly.');assert.equal(await page.locator('#paragraph-tools button:visible').count(),3);record('first held native range expands to sentence; exactly three touch actions');
 await page.screenshot({path:path.join(output,'390-three-actions.png')});
 await range(7,12);await page.waitForTimeout(200);assert.equal((await excerpt()).parts[0].text,'grows');record('subsequent selection adjustment is not snapped back');
 await page.evaluate(()=>window.marginaliaReader.dismissTools());await event('touchstart');await event('touchmove',{move:40});await page.evaluate(()=>document.dispatchEvent(new Event('selectionchange')));await page.waitForTimeout(200);assert.equal(await page.locator('#paragraph-tools').isVisible(),false);record('scrolling with retained native text cannot reopen stale tools');
 await hold(23,29,{clear:false,offset:23});assert.equal((await excerpt()).parts[0].text,'A second sentence remains.');record('fresh hold elsewhere expands even with an old retained native range');
 await hold();await range(7,12);await page.waitForTimeout(200);await page.evaluate(()=>window.marginaliaReader.dismissTools());await hold();assert.equal((await excerpt()).parts[0].text,'The 🌱 grows slowly.');record('deselect and reselect identical word starts a new sentence selection');
 await range(7,12);await page.waitForTimeout(200);
 const before=await excerpt(),scroll=await page.evaluate(()=>scrollY),prose=await page.locator('#fixture-p0').textContent();
 await page.locator('#selection-view-original').click();await page.locator('#selection-original').waitFor({state:'visible'});assert.equal(await page.locator('#selection-original-content blockquote').textContent(),'grows');await page.locator('[data-close-dialog=selection-original]').click();assert.equal(await page.locator('#fixture-p0').textContent(),prose);assert.deepEqual(await excerpt(),before);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scroll)<2);record('source inspection keeps original slice, prose, snapshot and scroll');
 await hold();await range(7,20,{last:1});await page.waitForTimeout(200);assert.equal((await excerpt()).parts.length,2);record('native cross-passage adjustment preserves both stable passage IDs');
 await hold();await page.locator('#selection-note').click();await page.locator('#thought-text').fill('My **literal** draft 🌱');await page.locator('#close-panel').click();await hold();await page.locator('#selection-note').click();assert.equal(await page.locator('#thought-text').inputValue(),'My **literal** draft 🌱');await page.locator('#close-panel').click();record('note action reuses and restores the scoped draft');
 await hold();await page.locator('#selection-explain').click();await page.locator('#reader-conversation').waitFor({state:'visible'});assert.equal(await page.locator('#library-chat-input').inputValue(),'Please explain this passage.');assert.equal(await page.locator('.library-chat-quote-text').textContent(),'The 🌱 grows slowly.');assert.equal(requests.some(r=>r.method==='POST'&&/chat|translat|generat|annotation|introduc/.test(r.path)),false);record('Explain opens the real quoted conversation with an unsent prompt');
 await page.locator('#library-chat-input').fill('Keep my existing question.');await page.locator('.library-chat-close').click();await hold();await page.locator('#selection-explain').click();assert.equal(await page.locator('#library-chat-input').inputValue(),'Keep my existing question.');await page.locator('.library-chat-close').click();record('Explain preserves an existing unsent chat draft');
 await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.selectOption('#view-mode','en',{force:true});await page.locator('#fixture-p0').scrollIntoViewIfNeeded();await hold();await page.locator('#selection-note').click();assert.equal(await page.locator('#thought-text').inputValue(),'My **literal** draft 🌱');record('note draft survives document reload');
 await page.locator('#close-panel').click();await page.selectOption('#view-mode','zh',{force:true});await hold(1,3);await page.locator('#selection-view-original').click();assert.equal(await page.locator('#selection-original-content blockquote').textContent(),original);assert.equal(await page.locator('#selection-original-content p').textContent(),'Original · corresponding passage');await page.locator('[data-close-dialog=selection-original]').click();record('translated source inspection labels full corresponding original without character alignment');
 await page.setViewportSize({width:320,height:700});await page.selectOption('#view-mode','en',{force:true});await page.locator('#fixture-p0').scrollIntoViewIfNeeded();await hold();let bounds=await page.locator('#paragraph-tools').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=321);assert.equal(await page.locator('#paragraph-tools button:visible').count(),3);await page.screenshot({path:path.join(output,'320-three-actions.png')});record('320px touch toolbar remains inside viewport');
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#fixture-p0').click();await range(7,12);await page.waitForTimeout(220);assert.equal((await excerpt()).parts[0].text,'grows');assert.equal(await page.locator('#touch-selection-actions').isVisible(),false);assert.ok(await page.locator('#paragraph-tools button:visible').count()>3);record('desktop mouse selection retains exact user range and legacy tools');
 await page.evaluate(()=>{getSelection().removeAllRanges();window.marginaliaReader.dismissTools();});await page.locator('#fixture-p0').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#paragraph-tools').isVisible(),true);assert.equal(await page.evaluate(()=>document.querySelector('#paragraph-tools').contains(document.activeElement)),true);record('keyboard passage activation still hands focus to the toolbar');
 await context.close();
 assert.deepEqual(report.errors,[]);report.requests=requests;
}catch(error){report.failure=String(error);if(activePage){await writeFile(path.join(output,'failed-page.html'),await activePage.content());await activePage.screenshot({path:path.join(output,'failure.png')});report.failedPage={url:activePage.url(),body:await activePage.locator('body').innerText()};}throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
