// Dialog-surface capture for the reading page: atmosphere, bookplate, pagination,
// chat workspace and the signed-in reading tools (timer, prompts, listen, manual
// entry, ending). Signed-in state is a local UI fixture; no account is touched.
const playwrightModule=await import(process.env.READING_POLISH_PLAYWRIGHT_MODULE||'playwright');
const chromium=playwrightModule.chromium||playwrightModule.default.chromium;
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const base=process.env.READING_POLISH_BASE||'http://127.0.0.1:8330';
const out=process.env.READING_POLISH_OUT;
if(!out)throw Error('READING_POLISH_OUT is required');
await mkdir(out,{recursive:true});
const tag=process.env.READING_POLISH_TAG||'dialogs';
const widths=[[1440,1000],[390,844]];
const browser=await chromium.launch({executablePath:process.env.READING_POLISH_CHROMIUM||undefined,headless:true});
const results={tag,base,at:new Date().toISOString(),viewports:[]};

const AUDIT_SELECTORS=['button','a[href]','input','select','summary','[role="tab"]','[role="button"]'];
const KEY_PREFIXES='reader|translation|chat|audio|session|prefs|ui|data|nav|filter|record|manual|billing|source|share|parallel|book|library|gift|atmosphere|reading|note|highlight|annotation|experiences|pricing|account|navigation|credits|credit';
const audit=page=>page.evaluate(({selectors,prefixes})=>{
  const rows=[];
  const keyPattern=new RegExp('^('+prefixes+')\\.[A-Za-z0-9.]+$');
  const leaks=[];
  for(const el of document.querySelectorAll('body *')){
    if(el.hidden||el.closest('[hidden]')||el.children.length)continue;
    const text=(el.textContent||'').trim();
    if(text&&keyPattern.test(text)&&getComputedStyle(el).display!=='none')leaks.push({tag:el.tagName.toLowerCase(),id:el.id||null,text});
  }
  for(const el of document.querySelectorAll(selectors.join(','))){
    if(el.hidden||el.closest('[hidden]'))continue;
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)continue;
    rows.push({tag:el.tagName.toLowerCase(),id:el.id||null,cls:(typeof el.className==='string'?el.className:'').split(/\s+/).filter(Boolean).slice(0,4),
      text:(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,60),aria:el.getAttribute('aria-label'),
      w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,x:Math.round(r.x*10)/10,y:Math.round(r.y*10)/10,font:cs.fontSize,
      visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth});
  }
  return {rows,leaks};
},({selectors:AUDIT_SELECTORS,prefixes:KEY_PREFIXES}));

async function stubSession(context){
  // The fixture identity is local UI state only; every API request is rewritten to
  // the anonymous owner so the real service never sees a foreign account.
  await context.route('**/api/**',route=>{
    const headers={...route.request().headers(),'x-reader-owner':'guest'};
    route.continue({headers});
  });
  await context.route('**/api/auth/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    user:{id:'fixture-reader',email:'fixture@example.invalid',displayName:'界面校对'},passwordAvailable:true,directUpload:false,
    providers:{google:false,apple:false},otp:{digits:6,retryAfter:60},localAvailable:true,translationAvailable:true,
    readingPreferences:null,billing:{enabled:false}
  })}));
  await context.route('**/api/library/books/*/records',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    kind:'marginalia-personal-records',schemaVersion:2,bookId:'gutenberg-alice',contentVersion:'0',comments:[],questions:[],readingSessions:[],highlights:[],position:null
  })}));
  await context.route('**/api/library/books/*/progress',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true})}));
}

