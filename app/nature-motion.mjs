// GET-163: in the forest and sea scenes the light and the water carry the motion.
// The photographs and the reading camera stay still, so text, columns and input
// never move. This bounded renderer paints cached gradient bands on one small
// canvas: no per-pixel scan, no per-frame allocation, and no frame loop while a
// scene is inactive. The canvas overlays light only — it never samples the
// photographs — so a failed photo decode cannot block or crash the renderer and
// the still photograph is always preserved underneath.
// When no canvas context is available (or it is lost) the module stays silent
// and reader-atmosphere.css keeps a compositor animation fallback; that fallback
// is CSS animation, not GPU rendering.

export const CANVAS_WIDTH=320,CANVAS_HEIGHT=200;
export const NATURE_SCENES=Object.freeze(['forest','sea']);
export const WATER_TOP=.28;// the photographed sea horizon; nothing draws above it

// Forest shafts: x (top anchor), slant (bottom shift in width fractions),
// width, base alpha, breath period (s), phase. Light leans down-left like the
// photographed sun and breathes slowly enough to read as sunlight, not strobe.
const forestShafts=Object.freeze([
  [.04,-.2,.055,.13,6.4,0],
  [.14,-.16,.04,.09,7.6,1.9],
  [.27,-.22,.06,.11,5.8,3.4],
  [.42,-.18,.045,.09,8.2,.7],
  [.55,-.24,.08,.17,6.1,2.6],
  [.69,-.19,.055,.15,7.1,4.5],
  [.81,-.22,.07,.16,5.4,1.2],
  [.93,-.17,.05,.12,8.8,3.8],
]);
// Faint canopy shadows drift between the shafts: wider, darker and slower.
const forestCanopy=Object.freeze([
  [.08,-.14,.3,.05,14,0],
  [.36,-.16,.26,.045,18,2.2],
  [.64,-.14,.3,.05,16,4.3],
  [.92,-.16,.24,.045,21,1.1],
]);
const warmLight='255,235,180',canopyShadow='6,22,16';

function makeBand([x,slant,width,alpha,period,phase],color,size){
  return {x:x*size.width,skew:slant*size.width/size.height,w:width*size.width,alpha,period,phase,color,fill:null};
}

function paintBand(context,item,width,height,time){
  if(!item.fill){
    item.fill=context.createLinearGradient(0,0,item.w,0);
    item.fill.addColorStop(0,`rgba(${item.color},0)`);
    item.fill.addColorStop(.5,`rgba(${item.color},1)`);
    item.fill.addColorStop(1,`rgba(${item.color},0)`);
  }
  const breathe=.62+.38*Math.sin(time*Math.PI*2/item.period+item.phase);
  const slide=Math.sin(time*Math.PI*2/(item.period*3.4)+item.phase)*width*.014;
  context.globalAlpha=Math.max(0,item.alpha*breathe);
  context.setTransform(1,0,item.skew,1,item.x+slide,0);
  context.fillStyle=item.fill;
  context.fillRect(0,0,item.w,height);
}

function createForestRenderer(width,height){
  const size={width,height},bands=[
    ...forestCanopy.map(item=>makeBand(item,canopyShadow,size)),
    ...forestShafts.map(item=>makeBand(item,warmLight,size)),
  ];
  return (context,time)=>{
    context.setTransform(1,0,0,1,0,0);
    context.clearRect(0,0,width,height);
    for(const item of bands)paintBand(context,item,width,height,time);
  };
}

