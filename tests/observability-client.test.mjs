import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {createBrowserObservability,safeErrorKind} from '../app/observability.mjs';
import {resolveOfflineReadingContext} from '../app/offline-reading.mjs';

const enabled={enabled:true,analytics:true,diagnostics:true,excluded:false,release:'test'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{config=enabled,handler}={}){
  let owner='alice';const calls=[];
  const fetcher=async(url,options={})=>{calls.push({url,options});if(handler)return handler(url,options);return Response.json(config);};
  const client=createBrowserObservability({fetcher,getOwner:()=>owner,page:'reader',batchDelay:60000,window:null,document:null});
  t.after(()=>client.dispose());return {client,calls,setOwner:value=>{owner=value;client.syncOwner();},events:()=>calls.filter(c=>c.url.endsWith('/events')).flatMap(c=>JSON.parse(c.options.body).events)};
}
test('nothing is queued before explicit loaded consent; a later consent does not recover earlier activity',async t=>{
  const s=fixture(t,{config:{...enabled,analytics:false,diagnostics:false}});
  s.client.event('reader_open_requested',{stage:'reader_open'});await s.client.refresh();
  s.client.event('reader_content_visible',{stage:'reader_visible'});await s.client.flush();assert.equal(s.events().length,0);
  await s.client.setConsent({analytics:true,diagnostics:false});
  // A server response remains authoritative; off cannot become on locally.
  s.client.event('reader_active',{});await s.client.flush();assert.equal(s.events().length,0);
});
test('outgoing metadata is closed and never contains private strings, raw errors or URLs',async t=>{
  const s=fixture(t);await s.client.refresh();
  const secret='SECRET_PRIVATE_BOOK_EMAIL_TOKEN';
  s.client.event('reader_content_visible',{page:'reader',stage:'reader_visible',outcome:'success',durationMs:12,bookId:secret,title:secret,url:'https://x.test/?q='+secret,text:secret,error:Error(secret)});
  s.client.error(Error(secret),{stage:'client',url:secret,message:secret});await s.client.flush();
  assert.equal(s.events().length,2);const bytes=JSON.stringify(s.calls);assert.ok(!bytes.includes(secret));
  assert.deepEqual(Object.keys(s.events()[0].properties).sort(),['client','durationMs','outcome','page','stage']);
  assert.ok(s.calls.every(c=>c.url.startsWith('/api/account/observability')));
});
test('analytics and diagnostics switches are independent and routine cancellation is silent',async t=>{
  const s=fixture(t,{config:{...enabled,analytics:false}});await s.client.refresh();
  s.client.event('reader_active',{});s.client.requestFailed({status:403});s.client.requestFailed({error:new DOMException('private','AbortError')});s.client.requestFailed({status:503});await s.client.flush();
  assert.deepEqual(s.events().map(e=>e.name),['request_failed']);assert.equal(s.events()[0].properties.status,503);
});
test('revocation clears pending work immediately even if saving consent fails',async t=>{
  let rejectSave=false;const s=fixture(t,{handler:async(url,options)=>{if(rejectSave&&options.method==='POST'&&!url.endsWith('/events'))throw Error('offline private');return Response.json(enabled);}});
  await s.client.refresh();s.client.event('reader_active',{});rejectSave=true;await assert.rejects(s.client.setConsent({analytics:false,diagnostics:false}));
  await s.client.flush();assert.equal(s.events().length,0);assert.equal(s.client.config().analytics,false);
});
test('owner changes and ABA invalidate pending config and event batches',async t=>{
  const s=fixture(t);await s.client.refresh();s.client.event('reader_active',{});const operation=s.client.operationId;
  s.setOwner('bob');s.setOwner('alice');await tick();await s.client.flush();assert.equal(s.events().length,0);assert.notEqual(s.client.operationId,operation);
  assert.ok(s.calls.every(c=>c.options.headers['X-Reader-Owner']==='alice'||c.options.headers['X-Reader-Owner']==='bob'));
});
test('a failed transport keeps stable event UUIDs for one bounded retry and never throws into reading',async t=>{
  let failed=false;const s=fixture(t,{handler:async url=>{if(url.endsWith('/events')&&!failed){failed=true;throw Error('offline PRIVATE');}return Response.json(enabled);}});
  await s.client.refresh();s.client.event('reader_active',{});await s.client.flush();await s.client.flush();
  const events=s.events();assert.equal(events.length,2);assert.equal(events[0].id,events[1].id);assert.equal(events[0].operationId,events[1].operationId);
});
test('signed-out and disabled installations send no events; event batches stay bounded',async t=>{
  const s=fixture(t);s.setOwner(null);await s.client.refresh();s.client.event('reader_active',{});await s.client.flush();assert.equal(s.events().length,0);
  s.setOwner('alice');await s.client.refresh();for(let n=0;n<80;n++)s.client.event('reader_active',{});await s.client.flush();assert.ok(s.events().length<=20);
  assert.ok(new TextEncoder().encode(s.calls.at(-1).options.body).length<=16384);
});
test('error classification only inspects fixed names and status, never exports messages',()=>{
  assert.equal(safeErrorKind(new TypeError('SECRET_URL')),'network');assert.equal(safeErrorKind(new SyntaxError('SECRET_TEXT')),'parse');assert.equal(safeErrorKind({name:'SECRET_ARBITRARY'}),'unknown');
});
test('a consent refresh aborts an in-flight analytics batch while diagnostics remains enabled',async t=>{
  let preferences=enabled,aborted=false;const s=fixture(t,{handler:async(url,options)=>{if(url.endsWith('/events'))return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));}));return Response.json(preferences);}});
  await s.client.refresh();s.client.event('reader_active',{});const sending=s.client.flush();preferences={...enabled,analytics:false};await s.client.refresh();await sending;assert.equal(aborted,true);assert.equal(s.client.config().diagnostics,true);
});
test('readerFetch adds only a random operation header, preserves failures, and never patches global fetch',async t=>{
  const before=Object.fromEntries(['document','window','location','fetch'].map(key=>[key,globalThis[key]]));t.after(()=>{for(const [key,value]of Object.entries(before)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  globalThis.document=Object.assign(new EventTarget(),{hidden:false});globalThis.window=new EventTarget();globalThis.location={search:'?book=SENTINEL_PRIVATE_BOOK',origin:'https://fixture.invalid',replace(){}};
  const calls=[],failure=new TypeError('SENTINEL_PRIVATE_ERROR');let fail=false;
  const original=async(url,options={})=>{calls.push({url,options});if(url==='/api/auth/session')return Response.json({user:{id:'alice'}});if(url==='/api/account/observability')return Response.json(enabled);if(url.endsWith('/events'))return Response.json({accepted:true});if(fail)throw failure;return Response.json({revision:0,uiLocale:null,ok:true});};globalThis.fetch=original;
  // Run the actual request wrapper and fresh session resolver with an online
  // device boundary. Chapter-cache hydration is owned by its separate tests.
  const source=await readFile(new URL('../app/reader-api.mjs',import.meta.url),'utf8'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),bindings={};let executable=source;
  const store={adopt:async()=>{},capture:()=>null,owner:()=>null,clear:async()=>{}};
  const offline={deviceBookStore:()=>store,resolveOfflineReadingContext:async options=>{const context=await resolveOfflineReadingContext(options);context.transport={fetch:options.fetcher,isOffline:()=>false};return context;}};
  for(const node of tree.body.filter(node=>node.type==='ImportDeclaration')){const provided=node.source.value==='./offline-reading.mjs'?offline:await import(new URL(node.source.value,new URL('../app/reader-api.mjs',import.meta.url)));for(const spec of node.specifiers)bindings[spec.local.name]=provided[spec.imported?.name||'default'];}
  for(const node of [...tree.body].reverse())if(node.type==='ImportDeclaration')executable=executable.slice(0,node.start)+executable.slice(node.end);else if(node.type==='ExportNamedDeclaration')executable=executable.slice(0,node.start)+executable.slice(node.declaration.start);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,module=await new AsyncFunction(...Object.keys(bindings),executable+';return {readerFetch,readerObservability};')(...Object.values(bindings));t.after(()=>module.readerObservability.dispose());
  const response=await module.readerFetch('/api/book');assert.equal(response.ok,true);assert.equal(globalThis.fetch,original);
  const bookCall=calls.find(call=>call.url==='/api/library/books/SENTINEL_PRIVATE_BOOK');assert.equal(bookCall.options.headers['X-Leafhour-Operation'],module.readerObservability.operationId);assert.equal(bookCall.options.headers['X-Reader-Owner'],'alice');
  fail=true;await assert.rejects(module.readerFetch('/api/chapters/SENTINEL_PRIVATE_PASSAGE?text=SENTINEL_PRIVATE_SOURCE'),error=>error===failure);await module.readerObservability.flush?.();
  const outbound=calls.filter(call=>call.url.endsWith('/events'));assert.equal(outbound.length,0,'reader activity before the optional module is unobserved');
});
