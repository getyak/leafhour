import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {prepareCreditRequest} from '../app/credit-client.mjs';

const source=await readFile(new URL('../app/reader-api.mjs',import.meta.url),'utf8'),tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
// AST positions belong to the original source. Remove module declarations before
// changing an import expression's length, including exports after that expression.
let executable=source;
for(const node of [...tree.body].reverse())if(node.type==='ImportDeclaration')executable=executable.slice(0,node.start)+executable.slice(node.end);else if(node.type==='ExportNamedDeclaration')executable=executable.slice(0,node.start)+executable.slice(node.declaration.start);
executable=executable.replace("import("+"'./credit-client.mjs')","Promise.resolve({prepareCreditRequest:globalThis.prepareCreditRequest})");
async function fixture({enabled=true,prepare,fetcher}={}){
 const calls=[],prepared=[],events=[],listeners=new Map(),doc=Object.assign(new EventTarget(),{hidden:false}),session={user:{id:'owner-a'},billing:{enabled,mode:'test',unitsPerPoint:1_000_000,prices:{translation:1_000_000,conversation:4_000_000,annotation:4_000_000}}};
 const fetch=async(url,options={})=>{calls.push({url,options});if(url==='/api/auth/session')return Response.json(session);return fetcher?fetcher(url,options):Response.json({ok:true});};
 const context=vm.createContext({URLSearchParams,URL,Event,Response,DOMException,crypto:webcrypto,document:doc,window:{addEventListener:(name,handler)=>listeners.set(name,handler)},location:{search:'?book=selected-book',origin:'https://reader.example',replace:url=>events.push(url)},fetch,adoptUiOwner:()=>{},assembleBookTransfer:()=>assert.fail('Not a multipart fixture'),getUiLocale:()=> 'ja',prepareCreditRequest:async input=>{prepared.push(input);return prepare?prepare(input):{...input.data,id:input.data.id||'generated-id',billing:{quoteId:'quote-id',idempotencyKey:input.data.id||'generated-id'}};}});
 const api=await vm.runInContext('(async()=>{'+executable+';return {readerApiUrl,readerFetch};})()',context);
 return {api,calls,prepared,doc,events,listeners};
}
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('reader billing routes keep their account scope instead of acquiring the selected book prefix',async()=>{
 const f=await fixture();assert.equal(f.api.readerApiUrl('/api/billing/quotes'),'/api/billing/quotes');assert.equal(f.api.readerApiUrl('/api/billing/account?cursor=1'),'/api/billing/account?cursor=1');
});
test('enabled reader prepares only actual generation POSTs after mapping their book route',async()=>{
 const f=await fixture();
 for(const [route,expected] of [['/api/translate','/api/library/books/selected-book/translate'],['/api/chat','/api/library/books/selected-book/chat'],['/api/annotations/explain','/api/library/books/selected-book/annotations/explain'],['/api/translate?ui=ja','/api/library/books/selected-book/translate?ui=ja']]){
  await f.api.readerFetch(route,post({id:'request-'+f.prepared.length,passageId:'p',contentVersion:'v'}));const received=f.prepared.at(-1),call=f.calls.at(-1);assert.equal(received.url,expected);assert.equal(received.owner,'owner-a');assert.equal(received.session.user.id,'owner-a');assert.equal(received.locale,'ja');assert.equal(received.isCurrent(),true);assert.equal(call.options.headers['X-Reader-Owner'],'owner-a');assert.equal(JSON.parse(call.options.body).billing.quoteId,'quote-id');
 }
 await f.api.readerFetch('/api/chat');await f.api.readerFetch('/api/chat/request/cancel',post({}));await f.api.readerFetch('/api/introduction',post({contentVersion:'v'}));await f.api.readerFetch('/api/billing/quotes',post({action:'conversation'}));assert.equal(f.prepared.length,4);
});
test('billing-disabled reader keeps the exact original generation body and makes no preparation calls',async()=>{
 const f=await fixture({enabled:false}),options=post({passageId:'p'});await f.api.readerFetch('/api/translate',options);assert.equal(f.prepared.length,0);assert.equal(f.calls.at(-1).options.body,options.body);assert.equal(options.body,'{"passageId":"p"}');
});
test('owner invalidation while credit confirmation awaits blocks the generation dispatch',async()=>{
 let release,entered;const waiting=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
 const f=await fixture({prepare:async input=>{entered();await waiting;assert.equal(input.isCurrent(),false);return input.data;}}),pending=f.api.readerFetch('/api/chat',post({id:'r',text:'Question'}));await Promise.race([ready,pending.then(()=>{throw Error('Credit preparation was bypassed');})]);f.doc.dispatchEvent(new Event('reader:session-changed'));release();await assert.rejects(pending);assert.equal(f.calls.length,1);
});
test('aborting a request during credit preparation prevents its later model POST',async()=>{
 let release,entered;const waiting=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
 const f=await fixture({prepare:async input=>{entered();await waiting;return input.data;}}),controller=new AbortController(),pending=f.api.readerFetch('/api/translate',{...post({passageId:'p'}),signal:controller.signal});await Promise.race([ready,pending.then(()=>{throw Error('Credit preparation was bypassed');})]);controller.abort();release();await assert.rejects(pending);assert.equal(f.calls.length,1);
});
test('a foreign owner quote response invokes the existing session-change navigation guard',async()=>{
 const f=await fixture({prepare:async input=>{await input.fetcher('/api/billing/quotes',post({}));return input.data;},fetcher:async()=>new Response('{}',{status:409,headers:{'X-Reader-Session-Changed':'1'}})});
 await assert.rejects(f.api.readerFetch('/api/chat',post({id:'r',text:'Question'})));assert.deepEqual(f.events,['/library']);assert.equal(f.calls.filter(c=>c.url.endsWith('/chat')).length,0);
});
test('real reader helper quotes the captured translation version before dispatch and declined consent sends no model request',async()=>{
 for(const consent of [true,false]){
  let confirmed=0;
  const f=await fixture({prepare:input=>prepareCreditRequest({...input,confirm:()=>{confirmed++;return consent;},storage:{getItem:()=>null,setItem:()=>{}}}),fetcher:async(url,options)=>{
   if(url==='/api/billing/quotes'){const request=JSON.parse(options.body);return Response.json({id:'real-quote',ownerId:'owner-a',action:request.action,units:1_000_000,scope:{bookId:request.bookId,requestId:request.input.id,contentVersion:request.input.contentVersion,passageId:request.input.passageId},expiresAt:'2099-01-01T00:00:00Z'});}
   return Response.json({ok:true});
  }});
  const pending=f.api.readerFetch('/api/translate',post({passageId:'p',contentVersion:'v'}));if(consent)await pending;else await assert.rejects(pending,{code:'BILLING_CONSENT_CANCELLED'});
  assert.equal(confirmed,1);const quote=f.calls.find(c=>c.url==='/api/billing/quotes'),model=f.calls.find(c=>c.url==='/api/library/books/selected-book/translate');assert.ok(quote);assert.equal(JSON.parse(quote.options.body).input.contentVersion,'v');
  if(consent){const sent=JSON.parse(model.options.body);assert.equal(sent.id,JSON.parse(quote.options.body).input.id);assert.equal(sent.billing.quoteId,'real-quote');assert.ok(sent.billing.idempotencyKey);}else assert.equal(model,undefined);
 }
});
test('reader onDispatch fires only for final generation after preparation and is stripped from fetch options',async()=>{
 const sequence=[],f=await fixture({prepare:async input=>{sequence.push('prepare');await input.fetcher('/api/billing/quotes',post({}));sequence.push('prepared');return input.data;},fetcher:async url=>{sequence.push(url);return Response.json({ok:true});}});
 await f.api.readerFetch('/api/chat',{...post({id:'r',text:'Question'}),onDispatch:()=>sequence.push('dispatch')});
 assert.deepEqual(sequence,['prepare','/api/billing/quotes','prepared','dispatch','/api/library/books/selected-book/chat']);assert.equal(f.calls.at(-1).options.onDispatch,undefined);
 const disabled=await fixture({enabled:false});let dispatched=0;await disabled.api.readerFetch('/api/chat',{...post({}),onDispatch:()=>dispatched++});assert.equal(dispatched,1);assert.equal(disabled.calls.at(-1).options.onDispatch,undefined);
 const controller=new AbortController();controller.abort();await assert.rejects(disabled.api.readerFetch('/api/chat',{...post({}),signal:controller.signal,onDispatch:()=>dispatched++}));assert.equal(dispatched,1);
});
