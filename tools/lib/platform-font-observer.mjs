// Shared remote CDP font/typography observation for the platform acceptance
// paths (owned desktop Chrome and the task-owned Android AVD). The behavior is
// identical to the original desktop harness: bounded protocol timeouts, font
// response background failures and draining, one specific nodeId re-resolution
// receipt for invalidations (never assertion retries) and byte-exact font
// response verification against the checkout.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function until(operation,label,ms=30000,failures=[]){
  const deadline=Date.now()+ms;let last;
  while(Date.now()<deadline){
    if(failures.length)throw Error('Evidence task failed: '+failures.join('; '));
    try{const value=await operation();if(value)return value;}catch(error){last=error;}
    await delay(100);
  }
  throw Error('Timed out: '+label+(last?' ('+last.message+')':''));
}
// Platform font usage includes ::before: language links have a Latin middle dot
// separator. Keep that real parent record, then isolate every existing CJK text
// run without inventing text or accepting Latin .notdef as CJK.
const CJK_RUN=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]+/gu;
export function stockSans(value){
  assert.ok(value.fonts.length&&value.fonts.every(font=>!font.isCustomFont&&font.glyphCount>0),value.label+' must render actual stock sans glyphs');
}
export function customNewsreader(value){
  assert.ok(value.fonts.some(font=>font.isCustomFont&&/Newsreader/i.test(font.postScriptName||font.familyName)&&font.glyphCount>0),value.label+' must render actual custom Newsreader glyphs');
}
// Serialized read-only default-state observation. Chrome113 has no Popover API
// or :popover-open selector, so never query that selector to inspect its fallback.
// Font checks alone must not accept a painted, supposedly closed control.
export function observeInitialPopovers(){
  return [...document.querySelectorAll('[popover]')].map(node=>{
    const style=getComputedStyle(node);
    return {id:node.id,nativePopover:typeof node.showPopover==='function',rects:node.getClientRects().length,display:style.display,visibility:style.visibility};
  });
}
export function assertInitialPopoversClosed(nodes,requiredIds){
  assert.ok(Array.isArray(nodes),'Actual popover observations required');
  for(const id of requiredIds)assert.ok(nodes.some(node=>node.id===id),id+' control required');
  for(const node of nodes)assert.equal(node.rects,0,node.id+' must be closed before any user action');
}
// Remote hosted-runner keyboard acceptance only. This never executes on a Mac:
// the admitting entry point creates the owned CDP transport after its guard.
// DOM.focus focuses the observed real button; Enter/Escape go through Chrome's
// input protocol, never element.click(), handler calls or application state edits.
async function dispatchRemoteKey(cdp,guard,name,code){
  // Enter needs its character phase; raw Tab/Escape have no text.
  guard();await cdp.send('Input.dispatchKeyEvent',{type:name==='Enter'?'keyDown':'rawKeyDown',key:name,code:name,windowsVirtualKeyCode:code,...(name==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
  guard();await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code});
}
export async function activateRemoteButton({cdp,trigger,panel=null,guard=()=>{}}){
  const evaluate=expression=>{guard();return cdp.evaluate(expression);};
  const send=(method,params)=>{guard();return cdp.send(method,params);};
  const read=()=>evaluate('('+observePopoverState.toString()+')('+JSON.stringify(trigger)+','+JSON.stringify(panel)+')');
  const scroll=await evaluate('('+observeNativeScroll.toString()+')('+JSON.stringify(trigger)+')');
  assert.ok(['settled','unchanged'].includes(scroll.status),'Real button must finish native scrolling: '+JSON.stringify({trigger,...scroll}));
  const before=await read();
  assert.ok(before.trigger?.visible&&!before.trigger.disabled&&!before.trigger.inert,'Real usable popover trigger required');
  if(panel)assert.equal(before.panel?.visible,false,'Popover must start closed');
  const {root}=await send('DOM.getDocument');
  const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:trigger});
  assert.ok(nodeId,'Real button node required');await send('DOM.focus',{nodeId});
  const focused=await read();assert.equal(focused.focusOnTrigger,true,'Observed trigger must actually receive focus');
  await dispatchRemoteKey(cdp,guard,'Enter',13);
  return {scroll,before,input:'remote Chrome DOM.focus + trusted keyboard protocol; no physical touch claim'};
}
export async function exercisePopoverKeyboard({cdp,trigger,panel,capture,afterOpened,guard=()=>{}}){
  const read=()=>{guard();return cdp.evaluate('('+observePopoverState.toString()+')('+JSON.stringify(trigger)+','+JSON.stringify(panel)+')');};
  const activation=await activateRemoteButton({cdp,trigger,panel,guard});
  await until(async()=>{const value=await read();return value.panel?.visible&&value.expanded==='true'?value:false;},'real popover to open',4000);
  let opened=await read();
  if(!opened.focusInPanel){await dispatchRemoteKey(cdp,guard,'Tab',9);opened=await read();}
  assert.ok(opened.focusInPanel,'Keyboard must reach a real control inside the open popover');
  if(afterOpened){
    guard();await afterOpened();opened=await read();
    assert.ok(opened.panel?.visible&&opened.expanded==='true'&&opened.focusInPanel,'Enhancement readiness must preserve the actual open chooser and focus');
  }
  const openedBeforePaint=opened;
  guard();const paint=await cdp.evaluate('('+observePopoverPaint.toString()+')('+JSON.stringify(panel)+')');
  assert.equal(paint.status,'settled','Open popover paint must settle before capture: '+JSON.stringify(paint));
  opened=await read();
  assert.ok(opened.panel?.visible&&opened.expanded==='true'&&opened.focusInPanel,'Settled paint must preserve the actual chooser and focus');
  guard();await capture();await dispatchRemoteKey(cdp,guard,'Escape',27);
  const closed=await until(async()=>{const value=await read();return !value.panel?.visible&&value.expanded==='false'?value:false;},'real popover to close',4000);
  assert.equal(closed.focusOnTrigger,true,'Escape must return focus to the actual visible opener');
  assert.equal(closed.url,activation.before.url,'Opening/closing a chooser must preserve the entry URL');
  return {trigger,panel,...activation,openedBeforePaint,paint,opened,closed};
}
// Serialized, read-only paint evidence. getAnimations includes CSS transitions:
// https://developer.mozilla.org/en-US/docs/Web/API/Element/getAnimations
// Observe the surface and ancestors, not unrelated descendants such as spinners.
// Never disable motion, finish animations, move a node or substitute a sleep.
export function observePopoverPaint(selector){
  const target=document.querySelector(selector),started=performance.now();
  let frame,timer,done=false,frames=0,stable=0,previous=null,lastChange=started,before=null,last=null;
  const history=[];
  const sample=()=>{
    if(!target)throw Error('Popover surface missing');
    const r=target.getBoundingClientRect(),nodes=[];
    for(let node=target;node;node=node.parentElement){
      if(nodes.length>=64||typeof node.getAnimations!=='function')throw Error('Bounded actual animation observation unavailable');
      const s=getComputedStyle(node),animations=node.getAnimations();
      if(animations.length>32)throw Error('Popover animation evidence exceeds its bound');
      nodes.push({id:node.id||null,opacity:Number(s.opacity),display:s.display,visibility:s.visibility,transform:s.transform,translate:s.translate,scale:s.scale,rotate:s.rotate,activeAnimations:animations.filter(a=>a.pending||!['finished','idle'].includes(a.playState)).length});
    }
    const rect={x:r.x,y:r.y,width:r.width,height:r.height},connected=target.isConnected&&document.querySelector(selector)===target;
    const ready=!!connected&&!!target.getClientRects().length&&r.width>0&&r.height>0&&r.x+r.width>0&&r.y+r.height>0&&r.x<innerWidth&&r.y<innerHeight&&nodes.every(n=>n.opacity===1&&n.activeAnimations===0&&n.display!=='none'&&!['hidden','collapse'].includes(n.visibility));
    return {connected,rect,nodes,ready};
  };
  return new Promise(resolve=>{
    const finish=(status,error=null)=>{if(done)return;done=true;clearTimeout(timer);cancelAnimationFrame(frame);resolve({status,error,before,after:last,frames,history,elapsedMs:performance.now()-started});};
    const tick=()=>{
      try{
        last=sample();const now=performance.now();frames++;
        if(history.length<16)history.push({at:now-started,...last});
        const signature=JSON.stringify(last);
        if(signature===previous)stable++;else{stable=0;lastChange=now;}previous=signature;
        if(last.ready&&stable>=4&&now-lastChange>=100)return finish('settled');
        frame=requestAnimationFrame(tick);
      }catch(error){finish('unsupported',error.message);}
    };
    try{before=last=sample();}catch(error){finish('unsupported',error.message);return;}
    timer=setTimeout(()=>{try{last=sample();finish('timeout');}catch(error){finish('timeout',error.message);}},4000);frame=requestAnimationFrame(tick);
  });
}
// Serialized read-only facts for the owned remote input sequence above.
export function observePopoverState(triggerSelector,panelSelector){
  const trigger=document.querySelector(triggerSelector),panel=panelSelector?document.querySelector(panelSelector):null;
  const describe=node=>{
    if(!node)return null;
    const r=node.getBoundingClientRect(),style=getComputedStyle(node);
    return {id:node.id,visible:!!node.getClientRects().length&&style.visibility!=='hidden'&&style.display!=='none'&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth,disabled:!!node.disabled,inert:!!node.closest('[inert]'),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
  };
  return {url:location.href,trigger:describe(trigger),panel:describe(panel),expanded:trigger?.getAttribute('aria-expanded'),focusOnTrigger:document.activeElement===trigger,focusInPanel:!!panel?.contains(document.activeElement)};
}
// Serialized read-only proof that the normal reading pill really exposed its
// navigation before the remote sequence focuses book-info. No app state edits.
export function observeReaderTools(){
  const pill=document.getElementById('reading-tools-trigger'),header=document.getElementById('reading-header');
  const r=header?.getBoundingClientRect(),style=header?getComputedStyle(header):null;
  return {expanded:pill?.getAttribute('aria-expanded'),headerInert:!!header?.inert,headerVisible:!!header?.getClientRects().length&&style.display!=='none'&&style.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth,focusInHeader:!!header?.contains(document.activeElement)};
}
// The real enabled share control plus its closed native gift dialog prove that
// the optional code mounted. The basic bookplate alone cannot satisfy this.
export function observeReaderBookActions(){
  const share=document.getElementById('book-info-share'),gift=document.getElementById('reader-book-gift'),style=share?getComputedStyle(share):null;
  const rect=share?.getBoundingClientRect(),rendered=!!share?.getClientRects().length&&style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
  const shareEnabled=share?.tagName==='BUTTON'&&!share.disabled,giftDialogPresent=gift?.tagName==='DIALOG',giftDialogOpen=!!gift?.open;
  return {ready:rendered&&shareEnabled&&giftDialogPresent&&!giftDialogOpen,shareRendered:rendered,shareEnabled,giftDialogPresent,giftDialogOpen};
}
// Serialized read-only readiness observation. Width never decides readiness:
// a stable wide viewport completes here and fails the separate assertion once.
export function observeViewportReadiness(){
  const start=performance.now();let frame,timer,finished=false,previous=null,stable=0,lastChange=start,frames=0;
  const history=[];
  const sample=()=>{
    const seen=new Set();
    const readable=(sheet,depth=0)=>{if(!sheet||depth>8||seen.size>128)return false;if(seen.has(sheet))return true;seen.add(sheet);try{return [...sheet.cssRules].filter(rule=>rule.type===3).every(rule=>readable(rule.styleSheet,depth+1));}catch{return false;}};
    const styles=[...document.querySelectorAll('link[rel~="stylesheet"]')].filter(link=>!link.disabled&&(!link.media||matchMedia(link.media).matches)).map(link=>({href:link.href,ready:readable(link.sheet)}));
    return {url:location.href,readyState:document.readyState,meta:document.querySelector('meta[name="viewport"]')?.content??null,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,ua:navigator.userAgent},root:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth},visualViewport:globalThis.visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft}:null,styles,ready:document.readyState!=='loading'&&styles.length>0&&styles.every(style=>style.ready)};
  };
  const before=sample();
  return new Promise(resolve=>{
    const finish=status=>{if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);resolve({status,before,after:sample(),frames,history,elapsedMs:performance.now()-start});};
    const tick=()=>{
      const value=sample(),now=performance.now();frames++;
      if(history.length<16)history.push({at:now-start,viewport:value.viewport,root:value.root,readyState:value.readyState,stylesReady:value.ready});
      const signature=JSON.stringify([value.url,value.viewport,value.root.clientWidth,value.ready]);
      if(signature===previous)stable++;else{stable=0;lastChange=now;}previous=signature;
      if(value.ready&&stable>=3&&now-lastChange>=100)return finish('ready');
      frame=requestAnimationFrame(tick);
    };
    timer=setTimeout(()=>finish('timeout'),10000);frame=requestAnimationFrame(tick);
  });
}
export async function captureFailurePage({session,receipt,lifecycle}={}){
  if(!session||lifecycle?.stopped||lifecycle?.stopping||lifecycle?.cancelled||(receipt.screenshots?.length||0)>=12)return false;
  try{await session.capture('failure-page');return true;}catch(error){(receipt.secondaryEvidenceErrors??=[]).push(error.message);return false;}
}
// Read the actual current document, not a frame-less protocol event. The
// source product has one public typography stylesheet; no DOM/style changes.
export function observeDocumentFontFaces(){
  const clean=family=>family.replace(/^["']|["']$/g,'');
  const sheets=[...document.styleSheets].filter(sheet=>sheet.href&&new URL(sheet.href).origin===location.origin&&new URL(sheet.href).pathname==='/typography.css');
  const declared=sheets.flatMap(sheet=>[...sheet.cssRules].filter(rule=>rule.type===5).map(({style})=>({family:clean(style.getPropertyValue('font-family')),style:style.getPropertyValue('font-style')||'normal',weight:style.getPropertyValue('font-weight')||'normal',stretch:style.getPropertyValue('font-stretch')||'normal',src:style.getPropertyValue('src')}))).filter(face=>face.family==='Leafhour Serif');
  const loaded=[...document.fonts].filter(face=>clean(face.family)==='Leafhour Serif'&&face.status==='loaded').map(face=>({family:clean(face.family),style:face.style,weight:face.weight,stretch:face.stretch,status:face.status}));
  return {stylesheetCount:sheets.length,declared,loaded};
}
// Chrome 113's actual protocol has no per-node PostScript name. Keep that
// capability limit explicit: a loaded CSS face is not a per-node identity.
export function italicFontEvidence(value,{browserProduct,fontFaces=[],fontResponses=[],origin,expectedSha256}={}){
  customNewsreader(value);assert.equal(value.text,'very');assert.equal(value.style,'italic');
  const used=value.fonts.filter(font=>font.glyphCount>0);
  assert.equal(used.length,1,'The actual four italic glyphs must use one custom face');
  assert.equal(used[0].glyphCount,4);assert.equal(used[0].isCustomFont,true);
  if(typeof used[0].postScriptName==='string'){
    assert.match(used[0].postScriptName,/Italic/i,'Actual italic PostScript identity required');
    return {method:'postscript-name',postScriptName:used[0].postScriptName,requiresVisualReview:true};
  }
  assert.equal(browserProduct,'Chrome/113.0.5672.136','Missing identity is supported only by the verified stock Chrome 113 schema');
  const doc=value.document;
  assert.ok(doc?.epoch>0&&doc.loaderId&&new URL(doc.url).origin===origin&&new URL(doc.url).pathname==='/read','Reader document identity required');
  const expectedUrl=new URL('/fonts/newsreader/newsreader-italic-var.woff2',origin).href;
  const sourceUrl=src=>{
    if(typeof src!=='string')return null;
    const match=/^url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)(?:\s+format\(\s*["']woff2["']\s*\))?\s*$/.exec(src);
    try{return new URL(match?(match[1]||match[2]||match[3]):src,origin).href;}catch{return null;}
  };
  const current=value.documentFontFaces;
  assert.equal(current?.stylesheetCount,1,'One actual main-document typography stylesheet required');
  const declared=current.declared.filter(face=>face.family==='Leafhour Serif'&&face.style==='italic');
  const loaded=current.loaded.filter(face=>face.family==='Leafhour Serif'&&face.style==='italic');
  assert.equal(declared.length,1,'Unique main-document italic CSS declaration required');
  assert.equal(loaded.length,1,'Unique loaded main-document italic FontFace required');
  assert.equal(sourceUrl(declared[0].src),expectedUrl,'Main-document italic CSS source must match');
  assert.ok(loaded[0].status==='loaded'&&loaded[0].weight===declared[0].weight&&loaded[0].stretch===declared[0].stretch,'Main-document FontFace descriptors must match its declaration');
  // This event has no source-frame identity. Record it only as supplementary
  // successful-load evidence received during this document, never stamp it as
  // proof of the document that initiated the font load.
  const face=fontFaces.find(face=>face.observedDuringDocument?.epoch===doc.epoch&&face.observedDuringDocument?.loaderId===doc.loaderId&&face.fontStyle==='italic'&&String(face.fontFamily||'').replace(/^["']|["']$/g,'')==='Leafhour Serif'&&face.platformFontFamily===used[0].familyName&&sourceUrl(face.src)===expectedUrl);
  assert.ok(face,'Supplementary successful italic face load event required');
  const response=fontResponses.find(font=>font.document?.epoch===doc.epoch&&font.document?.loaderId===doc.loaderId&&font.document?.frameId===doc.frameId&&font.url===expectedUrl&&font.type==='Font'&&font.status===200&&font.sha256===expectedSha256);
  assert.ok(response,'Same-document byte-verified italic response required');
  return {method:'css-matching-and-visual',requiresVisualReview:true,perNodePostScriptIdentity:false,document:doc,glyphs:used[0],documentFontFaces:current,supplementaryLoadEvent:face,response:{url:response.url,sha256:response.sha256,bytes:response.bytes},limitation:'Stock Chrome 113 does not expose a per-node PostScript identity. Main-document loaded-face and CSS matching evidence requires independent visual confirmation of the cited very; fontsUpdated does not identify its source document.'};
}
// Serialized into the remote page. Chrome113 maps scrollIntoView's "instant"
// to auto, which respects the page's native smooth scrolling. Observe one real
// request's completion; never change CSS or retry a visibility/font assertion.
export function observeNativeScroll(selector){
  const node=document.querySelector(selector);if(!node)throw Error('Missing target');
  const scrollers=[document.scrollingElement];
  for(let parent=node.parentElement;parent;parent=parent.parentElement){
    const style=getComputedStyle(parent);
    if(!scrollers.includes(parent)&&(parent.scrollHeight>parent.clientHeight&&/auto|scroll|hidden/.test(style.overflowY)||parent.scrollWidth>parent.clientWidth&&/auto|scroll|hidden/.test(style.overflowX)))scrollers.push(parent);
  }
  const pixels=value=>parseFloat(value)||0,margin=getComputedStyle(node);
  // A viewport-fixed control occupies the physical viewport, including the
  // header area that prose scroll-padding reserves. A transformed/contained
  // ancestor can instead establish its fixed containing block: retain the
  // strict root-padding path in that case. Start above the fixed box itself;
  // its own backdrop-filter does not change its containing block.
  // https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block
  const fixedToViewport=()=>{
    let fixed=node;
    while(fixed&&getComputedStyle(fixed).position!=='fixed')fixed=fixed.parentElement;
    if(!fixed)return false;
    for(let parent=fixed.parentElement;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);
      if(['transform','translate','rotate','scale','perspective','filter','backdropFilter'].some(key=>style[key]&&style[key]!=='none')||/\b(layout|paint|strict|content)\b/.test(style.contain||'')||/\b(transform|translate|rotate|scale|perspective|filter|backdrop-filter|contain|content-visibility)\b/.test(style.willChange||'')||['auto','hidden'].includes(style.contentVisibility))return false;
    }
    return true;
  };
  const sample=()=>{
    const r=node.getBoundingClientRect(),viewportFixed=fixedToViewport();
    return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewportFixed,positions:scrollers.map(element=>({left:element.scrollLeft,top:element.scrollTop})),scrollports:scrollers.map((element,index)=>{
      const style=getComputedStyle(element),rect=index?element.getBoundingClientRect():{x:0,y:0},left=rect.x+(index?element.clientLeft:0),top=rect.y+(index?element.clientTop:0);
      const padding=side=>!index&&viewportFixed?0:pixels(style['scrollPadding'+side]);
      return {left:left+padding('Left'),top:top+padding('Top'),right:left+(index?element.clientWidth:innerWidth)-padding('Right'),bottom:top+(index?element.clientHeight:innerHeight)-padding('Bottom'),maxLeft:Math.max(0,element.scrollWidth-element.clientWidth),maxTop:Math.max(0,element.scrollHeight-element.clientHeight),position:style.position,overflowX:style.overflowX,overflowY:style.overflowY,behavior:style.scrollBehavior};
    }),scrollX,scrollY};
  };
  const needs=value=>value.scrollports.flatMap((port,index)=>{
    const r=value.rect,left=r.x-pixels(margin.scrollMarginLeft),right=r.x+r.width+pixels(margin.scrollMarginRight),top=r.y-pixels(margin.scrollMarginTop),bottom=r.y+r.height+pixels(margin.scrollMarginBottom);
    const movable=(start,end,low,high,current,max)=>{
      if(start>=low&&end<=high||start<=low&&end>=high)return false;
      const small=end-start<=high-low,delta=start<low?(small?start-low:end-high):(small?end-high:start-low);
      return Math.abs(Math.max(0,Math.min(max,current+delta))-current)>.1;
    };
    return movable(left,right,port.left,port.right,value.positions[index].left,port.maxLeft)||movable(top,bottom,port.top,port.bottom,value.positions[index].top,port.maxTop)?[index]:[];
  });
  const before=sample(),startedAt=performance.now(),required=needs(before),needsMovement=required.length>0;
  return new Promise(resolve=>{
    const startedScrollers=new Set();
    const frameTimes=[];
    let previous=before,started=false,scrollEvents=0,scrollEndEvents=0,frames=0,stableFrames=0,positionStableFrames=0,lastChange=startedAt,frame,timer,finished=false;
    const onScroll=event=>{const index=scrollers.indexOf(event.target===document?document.scrollingElement:event.target);if(index<0)return;startedScrollers.add(index);scrollEvents++;started=true;lastChange=performance.now();};
    const onEnd=()=>{scrollEndEvents++;};
    const finish=(status,error=null)=>{
      if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);
      document.removeEventListener('scroll',onScroll,true);document.removeEventListener('scrollend',onEnd,true);
      resolve({status,error,before,after:sample(),needsMovement,started,startedScrollers:[...startedScrollers],scrollEvents,scrollEndEvents,frames,frameTimes,deadlineMs:10000,visibility:document.visibilityState??null,hasFocus:document.hasFocus?.()??null,elapsedMs:performance.now()-startedAt});
    };
    const tick=()=>{
      const current=sample(),now=performance.now();frames++;
      if(frameTimes.length<16)frameTimes.push(now-startedAt);
      let moved=false;current.positions.forEach((position,index)=>{if(position.left!==previous.positions[index].left||position.top!==previous.positions[index].top){moved=true;startedScrollers.add(index);}});
      const changed=moved||Object.keys(current.rect).some(key=>Math.abs(current.rect[key]-previous.rect[key])>.1);
      if(moved)started=true;
      positionStableFrames=moved?0:positionStableFrames+1;
      if(changed){lastChange=now;stableFrames=0;}else stableFrames++;
      previous=current;
      const currentNeeds=needs(current);
      if(started&&stableFrames>=4&&now-lastChange>=100&&!currentNeeds.some(index=>!startedScrollers.has(index)))return finish('settled');
      if(!started&&!currentNeeds.length&&positionStableFrames>=2)return finish('unchanged');
      frame=requestAnimationFrame(tick);
    };
    document.addEventListener('scroll',onScroll,true);document.addEventListener('scrollend',onEnd,true);
    timer=setTimeout(()=>finish('timeout'),10000);
    try{node.scrollIntoView({block:'nearest',behavior:'auto'});}catch(error){finish('error',error.message);return;}
    frame=requestAnimationFrame(tick);
  });
}
export function createEvidenceSession({cdp,out,receipt,root,origin,failures=[]}){
  const background=new Set(),evidenceListeners=[],paused=new Set(),pausedNetworkIds=new Map();
  let fetchEnabled=false,holdFonts=false,fontHoldInstalledAt=null,pageLabel='home-cold',closed=false;
  let documentEpoch=0,currentDocument=null;
  const requestFonts=new Map(),fontRequestDocuments=new Map(),retiredDocuments=new Map();
  const documentKey=font=>font.frameId&&font.loaderId?JSON.stringify([font.frameId,font.loaderId]):null;
  const observe=(method,handler)=>evidenceListeners.push(cdp.on(method,handler));
  function task(operation){const promise=Promise.resolve(operation).catch(error=>failures.push(error.message)).finally(()=>background.delete(promise));background.add(promise);}
  async function capture(name){
    assert.ok(receipt.screenshots.length<12,'Bounded screenshot budget exceeded');
    const {data}=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const bytes=Buffer.from(data,'base64');
    await writeFile(path.join(out,name+'.png'),bytes);
    receipt.screenshots.push({file:name+'.png',bytes:bytes.length,sha256:sha(bytes)});
  }
  async function fonts(selector,label,{awaitFonts=true}={}){
    receipt.activeProbe={selector,label,phase:'layout'};
    if(awaitFonts)await cdp.evaluate('document.fonts.ready.then(()=>true)');
    // Withheld fonts must stay pending, but the authored document's CSS must
    // have parsed before a native scroll can produce meaningful coordinates.
    // This observes existing styles/viewport; it never loads or releases fonts.
    else await viewport(label+' styles');
    const scroll=await cdp.evaluate('('+observeNativeScroll.toString()+')('+JSON.stringify(selector)+')');
    (receipt.scrolls??=[]).push({label,selector,...scroll});
    assert.ok(['settled','unchanged'].includes(scroll.status),label+' native scrolling must complete within the bounded observation');
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
    const details=await cdp.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n),r=n.getBoundingClientRect();return {text:n.textContent,font:s.font,fontFamily:s.fontFamily,style:s.fontStyle,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,fontStatus:document.fonts.status,visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft}:null},visible:!!n.getClientRects().length&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight};})()`);
    const value={label,selector,...details,...usage,document:currentDocument,documentFontFaces:label==='cited visible source emphasis italic'?await cdp.evaluate('('+observeDocumentFontFaces.toString()+')()'):null};
    receipt.checks.push(value);
    assert.ok(details.visible,label+' must actually render inside the viewport');
    delete receipt.activeProbe;
    return value;
  }
  async function viewport(label){
    const proof=await cdp.evaluate('('+observeViewportReadiness.toString()+')()');
    (receipt.viewportReadiness??=[]).push({label,...proof});
    assert.equal(proof.status,'ready',label+' requires parsed styles and a stable native viewport');
    return proof.after.viewport;
  }
  async function cjkGlyphs(selector,label,{serif=false}={}){
    await fonts(selector,label+' including generated punctuation');
    const probes=await cdp.evaluate(String.raw`(()=>{
      const target=document.querySelector(${JSON.stringify(selector)}),original=target.textContent,before=target.getBoundingClientRect();
      const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
      const probes=[];for(const node of nodes){
        const matches=[...node.textContent.matchAll(${String(CJK_RUN)})];
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
    for(const probe of probes){
      const value=await fonts(probe.selector,label+' direct CJK text');
      assert.equal(value.text,probe.text);
      assert.ok(value.fonts.length&&value.fonts.every(font=>font.glyphCount>0&&allowed.test(font.postScriptName||font.familyName)),label+' requires covered CJK glyphs, not Latin missing glyphs');
      value.probeWidths={before:probe.before,after:probe.after};
    }
  }
  function observeResponses(){
    observe('Page.frameNavigated',({frame})=>{
      if(frame.parentId)return;
      const previous=currentDocument;currentDocument={epoch:++documentEpoch,frameId:frame.id,loaderId:frame.loaderId,url:frame.url};
      if(!previous?.loaderId||previous.frameId!==frame.id||previous.loaderId===frame.loaderId)return;
      retiredDocuments.set(documentKey(previous),currentDocument);
      // A replaced document can lose a Fetch interception without a separate
      // loadingFailed event. Bind retirement to the request's wire frame and
      // loader IDs, not the mutable page label or an arbitrary protocol error.
      for(const [requestId,networkId]of pausedNetworkIds){const source=fontRequestDocuments.get(networkId);if(source?.frameId===previous.frameId&&source.loaderId===previous.loaderId){
        paused.delete(requestId);pausedNetworkIds.delete(requestId);
        (receipt.replacedDocumentFontRequests??=[]).push({requestId,networkId,...source,replacedBy:currentDocument});
      }}
    });
    observe('Network.requestWillBeSent',event=>{if(event.type==='Font')fontRequestDocuments.set(event.requestId,{frameId:event.frameId,loaderId:event.loaderId,url:event.request.url});});
    observe('CSS.fontsUpdated',({font})=>{if(!font||!/Newsreader/i.test(font.platformFontFamily||''))return;if((receipt.fontFaces?.length||0)>=32){failures.push('Bounded Newsreader face evidence exceeded');return;}(receipt.fontFaces??=[]).push({page:pageLabel,...font,observedDuringDocument:currentDocument});});
    observe('Network.responseReceived',event=>{if(event.type==='Font'||event.type==='Stylesheet'&&/\/(?:fonts\/|typography\.css)/.test(new URL(event.response.url).pathname))requestFonts.set(event.requestId,{page:pageLabel,frameId:event.frameId,loaderId:event.loaderId,type:event.type,url:event.response.url,status:event.response.status,mime:event.response.mimeType,fromDiskCache:event.response.fromDiskCache,fromServiceWorker:event.response.fromServiceWorker,document:currentDocument&&event.frameId===currentDocument.frameId&&event.loaderId===currentDocument.loaderId?currentDocument:null});});
    observe('Network.loadingFinished',event=>{
      const font=requestFonts.get(event.requestId);if(!font)return;
      requestFonts.delete(event.requestId);
      task((async()=>{
        let body;
        try{body=await cdp.send('Network.getResponseBody',{requestId:event.requestId});}
        catch(error){
          // Only an observed main-document replacement explains an evicted old
          // body. Never accept it as byte evidence or suppress an unavailable
          // current/unknown response, a hash failure or another transport error.
          const replacedBy=retiredDocuments.get(documentKey(font));
          if(replacedBy&&/^Network\.getResponseBody:.*No resource with given identifier found/.test(error.message)){
            (receipt.discardedFontResponses??=[]).push({...font,requestId:event.requestId,replacedBy,byteVerified:false,error:error.message});return;
          }
          (receipt.responseBodyFailures??=[]).push({...font,requestId:event.requestId,error:error.message});
          throw Error(error.message+' ['+font.url+'; frame='+font.frameId+'; loader='+font.loaderId+']');
        }
        assert.ok(font.type!=='Font'||body.base64Encoded,'Binary WOFF2 response body expected');
        const bytes=Buffer.from(body.body,body.base64Encoded?'base64':'utf8'),source=await readFile(path.join(root,'app',new URL(font.url).pathname));
        assert.equal(sha(bytes),sha(source),'Browser font bytes must match checkout');
        receipt.fonts.push({...font,bytes:bytes.length,encodedDataLength:event.encodedDataLength,sha256:sha(bytes)});
      })());
    });
    observe('Network.loadingFailed',event=>{
      if(!event.canceled){receipt.errors.push({type:'network',error:event.errorText,blockedReason:event.blockedReason});return;}
      // The automatic root entry can replace itself with an authored route.
      // Chrome cancels the old document's held font requests, invalidating
      // their Fetch IDs. Retire only an exact Network cancellation match;
      // arbitrary interception/transport errors still fail the evidence run.
      for(const [requestId,networkId]of pausedNetworkIds)if(networkId&&networkId===event.requestId){
        paused.delete(requestId);pausedNetworkIds.delete(requestId);
        (receipt.cancelledFontRequests??=[]).push({requestId,networkId,error:event.errorText,document:currentDocument});
      }
    });
    observe('Runtime.exceptionThrown',event=>receipt.errors.push({type:'runtime',message:event.exceptionDetails.text,exception:event.exceptionDetails.exception?.description}));
    observe('Fetch.requestPaused',event=>{if(holdFonts){paused.add(event.requestId);pausedNetworkIds.set(event.requestId,event.networkId);return;}task(cdp.send('Fetch.continueRequest',{requestId:event.requestId}));});
  }
  async function installFontHold(){
    if(closed)throw Error('Evidence session is closed; refusing late font interception');
    assert.ok(!fontHoldInstalledAt,'Cold-font interception is installed once before product navigation');
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/fonts/newsreader/*.woff2',requestStage:'Request'}]});
    fetchEnabled=true;holdFonts=true;fontHoldInstalledAt=new Date().toISOString();
  }
  async function releaseFontHold(){
    holdFonts=false;
    for(const requestId of paused){paused.delete(requestId);pausedNetworkIds.delete(requestId);await cdp.send('Fetch.continueRequest',{requestId});}
  }
  // Product navigation is refused until cold-font interception is installed,
  // and only the task-owned loopback origin is a product page.
  async function navigateProduct(url,{page:nextPage}={}){
    if(closed)throw Error('Evidence session is closed; refusing late product navigation');
    if(!fontHoldInstalledAt)throw Error('Cold-font interception must be installed before any product navigation');
    if(!origin||typeof url!=='string'||!url.startsWith(origin))throw Error('Product navigation must stay on the owned origin: '+String(url));
    // Navigation invalidates response-body IDs. Finish byte verification of
    // the accepted document before leaving it; a failed read remains failed.
    while(background.size)await Promise.all([...background]);
    if(failures.length)throw Error('Evidence task failed: '+failures.join('; '));
    if(closed)throw Error('Evidence session is closed; refusing late product navigation');
    if(nextPage)pageLabel=nextPage;
    await cdp.send('Page.navigate',{url});
  }
  async function close({beforeDisconnect}={}){
    if(closed)return {errors:failures};
    closed=true;
    if(!cdp)return {errors:failures};
    await cdp.send('Page.stopLoading').catch(error=>failures.push(error.message));
    if(fetchEnabled){holdFonts=false;for(const requestId of paused){paused.delete(requestId);pausedNetworkIds.delete(requestId);await cdp.send('Fetch.continueRequest',{requestId}).catch(error=>failures.push(error.message));}await cdp.send('Fetch.disable').catch(error=>failures.push(error.message));}
    // End observation before draining: a snapshot of a growing Set is insufficient.
    for(const unsubscribe of evidenceListeners)unsubscribe();
    receipt.observationClosedAt=new Date().toISOString();
    while(background.size)await Promise.all([...background]);
    if(beforeDisconnect)await Promise.resolve().then(beforeDisconnect).catch(error=>failures.push('owned browser shutdown: '+error.message));
    await cdp.close().catch(error=>failures.push(error.message));
    return {errors:failures};
  }
  return {
    failures,background,observe,task,
    until:(operation,label,ms)=>until(operation,label,ms,failures),
    capture,fonts,cjkGlyphs,customNewsreader,viewport,
    setPageLabel:label=>{pageLabel=label;},
    observeResponses,installFontHold,releaseFontHold,navigateProduct,close,
    paused,
  };
}
