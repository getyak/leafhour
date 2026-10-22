export const atmospheres=Object.freeze([
  {id:'forest',name:'林间书页',caption:'风过树梢，读到日落。',nature:'林风与鸟鸣',music:'林间琴音',image:'/assets/atmospheres/forest.jpg',sounds:[['wind',1],['birds',0.22]],notes:[48,55,60,64,67,72,76],pace:3.6},
  {id:'rain',name:'雨窗夜读',caption:'窗外有雨，灯下有书。',nature:'细雨敲窗',music:'夜读琴音',image:'/assets/atmospheres/rain.jpg',sounds:[['rain',1]],notes:[45,52,57,60,64,69,72],pace:4.6},
  {id:'hearth',name:'木屋炉火',caption:'留一盏灯，慢慢读。',nature:'炉火轻响',music:'暖调拨弦',image:'/assets/atmospheres/hearth.jpg',sounds:[['fire',1]],notes:[43,50,55,59,62,67,71],pace:3.8},
  {id:'sea',name:'海边清晨',caption:'潮声很远，清晨很长。',nature:'缓慢海浪',music:'晨光和声',image:'/assets/atmospheres/sea.jpg',sounds:[['waves',1]],notes:[50,57,62,66,69,74,78],pace:5.2}
]);
const defaults=Object.freeze({scene:'none',music:28,nature:32,motion:true});
export function normalizeAtmosphere(input){
  const source=input&&typeof input==='object'?input:{};
  return {
    scene:source.scene==='none'||atmospheres.some(s=>s.id===source.scene)?source.scene:'none',
    music:Number.isFinite(source.music)&&source.music>=0&&source.music<=100?source.music:defaults.music,
    nature:Number.isFinite(source.nature)&&source.nature>=0&&source.nature<=100?source.nature:defaults.nature,
    motion:typeof source.motion==='boolean'?source.motion:defaults.motion,
    playing:source.scene!=='none'&&atmospheres.some(s=>s.id===source.scene)&&source.playing===true
  };
}
export function atmosphereMix(input,{narrating=false}={}){
  const p=normalizeAtmosphere(input),scale=p.scene==='none'?0:narrating?0.18:1;
  return {music:p.music/100*scale,nature:p.nature/100*scale};
}

// Each asynchronous start owns its cleanup; an obsolete start cannot stop a newer one.
export function createAtmosphereSession({start,onState=()=>{}}){
  let revision=0,handle=null,status='paused',scene='none',error=null,mix=null;
  const publish=()=>onState({status,scene,error});
  return {
    get status(){return status;},get scene(){return scene;},get error(){return error;},
    async play(next){
      const ticket=++revision;handle?.stop();handle=null;scene=next;error=null;
      if(next==='none'){status='paused';publish();return;}
      status='loading';publish();
      try{
        const ready=await start(next);
        if(ticket!==revision){ready.stop();return;}
        handle=ready;if(mix)handle.setMix?.(mix);status='playing';publish();
      }catch(cause){if(ticket!==revision)return;error=cause;status=cause?.name==='NotAllowedError'?'blocked':'error';publish();}
    },
    setMix(value){mix={...value};handle?.setMix?.(mix);},
    stop(){revision++;handle?.stop();handle=null;status='paused';error=null;publish();}
  };
}
