import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHomeAtmosphere} from '../app/home-atmosphere.mjs';

function setup({reduced=false,fine=true,hidden=false,saved=null,locale='zh-Hans'}={}){
  const doc=new EventTarget();doc.hidden=false;doc.documentElement={lang:locale};
  const motion=new EventTarget();motion.matches=reduced;
  const pointer=new EventTarget();pointer.matches=fine;
  const toggle=new EventTarget();toggle.attributes=new Map();toggle.setAttribute=(k,v)=>toggle.attributes.set(k,v);
  const values=new Map(),frames=new Map(),storage=new Map(saved===null?[]:[['marginalia:home-light',saved]]);
  const win=new EventTarget();let id=0;
  Object.assign(win,{innerWidth:1000,innerHeight:800,scrollY:0,matchMedia:q=>q.includes('reduced')?motion:pointer,
    requestAnimationFrame:callback=>{frames.set(++id,callback);return id;},cancelAnimationFrame:key=>frames.delete(key),
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
  doc.defaultView=win;
  const root={hidden,ownerDocument:doc,dataset:{},style:{setProperty:(k,v)=>values.set(k,v)},querySelector:()=>toggle};
  const move=(x=1000,y=800,type='mouse')=>{const event=new Event('pointermove');Object.assign(event,{clientX:x,clientY:y,pointerType:type});win.dispatchEvent(event);};
  const step=time=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(time));};
  return {root,doc,win,motion,pointer,toggle,values,frames,storage,move,step};
}

test('pointer movement is damped, bounded and settles without an idle frame loop',()=>{
  const s=setup();mountHomeAtmosphere(s.root);s.move();s.move(50000,50000);
  assert.equal(s.frames.size,1);s.step(16);
  const first=parseFloat(s.values.get('--light-x'));assert.ok(first>0&&first<24);
  for(let i=2;i<100;i++)s.step(i*16);
  assert.ok(parseFloat(s.values.get('--light-x'))<=24);assert.equal(s.frames.size,0);
});

test('pause cancels movement, saves the choice, and reduced motion cannot be overridden',()=>{
  const s=setup();mountHomeAtmosphere(s.root);s.move();s.toggle.dispatchEvent(new Event('click'));
  assert.equal(s.root.dataset.atmosphere,'paused');assert.equal(s.frames.size,0);assert.equal(s.storage.get('marginalia:home-light'),'off');
  s.toggle.dispatchEvent(new Event('click'));s.motion.matches=true;s.motion.dispatchEvent(new Event('change'));s.move();
  assert.equal(s.root.dataset.atmosphere,'still');assert.equal(s.frames.size,0);
  s.toggle.dispatchEvent(new Event('click'));assert.equal(s.root.dataset.atmosphere,'still');
});
test('English sunlight controls retain their language when paused and resumed',()=>{
  const s=setup({locale:'en'});mountHomeAtmosphere(s.root);
  assert.equal(s.toggle.attributes.get('aria-label'),'Pause sunlight');
  s.toggle.dispatchEvent(new Event('click'));assert.equal(s.toggle.attributes.get('aria-label'),'Enable sunlight');assert.equal(s.root.dataset.atmosphere,'paused');
  s.toggle.dispatchEvent(new Event('click'));assert.equal(s.toggle.attributes.get('aria-label'),'Pause sunlight');assert.equal(s.root.dataset.atmosphere,'running');
});

test('hidden pages stop, restore without a jump, and cleanup removes input handlers',()=>{
  const s=setup();const destroy=mountHomeAtmosphere(s.root);s.move();s.step(16);
  const before=s.values.get('--light-x');
  s.doc.hidden=true;s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.frames.size,0);assert.equal(s.root.dataset.atmosphere,'paused');
  s.doc.hidden=false;s.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(s.root.dataset.atmosphere,'running');
  assert.equal(s.values.get('--light-x'),before);destroy();s.move();assert.equal(s.frames.size,0);
});

test('touch and coarse pointers never produce cursor motion; hidden library does not mount',()=>{
  const s=setup({fine:false});mountHomeAtmosphere(s.root);s.move();assert.equal(s.frames.size,0);
  s.pointer.matches=true;s.pointer.dispatchEvent(new Event('change'));s.move(20,20,'touch');assert.equal(s.frames.size,0);
  const library=setup({hidden:true});mountHomeAtmosphere(library.root);assert.equal(library.root.dataset.atmosphere,undefined);
});

test('scroll gently changes the light plane, and storage denial never blocks the homepage',()=>{
  const s=setup();s.win.localStorage.getItem=()=>{throw Error('denied');};s.win.localStorage.setItem=()=>{throw Error('denied');};
  assert.doesNotThrow(()=>mountHomeAtmosphere(s.root));s.win.scrollY=2000;s.win.dispatchEvent(new Event('scroll'));s.step(16);
  assert.ok(parseFloat(s.values.get('--light-scroll'))>0);assert.doesNotThrow(()=>s.toggle.dispatchEvent(new Event('click')));
});