for(const [width,height] of widths){
  const state={width,height,shots:[],controls:{},leaks:{}};
  const shot=async page=>{const name=state.pending;const file=`${tag}-${name}-${width}.png`;await page.screenshot({path:path.join(out,file),animations:'disabled'});state.shots.push(file);};
  const snap=async page=>{const result=await audit(page);state.controls[state.pending]=result.rows;state.leaks[state.pending]=result.leaks;await shot(page);};
  const open=async(page,sel,waitSel)=>{await page.locator(sel).click();if(waitSel)await page.locator(waitSel).first().waitFor({timeout:5000}).catch(()=>{});await page.waitForTimeout(350);};
  const reveal=async page=>{if(await page.locator('#open-settings').isVisible().catch(()=>false))return;await openPanel(page);};
  const openPanel=async page=>{
    const expanded=await page.locator('#reading-tools-trigger').getAttribute('aria-expanded');
    if(expanded!=='true'){await page.locator('#reading-tools-trigger').click().catch(()=>{});await page.waitForTimeout(350);}
  };

  // --- guest surfaces ---
  let context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,locale:'zh-CN'});
  let page=await context.newPage();
  await page.goto(base+'/read?book=gutenberg-alice');
  await page.locator('body[data-ready="true"]').waitFor({timeout:30000});
  await page.waitForTimeout(300);
  await reveal(page);
  state.pending='09-atmosphere';await open(page,'#open-atmosphere','#atmosphere-dialog');await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(250);
  await reveal(page);
  state.pending='10-book-info';await open(page,'#open-book-info','.book-info');await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(250);
  // pagination: flip the native page-layout control and let the reader re-render
  await page.evaluate(()=>{const s=document.querySelector('#page-layout');s.value='spread';s.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(500);
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await page.waitForTimeout(400);
  state.pending='11-pagination';await snap(page);
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200);
  state.pending='12-chat';await open(page,'.library-chat-launcher,.library-chat-trigger','#library-chat-workspace').catch(()=>{});
  await snap(page);
  await page.locator('.library-chat-close').click().catch(()=>{});
  // excerpt toolbar: selection drives the share sheet and the More menu
  await page.evaluate(()=>{const p=document.querySelector('#chapter-text .passage p');const range=document.createRange();range.selectNodeContents(p);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);});
  await page.waitForTimeout(500);
  state.pending='18-share';await open(page,'#show-share','#share-dialog,.share-sheet,dialog[open]').catch(()=>{});await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(250);
  await page.evaluate(()=>{const p=document.querySelector('#chapter-text .passage p');const range=document.createRange();range.selectNodeContents(p);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);});
  await page.waitForTimeout(500);
  state.pending='19-more';await open(page,'#more-actions','#paragraph-more').catch(()=>{});await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(250);
  await context.close();

  // --- signed-in fixture surfaces ---
  context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,locale:'zh-CN'});
  await stubSession(context);
  page=await context.newPage();
  await page.goto(base+'/read?book=gutenberg-alice');
  await page.locator('body[data-ready="true"]').waitFor({timeout:30000});
  await page.waitForTimeout(400);
  await openPanel(page);
  state.pending='13-tools-signedin';await snap(page);
  await page.locator('#reading-tools-close').click().catch(()=>{});await page.waitForTimeout(300);
  await openPanel(page);
  state.pending='14-guide';await open(page,'#reading-guide-open','.reading-guide-steps,#reading-guide').catch(()=>{});await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(350);
  await openPanel(page);
  state.pending='15-listen';await open(page,'#listen-chapter','#listen-dialog,[role=dialog]:not([hidden])').catch(()=>{});await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(350);
  await openPanel(page);
  state.pending='16-manual';await open(page,'#manual-reading-open','#manual-reading').catch(()=>{});await snap(page);
  await page.keyboard.press('Escape');await page.waitForTimeout(350);
  await openPanel(page);
  await page.locator('#reading-toggle').click().catch(()=>{});await page.waitForTimeout(700);
  await openPanel(page);
  state.pending='17-ending';await open(page,'#reading-end','#ending-reading,dialog[open]').catch(()=>{});await snap(page);
  await page.keyboard.press('Escape');
  for(const [tab,name] of [['sound','20-settings-sound'],['habits','21-settings-habits'],['data','22-settings-data']]){
    await page.waitForTimeout(250);await openPanel(page);
    await page.locator('#open-settings').click().catch(()=>{});await page.waitForTimeout(300);
    await page.locator('#settings-tab-'+tab).click().catch(()=>{});await page.waitForTimeout(300);
    state.pending=name;await snap(page);
    await page.keyboard.press('Escape');
  }
  state.overflow=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));
  await context.close();
  results.viewports.push(state);
}
await browser.close();
await writeFile(path.join(out,`${tag}-audit.json`),JSON.stringify(results,null,2));
console.log(JSON.stringify({tag,shots:results.viewports.reduce((n,v)=>n+v.shots.length,0),out},null,2));
