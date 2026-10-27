import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../app/reader-page-inputs.mjs').catch(()=>({}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(loadSurface){
  assert.equal(typeof module.mountReaderPageInputs,'function');
  let page=1,active=true,blocked=false;const commits=[],provenance=[];
  const document=Object.assign(new EventTarget(),{defaultView:{getSelection:()=>''}});
  const inputs=module.mountReaderPageInputs({document,viewport:{},text:{},getGeometry:()=>({active,page,count:5}),isBlocked:()=>blocked,onTurn:(direction,source)=>{page+=direction;commits.push(direction);provenance.push(source?.trusted===true);},loadSurface});
  const key=(value,patch={})=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:value,...patch});document.dispatchEvent(event);return event;};
  return {inputs,key,commits,provenance,get page(){return page;},setBlocked:value=>blocked=value,setActive:value=>active=value};
}

test('left and right keys work while optional visuals are pending and after their download fails',async()=>{
  let reject;const f=fixture(()=>new Promise((_,no)=>{reject=no;}));f.inputs.sync();
  assert.equal(f.key('ArrowRight').defaultPrevented,true);assert.equal(f.page,2);
  reject(Error('Offline'));await tick();f.key('ArrowLeft');assert.equal(f.page,1);assert.deepEqual(f.commits,[1,-1]);f.inputs.dispose();
});

test('basic keys leave composing input, modified shortcuts and blocked or inactive readers alone',()=>{
  const f=fixture(()=>new Promise(()=>{}));f.inputs.sync();
  f.key('ArrowRight',{isComposing:true});f.key('ArrowRight',{ctrlKey:true});f.setBlocked(true);f.key('ArrowRight');f.setBlocked(false);f.setActive(false);f.key('ArrowRight');assert.deepEqual(f.commits,[]);f.inputs.dispose();
});

test('a late optional renderer never mounts after its input owner is disposed',async()=>{
  let resolve,mounted=0;const f=fixture(()=>new Promise(yes=>{resolve=yes;}));f.inputs.sync();f.inputs.dispose();
  resolve({default:()=>{mounted++;return {turn(){},cancel(){},sync(){},dispose(){}};}});await tick();f.key('ArrowRight');assert.equal(mounted,0);assert.deepEqual(f.commits,[]);
});
test('page inputs preserve trusted control provenance and do not label programmatic turns as trusted',()=>{
  const f=fixture(()=>new Promise(()=>{}));f.inputs.turn(1,{trusted:true});f.inputs.turn(-1);assert.deepEqual(f.provenance,[true,false]);f.setBlocked(true);f.inputs.turn(1,{trusted:true});assert.equal(f.provenance.length,2);f.inputs.dispose();
});
