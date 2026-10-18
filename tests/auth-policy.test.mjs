import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {createPortal} from '../server/portal.mjs';

test('independent hosted instances reserve one email delivery and report its remaining cooldown',async()=>{
  let now=100000;const f=authFixture(),make=()=>createHostedAuth({...f,store:f.store(),clock:()=>now});
  const outcomes=await Promise.allSettled([make().requestCode('Reader@example.com'),make().requestCode('reader@example.com')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.calls.filter(x=>x.url.pathname.endsWith('/otp')).length,1);
  const refusal=outcomes.find(x=>x.status==='rejected').reason;assert.equal(refusal.status,429);assert.equal(refusal.retryAfter,60);
  now+=15000;await assert.rejects(make().requestCode('reader@example.com'),e=>e.status===429&&e.retryAfter===45);
  now+=45000;assert.deepEqual(await make().requestCode('reader@example.com'),{sent:true,expiresIn:600,retryAfter:60});
});
test('failed delivery does not report success or remove its cooldown',async()=>{
  const f=authFixture({onProvider:({url})=>url.pathname.endsWith('/otp')?Promise.reject(new DOMException('timed out','TimeoutError')):undefined});
  const auth=createHostedAuth({...f,store:f.store(),clock:()=>100000});
  await assert.rejects(auth.requestCode('reader@example.com'),e=>e.status===503);
  await assert.rejects(auth.requestCode('reader@example.com'),e=>e.status===429);
});
test('cycling email addresses cannot exceed the shared hourly delivery ceiling',async()=>{
  const f=authFixture(),auth=createHostedAuth({...f,store:f.store(),clock:()=>100000});
  for(let i=0;i<30;i++)await auth.requestCode('reader'+i+'@example.com');
  await assert.rejects(auth.requestCode('another@example.com'),e=>e.status===429&&e.retryAfter===3600);
  assert.equal(f.calls.filter(x=>x.url.pathname.endsWith('/otp')).length,30);
});
test('mailbox input cannot contain a second address separator or control characters',async()=>{
  const f=authFixture(),auth=createHostedAuth({...f,store:f.store()});
  for(const value of ['a@b@example.com','reader\u0000@example.com'])await assert.rejects(auth.requestCode(value),e=>e.status===400);
  assert.equal(f.calls.length,0);
});
test('an expired refresh lease can be recovered after another instance stops',async()=>{
  let now=100000;const f=authFixture(),auth=createHostedAuth({...f,store:f.store(),clock:()=>now});
  const session=await auth.verifyCode('reader@example.com','123456');now+=3600000;
  const path=[...f.rows.keys()].find(x=>x.startsWith('auth/sessions/'));
  await f.store().mutate(path,{},row=>{row.refreshLease={id:'abandoned',expiresAt:now-1};});
  assert.equal((await auth.userFor(session.token)).id,'user-a');
});
test('hosted capabilities expose configured providers without secrets',async()=>{
  const f=authFixture(),auth=createHostedAuth({...f,store:f.store()});
  assert.equal(typeof auth.capabilities,'function');
  const c=await auth.capabilities();assert.deepEqual(c,{email:true,password:true,providers:{google:true,apple:false},otp:{digits:6,expiresIn:600,retryAfter:60}});
  assert.ok(!JSON.stringify(c).includes('fixture'));await auth.capabilities();assert.equal(f.calls.filter(x=>x.url.pathname.endsWith('/settings')).length,1);
});
test('a temporarily unavailable auth provider remains a retryable service error',async()=>{
  const f=authFixture({onProvider:({url})=>url.pathname.endsWith('/verify')?Response.json({error_code:'unexpected_failure'},{status:503}):undefined});
  const auth=createHostedAuth({...f,store:f.store()});await assert.rejects(auth.verifyCode('reader@example.com','123456'),e=>e.status===503);
});
test('parallel instances share one token refresh instead of rotating the same credential twice',async()=>{
  let now=100000,release;const gate=new Promise(resolve=>{release=resolve;});
  const f=authFixture({onProvider:async({url,providerSession})=>{if(url.searchParams.get('grant_type')==='refresh_token'){await gate;return Response.json({...providerSession(),access_token:'new-access',refresh_token:'new-refresh'});}}});
  const make=()=>createHostedAuth({...f,store:f.store(),clock:()=>now});
  const session=await make().verifyCode('reader@example.com','123456');now+=3600000;
  const a=make().userFor(session.token),b=make().userFor(session.token);await new Promise(resolve=>setTimeout(resolve,30));release();
  assert.equal((await a).id,'user-a');assert.equal((await b).id,'user-a');assert.equal(f.calls.filter(x=>x.url.searchParams.get('grant_type')==='refresh_token').length,1);
});
test('logout wins against a refresh that is already in flight',async()=>{
  let now=100000,release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const f=authFixture({onProvider:async({url,providerSession})=>{if(url.searchParams.get('grant_type')==='refresh_token'){started();await gate;return Response.json(providerSession());}}});
  const make=()=>createHostedAuth({...f,store:f.store(),clock:()=>now}),session=await make().verifyCode('reader@example.com','123456');now+=3600000;
  const pending=make().userFor(session.token);await ready;await make().logout(session.token);release();assert.equal(await pending,null);assert.equal(await make().userFor(session.token),null);
});
test('provider transport failures do not masquerade as a permanently signed-out user',async()=>{
  let unavailable=false;const f=authFixture({onProvider:({url})=>unavailable&&url.pathname.endsWith('/user')?Response.json({error_code:'unexpected_failure'},{status:503}):undefined});
  const auth=createHostedAuth({...f,store:f.store()}),session=await auth.verifyCode('reader@example.com','123456');unavailable=true;
  await assert.rejects(auth.userFor(session.token),e=>e.status===503);unavailable=false;assert.equal((await auth.userFor(session.token)).id,'user-a');
});
test('logout also wins against an identity lookup already in flight',async()=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const f=authFixture({onProvider:async({url,user})=>{if(url.pathname.endsWith('/user')){started();await gate;return Response.json(user);}}});
  const make=()=>createHostedAuth({...f,store:f.store()}),session=await make().verifyCode('reader@example.com','123456');
  const pending=make().userFor(session.token);await ready;await make().logout(session.token);release();assert.equal(await pending,null);
});
test('HTTP logout revokes the local session when the identity provider is unavailable',async()=>{
  const f=authFixture({onProvider:({url})=>url.pathname.endsWith('/user')?Response.json({error_code:'unexpected_failure'},{status:503}):undefined}),auth=createHostedAuth({...f,store:f.store()});
  const session=await auth.verifyCode('reader@example.com','123456');
  const portal=await createPortal({dataDir:'hosted-fixture',publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:auth,catalogDir:null});
  const headers={},req={method:'POST',headers:{host:'reader.example.com',origin:f.env.READER_PUBLIC_ORIGIN,'content-type':'application/json',cookie:'marginalia_session='+session.token},body:{},socket:{remoteAddress:'127.0.0.1'}};
  let status;await portal.handle({req,res:{setHeader:(key,value)=>{headers[key]=value;}},url:new URL('/api/auth/logout',f.env.READER_PUBLIC_ORIGIN),send:code=>{status=code;}});
  assert.equal(status,200);assert.match(headers['Set-Cookie'],/Max-Age=0/);assert.equal([...f.rows.values()].find(x=>x.value.user)?.value.revoked,true);
});
test('a delayed refresh claim acknowledgement never dispatches a replaced or expired lease',async()=>{
  let now=100000,release,started,held=false;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const f=authFixture(),store=f.store(),delayed={...store,async mutate(...args){const result=await store.mutate(...args);if(result?.kind==='claimed'&&!held){held=true;started();await gate;}return result;}};
  const first=createHostedAuth({...f,store:delayed,clock:()=>now}),second=createHostedAuth({...f,store:f.store(),clock:()=>now}),session=await first.verifyCode('reader@example.com','123456');now+=3600000;
  const pending=first.userFor(session.token);await ready;now=[...f.rows.values()].find(x=>x.value.refreshLease).value.refreshLease.expiresAt+1;assert.equal((await second.userFor(session.token)).id,'user-a');release();
  assert.equal((await pending)?.id,'user-a');assert.equal(f.calls.filter(x=>x.url.searchParams.get('grant_type')==='refresh_token').length,1);
});
test('a bounded delayed refresh-result write remains covered by its lease',async()=>{
  let now=100000,release,started,held=false;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const f=authFixture({onProvider:({url,providerSession})=>url.searchParams.get('grant_type')==='refresh_token'?Response.json({...providerSession(),access_token:'rotated-access',refresh_token:'rotated-refresh'}):undefined});
  const fetcher=async(input,options)=>{if(new URL(input).pathname.endsWith('/reader_document_cas')&&JSON.parse(options.body).document_value.access==='rotated-access'&&!held){held=true;now+=45000;started();await gate;}return f.fetcher(input,options);};
  const make=()=>createHostedAuth({...f,fetcher,store:f.store(),clock:()=>now});
  // Use the actual store's HTTP CAS boundary, with only its acknowledgement delayed.
  const {createHostedStore}=await import('../deploy/hosted-store.mjs');const first=createHostedAuth({...f,store:createHostedStore({env:f.env,fetcher}),clock:()=>now}),session=await first.verifyCode('reader@example.com','123456');now+=3600000;
  const a=first.userFor(session.token);await ready;const b=make().userFor(session.token);await new Promise(resolve=>setTimeout(resolve,20));release();
  assert.equal((await a)?.id,'user-a');assert.equal((await b)?.id,'user-a');assert.equal(f.calls.filter(x=>x.url.searchParams.get('grant_type')==='refresh_token').length,1);
});

