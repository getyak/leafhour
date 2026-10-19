import {t,onUiLocaleChange} from './ui-locale.mjs';
import {createReaderCompanionState,COMPANION_TIMING} from './reader-companion-state.mjs';
import {overlayOpen} from './popover-controls.mjs';

// GET-184 injected companion anchor: a non-draggable, viewport-clamped
// positioner for the companion bubble around a caller-owned anchor element
// (the shared reading pill). It never moves the anchor, never writes anchor
// ARIA and installs no drag or storage behaviour, so the reader bundle carries
// no launcher drag code.
export function mountCompanionAnchor({anchor,window=globalThis.window}){
  const GAP=8,MARGIN=12,clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const floating=new Set(),held=[];
  const on=(node,name,fn)=>{node.addEventListener(name,fn);held.push(()=>node.removeEventListener(name,fn));};
  const layout=()=>{
    const v=window?.visualViewport,b={left:(v?.offsetLeft||0)+MARGIN,top:(v?.offsetTop||0)+MARGIN,width:Math.max(0,(v?.width||window?.innerWidth||0)-MARGIN*2),height:Math.max(0,(v?.height||window?.innerHeight||0)-MARGIN*2)};
    const r=anchor.getBoundingClientRect();
    for(const node of floating){if(node.hidden)continue;
      const above=Math.max(0,r.top-b.top-GAP),below=Math.max(0,b.top+b.height-r.bottom-GAP);node.style.maxHeight=Math.max(40,above,below)+'px';node.style.maxWidth=b.width+'px';
      const size=node.getBoundingClientRect(),under=above<size.height&&below>above,left=clamp(r.left+r.width/2<b.left+b.width/2?r.left:r.right-size.width,b.left,b.left+b.width-size.width),top=clamp(under?r.bottom+GAP:r.top-size.height-GAP,b.top,b.top+b.height-size.height);
      Object.assign(node.style,{left:left+'px',top:top+'px',right:'auto',bottom:'auto'});node.classList.toggle('is-below',under);
    }
  };
  if(window?.addEventListener){on(window,'resize',layout);if(window.visualViewport)for(const name of ['resize','scroll'])on(window.visualViewport,name,layout);}
  return {attach(node){floating.add(node);layout();return ()=>floating.delete(node);},layout,dispose(){for(const remove of held)remove();floating.clear();}};
}

const element=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
const button=(className,text)=>{const node=element('button',className,text);node.type='button';return node;};

