// The field shares the photograph's coordinates: flames grow from the embers
// at the left and from behind the large log at the right. The camera stays still.
const plumes=[
  [.025,.67,.04,.18],[.09,.56,.035,.17],[.17,.6,.045,.22],[.24,.66,.04,.16],
  [.66,.66,.032,.2],[.73,.65,.045,.29],[.81,.65,.036,.23],[.88,.68,.04,.3],[.96,.72,.035,.21],
];
const clamp=value=>Math.max(0,Math.min(1,value));
const grain=Float32Array.from({length:4096},(_,i)=>{
  let n=Math.imul(i+1,374761393);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;
});
function noise(x,y){
  const ix=Math.floor(x),iy=Math.floor(y);let u=x-ix,v=y-iy;
  u*=u*(3-2*u);v*=v*(3-2*v);
  const a=grain[((iy&63)*64)+(ix&63)],b=grain[((iy&63)*64)+((ix+1)&63)];
  const c=grain[(((iy+1)&63)*64)+(ix&63)],d=grain[(((iy+1)&63)*64)+((ix+1)&63)];
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}

export function createHearthFrame(width,height){
  const pixels=new Uint8ClampedArray(width*height*4),fuel=[];
  // Precompute the footprint once; each frame samples only pixels near the fuel.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let shape=-1,rise=0;
    for(const [cx,base,spread,tall]of plumes){
      const v=(base-y/height)/tall;
      if(v<=0||v>=1)continue;
      const dx=(x/width-cx)/(spread*(1-.45*v)),s=1-dx*dx-v;
      if(s>shape){shape=s;rise=v;}
    }
    if(shape>-.45)fuel.push({x,y,index:(y*width+x)*4,shape,rise});
  }
  return time=>{
    for(const {x,y,index,shape,rise}of fuel){
      // Sampling downwards over time carries curls upwards through the flame.
      const curl=.68*noise(x*.075,y*.085+time*2.5)+.32*noise(x*.19-time*.3,y*.21+time*4);
      const heat=shape+(curl-.5)*1.45-.12;
      const alpha=clamp(heat*3)*Math.pow(clamp(rise*5),1.5)*clamp((1-rise)*5);
      pixels[index]=255;pixels[index+1]=100+clamp(heat)*140;pixels[index+2]=18+clamp(heat)*110;
      pixels[index+3]=alpha*215;
    }
    return pixels;
  };
}

export function createHearthMotion(target,clock=globalThis){
  let canvas,context,image,render,frame=null,last=-Infinity,active=false,unavailable=false;
  function tick(time){
    if(!active)return;
    // 20 fps at a small fixed resolution is enough for soft, irregular fire.
    if(time-last>=50){image.data.set(render(time/1000));context.putImageData(image,0,0);last=time;}
    frame=clock.requestAnimationFrame(tick);
  }
  return {setActive(value){
    if(value===active||unavailable)return;
    active=value;
    if(!active){if(frame!==null)clock.cancelAnimationFrame(frame);frame=null;if(canvas)canvas.hidden=true;return;}
    if(!canvas){
      canvas=target.ownerDocument.createElement('canvas');canvas.className='hearth-flames';canvas.setAttribute('aria-hidden','true');
      canvas.width=300;canvas.height=200;
      context=canvas.getContext('2d');
      if(!context){unavailable=true;active=false;return;}
      image=context.createImageData(canvas.width,canvas.height);render=createHearthFrame(canvas.width,canvas.height);target.append(canvas);
    }
    canvas.hidden=false;last=-Infinity;frame=clock.requestAnimationFrame(tick);
  }};
}
