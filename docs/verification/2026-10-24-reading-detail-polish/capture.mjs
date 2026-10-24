// Reading-page detail polish harness: captures paired before/after screenshots and
// enumerates every visible interactive control (text, rect, hit area) for review.
// Run with READING_POLISH_BASE, READING_POLISH_OUT and optionally
// READING_POLISH_PLAYWRIGHT_MODULE / READING_POLISH_CHROMIUM. Screenshots stay local.
const playwrightModule=await import(process.env.READING_POLISH_PLAYWRIGHT_MODULE||'playwright');
const chromium=playwrightModule.chromium||playwrightModule.default.chromium;
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const base=process.env.READING_POLISH_BASE||'http://127.0.0.1:8330';
const out=process.env.READING_POLISH_OUT;
if(!out)throw Error('READING_POLISH_OUT is required');
await mkdir(out,{recursive:true});
const tag=process.env.READING_POLISH_TAG||'run';
const ui=process.env.READING_POLISH_UI||'';
const entry=base+'/read?book=gutenberg-alice'+(ui?'&ui='+ui:'');
const widths=[[1440,1000],[768,1024],[390,844],[320,700]];
const browser=await chromium.launch({executablePath:process.env.READING_POLISH_CHROMIUM||undefined,headless:true});
const results={tag,base,at:new Date().toISOString(),viewports:[]};

const KEY_PREFIXES='reader|translation|chat|audio|session|prefs|ui|data|nav|filter|record|manual|billing|source|share|parallel|book|library|gift|atmosphere|reading|note|highlight|annotation|experiences|pricing|account|navigation|credits|credit';
const auditControls=page=>page.evaluate(prefixes=>{
  const rows=[];
  const keyPattern=new RegExp('^('+prefixes+')\\.[A-Za-z0-9.]+$');
  const leaks=[];
  for(const el of document.querySelectorAll('body *')){
    if(el.hidden||el.closest('[hidden]')||el.children.length)continue;
    const text=(el.textContent||'').trim();
    if(text&&keyPattern.test(text)&&getComputedStyle(el).display!=='none')leaks.push({tag:el.tagName.toLowerCase(),id:el.id||null,text});
  }
  for(const el of document.querySelectorAll('button,a[href],input,select,summary,[role="tab"],[role="button"]')){
    if(el.hidden||el.closest('[hidden]'))continue;
    const r=el.getBoundingClientRect();
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)continue;
    rows.push({
      tag:el.tagName.toLowerCase(),
      id:el.id||null,
      cls:(el.className&&typeof el.className==='string'?el.className:'').split(/\s+/).filter(Boolean).slice(0,4),
      text:(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,60),
      aria:el.getAttribute('aria-label'),
      name:((el.labels&&el.labels[0]&&(el.labels[0].innerText||el.labels[0].textContent))||'').trim().replace(/\s+/g,' ').slice(0,40) || el.getAttribute('aria-label') || '',
      title:el.getAttribute('title'),
      w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,
      x:Math.round(r.x*10)/10,y:Math.round(r.y*10)/10,
      font:cs.fontSize,
      visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth,
      inViewport:r.width>0&&r.height>0&&r.top>=0&&r.top<innerHeight
    });
  }
  return {rows,leaks};
},KEY_PREFIXES);

const METRIC_SELECTORS=['#reading-header','#chapter-heading','#chapter-number','#chapter-title','#chapter-original-title','.translation-notice','#chapter-text .source-chapter-heading','#chapter-text .passage','#chapter-text .passage p','#reading-tools-trigger','.reading-tools-panel','.reading-tools-heading','#reading-controls','.listen-chapter','#reading-login','#reading-guide-open','#reading-goal-hint','#settings-dialog','.settings-dialog .dialog-heading','.settings-tabs','#settings-content','.size-row','.font-choices','.settings-paper-heading','.theme-swatches','.typography-details','.reset-appearance','#page-layout-hint','#paragraph-tools','#note-panel','.panel-heading','.panel-source','.panel-tabs','#panel-content','.composer textarea','#toc-dialog','.toc-heading','#toc-list','.toc-chapter','.chapter-footer','#chapter-reading-actions'];
const measure=page=>page.evaluate(selectors=>{
  const out={};
  for(const s of selectors){
    const el=document.querySelector(s);
    if(!el||el.hidden||el.closest('[hidden]')){out[s]=null;continue;}
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(!r.width&&!r.height){out[s]=null;continue;}
    out[s]={x:Math.round(r.x*10)/10,y:Math.round(r.y*10)/10,w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,
      mt:cs.marginTop,mb:cs.marginBottom,pt:cs.paddingTop,pb:cs.paddingBottom,gap:cs.gap,font:cs.fontSize,line:cs.lineHeight,color:cs.color,bg:cs.backgroundColor};
  }
  return out;
},METRIC_SELECTORS);