function createSeaRenderer(width,height){
  const rows=[];let seed=163;
  const rand=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296;};
  // Fixed wave rows: narrow glints grow wider and brighter toward the reader.
  // Rows only slide and breathe horizontally, so the horizon never moves.
  for(let i=0;i<26;i++){
    const v=(i+.5)/26;
    rows.push({
      x:(-.06+rand()*1.12)*width,
      y:(WATER_TOP+v*(1-WATER_TOP))*height,
      w:(.09+.28*v)*width,
      h:Math.max(2,(.008+.013*v)*height),
      alpha:.035+.17*v,
      period:2.2+rand()*3.2,
      phase:rand()*Math.PI*2,
      color:v<.5?'255,236,196':'228,244,242',
      fill:null,
    });
  }
  return (context,time)=>{
    context.setTransform(1,0,0,1,0,0);
    context.clearRect(0,0,width,height);
    for(const row of rows){
      const shimmer=.55+.45*Math.sin(time*Math.PI*2/row.period+row.phase);
      if(shimmer<=0)continue;
      if(!row.fill){
        row.fill=context.createLinearGradient(0,0,row.w,0);
        row.fill.addColorStop(0,`rgba(${row.color},0)`);
        row.fill.addColorStop(.5,`rgba(${row.color},1)`);
        row.fill.addColorStop(1,`rgba(${row.color},0)`);
      }
      const drift=Math.sin(time*Math.PI*2/(row.period*2.8)+row.phase)*width*.012;
      context.globalAlpha=Math.max(0,row.alpha*shimmer);
      context.setTransform(1,0,0,1,row.x+drift,row.y);
      context.fillStyle=row.fill;
      context.fillRect(0,0,row.w,row.h);
    }
  };
}

// Frames only translate and fade the precomputed bands; the returned draw
// function allocates nothing per frame.
export function createNatureRenderer(scene,width=CANVAS_WIDTH,height=CANVAS_HEIGHT){
  if(scene==='forest')return createForestRenderer(width,height);
  if(scene==='sea')return createSeaRenderer(width,height);
  return null;
}

// Explicit scene and active controls mirror hearth-motion.mjs: pausing cancels
// the loop and hides the canvas, resuming reuses it, and a scene without moving
// nature (rain, hearth, paper) never schedules a frame.
export function createNatureMotion(target,clock=globalThis){
  let canvas=null,context=null,draw=null,frame=null,last=-Infinity,active=false,scene='none',unavailable=false,lost=false;
  const running=()=>active&&!unavailable&&!lost&&draw!==null;
  function tick(time){
    if(!running()){frame=null;return;}
    // 20 fps keeps soft light calm and the cost bounded.
    if(time-last>=50){draw(context,time/1000);last=time;}
    frame=clock.requestAnimationFrame(tick);
  }
  function ensure(){
    canvas=target.ownerDocument.createElement('canvas');
    canvas.className='nature-motion';canvas.setAttribute('aria-hidden','true');
    canvas.width=CANVAS_WIDTH;canvas.height=CANVAS_HEIGHT;canvas.hidden=true;
    context=canvas.getContext('2d');
    if(!context){unavailable=true;canvas=null;return false;}
    canvas.addEventListener('contextlost',()=>{lost=true;sync();});
    canvas.addEventListener('contextrestored',()=>{
      lost=false;context=canvas.getContext('2d');
      if(!context){unavailable=true;return;}
      draw=createNatureRenderer(scene,CANVAS_WIDTH,CANVAS_HEIGHT);sync();
    });
    target.append(canvas);
    return true;
  }
  function sync(){
    if(running()){
      if(canvas===null&&!ensure())return;
      canvas.hidden=false;target.dataset.natureRenderer='canvas';
      if(frame===null){last=-Infinity;frame=clock.requestAnimationFrame(tick);}
      return;
    }
    if(frame!==null){clock.cancelAnimationFrame(frame);frame=null;}
    if(canvas)canvas.hidden=true;
    // Without the canvas layer the CSS light/water fallback takes over.
    delete target.dataset.natureRenderer;
  }
  return {
    setScene(value){
      const next=NATURE_SCENES.includes(value)?value:'none';
      if(next===scene)return;
      scene=next;draw=createNatureRenderer(scene,CANVAS_WIDTH,CANVAS_HEIGHT);sync();
    },
    setActive(value){
      if(value===active||unavailable)return;
      active=!!value;sync();
    }
  };
}
