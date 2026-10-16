import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHomeMotion} from '../app/home-motion.mjs';

function setup({reduced=false,hidden=false}={}){
  const media=new EventTarget();media.matches=reduced;
  const doc=new EventTarget();doc.hidden=false;
  const observers=[],mutations=[],animations=[];
  const makeElement=({interactive=false}={})=>{
    const control={};const node={control,contains:target=>target===node||target===control,matches:()=>false,querySelector:()=>interactive?control:null,animate:(frames,options)=>{
      let finish;const animation={frames,options,cancelled:false,finished:new Promise(resolve=>{finish=resolve;}),cancel(){this.cancelled=true;finish();}};
      animations.push(animation);return animation;
    }};return node;
  };
  const element=makeElement(),cards=[];
  const shelf={querySelectorAll:()=>cards};
  const root=new EventTarget();Object.assign(root,{hidden,ownerDocument:doc,querySelectorAll:()=>[element],querySelector:()=>shelf});
  const win=new EventTarget();Object.assign(win,{
    matchMedia:()=>media,Element:{prototype:{animate(){}}},
    IntersectionObserver:class{constructor(callback){this.callback=callback;this.elements=new Set();observers.push(this);}observe(el){this.elements.add(el);}unobserve(el){this.elements.delete(el);}disconnect(){this.elements.clear();}enter(el){this.callback([{isIntersecting:true,target:el}]);}},
    MutationObserver:class{constructor(callback){this.callback=callback;mutations.push(this);}observe(){}disconnect(){}}
  });doc.defaultView=win;
  return {root,doc,win,media,observers,mutations,animations,element,cards,makeElement};
}

test('the hidden homepage in the library never mounts animation observers',()=>{
  const s=setup({hidden:true});mountHomeMotion(s.root);assert.equal(s.observers.length,0);
});

test('reduced motion cancels an entrance immediately and never hides new content',()=>{
  const s=setup();mountHomeMotion(s.root);assert.ok(s.observers.length,'homepage observes arriving content');s.observers.at(-1).enter(s.element);
  assert.equal(s.animations.length,1);s.media.matches=true;s.media.dispatchEvent(new Event('change'));
  assert.equal(s.animations[0].cancelled,true);assert.equal(s.observers.at(-1).elements.size,0);
  const next=s.makeElement();s.cards.push(next);s.mutations.at(-1).callback();assert.equal(s.animations.length,1);
});

test('new shelf cards participate, while tab hiding and cleanup stop active animation',()=>{
  const s=setup();const destroy=mountHomeMotion(s.root),card=s.makeElement();s.cards.push(card);s.mutations.at(-1).callback();
  assert.ok(s.observers.at(-1).elements.has(card));s.observers.at(-1).enter(card);s.doc.hidden=true;s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.animations[0].cancelled,true);s.doc.hidden=false;s.doc.dispatchEvent(new Event('visibilitychange'));
  s.observers.at(-1).enter(s.element);destroy();assert.ok(s.animations.every(animation=>animation.cancelled));
  const count=s.observers.length;s.win.dispatchEvent(new Event('pageshow'));assert.equal(s.observers.length,count);
});

test('unsupported observation leaves the document readable without an animation dependency',()=>{
  const s=setup();delete s.win.IntersectionObserver;assert.doesNotThrow(()=>mountHomeMotion(s.root));assert.equal(s.animations.length,0);
});

test('tabbing into a section before its intersection callback never dims the focused action',()=>{
  const s=setup();mountHomeMotion(s.root);s.doc.activeElement=s.element;s.observers.at(-1).enter(s.element);
  assert.equal(s.animations.length,0);assert.equal(s.observers.at(-1).elements.has(s.element),false);
});

test('pointer focus during an interactive card entrance never changes its hit geometry',()=>{
  const s=setup(),card=s.makeElement({interactive:true});s.cards.push(card);mountHomeMotion(s.root);
  s.observers.at(-1).enter(card);const animation=s.animations.at(-1);
  assert.ok(animation.frames.every(frame=>!Object.hasOwn(frame,'translate')&&!Object.hasOwn(frame,'transform')),'interactive entrance must not move the pressed link');
  const event=new Event('focusin');Object.defineProperty(event,'target',{value:card.control});s.root.dispatchEvent(event);
  assert.equal(animation.cancelled,true,'focus still removes entrance dimming immediately');
});
test('a decorative figure can retain its entrance movement',()=>{
  const s=setup();mountHomeMotion(s.root);s.observers.at(-1).enter(s.element);
  assert.ok(s.animations[0].frames.some(frame=>frame.translate),'noninteractive artwork retains movement');
});
