import test from 'node:test';
import assert from 'node:assert/strict';
import * as audio from '../app/atmosphere-audio.mjs';

const buffer=(channels,length,rate)=>({numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,data:Array.from({length:channels},()=>new Float32Array(length)),getChannelData(c){return this.data[c];}});
const context={createBuffer:buffer};

// Restoring a raw faded loop would reintroduce a once-per-cycle silence.
test('loop preparation removes recording fades and joins the waveform without a silent seam',()=>{
  assert.equal(typeof audio.prepareAtmosphereLoop,'function');
  const input=buffer(2,3200,100);
  for(let c=0;c<2;c++)for(let i=60;i<3140;i++)input.data[c][i]=.2*Math.sin(i*.19+c);
  const output=audio.prepareAtmosphereLoop(context,input);
  assert.ok(output.length<3100);assert.equal(output.numberOfChannels,2);
  for(let c=0;c<2;c++){
    const samples=output.getChannelData(c),tail=samples.slice(-10),head=samples.slice(0,10);
    const rms=x=>Math.sqrt(x.reduce((sum,v)=>sum+v*v,0)/x.length);
    assert.ok(rms(tail)>.05);assert.ok(rms(head)>.05);
    assert.ok(Math.abs(samples.at(-1)-samples[0])<.06,'the loop seam has only an ordinary adjacent-sample step');
    assert.ok(samples.every(Number.isFinite));
  }
  assert.equal(input.data[0][0],0,'the cached decoded recording is not mutated');
});
