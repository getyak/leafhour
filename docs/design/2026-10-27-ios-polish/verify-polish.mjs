import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.LEAFHOUR_PLAYWRIGHT_MODULE) throw Error('Set an existing Playwright module');
const {chromium} = await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
    if (!file.startsWith(root + path.sep)) throw Error('Outside prototype');
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
const report = {at:new Date().toISOString(),checks:[],errors:[],externalRequests:[]};
const settle = async p => p.locator('#reader-sheet[data-motion="settled"]').waitFor({state:'attached'});
const y = p => p.locator('#reader-sheet').evaluate(n => new DOMMatrix(getComputedStyle(n).transform).m42);
async function half(p) {
  await p.getByRole('button',{name:'读到这里',exact:true}).click();
  await settle(p);
}
async function check(name, fn, options={}) {
  if(process.env.LEAFHOUR_POLISH_FILTER && !new RegExp(process.env.LEAFHOUR_POLISH_FILTER).test(name)) return;
  const {controlledClock=false,...contextOptions}=options;
  const context = await browser.newContext({viewport:{width:402,height:874},hasTouch:true,isMobile:true,...contextOptions});
  await context.route('**/*',route => {
    const url=route.request().url();
    if(url.startsWith(base)||url.startsWith('data:')) return route.continue();
    report.externalRequests.push(url);return route.abort();
  });
  const p=await context.newPage();p.setDefaultTimeout(Number(process.env.LEAFHOUR_BROWSER_TIMEOUT_MS) || 30000);
  if(controlledClock) await p.clock.install({time:new Date('2026-10-27T00:00:00Z')});
  p.on('pageerror',e=>report.errors.push(e.message));
  try {await p.goto(base+'/prototype/',{waitUntil:'domcontentloaded',timeout:90000});await fn(p);report.checks.push({name,status:'pass'});console.log('PASS',name);}
  catch(e){report.checks.push({name,status:'fail',message:e.message});console.log('FAIL',name,e.message);}
  finally {await context.close();}
}
try {
  await check('handle-has-a-44-pixel-touch-target',async p => {
    await half(p);const b=await p.locator('#sheet-grip').boundingBox();
    assert.ok(b.height>=44 && b.width>=44,'The handle must remain easy to grab');
  });
  await check('scrim-changes-continuously-during-an-upward-drag',async p => {
    await half(p);const b=await p.locator('#sheet-grip').boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2-120,{steps:4});
    const opacity=await p.locator('#sheet-scrim').evaluate(n=>n.hidden?0:Number(getComputedStyle(n).opacity));
    assert.ok(opacity>0 && opacity<1,'The scrim should be partway visible before reaching full height');
    await p.mouse.up();
  });
  await check('holding-the-sheet-still-clears-stale-flick-velocity',async p => {
    await half(p);const b=await p.locator('#sheet-grip').boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2+70,{steps:2});
    await p.waitForTimeout(180); // Deliberate pause is the interaction being tested.
    await p.mouse.up();await settle(p);
    const s=await p.evaluate(()=>window.leafhourPrototype.snapshot());
    assert.equal(s.route,'companion');assert.equal(s.detent,'half');
  });
  await check('a-moving-sheet-can-be-grabbed-and-reversed-without-a-jump',async p => {
    await half(p);
    const b=await p.locator('#sheet-grip').boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2);
    await p.mouse.click(b.x+b.width/2,b.y+b.height/2);
    await p.mouse.down();
    assert.ok(await p.locator('#sheet-grip').evaluate(n=>n.hasPointerCapture(1)), 'the driver must actually grab the moving handle');
    const before=await y(p);
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2+35,{steps:1});
    assert.ok(Math.abs((await y(p))-before-35)<1.5);
    await p.mouse.up();await settle(p);
  });
  await check('pointer-cancellation-restores-the-detent-without-dismissing',async p => {
    await half(p);const b=await p.locator('#sheet-grip').boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2+80);
    await p.locator('#sheet-grip').dispatchEvent('pointercancel',{pointerId:1});
    await p.mouse.up();await settle(p);
    const s=await p.evaluate(()=>window.leafhourPrototype.snapshot());
    assert.equal(s.route,'companion');assert.equal(s.detent,'half');
  });
  await check('reduced-motion-keeps-the-handle-operable-without-a-running-spring',async p => {
    await half(p);await p.locator('#sheet-grip').press('Enter');await settle(p);
    assert.equal(await y(p),0);
    await p.getByRole('button',{name:'继续读',exact:true}).click();
    await p.locator('#reader-sheet').waitFor({state:'hidden'});
  },{reducedMotion:'reduce'});
  await check('selection-tools-follow-the-selected-paragraph-and-stay-in-bounds',async p => {
    await p.locator('[data-quote="walden-2-001"]').click();
    const first=await p.locator('#selection-menu').boundingBox();
    await p.locator('[data-quote="walden-2-002"]').click();
    const second=await p.locator('#selection-menu').boundingBox();
    assert.ok(Math.abs(second.y-first.y)>40,'Tools must follow their source rather than keep a fixed screen position');
    const phone=await p.locator('#phone').boundingBox();
    assert.ok(second.x>=phone.x+15 && second.x+second.width<=phone.x+phone.width-15);
  });
  await check('confirming-a-quote-clears-the-temporary-paragraph-highlight',async p => {
    await p.locator('[data-quote="walden-2-001"]').click();
    await p.getByRole('button',{name:'解释这句',exact:true}).click();await settle(p);
    const highlighted=await p.locator('#walden-2-001 .passage-text').evaluate(n=>{
      const c=getComputedStyle(n).backgroundColor;
      return c!=='rgba(0, 0, 0, 0)' && c!=='transparent';
    });
    assert.equal(highlighted,false);
  });
  await check('scrolling-keeps-visible-selection-tools-attached-to-the-source',async p => {
    await p.locator('[data-quote="walden-2-001"]').click();
    const initial=await p.locator('#selection-menu').evaluate(n=>n.offsetTop);
    await p.locator('#reading-scroll').evaluate(n=>{n.scrollTop+=60;});
    await p.waitForFunction(initial=>document.getElementById('selection-menu').offsetTop<initial-40,initial);
  });
  await check('scrolling-the-selection-out-of-view-dismisses-its-tools',async p => {
    await p.getByRole('button',{name:'排版设置',exact:true}).click();await settle(p);
    for(let i=0;i<6;i++) await p.getByRole('button',{name:'增大字号',exact:true}).click();
    await p.getByRole('button',{name:'完成',exact:true}).click();await settle(p);
    await p.locator('[data-quote="walden-2-001"]').click();
    await p.locator('#reading-scroll').evaluate(n=>{n.scrollTop=n.scrollHeight;});
    const isOutside=await p.locator('#walden-2-001 .passage-text').evaluate(n=>n.getBoundingClientRect().bottom<document.getElementById('reader-nav').getBoundingClientRect().bottom+8);
    assert.ok(isOutside,'The test must actually move the selected text outside the exposed reading area');
    await p.locator('#selection-menu').waitFor({state:'hidden'});
  });
  await check('a-closing-sheet-can-be-grabbed-and-cancelled-with-its-draft',async p => {
    await half(p);await p.locator('#question-input').fill('关闭中也保留这份草稿');await settle(p);
    await p.locator('#sheet-grip').press('Enter');await settle(p);
    await p.clock.pauseAt(new Date('2026-10-27T12:00:00Z'));
    await p.keyboard.press('Escape');await p.clock.runFor(32);
    const b=await p.locator('#sheet-grip').boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2);
    await p.mouse.down();
    const closingInput=await p.locator('#sheet-grip').evaluate((n,b)=>({captured:n.hasPointerCapture(1),hidden:document.getElementById('reader-sheet').hidden,inert:n.closest('[inert]')?.id||null,top:n.getBoundingClientRect().top,target:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.id}),b);
    report.closingInput = closingInput;
    assert.ok(closingInput.captured,'The visible closing handle must still receive input: '+JSON.stringify(closingInput));
    await p.mouse.move(b.x+b.width/2,b.y+b.height/2-20);
    await p.locator('#sheet-grip').dispatchEvent('pointercancel',{pointerId:1});await p.mouse.up();await p.clock.resume();await settle(p);
    const s=await p.evaluate(()=>window.leafhourPrototype.snapshot());
    assert.equal(s.route,'companion');assert.equal(s.detent,'half');assert.equal(s.draft,'关闭中也保留这份草稿');
  },{controlledClock:true});
  await check('dragging-away-and-back-is-not-treated-as-a-tap',async p => {
    await half(p);const b=await p.locator('#sheet-grip').boundingBox();
    const x=b.x+b.width/2,cy=b.y+b.height/2;
    await p.mouse.move(x,cy);await p.mouse.down();await p.mouse.move(x,cy-100,{steps:3});await p.mouse.move(x,cy,{steps:3});
    await p.waitForTimeout(180);await p.mouse.up();await settle(p);
    assert.equal(await p.evaluate(()=>window.leafhourPrototype.snapshot().detent),'half');
  });
  await check('real-touch-scrolling-keeps-tools-for-a-still-visible-selection',async p => {
    await p.locator('[data-quote="walden-2-001"]').click();
    const start=await p.locator('#reading-scroll').evaluate(n=>n.scrollTop);
    const session=await p.context().newCDPSession(p);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:620,id:1}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:565,id:1}]});
    await p.waitForTimeout(150);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForFunction(start=>document.getElementById('reading-scroll').scrollTop>start+10,start);
    const visible=await p.locator('#walden-2-001 .passage-text').evaluate(n=>n.getBoundingClientRect().bottom>document.getElementById('reader-nav').getBoundingClientRect().bottom+8);
    assert.ok(visible,'The source must still be visible after the touch gesture');
    assert.equal(await p.locator('#selection-menu').isVisible(),true);
    await session.detach();
  });
  await check('a-fast-upward-flick-keeps-the-handle-below-the-status-area',async p => {
    await half(p);const b=await p.locator('#sheet-grip').boundingBox();
    const sampling=p.evaluate(async()=>{
      let min=Infinity;const end=performance.now()+650;
      while(performance.now()<end){min=Math.min(min,document.getElementById('reader-sheet').getBoundingClientRect().top);await new Promise(requestAnimationFrame);}
      return {min,safe:document.querySelector('.status-bar').getBoundingClientRect().bottom+8};
    });
    const x=b.x+b.width/2,cy=b.y+b.height/2;
    await p.mouse.move(x,cy);await p.mouse.down();await p.mouse.move(x,cy-220,{steps:2});await p.mouse.up();
    const result=await sampling;assert.ok(result.min>=result.safe,'Flick overshoot must not enter the system status area: '+JSON.stringify(result));
  });
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
  report.status=report.checks.every(c=>c.status==='pass')?'pass':'fail';
} finally {
  await fs.mkdir(path.join(root,'evidence'),{recursive:true});
  const filename=process.env.LEAFHOUR_POLISH_REPORT || 'polish-verification.json';
  await fs.writeFile(path.join(root,'evidence',filename),JSON.stringify(report,null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
if(report.status!=='pass') process.exitCode=1;
