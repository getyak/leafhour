// A critically damped reveal. Reversing it retains position and velocity.
export function createGiftSpring({onFrame,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,isReduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches}){
  let position=0,velocity=0,target=0,frame=null,last=null;
  const paint=()=>onFrame(position,target);
  function finish(){if(frame!==null)cancelFrame(frame);frame=null;last=null;position=target;velocity=0;paint();}
  function tick(time){
    frame=null;const dt=last===null?1/60:Math.max(0,Math.min((time-last)/1000,.032));last=time;
    const omega=12,delta=position-target,coefficient=velocity+omega*delta,decay=Math.exp(-omega*dt);
    position=target+(delta+coefficient*dt)*decay;velocity=(velocity-omega*coefficient*dt)*decay;
    if(Math.abs(position-target)<.001&&Math.abs(velocity)<.015){finish();return;}
    if(position<0||position>1){position=Math.max(0,Math.min(1,position));velocity=0;}
    paint();frame=requestFrame(tick);
  }
  function setOpen(open){target=open?1:0;if(isReduced()){finish();return;}if(frame===null){last=null;frame=requestFrame(tick);}}
  paint();return {setOpen,finish};
}
