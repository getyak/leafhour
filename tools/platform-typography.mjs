// Remote, anonymous acceptance only. Never drives a browser on the user's Mac.
// CDP evidence: https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function until(operation,label,ms=30000){const deadline=Date.now()+ms;let last;while(Date.now()<deadline){if(failures.length)throw Error('Evidence task failed: '+failures.join('; '));try{const value=await operation();if(value)return value;}catch(error){last=error;}await delay(100);}throw Error('Timed out: '+label+(last?' ('+last.message+')':''));}

// Node22 built-in WebSocket; no browser package or extra driver dependency.
class CDP {
  constructor(socket){this.socket=socket;this.next=0;this.pending=new Map();this.listeners=new Map();
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error(pending.method+': '+JSON.stringify(message.error))):pending.resolve(message.result);}else for(const handler of this.listeners.get(message.method)||[])handler(message.params);});
    socket.addEventListener('close',()=>{for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('CDP disconnected'));}this.pending.clear();});
  }
  static async connect(url){const socket=new WebSocket(url);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('CDP open timeout'));},10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP socket error'));},{once:true});});return new CDP(socket);}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method));},30000);this.pending.set(id,{resolve,reject,timer,method});this.socket.send(JSON.stringify({id,method,params}));});}
  on(method,handler){const set=this.listeners.get(method)||new Set();set.add(handler);this.listeners.set(method,set);return()=>set.delete(handler);}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text+': '+JSON.stringify(result.exceptionDetails.exception));return result.result.value;}
  async close(){if(this.socket.readyState===3)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP close timeout')),5000);this.socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});this.socket.close();});}
}

