import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createPortal} from '../server/portal.mjs';
import {authFixture} from './auth-fixture.mjs';
import * as policy from '../server/auth-policy.mjs';

test('auth return paths preserve reading anchors but reject external and ambiguous URLs',()=>{
  assert.equal(typeof policy.safeAuthReturn,'function');
  for(const value of ['https://evil.example','//evil.example','/\\evil.example','/api/library','/library/../evil'])assert.equal(policy.safeAuthReturn(value),null);
  assert.equal(policy.safeAuthReturn('/library?upload=1&secret=private'),'/library?upload=1');
  assert.equal(policy.safeAuthReturn('/read?book=alice&passage=p1&note=comment'),'/read?book=alice&passage=p1&note=comment');
});
test('OAuth exchanges one browser-bound code with its original server-side verifier',async()=>{
  const f=authFixture(),auth=createHostedAuth({...f,store:f.store()});assert.equal(typeof auth.beginOAuth,'function');
  const flow=await auth.beginOAuth('google','/read?book=alice&passage=p1'),url=new URL(flow.authorizeUrl);
  assert.equal(url.origin,'https://auth.example.com');assert.equal(url.pathname,'/auth/v1/authorize');assert.equal(url.searchParams.get('provider'),'google');
  assert.equal(url.searchParams.get('redirect_to'),'https://reader.example.com/api/auth/callback');assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  const result=await auth.finishOAuth(flow.transactionToken,'provider-code');assert.equal(result.user.id,'user-a');assert.equal(result.next,'/read?book=alice&passage=p1');
  const call=f.calls.find(x=>x.url.searchParams.get('grant_type')==='pkce');assert.equal(call.body.auth_code,'provider-code');
  assert.equal(createHash('sha256').update(call.body.code_verifier).digest('base64url'),url.searchParams.get('code_challenge'));
  assert.ok(!JSON.stringify(result).includes('access-fixture'));assert.ok(!JSON.stringify(result).includes(call.body.code_verifier));
  await assert.rejects(auth.finishOAuth(flow.transactionToken,'provider-code'),e=>e.status===400);
});
test('unknown or disabled providers and unsafe return targets do not allocate a login transaction',async()=>{
  const f=authFixture(),auth=createHostedAuth({...f,store:f.store()});assert.equal(typeof auth.beginOAuth,'function');
  await assert.rejects(auth.beginOAuth('github','/library'),e=>e.status===400);
  await assert.rejects(auth.beginOAuth('apple','/library'),e=>e.status===503);
  await assert.rejects(auth.beginOAuth('google','//evil.example'),e=>e.status===400);
  assert.equal([...f.rows.keys()].filter(x=>x.startsWith('auth/oauth/')).length,0);
});
test('cancelled, missing and expired browser transactions cannot create a session',async()=>{
  let now=100000;const f=authFixture(),auth=createHostedAuth({...f,store:f.store(),clock:()=>now});assert.equal(typeof auth.beginOAuth,'function');
  await assert.rejects(auth.finishOAuth(null,'code'),e=>e.status===400);
  const cancelled=await auth.beginOAuth('google','/library');await auth.cancelOAuth(cancelled.transactionToken);await assert.rejects(auth.finishOAuth(cancelled.transactionToken,'code'),e=>e.status===400);
  const expired=await auth.beginOAuth('google','/library');now+=600001;await assert.rejects(auth.finishOAuth(expired.transactionToken,'code'),e=>e.status===400);
  assert.equal(f.calls.filter(x=>x.url.searchParams.get('grant_type')==='pkce').length,0);
});
test('Apple relay identities keep their verified provider ID instead of joining another mailbox',async()=>{
  const f=authFixture({onProvider:({url,providerSession})=>url.pathname.endsWith('/settings')?Response.json({external:{email:true,google:true,apple:true}}):url.searchParams.get('grant_type')==='pkce'?Response.json({...providerSession(),user:{id:'apple-relay-owner',email:'relay@privaterelay.appleid.com',app_metadata:{provider:'apple'}}}):undefined});
  const auth=createHostedAuth({...f,store:f.store()});assert.equal(typeof auth.beginOAuth,'function');const flow=await auth.beginOAuth('apple','/library'),result=await auth.finishOAuth(flow.transactionToken,'apple-code');
  assert.deepEqual(result.user,{id:'apple-relay-owner',email:'relay@privaterelay.appleid.com',kind:'apple'});
});
async function portalServer(t){
  const f=authFixture(),auth=createHostedAuth({...f,store:f.store()}),portal=await createPortal({dataDir:'hosted-fixture',publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:auth,catalogDir:null});
  const server=createServer(async(req,res)=>{
    const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    try{if(!await portal.handle({req,res,url:new URL(req.url,f.env.READER_PUBLIC_ORIGIN),send}))send(404,{});}catch(error){send(error.status||500,{error:error.message});}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return {base:'http://127.0.0.1:'+server.address().port,f};
}
test('HTTP OAuth callback creates a private session cookie and uses the fixed public origin',async t=>{
  const {base,f}=await portalServer(t),start=await fetch(base+'/api/auth/oauth',{method:'POST',headers:{Origin:f.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({provider:'google',next:'/library?upload=1'})});
  assert.equal(start.status,200);const cookies=start.headers.get('set-cookie');assert.match(cookies,/HttpOnly/);assert.match(cookies,/SameSite=Lax/);assert.match(cookies,/Secure/);assert.equal((await start.json()).url.startsWith('https://auth.example.com/auth/v1/authorize?'),true);
  const callback=await fetch(base+'/api/auth/callback?code=provider-code',{headers:{Cookie:cookies.split(';')[0],'X-Forwarded-Host':'evil.example'},redirect:'manual'});
  assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'https://reader.example.com/library?upload=1');assert.match(callback.headers.get('set-cookie'),/marginalia_session=.*HttpOnly/);
  const replay=await fetch(base+'/api/auth/callback?code=provider-code',{headers:{Cookie:cookies.split(';')[0]},redirect:'manual'});assert.equal(replay.status,303);assert.match(replay.headers.get('location'),/^https:\/\/reader\.example\.com\/library\?login=1&auth_error=/);
});
test('a missing browser cookie and cancelled authorization return to a retryable login screen',async t=>{
  const {base}=await portalServer(t);
  for(const query of ['code=provider-code','error=access_denied&error_description=PRIVATE_DETAIL']){
    const r=await fetch(base+'/api/auth/callback?'+query,{redirect:'manual'});assert.equal(r.status,303);assert.match(r.headers.get('location'),/^https:\/\/reader\.example\.com\/library\?login=1&auth_error=/);assert.ok(!r.headers.get('location').includes('PRIVATE_DETAIL'));
  }
});
test('OAuth cancellation and expired callbacks retain the original safe reading or upload intent',async t=>{
  const {base,f}=await portalServer(t);
  for(const next of ['/read?book=alice&passage=p1&note=comment','/library?upload=1'])for(const expired of [false,true]){
    const start=await fetch(base+'/api/auth/oauth',{method:'POST',headers:{Origin:f.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({provider:'google',next})});
    const cookie=start.headers.get('set-cookie').split(';')[0];
    if(expired)for(const [key,row] of f.rows)if(key.startsWith('auth/oauth/'))row.value.expiresAt=Date.now()-1;
    const response=await fetch(base+'/api/auth/callback?'+(expired?'code=late':'error=access_denied'),{headers:{Cookie:cookie},redirect:'manual'}),destination=new URL(response.headers.get('location'));
    assert.equal(destination.searchParams.get('auth_error'),expired?'expired':'cancelled');assert.equal(destination.searchParams.get('login'),'1');
    if(next.startsWith('/read'))assert.equal(destination.searchParams.get('next'),next);else assert.equal(destination.searchParams.get('upload'),'1');
  }
});
