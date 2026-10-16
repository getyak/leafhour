import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSquirrelMotion} from '../app/squirrel-motion.mjs';

function setup({reduced=false,visible=true}={}){
  const document=new EventTarget(),window=new EventTarget(),media=new EventTarget(),jobs=new Map(),animations=[];let id=0;
  document.visibilityState=visible?'visible':'hidden';document.hasFocus=()=>true;media.matches=reduced;window.matchMedia=()=>media;
  const part=()=>Object.assign(new EventTarget(),{setAttribute(){},animate(frames,options){const a={frames,options,cancelled:false,cancel(){this.cancelled=true;},finished:new Promise(()=>{})};animations.push(a);return a;}});
  const launcher=part(),squirrel=part(),head=part(),tail=part(),eyes=[part(),part()];
  const motion=mountSquirrelMotion({launcher,squirrel,head,tail,eyes,document,window,random:()=>.5,scheduler:{setTimeout(fn){jobs.set(++id,fn);return id;},clearTimeout(key){jobs.delete(key);}}});
  return {motion,document,window,media,jobs,animations,launcher};
}
test('the squirrel has ambient life without generating messages, and a tap reacts immediately',()=>{
  const f=setup();assert.ok(f.animations.length>0);assert.equal(f.jobs.size,2);const before=f.animations.length;
  f.launcher.dispatchEvent(new Event('pointerenter'));assert.ok(f.animations.length>before);f.motion.dispose();assert.equal(f.jobs.size,0);assert.ok(f.animations.every(a=>a.cancelled));
});
test('hidden pages cancel all movement and resume one set of idle timers when visible',()=>{
  const f=setup();f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.jobs.size,0);assert.ok(f.animations.every(a=>a.cancelled));
  f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.jobs.size,2);f.motion.dispose();
});
test('reduced motion disables ambient and event motion and reacts to system preference changes',()=>{
  const f=setup({reduced:true});assert.equal(f.jobs.size,0);f.motion.react('message');f.launcher.dispatchEvent(new Event('pointerenter'));assert.equal(f.animations.length,0);
  f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.ok(f.animations.length>0);f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.ok(f.animations.every(a=>a.cancelled));f.motion.dispose();
});
test('thinking motion follows a real pending state and a completed message only reacts once',()=>{
  const f=setup();f.motion.setState({companionThinking:true});const before=f.animations.length;f.motion.setState({companionThinking:true});assert.equal(f.animations.length,before);
  f.motion.setState({companionThinking:false,hasMessage:true});assert.ok(f.animations.length>before);const done=f.animations.length;f.motion.setState({hasMessage:true});assert.equal(f.animations.length,done);f.motion.dispose();
});
