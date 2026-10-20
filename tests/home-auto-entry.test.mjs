import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as clockCodec from '../app/ui-locale-codec.mjs';
import assert from 'node:assert/strict';
import {enterAutoHome} from '../app/home-entry.mjs';
const clockSource=readFileSync(new URL('../app/home-entry.mjs',import.meta.url),'utf8');
const fixture=(options={})=>{
 const view=new EventTarget(),calls=[],replacements=[];
 const location={href:'https://leafhour.test/?from=leaf#page',replace(value){replacements.push(value);this.href=new URL(value,this.href).href;}};
 return {view,calls,replacements,location,options:{view,location,languages:['zh-CN'],storage:{getItem:()=>null},request:async(url,options)=>{calls.push({url,options});return Response.json({user:null});},...options}};
};
test('new English, simplified, traditional and Japanese visitors use authored destinations without saving',async()=>{
 for(const [language,path]of [['en-US','/en'],['zh-CN','/zh-hans'],['zh-TW','/zh-hant'],['ja-JP','/ja']]){
  const f=fixture({languages:[language],storage:{getItem:()=>null,setItem(){assert.fail('automatic detection cannot save');}}});
  const result=await enterAutoHome(f.options);assert.equal(result.kind,'redirected');assert.deepEqual(f.replacements,[path+'?from=leaf#page']);assert.equal(f.calls.length,1);assert.ok(f.calls.every(c=>c.options.method==='GET'));
 }
});
test('a valid page language wins without identity requests and all other URL data survives',async()=>{
 const f=fixture({request:()=>assert.fail('query override requires no account read')});f.location.href='https://leafhour.test/?book=a%2Fb&ui=ja&source=v%2B1#p%20one';
 await enterAutoHome(f.options);assert.deepEqual(f.replacements,['/ja?book=a%2Fb&ui=ja&source=v%2B1#p%20one']);
});
test('the verified account wins over the device and only the captured owner is read',async()=>{
 const f=fixture({storage:{getItem:()=> 'zh-Hans'}});f.options.request=async(url,options)=>{f.calls.push({url,options});return Response.json(url==='/api/auth/session'?{user:{id:'account-A'}}:{revision:4,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'});};
 await enterAutoHome(f.options);assert.deepEqual(f.replacements,['/ja?from=leaf#page']);assert.equal(f.calls.length,3);assert.equal(f.calls[1].url,'/api/account/ui-preferences');assert.equal(f.calls[1].options.headers['X-Reader-Owner'],'account-A');
});
test('failed or malformed account records fall back to the exact device choice',async()=>{
 for(const record of [null,{uiLocale:'ja'},{revision:0,updatedAt:null,uiLocale:'ja'},{revision:2,updatedAt:'bad',uiLocale:'ja'},{revision:1,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja',owner:'other'}]){
  const f=fixture({storage:{getItem:()=> 'zh-Hant'}});f.options.request=async url=>Response.json(url==='/api/auth/session'?{user:{id:'account-A'}}:record);
  await enterAutoHome(f.options);assert.deepEqual(f.replacements,['/zh-hant?from=leaf#page']);
 }
 const f=fixture({storage:{getItem:()=> 'ja'},request:async()=>{throw Error('offline');}});await enterAutoHome(f.options);assert.deepEqual(f.replacements,['/ja?from=leaf#page']);
});
test('a bounded account deadline uses the browser and ignores the late result',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=fixture({timeoutMs:5,request:()=>pending});
 await enterAutoHome(f.options);assert.deepEqual(f.replacements,['/zh-hans?from=leaf#page']);resolve(Response.json({user:{id:'late'}}));await new Promise(r=>setTimeout(r,0));assert.equal(f.replacements.length,1);
});
test('interaction or leaving the page fences a pending account result',async()=>{
 for(const action of ['interaction','navigation','pagehide']){
  let resolve,started;const pending=new Promise(r=>resolve=r),ready=new Promise(r=>started=r),f=fixture({request:()=>{started();return pending;}});
  const work=enterAutoHome(f.options);await ready;
  if(action==='interaction')f.view.dispatchEvent(new Event('compositionstart'));else if(action==='pagehide')f.view.dispatchEvent(new Event('pagehide'));else f.location.href='https://leafhour.test/library';
  resolve(Response.json({user:null}));assert.equal((await work).kind,'continue');assert.deepEqual(f.replacements,[]);
 }
});
test('explicit authored and business routes never run an automatic entry request',async()=>{
 for(const path of ['/en','/zh-hans','/zh-hant','/ja','/read?book=alice','/library']){
  const f=fixture({request:()=>assert.fail('no automatic account read')});f.location.href='https://leafhour.test'+path;
  assert.equal((await enterAutoHome(f.options)).kind,'continue');assert.deepEqual(f.replacements,[]);
 }
});
test('the account response cannot choose the destination after the authenticated owner changes',async()=>{
 const f=fixture();let identityReads=0;
 f.options.request=async url=>Response.json(url==='/api/auth/session'?{user:{id:++identityReads===1?'account-A':'account-B'}}:{revision:4,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'});
 await enterAutoHome(f.options);assert.deepEqual(f.replacements,['/zh-hans?from=leaf#page']);assert.equal(identityReads,2);
});
test('session events and navigating away then back invalidate the original entry attempt',async()=>{
 for(const event of ['reader:session-changed','hashchange','popstate']){
  let resolve,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>resolve=r),f=fixture({request:()=>{started();return pending;}});f.view.document=new EventTarget();
  const work=enterAutoHome(f.options);await ready;
  if(event==='reader:session-changed')f.view.document.dispatchEvent(new Event(event));else{const original=f.location.href;f.location.href=original+'-other';f.view.dispatchEvent(new Event(event));f.location.href=original;}
  resolve(Response.json({user:null}));assert.equal((await work).kind,'continue');assert.deepEqual(f.replacements,[]);
 }
});
test('interaction releases portal startup immediately even when fetch ignores abort',async()=>{
 for(const event of ['pointerdown','keydown','compositionstart','pagehide','hashchange','popstate','reader:session-changed']){
  let started;const ready=new Promise(resolve=>started=resolve),f=fixture({request:()=>{started();return new Promise(()=>{});}});f.view.document=new EventTarget();
  const work=enterAutoHome(f.options);await ready;
  (event==='reader:session-changed'?f.view.document:f.view).dispatchEvent(new Event(event));
  let timer;try{const result=await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:'startup-still-blocked'}),80);})]);assert.equal(result.kind,'continue',event);assert.deepEqual(f.replacements,[]);}finally{clearTimeout(timer);}
 }
});