assert.equal(process.env.GITHUB_ACTIONS,'true','Run only on the task-owned GitHub hosted runner');
assert.ok(['linux','win32'].includes(process.platform),'Local Mac browser automation is prohibited');
const root=process.cwd(),out=path.resolve(process.argv[2]||''),runnerTemp=path.resolve(process.env.RUNNER_TEMP||'');
assert.ok(process.argv[2]&&process.env.RUNNER_TEMP&&out.startsWith(runnerTemp+path.sep),'Evidence must live inside this job RUNNER_TEMP');
await mkdir(out,{recursive:true});
const receipt={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),platform:process.platform,release:os.release(),arch:os.arch(),image:{os:process.env.ImageOS,version:process.env.ImageVersion},node:process.version,startedAt:new Date().toISOString(),scope:'anonymous actual pages; remote runner; screenshots require human review',screenshots:[],fonts:[],checks:[],errors:[]};
const serverData=path.join(out,'isolated-data'),browserProfile=path.join(out,'browser-profile');
let server,child,cdp,fetchEnabled=false,holdFonts=false;const paused=new Set(),background=new Set(),failures=[],evidenceListeners=[];
function task(operation){const promise=Promise.resolve(operation).catch(error=>failures.push(error.message)).finally(()=>background.delete(promise));background.add(promise);}
const observe=(method,handler)=>evidenceListeners.push(cdp.on(method,handler));
async function capture(name){const {data}=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const bytes=Buffer.from(data,'base64');await writeFile(path.join(out,name+'.png'),bytes);receipt.screenshots.push({file:name+'.png',bytes:bytes.length,sha256:sha(bytes)});}
async function fonts(selector,label,{awaitFonts=true}={}){
  receipt.activeProbe={selector,label,phase:'layout'};
  await cdp.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Missing target');n.scrollIntoView({block:'nearest',behavior:'instant'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))));})()`);
  if(awaitFonts)await cdp.evaluate('document.fonts.ready.then(()=>true)');
  let usage;
  // Navigation invalidates protocol node IDs. Re-resolve this exact selector
  // once for that specific protocol error, recording it; assertions never retry.
  for(let attempt=0;attempt<2;attempt++){
    receipt.activeProbe={selector,label,phase:'platform-fonts',attempt};
    try{
      const {root:doc}=await cdp.send('DOM.getDocument');
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector});
      assert.ok(nodeId,'Missing actual text node: '+selector);
      usage=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});break;
    }catch(error){if(attempt||!error.message.includes('Could not find node with given id'))throw error;(receipt.nodeInvalidations??=[]).push({...receipt.activeProbe,error:error.message});}
  }
  const details=await cdp.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n),r=n.getBoundingClientRect();return {text:n.textContent,font:s.font,fontFamily:s.fontFamily,style:s.fontStyle,rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:!!n.getClientRects().length&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight};})()`);
  assert.ok(details.visible,label+' must actually render inside the viewport');const value={label,selector,...details,...usage};receipt.checks.push(value);delete receipt.activeProbe;return value;
}
function customNewsreader(value){assert.ok(value.fonts.some(font=>font.isCustomFont&&/Newsreader/i.test(font.postScriptName||font.familyName)&&font.glyphCount>0),value.label+' must render actual custom Newsreader glyphs');}
async function cjkGlyphs(selector,label,{serif=false}={}){
  // Platform font usage includes ::before: language links have a Latin middle
  // dot separator. Keep that real parent record, then isolate every existing
  // CJK text run without inventing text or accepting Latin .notdef as CJK.
  await fonts(selector,label+' including generated punctuation');
  const probes=await cdp.evaluate(String.raw`(()=>{
    const target=document.querySelector(${JSON.stringify(selector)}),original=target.textContent,before=target.getBoundingClientRect();
    const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    const probes=[];for(const node of nodes){
      const matches=[...node.textContent.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]+/gu)];
      for(const match of matches.reverse()){
        const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
        const width=range.getBoundingClientRect().width,span=document.createElement('span');span.id='platform-cjk-${receipt.checks.length}-'+probes.length;
        range.surroundContents(span);const measured=span.getBoundingClientRect().width;
        if(Math.abs(width-measured)>.1)throw Error('CJK probe changed original glyph width');
        probes.push({selector:'#'+span.id,text:span.textContent,before:width,after:measured});
      }
    }
    const after=target.getBoundingClientRect();if(target.textContent!==original||Math.abs(before.width-after.width)>.1||Math.abs(before.height-after.height)>.1)throw Error('CJK probes changed original text or layout');
    return probes;
  })()`);
  assert.ok(probes.length,label+' must contain actual CJK text');
  const allowed=serif?/Noto.*Serif.*(?:SC|CJK)|Source.*Han.*Serif|Songti|STSong|SimSun|NSimSun/i:/Noto.*Serif.*(?:SC|CJK)|Source.*Han.*Serif|Songti|STSong|SimSun|NSimSun|PingFang|YaHei|Yu.?Gothic|Meiryo/i;
  for(const probe of probes){const value=await fonts(probe.selector,label+' direct CJK text');assert.equal(value.text,probe.text);assert.ok(value.fonts.length&&value.fonts.every(font=>font.glyphCount>0&&allowed.test(font.postScriptName||font.familyName)),label+' requires covered CJK glyphs, not Latin missing glyphs');value.probeWidths={before:probe.before,after:probe.after};}
}

try{
  receipt.catalogSources=[];for(const entry of JSON.parse(await readFile(path.join(root,'catalog/manifest.json'),'utf8'))){assert.match(entry.file,/^[a-z0-9/._-]+$/i);const relative='catalog/'+entry.file,bytes=await readFile(path.join(root,relative)),original=execFileSync('git',['show','HEAD:'+relative],{maxBuffer:16*1024*1024});assert.equal(sha(bytes),sha(original),'Checkout changed original source bytes: '+relative);receipt.catalogSources.push({bookId:entry.id,file:relative,sha256:sha(bytes)});}
  const {createReaderServer}=await import(pathToFileURL(path.join(root,'server/server.mjs')));
  const disabled=async()=>{throw Error('Provider calls disabled during anonymous platform QA');};
  server=await createReaderServer({bookPath:path.join(serverData,'missing.json'),recordsPath:path.join(serverData,'records.json'),portalDataDir:path.join(serverData,'portal'),allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null,generator:disabled});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const origin='http://127.0.0.1:'+port;let endpoint;
  {
    const choices=process.platform==='win32'?[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'];let executable;
    for(const candidate of choices){try{await access(candidate);executable=candidate;break;}catch{}}
    assert.ok(executable,'Installed runner Chrome required; no download fallback');receipt.browserExecutable=executable;
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+browserProfile,'--window-size=1200,900','about:blank'],{stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-20000);});child.on('error',error=>failures.push(error.message));
    const active=await until(async()=>{if(child.exitCode!==null)throw Error('Owned Chrome exited: '+stderr);return(await readFile(path.join(browserProfile,'DevToolsActivePort'),'utf8')).split('\n')[0];},'owned Chrome debugger');endpoint='http://127.0.0.1:'+active;
  }
  const pages=await until(async()=>{const r=await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(3000)});const list=await r.json();return list.find(page=>page.type==='page'&&page.webSocketDebuggerUrl);},'task Chrome page');
  cdp=await CDP.connect(pages.webSocketDebuggerUrl);receipt.browser=await cdp.send('Browser.getVersion');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
  for(const method of ['Page.enable','Runtime.enable','DOM.enable','CSS.enable','Network.enable'])await cdp.send(method);
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.clearBrowserCache');
  let pageLabel='home-cold';const requestFonts=new Map();
  observe('Network.responseReceived',event=>{if(event.type==='Font'||event.type==='Stylesheet'&&/\/(?:fonts\/|typography\.css)/.test(new URL(event.response.url).pathname))requestFonts.set(event.requestId,{page:pageLabel,type:event.type,url:event.response.url,status:event.response.status,mime:event.response.mimeType,fromDiskCache:event.response.fromDiskCache,fromServiceWorker:event.response.fromServiceWorker});});
  observe('Network.loadingFinished',event=>{const font=requestFonts.get(event.requestId);if(font)task((async()=>{const body=await cdp.send('Network.getResponseBody',{requestId:event.requestId});assert.ok(font.type!=='Font'||body.base64Encoded,'Binary WOFF2 response body expected');const bytes=Buffer.from(body.body,body.base64Encoded?'base64':'utf8'),source=await readFile(path.join(root,'app',new URL(font.url).pathname));assert.equal(sha(bytes),sha(source),'Browser font bytes must match checkout');receipt.fonts.push({...font,bytes:bytes.length,encodedDataLength:event.encodedDataLength,sha256:sha(bytes)});})());});
  observe('Network.loadingFailed',event=>{if(!event.canceled)receipt.errors.push({type:'network',error:event.errorText,blockedReason:event.blockedReason});});
  observe('Runtime.exceptionThrown',event=>receipt.errors.push({type:'runtime',message:event.exceptionDetails.text,exception:event.exceptionDetails.exception?.description}));
  observe('Fetch.requestPaused',event=>{if(holdFonts){paused.add(event.requestId);return;}task(cdp.send('Fetch.continueRequest',{requestId:event.requestId}));});
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/fonts/newsreader/*.woff2',requestStage:'Request'}]});fetchEnabled=true;holdFonts=true;
  await cdp.send('Page.navigate',{url:origin+'/'});
  await until(async()=>paused.size&&await cdp.evaluate(`!!document.querySelector('.hero-copy h1 .hero-line')`),'font-paused real hero');
  await delay(500);const cold=await fonts('.hero-copy h1 .hero-line','cold font-withheld hero',{awaitFonts:false});assert.ok(cold.fonts.some(font=>!font.isCustomFont&&font.glyphCount>0),'Cold fallback must have visible actual glyphs');assert.ok(!cold.fonts.some(font=>font.isCustomFont&&font.glyphCount>0),'Cold run must not use warmed custom face');await capture('home-controlled-font-delay');
  holdFonts=false;for(const requestId of paused)await cdp.send('Fetch.continueRequest',{requestId});paused.clear();
  await cdp.evaluate('document.fonts.ready.then(()=>true)');await capture('home-loaded');customNewsreader(await fonts('.hero-copy h1 .hero-line','loaded hero'));
  for(const [route,locale] of [['/zh-hans','zh-Hans'],['/zh-hant','zh-Hant'],['/ja','ja']]){
    pageLabel='home-'+locale;await cdp.send('Page.navigate',{url:origin+route});await until(()=>cdp.evaluate(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'&&document.documentElement.lang===${JSON.stringify(locale)}&&!!document.querySelector('#how .section-copy h2')`),'authored '+locale+' home');
    await cjkGlyphs('.home-navigation a[hreflang="'+locale+'"]','actual '+locale+' language entrance');
    await cjkGlyphs('#how .section-copy h2','actual '+locale+' heading CJK fallback',{serif:true});
    receipt.cjkNeedsHumanReview=true;await capture('home-'+locale+'-cjk-loaded');
  }
  pageLabel='library';await cdp.send('Page.navigate',{url:origin+'/library'});
  await until(()=>cdp.evaluate(`location.pathname==='/library'&&document.readyState==='complete'&&!!document.querySelector('#library-books .binding-original')`),'actual public shelf');await cdp.evaluate('document.fonts.ready.then(()=>true)');
  customNewsreader(await fonts('#library-books .binding-original','actual Alice cover original title'));
  // Isolate a glyph in the actual text while preserving inherited typography.
  const punctuation=await cdp.evaluate(`(()=>{const n=[...document.querySelectorAll('#library-books .binding-original')].find(n=>n.textContent.includes('Alice’s'));if(!n)throw Error('Actual Alice’s title missing');const raw=n.textContent,node=[...n.childNodes].find(n=>n.nodeType===3&&n.textContent.includes('’'));if(!node)throw Error('Actual apostrophe text missing');const i=node.textContent.indexOf('’'),r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);const before=r.getBoundingClientRect().width,span=document.createElement('span');span.id='platform-apostrophe-probe';r.surroundContents(span);const after=span.getBoundingClientRect().width;return {raw,before,after,em:parseFloat(getComputedStyle(span).fontSize)};})()`);
  const apostrophe=await fonts('#platform-apostrophe-probe','actual inherited U+2019 glyph');customNewsreader(apostrophe);assert.equal(apostrophe.text,'’');assert.ok(punctuation.after<punctuation.em*.5,'Apostrophe must be proportional');assert.ok(Math.abs(punctuation.before-punctuation.after)<.1,'Probe must preserve actual glyph width');receipt.punctuation=punctuation;
  await fonts('#library-books .binding-title','stock CJK book title fallback');await capture('library-loaded');
  const bookResponse=await fetch('http://127.0.0.1:'+port+'/api/library/books/gutenberg-alice',{headers:{'X-Reader-Owner':'guest'}});assert.ok(bookResponse.ok,'Actual public source package required');const sourceBook=await bookResponse.json();
  const {sourceEmphasisRanges}=await import(pathToFileURL(path.join(root,'app/source-emphasis.mjs')));
  const sourcePassage=sourceBook.sections.flatMap(section=>section.paragraphs).find(p=>p.original.includes('_very_')&&sourceEmphasisRanges(p.original).length);assert.ok(sourcePassage,'Actual source emphasis passage required');
  const citation=new URLSearchParams({book:sourceBook.bookId,passage:sourcePassage.id,contentVersion:sourceBook.contentVersion,layer:'original'}),italicSelector='#chapter-text [data-id='+JSON.stringify(sourcePassage.id)+'] em.source-emphasis';
  receipt.citation={bookId:sourceBook.bookId,passageId:sourcePassage.id,contentVersion:sourceBook.contentVersion,layer:'original',originalSha256:sha(sourcePassage.original)};
  pageLabel='reader';await cdp.send('Page.navigate',{url:origin+'/read?'+citation});
  await until(()=>cdp.evaluate(`location.pathname==='/read'&&document.readyState==='complete'&&document.body.dataset.ready==='true'&&!!document.querySelector(${JSON.stringify(italicSelector)})`),'ready cited actual reader italic');await cdp.evaluate('document.fonts.ready.then(()=>true)');
  const resolved=await cdp.evaluate(`(()=>{const reader=window.marginaliaReader,book=reader.getBook(),state=reader.getState(),n=document.querySelector(${JSON.stringify(italicSelector)}).closest('.passage'),r=n.getBoundingClientRect();return {url:location.href,bookId:book.bookId,contentVersion:book.contentVersion,mode:state.mode,passageId:n.dataset.id,visible:r.bottom>0&&r.top<innerHeight};})()`);
  assert.equal(resolved.bookId,sourceBook.bookId);assert.equal(resolved.contentVersion,sourceBook.contentVersion);assert.equal(resolved.passageId,sourcePassage.id);assert.equal(resolved.mode,'en');assert.ok(resolved.visible,'Citation target must already be visible before the font probe scrolls');
  assert.ok([origin+'/read?'+citation,origin+'/read?'+new URLSearchParams({book:sourceBook.bookId})].includes(resolved.url),'Only the application’s existing consumed-entry URL cleanup is permitted');receipt.citation.resolved=resolved;
  await cdp.evaluate(`document.querySelector(${JSON.stringify(italicSelector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  const italic=await fonts(italicSelector,'cited visible source emphasis italic');customNewsreader(italic);assert.equal(italic.text,'very');assert.equal(italic.style,'italic');assert.ok(italic.fonts.some(font=>font.isCustomFont&&/Italic/i.test(font.postScriptName||'')&&font.glyphCount>0),'Actual italic font required');await capture('reader-loaded');
  await until(()=>receipt.fonts.some(font=>font.url.endsWith('newsreader-var.woff2'))&&receipt.fonts.some(font=>font.url.endsWith('newsreader-italic-var.woff2')),'both actual font responses');
  await Promise.all(background);assert.deepEqual(failures,[],'All evidence tasks must succeed');
  assert.deepEqual(receipt.errors,[],'Unexpected page/runtime/network errors require review');receipt.result='machine assertions passed; screenshots pending human visual review';
}catch(error){receipt.result='failed';receipt.failure=error.stack;process.exitCode=1;}
finally{
  if(cdp){
    await cdp.send('Page.stopLoading').catch(error=>failures.push(error.message));
    if(fetchEnabled){holdFonts=false;for(const requestId of paused)await cdp.send('Fetch.continueRequest',{requestId}).catch(error=>failures.push(error.message));await cdp.send('Fetch.disable').catch(error=>failures.push(error.message));}
    // End observation before draining: a snapshot of a growing Set is insufficient.
    for(const unsubscribe of evidenceListeners)unsubscribe();receipt.observationClosedAt=new Date().toISOString();
    while(background.size)await Promise.all([...background]);
    await cdp.close().catch(error=>failures.push(error.message));
  }
  if(child){if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}}else child.kill('SIGTERM');}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  receipt.fontTraffic=[...new Set(receipt.fonts.map(font=>font.page))].map(page=>{const resources=receipt.fonts.filter(font=>font.page===page),fonts=resources.filter(font=>font.type==='Font');return {page,fontRequests:fonts.length,fontResponseBytes:fonts.reduce((sum,font)=>sum+font.bytes,0),stylesheetResponseBytes:resources.filter(font=>font.type==='Stylesheet').reduce((sum,font)=>sum+font.bytes,0),cacheDisabled:true};});
  if(failures.length||receipt.errors.length){receipt.result='failed';process.exitCode=1;}receipt.finishedAt=new Date().toISOString();receipt.backgroundFailures=failures;await writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({result:receipt.result,source:receipt.source,platform:receipt.platform,failure:receipt.failure,output:out}));
}
