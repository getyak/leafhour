// Quiet water behind the opened letter. The renderer is purely decorative:
// Canvas2D only, capped resolution and frame rate, text never moves, and it
// stops whenever the letter is closed, the page hides or motion is reduced.
// Without a usable canvas the static CSS wave field remains visible.
const BANDS=4;
export function createGiftWaves({canvas,context:fixedContext,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,isReduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,isHidden=()=>document.hidden,now=()=>performance.now(),maxDpr=1.5,maxWidth=1200,maxHeight=1600,maxPixels=1200*1600,targetFps=30}={}){
  const context=fixedContext!==undefined?fixedContext:canvas?.getContext?.('2d')||null;
  let running=false,frame=null,lastPaint=0,paints=0;
  function resize(){
    if(!context||!canvas)return;
    const rect=canvas.getBoundingClientRect?.()||{width:canvas.clientWidth||0,height:canvas.clientHeight||0};
    // Both dimensions and the total backing store are budgeted together, so a
    // long narrow letter can never allocate a huge height. The scale shrinks
    // both axes equally and keeps the quiet scene's aspect correct.
    const dpr=Math.min(globalThis.devicePixelRatio||1,maxDpr);
    const targetWidth=Math.max(1,(rect.width||1)*dpr),targetHeight=Math.max(1,(rect.height||1)*dpr);
    const scale=Math.min(1,maxWidth/targetWidth,maxHeight/targetHeight,Math.sqrt(maxPixels/(targetWidth*targetHeight)));
    const width=Math.max(1,Math.round(targetWidth*scale)),height=Math.max(1,Math.round(targetHeight*scale));
    if(canvas.width!==width)canvas.width=width;
    if(canvas.height!==height)canvas.height=height;
  }
  function clear(){
    if(!context||!canvas)return;
    context.clearRect(0,0,canvas.width,canvas.height);
  }
  function paint(time){
    const width=canvas.width,height=canvas.height;
    if(!width||!height)return;
    context.clearRect(0,0,width,height);
    const drift=time/1000*0.07;
    for(let band=0;band<BANDS;band++){
      const base=height*(0.18+band*0.21),amplitude=Math.max(1,height*0.013),wavelength=width/(1.1+band*0.5);
      context.beginPath();
      const step=Math.max(4,width/64);
      for(let x=0;x<=width;x+=step){
        const y=base+Math.sin(x/wavelength*Math.PI*2+drift*(1+band*0.17))*amplitude+Math.sin(x/wavelength*Math.PI*4.7-drift*0.6)*amplitude*0.35;
        if(x)context.lineTo(x,y);else context.moveTo(x,y);
      }
      context.strokeStyle='rgba(56,91,72,'+(0.05+band*0.012).toFixed(3)+')';
      context.lineWidth=Math.max(1,height*0.005);
      context.stroke();
    }
    paints++;
  }
  function tick(time){
    frame=null;
    if(!running)return;
    if(isReduced()||isHidden()){stop();return;}
    if(time-lastPaint>=1000/targetFps){lastPaint=time;paint(time);}
    frame=requestFrame(tick);
  }
  function start(){
    if(!context||running)return;
    if(isReduced()||isHidden())return;
    running=true;lastPaint=0;
    resize();frame=requestFrame(tick);
  }
  function stop(){
    running=false;
    if(frame!==null)cancelFrame(frame);
    frame=null;clear();
  }
  function dispose(){
    stop();
    if(canvas){canvas.width=0;canvas.height=0;}
    paints=0;
  }
  resize();
  return {get live(){return !!context;},get mode(){return context?'live':'static';},get running(){return running;},get paints(){return paints;},start,stop,dispose,resize};
}
// A narrow lifecycle controller: one renderer at a time, never a duplicated
// loop or a stale field. It restarts only while the letter is open and visible,
// the scene is active, the page is visible and motion is allowed.
export function createGiftWavesController({canvas,createField=options=>createGiftWaves(options),isReduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,isHidden=()=>document.hidden,fieldOptions={}}={}){
  let field=null,disposed=false,letter=false,scene=true;
  const allowed=()=>letter&&scene&&!isReduced()&&!isHidden();
  const mount=()=>{field?.dispose();field=createField({canvas,isReduced,isHidden,...fieldOptions});disposed=false;return field;};
  // The renderer mounts lazily only while everything allows it: an idle
  // controller holds no loop and no stale field. Every sync re-measures the
  // surface first, so the backing store is correct even when the letter state
  // did not change (a hidden scene that just became visible, a reflow).
  const sync=()=>{if(allowed()){if(!field)mount();field.resize();field.start();}else field?.stop();};
  return {
    get mode(){return field?.mode||'static';},
    get field(){return field;},
    get disposed(){return disposed;},
    setLetter(open){open=!!open;if(open===letter)return;letter=open;sync();},
    setScene(active){active=!!active;if(active===scene)return;scene=active;sync();},
    // A reduced-motion change re-evaluates; nothing runs while it is on.
    refresh(){sync();},
    // Preview updates rebuild the renderer and drop the old one entirely.
    remount(){mount();sync();},
    // Hidden tab: stop frames but keep the surface. Becoming visible again
    // remounts a disposed renderer lazily and restarts under the same guards.
    visibility(hidden){if(hidden){field?.stop();return;}sync();},
    // A persisted page hide releases the surface; pageshow rebuilds it.
    pageHide(){disposed=true;field?.dispose();field=null;},
    pageShow(){sync();},
    dispose(){disposed=true;field?.dispose();field=null;}
  };
}
// The real gift-page wiring, extracted so tests exercise the exact handlers the
// page calls instead of controller internals the product never touches. Scene
// availability is read from the DOM: a hidden or error scene is never activated
// by visibility, pageshow or reflow events, and presentation only activates the
// renderer after the consumer has updated the DOM and unhidden the scene.
export function createGiftWaveScene({waves,isSceneVisible=()=>true,onMode=()=>{}}={}){
  const adopt=()=>{waves.setScene(isSceneVisible()!==false);};
  return {
    letter(openVisible){waves.setLetter(openVisible);},
    // Called after the DOM shows the scene; the renderer rebuilds and measures
    // the now-visible surface, dropping any previous renderer entirely.
    presented(){adopt();waves.remount();onMode(waves.mode);},
    // The error scene marks the scene unavailable first, then detaches.
    failed(){waves.setScene(false);waves.dispose();},
    visibility(hidden){adopt();waves.visibility(hidden);},
    pageHide(){waves.pageHide();},
    pageShow(){adopt();waves.pageShow();},
    reducedChanged(){adopt();waves.refresh();},
    relayout(){adopt();waves.refresh();}
  };
}
