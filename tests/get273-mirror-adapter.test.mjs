import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {createMirrorControl} from '../tools/get273-mirror-control.mjs';
const {createMirrorServer}=await import('../tools/get273-mirror-adapter.mjs');

async function fixture(fn){
  const calls=[];
  const control={frame:async()=>{calls.push('frame');return Buffer.from('jpeg');},touch:async phase=>calls.push(phase),abort:reason=>calls.push(reason)};
  const mirror=createMirrorServer(control);const origin=await mirror.listen();
  try{await fn({origin,calls});}finally{await mirror.close();}
}
test('mirror serves only owned frame/touch routes and rejects cross-site or unauthenticated input',async()=>fixture(async({origin,calls})=>{
  const page=await fetch(origin),html=await page.text();
  assert.equal(page.headers.get('set-cookie'),null);
  const csrf=html.match(/nonce="([a-f0-9]{64})"/)[1],cap={'x-qa-csrf':csrf};
  assert.equal((await fetch(origin+'/frame.jpg')).status,403);
  assert.equal((await fetch(origin+'/frame.jpg',{headers:{...cap,'Sec-Fetch-Site':'cross-site'}})).status,403);
  const frame=await fetch(origin+'/frame.jpg',{headers:cap});assert.equal(frame.status,200);assert.equal(await frame.text(),'jpeg');
  const post=(body,extra={})=>fetch(origin+'/touch',{method:'POST',headers:{origin,'content-type':'application/json',...cap,...extra},body:JSON.stringify(body)});
  assert.equal((await post({phase:'begin',x:.4,y:.4},{origin:'https://example.invalid'})).status,403);
  assert.equal((await post({phase:'begin',x:.4,y:.4})).status,200);
  assert.equal((await post({phase:'move',x:.4,y:.4,udid:'other'})).status,400);
  for(const path of ['/exec','/logs','/rpc','/frame.jpg?other=1'])assert.equal((await fetch(origin+path,{headers:cap})).status,404);
  assert.deepEqual(calls,['frame','begin','invalid-request']);
}));
test('hostile Host fails before it can issue a capability cookie or capture a frame',async()=>fixture(async({origin,calls})=>{
  const result=await new Promise((resolve,reject)=>{http.get(origin,{headers:{Host:'evil.invalid'}},res=>{res.resume();res.on('end',()=>resolve({code:res.statusCode,cookie:res.headers['set-cookie']}));}).on('error',reject);});
  assert.equal(result.code,403);assert.equal(result.cookie,undefined);assert.deepEqual(calls,[]);
}));
test('another localhost port cannot embed frames through a host-wide cookie without an origin-isolated header',async()=>fixture(async({origin,calls})=>{
 const page=await fetch(origin),cookie=page.headers.get('set-cookie')?.split(';')[0]??'legacy=unused';
 const frame=await fetch(origin+'/frame.jpg',{headers:{cookie,'Sec-Fetch-Site':'same-site'}});
 assert.equal(frame.status,403);assert.deepEqual(calls,[]);
}));

test('actual client script preserves a hold and final drag point across delayed native begin acknowledgement',async()=>fixture(async({origin})=>{
 const html=await(await fetch(origin)).text(),script=html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1];
 let now=0,resolveBegin,frameRequests=0;const phases=[],timers=[],handlers=new Map();
 const image={getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),setPointerCapture:()=>{}},status={};
 const context={document:{getElementById:id=>id==='screen'?image:status},window:{addEventListener:(name,fn)=>handlers.set(name,fn)},performance:{now:()=>now},Date,
  URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},setTimeout:(fn,ms)=>{timers.push({fn,at:now+ms,cancelled:false});return fn;},clearTimeout:fn=>{for(const t of timers)if(t.fn===fn)t.cancelled=true;},
  fetch:async(path,options)=>{if(path==='/frame.jpg'){frameRequests++;return {ok:true,blob:async()=>'',headers:{get:()=>frameRequests}};}
   const p=JSON.parse(options.body);phases.push({...p,at:now});if(p.phase==='begin')await new Promise(r=>{resolveBegin=r;});return{ok:true};},
 };
 const runTimers=()=>{for(const t of [...timers])if(!t.cancelled&&t.at<=now){t.cancelled=true;t.fn();}};
 vm.runInNewContext(script,context);const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 const event=(x,y)=>({clientX:x,clientY:y,button:0,pointerId:1,preventDefault:()=>{}});
 image.onpointerdown(event(40,40));await flush();now=700;image.onpointerup(event(40,40));
 now=900;resolveBegin();await flush();
 assert.deepEqual(phases.map(p=>p.phase),['begin']);
 now=1600;runTimers();await flush();
 assert.deepEqual(phases.map(p=>p.phase),['begin','end']);assert(phases[1].at-900>=700);
 // A separate short drag ends at its last actual pointer coordinate, even before begin ack.
 now=2000;image.onpointerdown(event(30,30));await flush();now=2010;image.onpointermove(event(60,70));image.onpointerup(event(60,70));
 now=2200;resolveBegin();await flush();now=2300;runTimers();await flush();
 assert.deepEqual(phases.slice(2).map(p=>[p.phase,p.x,p.y]),[['begin',.3,.3],['move',.6,.7],['end',.6,.7]]);
 assert(frameRequests>=2);
 // A cancelled hold cannot lend its old release deadline to the next short tap.
 now=3000;image.onpointerdown(event(30,30));await flush();now=3700;image.onpointerup(event(30,30));
 now=3900;resolveBegin();await flush();now=4000;handlers.get('blur')();await flush();
 assert.equal(phases.at(-1).phase,'end');
 now=4100;image.onpointerdown(event(30,30));await flush();now=4110;image.onpointerup(event(30,30));
 now=4200;resolveBegin();await flush();now=4250;runTimers();await flush();
 assert.deepEqual(phases.slice(-2).map(p=>p.phase),['begin','end']);
}));

test('real HTTP client disconnect triggers own end while a frame is pending',{timeout:1000},async()=>{
 const phases=[];let releaseFrame,frameStarted,ended;
 const end=new Promise(r=>{ended=r;});
 const started=new Promise(r=>{frameStarted=r;}),gate=new Promise(r=>{releaseFrame=r;});
 const control=createMirrorControl({assertOwner:async()=>{},hid:{touch:async phase=>{phases.push(phase);if(phase==='end')ended();}},capture:{snapshotJpeg:async()=>{frameStarted();await gate;return Buffer.from('jpeg');}}});
 const mirror=createMirrorServer(control),origin=await mirror.listen();
 try{
  const html=await(await fetch(origin)).text(),cap={'x-qa-csrf':html.match(/nonce="([a-f0-9]{64})"/)[1]};
  await fetch(origin+'/touch',{method:'POST',headers:{...cap,origin,'content-type':'application/json'},body:JSON.stringify({phase:'begin',x:.4,y:.4})});
  const request=http.get(origin+'/frame.jpg',{headers:cap});request.on('error',()=>{});await started;
  request.destroy();await end;for(let n=0;n<10;n++)await Promise.resolve();
  assert.deepEqual(phases,['begin','end']);assert.equal(control.receipt().activeTouch,false);
 }finally{releaseFrame();await mirror.close();await control.stop();}
});
