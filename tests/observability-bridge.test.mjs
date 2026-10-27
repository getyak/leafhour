import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {mountReaderObservability} from '../app/observability-bridge.mjs';

const source=await readFile(new URL('../app/reader.js',import.meta.url),'utf8'),start=source.indexOf('function afterReaderPaint('),end=source.indexOf('\nlet observabilityStarted=',start);
assert.ok(start>0&&end>start);
function fixture(t,{opening=null,readConsent=null,pending=false}={}){
  let owner='alice',status=pending?null:opening||{position:{passageId:'PRIVATE_PASSAGE'},hadSaved:true},interacted=false,targetVisible=true;const frames=[],idle=[],requests=[],document=new EventTarget();document.hidden=false;document.hasFocus=()=>true;document.body={dataset:{ready:opening?.failure?'false':'true'}};
  const window=new EventTarget();Object.assign(window,{innerWidth:400,innerHeight:800,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},requestIdleCallback:fn=>{idle.push(fn);return idle.length;},getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'})});
  const content={isConnected:true,getClientRects:()=>[{top:10,bottom:100,left:10,right:300,width:290,height:90}],contains:()=>true},target={getClientRects:()=>targetVisible?content.getClientRects():[{top:10,bottom:100,left:450,right:740,width:290,height:90}]},root={querySelectorAll:()=>[content],querySelector:()=>target};
  const fetcher=async(url,options={})=>{requests.push({url,options});return Response.json(url.endsWith('/events')?{accepted:true}:readConsent?await readConsent():{enabled:true,analytics:true,diagnostics:true});};
  const facade={operationId:crypto.randomUUID(),requestFailed(){},dispose(){},syncOwner(){this.dispose();this.operationId=crypto.randomUUID();}};
  const mount=operationId=>mountReaderObservability({facade,operationId,getOwner:()=>owner,document,window,getRoot:()=>root,getViewport:()=>null,isPaginated:()=>false,getStatus:()=>status,isInteracted:()=>interacted,fetcher});
  const afterPaint=runInNewContext('('+source.slice(start,end)+')',{window,setTimeout});
  const paint=()=>frames.splice(0).forEach(fn=>fn()),runIdle=()=>idle.splice(0).forEach(fn=>fn());
  t.after(()=>facade.dispose());return {facade,mount,afterPaint,requests,paint,runIdle,document,window,setOpening:value=>{status=value;},setTargetVisible:value=>{targetVisible=value;},setOwner:value=>{owner=value;facade.syncOwner();},interact:()=>{interacted=true;},events:()=>requests.filter(r=>r.url.endsWith('/events')).flatMap(r=>JSON.parse(r.options.body).events)};
}
test('the actual reader scheduler waits for usable paint and idle; delayed module observes current resume in order',async t=>{
  const s=fixture(t),operationId=s.facade.operationId;let loads=0,release;const moduleReady=new Promise(resolve=>{release=resolve;});
  s.afterPaint(()=>{loads++;void moduleReady.then(()=>s.mount(operationId));});assert.equal(loads,0);s.paint();assert.equal(loads,0);s.paint();assert.equal(loads,0);s.runIdle();assert.equal(loads,1);assert.equal(s.requests.length,0);
  release();await new Promise(setImmediate);s.paint();await s.facade.flush();assert.equal(s.facade.operationId,operationId);assert.deepEqual(s.events().map(e=>e.name),['reader_open_requested','reader_content_visible','reader_resume_result']);assert.ok(s.events().every(e=>e.operationId===operationId));assert.ok(!JSON.stringify(s.events()).includes('PRIVATE_PASSAGE'));
});
test('logout and ABA invalidate delayed module activation and reset the operation before any request',async t=>{
  const s=fixture(t),operationId=s.facade.operationId;s.setOwner(null);s.setOwner('alice');assert.notEqual(s.facade.operationId,operationId);assert.equal(s.mount(operationId),null);assert.equal(s.requests.length,0);
});
test('an intervening trusted action is not replayed when the module observes the current document',async t=>{
  const s=fixture(t);s.interact();s.mount(s.facade.operationId);await new Promise(setImmediate);s.paint();await s.facade.flush();assert.deepEqual(s.events().map(e=>e.name),['reader_open_requested','reader_content_visible']);
});
test('a failed opening before module load reports its fixed fault once after error paint and consent, with no reading funnel',async t=>{
  const s=fixture(t,{opening:{failure:{name:'TypeError',expected:false,message:'PRIVATE_ERROR'}}});let mounted=false;
  s.afterPaint(()=>{mounted=true;s.mount(s.facade.operationId);});assert.equal(mounted,false);assert.equal(s.requests.length,0);s.paint();s.paint();s.runIdle();await new Promise(setImmediate);s.paint();await s.facade.flush();
  s.document.dispatchEvent(new Event('reader:failed'));await s.facade.flush();assert.deepEqual(s.events().map(event=>event.name),['reader_load_failed']);assert.equal(s.events()[0].properties.errorKind,'network');assert.ok(!JSON.stringify(s.events()).includes('PRIVATE_ERROR'));
});
test('resume observes current target geometry after consent, including callbacks received while configuration waits',async t=>{
  let resolve;const config=new Promise(done=>{resolve=done;}),s=fixture(t,{readConsent:()=>config});s.setTargetVisible(false);s.mount(s.facade.operationId);s.document.dispatchEvent(new Event('reader:resume'));s.paint();assert.equal(s.events().length,0);
  s.setTargetVisible(true);resolve({enabled:true,analytics:true,diagnostics:true});await new Promise(setImmediate);s.paint();await s.facade.flush();assert.deepEqual(s.events().map(event=>event.name),['reader_open_requested','reader_content_visible','reader_resume_result']);assert.equal(s.events().at(-1).properties.resume,'restored');
});
test('trusted interaction while consent is pending prevents replay of the earlier resume',async t=>{
  let resolve;const config=new Promise(done=>{resolve=done;}),s=fixture(t,{readConsent:()=>config});s.mount(s.facade.operationId);s.interact();resolve({enabled:true,analytics:true,diagnostics:true});await new Promise(setImmediate);s.paint();await s.facade.flush();assert.deepEqual(s.events().map(event=>event.name),['reader_open_requested','reader_content_visible']);
});
test('immediate consent keeps an offscreen target pending until the real pager scroll makes it visible',async t=>{
  const s=fixture(t);s.setTargetVisible(false);s.mount(s.facade.operationId);await new Promise(setImmediate);s.paint();await s.facade.flush();assert.deepEqual(s.events().map(event=>event.name),['reader_open_requested','reader_content_visible']);
  s.setTargetVisible(true);s.window.dispatchEvent(new Event('scroll'));s.paint();await s.facade.flush();assert.equal(s.events().at(-1).properties.resume,'restored');
});
test('personal records arriving after consent are observed only after actual restoration or explicit failure',async t=>{
  const s=fixture(t,{pending:true});s.mount(s.facade.operationId);await new Promise(setImmediate);s.paint();await s.facade.flush();assert.deepEqual(s.events().map(event=>event.name),['reader_open_requested','reader_content_visible']);
  s.setOpening({position:{passageId:'PRIVATE_PASSAGE'},hadSaved:true});s.document.dispatchEvent(new Event('reader:resume'));s.paint();await s.facade.flush();assert.equal(s.events().at(-1).properties.resume,'restored');
  s.document.dispatchEvent(new Event('reader:opening'));s.setOpening({failed:true});s.document.dispatchEvent(new Event('reader:ready'));s.document.dispatchEvent(new Event('reader:resume'));s.paint();await s.facade.flush();assert.equal(s.events().at(-1).properties.resume,'failed');
});
