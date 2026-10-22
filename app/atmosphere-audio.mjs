import {atmospheres} from './atmosphere-state.mjs';

const phrases=[0,3,4,2,5,3,1,4,2,6,4,3,1,3,5,2];
const ramp=(parameter,value,time,seconds=0.18)=>{
  if(parameter.cancelAndHoldAtTime)parameter.cancelAndHoldAtTime(time);
  else {parameter.cancelScheduledValues(time);parameter.setValueAtTime(parameter.value,time);}
  parameter.setTargetAtTime(value,time,seconds);
};

// Bundled MP3s have 0.6s fades at either end. Discard them, then overlap
// two seconds of unfaded sound with equal-power weights. The result loops on
// the audio render thread; neither an ended event nor a JS timer joins cycles.
export function prepareAtmosphereLoop(context,recording){
  const trim=Math.min(Math.round(recording.sampleRate*.75),Math.floor(recording.length/8));
  const length=recording.length-2*trim;
  const overlap=Math.min(Math.round(recording.sampleRate*2),Math.floor(length/4));
  const body=length-2*overlap;
  const output=context.createBuffer(recording.numberOfChannels,length-overlap,recording.sampleRate);
  for(let channel=0;channel<recording.numberOfChannels;channel++){
    const input=recording.getChannelData(channel),samples=output.getChannelData(channel);
    samples.set(input.subarray(trim+overlap,trim+length-overlap));
    for(let i=0;i<overlap;i++){
      const phase=i/(overlap-1)*Math.PI/2;
      samples[body+i]=input[trim+length-overlap+i]*Math.cos(phase)+input[trim+i]*Math.sin(phase);
    }
  }
  return output;
}

// Recording buffers and synthesis stay in this browser. No book text enters this module.
export function createAtmosphereAudio({AudioContextClass=globalThis.AudioContext||globalThis.webkitAudioContext,fetchAudio=globalThis.fetch}={}){
  let context;const buffers=new Map();
  function unlock(){
    if(!AudioContextClass)throw Error('这个浏览器暂不支持氛围声音，可以继续使用阅读主题。');
    if(!context)context=new AudioContextClass({latencyHint:'playback'});
    const resumed=context.resume();
    if(context.state==='running')return resumed;
    // Browsers may leave resume() pending until a gesture. Do not hang the UI
    // or claim playback while the context is suspended.
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{const error=Error('Audio needs a user gesture.');error.name='NotAllowedError';reject(error);},1000);
      Promise.resolve(resumed).then(()=>{clearTimeout(timer);if(context.state==='running')resolve();else {const error=Error('Audio needs a user gesture.');error.name='NotAllowedError';reject(error);}},error=>{clearTimeout(timer);reject(error);});
    });
  }
  async function recording(id){
    if(!buffers.has(id))buffers.set(id,(async()=>{
      const response=await fetchAudio('/assets/atmospheres/'+id+'.mp3');
      if(!response.ok)throw Error('环境声暂时无法载入，请重试。');
      return prepareAtmosphereLoop(context,await context.decodeAudioData(await response.arrayBuffer()));
    })().catch(error=>{buffers.delete(id);throw error;}));
    return buffers.get(id);
  }
  function roomImpulse(){
    const length=Math.floor(context.sampleRate*2.6),impulse=context.createBuffer(2,length,context.sampleRate);
    let seed=18329;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296*2-1;};
    for(let c=0;c<2;c++){const data=impulse.getChannelData(c);for(let i=0;i<length;i++)data[i]=random()*Math.pow(1-i/length,3)*0.28;}
    return impulse;
  }
  return {
    unlock,
    async start(sceneId,currentMix){
      const scene=atmospheres.find(s=>s.id===sceneId);if(!scene)throw Error('请选择一种阅读氛围。');
      await unlock();
      const recordings=await Promise.all(scene.sounds.map(async([id,level])=>({buffer:await recording(id),level})));
      // Resolve at the output boundary: a mute made during decoding must be silent from frame one.
      const mix=typeof currentMix==='function'?currentMix():currentMix;
      const master=context.createGain(),music=context.createGain(),nature=context.createGain();
      master.gain.value=0;music.gain.value=mix.music; nature.gain.value=mix.nature;
      const limiter=context.createDynamicsCompressor();limiter.threshold.value=-12;limiter.knee.value=16;limiter.ratio.value=4;
      music.connect(master);nature.connect(master);master.connect(limiter);limiter.connect(context.destination);
      const reverb=context.createConvolver(),wet=context.createGain();reverb.buffer=roomImpulse();wet.gain.value=0.22;reverb.connect(wet);wet.connect(music);
      let stopped=false,nextNote=context.currentTime+0.08,step=0;const sources=new Set();
      const watch=source=>{sources.add(source);source.addEventListener('ended',()=>{sources.delete(source);source.disconnect();},{once:true});};
      for(const {buffer,level}of recordings){
        const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;source.loop=true;
        gain.gain.value=level;source.connect(gain);gain.connect(nature);watch(source);source.start();
      }
      function note(midi,when,level=1){
        const frequency=440*Math.pow(2,(midi-69)/12),long=sceneId==='sea',pluck=sceneId==='hearth',duration=long?8:pluck?4:6;
        const envelope=context.createGain(),filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=long?1300:2200;filter.Q.value=0.4;
        envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(0.12*level,when+(long?0.7:0.025));
        envelope.gain.exponentialRampToValueAtTime(0.0001,when+duration);
        filter.connect(envelope);envelope.connect(music);envelope.connect(reverb);
        const partials=long?[[1,0.8],[2,0.12]]:pluck?[[1,0.7],[2,0.24],[3,0.09],[4,0.025]]:[[1,0.8],[2,0.18],[3,0.045]];
        let remaining=partials.length;
        for(const [ratio,amplitude]of partials){
          const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.value=frequency*ratio;
          gain.gain.value=amplitude;oscillator.connect(gain);gain.connect(filter);watch(oscillator);
          oscillator.addEventListener('ended',()=>{gain.disconnect();if(!--remaining){filter.disconnect();envelope.disconnect();}},{once:true});
          oscillator.start(when);oscillator.stop(when+duration+0.1);
        }
      }
      function schedule(){
        if(stopped||context.state!=='running')return;
        // Avoid catching up a backlog after an operating-system audio interruption.
        if(nextNote<context.currentTime)nextNote=context.currentTime+0.08;
        while(nextNote<context.currentTime+1.2){
          const index=phrases[step%phrases.length],phrase=Math.floor(step/phrases.length);
          note(scene.notes[(index+phrase%2)%scene.notes.length],nextNote,step%4===0?0.85:0.65);
          if(step%4===0)note(scene.notes[phrase%3]-12,nextNote,0.55);
          nextNote+=scene.pace+(step%4===3?1.2:0);step++;
        }
      }
      schedule();const timer=setInterval(schedule,250);ramp(master.gain,0.85,context.currentTime,0.35);
      return {
        setMix(value){if(stopped)return;ramp(music.gain,value.music,context.currentTime);ramp(nature.gain,value.nature,context.currentTime);},
        stop(){
          if(stopped)return;stopped=true;clearInterval(timer);const time=context.currentTime;ramp(master.gain,0,time,0.06);
          for(const source of sources)try{source.stop(time+0.35);}catch{}
          setTimeout(()=>{master.disconnect();music.disconnect();nature.disconnect();reverb.disconnect();wet.disconnect();limiter.disconnect();},450);
        }
      };
    }
  };
}
