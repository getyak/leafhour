// Remote, anonymous acceptance only. Never drives a browser on the user's Mac.
// CDP evidence: https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode
// Mode selection is internal: owned desktop Chrome on the hosted desktop OS
// runners, or the task-owned Android AVD/stock Chrome adapter. Arbitrary CDP
// endpoints and browser flags are never accepted.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {CDP,closeOwnedDesktopChrome} from './lib/platform-cdp.mjs';
import {delay,sha,until,customNewsreader,italicFontEvidence,captureFailurePage,createEvidenceSession,observeInitialPopovers,assertInitialPopoversClosed,exercisePopoverKeyboard,activateRemoteButton,observeReaderTools,observeReaderBookActions} from './lib/platform-font-observer.mjs';
import {
  parseScriptArgs,
  assertRunnerGuard,
  assertEvidenceOutputDir,
  createProductionAndroidAdapter,
  acquireOwned,
  validateDevtoolsTarget,
  validateEffectiveChromeCommandLine,
  resolveLanguageEntrance,
  resolveOriginalTitleProbe,
  assessNativeForeground,
  assessFirstRunOverlay,
  verifyNativeStartup,
  verifyLaunchFacts,
  createRunLifecycle,
  finalizeRunReceipt,
  bindAndroidProductViewport,
} from './lib/platform-android.mjs';

