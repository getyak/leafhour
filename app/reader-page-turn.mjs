const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
export const withinPaperSnapshotBudget=(elements,characters)=>elements<=1200&&characters<=48000;

// Own progress, not the reader's position. Only a settled destination commits.
export function createPageTurn({requestFrame,cancelFrame,onPaint,onCommit,reducedMotion=()=>false}){
  let progress=0,velocity=0,direction=1,target=0,frame=null,last=null,epoch=0,disposed=false,active=false;
  const snapshot=()=>({progress,direction,active});
  const stop=()=>{epoch++;if(frame!==null)cancelFrame(frame);frame=null;last=null;};
  const paint=()=>onPaint(snapshot());
  function finish(){
    const commit=target===1,completed=direction;active=false;progress=0;velocity=0;frame=null;last=null;epoch++;paint();
    if(commit&&!disposed)onCommit(completed);
  }
  function settle(destination){
    stop();target=destination;active=true;
    if(reducedMotion()){
      active=false;progress=0;velocity=0;
      if(destination===1)onCommit(direction);
      return;
    }
    paint();
    const ticket=epoch;
    const tick=time=>{
      if(disposed||ticket!==epoch)return;
      const dt=last===null?1/60:Math.max(.001,Math.min(.04,(time-last)/1000));last=time;
      velocity+=((target-progress)*400-38*velocity)*dt;progress=clamp(progress+velocity*dt);paint();
      if(Math.abs(target-progress)<.001&&Math.abs(velocity)<.02){finish();return;}
      frame=requestFrame(tick);
    };
    frame=requestFrame(tick);
  }
  return {
    get active(){return active;},
    turn(next){
      if(disposed||![1,-1].includes(next))return false;
      if(active&&next!==direction){settle(0);return true;}
      direction=next;settle(1);return true;
    },
    grab(next){
      if(disposed)return null;
      stop();if(!active)direction=next===-1?-1:1;active=true;paint();return snapshot();
    },
    drag(value,speed=0){if(disposed||!active)return;progress=clamp(value);velocity=Number.isFinite(speed)?Math.max(-8,Math.min(8,speed)):0;paint();},
    release(cancelled=false,{elapsed=0}={}){if(disposed||!active)return;if(elapsed>100)velocity=0;settle(!cancelled&&progress+velocity*.12>.32?1:0);},
    cancel(){const visible=active||progress>0;stop();active=false;progress=0;velocity=0;if(visible)paint();},
    dispose(){if(disposed)return;this.cancel();disposed=true;}
  };
}

// Integrate a short strip chain along the leaf. Its length stays constant while
// the local tangent changes, so the paper bends instead of rotating as a board.
export function leafSegments(progress,width,count=5,direction=1){
  if(!Number.isFinite(width)||width<=0)return [];
  const p=clamp(progress),n=Math.max(1,Math.min(8,Math.floor(count)||1)),step=width/n;
  const base=direction===-1?Math.PI*(1+p):-Math.PI*p,bend=Math.sin(Math.PI*p)*1.1;
  let x=0,z=0;const segments=[];
  for(let i=0;i<n;i++){
    const radians=base+bend*((i+.5)/n-.5);
    segments.push({x,z,angle:radians*180/Math.PI,width:step});
    x+=Math.cos(radians)*step;z-=Math.sin(radians)*step;
  }
  return segments;
}

export function leafDragProgress(distance,width){
  if(!Number.isFinite(width)||width<=0)return 0;
  if(distance<=0)return 0;if(distance>=width*2)return 1;
  const edge=width-distance;let low=0,high=1;
  for(let i=0;i<14;i++){
    const middle=(low+high)/2,last=leafSegments(middle,width,4,1).at(-1);
    const x=last.x+Math.cos(last.angle*Math.PI/180)*last.width;
    if(x>edge)low=middle;else high=middle;
  }
  return (low+high)/2;
}
