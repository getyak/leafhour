import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createEmailAuth} from '../server/email-auth.mjs';
import {createPortal} from '../server/portal.mjs';
import {authFixture} from './auth-fixture.mjs';

const day=86400000,start=Date.UTC(2026,10,5);
function fixture(options={}){
  let now=start;
  const f=authFixture(options),auth=createHostedAuth({...f,store:f.store(),clock:()=>now});
  return {...f,auth,at:days=>{now=start+days*day;},row:()=>[...f.rows.values()].find(x=>x.value.user)?.value};
}

for(const [client,window] of [['web',30],['ios',90]])test(`${client} stays signed in through use and expires at its exact idle deadline`,async()=>{
  const f=fixture(),session=await f.auth.signInPassword('reader@example.com','fixture-password',{client});
  f.at(window-1);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  const renewed=await f.auth.touchSession(session.token,{client,expectedOwner:'user-a'});
  assert.equal(renewed.user.id,'user-a');
  f.at(window*2-1-1/day);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  f.at(window*2-1);assert.equal(await f.auth.userFor(session.token),null);
});

test('ordinary identity checks and provider refresh never count as foreground activity',async()=>{
  const f=fixture(),session=await f.auth.signInPassword('reader@example.com','fixture-password');
  f.at(20);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  f.at(29);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  f.at(30);assert.equal(await f.auth.userFor(session.token),null);
});

test('Web OAuth sessions follow the same thirty idle days as email login',async()=>{
  const f=fixture(),flow=await f.auth.beginOAuth('google'),session=await f.auth.finishOAuth(flow.transactionToken,'fixture-code');
  f.at(29);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  f.at(30);assert.equal(await f.auth.userFor(session.token),null);
});

test('valid legacy sessions upgrade, but expired or revoked credentials cannot return',async()=>{
  const f=fixture(),session=await f.auth.signInPassword('reader@example.com','fixture-password');
  const row=f.row();delete row.client;delete row.sessionPolicy;row.expiresAt=start+7*day;
  f.at(6);assert.equal((await f.auth.touchSession(session.token,{client:'ios',expectedOwner:'user-a'})).user.id,'user-a');
  f.at(95);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  await f.auth.logout(session.token);assert.equal(await f.auth.touchSession(session.token,{client:'ios',expectedOwner:'user-a'}),null);
  const second=await f.auth.signInPassword('reader@example.com','fixture-password');
  f.at(126);assert.equal(await f.auth.touchSession(second.token,{client:'ios',expectedOwner:'user-a'}),null);
});

test('a different owner cannot extend the deadline and an iOS session is not downgraded',async()=>{
  const f=fixture(),session=await f.auth.signInPassword('reader@example.com','fixture-password',{client:'ios'});
  f.at(89);await assert.rejects(f.auth.touchSession(session.token,{client:'ios',expectedOwner:'other-user'}),e=>e.status===409);
  await f.auth.touchSession(session.token,{client:'web',expectedOwner:'user-a'});
  f.at(178);assert.equal((await f.auth.userFor(session.token))?.id,'user-a');
  f.at(179);assert.equal(await f.auth.userFor(session.token),null);
});

test('logout wins when foreground renewal is waiting for provider identity',async()=>{
  let hold=false,release,started;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});
  const f=fixture({onProvider:async({url,user})=>{if(hold&&url.pathname.endsWith('/user')){started();await gate;return Response.json(user);}}});
  const session=await f.auth.signInPassword('reader@example.com','fixture-password');hold=true;
  const pending=f.auth.touchSession(session.token,{client:'web',expectedOwner:'user-a'});await ready;
  await f.auth.logout(session.token);release();assert.equal(await pending,null);assert.equal(await f.auth.userFor(session.token),null);
});

test('local email sessions renew explicitly and expire after the selected idle window',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-idle-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=start,code;const auth=await createEmailAuth({dataDir:dir,clock:()=>now,sendCode:async(_email,value)=>{code=value;}});
  await auth.requestCode('reader@example.com');const session=await auth.verifyCode('reader@example.com',code,'login',{client:'ios'});
  now=start+89*day;assert.ok(await auth.userFor(session.token));
  await auth.touchSession(session.token,{client:'ios',expectedOwner:session.user.id});
  now=start+178*day;assert.ok(await auth.userFor(session.token));
  now=start+179*day;assert.equal(await auth.userFor(session.token),null);
});

