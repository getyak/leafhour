import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createEvidenceSession} from '../tools/lib/platform-font-observer.mjs';
const exactVisual={width:393.0909118652344,height:722.1818237304688,scale:1,offsetTop:0,offsetLeft:0};
function scenario({offscreen=false,innerClipped=false,invisible=false,badGlyphs=false}={}){
 let offset=0,selected=null;const requests=[],glyphReads=[];
 const root={parentElement:null,clientLeft:0,clientTop:0,clientWidth:393,clientHeight:722,scrollWidth:393,scrollHeight:2743,scrollLeft:0,get scrollTop(){return offset;}};
 const parent={parentElement:root,getBoundingClientRect:()=>({x:22,y:538.0568389892578-offset,width:164.5454559326172,height:24})};
 const inner={parentElement:parent,clientLeft:0,clientTop:0,clientWidth:393,clientHeight:200,scrollWidth:393,scrollHeight:1200,scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({x:0,y:100})};
 const child={parentElement:innerClipped?inner:parent,getBoundingClientRect:()=>({x:22,y:offscreen?1000:539.1477508544922-offset,width:102.90341186523438,height:21.81818199157715})};
 const nodeFor=selector=>selector==='#metadata'?parent:selector==='#cjk-direct'?child:null;
 async function scroll(expression){
  let now=0,sequence=0,done=false,schedule=false;const frames=new Map(),timers=new Map(),listeners=new Map();
  for(const [selector,node]of [['#metadata',parent],['#cjk-direct',child]])node.scrollIntoView=({block})=>{requests.push({selector,alignment:block});if(node===parent&&block==='center'&&offset===0)schedule=true;};
  const document={querySelector:nodeFor,scrollingElement:root,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);}};
  const sandbox={document,innerWidth:393,innerHeight:722,visualViewport:exactVisual,scrollX:0,get scrollY(){return offset;},performance:{now:()=>now},getComputedStyle:node=>node===root?{position:'static',scrollPaddingTop:'104',overflowY:'visible',overflowX:'visible',scrollBehavior:'smooth'}:node===inner?{position:'static',overflowY:'auto'}:{position:'static'},requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,at:now+ms});return sequence;},clearTimeout:id=>timers.delete(id)};
  const result=vm.runInNewContext(expression,sandbox);result.then(()=>done=true);
  const positions=[12,48,85,112,130,136,136.72727966308594];
  for(now=16;now<=10032&&!done;now+=16){
   if(schedule&&now>=32&&now<=128){offset=positions[(now-32)/16];listeners.get('scroll')?.({target:document});}
   for(const[id,timer]of[...timers])if(now>=timer.at){timers.delete(id);timer.fn();}
   const pending=[...frames.values()];frames.clear();for(const run of pending)run();await Promise.resolve();await Promise.resolve();
  }
  const proof=await result;assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(listeners.size,0);return proof;
 }
 const receipt={checks:[],fonts:[],errors:[],screenshots:[]};
 const cdp={async evaluate(expression){
  if(expression==='document.fonts.ready.then(()=>true)')return true;
  if(expression.startsWith('(function observeNativeScroll'))return scroll(expression);
  if(expression.includes('document.createTreeWalker(target'))return [{selector:'#cjk-direct',text:'爱丽丝梦游仙境',before:102.90341186523438,after:102.90341186523438}];
  if(expression.startsWith('(()=>{const n=document.querySelector')){
   assert.ok(expression.includes(JSON.stringify(selected)));const rect=nodeFor(selected).getBoundingClientRect();
   return {text:'爱丽丝梦游仙境',font:'16px Noto Serif SC',fontFamily:'Noto Serif SC',style:'normal',rect,viewport:{width:393,height:722,scrollY:offset,visualViewport:exactVisual},visible:!(invisible&&selected==='#cjk-direct')&&rect.y<722&&rect.y+rect.height>0};
  }
  throw Error('Unexpected observation');
 },async send(method,args){
  if(method==='DOM.getDocument')return {root:{nodeId:1}};
  if(method==='DOM.querySelector'){selected=args.selector;assert.ok(nodeFor(selected));return {nodeId:selected==='#metadata'?2:3};}
  if(method==='CSS.getPlatformFontsForNode'){glyphReads.push(args.nodeId);return {fonts:[{familyName:badGlyphs&&args.nodeId===3?'Newsreader':'Noto Serif SC',postScriptName:badGlyphs&&args.nodeId===3?'Newsreader-Regular':'NotoSerifSC-Regular',glyphCount:7,isCustomFont:true}]};}
  throw Error(method);
 }};
 return {requests,glyphReads,receipt,session:createEvidenceSession({cdp,out:'/unused',root:'/unused',origin:'http://localhost',receipt})};
}
test('real cjkGlyphs centers the parent then uses one nearest request for its already-visible direct run',async()=>{
 const f=scenario();await f.session.cjkGlyphs('#metadata','actual Chinese title',{serif:true});
 assert.deepEqual(f.requests,[{selector:'#metadata',alignment:'center'},{selector:'#cjk-direct',alignment:'nearest'}]);
 assert.equal(f.receipt.scrolls[0].status,'settled');assert.equal(f.receipt.scrolls[0].scrollEvents,7);
 const sub=f.receipt.scrolls[1];assert.equal(sub.status,'unchanged');assert.equal(sub.frames,2);assert.equal(sub.scrollEvents,0);assert.equal(sub.before.rect.y,402.42047119140625);assert.equal(sub.after.scrollY,136.72727966308594);
 assert.deepEqual(f.glyphReads,[2,3]);assert.equal(f.receipt.checks[1].text,'爱丽丝梦游仙境');
});
test('direct CJK nearest no-motion still fails when offscreen or clipped in an inner scrollport',async()=>{
 for(const options of [{offscreen:true},{innerClipped:true}]){
  const f=scenario(options);await assert.rejects(()=>f.session.cjkGlyphs('#metadata','actual Chinese title'),/native scrolling must complete/);
  assert.deepEqual(f.requests.map(r=>r.alignment),['center','nearest']);assert.equal(f.receipt.scrolls[1].status,'timeout');assert.equal(f.receipt.scrolls[1].deadlineMs,10000);assert.deepEqual(f.glyphReads,[2]);
 }
});
test('direct CJK probes retain actual visibility and font-coverage failures',async()=>{
 for(const[options,expected]of[[{invisible:true},/inside the viewport/],[{badGlyphs:true},/covered CJK glyphs/]]){
  const f=scenario(options);await assert.rejects(()=>f.session.cjkGlyphs('#metadata','actual Chinese title'),expected);assert.deepEqual(f.requests.map(r=>r.alignment),['center','nearest']);
 }
});
test('ordinary font probes continue to use center and never retry a failed native request',async()=>{
 const f=scenario();await f.session.fonts('#metadata','ordinary metadata');assert.deepEqual(f.requests.map(r=>r.alignment),['center']);
 await assert.rejects(()=>f.session.fonts('#cjk-direct','ordinary source span'),/native scrolling must complete/);assert.deepEqual(f.requests.map(r=>r.alignment),['center','center']);
});