for(const [width,height] of widths){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,locale:'zh-CN'});
  const page=await context.newPage();
  const state={width,height,shots:[],controls:{},overflow:{},metrics:{},leaks:{}};
  const shot=async name=>{const file=`${tag}-${name}-${width}.png`;await page.screenshot({path:path.join(out,file),animations:'disabled'});state.shots.push(file);};
  const audit=async name=>{const result=await auditControls(page);state.controls[name]=result.rows;state.leaks[name]=result.leaks;state.metrics[name]=await measure(page);};
  // The pill reveals both the reading tools panel and the reading header.
  const revealHeader=async()=>{
    if(await page.locator('#open-settings').isVisible().catch(()=>false))return;
    await page.locator('#reading-tools-trigger').click().catch(()=>{});
    await page.waitForTimeout(300);
  };
  await page.goto(entry);
  await page.locator('body[data-ready="true"]').waitFor({timeout:30000});
  await page.waitForTimeout(400);
  state.overflow.default=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));
  state.firstScreen=await page.evaluate(()=>{
    const box=s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return{y:Math.round(r.y),h:Math.round(r.height),text:(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,80)};};
    return{chapter:box('#chapter-heading'),firstPassage:box('#chapter-text .passage'),pill:box('#reading-tools-trigger'),header:box('#reading-header')};
  });
  await shot('01-reader');
  await audit('reader');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await page.waitForTimeout(300);
  await shot('02-reader-bottom');
  await audit('bottom');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('#reading-tools-trigger').click();
  await page.locator('#reading-tools-panel[data-open="true"], #reading-tools-panel:not([aria-hidden="true"])').first().waitFor({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(350);
  await shot('03-tools');
  await audit('tools');
  await revealHeader();
  await page.locator('#open-settings').click();
  await page.waitForTimeout(350);
  await shot('04-settings');
  await audit('settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await revealHeader();
  await page.locator('#open-toc').click();
  await page.waitForTimeout(350);
  await shot('05-toc');
  await audit('toc');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.locator('.passage').first().click();
  await page.locator('#paragraph-tools:not([hidden])').waitFor({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(350);
  await shot('06-passage-tools');
  await audit('passageTools');
  await page.locator('#show-comment').click().catch(()=>{});
  await page.waitForTimeout(400);
  await shot('07-thought-panel');
  await audit('thoughtPanel');
  await page.locator('#close-panel').click().catch(()=>{});
  await page.waitForTimeout(200);
  await revealHeader();
  await page.locator('#open-settings').click().catch(()=>{});
  await page.waitForTimeout(300);
  await page.locator('#immersive-reading').uncheck({force:true}).catch(()=>{});
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(400);
  await shot('08-unfocused');
  await audit('unfocused');
  // reading modes and night paper through the same native controls a reader uses
  const setMode=async value=>{
    await page.evaluate(v=>{const s=document.querySelector('#view-mode');s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));},value);
    await page.waitForTimeout(500);
  };
  await setMode('parallel');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);
  await shot('09-mode-parallel');await audit('modeParallel');
  await setMode('zh');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);
  await shot('10-mode-zh');await audit('modeZh');
  await setMode('en');
  await revealHeader();
  await page.locator('#open-settings').click().catch(()=>{});await page.waitForTimeout(300);
  await page.locator('[data-theme-choice="night"]').click().catch(()=>{});await page.waitForTimeout(300);
  await page.keyboard.press('Escape');await page.waitForTimeout(300);
  await shot('11-night');await audit('night');
  state.overflow.final=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));
  state.diagnostics=await page.evaluate(()=>({
    ready:document.body.dataset.ready,
    theme:document.documentElement.dataset.theme,
    tools:document.body.dataset.readingTools,
    fonts:getComputedStyle(document.querySelector('#chapter-text p')||document.body).fontFamily
  }));
  results.viewports.push(state);
  await context.close();
}
await browser.close();
await writeFile(path.join(out,`${tag}-audit.json`),JSON.stringify(results,null,2));
console.log(JSON.stringify({tag,shots:results.viewports.reduce((n,v)=>n+v.shots.length,0),out},null,2));
