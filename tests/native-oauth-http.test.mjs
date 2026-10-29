import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createPortal} from '../server/portal.mjs';
import {authFixture} from './auth-fixture.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const state=Buffer.alloc(32,7).toString('base64url'),codeVerifier=Buffer.alloc(32,9).toString('base64url');
const codeChallenge=createHash('sha256').update(codeVerifier).digest('base64url');
async function setup(t){
  let linked=false;
  const user=()=>({id:owner,email:'reader@example.com',email_confirmed_at:'2026-10-14T00:00:00Z',app_metadata:{provider:'email',providers:linked?['email','google']:['email']},identities:[{provider:'email',identity_data:{email:'reader@example.com',email_verified:true}},...(linked?[{provider:'google',identity_data:{email:'reader@example.com',email_verified:true}}]:[])]});
  const f=authFixture({onProvider:({url,providerSession})=>{
    if(url.pathname.endsWith('/settings'))return Response.json({external:{email:true,google:true,apple:true}});
    if(url.pathname.endsWith('/user/identities/authorize'))return Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=provider-fixture'});
    if(url.pathname.endsWith('/token')){if(url.searchParams.get('grant_type')==='pkce')linked=true;return Response.json({...providerSession(),user:user()});}
    if(url.pathname.endsWith('/user'))return Response.json(user());
  }});
  const auth=createHostedAuth({...f,store:f.store()});
  const portal=await createPortal({dataDir:'native-auth-http-fixture',publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:auth,catalogDir:null});
  const server=createServer(async(req,res)=>{
    const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    try{if(!await portal.handle({req,res,url:new URL(req.url,f.env.READER_PUBLIC_ORIGIN),send}))send(404,{});}catch(error){send(error.status||500,{error:error.message});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body={},headers={})=>fetch(base+path,{method:'POST',headers:{Origin:f.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json',...headers},body:JSON.stringify(body),redirect:'manual'});
  const start=(mode='sign-in',headers={})=>post('/api/auth/native/start',{provider:'google',mode,state,codeChallenge},headers);
  const launch=async result=>{const target=new URL(result.url);assert.equal(target.origin,f.env.READER_PUBLIC_ORIGIN);assert.equal(target.pathname,'/api/auth/native/authorize');return fetch(base+target.pathname+target.search,{redirect:'manual'});};
  return {f,base,post,start,launch};
}

test('native sign-in launches an isolated browser transaction and exchanges only a proof-bound one-time code',async t=>{
  const f=await setup(t),start=await f.start();assert.equal(start.status,200);
  const flow=await start.json();assert.match(flow.transactionId,/^[A-Za-z0-9_-]{43}$/);assert.equal(flow.expiresIn,600);
  const launch=await f.launch(flow);assert.equal(launch.status,303);assert.match(launch.headers.get('cache-control'),/no-store/);assert.equal(launch.headers.get('referrer-policy'),'no-referrer');
  const cookie=launch.headers.get('set-cookie');assert.match(cookie,/marginalia_auth_flow=native\./);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
  assert.match(launch.headers.get('location'),/^https:\/\/auth\.example\.com\/auth\/v1\/authorize\?/);
  const callback=await fetch(f.base+'/api/auth/callback?code=provider-fixture',{headers:{Cookie:cookie.split(';')[0]},redirect:'manual'});assert.equal(callback.status,303);
  assert.doesNotMatch(callback.headers.get('set-cookie')||'',/marginalia_session=/);
  const result=new URL(callback.headers.get('location'));assert.equal(result.protocol,'com.cubxxw.reader:');assert.equal(result.host,'auth');assert.equal(result.pathname,'/callback');assert.equal(result.searchParams.get('state'),state);
  assert.match(result.searchParams.get('code'),/^[A-Za-z0-9_-]{43}$/);assert.doesNotMatch(result.href,/access-fixture|refresh-fixture|marginalia_session|code_verifier/);
  const body={code:result.searchParams.get('code'),state,codeVerifier};
  const exchange=await f.post('/api/auth/native/exchange',body);assert.equal(exchange.status,200);assert.equal((await exchange.json()).user.id,owner);assert.match(exchange.headers.get('set-cookie'),/marginalia_session=.*HttpOnly/);
  const replay=await f.post('/api/auth/native/exchange',body);assert.ok([400,409].includes(replay.status));
});

test('linking requires the captured native owner and keeps the same first-party account session',async t=>{
  const f=await setup(t),login=await f.post('/api/auth/password',{email:'reader@example.com',password:'synthetic-password'}),nativeCookie=login.headers.get('set-cookie').split(';')[0];
  const wrong=await f.start('link',{Cookie:nativeCookie,'X-Reader-Owner':'other-owner'});assert.equal(wrong.status,409);
  const absent=await f.start('link');assert.equal(absent.status,401);
  const start=await f.start('link',{Cookie:nativeCookie,'X-Reader-Owner':owner});assert.equal(start.status,200);
  const launch=await f.launch(await start.json());assert.match(launch.headers.get('location'),/^https:\/\/accounts\.google\.com\//);
  const callback=await fetch(f.base+'/api/auth/callback?code=provider-link',{headers:{Cookie:launch.headers.get('set-cookie').split(';')[0]},redirect:'manual'}),result=new URL(callback.headers.get('location'));
  const exchange=await f.post('/api/auth/native/exchange',{code:result.searchParams.get('code'),state,codeVerifier},{Cookie:nativeCookie,'X-Reader-Owner':owner});assert.equal(exchange.status,200);assert.equal((await exchange.json()).user.id,owner);assert.equal(exchange.headers.get('set-cookie').split(';')[0],nativeCookie);
  const identities=await fetch(f.base+'/api/auth/identities',{headers:{Cookie:nativeCookie,'X-Reader-Owner':owner}});assert.equal(identities.status,200);assert.equal((await identities.json()).identities.some(x=>x.provider==='google'),true);assert.match(identities.headers.get('cache-control'),/no-store/);
  const missingOwner=await fetch(f.base+'/api/auth/identities',{headers:{Cookie:nativeCookie}});assert.equal(missingOwner.status,409);
});

test('native start rejects a foreign Origin and callback cancellation returns only a fixed public category',async t=>{
  const f=await setup(t),foreign=await f.start('sign-in',{Origin:'https://evil.example'});assert.equal(foreign.status,403);
  const start=await f.start();assert.equal(start.status,200);const flow=await start.json(),launch=await f.launch(flow);
  const cancelled=await fetch(f.base+'/api/auth/callback?error=access_denied&error_description=PRIVATE_PROVIDER_DETAIL',{headers:{Cookie:launch.headers.get('set-cookie').split(';')[0]},redirect:'manual'});assert.equal(cancelled.status,303);
  const target=new URL(cancelled.headers.get('location'));assert.equal(target.searchParams.get('state'),state);assert.equal(target.searchParams.get('error'),'cancelled');assert.doesNotMatch(target.href,/PRIVATE_PROVIDER_DETAIL|access_denied|token/);
  assert.equal(cancelled.headers.get('referrer-policy'),'no-referrer');assert.doesNotMatch(cancelled.headers.get('set-cookie')||'',/marginalia_session=/);
});

test('native capabilities are advertised only when the hosted adapter actually exists',async t=>{
  const f=await setup(t),response=await fetch(f.base+'/api/auth/session');assert.equal(response.status,200);assert.equal((await response.json()).nativeOAuth.version,1);
});
