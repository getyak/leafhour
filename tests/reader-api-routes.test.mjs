import test from 'node:test';
import assert from 'node:assert/strict';

test('reader actions retain canonical gift URLs and the authenticated owner header',async t=>{
  const previous={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,document:globalThis.document},calls=[];
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  globalThis.location={search:'?book=current-book',origin:'https://reader.example.invalid',replace:()=>{}};
  globalThis.window={addEventListener:()=>{}};globalThis.document=Object.assign(new EventTarget(),{hidden:false});
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return new Response(JSON.stringify(url==='/api/auth/session'?{user:{id:'fixture-owner'}}:url==='/api/account/ui-preferences'?{revision:0,updatedAt:null,uiLocale:null}:{ok:true}),{headers:{'Content-Type':'application/json'}});};
  const {readerFetch}=await import('../app/reader-api.mjs');
  await readerFetch('/api/introduction',{method:'POST',body:'{"contentVersion":"v1"}'});
  await readerFetch('/api/library/books/current-book/gifts');
  await readerFetch('/api/book-gifts/'+'A'.repeat(43)+'/revoke',{method:'POST',body:'{}'});
  assert.deepEqual(calls.filter(c=>c.url!=='/api/auth/session'&&c.url!=='/api/account/ui-preferences').map(c=>c.url),['/api/library/books/current-book/introduction','/api/library/books/current-book/gifts','/api/book-gifts/'+'A'.repeat(43)+'/revoke']);
  for(const call of calls.filter(c=>c.url!=='/api/auth/session'))assert.equal(call.options.headers['X-Reader-Owner'],'fixture-owner');
  assert.equal(calls.filter(c=>c.url==='/api/account/ui-preferences').length,1,'the verified session is reused for one read-only UI preference adoption');
  let replaced;
  globalThis.location.replace=url=>replaced=url;globalThis.fetch=async()=>new Response('{}',{status:409,headers:{'X-Reader-Session-Changed':'1'}});
  await assert.rejects(readerFetch('/api/library/books/current-book/gifts'),/账户已切换/);assert.equal(replaced,'/library');
});

test('reader session mismatch synchronously invalidates subscribers before every navigation path',async t=>{
  const previous={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,document:globalThis.document};
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  for(const route of ['owner-response','focus','visibilitychange']){
    const listeners=new Map(),events=[],doc=Object.assign(new EventTarget(),{hidden:false});
    const originalAdd=doc.addEventListener.bind(doc);doc.addEventListener=(type,handler,...options)=>{listeners.set(type,handler);originalAdd(type,handler,...options);};
    let boot=true,invalidated=false;
    globalThis.document=doc;globalThis.window={addEventListener:(type,handler)=>listeners.set(type,handler)};
    globalThis.location={search:'?book=public-fixture',origin:'https://reader.example.invalid',replace:url=>{assert.equal(invalidated,true,route+' must invalidate before navigating');events.push(url);}};
    globalThis.fetch=async url=>{if(boot){boot=false;return new Response(JSON.stringify({user:{id:'owner-a'}}));}return route==='owner-response'?new Response('{}',{status:409,headers:{'X-Reader-Session-Changed':'1'}}):new Response(JSON.stringify({user:{id:'owner-b'}}));};
    const module=await import('../app/reader-api.mjs?invalidation='+route);
    doc.addEventListener('reader:session-changed',()=>{invalidated=true;});
    if(route==='owner-response')await assert.rejects(module.readerFetch('/api/records'),/账户已切换/);else await listeners.get(route)();
    assert.equal(invalidated,true,route);assert.deepEqual(events,['/library']);
  }
});
