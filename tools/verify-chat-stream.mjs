// Synthetic model chunks, real plugin/bridge/domain/HTTP/browser chain. No paid
// provider, production session, private book or external network is used here.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createReaderServer} from '../server/server.mjs';
import {createChatGenerator} from '../harness/chat-generator.mjs';
import {apply} from '../harness/chat-plugin.mjs';

if(!process.argv[2]||!process.env.LEAFHOUR_PLAYWRIGHT_MODULE||!process.env.LEAFHOUR_VERIFY_DIST)throw Error('Registered artifact, existing browser runtime and built package required');
const out=path.resolve(process.argv[2]),dist=path.resolve(process.env.LEAFHOUR_VERIFY_DIST);await fs.mkdir(out,{recursive:true});const sessionDir=await fs.mkdtemp(path.join(out,'session-'));
const report={at:new Date().toISOString(),chain:'synthetic adapter text-delta → real DSH plugin → authenticated loopback bridge → chat domain → NDJSON → fetch decoder → operation state → packaged DOM',cases:[],limits:['Synthetic model chunks are not real provider output.','Local fixture identities and public-domain Alice only; production and real-account acceptance are separate.','Chromium driver input is not physical-device, OS IME or screen-reader speech acceptance.']};
let activeResponse,control,browser,context;
const generator=async job=>{
 let release,close;const gate=new Promise(r=>release=r);const stopped=new Promise(r=>close=r);
 const current=control={release,completed:false,trace:[],disconnect:()=>activeResponse.destroy()};
 const progress=async value=>{current.trace.push({stage:'bridge-prefix',sequence:value.sequence,length:value.text.length,at:Date.now()});await job.onProgress?.(value);};
 const generate=createChatGenerator({runRoot:path.join(out,'runtime'),env:{PATH:process.env.PATH,DEEPSEEK_API_KEY:'synthetic-adapter-only'},createHarness:options=>{
  let hook,definitions=[];
  return {
   async start(){const patch=JSON.parse(await fs.readFile(options.patches[0],'utf8')),config=patch.find(row=>row.insert)?.insert[0].config;apply({on(name,fn){if(name==='llm/stream')hook=fn;},tools:{guard(){},register(value){definitions.push(value);}}},config);},
   async run(){
    const context=await definitions.find(tool=>tool.name==='reader_get_context').execute({});const passage=context.passages[0];
    await definitions.find(tool=>tool.name==='reader_cite').execute({bookId:job.book.bookId,passageId:passage.passageId,layer:'original',quote:passage.original.slice(0,32)});
    const prefix='先看这句话中的限定。',summary=prefix+'\n\n它把问题放回当前原句，也给后续讨论留下空间。\n\n### 怎样理解\n\n可以先核对原句，再比较自己的解释；这个例子只是一种理解方式。\n\n- 留意条件与否定。\n- 回到作者实际写下的文字。';
    for await(const chunk of hook({messages:[{role:'user',content:job.text}],maxTokens:3072},async function*(){
     if(job.text.includes('EMPTY'))return;
     yield {type:'text-delta',index:0,text:prefix};await Promise.race([gate,stopped]);
     if(job.signal.aborted)return;
     if(job.text.includes('ERROR'))throw Error('Synthetic adapter interruption');
     for(const text of [summary.slice(prefix.length,60),summary.slice(60)]){await delay(70);yield {type:'text-delta',index:0,text};}
    })){}
    current.completed=true;current.trace.push({stage:'adapter-completed',at:Date.now()});
    return {finalResponse:job.text.includes('EMPTY')?'':summary,events:[{type:'assistant/message',data:{message:{content:[{type:'text',text:summary}]}}},{type:'turn/end',data:{reason:{kind:'completed'}}}]};
   },
   async close(){close();}
  };
 }});
 return generate({...job,onProgress:progress});
};
const server=await createReaderServer({bookPath:out+'/missing.json',recordsPath:sessionDir+'/records.json',portalDataDir:sessionDir+'/portal',env:{},allowLocal:true,chatGenerator:generator,companionGenerator:null,introductionGenerator:null});
server.prependListener('request',(req,res)=>{if(req.method==='POST'&&req.url.endsWith('/chat'))activeResponse=res;});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
try{
 const {chromium}=await import(pathToFileURL(process.env.LEAFHOUR_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,executablePath:process.env.LEAFHOUR_CHROMIUM_EXECUTABLE});
 const cases=[['en',1440,900,'paper','NORMAL'],['zh-Hans',390,844,'paper','NORMAL'],['zh-Hant',320,740,'night','NORMAL'],['ja',768,1024,'night','NORMAL'],['zh-Hans',390,420,'paper','STOP'],['en',1440,900,'paper','EMPTY'],['zh-Hans',390,844,'night','ERROR'],['en',1440,900,'paper','DISCONNECT']];
 for(const [locale,width,height,theme,mode]of cases){
  const row={locale,width,height,theme,mode,checks:[],errors:[]};report.cases.push(row);
  context=await browser.newContext({viewport:{width,height},hasTouch:width<=390,reducedMotion:width<=390?'reduce':'no-preference'});context.setDefaultTimeout(15000);
  await context.addInitScript(theme=>{localStorage.setItem('reader-theme',theme);},theme);
  const auth=await context.request.post(base+'/api/auth/local',{data:{},headers:{Origin:base}});assert.equal(auth.ok(),true);
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==base)return route.abort();if(u.pathname.startsWith('/api/'))return route.continue();
   const file=path.resolve(dist,u.pathname==='/read'?'read.html':u.pathname.slice(1));assert.ok(file.startsWith(dist+path.sep));
   return route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream'});
  });
  const p=await context.newPage();p.on('pageerror',error=>row.errors.push(error.message));
  try{
   await p.goto(base+'/read?book=gutenberg-alice&ui='+locale);await p.waitForFunction(()=>document.body.dataset.ready==='true');
   await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   const before=await p.evaluate(()=>({scroll:scrollY,rect:document.querySelector('.passage').getBoundingClientRect().toJSON()}));
   await p.locator('#reading-tools-trigger').click();await p.locator('.library-chat-trigger').click();
   const input=p.locator('#library-chat-input');await input.fill(mode+' synthetic GET-260 '+row.locale);await p.locator('.library-chat-send[type=submit]').click();
   const message=p.locator('.library-chat-turn').last(),prefix=message.locator('.library-chat-stream-text');
   if(mode==='EMPTY'){
    await message.locator('.library-chat-retry').waitFor();assert.equal(await message.locator('.library-chat-copy').count(),0);assert.ok((await input.inputValue()).includes('EMPTY'));row.checks.push('empty response fails honestly and retains question');continue;
   }
   await prefix.waitFor();assert.equal(await prefix.textContent(),'先看这句话中的限定。');assert.equal(control.completed,false);assert.equal(await message.locator('.library-chat-copy').count(),0);assert.equal(await message.locator('.library-chat-evidence').count(),0);
   row.firstDOMAt=Date.now();row.checks.push('prefix visible before adapter completion; no premature copy or verified citations');
   if(mode==='STOP'){
    const stopped=control;await p.locator('.library-chat-stop').click();await p.waitForFunction(()=>document.querySelector('.library-chat-stop').hidden);assert.equal(await message.locator('.library-chat-stream-text').count(),0);assert.ok((await input.inputValue()).includes('STOP'));stopped.release();row.trace=stopped.trace;row.checks.push('Stop cancels the runtime, discards provisional text and restores the question');continue;
   }
   if(mode==='DISCONNECT'){
    const disconnected=control;control.disconnect();control.release();await p.locator('.library-chat-status-row button').click();await message.locator('.library-chat-copy').waitFor();assert.equal(control,disconnected);row.checks.push('lost response reconciles the same request through GET without another model run');continue;
   }
   const current=control;current.release();
   if(mode==='ERROR'){
    await message.locator('.library-chat-retry').waitFor();assert.equal(await message.locator('.library-chat-copy').count(),0);assert.equal(await message.locator('.library-chat-stream-text').count(),0);assert.ok((await input.inputValue()).includes('ERROR'));row.checks.push('partial provider failure never publishes an answer and retains retry text');continue;
   }
   await message.locator('.library-chat-copy').waitFor();row.trace=current.trace;assert.ok(row.firstDOMAt<=current.trace.find(event=>event.stage==='adapter-completed').at);
   const answer=message.locator('.library-chat-answer'),markdown=answer.locator('.library-chat-markdown');row.computed=await markdown.evaluate(el=>{const css=getComputedStyle(el),card=getComputedStyle(el.parentElement);return {font:css.fontSize,lineHeight:css.lineHeight,padding:card.padding,border:card.borderTopWidth,background:card.backgroundColor,theme:document.documentElement.dataset.theme};});
   assert.equal(row.computed.font,'16px');assert.ok(parseFloat(row.computed.lineHeight)>=29);assert.equal(row.computed.border,'1px');assert.equal(await answer.locator('.library-chat-evidence').evaluate(el=>el.open),false);
   if(width>=1100){const after=await p.evaluate(()=>({scroll:scrollY,rect:document.querySelector('.passage').getBoundingClientRect().toJSON()}));assert.equal(before.scroll,after.scroll);for(const key of ['x','y','width'])assert.ok(Math.abs(before.rect[key]-after.rect[key])<1);}
   await p.screenshot({path:out+'/'+locale+'-'+width+'-'+theme+'.png'});
   await answer.locator('.library-chat-evidence>summary').click();await answer.locator('.library-chat-references>summary').click();assert.equal(await answer.locator('.library-chat-source-link').isVisible(),true);await answer.locator('.library-chat-source-link').click();
   if(width<1100){if(await p.evaluate(()=>document.body.dataset.readingTools!=='open'))await p.locator('#reading-tools-trigger').click();await p.locator('.library-chat-trigger').click();}
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   row.checks.push('16px/1.9 reading text; padded bordered card; collapsed evidence; source return; book geometry; no horizontal overflow');
  }finally{control?.release();await context.close();context=null;}
 }
 assert.ok(report.cases.every(row=>!row.errors.length));
}catch(error){report.failure={message:error.message,stack:error.stack};throw error;}
finally{await context?.close();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');}
console.log('Packaged streaming browser cases passed: '+report.cases.length);
