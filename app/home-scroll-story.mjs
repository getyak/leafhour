// Homepage-only scroll choreography. Native scroll owns the position; paused
// effects are sought once per input frame, with no idle animation loop.
const clamp=value=>Math.max(0,Math.min(1,value));
export function viewportProgress(rect,height){
 if(!rect||!Number.isFinite(rect.top)||!Number.isFinite(rect.height)||rect.height<0||!Number.isFinite(height)||height<=0)return 0;
 return clamp((height*.9-rect.top)/Math.max(1,rect.height+height*.65));
}

export function mountHomeScrollStory(root,win=root?.ownerDocument?.defaultView){
 const doc=root?.ownerDocument,hero=root?.querySelector?.('.home-hero');
 if(!root||root.hidden||!hero||!win?.requestAnimationFrame||!win?.Element?.prototype.animate||!win.matchMedia)return ()=>{};
 const preference=win.matchMedia('(prefers-reduced-motion: reduce)'),reading=root.querySelector('.story-reading'),card=root.querySelector('.story-demo .sample-sheet'),continuity=root.querySelector('.story-continuity');
 const effects=[],wrapped=[],listeners=[];let disposed=false,running=false,frame=null,resizeObserver=null,mutationObserver=null,narrow=win.innerWidth<640;
 const originalPinned=reading?.dataset.scrollPinned;
 const listen=(target,name,handler,options)=>{target?.addEventListener?.(name,handler,options);listeners.push(()=>target?.removeEventListener?.(name,handler,options));};
 const restorePinned=()=>{if(reading){if(originalPinned===undefined)delete reading.dataset.scrollPinned;else reading.dataset.scrollPinned=originalPinned;}};
 function stop(){
  running=false;if(frame!==null)win.cancelAnimationFrame(frame);frame=null;
  for(const item of effects){item.animation.cancel();item.node.style.willChange='';}effects.length=0;
  for(const {outer,ink}of wrapped)if(outer.parentNode)outer.replaceWith(...ink.childNodes);wrapped.length=0;
  root.classList.remove('is-scroll-story');restorePinned();resizeObserver?.disconnect();resizeObserver=null;
 }
 function add(node,keyframes,position,property='transform'){
  if(!node?.animate)return;
  const animation=node.animate(keyframes,{duration:1000,fill:'both',easing:'linear'});animation.pause();animation.finished?.catch(()=>{});
  effects.push({node,animation,position,property,last:null});
 }
 function headingLines(){
  for(const heading of root.querySelectorAll('.story-reading h2,.story-continuity h2,.ownership-section h2,.shelf-section h2')){
   for(const text of [...heading.childNodes]){
    if(text.nodeType!==3||!text.textContent.trim())continue;
    const outer=doc.createElement('span'),ink=doc.createElement('span');outer.className='story-line';ink.className='story-line-ink';
    text.before(outer);outer.append(ink);ink.append(text);wrapped.push({outer,ink});const owner=heading.closest('section');
    add(ink,[{filter:'blur(5px)',opacity:.35,transform:'translate3d(0,14px,0)'},{filter:'blur(0px)',opacity:1,transform:'translate3d(0,0,0)'}],()=>owner?.contains(doc.activeElement)?1:clamp((win.innerHeight*.9-outer.getBoundingClientRect().top)/Math.max(1,win.innerHeight*.4)),'transform,opacity,filter');
   }
  }
 }
 function paint(){
  frame=null;if(disposed||!running)return;
  if(root.hidden||doc.hidden){stop();return;}
  if(hero.isConnected===false||!root.contains(hero)){dispose();return;}
  const height=win.innerHeight,header=doc.querySelector?.('.site-header')?.getBoundingClientRect().height||0;
  if(reading&&card){const pinned=win.innerWidth>=640&&height>=600&&card.getBoundingClientRect().height+header+56<height;const value=String(pinned);if(reading.dataset.scrollPinned!==value)reading.dataset.scrollPinned=value;}
  // Measure before writing effect times; animated children are never their
  // own progress source, avoiding a geometry/animation feedback loop.
  const samples=effects.map(item=>({item,progress:clamp(item.position({height,header}))}));
  for(const {item,progress}of samples){if(item.last!==null&&Math.abs(item.last-progress)<.0001)continue;item.animation.currentTime=progress*1000;item.node.style.willChange=progress>0&&progress<1?item.property:'';item.last=progress;}
 }
 function queue(){if(disposed||!running||frame!==null)return;frame=win.requestAnimationFrame(paint);}
 function start(){
  stop();if(disposed||root.hidden||doc.hidden||preference.matches||hero.isConnected===false||!root.contains(hero))return;
  running=true;root.classList.add('is-scroll-story');
  try{
   const heroPhase=({header})=>{const r=hero.getBoundingClientRect();return clamp((header-r.top)/Math.max(1,r.height*.9));};
   const travel=Math.min(230,win.innerHeight*.22)*(win.innerWidth<640?.45:1);
   add(root.querySelector('.story-window'),[{transform:'translate3d(0,0,0) rotate(-7deg) scale(1)'},{transform:`translate3d(0,${-travel}px,0) rotate(-13deg) scale(1.08)`}],heroPhase);
   add(root.querySelector('.story-page'),[{transform:'translate3d(0,0,0) rotate(6deg) scale(1)'},{transform:`translate3d(-12px,${travel*.7}px,0) rotate(14deg) scale(.94)`}],heroPhase);
   add(root.querySelector('.hero-copy h1'),[{transform:'translate3d(0,0,0) scale(1)',opacity:1},{transform:'translate3d(0,-38px,0) scale(.96)',opacity:.35}],values=>hero.querySelector('.hero-copy')?.contains(doc.activeElement)?0:heroPhase(values),'transform,opacity');
   if(reading)add(root.querySelector('.story-reading-art img'),[{transform:'translate3d(0,34px,0) scale(1.2)'},{transform:'translate3d(0,-34px,0) scale(1.04)'}],({height})=>viewportProgress(reading.getBoundingClientRect(),height));
   if(continuity){const phase=({height})=>viewportProgress(continuity.getBoundingClientRect(),height);
    add(root.querySelector('.story-continuity figure'),[{clipPath:'inset(12% 16% 12% 16% round 54px)'},{clipPath:'inset(0% 0% 0% 0% round 3px)',offset:.55},{clipPath:'inset(0% 0% 0% 0% round 3px)'}],phase,'clip-path');
    add(root.querySelector('.story-continuity figure img'),[{transform:'translate3d(0,24px,0) scale(1.22)'},{transform:'translate3d(0,-10px,0) scale(1)'}],phase);
   }
   headingLines();paint();
   if(win.ResizeObserver){resizeObserver=new win.ResizeObserver(queue);if(card)resizeObserver.observe(card);resizeObserver.observe(hero);}
  }catch{stop();}
 }
 function dispose(){if(disposed)return;disposed=true;stop();mutationObserver?.disconnect();for(const remove of listeners)remove();}
 // Mobile browser bars resize the viewport during a scroll. Remeasure those
 // frames without repeatedly rebuilding every effect and heading wrapper.
 listen(win,'scroll',queue,{passive:true});listen(win,'resize',()=>{const next=win.innerWidth<640;if(next!==narrow){narrow=next;start();}else queue();},{passive:true});
 listen(preference,'change',start);listen(doc,'visibilitychange',start);listen(win,'pagehide',stop);listen(win,'pageshow',start);
 listen(root,'focusin',queue);listen(root,'focusout',queue);
 if(win.MutationObserver){mutationObserver=new win.MutationObserver(()=>{if(!root.contains(hero))dispose();else if(root.hidden)stop();else if(!running)start();});mutationObserver.observe(root,{childList:true,attributes:true,attributeFilter:['hidden']});}
 start();doc.fonts?.ready?.then(()=>{if(!disposed)queue();},()=>{});
 return dispose;
}
