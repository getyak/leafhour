// Decorative input only. No reading state, account data, timers, or model calls.
export function mountHomeAtmosphere(root,win=root?.ownerDocument?.defaultView){
  if(!root||root.hidden||!win?.requestAnimationFrame||!win.matchMedia)return ()=>{};
  const doc=root.ownerDocument,toggle=root.querySelector('.light-toggle');
  const reduced=win.matchMedia('(prefers-reduced-motion: reduce)'),fine=win.matchMedia('(hover: hover) and (pointer: fine)');
  const key='marginalia:home-light';
  let enabled=true,disposed=false,suspended=false,frame=0,previous=0;
  let x=0,y=0,scroll=0,targetX=0,targetY=0,targetScroll=0;
  try{enabled=win.localStorage.getItem(key)!=='off';}catch{}
  const running=()=>!disposed&&enabled&&!reduced.matches&&!doc.hidden&&!suspended;
  const render=()=>{
    root.style.setProperty('--light-x',x.toFixed(3)+'px');root.style.setProperty('--light-y',y.toFixed(3)+'px');
    root.style.setProperty('--light-scroll',scroll.toFixed(3)+'px');
  };
  const cancel=()=>{if(frame)win.cancelAnimationFrame(frame);frame=0;previous=0;};
  const tick=time=>{
    frame=0;if(!running())return;
    const dt=previous?Math.max(1,Math.min(time-previous,40)):16;previous=time;
    const blend=1-Math.exp(-dt/120);
    x+=(targetX-x)*blend;y+=(targetY-y)*blend;scroll+=(targetScroll-scroll)*blend;
    if(Math.max(Math.abs(targetX-x),Math.abs(targetY-y),Math.abs(targetScroll-scroll))<.02){x=targetX;y=targetY;scroll=targetScroll;previous=0;render();return;}
    render();frame=win.requestAnimationFrame(tick);
  };
  const queue=()=>{if(running()&&!frame)frame=win.requestAnimationFrame(tick);};
  const clamp=value=>Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
  const pointer=event=>{
    if(!running()||!fine.matches||(event.pointerType&&event.pointerType!=='mouse'))return;
    targetX=clamp(event.clientX/Math.max(win.innerWidth,1)*2-1)*24;
    targetY=clamp(event.clientY/Math.max(win.innerHeight,1)*2-1)*16;queue();
  };
  const leave=event=>{if(event.type==='pointerout'&&event.relatedTarget)return;targetX=targetY=0;queue();};
  const onScroll=()=>{if(!running())return;targetScroll=Math.max(0,Math.min(win.scrollY*.025,60));queue();};
  const sync=()=>{
    cancel();
    // Pause at the presentation value; resuming must not snap the room back.
    if(reduced.matches||!fine.matches)x=y=0;
    targetX=x;targetY=y;targetScroll=scroll;render();
    root.dataset.atmosphere=reduced.matches?'still':running()?'running':'paused';
    if(toggle){toggle.hidden=false;toggle.disabled=reduced.matches;toggle.setAttribute('aria-pressed',String(enabled&&!reduced.matches));toggle.setAttribute('aria-label',reduced.matches?'系统已减少动态效果':enabled?'暂停光影':'开启光影');toggle.setAttribute('title',reduced.matches?'系统已减少动态效果':enabled?'暂停光影':'开启光影');}
  };
  const click=()=>{if(reduced.matches)return;enabled=!enabled;try{win.localStorage.setItem(key,enabled?'on':'off');}catch{}sync();};
  const hide=()=>{suspended=true;sync();},show=()=>{suspended=false;sync();};
  win.addEventListener('pointermove',pointer,{passive:true});win.addEventListener('pointerout',leave,{passive:true});
  win.addEventListener('blur',leave);win.addEventListener('resize',sync);win.addEventListener('scroll',onScroll,{passive:true});
  win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);doc.addEventListener('visibilitychange',sync);
  reduced.addEventListener('change',sync);fine.addEventListener('change',sync);toggle?.addEventListener('click',click);sync();
  return ()=>{
    disposed=true;cancel();root.dataset.atmosphere='still';
    win.removeEventListener('pointermove',pointer);win.removeEventListener('pointerout',leave);win.removeEventListener('blur',leave);
    win.removeEventListener('resize',sync);win.removeEventListener('scroll',onScroll);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);
    doc.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);fine.removeEventListener('change',sync);toggle?.removeEventListener('click',click);
  };
}

if(typeof document!=='undefined')mountHomeAtmosphere(document.getElementById('home-view'));
