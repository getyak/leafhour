import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtmosphereAudio} from '../app/atmosphere-audio.mjs';

test('the first audible graph uses the latest mix after a slow recording decode',async()=>{
  let decoded,release;const gains=[];
  const parameter=()=>({value:1,cancelScheduledValues(){},setValueAtTime(){},setTargetAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=()=>({connect(){},disconnect(){},addEventListener(){},start(){},stop(){}});
  class Context{
    constructor(){this.sampleRate=100;this.currentTime=1;this.state='running';this.destination=node();}
    async resume(){}
    decodeAudioData(){decoded=true;return new Promise(r=>release=r);}
    createGain(){const n={...node(),gain:parameter()};gains.push(n);return n;}
    createDynamicsCompressor(){return {...node(),threshold:parameter(),knee:parameter(),ratio:parameter()};}
    createConvolver(){return node();}
    createBuffer(){return {getChannelData:()=>new Float32Array(260)};}
    createBufferSource(){return node();}
    createBiquadFilter(){return {...node(),frequency:parameter(),Q:parameter()};}
    createOscillator(){return {...node(),frequency:parameter()};}
  }
  const engine=createAtmosphereAudio({AudioContextClass:Context,fetchAudio:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)})});
  let mix={music:0.8,nature:0.6};const pending=engine.start('rain',()=>mix);
  while(!decoded)await new Promise(r=>setImmediate(r));
  mix={music:0,nature:0};release({duration:32});const handle=await pending;
  try{assert.equal(gains[1].gain.value,0);assert.equal(gains[2].gain.value,0);}finally{handle.stop();}
});
