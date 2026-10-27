import {choosePassage,openNavigation,openProgress,openCompanion} from './browser-interactions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {captureDOM} from '../2026-10-26-ios-half-sheet/capture-dom.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
if(!process.env.LEAFHOUR_PLAYWRIGHT_MODULE)throw Error('Set an existing Playwright module');
const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const key='leafhour-ios-half-sheet-prototype-v1';
const firstText='我来到林中，是想清醒地过日子，面对生活最要紧的事实，看看生活能教给我什么；我不想等到死时才发现，自己没有真正生活过。';
const firstQuote={passageId:'walden-2-001',text:firstText,layer:'interpretive',version:'prototype-20261026',startUtf16:0,endUtf16:firstText.length,startCodePoint:0};
const position={schema:1,bookId:'walden-public-sample',sourceVersion:'prototype-20261026',layer:'interpretive',passageId:'walden-2-002',offsetUtf16:0,fraction:0,viewportOffsetPx:8};
const server=createServer(async(req,res)=>{
  try{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name.endsWith('/')?name+'index.html':name));if(!file.startsWith(root+path.sep))throw Error('Outside prototype');const data=await fs.readFile(file);res.setHeader('Content-Type',{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
const report={at:new Date().toISOString(),checks:[],errors:[],externalRequests:[]};
const settle=async p=>p.locator('#reader-sheet[data-motion="settled"]').waitFor({state:'attached'});
const snapshot=p=>p.evaluate(()=>window.leafhourPrototype.snapshot());
const storage=p=>p.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'{}'),key);
async function capture(p,slug,name){
  await p.evaluate(()=>document.fonts.ready);
  await fs.mkdir(path.join(root,'captures'),{recursive:true});await fs.mkdir(path.join(root,'exports'),{recursive:true});
  await p.locator('#phone').screenshot({path:path.join(root,'exports',slug+'.png'),animations:'disabled'});
  await fs.writeFile(path.join(root,'captures',slug+'.json'),JSON.stringify(await p.evaluate(captureDOM,{name}),null,2));
}
async function check(name,fn,options={}){
  if(process.env.LEAFHOUR_CONTEXT_FILTER&&!new RegExp(process.env.LEAFHOUR_CONTEXT_FILTER).test(name))return;
  const c=await browser.newContext({viewport:{width:options.width||402,height:874},hasTouch:true,isMobile:true});
  await c.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)||u.startsWith('data:'))return r.continue();report.externalRequests.push(u);return r.abort();});
  const seed={size:28,layer:'interpretive',readingPosition:position,...options.saved};
  await c.addInitScript(({key,seed})=>{if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,JSON.stringify(seed));},{key,seed});
  const p=await c.newPage();p.setDefaultTimeout(Number(process.env.LEAFHOUR_BROWSER_TIMEOUT_MS) || 10000);p.on('pageerror',e=>report.errors.push(e.message));
  try{await p.goto(base+'/prototype/');await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await fn(p);report.checks.push({name,status:'pass'});console.log('PASS',name);}
  catch(e){report.checks.push({name,status:'fail',message:e.message});console.log('FAIL',name,e.message);}
  finally{await c.close();}
}
try{
  await check('fresh-entry-uses-the-logical-reading-paragraph',async p=>{
    assert.equal((await snapshot(p)).readingPosition.passageId,'walden-2-002');
    assert.equal(await p.locator('#companion-label').textContent(),'读到这里');
    await capture(p,'15-current-entry','15 · 从当前段开始');
    await openCompanion(p);await settle(p);
    assert.equal((await snapshot(p)).quote.passageId,'walden-2-002');
    await capture(p,'16-current-companion','16 · 当前段陪读');
  });
  await check('old-draft-keeps-its-source-and-the-entry-says-continue',async p=>{
    assert.equal(await p.locator('#companion-label').textContent(),'继续讨论');
    await openCompanion(p);await settle(p);
    const s=await snapshot(p);assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.draft,'保留第一段的问题');
    assert.equal(s.readingPosition.passageId,'walden-2-002');
    await capture(p,'17-existing-discussion','17 · 继续已有讨论');
  },{saved:{quote:firstQuote,draft:'保留第一段的问题'}});
  await check('explicit-current-switch-preserves-and-recovers-the-old-draft',async p=>{
    await openCompanion(p);await settle(p);await p.locator('[data-action="ask-current"]').click();await settle(p);
    let s=await snapshot(p);assert.equal(s.quote.passageId,'walden-2-002');assert.equal(s.drafts.find(d=>d.quote.passageId==='walden-2-001')?.draft,'保留第一段的问题');
    await capture(p,'18-current-with-recovery','18 · 改问当前并保留草稿');
    await p.locator('#question-input').fill('第二段的新草稿');await settle(p);await p.locator('#draft-return').click();
    s=await snapshot(p);assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.draft,'保留第一段的问题');assert.equal(s.drafts.find(d=>d.quote.passageId==='walden-2-002')?.draft,'第二段的新草稿');
  },{saved:{quote:firstQuote,draft:'保留第一段的问题'}});
  await check('an-existing-question-is-kept-in-history-with-its-original-source',async p=>{
    await openCompanion(p);await settle(p);await p.locator('[data-action="ask-current"]').click();await settle(p);
    const saved=await storage(p);const turn=saved.turns.find(t=>t.question==='第一段原有问题');
    assert.equal(turn?.quote.passageId,'walden-2-001');assert.equal(turn.answered,true);assert.equal(saved.question,'');
    await p.getByRole('button',{name:'继续读',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    await openNavigation(p);await p.locator('#library-button').click();await settle(p);await p.locator('[data-action="records"]').click();await settle(p);await p.locator('[data-record-tab="discussion"]').click();
    await p.locator('[data-turn="0"]').click();await settle(p);const s=await snapshot(p);assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.question,'第一段原有问题');
  },{saved:{quote:firstQuote,question:'第一段原有问题',answered:true}});
  await check('pending-request-is-not-completed-or-rebound-by-entry-or-switch',async p=>{
    await openCompanion(p);await settle(p);
    assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');
    await p.locator('[data-action="ask-current"]').click();await settle(p);
    const saved=await storage(p);assert.equal(saved.quote.passageId,'walden-2-002');assert.equal(saved.pendingTurn.quote.passageId,'walden-2-001');assert.equal(saved.pendingTurn.question,'尚未完成的第一段问题');assert.equal(saved.turns.length,0);
  },{saved:{quote:firstQuote,pendingTurn:{id:'pending-sample',quote:firstQuote,question:'尚未完成的第一段问题'}}});
  await check('selecting-text-alone-does-not-change-the-existing-discussion',async p=>{
    await openCompanion(p);await settle(p);await choosePassage(p,"walden-2-002");
    const s=await snapshot(p);assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.draft,'保留第一段的问题');
  },{saved:{quote:firstQuote,draft:'保留第一段的问题'}});
  await check('sending-a-new-question-keeps-the-old-pending-request-recoverable',async p=>{
    await openCompanion(p);await settle(p);await p.locator('[data-action="ask-current"]').click();await settle(p);
    await p.locator('#question-input').fill('第二段的新问题');await p.locator('#question-form').evaluate(n=>n.requestSubmit());await settle(p);
    let saved=await storage(p);const old=saved.turns.find(t=>t.id==='pending-first');
    assert.equal(old?.question,'第一段未完成的问题');assert.equal(old.quote.passageId,'walden-2-001');assert.equal(old.answered,false);
    assert.equal(saved.turns.find(t=>t.question==='第二段的新问题')?.answered,true);
    await p.getByRole('button',{name:'继续读',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    await openNavigation(p);await p.locator('#library-button').click();await settle(p);await p.locator('[data-action="records"]').click();await settle(p);await p.locator('[data-record-tab="discussion"]').click();
    const row=p.locator('[data-turn]').filter({hasText:'第一段未完成的问题'});assert.match(await row.innerText(),/未完成提问/);
    await capture(p,'20-pending-history','20 · 未完成问题单独保留');await row.click();await settle(p);
    let s=await snapshot(p);saved=await storage(p);assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.question,'第一段未完成的问题');assert.equal(saved.pendingTurn.id,'pending-first');assert.equal(saved.answered,false);assert.equal(await p.locator('.answer').count(),0);
    await capture(p,'21-pending-recovery','21 · 恢复原问题并显式重试');
    await p.reload();await openCompanion(p);await settle(p);
    assert.equal((await storage(p)).pendingTurn.id,'pending-first');assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');assert.equal(await p.locator('.answer').count(),0);
    await p.locator('[data-action="retry"]').click();assert.equal((await storage(p)).turns.find(t=>t.id==='pending-first').answered,true);assert.equal(await p.locator('.answer').count(),1);
  },{saved:{quote:firstQuote,pendingTurn:{id:'pending-first',quote:firstQuote,question:'第一段未完成的问题',answered:false}}});
  await check('offline-new-question-and-history-switch-keep-both-pending-requests',async p=>{
    await openCompanion(p);await settle(p);await p.locator('[data-action="ask-current"]').click();await settle(p);
    await p.evaluate(()=>window.leafhourPrototype.scenario('offline'));await settle(p);await p.locator('#question-input').fill('第二段也未完成的问题');await p.locator('#question-form').evaluate(n=>n.requestSubmit());await settle(p);
    let saved=await storage(p);assert.equal(saved.pendingTurn.quote.passageId,'walden-2-002');assert.equal(saved.turns.find(t=>t.id==='pending-first')?.answered,false);
    await p.getByRole('button',{name:'继续读',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    await openNavigation(p);await p.locator('#library-button').click();await settle(p);await p.locator('[data-action="records"]').click();await settle(p);await p.locator('[data-record-tab="discussion"]').click();
    await p.locator('[data-turn]').filter({hasText:'第一段未完成的问题'}).click();await settle(p);
    saved=await storage(p);assert.equal(saved.pendingTurn.id,'pending-first');assert.equal(saved.pendingTurn.quote.passageId,'walden-2-001');assert.equal(saved.turns.find(t=>t.question==='第二段也未完成的问题')?.answered,false);assert.equal(saved.answered,false);
  },{saved:{quote:firstQuote,pendingTurn:{id:'pending-first',quote:firstQuote,question:'第一段未完成的问题',answered:false}}});
  await check('completed-history-trimming-does-not-discard-an-unfinished-request',async p=>{
    await openCompanion(p);await settle(p);await p.locator('#question-input').fill('新的已完成问题');await p.locator('#question-form').evaluate(n=>n.requestSubmit());await settle(p);
    const saved=await storage(p);assert.equal(saved.turns.find(t=>t.id==='parked-pending')?.answered,false);assert.equal(saved.turns.filter(t=>t.answered!==false).length,6);
  },{saved:{quote:firstQuote,discussionStarted:true,turns:[{id:'parked-pending',quote:firstQuote,question:'仍未完成',answered:false},...Array.from({length:5},(_,i)=>({id:'completed-'+i,quote:firstQuote,question:'合成旧问题 '+i,answered:true}))]}});
  await check('a-new-offline-question-does-not-inherit-the-previous-answer-status',async p=>{
    await openCompanion(p);await settle(p);await p.evaluate(()=>window.leafhourPrototype.scenario('offline'));await settle(p);
    await p.locator('#question-input').fill('同一句新提交但未完成的问题');await p.locator('#question-form').evaluate(n=>n.requestSubmit());await settle(p);
    const saved=await storage(p);assert.equal(saved.pendingTurn.question,'同一句新提交但未完成的问题');assert.equal(saved.answered,false);assert.equal(await p.locator('.answer').count(),0);
  },{saved:{quote:firstQuote,question:'上一条已完成的问题',answered:true,turns:[{id:'answered-first',quote:firstQuote,question:'上一条已完成的问题',answered:true}]}});
  await check('an-explicit-word-explanation-survives-close-and-reentry-without-typed-text',async p=>{
    await p.locator('#walden-2-002 .passage-text').evaluate(n=>{const range=document.createRange();range.setStart(n.firstChild,0);range.setEnd(n.firstChild,6);const s=getSelection();s.removeAllRanges();s.addRange(range);});
    await p.locator('#reading-scroll').focus();await p.keyboard.press('Shift+F10');await p.locator('#selection-menu').waitFor();await p.getByRole('button',{name:'解释这句',exact:true}).click();await settle(p);
    await p.getByRole('button',{name:'继续读',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    await openNavigation(p);await p.locator('#contents-button').click();await settle(p);await p.locator('[data-jump="walden-2-003"]').click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    await p.reload();await openCompanion(p);await settle(p);
    const s=await snapshot(p);assert.equal(s.quote.passageId,'walden-2-002');assert.equal(s.quote.startUtf16,0);assert.equal(s.quote.endUtf16,6);assert.equal(s.question,'');
  });
  await check('reading-layer-identity-stays-visible-and-is-separate-from-old-discussion',async p=>{
    await openNavigation(p);assert.equal(await p.locator('#nav-version').innerText(),'示例意译');
    await p.locator('#appearance-button').click();await settle(p);await p.getByRole('button',{name:'原文',exact:true}).click();await p.getByRole('button',{name:'完成',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    await openNavigation(p);assert.equal(await p.locator('#nav-version').innerText(),'作者原文 · 节选');
    await openCompanion(p);await settle(p);assert.equal((await snapshot(p)).quote.layer,'interpretive');
    assert.match(await p.locator('[data-context-label]').innerText(),/示例意译/);
    await capture(p,'19-layer-identity','19 · 阅读层与讨论层各自清楚');
    await p.locator('[data-action="ask-current"]').click();await settle(p);assert.equal((await snapshot(p)).quote.layer,'source');
  },{saved:{quote:firstQuote,draft:'保留第一段的问题'}});
  await check('background-reading-refreshes-only-chrome-not-answer-scroll-or-draft',async p=>{
    await openCompanion(p);await settle(p);await p.locator('#question-input').fill('继续保留草稿');await settle(p);await p.locator('#sheet-grip').press('Enter');await settle(p);
    const before=await p.locator('#sheet-body').evaluate(n=>{n.scrollTop=40;return n.scrollTop;});
    await p.locator('#reading-scroll').evaluate(n=>{n.scrollTop=document.getElementById('walden-2-003').offsetTop-24;});
    await p.waitForFunction(()=>window.leafhourPrototype.snapshot().readingPosition.passageId==='walden-2-003');
    assert.equal(await p.locator('#sheet-body').evaluate(n=>n.scrollTop),before);assert.equal(await p.locator('#question-input').inputValue(),'继续保留草稿');assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');
  },{saved:{quote:firstQuote,question:'第一段原有问题',answered:true}});
  await check('narrow-night-context-switch-remains-reachable',async p=>{
    await openCompanion(p);await settle(p);const button=p.locator('[data-action="ask-current"]');const b=await button.boundingBox();assert.ok(b.width>=44&&b.height>=44);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await button.click();await settle(p);assert.equal((await snapshot(p)).quote.passageId,'walden-2-002');
  },{width:320,saved:{theme:'night',quote:firstQuote,draft:'保留第一段的问题'}});
  await check('a-different-paragraph-note-keeps-the-chat-scope-and-does-not-feed-note-text-back',async p=>{
    await openCompanion(p);await settle(p);await choosePassage(p,"walden-2-002");await p.locator('[data-selection="note"]').click();await settle(p);
    await p.locator('#note-field').fill('仅属于笔记的合成文字');await p.locator('[data-action="save-note"]').click();await settle(p);
    const s=await snapshot(p),saved=await storage(p);assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.question,'第一段原有问题');assert.equal(s.draft,'保留第一段的问题');
    assert.equal(saved.notes[0].quote.passageId,'walden-2-002');assert.equal(saved.notes[0].author,'user');assert.ok(!(await p.locator('#sheet-body').innerText()).includes('仅属于笔记的合成文字'));
  },{saved:{quote:firstQuote,question:'第一段原有问题',answered:true,draft:'保留第一段的问题'}});
  await check('changing-note-target-keeps-the-original-discussion-return-frame',async p=>{
    await openCompanion(p);await settle(p);
    await choosePassage(p,"walden-2-002");await p.locator('[data-selection="note"]').click();await settle(p);
    await p.locator('#note-field').fill('第二段的笔记草稿');
    await p.locator('#sheet-grip').press('Enter');await settle(p);
    await choosePassage(p,"walden-2-003");await p.locator('[data-selection="note"]').click();await settle(p);
    await p.locator('#note-field').fill('第三段的合成笔记');await p.getByRole('button',{name:'保存',exact:true}).click();await settle(p);
    const s=await snapshot(p);assert.equal(s.route,'companion');assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.draft,'原讨论的草稿');
    const saved=await storage(p);assert.equal(saved.notes[0].quote.passageId,'walden-2-003');assert.ok(Object.values(saved.noteDrafts).includes('第二段的笔记草稿'));
  },{saved:{quote:firstQuote,draft:'原讨论的草稿'}});
  await check('a-source-preview-keeps-the-existing-question-and-draft',async p=>{
    await choosePassage(p,"walden-2-002");await p.getByRole('button',{name:'看原文',exact:true}).click();await settle(p);
    assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');
    await p.getByRole('button',{name:'完成',exact:true}).click();await p.locator('#reader-sheet').waitFor({state:'hidden'});
    const s=await snapshot(p);assert.equal(s.question,'第一段原有问题');assert.equal(s.draft,'保留第一段的问题');
  },{saved:{quote:firstQuote,question:'第一段原有问题',answered:true,draft:'保留第一段的问题'}});
  await check('a-note-started-from-reading-returns-to-reading',async p=>{
    await choosePassage(p,"walden-2-002");await p.getByRole('button',{name:'记一句',exact:true}).click();await settle(p);
    await p.locator('#note-field').fill('独立笔记');await p.locator('[data-action="save-note"]').click();await settle(p);
    assert.equal((await snapshot(p)).route,'closed');assert.equal((await storage(p)).notes[0].quote.passageId,'walden-2-002');
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status=report.checks.every(c=>c.status==='pass')?'pass':'fail';
}finally{
  await fs.mkdir(path.join(root,'evidence'),{recursive:true});await fs.writeFile(path.join(root,'evidence',process.env.LEAFHOUR_CONTEXT_REPORT||'companion-context-verification.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));
}
if(report.status!=='pass')process.exitCode=1;
