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
  if(process.env.LEAFHOUR_NOTE_FILTER&&!new RegExp(process.env.LEAFHOUR_NOTE_FILTER).test(name))return;
  const c=await browser.newContext({viewport:{width:options.width||402,height:options.height||874},hasTouch:true,isMobile:true,reducedMotion:options.reducedMotion||'reduce'});
  await c.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)||u.startsWith('data:'))return r.continue();report.externalRequests.push(u);return r.abort();});
  const seed={size:28,layer:'interpretive',readingPosition:position,...options.saved};
  await c.addInitScript(({key,seed})=>{if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,JSON.stringify(seed));},{key,seed});
  const p=await c.newPage();p.setDefaultTimeout(Number(process.env.LEAFHOUR_BROWSER_TIMEOUT_MS) || 10000);if(options.clock)await p.clock.install({time:new Date('2026-10-27T00:00:00Z')});p.on('pageerror',e=>report.errors.push(e.message));
  try{await p.goto(base+'/prototype/');await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await fn(p);report.checks.push({name,status:'pass'});console.log('PASS',name);}
  catch(e){report.checks.push({name,status:'fail',message:e.message});console.log('FAIL',name,e.message);}
  finally{await c.close();}
}

const noteText='  这里的生活，是主动选择的日子。\n';
const noteQuote={...firstQuote,passageId:'walden-2-002',text:'日子这样珍贵，我不愿把它过成并非生活的样子；只要还没有到非如此不可的时候，我也不想认命。'};
noteQuote.endUtf16=noteQuote.text.length;
const draftKey=q=>JSON.stringify([q.passageId,q.version,q.layer,q.startUtf16,q.endUtf16,q.text]);
const seed={quote:firstQuote,draft:'第一段仍在写的问题',question:'原讨论的问题',answered:true,noteDrafts:{[draftKey(noteQuote)]:noteText}};
async function records(p){await openNavigation(p);await p.locator('#library-button').click();await settle(p);await p.locator('[data-action="records"]').click();await settle(p);}
async function selectNote(p,id='walden-2-002'){await choosePassage(p,id);await p.locator('[data-selection="note"]').click();await settle(p);}
async function save(p){await p.locator('[data-action="save-note"]').click();await settle(p);}
async function needUndo(p){assert.equal(await p.locator('[data-action="undo-note-save"]').count(),1,'Saving must offer Undo');}
try{
 await check('note-drafts-have-a-records-entry-without-a-false-empty-state',async p=>{
  await records(p);assert.equal(await p.locator('[data-note-draft]').count(),1);assert.equal(await p.locator('.empty-records').count(),0);assert.match(await p.locator('#sheet-body').innerText(),/未保存的笔记/);
  await capture(p,'22-note-drafts','22 · 从记录继续草稿');
 },{saved:seed});
 await check('records-recovery-keeps-note-source-discussion-and-refresh-continuity',async p=>{
  await records(p);assert.equal(await p.locator('[data-note-draft]').count(),1);await p.locator('[data-note-draft]').click();await settle(p);
  assert.equal(await p.locator('#note-field').inputValue(),noteText);assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');assert.equal((await snapshot(p)).draft,seed.draft);assert.match(await p.locator('#sheet-back').innerText(),/返回记录/);assert.equal(await p.locator('.context-quote').getAttribute('data-passage-id'),'walden-2-002');
  await capture(p,'23-note-draft-editor','23 · 原句与自己的草稿');
  await p.locator('#note-field').fill(noteText+'再想一想。');await p.locator('#sheet-back').click();await settle(p);assert.equal((await snapshot(p)).route,'records');
  await p.reload();await records(p);await p.locator('[data-note-draft]').click();await settle(p);assert.equal(await p.locator('#note-field').inputValue(),noteText+'再想一想。');assert.equal((await snapshot(p)).question,seed.question);
 },{saved:seed});
 await check('save-and-undo-from-records-restore-the-exact-draft-without-duplicating-notes',async p=>{
  await records(p);assert.equal(await p.locator('[data-note-draft]').count(),1);await p.locator('[data-note-draft]').click();await settle(p);await save(p);await needUndo(p);
  let s=await storage(p);assert.equal((await snapshot(p)).route,'records');assert.equal(s.notes.length,1);assert.equal(s.notes[0].author,'user');assert.equal(s.notes[0].quote.passageId,'walden-2-002');assert.equal(s.noteDrafts[draftKey(noteQuote)],'');
  await capture(p,'24-note-save-undo','24 · 保存之后可以撤销');
  await p.locator('[data-action="undo-note-save"]').click();await settle(p);s=await storage(p);assert.equal(s.notes.length,0);assert.equal(await p.locator('#note-field').inputValue(),noteText);assert.equal(s.draft,seed.draft);assert.equal(s.question,seed.question);assert.equal(s.quote.passageId,'walden-2-001');
  await p.locator('#sheet-back').click();await settle(p);assert.equal((await snapshot(p)).route,'records');assert.equal(await p.locator('[data-note-draft]').count(),1);
 },{saved:seed});
 await check('reading-origin-undo-reopens-the-note-and-keeps-reading-position',async p=>{
  const before=(await snapshot(p)).readingPosition;await selectNote(p);await p.locator('#note-field').fill(noteText);await save(p);await needUndo(p);await p.locator('#reader-sheet').waitFor({state:'hidden'});
  await p.locator('[data-action="undo-note-save"]').click();await settle(p);assert.equal(await p.locator('#note-field').inputValue(),noteText);assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');await p.locator('#sheet-done').click();await p.locator('#reader-sheet').waitFor({state:'hidden'});assert.equal((await snapshot(p)).readingPosition.passageId,before.passageId);
 },{saved:{...seed,noteDrafts:{}}});
 await check('discussion-origin-undo-preserves-its-return-frame-and-composer',async p=>{
  await openCompanion(p);await settle(p);await selectNote(p);await p.locator('#note-field').fill(noteText);await save(p);await needUndo(p);assert.equal((await snapshot(p)).route,'companion');
  await p.locator('[data-action="undo-note-save"]').click();await settle(p);assert.match(await p.locator('#sheet-back').innerText(),/返回讨论/);await p.locator('#sheet-back').click();await settle(p);let s=await snapshot(p);assert.equal(s.route,'companion');assert.equal(s.quote.passageId,'walden-2-001');assert.equal(s.draft,seed.draft);assert.equal(s.question,seed.question);
 },{saved:seed});
 await check('undo-does-not-overwrite-a-newer-draft-on-the-same-quote',async p=>{
  await selectNote(p);await p.locator('#note-field').fill(noteText);await save(p);await needUndo(p);await p.locator('#reader-sheet').waitFor({state:'hidden'});await selectNote(p);await p.locator('#note-field').fill('新的想法，不能覆盖');await p.locator('[data-action="undo-note-save"]').click();
  const s=await storage(p);assert.equal(s.notes.length,1);assert.equal(s.noteDrafts[draftKey(noteQuote)],'新的想法，不能覆盖');assert.equal(await p.locator('#note-field').inputValue(),'新的想法，不能覆盖');assert.match(await p.locator('#phone-toast').innerText(),/都已保留/);
 },{saved:seed});
 await check('consecutive-saves-undo-only-the-latest-note',async p=>{
  await selectNote(p);await p.locator('#note-field').fill('第二段保存');await save(p);await needUndo(p);await p.locator('#reader-sheet').waitFor({state:'hidden'});await selectNote(p,'walden-2-003');await p.locator('#note-field').fill('第三段保存');await save(p);await needUndo(p);await p.locator('#reader-sheet').waitFor({state:'hidden'});await p.locator('[data-action="undo-note-save"]').click();await settle(p);
  const s=await storage(p);assert.equal(s.notes.length,1);assert.equal(s.notes[0].text,'第二段保存');assert.equal(await p.locator('#note-field').inputValue(),'第三段保存');assert.equal(await p.locator('.context-quote').getAttribute('data-passage-id'),'walden-2-003');
 },{saved:seed});
 await check('undo-feedback-remains-operable-while-keyboard-focus-is-inside',async p=>{
  await selectNote(p);await p.locator('#note-field').fill(noteText);await save(p);await needUndo(p);await p.locator('#reader-sheet').waitFor({state:'hidden'});await p.locator('[data-action="undo-note-save"]').focus();await p.clock.fastForward(9000);assert.equal(await p.locator('#phone-toast').isVisible(),true);await p.locator('#reading-scroll').focus();await p.clock.fastForward(9000);assert.equal(await p.locator('#phone-toast').isVisible(),false);assert.equal((await storage(p)).notes.length,1);
 },{saved:seed,clock:true});
 await check('narrow-night-note-recovery-has-reachable-controls-and-no-overflow',async p=>{
  await records(p);assert.equal(await p.locator('[data-note-draft]').count(),1);await p.locator('[data-note-draft]').click();await settle(p);await save(p);await needUndo(p);const u=await p.locator('[data-action="undo-note-save"]').boundingBox();assert.ok(u.height>=44&&u.y+u.height<=740);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal((await storage(p)).noteDrafts.bad,'不应被清除的旧数据');
  await capture(p,'25-night-note-undo','25 · 夜读保存与撤销');
 },{saved:{...seed,size:28,theme:'night',noteDrafts:{...seed.noteDrafts,bad:'不应被清除的旧数据'}},width:320,height:740});
 await check('undo-during-the-closing-note-sheet-keeps-the-source-and-return',async p=>{
  await selectNote(p);await p.locator('#note-field').fill(noteText);await p.locator('[data-action="save-note"]').focus();await p.clock.pauseAt(new Date('2026-10-27T12:00:00Z'));await p.keyboard.press('Enter');await p.clock.runFor(32);await needUndo(p);
  const u=await p.locator('[data-action="undo-note-save"]').boundingBox();await p.mouse.click(u.x+u.width/2,u.y+u.height/2);await p.clock.resume();await settle(p);
  assert.equal((await snapshot(p)).route,'note');assert.equal((await storage(p)).notes.length,0);assert.equal(await p.locator('#note-field').inputValue(),noteText);assert.equal(await p.locator('.context-quote').getAttribute('data-passage-id'),'walden-2-002');assert.equal((await snapshot(p)).quote.passageId,'walden-2-001');
 },{saved:seed,clock:true,reducedMotion:'no-preference'});
 await check('source-validation-keeps-corrupt-drafts-stored-without-opening-a-false-quote',async p=>{
  const bad=JSON.stringify(['walden-2-002','prototype-20261026','interpretive',0,999999,'THIS IS NOT IN THE BOOK']);
  await records(p);assert.equal(await p.locator('[data-note-draft]').count(),1);assert.ok(!(await p.locator('#sheet-body').innerText()).includes('THIS IS NOT IN THE BOOK'));assert.equal((await storage(p)).noteDrafts[bad],'不能伪造出处的合成草稿');
 },{saved:{...seed,noteDrafts:{...seed.noteDrafts,[JSON.stringify(['walden-2-002','prototype-20261026','interpretive',0,999999,'THIS IS NOT IN THE BOOK'])]:'不能伪造出处的合成草稿'}}});
 await check('noncanonical-draft-key-remains-stored-without-a-broken-recovery-row',async p=>{
  const key=JSON.stringify(JSON.parse(draftKey(noteQuote)),null,2);await records(p);assert.equal(await p.locator('[data-note-draft]').count(),0);assert.equal((await storage(p)).noteDrafts[key],noteText);assert.equal((await storage(p)).noteDrafts[draftKey(noteQuote)],undefined);
 },{saved:{...seed,noteDrafts:{[JSON.stringify(JSON.parse(draftKey(noteQuote)),null,2)]:noteText}}});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.status=report.checks.every(c=>c.status==='pass')?'pass':'fail';
}finally{await fs.mkdir(root+'/evidence',{recursive:true});await fs.writeFile(root+'/evidence/'+(process.env.LEAFHOUR_NOTE_REPORT||'note-recovery-verification.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
if(report.status!=='pass')process.exitCode=1;