test('a verified account gets a separate bounded read and owner-check window',async()=>{
 let finishPreference;const preference=new Promise(resolve=>finishPreference=resolve);
 const f=fixture({timeoutMs:10,accountTimeoutMs:200,languages:['en-US']});
 f.options.request=async(url,options)=>{f.calls.push({url,options});return url==='/api/auth/session'?Response.json({user:{id:'account-A'}}):preference;};
 const work=enterAutoHome(f.options);
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.deepEqual(f.replacements,[],'identity deadline must not cancel the verified account read');
 finishPreference(Response.json({revision:4,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'}));
 assert.equal((await work).locale,'ja');assert.equal(f.calls.length,3);assert.deepEqual(f.replacements,['/ja?from=leaf#page']);
});
test('the second account window still bounds a hanging final identity check',async()=>{
 const f=fixture({timeoutMs:200,accountTimeoutMs:10,languages:['en-US']});let identityReads=0;
 f.options.request=async(url,options)=>{f.calls.push({url,options});if(url==='/api/auth/session')return ++identityReads===1?Response.json({user:{id:'account-A'}}):new Promise(()=>{});return Response.json({revision:4,updatedAt:'2026-10-20T00:00:00.000Z',uiLocale:'ja'});};
 const work=enterAutoHome(f.options);let watchdog;
 try{const result=await Promise.race([work,new Promise(resolve=>{watchdog=setTimeout(()=>resolve({kind:'unbounded'}),80);})]);assert.equal(result.kind,'redirected');assert.equal(result.locale,'en');assert.ok(f.calls.every(c=>c.options.signal.aborted));}finally{clearTimeout(watchdog);}
});

// Deterministic boundary checks: delayed timer delivery and response-body parsing.
const clockPrefs={revision:7,updatedAt:'2026-10-20T00:00:00Z',uiLocale:'ja'},clockUser={user:{id:'synthetic-A'}};
const flushClock=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function clockFixture(handler,extra={}){let time=0,id=0;const timers=new Map(),calls=[],replacements=[];const view=new EventTarget();view.document=new EventTarget();const location={href:'https://synthetic.invalid/?x=1#s',replace:p=>replacements.push(p)};
 const context={...clockCodec,URL,AbortController,Date,performance:{now:()=>time},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id)};vm.createContext(context);vm.runInContext(clockSource.replace(/^import .*;\n/,'').replace('export async function','async function')+';globalThis.enter=enterAutoHome;',context);
 const f={calls,replacements,view,timers,location,set:t=>{time=t;},expire(){const t=[...timers.values()][0];time=t.at;t.fn();},response:(value,t)=>({ok:true,json:async()=>{if(t!==undefined)time=t;return value;}})};
 f.work=context.enter({location,view,storage:{getItem:()=>null},languages:['en-US'],request:async(url,options)=>{calls.push({url,options});return handler(f,calls.length);},...extra});return f;}
test('observed 984+895+300ms sequence succeeds inside verified phase',async()=>{const f=clockFixture((f,n)=>f.response(n===2?clockPrefs:clockUser,[984,1879,2179][n-1]));assert.equal((await f.work).locale,'ja');assert.equal(f.calls.length,3);assert.equal(f.timers.size,0);});
test('identity body at exact old deadline cannot arm or request preferences',async()=>{const f=clockFixture((f)=>f.response(clockUser,2000));assert.equal((await f.work).locale,'en');assert.equal(f.calls.length,1);});
test('late preference body cannot dispatch final identity when timer delivery delayed',async()=>{const f=clockFixture((f,n)=>f.response(n===2?clockPrefs:clockUser,n===1?1000:4000));assert.equal((await f.work).locale,'en');assert.equal(f.calls.length,2);});
test('late final body cannot navigate to account locale when timer delivery delayed',async()=>{const f=clockFixture((f,n)=>f.response(n===2?clockPrefs:clockUser,[1000,1500,4000][n-1]));assert.equal((await f.work).locale,'en');assert.equal(f.calls.length,3);});
test('absolute 5s ceiling holds even injected identity timeout is 5s',async()=>{const f=clockFixture((f,n)=>f.response(n===2?clockPrefs:clockUser,n===1?4900:5000),{timeoutMs:5000});assert.equal((await f.work).locale,'en');assert.equal(f.calls.length,2);});
test('hung preference ignoring abort settles at second deadline and late body cannot restart',async()=>{let release;const f=clockFixture((f,n)=>n===1?f.response(clockUser,999):new Promise(r=>release=r));await flushClock();assert.equal(f.calls.length,2);f.expire();assert.equal((await f.work).locale,'en');release(f.response(clockPrefs));await flushClock();assert.equal(f.calls.length,2);assert.equal(f.replacements.length,1);assert(f.calls.every(c=>c.options.signal.aborted));});
test('second-stage interaction/session/ABA invalidates immediately',async()=>{for(const event of ['compositionstart','pagehide','reader:session-changed','popstate']){let release;const f=clockFixture((f,n)=>n===1?f.response(clockUser,100):new Promise(r=>release=r));await flushClock();(event==='reader:session-changed'?f.view.document:f.view).dispatchEvent(new Event(event));assert.equal((await f.work).kind,'continue');release(f.response(clockPrefs));await flushClock();assert.equal(f.calls.length,2);assert.equal(f.replacements.length,0);}});
test('final different owner does not apply old owner preference',async()=>{const f=clockFixture((f,n)=>f.response(n===2?clockPrefs:n===3?{user:{id:'synthetic-B'}}:clockUser));assert.equal((await f.work).locale,'en');});
test('guest is never given account deadline',async()=>{const f=clockFixture(f=>f.response({user:null},1999));assert.equal((await f.work).locale,'en');assert.equal(f.calls.length,1);});