test('HTTP credentials use long physical retention and activity changes only the server idle deadline',async()=>{
  const f=fixture(),portal=await createPortal({dataDir:'hosted-fixture',publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:f.auth,catalogDir:null});
  async function call(route,{body,token,owner='user-a',origin=f.env.READER_PUBLIC_ORIGIN}={}){
    const headers={};let status,value;
    const req={method:body?'POST':'GET',headers:{host:'reader.example.com',origin,'content-type':'application/json',...(token?{cookie:'marginalia_session='+token}:{}),'x-reader-owner':owner},body,socket:{remoteAddress:'127.0.0.1'}};
    try{await portal.handle({req,res:{setHeader:(k,v)=>{headers[k]=v;}},url:new URL(route,f.env.READER_PUBLIC_ORIGIN),send:(s,v)=>{status=s;value=v;}});}catch(e){status=e.status;}
    return {status,value,headers};
  }
  for(const [client,seconds] of [['web',2592000],['ios',7776000]]){
    f.at(0);const login=await call('/api/auth/password',{body:{email:'reader@example.com',password:'fixture-password',client}});
    assert.equal(login.status,200);assert.match(login.headers['Set-Cookie'],/Max-Age=31536000(?:;|$)/);
    const token=login.headers['Set-Cookie'].split(';')[0].split('=')[1];
    f.at(2);const checked=await call('/api/auth/session',{token});assert.equal(checked.headers['Set-Cookie'],undefined);
    const renewed=await call('/api/auth/session/activity',{token,body:{client}});assert.equal(renewed.status,200);assert.equal(renewed.value.user.id,'user-a');
    assert.equal(renewed.value.maxAge,seconds);assert.equal(renewed.headers['Set-Cookie'],undefined);
    assert.equal((await call('/api/auth/session/activity',{token,owner:'other-user',body:{client}})).status,409);
    assert.equal((await call('/api/auth/session/activity',{token,origin:'https://other.example',body:{client}})).status,403);
    assert.equal((await call('/api/auth/session/activity',{token,origin:null,body:{client}})).status,403);
    assert.equal((await call('/api/auth/session/activity',{token,owner:null,body:{client}})).status,409);
    assert.equal((await call('/api/auth/session/activity',{token,body:{client:'unknown'}})).status,400);
  }
});

for(const logoutFirst of [false,true])test(`a late HTTP activity receipt cannot replace a newer login (logout=${logoutFirst})`,async t=>{
  const f=fixture(),portal=await createPortal({dataDir:'hosted-fixture',publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:f.auth,catalogDir:null});
  let release,started;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{const write=()=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};if(req.url==='/api/auth/session/activity'){started();gate.then(write);}else write();};
    try{await portal.handle({req,res,url:new URL(req.url,f.env.READER_PUBLIC_ORIGIN),send});}catch(e){send(e.status||500,{error:e.message});}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release();server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body,cookie)=>fetch(base+route,{method:'POST',headers:{Origin:f.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json','X-Reader-Owner':'user-a',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  const login=async()=>{const response=await post('/api/auth/password',{email:'reader@example.com',password:'fixture-password'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  const old=await login(),pending=post('/api/auth/session/activity',{client:'web'},old);await ready;
  if(logoutFirst)assert.equal((await post('/api/auth/logout',{},old)).status,200);
  let current=await login();assert.notEqual(current,old);
  release();const late=await pending;assert.equal(late.status,200);
  // A browser applies Set-Cookie before JavaScript can reject a stale receipt.
  const lateCookie=late.headers.get('set-cookie');if(lateCookie)current=lateCookie.split(';')[0];
  assert.equal(lateCookie,null);
  assert.notEqual(current,old);
  const restored=await fetch(base+'/api/auth/session',{headers:{Cookie:current}});assert.equal((await restored.json()).user?.id,'user-a');
});
