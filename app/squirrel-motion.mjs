// Ambient character movement is local. It never schedules model work.
export function mountSquirrelMotion({launcher,squirrel,head,tail,eyes,document=globalThis.document,window=globalThis.window,random=Math.random,scheduler={setTimeout,clearTimeout}}){
  if(typeof squirrel?.animate!=='function')return {setState(){},react(){},dispose(){}};
  const media=window.matchMedia('(prefers-reduced-motion: reduce)'),animations=new Map(),timers=new Set(),listeners=[];
  let disposed=false,awake=false,state={thinking:false,companionThinking:false,chatOpen:false,hasMessage:false};
  const allowed=()=>!disposed&&!media.matches&&document.visibilityState==='visible'&&document.hasFocus?.()!==false;
  const listen=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
  function stop(channel){animations.get(channel)?.cancel();animations.delete(channel);}
  function play(channel,node,frames,options){
    if(!allowed())return;stop(channel);const animation=node.animate(frames,{easing:'ease-in-out',...options});animations.set(channel,animation);
    animation.finished?.then(()=>{if(animations.get(channel)===animation)animations.delete(channel);},()=>{});return animation;
  }
  function later(fn,delay){const id=scheduler.setTimeout(()=>{timers.delete(id);if(allowed())fn();},delay);timers.add(id);}
  function blink(){for(const [i,eye]of eyes.entries())play('eye'+i,eye,[{scale:'1 1',offset:0},{scale:'1 .12',offset:.42},{scale:'1 1',offset:1}],{duration:180});}
  function tailFlick(){play('tail',tail,[{transform:'rotate(22deg)'},{transform:'rotate(32deg)'},{transform:'rotate(17deg)'},{transform:'rotate(22deg)'}],{duration:850});}
  function nextBlink(){later(()=>{blink();nextBlink();},4500+random()*6500);}
  function nextTail(){later(()=>{if(!state.thinking&&!state.companionThinking)tailFlick();nextTail();},16000+random()*12000);}
  function thinking(){
    if(state.thinking||state.companionThinking){play('tail',tail,[{transform:'rotate(22deg)'},{transform:'rotate(28deg)'},{transform:'rotate(22deg)'}],{duration:1800,iterations:Infinity});play('head',head,[{rotate:'0deg'},{rotate:'-4deg'},{rotate:'0deg'}],{duration:3600,iterations:Infinity});}
    else{stop('tail');stop('head');}
  }
  function sync(){
    if(!allowed()){
      awake=false;for(const timer of timers)scheduler.clearTimeout(timer);timers.clear();for(const animation of animations.values())animation.cancel();animations.clear();return;
    }
    if(awake)return;awake=true;
    play('breath',squirrel,[{transform:'translateY(0)'},{transform:'translateY(-1px)'},{transform:'translateY(0)'}],{duration:4600,iterations:Infinity});nextBlink();nextTail();thinking();
  }
  function react(kind){
    if(!allowed())return;
    if(kind==='message'){play('head',head,[{translate:'0 0',rotate:'0deg'},{translate:'0 -2px',rotate:'-5deg'},{translate:'0 0',rotate:'0deg'}],{duration:700});blink();tailFlick();}
    else if(kind==='attention'){play('head',head,[{rotate:'0deg'},{rotate:'-6deg'},{rotate:'0deg'}],{duration:600});}
    else if(kind==='press'){play('greeting',head,[{translate:'0 0'},{translate:'0 1.5px'},{translate:'0 0'}],{duration:280});}
  }
  listen(document,'visibilitychange',sync);listen(window,'focus',sync);listen(window,'blur',sync);listen(media,'change',sync);
  listen(launcher,'pointerenter',()=>react('attention'));listen(launcher,'focus',()=>react('attention'));listen(launcher,'pointerdown',()=>react('press'));
  sync();
  return {
    setState(next){
      const previous=state;state={...state,...next};launcher.setAttribute('data-squirrel-state',state.thinking||state.companionThinking?'thinking':state.chatOpen?'listening':state.hasMessage?'message':'idle');
      if(previous.thinking!==state.thinking||previous.companionThinking!==state.companionThinking)thinking();
      if(!previous.hasMessage&&state.hasMessage)react('message');
      if(!previous.chatOpen&&state.chatOpen)react('attention');
    },
    react,
    dispose(){if(disposed)return;disposed=true;sync();for(const remove of listeners)remove();}
  };
}
