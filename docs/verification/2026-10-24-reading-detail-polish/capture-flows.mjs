// Second-round flow capture for the reading page: highlight marks, the saved
// position recovery notice and the chapter-end actions. Signed-in state is the
// same local UI fixture as capture-dialogs.mjs; no real account is touched.
const playwrightModule=await import(process.env.READING_POLISH_PLAYWRIGHT_MODULE||'playwright');
const chromium=playwrightModule.chromium||playwrightModule.default.chromium;
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const base=process.env.READING_POLISH_BASE||'http://127.0.0.1:8330';
const out=process.env.READING_POLISH_OUT;
if(!out)throw Error('READING_POLISH_OUT is required');
await mkdir(out,{recursive:true});
const tag=process.env.READING_POLISH_TAG||'flows';
const widths=[[1440,1000],[390,844]];
const browser=await chromium.launch({executablePath:process.env.READING_POLISH_CHROMIUM||undefined,headless:true});
const results={tag,base,at:new Date().toISOString(),viewports:[]};
const KEY_PREFIXES='reader|translation|chat|audio|session|prefs|ui|data|nav|filter|record|manual|billing|source|share|parallel|book|library|gift|atmosphere|reading|note|highlight|annotation|experiences|pricing|account|navigation|credits|credit';

const audit=page=>page.evaluate(prefixes=>{
  const rows=[],leaks=[];
  const keyPattern=new RegExp('^('+prefixes+')\\\\.[A-Za-z0-9.]+$');
  for(const el of document.querySelectorAll('body *')){
    if(el.hidden||el.closest('[hidden]')||el.children.length)continue;
    const text=(el.textContent||'').trim();
    if(text&&keyPattern.test(text)&&getComputedStyle(el).display!=='none')leaks.push({tag:el.tagName.toLowerCase(),id:el.id||null,text});
  }
  for(const el of document.querySelectorAll('button,a[href],input,select,summary,[role="tab"],[role="button"],mark')){
    if(el.hidden||el.closest('[hidden]'))continue;
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)continue;
    rows.push({tag:el.tagName.toLowerCase(),id:el.id||null,cls:(typeof el.className==='string'?el.className:'').split(/\s+/).filter(Boolean).slice(0,4),
      text:(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,60),
      w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,x:Math.round(r.x*10)/10,y:Math.round(r.y*10)/10,
      visible:r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth});
  }
  return {rows,leaks};
},KEY_PREFIXES);

async function stubSession(context,records){
  await context.route('**/api/**',route=>{
    route.continue({headers:{...route.request().headers(),'x-reader-owner':'guest'}});
  });
  await context.route('**/api/auth/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    user:{id:'fixture-reader',email:'fixture@example.invalid',displayName:'界面校对'},passwordAvailable:true,directUpload:false,
    providers:{google:false,apple:false},otp:{digits:6,retryAfter:60},localAvailable:true,translationAvailable:true,
    readingPreferences:null,billing:{enabled:false}
  })}));
  await context.route('**/api/library/books/*/records*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(records)}));
  await context.route('**/api/library/books/*/progress*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true})}));
}

for(const [width,height] of widths){
  const state={width,height,shots:[],controls:{},leaks:{}};
  const shot=async name=>{const file=`${tag}-${name}-${width}.png`;await page.screenshot({path:path.join(out,file),animations:'disabled'});state.shots.push(file);};
  const snap=async name=>{const result=await audit(page);state.controls[name]=result.rows;state.leaks[name]=result.leaks;await shot(name);};

  // highlight marks: selection + the mark action (guest sees the sign-in toast)
  let context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,locale:'zh-CN'});
  let page=await context.newPage();
  await page.goto(base+'/read?book=gutenberg-alice');
  await page.locator('body[data-ready="true"]').waitFor({timeout:30000});
  await page.waitForTimeout(300);
  await page.evaluate(()=>{const p=document.querySelectorAll('#chapter-text .passage p')[1];const range=document.createRange();range.selectNodeContents(p);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);});
  await page.waitForTimeout(500);
  await page.locator('#show-highlight').click().catch(()=>{});
  await page.waitForTimeout(400);
  await snap('23-highlight');
  await context.close();

  // saved-position recovery notice (position must match the current content version)
  context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,locale:'zh-CN'});
  page=await context.newPage();
  const book=await (await page.request.get(base+'/api/library/books/gutenberg-alice')).json();
  const paragraphs=(book.sections||[]).flatMap(s=>s.paragraphs);
  const middle=paragraphs[Math.floor(paragraphs.length/2)]||{},first=paragraphs[0]||{};
  await context.addInitScript(({key,pos})=>{try{localStorage.setItem(key,JSON.stringify(pos));}catch{}},
    {key:'marginalia-focus-position-v1|guest|gutenberg-alice',
     pos:{passageId:first.id,offset:80,mode:'en',variant:'interpretive',revision:1,contentVersion:book.contentVersion||'0',chapterLabel:'第 1 章 · 掉进兔子洞',localWriterId:'fixture-local',localSequence:3,updatedAt:new Date().toISOString()}});
  let recordReads=0;
  await context.route('**/api/library/books/*/records*',route=>{
    // First read matches the cached revision; the later refresh carries a newer
    // remote revision, which is exactly when the reader offers the choice.
    recordReads+=1;
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      kind:'marginalia-personal-records',schemaVersion:2,bookId:'gutenberg-alice',contentVersion:book.contentVersion||'0',comments:[],questions:[],
      readingSessions:[],highlights:[],position:{chapterId:(book.sections||[]).find(s=>s.paragraphs.some(p=>p.id===middle.id))?.chapterId||'c1',passageId:middle.id||null,offset:40,mode:'en',variant:'interpretive',revision:recordReads<2?1:2,contentVersion:book.contentVersion||'0',chapterLabel:'第 2 章 · 泪水池',updatedAt:new Date().toISOString()}
    })});
  });
  await page.goto(base+'/read?book=gutenberg-alice');
  await page.locator('body[data-ready="true"]').waitFor({timeout:30000});
  await page.waitForTimeout(800);
  // The choice notice appears only when a later records read carries a newer
  // revision; reveal the real node here so its copy and targets can be reviewed.
  await page.evaluate(()=>{const n=document.querySelector('#progress-notice');if(n)n.hidden=false;});
  await page.waitForTimeout(300);
  await snap('24-progress');
  await context.close();

  // signed-in: chapter-end actions and a saved highlight mark
  context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,locale:'zh-CN'});
  await stubSession(context,{kind:'marginalia-personal-records',schemaVersion:2,bookId:'gutenberg-alice',contentVersion:'0',
    comments:[],questions:[],readingSessions:[],highlights:[],
    position:null});
  page=await context.newPage();
  await page.goto(base+'/read?book=gutenberg-alice');
  await page.locator('body[data-ready="true"]').waitFor({timeout:30000});
  await page.waitForTimeout(500);
  await page.waitForTimeout(600);
  await page.evaluate(()=>{const node=document.querySelector('.flow-chapter-end')||document.querySelector('#chapter-reading-actions')||document.querySelector('#chapter-footer');if(node)node.scrollIntoView({block:'center'});});
  await page.waitForTimeout(600);
  await snap('25-chapter-actions');
  await context.close();

  results.viewports.push(state);
}
await browser.close();
await writeFile(path.join(out,`${tag}-audit.json`),JSON.stringify(results,null,2));
console.log(JSON.stringify({tag,shots:results.viewports.reduce((n,v)=>n+v.shots.length,0),out},null,2));
