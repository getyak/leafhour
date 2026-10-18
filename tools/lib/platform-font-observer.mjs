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
export function customNewsreader(value){
  assert.ok(value.fonts.some(font=>font.isCustomFont&&/Newsreader/i.test(font.postScriptName||font.familyName)&&font.glyphCount>0),value.label+' must render actual custom Newsreader glyphs');
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
  const sample=()=>{
    const r=node.getBoundingClientRect();
    return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},positions:scrollers.map(element=>({left:element.scrollLeft,top:element.scrollTop})),scrollports:scrollers.map((element,index)=>{
      const style=getComputedStyle(element),rect=index?element.getBoundingClientRect():{x:0,y:0},left=rect.x+(index?element.clientLeft:0),top=rect.y+(index?element.clientTop:0);
      return {left:left+pixels(style.scrollPaddingLeft),top:top+pixels(style.scrollPaddingTop),right:left+(index?element.clientWidth:innerWidth)-pixels(style.scrollPaddingRight),bottom:top+(index?element.clientHeight:innerHeight)-pixels(style.scrollPaddingBottom)};
    }),scrollX,scrollY};
  };
  const needs=value=>value.scrollports.flatMap((port,index)=>{
    const r=value.rect,left=r.x-pixels(margin.scrollMarginLeft),right=r.x+r.width+pixels(margin.scrollMarginRight),top=r.y-pixels(margin.scrollMarginTop),bottom=r.y+r.height+pixels(margin.scrollMarginBottom);
    const outside=(start,end,low,high)=>!(start<=low&&end>=high)&&(start<low||end>high);
    return outside(left,right,port.left,port.right)||outside(top,bottom,port.top,port.bottom)?[index]:[];
  });
  const before=sample(),startedAt=performance.now(),required=needs(before),needsMovement=required.length>0;
  return new Promise(resolve=>{
    const startedScrollers=new Set();
    let previous=before,started=false,scrollEvents=0,scrollEndEvents=0,frames=0,stableFrames=0,lastChange=startedAt,frame,timer,finished=false;
    const onScroll=event=>{const index=scrollers.indexOf(event.target===document?document.scrollingElement:event.target);if(index<0)return;startedScrollers.add(index);scrollEvents++;started=true;lastChange=performance.now();};
    const onEnd=()=>{scrollEndEvents++;};
    const finish=(status,error=null)=>{
      if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);
      document.removeEventListener('scroll',onScroll,true);document.removeEventListener('scrollend',onEnd,true);
      resolve({status,error,before,after:sample(),needsMovement,started,startedScrollers:[...startedScrollers],scrollEvents,scrollEndEvents,frames,elapsedMs:performance.now()-startedAt});
    };
    const tick=()=>{
      const current=sample(),now=performance.now();frames++;
      let moved=false;current.positions.forEach((position,index)=>{if(position.left!==previous.positions[index].left||position.top!==previous.positions[index].top){moved=true;startedScrollers.add(index);}});
      const changed=moved||Object.keys(current.rect).some(key=>Math.abs(current.rect[key]-previous.rect[key])>.1);
      if(moved)started=true;
      if(changed){lastChange=now;stableFrames=0;}else stableFrames++;
      previous=current;
      const currentNeeds=needs(current);
      if(started&&stableFrames>=4&&now-lastChange>=100&&!currentNeeds.some(index=>!startedScrollers.has(index)))return finish('settled');
      if(!started&&!currentNeeds.length&&stableFrames>=2)return finish('unchanged');
      frame=requestAnimationFrame(tick);
    };
    document.addEventListener('scroll',onScroll,true);document.addEventListener('scrollend',onEnd,true);
    timer=setTimeout(()=>finish('timeout'),3000);
    try{node.scrollIntoView({block:'nearest',behavior:'auto'});}catch(error){finish('error',error.message);return;}
    frame=requestAnimationFrame(tick);
  });
}
export function createEvidenceSession({cdp,out,receipt,root,origin,failures=[]}){
  const background=new Set(),evidenceListeners=[],paused=new Set();
  let fetchEnabled=false,holdFonts=false,fontHoldInstalledAt=null,pageLabel='home-cold',closed=false;
  const requestFonts=new Map();
  const observe=(method,handler)=>evidenceListeners.push(cdp.on(method,handler));
  function task(operation){const promise=Promise.resolve(operation).catch(error=>failures.push(error.message)).finally(()=>background.delete(promise));background.add(promise);}
  async function capture(name){
    const {data}=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const bytes=Buffer.from(data,'base64');
    assert.ok(receipt.screenshots.length<9,'Bounded screenshot budget exceeded');
    await writeFile(path.join(out,name+'.png'),bytes);
    receipt.screenshots.push({file:name+'.png',bytes:bytes.length,sha256:sha(bytes)});
  }
  async function fonts(selector,label,{awaitFonts=true}={}){
    receipt.activeProbe={selector,label,phase:'layout'};
    if(awaitFonts)await cdp.evaluate('document.fonts.ready.then(()=>true)');
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
    const value={label,selector,...details,...usage};
    receipt.checks.push(value);
    assert.ok(details.visible,label+' must actually render inside the viewport');
    delete receipt.activeProbe;
    return value;
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
    observe('Network.responseReceived',event=>{if(event.type==='Font'||event.type==='Stylesheet'&&/\/(?:fonts\/|typography\.css)/.test(new URL(event.response.url).pathname))requestFonts.set(event.requestId,{page:pageLabel,type:event.type,url:event.response.url,status:event.response.status,mime:event.response.mimeType,fromDiskCache:event.response.fromDiskCache,fromServiceWorker:event.response.fromServiceWorker});});
    observe('Network.loadingFinished',event=>{const font=requestFonts.get(event.requestId);if(font)task((async()=>{const body=await cdp.send('Network.getResponseBody',{requestId:event.requestId});assert.ok(font.type!=='Font'||body.base64Encoded,'Binary WOFF2 response body expected');const bytes=Buffer.from(body.body,body.base64Encoded?'base64':'utf8'),source=await readFile(path.join(root,'app',new URL(font.url).pathname));assert.equal(sha(bytes),sha(source),'Browser font bytes must match checkout');receipt.fonts.push({...font,bytes:bytes.length,encodedDataLength:event.encodedDataLength,sha256:sha(bytes)});})());});
    observe('Network.loadingFailed',event=>{if(!event.canceled)receipt.errors.push({type:'network',error:event.errorText,blockedReason:event.blockedReason});});
    observe('Runtime.exceptionThrown',event=>receipt.errors.push({type:'runtime',message:event.exceptionDetails.text,exception:event.exceptionDetails.exception?.description}));
    observe('Fetch.requestPaused',event=>{if(holdFonts){paused.add(event.requestId);return;}task(cdp.send('Fetch.continueRequest',{requestId:event.requestId}));});
  }
  async function installFontHold(){
    if(closed)throw Error('Evidence session is closed; refusing late font interception');
    assert.ok(!fontHoldInstalledAt,'Cold-font interception is installed once before product navigation');
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/fonts/newsreader/*.woff2',requestStage:'Request'}]});
    fetchEnabled=true;holdFonts=true;fontHoldInstalledAt=new Date().toISOString();
  }
  async function releaseFontHold(){
    holdFonts=false;
    for(const requestId of paused)await cdp.send('Fetch.continueRequest',{requestId});
    paused.clear();
  }
  // Product navigation is refused until cold-font interception is installed,
  // and only the task-owned loopback origin is a product page.
  async function navigateProduct(url){
    if(closed)throw Error('Evidence session is closed; refusing late product navigation');
    if(!fontHoldInstalledAt)throw Error('Cold-font interception must be installed before any product navigation');
    if(origin&&typeof url==='string'&&url.startsWith(origin))await cdp.send('Page.navigate',{url});
    else throw Error('Product navigation must stay on the owned origin: '+String(url));
  }
  async function close(){
    if(closed)return {errors:failures};
    closed=true;
    if(!cdp)return {errors:failures};
    await cdp.send('Page.stopLoading').catch(error=>failures.push(error.message));
    if(fetchEnabled){holdFonts=false;for(const requestId of paused)await cdp.send('Fetch.continueRequest',{requestId}).catch(error=>failures.push(error.message));await cdp.send('Fetch.disable').catch(error=>failures.push(error.message));}
    // End observation before draining: a snapshot of a growing Set is insufficient.
    for(const unsubscribe of evidenceListeners)unsubscribe();
    receipt.observationClosedAt=new Date().toISOString();
    while(background.size)await Promise.all([...background]);
    await cdp.close().catch(error=>failures.push(error.message));
    return {errors:failures};
  }
  return {
    failures,background,observe,task,
    until:(operation,label,ms)=>until(operation,label,ms,failures),
    capture,fonts,cjkGlyphs,customNewsreader,
    setPageLabel:label=>{pageLabel=label;},
    observeResponses,installFontHold,releaseFontHold,navigateProduct,close,
    paused,
  };
}
