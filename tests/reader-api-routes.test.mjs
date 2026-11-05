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


test('restored identity checks share one request, fail closed offline, and invalidate a changed owner',async t=>{
  const previous={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,document:globalThis.document};
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const doc=Object.assign(new EventTarget(),{hidden:false});let response,calls=0,replaced;
  globalThis.document=doc;globalThis.window={addEventListener:()=>{}};
  globalThis.location={search:'?book=identity-fixture',origin:'https://reader.example.invalid',replace:url=>replaced=url};
  globalThis.fetch=async()=>new Response(JSON.stringify({user:{id:'owner-a'}}));
  const module=await import('../app/reader-api.mjs?identity-confirmation');
  globalThis.fetch=()=>{calls++;return new Promise(resolve=>response=resolve);};
  const first=module.confirmReaderIdentity(),second=module.confirmReaderIdentity();
  assert.equal(first,second);assert.equal(calls,1);
  response(new Response(JSON.stringify({user:{id:'owner-a'}})));assert.equal(await first,true);
  globalThis.fetch=async()=>{throw Error('offline');};assert.equal(await module.confirmReaderIdentity(),false);
  globalThis.fetch=async()=>new Response(JSON.stringify({user:{id:'owner-b'}}));
  assert.equal(await module.confirmReaderIdentity(),false);assert.equal(replaced,'/library');
  assert.equal(await module.confirmReaderIdentity(),false);
});

test('a guest-owned inline login defers focus identity checks until its authentication dialog closes',async t=>{
 const previous={fetch:globalThis.fetch,location:globalThis.location,window:globalThis.window,document:globalThis.document};
 t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 let open=true,calls=0,replaced;
 globalThis.document=Object.assign(new EventTarget(),{hidden:false,querySelector:()=>open?{}:null});globalThis.window={addEventListener(){}};
 globalThis.location={search:'?book=public-login-fixture',origin:'https://reader.example.invalid',replace:url=>replaced=url};
 globalThis.fetch=async()=>new Response(JSON.stringify({user:null}));
 const module=await import('../app/reader-api.mjs?inline-login-confirmation');
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({user:{id:'verified-setup-owner'}}));};
 assert.equal(await module.confirmReaderIdentity(),false);assert.equal(calls,0);assert.equal(replaced,undefined);
 open=false;assert.equal(await module.confirmReaderIdentity(),false);assert.equal(calls,1);assert.equal(replaced,'/library');
});
test('readerFetch prepares paid account chat and keeps the same quote on a lost-response retry',async t=>{
 const previous=Object.fromEntries(['fetch','location','window','document','confirm','sessionStorage'].map(key=>[key,globalThis[key]])),calls=[],storage=new Map();
 t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const owner='account-reader-fixture',billing={enabled:true,mode:'test',unitsPerPoint:1000000,prices:{translation:1000000,conversation:4000000,annotation:4000000}},data={id:'account-reader-paid',text:'A question without a book',passageId:'conversation',contentVersion:'library-chat-v1',scopeRevision:0};let quotes=0,confirmations=0,dispatches=0;
 globalThis.location={search:'?book=fixture-source',origin:'https://reader.example.invalid',replace:()=>{}};globalThis.window={addEventListener:()=>{}};globalThis.document=Object.assign(new EventTarget(),{hidden:false});globalThis.confirm=()=>{confirmations++;return true;};globalThis.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(url==='/api/auth/session')return new Response(JSON.stringify({user:{id:owner},billing}));if(url==='/api/account/ui-preferences')return new Response(JSON.stringify({revision:0,uiLocale:null,updatedAt:null}));if(url==='/api/billing/quotes'){quotes++;const body=JSON.parse(options.body);assert.equal(body.action,'conversation');assert.equal(body.bookId,'leafhour-library-chat');assert.deepEqual(body.input,data);return new Response(JSON.stringify({id:'reader-account-quote',ownerId:owner,action:'conversation',units:4000000,scope:{bookId:'leafhour-library-chat',requestId:data.id,passageId:data.passageId,contentVersion:data.contentVersion}}));}return new Response('{}');};
 const {readerFetch}=await import('../app/reader-api.mjs?paid-account-chat');
 for(let attempt=0;attempt<2;attempt++)await readerFetch('/api/library/chat',{method:'POST',body:JSON.stringify(data),onDispatch:()=>dispatches++});
 const posted=calls.filter(call=>call.url==='/api/library/chat').map(call=>JSON.parse(call.options.body));assert.equal(posted.length,2);assert.ok(posted[0].billing);assert.deepEqual(posted[1].billing,posted[0].billing);assert.equal(quotes,1);assert.equal(confirmations,1);assert.equal(dispatches,2);
 await readerFetch('/api/library/chat/'+data.id+'/cancel',{method:'POST',body:'{}'});assert.equal(quotes,1,'cancellation is free and bypasses quote preparation');
});
