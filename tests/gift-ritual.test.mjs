import test from 'node:test';
import assert from 'node:assert/strict';
const motion=await import('../app/gift-ritual.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
function clock(){let time=0,id=0;const queued=new Map();return {request:fn=>{queued.set(++id,fn);return id;},cancel:id=>queued.delete(id),step:()=>{time+=1000/60;const callbacks=[...queued.values()];queued.clear();for(const callback of callbacks)callback(time);},pending:()=>queued.size};}
test('opening and folding a letter settle completely without a background animation loop',()=>{
  assert.equal(typeof motion.createGiftSpring,'function');const frames=[],timer=clock(),spring=motion.createGiftSpring({onFrame:p=>frames.push(p),requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false});
  spring.setOpen(true);for(let i=0;i<180;i++)timer.step();assert.equal(frames.at(-1),1);assert.ok(frames.every(p=>p>=0&&p<=1));assert.equal(timer.pending(),0);
  spring.setOpen(false);for(let i=0;i<180;i++)timer.step();assert.equal(frames.at(-1),0);assert.equal(timer.pending(),0);
});
test('reversing an opening letter carries its current position rather than snapping to an endpoint',()=>{
  assert.equal(typeof motion.createGiftSpring,'function');const frames=[],timer=clock(),spring=motion.createGiftSpring({onFrame:p=>frames.push(p),requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false});
  spring.setOpen(true);for(let i=0;i<12;i++)timer.step();const before=frames.at(-1);assert.ok(before>.1&&before<.95);
  spring.setOpen(false);assert.equal(frames.at(-1),before);timer.step();assert.ok(Math.abs(frames.at(-1)-before)<.08);
  for(let i=0;i<180;i++)timer.step();assert.equal(frames.at(-1),0);assert.equal(timer.pending(),0);
});
test('reduced motion and finishing a hidden-page transition reveal the target without extra frames',()=>{
  assert.equal(typeof motion.createGiftSpring,'function');const frames=[],timer=clock();let reduced=true;const spring=motion.createGiftSpring({onFrame:p=>frames.push(p),requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>reduced});
  spring.setOpen(true);assert.equal(frames.at(-1),1);assert.equal(timer.pending(),0);spring.setOpen(false);assert.equal(frames.at(-1),0);
  reduced=false;spring.setOpen(true);timer.step();spring.finish();assert.equal(frames.at(-1),1);assert.equal(timer.pending(),0);
});

const waves=await import('../app/gift-waves.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const {readFile}=await import('node:fs/promises');
function surface({context=true,width=320,height=120}={}){
  const calls={clear:0,stroke:0},size={width,height};
  const ctx=context?{clearRect(){calls.clear++;},beginPath(){},moveTo(){},lineTo(){},stroke(){calls.stroke++;},strokeStyle:'',lineWidth:0}:null;
  return {calls,size,canvas:{width:0,height:0,getBoundingClientRect:()=>({...size}),getContext:()=>ctx}};
}
function waveController(overrides={}){
  const timer=clock();let hidden=false,reduced=false;const fields=[];
  const controller=waves.createGiftWavesController({canvas:{},isReduced:()=>reduced,isHidden:()=>hidden,
    fieldOptions:{requestFrame:timer.request,cancelFrame:timer.cancel,targetFps:30},
    createField:options=>{const target=surface();const field=waves.createGiftWaves({...options,canvas:target.canvas});fields.push({field,canvas:target.canvas});return field;},...overrides});
  return {timer,controller,fields,hide:value=>{hidden=value;},reduce:value=>{reduced=value;}};
}
// The gift page's real consumer wiring: DOM truth first (the scene is hidden
// until the letter page unhides it), then the exact handlers book-gift.mjs
// calls. A hidden scene reports a zero rect like a real hidden element.
function sceneFixture(){
  const timer=clock();let hidden=false,reduced=false,sceneHidden=true;const fields=[];
  const controller=waves.createGiftWavesController({canvas:{},isReduced:()=>reduced,isHidden:()=>hidden,
    fieldOptions:{requestFrame:timer.request,cancelFrame:timer.cancel,targetFps:30},
    createField:options=>{const target=surface();const field=waves.createGiftWaves({...options,canvas:target.canvas});fields.push({field,canvas:target.canvas,size:target.size});return field;}});
  const syncSize=()=>{for(const entry of fields){entry.size.width=sceneHidden?0:320;entry.size.height=sceneHidden?0:120;}};
  const scene=waves.createGiftWaveScene({waves:controller,isSceneVisible:()=>!sceneHidden});
  syncSize();
  return {timer,controller,fields,scene,
    hide:value=>{hidden=value;},
    // The page updates the DOM first and only then reports the presentation.
    present(){sceneHidden=false;syncSize();scene.presented();},
    fail(){sceneHidden=true;syncSize();scene.failed();},
    hideScene(){sceneHidden=true;syncSize();}};
}
test('the decorative wave field is capped in resolution and rate and stops when the letter closes',()=>{
  assert.equal(typeof waves.createGiftWaves,'function');const timer=clock(),target=surface();
  const field=waves.createGiftWaves({canvas:target.canvas,requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false,isHidden:()=>false,targetFps:30,maxDpr:1.5,maxWidth:1200});
  assert.equal(field.mode,'live');assert.equal(field.paints,0);assert.ok(target.canvas.width>0&&target.canvas.width<=1200);
  field.start();field.start();for(let i=0;i<120;i++)timer.step();
  assert.ok(field.paints>0,'quiet waves render behind the letter');assert.ok(field.paints<=62,'rendering is capped at 30 frames per second');
  field.stop();const painted=field.paints;timer.step();assert.equal(field.paints,painted);assert.equal(timer.pending(),0,'no background loop survives closing the letter');
  assert.ok(target.calls.clear>0,'stopping clears the decorative field');
  field.dispose();assert.equal(target.canvas.width,0);assert.equal(target.canvas.height,0,'dispose releases the surface');
});
test('reduced motion, a hidden page and a wide surface stay bounded and quiet',()=>{
  const timer=clock();let reduced=true;const hidden=surface();
  const field=waves.createGiftWaves({canvas:hidden.canvas,requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>reduced,isHidden:()=>false,targetFps:30});
  field.start();assert.equal(timer.pending(),0,'reduced motion keeps the static field without frames');assert.equal(field.paints,0);
  reduced=false;field.start();assert.ok(timer.pending()===1);field.stop();assert.equal(timer.pending(),0);
  const wide=surface({width:5000,height:2000}),bounded=waves.createGiftWaves({canvas:wide.canvas,requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false,isHidden:()=>true,targetFps:30,maxDpr:1.5,maxWidth:1200});
  assert.ok(wide.canvas.width<=1200,'rendering resolution is capped');bounded.start();assert.equal(timer.pending(),0,'a hidden page stops before the first frame');assert.equal(bounded.paints,0);
});
test('an unusable canvas falls back to the honest static wave field',async()=>{
  const timer=clock(),target=surface({context:false});
  const field=waves.createGiftWaves({canvas:target.canvas,requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false,isHidden:()=>false});
  assert.equal(field.mode,'static');assert.equal(field.live,false);
  field.start();assert.equal(timer.pending(),0);assert.equal(target.calls.stroke,0);
  field.stop();field.dispose();assert.equal(timer.pending(),0);
  const page=await readFile(new URL('../app/book-gift.html',import.meta.url),'utf8');
  assert.match(page,/class="gift-waves" aria-hidden="true"/);
  assert.match(page,/class="gift-waves-canvas"/);
  const css=await readFile(new URL('../app/book-gift.css',import.meta.url),'utf8');
  assert.match(css,/\.gift-waves\{[^}]*pointer-events:none/);
  assert.ok(!css.includes('@keyframes'),'the letter never bobs through keyframes');
});

test('the wave controller stops while the page is hidden and resumes with exactly one loop',()=>{
  const {timer,controller,fields,hide}=waveController();
  controller.setLetter(true);controller.setScene(true);
  for(let index=0;index<12;index++)timer.step();const painted=controller.field.paints;
  assert.ok(painted>0,'the quiet waves render while the letter is open');assert.equal(timer.pending(),1);
  hide(true);controller.visibility(true);
  assert.equal(timer.pending(),0);for(let index=0;index<12;index++)timer.step();assert.equal(controller.field.paints,painted,'a hidden page renders no frames');
  hide(false);controller.visibility(false);
  assert.equal(timer.pending(),1,'becoming visible restarts without duplicating the loop');for(let index=0;index<12;index++)timer.step();assert.ok(controller.field.paints>painted);
  assert.equal(fields.length,1,'the same renderer is reused; no stale field is left behind');
});
test('a persisted page hide releases the surface and pageshow rebuilds it only for an open letter',()=>{
  const {timer,controller,fields}=waveController();
  controller.setLetter(true);controller.setScene(true);
  for(let index=0;index<12;index++)timer.step();assert.ok(controller.field.paints>0);
  controller.pageHide();assert.equal(controller.field,null);assert.equal(timer.pending(),0);assert.equal(fields[0].canvas.width,0,'a persisted hide disposes the surface');
  controller.pageShow();assert.equal(controller.field.mode,'live');assert.equal(timer.pending(),1,'pageshow rebuilds and restarts for the open letter');
  for(let index=0;index<12;index++)timer.step();assert.ok(controller.field.paints>0);
  controller.setLetter(false);controller.pageHide();controller.pageShow();
  assert.equal(timer.pending(),0,'a closed letter never restarts the waves');
  controller.dispose();assert.equal(controller.field,null);assert.equal(timer.pending(),0);
});
test('closing the letter, reduced motion, the error scene and a preview update all leave zero idle frames',()=>{
  const {timer,controller,reduce}=waveController();
  controller.setLetter(true);controller.setScene(true);timer.step();assert.ok(timer.pending()===1);
  controller.setLetter(false);assert.equal(timer.pending(),0,'closing the letter stops the renderer');
  controller.setLetter(true);reduce(true);controller.refresh();assert.equal(timer.pending(),0,'reduced motion keeps the static field');
  reduce(false);controller.refresh();assert.ok(timer.pending()===1);
  controller.setScene(false);assert.equal(timer.pending(),0,'the error scene detaches the renderer cleanly');
  controller.setScene(true);assert.ok(timer.pending()===1);
  const first=controller.field,firstCanvas=first.paints;
  controller.remount();assert.notEqual(controller.field,first,'a preview update rebuilds the renderer');
  for(let index=0;index<12;index++)timer.step();
  assert.equal(first.paints,firstCanvas,'the stale renderer is disposed, not left looping');assert.equal(timer.pending(),1);assert.ok(controller.field.paints>0);
  controller.dispose();assert.equal(timer.pending(),0);
});
test('the wave backing store budgets width, height and total pixels for extreme letter shapes',()=>{
  for(const [width,height]of [[300,50000],[50000,300]]){
    const timer=clock(),target=surface({width,height});
    const field=waves.createGiftWaves({canvas:target.canvas,requestFrame:timer.request,cancelFrame:timer.cancel,isReduced:()=>false,isHidden:()=>false,targetFps:30,maxDpr:1.5,maxWidth:1200,maxHeight:1600,maxPixels:1200*1600});
    assert.ok(target.canvas.width<=1200&&target.canvas.height<=1600,width+'x'+height+' stays inside the width and height budget');
    assert.ok(target.canvas.width*target.canvas.height<=1200*1600,width+'x'+height+' stays inside the pixel budget');
    const aspect=(target.canvas.width/target.canvas.height)/(width/height);
    assert.ok(Math.abs(aspect-1)<0.1,width+'x'+height+' keeps the quiet scene aspect');
    field.start();for(let index=0;index<6;index++)timer.step();assert.ok(field.paints>0);
    target.size.width=300;target.size.height=120;field.resize();
    assert.ok(target.canvas.width<=1200&&target.canvas.height<=1600&&target.canvas.width*target.canvas.height<=1200*1600,'resize stays bounded');
    field.stop();field.dispose();assert.equal(target.canvas.width,0);assert.equal(target.canvas.height,0);assert.equal(timer.pending(),0);
  }
});

test('the gift page wiring keeps an error scene dark and recovers a correctly sized canvas on the next presentation',()=>{
  const fixture=sceneFixture();
  fixture.scene.letter(true);
  fixture.fail();
  assert.equal(fixture.controller.field,null);assert.equal(fixture.timer.pending(),0,'the error scene detaches its renderer');
  fixture.hide(true);fixture.scene.visibility(true);
  fixture.hide(false);fixture.scene.visibility(false);
  assert.equal(fixture.timer.pending(),0,'becoming visible never revives waves behind a hidden error scene');
  fixture.scene.pageHide();fixture.scene.pageShow();
  assert.equal(fixture.timer.pending(),0,'pageshow never revives waves behind a hidden error scene');
  fixture.scene.relayout();fixture.scene.reducedChanged();
  assert.equal(fixture.timer.pending(),0,'a reflow or motion change never revives the hidden error scene');
  fixture.present();
  assert.equal(fixture.timer.pending(),1,'a later presentation recovers exactly one loop');
  for(let index=0;index<12;index++)fixture.timer.step();
  assert.ok(fixture.controller.field.paints>0);
  assert.equal(fixture.fields.at(-1).canvas.width,320);assert.equal(fixture.fields.at(-1).canvas.height,120,'the renderer measures the visible scene, never a hidden 1x1 placeholder');
});
test('the gift page wiring keeps letter state across pagehide and drops stale renderers on preview updates',()=>{
  const fixture=sceneFixture();
  fixture.scene.letter(true);fixture.present();
  for(let index=0;index<12;index++)fixture.timer.step();
  assert.equal(fixture.timer.pending(),1);assert.ok(fixture.controller.field.paints>0);
  fixture.scene.pageHide();assert.equal(fixture.timer.pending(),0);assert.equal(fixture.fields[0].canvas.width,0,'a persisted hide releases the surface');
  fixture.scene.pageShow();assert.equal(fixture.timer.pending(),1,'pageshow keeps the intended letter state');
  for(let index=0;index<12;index++)fixture.timer.step();assert.ok(fixture.controller.field.paints>0);
  const first=fixture.controller.field;
  fixture.present();assert.notEqual(fixture.controller.field,first,'a preview update rebuilds the renderer');
  const stale=first.paints;
  for(let index=0;index<12;index++)fixture.timer.step();
  assert.equal(first.paints,stale,'no stale renderer keeps looping after a preview update');assert.equal(fixture.timer.pending(),1);
  fixture.scene.letter(false);fixture.timer.step();assert.equal(fixture.timer.pending(),0,'folding the letter leaves zero idle frames');
});
