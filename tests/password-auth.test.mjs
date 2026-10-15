import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {createPortal} from '../server/portal.mjs';

const make=f=>createHostedAuth({...f,store:f.store()});
const sessionRows=f=>[...f.rows.values()].filter(r=>r.value.user);

test('password login preserves the existing identity and stores only provider credentials',async()=>{
  const f=authFixture({onProvider:({url,body,providerSession})=>{
    if(url.searchParams.get('grant_type')==='password'){
      assert.deepEqual(body,{email:'reader@example.com',password:' secret '});return Response.json(providerSession());
    }
  }}),auth=make(f);
  const result=await auth.signInPassword(' Reader@Example.com ',' secret ');
  assert.equal(result.user.id,'user-a');assert.equal((await auth.userFor(result.token)).email,'reader@example.com');
  assert.equal(JSON.stringify([...f.rows]).includes(' secret '),false);
  await auth.logout(result.token);assert.equal(await auth.userFor(result.token),null);
});
test('incorrect passwords return a useful generic error without minting a session',async()=>{
  const f=authFixture({onProvider:({url})=>url.searchParams.get('grant_type')==='password'?Response.json({error_code:'invalid_credentials'},{status:400}):undefined});
  await assert.rejects(make(f).signInPassword('reader@example.com','incorrect'),e=>e.status===401&&e.message.includes('邮箱或密码'));
  assert.equal(sessionRows(f).length,0);
});
test('password transport failures remain retryable service errors',async()=>{
  const f=authFixture({onProvider:({url})=>url.searchParams.get('grant_type')==='password'?Promise.reject(Error('offline')):undefined});
  await assert.rejects(make(f).signInPassword('reader@example.com','secret'),e=>e.status===503);
});
test('independent instances share the password attempt ceiling without storing passwords',async()=>{
  let now=100000;const f=authFixture({onProvider:({url})=>url.searchParams.get('grant_type')==='password'?Response.json({error_code:'invalid_credentials'},{status:400}):undefined});
  for(let i=0;i<10;i++)await assert.rejects(createHostedAuth({...f,store:f.store(),clock:()=>now}).signInPassword('reader@example.com','private-password'),e=>e.status===401);
  await assert.rejects(createHostedAuth({...f,store:f.store(),clock:()=>now}).signInPassword('reader@example.com','private-password'),e=>e.status===429&&e.retryAfter===600);
  assert.equal(f.calls.filter(c=>c.url.searchParams.get('grant_type')==='password').length,10);
  assert.equal(JSON.stringify([...f.rows]).includes('private-password'),false);
});
test('password login can be available while delivery is disabled',async()=>{
  const f=authFixture();f.env.READER_EMAIL_ENABLED='false';const auth=make(f);
  assert.equal((await auth.capabilities()).password,true);assert.equal((await auth.capabilities()).email,false);
  assert.equal((await auth.signInPassword('reader@example.com','secret')).user.id,'user-a');
});
test('recovery requests use the non-creating provider endpoint and share mail cooldowns',async()=>{
  const f=authFixture({onProvider:({url,body})=>{
    if(url.pathname.endsWith('/recover')){assert.deepEqual(body,{email:'reader@example.com'});return Response.json({});}
  }}),auth=make(f);
  assert.equal((await auth.requestCode('reader@example.com','recovery')).sent,true);
  assert.equal(f.calls.some(c=>c.url.pathname.endsWith('/otp')),false);
  await assert.rejects(auth.requestCode('reader@example.com','signup'),e=>e.status===429);
});
test('unsupported mail purposes fail before contacting the provider',async()=>{
  const f=authFixture(),auth=make(f);
  await assert.rejects(auth.requestCode('reader@example.com','admin'),e=>e.status===400);
  await assert.rejects(auth.verifyCode('reader@example.com','123456','admin'),e=>e.status===400);
  assert.equal(f.calls.length,0);
});
test('recovery proof grants a short password setup window and uses recovery verification',async()=>{
  const f=authFixture({onProvider:({url,body,providerSession})=>{
    if(url.pathname.endsWith('/verify')){assert.equal(body.type,'recovery');return Response.json(providerSession());}
  }}),auth=make(f),session=await auth.verifyCode('reader@example.com','123456','recovery');
  assert.equal(session.passwordSetup,true);
  assert.ok(sessionRows(f)[0].value.passwordSetupUntil>Date.now());
});
test('a normal login session cannot change the account password',async()=>{
  const f=authFixture(),auth=make(f),session=await auth.verifyCode('reader@example.com','123456');
  await assert.rejects(auth.setPassword(session.token,'new-password-123',session.passwordSetupToken),e=>e.status===403);
  assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
});
test('a password form from an earlier verification cannot act on a replaced session cookie',async()=>{
  const f=authFixture(),auth=make(f),first=await auth.verifyCode('reader@example.com','123456','signup'),other=await auth.verifyCode('reader@example.com','123456','recovery');
  await assert.rejects(auth.setPassword(other.token,'new-password-123',first.passwordSetupToken),e=>e.status===403);
  assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
});
test('verified signup sets a password once and never persists the password',async()=>{
  const f=authFixture({onProvider:({url,body,options,user})=>{
    if(options.method==='PUT'&&url.pathname.endsWith('/user')){assert.deepEqual(body,{password:'new-password-123'});return Response.json(user);}
  }}),auth=make(f),session=await auth.verifyCode('reader@example.com','123456','signup');
  assert.equal(session.passwordSetup,true);assert.equal((await auth.setPassword(session.token,'new-password-123',session.passwordSetupToken)).passwordUpdated,true);
  await assert.rejects(auth.setPassword(session.token,'another-password',session.passwordSetupToken),e=>e.status===403);
  assert.equal(JSON.stringify([...f.rows]).includes('new-password-123'),false);
});
test('expired or revoked email proof cannot change a password',async()=>{
  let now=100000;const f=authFixture(),auth=createHostedAuth({...f,store:f.store(),clock:()=>now});
  const session=await auth.verifyCode('reader@example.com','123456','recovery');now+=600001;
  await assert.rejects(auth.setPassword(session.token,'new-password-123',session.passwordSetupToken),e=>e.status===403);
  const next=await auth.verifyCode('reader@example.com','123456','signup');await auth.logout(next.token);
  await assert.rejects(auth.setPassword(next.token,'new-password-123',next.passwordSetupToken),e=>e.status===401);
  assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
});
test('a failed password update keeps verified proof available for a corrected retry',async()=>{
  let failed=false;const f=authFixture({onProvider:({url,options,user})=>{
    if(options.method==='PUT'&&url.pathname.endsWith('/user')){if(!failed){failed=true;return Response.json({error_code:'same_password'},{status:422});}return Response.json(user);}
  }}),auth=make(f),session=await auth.verifyCode('reader@example.com','123456','recovery');
  await assert.rejects(auth.setPassword(session.token,'new-password-123',session.passwordSetupToken),e=>e.status===400&&e.message.includes('相同'));
  assert.equal((await auth.setPassword(session.token,'different-password',session.passwordSetupToken)).passwordUpdated,true);
});
test('simultaneous password updates consume one email proof only once',async()=>{
  let start,release;const ready=new Promise(r=>{start=r;}),gate=new Promise(r=>{release=r;});
  const f=authFixture({onProvider:async({url,options,user})=>{if(options.method==='PUT'&&url.pathname.endsWith('/user')){start();await gate;return Response.json(user);}}});
  const first=make(f),second=make(f),session=await first.verifyCode('reader@example.com','123456','recovery');
  const pending=first.setPassword(session.token,'new-password-123',session.passwordSetupToken);await ready;
  await assert.rejects(second.setPassword(session.token,'other-password-123',session.passwordSetupToken),e=>e.status===409);release();
  assert.equal((await pending).passwordUpdated,true);assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,1);
});
test('a delayed password response cannot reopen an already dispatched proof after the lease duration',async()=>{
  let now=100000,start,release,updates=0;const ready=new Promise(r=>{start=r;}),gate=new Promise(r=>{release=r;});
  const f=authFixture({onProvider:async({url,options,user})=>{if(options.method==='PUT'&&url.pathname.endsWith('/user')){updates++;if(updates===1){start();await gate;}return Response.json(user);}}});
  const make=()=>createHostedAuth({...f,store:f.store(),clock:()=>now}),first=make(),session=await first.verifyCode('reader@example.com','123456','recovery');
  const pending=first.setPassword(session.token,'new-password-123',session.passwordSetupToken);await ready;now+=180001;
  try{await assert.rejects(make().setPassword(session.token,'other-password-123',session.passwordSetupToken),e=>e.status===409);}finally{release();await pending;}
  assert.equal(updates,1);
});
test('an ambiguous password timeout consumes its proof instead of dispatching a second change',async()=>{
  const f=authFixture({onProvider:({url,options})=>{if(options.method==='PUT'&&url.pathname.endsWith('/user'))throw Error('response lost');}}),auth=make(f),session=await auth.verifyCode('reader@example.com','123456','recovery');
  await assert.rejects(auth.setPassword(session.token,'new-password-123',session.passwordSetupToken),e=>e.status===503);
  await assert.rejects(auth.setPassword(session.token,'other-password-123',session.passwordSetupToken),e=>[403,409].includes(e.status));
  assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,1);
});
test('password HTTP login returns a private cookie and exposes no provider credentials',async()=>{
  const f=authFixture(),auth=make(f),portal=await createPortal({dataDir:'password-http',dataStore:f.store(),authService:auth,catalogDir:null,allowLocal:false,publicOrigin:f.env.READER_PUBLIC_ORIGIN});
  const headers={};let status,body;
  const req={method:'POST',headers:{host:'reader.example.com',origin:f.env.READER_PUBLIC_ORIGIN,'content-type':'application/json'},body:{email:'reader@example.com',password:'secret'},socket:{remoteAddress:'127.0.0.1'}};
  await portal.handle({req,res:{setHeader:(k,v)=>{headers[k]=v;}},url:new URL('/api/auth/password',f.env.READER_PUBLIC_ORIGIN),send:(s,b)=>{status=s;body=b;}});
  assert.equal(status,200);assert.deepEqual(body,{user:{id:'user-a',email:'reader@example.com',kind:'email',displayName:'',avatarUrl:null}});
  assert.match(headers['Set-Cookie'],/HttpOnly/);assert.match(headers['Set-Cookie'],/Secure/);
  req.headers.origin='https://unrelated.example';await assert.rejects(portal.handle({req,res:{setHeader(){}},url:new URL('/api/auth/password',f.env.READER_PUBLIC_ORIGIN),send(){}}),e=>e.status===403);
});