// GET-179 auth return: owned safe library view keys survive OAuth success,
// cancel and expiry through one bounded codec; unknown keys are never approved.
const callbackLocation=async(portal,flowToken,query)=>{
  const headers={};
  await portal.handle({req:{method:'GET',headers:{host:'reader.example.com',cookie:'marginalia_auth_flow='+flowToken},socket:{remoteAddress:'127.0.0.1'}},res:{setHeader:(key,value)=>{headers[key]=value;},end(){}},url:new URL('/api/auth/callback'+query,'https://reader.example.com'),send:()=>{}});
  return headers.Location;
};
test('auth return keeps owned library view and overlay keys and drops unknown parameters',async()=>{
  const {safeAuthReturn}=await import('../server/auth-policy.mjs');
  assert.equal(safeAuthReturn('/library?q=alice&topic=fiction&language=zh&other=x'),'/library?q=alice&topic=fiction&language=zh');
  assert.equal(safeAuthReturn('/library?settings=data&upload=1&trash=1'),'/library?settings=data');
  assert.equal(safeAuthReturn('/library?upload=1&secret=private'),'/library?upload=1');
  assert.equal(safeAuthReturn('/library?scope=weird&status='),'/library');
  assert.equal(safeAuthReturn('/library?filter=1&calendar=1'),'/library?calendar=1');
  for(const bad of ['https://evil.example/library?q=x','//evil.example/library?q=x','/library/../evil'])assert.equal(safeAuthReturn(bad),null);
});
test('OAuth success, cancel and expiry keep the known safe library view without form contents or unknown keys',async()=>{
  let now=100000;const f=authFixture(),auth=createHostedAuth({...f,store:f.store(),clock:()=>now});
  const target='/library?q=alice&topic=fiction&upload=1&secret=x';
  const flow=await auth.beginOAuth('google',target);
  assert.equal((await auth.finishOAuth(flow.transactionToken,'provider-code')).next,'/library?q=alice&topic=fiction&upload=1');
  const portal=await createPortal({dataDir:'hosted-fixture',publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:auth,catalogDir:null});
  const cancelled=await auth.beginOAuth('google',target);
  const cancelledLocation=await callbackLocation(portal,cancelled.transactionToken,'?error=access_denied');
  const cancelledNext=new URL(cancelledLocation).searchParams.get('next');
  assert.equal(cancelledNext,'/library?q=alice&topic=fiction&upload=1');
  assert.ok(!cancelledLocation.includes('secret'));
  const expired=await auth.beginOAuth('google',target);now+=600001;
  const expiredLocation=await callbackLocation(portal,expired.transactionToken,'');
  assert.equal(new URL(expiredLocation).searchParams.get('auth_error'),'expired');
  assert.equal(new URL(expiredLocation).searchParams.get('next'),'/library?q=alice&topic=fiction&upload=1');
});