// Admission runs before any output creation, SDK command or server/browser launch.
const args=parseScriptArgs(process.argv.slice(2));
assertRunnerGuard({env:process.env,platform:process.platform,mode:args.mode});
const out=assertEvidenceOutputDir({out:args.out,runnerTemp:process.env.RUNNER_TEMP||''});
const root=process.cwd();
await mkdir(out,{recursive:true});
const receipt={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:args.mode,platform:process.platform,release:os.release(),arch:os.arch(),image:{os:process.env.ImageOS,version:process.env.ImageVersion},node:process.version,startedAt:new Date().toISOString(),scope:'anonymous actual pages; remote runner; screenshots require human review',screenshots:[],fonts:[],checks:[],errors:[]};
const serverData=path.join(out,'isolated-data'),browserProfile=path.join(out,'browser-profile');
const VIEWPORT_EXPRESSION='({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent})';
let server,child,adapter,cdp,session,ownedDesktopEndpoint;const failures=[];
// One bounded, idempotent lifecycle finalizer covers normal completion, errors
// and SIGINT/SIGTERM cancellation: stop future work, refuse late resource
// creation, clean up owned resources exactly once, remove handlers, exit nonzero
// on cancellation. Nothing outside owned resources is ever touched.
const lifecycle=createRunLifecycle({
  addSignalHandler:(signal,handler)=>process.on(signal,handler),
  removeSignalHandler:(signal,handler)=>process.removeListener(signal,handler),
});
const releaseOwnedResources=async()=>{
  const cleanupErrors=[];
  let desktopClosed=false;
  if(session)await session.close({beforeDisconnect:process.platform==='win32'&&child?async()=>{
    receipt.desktopCleanup=await closeOwnedDesktopChrome({cdp,child,endpoint:ownedDesktopEndpoint});
    if(!receipt.desktopCleanup.complete)throw Error(receipt.desktopCleanup.errors.join('; '));
    desktopClosed=true;
  }:undefined}).catch(error=>cleanupErrors.push('evidence session close: '+error.message));
  if(child&&!desktopClosed){
    try{
      if(process.platform==='win32'){
        // A confirmed exited launcher PID may already have been reused. A failed
        // graceful shutdown above remains a failure; never kill that stale PID.
        if(child.exitCode==null&&child.signalCode==null&&Number.isInteger(child.pid))execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
      }
      else child.kill('SIGTERM');
    }catch(error){cleanupErrors.push('owned desktop Chrome: '+error.message);}
  }
  if(adapter){
    const cleanup=await adapter.cleanup().catch(error=>({errors:['owned Android cleanup: '+error.message]}));
    cleanupErrors.push(...cleanup.errors);
  }
  if(server){
    try{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    catch(error){cleanupErrors.push('owned evidence server: '+error.message);}
  }
  receipt.fontTraffic=[...new Set(receipt.fonts.map(font=>font.page))].map(page=>{const resources=receipt.fonts.filter(font=>font.page===page),fonts=resources.filter(font=>font.type==='Font');return {page,fontRequests:fonts.length,fontResponseBytes:fonts.reduce((sum,font)=>sum+font.bytes,0),stylesheetResponseBytes:resources.filter(font=>font.type==='Stylesheet').reduce((sum,font)=>sum+font.bytes,0),cacheDisabled:true};});
  return cleanupErrors;
};
// The real finalization path: release owned resources, then the single result
// gate persists the receipt and sets the exit code so a cancellation arriving
// during final receipt I/O stays recorded and nonzero.
const finalizeRun=async()=>{
  await finalizeRunReceipt({
    lifecycle,
    receipt,
    failures,
    release:releaseOwnedResources,
    write:async value=>{await writeFile(path.join(out,'receipt.json'),JSON.stringify(value,null,2)+'\n');},
    setExitCode:code=>{process.exitCode=code;},
  });
  console.log(JSON.stringify({result:receipt.result,source:receipt.source,platform:receipt.platform,mode:receipt.mode,failure:receipt.failure,output:out}));
  return [];
};
lifecycle.setCleanup(finalizeRun);
lifecycle.attach();
async function nativeCapture(name,bytes){
  assert.ok(Buffer.isBuffer(bytes)&&bytes.length,'Android system screenshot must be actual PNG bytes');
  assert.ok(receipt.screenshots.length<12,'Bounded screenshot budget exceeded');
  await writeFile(path.join(out,name+'.png'),bytes);
  receipt.screenshots.push({file:name+'.png',bytes:bytes.length,sha256:sha(bytes)});
}

try{
  lifecycle.guard('evidence run');
  receipt.catalogSources=[];for(const entry of JSON.parse(await readFile(path.join(root,'catalog/manifest.json'),'utf8'))){assert.match(entry.file,/^[a-z0-9/._-]+$/i);const relative='catalog/'+entry.file,bytes=await readFile(path.join(root,relative)),original=execFileSync('git',['show','HEAD:'+relative],{maxBuffer:16*1024*1024});assert.equal(sha(bytes),sha(original),'Checkout changed original source bytes: '+relative);receipt.catalogSources.push({bookId:entry.id,file:relative,sha256:sha(bytes)});}
  const {createReaderServer}=await import(pathToFileURL(path.join(root,'server/server.mjs')));
  const disabled=async()=>{throw Error('Provider calls disabled during anonymous platform QA');};
  server=await acquireOwned({lifecycle,label:'server creation',start:()=>createReaderServer({bookPath:path.join(serverData,'missing.json'),recordsPath:path.join(serverData,'records.json'),portalDataDir:path.join(serverData,'portal'),allowLocal:false,env:{},sendCode:null,translator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,giftQuoteGenerator:null,paddleProvider:null,generator:disabled}),dispose:async created=>{created.closeAllConnections();await new Promise((resolve,reject)=>created.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));},onError:error=>failures.push(error)});
  lifecycle.guard('evidence server listen');
  await lifecycle.track(new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)));
  lifecycle.guard('evidence server ready');
  const port=server.address().port;
  // The loopback server is reached through the owned adb reverse mapping on the
  // device; desktop keeps its direct loopback origin.
  const origin=args.mode==='android'?'http://localhost:'+port:'http://127.0.0.1:'+port;
  let endpoint,forwardPort=null;
  if(args.mode==='desktop'){
    lifecycle.guard('desktop Chrome launch');
    const choices=process.platform==='win32'?[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe')]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'];let executable;
    for(const candidate of choices){try{await access(candidate);executable=candidate;break;}catch{}}
    assert.ok(executable,'Installed runner Chrome required; no download fallback');receipt.browserExecutable=executable;
    lifecycle.guard('desktop Chrome process creation');
    child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+browserProfile,'--window-size=1200,900','about:blank'],{stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-20000);});child.on('error',error=>failures.push(error.message));
    const active=await until(async()=>{if(child.exitCode!==null)throw Error('Owned Chrome exited: '+stderr);return(await readFile(path.join(browserProfile,'DevToolsActivePort'),'utf8')).split('\n')[0];},'owned Chrome debugger',30000,failures);endpoint='http://127.0.0.1:'+active;ownedDesktopEndpoint=endpoint;
  }else{
    // Internal adapter only: one task-owned AVD, exact serial, exact forward and
    // reverse mappings. No external endpoint, no unofficial APK, no device cloud.
    adapter=createProductionAndroidAdapter({
      lifecycle,
      env:process.env,
      platform:process.platform,
      exec:(file,command,options={})=>execFileSync(file,command,{encoding:options.binary?null:'utf8',input:options.input,maxBuffer:64*1024*1024}),
      spawnProcess:(file,command,options)=>spawn(file,command,options),
      killProcess:(pid,signal)=>process.kill(pid,signal),
      fsOps:{readFile,writeFile,mkdir,rm,exists:async target=>{try{await access(target);return true;}catch{return false;}}},
      sleep:delay,
    });
    lifecycle.guard('AVD launch');
    const launched=await lifecycle.track(adapter.boot());
    lifecycle.guard('stock Chrome setup');
    const chromeSetup=await lifecycle.track(adapter.setupChrome({serverPort:port}));
    forwardPort=chromeSetup.forwardPort;
    receipt.android={
      jobFacts:adapter.jobFacts(),
      launch:launched,
      chromeSetup,
      image:await adapter.imageFacts(),
      device:await adapter.deviceFacts(),
      wm:await adapter.wmFacts(),
      chrome:await adapter.chromeFacts(),
      versions:await adapter.versions(),
      noAccount:true,
      limitations:['AVD/x86_64 API34 PlayStore evidence is not physical ARM/OEM/touch/accessibility or all-Android acceptance'],
    };
    verifyLaunchFacts({returned:{...launched,forwardPort:chromeSetup.forwardPort,reversePort:chromeSetup.reversePort},readback:await adapter.readbackLaunchFacts()});
    endpoint='http://127.0.0.1:'+chromeSetup.forwardPort;
    validateDevtoolsTarget({host:'127.0.0.1',port:chromeSetup.forwardPort,forwardPort:chromeSetup.forwardPort});
  }
  const pages=await until(async()=>{const r=await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(3000)});const list=await r.json();return list.find(page=>page.type==='page'&&page.webSocketDebuggerUrl);},'task Chrome page',30000,failures);
  let websocket=pages.webSocketDebuggerUrl;
  if(args.mode==='android'){
    const target=new URL(websocket);
    validateDevtoolsTarget({host:target.hostname,port:Number(target.port),forwardPort});
    websocket='ws://127.0.0.1:'+forwardPort+target.pathname+target.search;
    validateDevtoolsTarget({host:'127.0.0.1',port:forwardPort,forwardPort});
  }
  lifecycle.guard('devtools connection');
  cdp=await acquireOwned({lifecycle,label:'devtools connection',start:()=>CDP.connect(websocket),dispose:created=>created.close(),onError:error=>failures.push(error)});
  lifecycle.guard('evidence session creation');
  session=createEvidenceSession({cdp,out,receipt,root,origin,failures});
  receipt.browser=await cdp.send('Browser.getVersion');
  let viewport={width:1200,height:900,dpr:1,ua:receipt.browser.userAgent||''};
  if(args.mode==='desktop')await cdp.send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
  for(const method of ['Page.enable','Runtime.enable','DOM.enable','CSS.enable','Network.enable'])await cdp.send(method);
  await cdp.send('Page.bringToFront');
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.clearBrowserCache');
  session.observeResponses();
  if(args.mode==='android'){
    // First start: blank/internal version page. Verify the effective flags and
    // native foreground/no FirstRun overlay with an actual Android system
    // screenshot; a CDP screenshot alone cannot prove native UI is not covering
    // the page. No Play/login account is used.
    await cdp.send('Page.navigate',{url:'chrome://version'});
    await until(()=>cdp.evaluate(`!!document.querySelector('#command_line')`),'stock Chrome effective command line');
    receipt.android.effectiveCommandLine=await cdp.evaluate(`document.querySelector('#command_line').innerText`);
    receipt.android.effectiveFlags=validateEffectiveChromeCommandLine(receipt.android.effectiveCommandLine);
    // Preserve the actual native image even if hierarchy capture/validation fails.
    const recordNative=(snapshot,stage)=>{
      const bytes=Buffer.byteLength(snapshot.uiautomatorXml);
      receipt.android.nativeHierarchyCapture={path:snapshot.uiautomatorPath,status:snapshot.uiautomatorStatus,xmlBytes:bytes,sha256:sha(snapshot.uiautomatorXml)};
      const snapshots=receipt.android.nativeSnapshots??=[];
      assert.ok(bytes<=65536&&snapshots.length<10,'Native evidence exceeds the complete bounded XML budget');
      snapshots.push({stage,...receipt.android.nativeHierarchyCapture,xml:snapshot.uiautomatorXml});
      receipt.android.foreground=assessNativeForeground({dumpsysText:snapshot.dumpsys});
      receipt.android.firstRun=assessFirstRunOverlay(snapshot.uiautomatorXml);
    };
    await verifyNativeStartup({lifecycle,adapter,recordNative,capture:nativeCapture,readInternal:()=>cdp.evaluate('location.href'),waitForClear:check=>until(check,'known native notification rejection to clear',20000,failures),receipt:receipt.android});
    assert.ok(receipt.android.firstRun.ok,'No native startup dialog or permission overlay may cover the browser');
    // The internal version viewport is recorded separately and never reused for
    // product decisions; every product route binds its own current viewport.
    receipt.android.versionViewport=await cdp.evaluate(VIEWPORT_EXPRESSION);
  }
  // Cold-font interception is installed before any product page navigation or
  // font warming on every mode.
  lifecycle.guard('product evidence');
  await session.installFontHold();
  await session.navigateProduct(origin+'/');
  await session.until(async()=>session.paused.size&&await cdp.evaluate(`['/en','/zh-hans','/zh-hant','/ja'].includes(location.pathname)&&document.readyState!=='loading'&&!!document.querySelector('.hero-copy h1 .hero-line')`),'font-paused authored hero after automatic root entry');
  if(args.mode==='android')viewport=await bindAndroidProductViewport({receipt,label:'home-cold',read:()=>session.viewport('home-cold')});
  // Current surfaces use stock sans for the headline and Leafhour Serif for
  // the actual source quotation. Exercise the font owner that the product
  // really renders; never restyle a node to satisfy the font assertions.
  await delay(500);const cold=await session.fonts('#home-view .sample-original','cold font-withheld source quotation',{awaitFonts:false});assert.ok(cold.fonts.some(font=>!font.isCustomFont&&font.glyphCount>0),'Cold fallback must have visible actual glyphs');assert.ok(!cold.fonts.some(font=>font.isCustomFont&&font.glyphCount>0),'Cold run must not use warmed custom face');await session.capture('home-controlled-font-delay');
  await session.releaseFontHold();
  await cdp.evaluate('document.fonts.ready.then(()=>true)');await session.capture('home-loaded');customNewsreader(await session.fonts('#home-view .sample-original','loaded source quotation'));
  const headline=await session.fonts('.hero-copy h1 .hero-line','current stock-sans headline');assert.ok(headline.fonts.some(font=>!font.isCustomFont&&font.glyphCount>0),'Current headline must render its actual stock sans glyphs');
  for(const [route,locale] of [['/zh-hans','zh-Hans'],['/zh-hant','zh-Hant'],['/ja','ja']]){
    await session.navigateProduct(origin+route,{page:'home-'+locale});
    await session.until(()=>cdp.evaluate(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'&&document.documentElement.lang===${JSON.stringify(locale)}&&document.querySelector('#home-menu-trigger')?.getAttribute('lang')===${JSON.stringify(locale)}&&!!document.querySelector('#how .section-copy h2')`),'authored '+locale+' home and initialized navigation');
    if(args.mode==='android')viewport=await bindAndroidProductViewport({receipt,label:'home-'+locale,read:()=>session.viewport('home-'+locale)});
    const entrance=resolveLanguageEntrance({viewportWidth:viewport.width,locale});
    if(args.mode==='android')assert.ok(await cdp.evaluate(`[...document.querySelectorAll('.home-navigation .home-nav')].every(node=>!node.getClientRects().length)`),'Desktop navigation must stay hidden at the actual mobile width');
    await session.cjkGlyphs('#how .section-copy h2','actual '+locale+' stock-sans heading CJK fallback');
    (receipt.languageMenuInteractions??=[]).push(await exercisePopoverKeyboard({cdp,trigger:'#home-menu-trigger',panel:'#home-menu',guard:()=>lifecycle.guard('owned language-menu input'),afterOpened:()=>session.cjkGlyphs(entrance,'actual '+locale+' language entrance'),capture:()=>session.capture('home-'+locale+'-cjk-loaded')}));
    receipt.cjkNeedsHumanReview=true;
  }
  lifecycle.guard('library evidence');
  await session.navigateProduct(origin+'/library',{page:'library'});
  await session.until(()=>cdp.evaluate(`location.pathname==='/library'&&document.readyState==='complete'&&!!document.querySelector('#library-books .binding-original')`),'actual public shelf');await cdp.evaluate('document.fonts.ready.then(()=>true)');
  if(args.mode==='android')viewport=await bindAndroidProductViewport({receipt,label:'library',read:()=>session.viewport('library')});
  let originalSelector='#library-books .binding-original';
  if(args.mode==='android'){
    // .binding-original is hidden at <=380 CSS px. Use a genuine visible
    // same-title node when the page offers one, otherwise record a truthful
    // unsupported result instead of enlarging the viewport.
    const candidates=await cdp.evaluate(String.raw`(()=>{
      const original=document.querySelector('#library-books .binding-original');
      const title=original?original.textContent.trim():'';
      const nodes=[...document.querySelectorAll('#library-books .binding-original, #library-books .binding-title, #library-books strong, #library-books small, #library-books h3')];
      const seen=new Set(),probes=[];
      for(const node of nodes){
        if(seen.has(node))continue;seen.add(node);
        const text=node.textContent.trim();
        if(!title||text!==title)continue;
        const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
        node.setAttribute('data-platform-original-probe',String(probes.length));
        probes.push({selector:'[data-platform-original-probe="'+probes.length+'"]',text,visible:!!node.getClientRects().length&&style.visibility!=='hidden'&&style.display!=='none'&&rect.width>0&&rect.height>0});
      }
      return {title,nodes:probes};
    })()`);
    const decision=resolveOriginalTitleProbe({viewportWidth:viewport.width,titleText:candidates.title,nodes:candidates.nodes});
    receipt.android.originalTitleProbe=decision;
    if(decision.kind==='probe')originalSelector=decision.selector;
    else{
      originalSelector=null;
      receipt.checks.push({label:'actual Alice cover original title',selector:null,status:'unsupported',reason:decision.reason});
      receipt.android.limitations.push('Library original title probe unsupported at the actual CSS width '+viewport.width+': '+decision.reason);
    }
  }
  if(originalSelector){
    customNewsreader(await session.fonts(originalSelector,'actual Alice cover original title'));
    // Isolate a glyph in the actual text while preserving inherited typography.
    const punctuation=await cdp.evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(originalSelector)})].find(n=>n.textContent.includes('Alice’s'));if(!n)throw Error('Actual Alice’s title missing');const raw=n.textContent,node=[...n.childNodes].find(n=>n.nodeType===3&&n.textContent.includes('’'));if(!node)throw Error('Actual apostrophe text missing');const i=node.textContent.indexOf('’'),r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);const before=r.getBoundingClientRect().width,span=document.createElement('span');span.id='platform-apostrophe-probe';r.surroundContents(span);const after=span.getBoundingClientRect().width;return {raw,before,after,em:parseFloat(getComputedStyle(span).fontSize)};})()`);
    const apostrophe=await session.fonts('#platform-apostrophe-probe','actual inherited U+2019 glyph');customNewsreader(apostrophe);assert.equal(apostrophe.text,'’');assert.ok(punctuation.after<punctuation.em*.5,'Apostrophe must be proportional');assert.ok(Math.abs(punctuation.before-punctuation.after)<.1,'Probe must preserve actual glyph width');receipt.punctuation=punctuation;
  }
  await session.fonts('#library-books .binding-title','stock CJK book title fallback');await session.capture('library-loaded');
  const shelfPopovers=await cdp.evaluate('('+observeInitialPopovers.toString()+')()');
  (receipt.initialPopovers??=[]).push({page:'library',nodes:shelfPopovers});
  assertInitialPopoversClosed(shelfPopovers,['shelf-filter-panel','library-book-menu']);
  receipt.popoverInteractions=[];
  for(const [trigger,panel,name] of [['#shelf-filter-button','#shelf-filter-panel','library-filter-open'],['#library-books .book-action-trigger','#library-book-menu','library-book-menu-open']]){
    receipt.popoverInteractions.push(await exercisePopoverKeyboard({cdp,trigger,panel,guard:()=>lifecycle.guard('owned remote popover input'),capture:()=>session.capture(name)}));
  }
  lifecycle.guard('reader evidence');
  const bookResponse=await fetch('http://127.0.0.1:'+port+'/api/library/books/gutenberg-alice',{headers:{'X-Reader-Owner':'guest'}});assert.ok(bookResponse.ok,'Actual public source package required');const sourceBook=await bookResponse.json();
  const {sourceEmphasisRanges}=await import(pathToFileURL(path.join(root,'app/source-emphasis.mjs')));
  const sourcePassage=sourceBook.sections.flatMap(section=>section.paragraphs).find(p=>p.original.includes('_very_')&&sourceEmphasisRanges(p.original).length);assert.ok(sourcePassage,'Actual source emphasis passage required');
  const citation=new URLSearchParams({book:sourceBook.bookId,passage:sourcePassage.id,contentVersion:sourceBook.contentVersion,layer:'original'}),italicSelector='#chapter-text [data-id='+JSON.stringify(sourcePassage.id)+'] em.source-emphasis';
  receipt.citation={bookId:sourceBook.bookId,passageId:sourcePassage.id,contentVersion:sourceBook.contentVersion,layer:'original',originalSha256:sha(sourcePassage.original)};
  await session.navigateProduct(origin+'/read?'+citation,{page:'reader'});
  await session.until(()=>cdp.evaluate(`location.pathname==='/read'&&document.readyState==='complete'&&document.body.dataset.ready==='true'&&!!document.querySelector(${JSON.stringify(italicSelector)})`),'ready cited actual reader italic');await cdp.evaluate('document.fonts.ready.then(()=>true)');
  if(args.mode==='android')viewport=await bindAndroidProductViewport({receipt,label:'reader',read:()=>session.viewport('reader')});
  const resolved=await cdp.evaluate(`(()=>{const reader=window.marginaliaReader,book=reader.getBook(),state=reader.getState(),n=document.querySelector(${JSON.stringify(italicSelector)}).closest('.passage'),r=n.getBoundingClientRect();return {url:location.href,bookId:book.bookId,contentVersion:book.contentVersion,mode:state.mode,passageId:n.dataset.id,visible:r.bottom>0&&r.top<innerHeight};})()`);
  assert.equal(resolved.bookId,sourceBook.bookId);assert.equal(resolved.contentVersion,sourceBook.contentVersion);assert.equal(resolved.passageId,sourcePassage.id);assert.equal(resolved.mode,'en');assert.ok(resolved.visible,'Citation target must already be visible before the font probe scrolls');
  assert.ok([origin+'/read?'+citation,origin+'/read?'+new URLSearchParams({book:sourceBook.bookId})].includes(resolved.url),'Only the application’s existing consumed-entry URL cleanup is permitted');receipt.citation.resolved=resolved;
  const italic=await session.fonts(italicSelector,'cited visible source emphasis italic');await session.capture('reader-loaded');
  const readerPopovers=await cdp.evaluate('('+observeInitialPopovers.toString()+')()');
  receipt.initialPopovers.push({page:'reader',nodes:readerPopovers});
  assertInitialPopoversClosed(readerPopovers,['book-info']);
  receipt.readerBookActions={before:await cdp.evaluate('('+observeReaderBookActions.toString()+')()')};
  assert.equal(receipt.readerBookActions.before.giftDialogPresent,false,'Optional gift UI must not mount before opening book-info');
  assert.equal(receipt.readerBookActions.before.shareEnabled,false,'Uninitialized optional actions must stay disabled');
  const remoteGuard=()=>lifecycle.guard('owned remote reader keyboard input');
  const activation=await activateRemoteButton({cdp,trigger:'#reading-tools-trigger',guard:remoteGuard});
  const toolsOpened=await until(async()=>{remoteGuard();const value=await cdp.evaluate('('+observeReaderTools.toString()+')()');return value.expanded==='true'&&value.headerVisible&&!value.headerInert&&value.focusInHeader?value:false;},'actual reading pill to expose navigation',4000);
  receipt.readerTools={...activation,opened:toolsOpened};
  receipt.popoverInteractions.push(await exercisePopoverKeyboard({cdp,trigger:'#open-book-info',panel:'#book-info',guard:remoteGuard,capture:()=>session.capture('reader-book-info-open'),afterOpened:async()=>{
    receipt.readerBookActions.opened=await until(async()=>{remoteGuard();const value=await cdp.evaluate('('+observeReaderBookActions.toString()+')()');return value.ready?value:false;},'actual optional book actions to initialize',4000);
  }}));
  await session.until(()=>receipt.fonts.some(font=>font.url.endsWith('newsreader-var.woff2'))&&receipt.fonts.some(font=>font.url.endsWith('newsreader-italic-var.woff2')),'both actual font responses');
  receipt.italicFontEvidence=italicFontEvidence(italic,{browserProduct:receipt.browser.product,fontFaces:receipt.fontFaces,fontResponses:receipt.fonts,origin,expectedSha256:sha(await readFile(path.join(root,'app/fonts/newsreader/newsreader-italic-var.woff2')))});
  if(receipt.italicFontEvidence.limitation)(receipt.capabilityLimitations??=[]).push(receipt.italicFontEvidence.limitation);
  if(args.mode==='android')receipt.android.wmCssConsistency={wm:receipt.android.wm,productViewports:receipt.android.productViewports};
  await Promise.all(session.background);assert.deepEqual(session.failures,[],'All evidence tasks must succeed');
  assert.deepEqual(receipt.errors,[],'Unexpected page/runtime/network errors require review');
  assert.ok(receipt.screenshots.length<=(args.mode==='android'?12:10),'Bounded screenshot budget must hold');
}catch(error){receipt.result='failed';receipt.failure=error.stack;process.exitCode=1;await captureFailurePage({session,receipt,lifecycle});}
finally{
  // Single bounded idempotent finalizer: normal, error and cancelled paths all
  // release only owned resources and leave the status to the result gate.
  await lifecycle.finalize();
}
