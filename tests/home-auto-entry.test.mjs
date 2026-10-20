import test from 'node:test';
import assert from 'node:assert/strict';
import {enterAutoHome} from '../app/home-entry.mjs';
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