export function mountReaderCompanion({bookId,getOwner,getReader,api,chat,openAuth,integration=null}){
  const surface=chat.surface(),{launcher=null,header,root}=surface,state=createReaderCompanionState();
  // GET-184 companion presentation seams: the bubble anchors beside an explicit
  // anchor element and unread/focus-return leave through explicit callbacks.
  // The shared pill's ARIA and presentation are never touched here; they belong
  // to the reading-tools coordinator. Default (generated launcher) callers keep
  // the historical described-by and message-dot wiring.
  const anchor=integration?.anchor||launcher,onUnread=integration?.onUnread||(()=>{}),onFocusReturn=integration?.onFocusReturn||null;
  const toggle=button('squirrel-companion-toggle',t('companion.enable')),description=element('p','squirrel-companion-description',t('companion.description'));
  description.id='squirrel-companion-description';toggle.setAttribute('aria-describedby',description.id);toggle.setAttribute('aria-pressed','false');
  if(surface.preferenceHost)surface.preferenceHost.append(toggle,description);else{header.insertBefore(toggle,header.lastElementChild);header.after(description);}
  const bubble=element('aside','squirrel-companion-bubble'),body=button('squirrel-companion-message',''),dismiss=button('squirrel-companion-dismiss','×'),status=element('span','sr-only squirrel-companion-status');
  status.id='squirrel-companion-status';status.setAttribute('role','status');bubble.setAttribute('aria-label',t('companion.bubble'));dismiss.setAttribute('aria-label',t('companion.dismiss'));bubble.append(body,dismiss);bubble.hidden=true;const detachBubble=surface.position?.attach(bubble);anchor?.after(bubble);anchor?.after(status);
  if(!integration&&launcher&&status.id)launcher.setAttribute('aria-describedby',status.id);
  let meta=null,epoch=0,configuring=false,localStopped=false,disposed=false,observing=false,settingsInFlight=false,lastObserve=0,lastSettings=0,lastIntent=-Infinity,pending=null,running=null,bubbleTimer=null,hovering=false,unread=false;
  let configuringTarget=null,toggleId='companion.enable',descriptionId='companion.description',bubbleSummary=null;
  const describe=id=>{descriptionId=id;description.textContent=t(id);};
  const refreshLabels=()=>{if(disposed)return;toggle.textContent=t(toggleId);description.textContent=t(descriptionId);bubble.setAttribute('aria-label',t('companion.bubble'));dismiss.setAttribute('aria-label',t('companion.dismiss'));status.textContent=unread?t('companion.unread'):'';if(bubbleSummary!==null)body.setAttribute('aria-label',t('companion.continue',{summary:bubbleSummary}));};
  const unsubscribe=onUiLocaleChange(refreshLabels);
  const owner=getOwner(),route='/api/library/books/'+encodeURIComponent(bookId)+'/companion',signalKey='marginalia:companion-signal:'+encodeURIComponent(owner||'guest')+':'+encodeURIComponent(bookId);
  const current=()=>!disposed&&getOwner()===owner;
  const context=()=>{const reader=getReader(),book=reader?.getBook?.();return book?.bookId===bookId?{reader,book}:null;};
  const visible=()=>document.visibilityState==='visible'&&document.hasFocus();
  function blocked(){return root.open||!!getSelection()?.toString().trim()||overlayOpen(document)||!!document.querySelector('#note-panel:not([hidden]),#paragraph-tools:not([hidden])')||!!document.activeElement?.closest('input,textarea,select,[contenteditable="true"]');}
  function paint(){
    const on=!!meta?.enabled&&!localStopped;toggleId=configuring?(configuringTarget?'companion.enabling':'companion.disabling'):localStopped?'companion.retryDisable':on?'companion.disable':'companion.enable';toggle.textContent=t(toggleId);toggle.disabled=configuring||!!owner&&meta?.available===false&&!on;toggle.setAttribute('aria-pressed',String(on));description.hidden=on&&!localStopped;
  }
  function accept(value){
    meta=value;state.configure({enabled:!!value.enabled&&!localStopped,revision:value.revision,scope:[owner,bookId,value.contentVersion,value.sessionId].join('/')});paint();
  }
  function hideBubble(){clearTimeout(bubbleTimer);bubbleTimer=null;bubble.hidden=true;}
  function markUnread(value){unread=value;surface.motion?.setState({hasMessage:value});status.textContent=value?t('companion.unread'):'';onUnread(value);if(!integration&&launcher)launcher.classList.toggle('has-companion-message',value);paint();}
  function collapse(){hideBubble();pending=null;}
  function cancelRunning(){
    surface.motion?.setState({companionThinking:false});const job=running;if(!job)return;running=null;job.controller.abort();void api('/api/library/books/'+encodeURIComponent(bookId)+'/chat/'+encodeURIComponent(job.id)+'/cancel',{}, {keepalive:true}).catch(()=>{});
  }
  async function configure(enabled){
    if(!owner){openAuth();return;}const c=context();if(!c||configuring)return;
    const ticket=++epoch;configuring=true;configuringTarget=enabled;collapse();cancelRunning();state.suspend();
    if(!enabled){localStopped=true;state.configure({enabled:false,revision:meta?.revision,scope:'stopped'});markUnread(false);}paint();
    try{
      const value=await api(route,{enabled,contentVersion:c.book.contentVersion});if(!current()||ticket!==epoch)return;
      localStopped=false;accept(value);describe('companion.description');
      try{localStorage.setItem(signalKey,JSON.stringify({enabled:value.enabled,revision:value.revision,at:Date.now()}));}catch{}
    }catch(error){if(!current()||ticket!==epoch)return;describe(enabled?'companion.enableFailed':'companion.stopUnconfirmed');description.hidden=false;}
    finally{if(current()&&ticket===epoch){configuring=false;paint();if(localStopped)description.hidden=false;}}
  }
  async function settings(){
    if(!owner||!current()||configuring||settingsInFlight||!context())return;settingsInFlight=true;lastSettings=Date.now();const ticket=epoch;
    try{const value=await api(route);if(current()&&ticket===epoch&&!configuring){if(localStopped&&!value.enabled)localStopped=false;if(meta&&(!value.enabled||value.revision!==meta.revision)){collapse();cancelRunning();}accept(value);}}
    catch{if(current()&&!meta){describe('companion.settingsFailed');}}
    finally{settingsInFlight=false;}
  }
  function observedPassage(c){
    const anchor=c.reader.getAnchor?.()?.passageId,width=innerWidth,height=innerHeight;
    const nodes=[...document.querySelectorAll('#chapter-text .passage')];
    const candidates=nodes.map(node=>{
      const rects=[...node.getClientRects()];const usable=rects.find(rect=>rect.width>0&&rect.height>0&&rect.left<width&&rect.right>0&&(Math.max(0,Math.min(rect.bottom,height)-Math.max(rect.top,0))>=Math.min(rect.height*.5,height*.6)));
      return usable?{id:node.dataset.id,distance:node.dataset.id===anchor?-1:Math.abs(usable.top-height*.35)}:null;
    }).filter(Boolean).sort((a,b)=>a.distance-b.distance);
    const selected=candidates[0];if(!selected)return null;
    for(const section of c.book.sections){const p=section.paragraphs.find(p=>p.id===selected.id);if(p&&p.kind!=='source_heading')return {passageId:p.id,chapterId:section.chapterId};}
    return null;
  }
  async function observe(p,active,{keepalive=false}={}){
    if(observing||!meta?.enabled||localStopped||!p)return;observing=true;lastObserve=Date.now();const ticket=epoch,revision=meta.revision;
    try{
      const value=await api(route+'/observe',{revision,contentVersion:meta.contentVersion,sessionId:meta.sessionId,passageId:p.passageId,active},{keepalive});
      if(current()&&ticket===epoch&&revision===meta?.revision)accept(value);
    }catch(error){if(current()&&ticket===epoch&&error.status===409)void settings();}
    finally{observing=false;}
  }
  function scheduleCollapse(){clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>{if(hovering||bubble.contains(document.activeElement)||getSelection()?.toString().trim())scheduleCollapse();else hideBubble();},COMPANION_TIMING.bubbleMs);}
  function present(){
    if(!pending)return;const c=context(),view=state.view();
    if(!c||pending.chapterId!==c.reader.getChapterId()||view.foregroundMs-pending.readyAt>=COMPANION_TIMING.presentationMs){pending=null;return;}
    if(!view.safeToPresent||blocked()||!visible())return;
    bubbleSummary=pending.turn.answer.summary;body.textContent=bubbleSummary;body.setAttribute('aria-label',t('companion.continue',{summary:bubbleSummary}));body.onclick=()=>{const message=pending?.turn||shown;markUnread(false);collapse();if(message)chat.open({bookId,passageId:message.passageId,messageId:message.id});};
    shown=pending.turn;pending=null;bubble.hidden=false;surface.position?.layout();scheduleCollapse();
  }
  let shown=null;
  async function generate(p){
    if(running||!meta?.eligible||!state.view().eligible||!visible()||blocked())return;
    state.attempted();const job={id:crypto.randomUUID(),controller:new AbortController(),ticket:epoch,revision:meta.revision,chapterId:p.chapterId};running=job;surface.motion?.setState({companionThinking:true});
    try{
      const turn=await api(route+'/messages',{id:job.id,revision:job.revision,contentVersion:meta.contentVersion,sessionId:meta.sessionId,passageId:p.passageId},{signal:job.controller.signal});
      if(!current()||running!==job||job.ticket!==epoch||meta.revision!==job.revision||!meta.enabled||localStopped)return;
      if(turn.kind==='companion'&&turn.status==='completed'&&turn.answer?.summary){surface.motion?.setState({companionThinking:false});markUnread(true);pending={turn,chapterId:job.chapterId,readyAt:state.view().foregroundMs};present();}
    }catch{}
    finally{if(running===job){running=null;surface.motion?.setState({companionThinking:false});}}
  }
  async function tick(){
    if(!current())return;if(!meta||Date.now()-lastSettings>=15000)void settings();if(!meta?.enabled||localStopped||configuring||!visible())return;
    const c=context(),p=c&&observedPassage(c);if(!p)return;
    const isBlocked=blocked(),view=state.sample({...p,visible:true,focused:true,blocked:isBlocked,eligiblePassage:true});
    if(Date.now()-lastObserve>=8000){await observe(p,!isBlocked&&Date.now()-lastIntent<COMPANION_TIMING.idleMs);if(!current())return;}
    if(view.eligible&&!isBlocked)void generate(p);present();paint();
  }
  function activity(event){
    if(!event.isTrusted||!visible()||blocked())return;
    if(event.type==='keydown'&&!['ArrowDown','ArrowUp','PageDown','PageUp',' ','ArrowLeft','ArrowRight'].includes(event.key))return;
    lastIntent=Date.now();state.activity(['wheel','touchmove','keydown'].includes(event.type)?'scroll':'reading');
  }
  function suspend(){
    const c=context(),p=c&&observedPassage(c);state.suspend();collapse();cancelRunning();if(p)void observe(p,false,{keepalive:true});
  }
  const listeners=[];const on=(target,name,handler,options)=>{target.addEventListener(name,handler,options);listeners.push(()=>target.removeEventListener(name,handler,options));};
  on(toggle,'click',()=>configure(localStopped?false:!meta?.enabled));on(dismiss,'click',()=>{hideBubble();if(onFocusReturn)onFocusReturn();else anchor?.focus?.({preventScroll:true});});
  on(bubble,'mouseenter',()=>hovering=true);on(bubble,'mouseleave',()=>hovering=false);
  on(root,'reading-chat-open',()=>{collapse();cancelRunning();markUnread(false);paint();});on(root,'reading-chat-send',cancelRunning);on(root,'close',paint);
  for(const name of ['wheel','touchmove','keydown','pointerdown'])on(document,name,activity,{passive:true});
  on(document,'scroll',()=>{if(Date.now()-lastIntent<2000)state.activity('scroll');},{passive:true,capture:true});
  on(document,'visibilitychange',()=>{if(!visible())suspend();else void settings();});on(window,'blur',suspend);on(window,'pagehide',suspend);on(window,'focus',()=>void settings());
  on(document,'reader:ready',()=>void settings());on(document,'reader:jump',()=>{collapse();state.suspend();});
  on(window,'storage',event=>{if(event.key!==signalKey)return;try{if(JSON.parse(event.newValue)?.enabled===false){epoch++;localStopped=true;configuring=false;collapse();cancelRunning();state.configure({enabled:false,revision:meta?.revision,scope:'stopped'});markUnread(false);}void settings();}catch{}});
  const timer=setInterval(()=>void tick(),1000);paint();void settings();
  return {dispose(){if(disposed)return;unsubscribe();epoch++;suspend();disposed=true;clearInterval(timer);clearTimeout(bubbleTimer);for(const remove of listeners)remove();detachBubble?.();for(const node of [toggle,description,bubble,status])node.remove();launcher?.classList.remove('has-companion-message');}};
}
