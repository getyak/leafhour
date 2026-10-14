import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {authFixture} from './auth-fixture.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createPortal} from '../server/portal.mjs';
import {createAuthFlow,createAuthRequestGuard} from '../app/auth-flow.mjs';

test('an old HTTP Set-Cookie must settle before another account can start verification',async t=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const account=email=>({id:email.split('@')[0],email,app_metadata:{provider:'email'}});
  const f=authFixture({onProvider:async({url,body,options})=>{
    if(url.pathname.endsWith('/verify')){if(body.email==='one@example.com'){started();await gate;}return Response.json({user:account(body.email),access_token:body.email,refresh_token:'refresh-'+body.email,expires_in:3600});}
    if(url.pathname.endsWith('/user'))return Response.json(account(options.headers.Authorization.slice('Bearer '.length)));
  }}),auth=createHostedAuth({...f,store:f.store()}),portal=await createPortal({dataDir:'race-fixture',allowLocal:false,dataStore:f.store(),authService:auth,catalogDir:null});
  const server=createServer(async(req,res)=>{const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};try{await portal.handle({req,res,url:new URL(req.url,'http://'+req.headers.host),send});}catch(error){send(error.status||500,{error:error.message});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port,requestGuard=createAuthRequestGuard();let cookie='';
  const post=async(email)=>{const response=await fetch(base+'/api/auth/verify',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({email,code:'123456'})});cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,200);return response.json();};
  const prepare=flow=>{const ticket=flow.begin('send');flow.sent(ticket,{retryAfter:60,expiresIn:600});flow.setCode('123456');};
  const one=createAuthFlow({requestGuard});one.setEmail('one@example.com');prepare(one);const ticketA=one.begin('verify'),pendingA=post(ticketA.email);await ready;one.close();
  const two=createAuthFlow({requestGuard});two.setEmail('two@example.com');assert.equal(two.begin('verify'),null);assert.equal(two.begin('local'),null);
  release();await pendingA;assert.equal(one.verified(ticketA),false);one.settled(ticketA);
  two.setEmail('two@example.com');prepare(two);const ticketB=two.begin('verify');await post(ticketB.email);assert.equal(two.verified(ticketB),true);two.settled(ticketB);
  const session=await fetch(base+'/api/auth/session',{headers:{Cookie:cookie}});assert.equal((await session.json()).user.id,'two');
  assert.deepEqual(f.calls.filter(x=>x.url.pathname.endsWith('/verify')).map(x=>x.body.email),['one@example.com','two@example.com']);
});
