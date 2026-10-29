import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {digest} from '../server/document-import.mjs';

const random=()=>randomBytes(32).toString('base64url');
const challenge=verifier=>createHash('sha256').update(verifier).digest('base64url');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
 const state={provider:'google',linked:false,verified:true,pkceUserID:'user-a',primaryEmail:'reader@example.com',identityEmail:'reader@example.com',...options};
 const f=authFixture({onProvider:async({url,options,user,providerSession})=>{
  const raw=()=>({...user,email:state.primaryEmail,email_confirmed_at:state.verified?'2026-10-14T00:00:00Z':null,identities:[{identity_id:'email-identity-private',provider:'email',identity_data:{email:state.primaryEmail,email_verified:state.verified}},...(state.linked&&!state.noProvider?[{identity_id:'provider-identity-private',provider:state.provider,identity_data:{email:state.identityEmail,email_verified:true,sub:'private-provider-subject'}}]:[])]});
  if(url.pathname.endsWith('/settings'))return Response.json({external:{email:true,google:true,apple:true}});
  if(url.pathname.endsWith('/user/identities/authorize')){
   if(state.linkError)return Response.json({error_code:state.linkError},{status:state.linkError==='manual_linking_disabled'?404:422});
   assert.equal(options.headers.Authorization,'Bearer access-fixture');
   state.linkRequest=url;
   return Response.json({url:state.badURL||'https://'+(state.provider==='apple'?'appleid.apple.com':'accounts.google.com')+(state.provider==='apple'?'/auth/authorize':'/o/oauth2/v2/auth')+'?state=provider-state'});
  }
  if(url.searchParams.get('grant_type')==='pkce'){
   state.callbackStarted?.resolve();if(state.callbackWait)await state.callbackWait.promise;
   state.linked=true;
   return Response.json({...providerSession(),user:{...raw(),id:state.pkceUserID},access_token:'native-provider-access-private',refresh_token:'native-provider-refresh-private'});
  }
  if(url.pathname.endsWith('/user')){state.userReadStarted?.resolve();if(state.userReadWait)await state.userReadWait.promise;return Response.json(raw());}
 }});
 let now=100000;
 const store=f.store(),guarded={...store,mutate:async(path,fallback,operation)=>{if(path.startsWith('auth/sessions/')&&!f.rows.has(path)&&state.sessionWriteWait){state.sessionWriteStarted?.resolve();await state.sessionWriteWait.promise;}return store.mutate(path,fallback,operation);}};
 const auth=createHostedAuth({...f,store:guarded,clock:()=>now});
 return {...f,state,auth,tick:ms=>now+=ms,async start(token=null,mode='sign-in',provider=state.provider){const verifier=random(),stateValue=random(),input={provider,mode,state:stateValue,codeChallenge:challenge(verifier)};const start=await auth.beginNativeOAuth(token,input,mode==='link'?'user-a':undefined);return {start,verifier,state:stateValue,input};},parent:()=>auth.signInPassword('reader@example.com','fixture-password'),parentRow:token=>f.rows.get('auth/sessions/'+digest(token))?.value};
}
async function ready(f,flow){const ticket=new URL(flow.start.url).searchParams.get('ticket');const launch=await f.auth.launchNativeOAuth(ticket);const finished=await f.auth.finishNativeOAuth(launch.transactionId,{code:'provider-auth-code'});const callback=new URL(finished.redirectURL);return {launch,callback,code:callback.searchParams.get('code')};}

test('native sign-in launches a first-party ticket and exchanges one verifier-bound handoff',async()=>{
 const f=fixture();assert.equal(typeof f.auth.beginNativeOAuth,'function');
 const flow=await f.start(),url=new URL(flow.start.url);
 assert.equal(url.origin,'https://reader.example.com');assert.equal(url.pathname,'/api/auth/native/authorize');assert.deepEqual([...url.searchParams.keys()],['ticket']);
 const {launch,callback,code}=await ready(f,flow),authorization=new URL(launch.authorizeUrl);
 assert.equal(authorization.origin,'https://auth.example.com');assert.equal(authorization.pathname,'/auth/v1/authorize');assert.equal(authorization.searchParams.get('redirect_to'),'https://reader.example.com/api/auth/callback');assert.equal(authorization.searchParams.get('code_challenge_method'),'s256');
 assert.equal(callback.origin,'null');assert.equal(callback.protocol,'com.cubxxw.reader:');assert.equal(callback.hostname,'auth');assert.equal(callback.pathname,'/callback');assert.equal(callback.searchParams.get('state'),flow.state);assert.match(code,/^[A-Za-z0-9_-]{43}$/);
 const result=await f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:flow.verifier});assert.equal(result.user.id,'user-a');assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);
 assert.ok(!JSON.stringify({start:flow.start,launch,callback:callback.href,result}).includes('native-provider-'));assert.ok(!callback.href.includes(result.token));
 await assert.rejects(f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:flow.verifier}),e=>e.status===400);
});
test('native launch replay and invalid proof never expose a session or consume the valid handoff',async()=>{
 const f=fixture(),flow=await f.start(),{code}=await ready(f,flow),ticket=new URL(flow.start.url).searchParams.get('ticket');
 await assert.rejects(f.auth.launchNativeOAuth(ticket),e=>e.status===400);
 await assert.rejects(f.auth.exchangeNativeOAuth(null,{code,state:random(),codeVerifier:flow.verifier}),e=>e.status===400);
 await assert.rejects(f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:random()}),e=>e.status===400);
 assert.equal((await f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:flow.verifier})).user.id,'user-a');
});
test('native rejects unsafe shapes and sign-in cannot silently replace a current account',async()=>{
 const f=fixture(),parent=await f.parent(),base={provider:'google',mode:'sign-in',state:random(),codeChallenge:random()};
 for(const patch of [{provider:'github'},{mode:'merge'},{state:'short'},{codeChallenge:'not-a-proof'},{email:'someone@example.com'},{redirectTo:'evil://callback'}])await assert.rejects(f.auth.beginNativeOAuth(null,{...base,...patch}),e=>e.status===400);
 await assert.rejects(f.auth.beginNativeOAuth(parent.token,base),e=>e.status===409);
 await assert.rejects(f.auth.beginNativeOAuth(null,{...base,mode:'link'},'user-a'),e=>[401,409].includes(e.status));
 await assert.rejects(f.auth.beginNativeOAuth(parent.token,{...base,mode:'link'},'different-user'),e=>e.status===409);
});
test('manual linking uses authenticated GET authorize and preserves the original session credentials',async()=>{
 const f=fixture({provider:'apple',identityEmail:'relay@privaterelay.appleid.com'}),parent=await f.parent(),before=structuredClone(f.parentRow(parent.token)),flow=await f.start(parent.token,'link','apple');
 const link=f.state.linkRequest;assert.equal(link.pathname,'/auth/v1/user/identities/authorize');assert.equal(link.searchParams.get('skip_http_redirect'),'true');assert.equal(link.searchParams.get('provider'),'apple');assert.equal(link.searchParams.get('code_challenge_method'),'s256');assert.ok(!link.href.includes('access-fixture'));
 const {code}=await ready(f,flow),result=await f.auth.exchangeNativeOAuth(parent.token,{code,state:flow.state,codeVerifier:flow.verifier},'user-a');
 assert.equal(result.token,parent.token);assert.equal(result.user.id,'user-a');assert.equal(result.user.email,'reader@example.com');
 const after=f.parentRow(parent.token);for(const field of ['access','refresh','accessExpiresAt','expiresAt','refreshLease'])assert.deepEqual(after[field],before[field]);
 const identities=await f.auth.identitiesFor(parent.token,'user-a');assert.equal(identities.identities.find(x=>x.provider==='apple').email,'relay@privaterelay.appleid.com');assert.ok(!JSON.stringify(identities).includes('private-provider-subject'));assert.ok(!JSON.stringify(identities).includes('identity-private'));
});
test('manual linking refuses occupied identities, disabled configuration, and unsafe provider URLs',async()=>{
 for(const [linkError,category]of [['manual_linking_disabled','linking_disabled'],['identity_already_exists','conflict']]){
  const f=fixture({linkError}),parent=await f.parent();await assert.rejects(f.start(parent.token,'link'),e=>e.nativeOAuthError===category);
  assert.equal(f.parentRow(parent.token).revoked,undefined);
 }
 for(const badURL of ['http://accounts.google.com/oauth','https://evil.example/oauth','https://accounts.google.com@evil.example/oauth','https://accounts.google.com/oauth?access_token=private']){
  const f=fixture({badURL}),parent=await f.parent();await assert.rejects(f.start(parent.token,'link'),e=>e.status>=400);
 }
});
test('same raw email cannot override a changed provider UID during linking',async()=>{
 const f=fixture({pkceUserID:'other-owner'}),parent=await f.parent(),flow=await f.start(parent.token,'link'),{callback,code}=await ready(f,flow);
 assert.equal(callback.searchParams.get('error'),'account_changed');assert.equal(code,null);assert.equal(f.parentRow(parent.token).user.id,'user-a');
});
test('unverified provider mailbox cannot create a native session',async()=>{
 const f=fixture({verified:false}),flow=await f.start(),{callback,code}=await ready(f,flow);
 assert.equal(callback.searchParams.get('error'),'unverified_email');assert.equal(code,null);
 assert.equal([...f.rows.keys()].filter(x=>x.startsWith('auth/sessions/')).length,0);
});
test('link handoff needs the exact original native cookie and a still-live parent',async()=>{
 const f=fixture(),parent=await f.parent(),flow=await f.start(parent.token,'link'),{code}=await ready(f,flow),body={code,state:flow.state,codeVerifier:flow.verifier};
 const otherSession=await f.parent();await assert.rejects(f.auth.exchangeNativeOAuth(otherSession.token,body,'user-a'),e=>e.status===409);
 await f.auth.logout(parent.token,{expectedOwner:'user-a'});await assert.rejects(f.auth.exchangeNativeOAuth(parent.token,body,'user-a'),e=>[401,409].includes(e.status));
});
test('cancelled callback and handoff cannot later install a first-party session',async()=>{
 for(const afterCallback of [false,true]){
  const f=fixture(),flow=await f.start();let code;
  if(afterCallback)({code}=await ready(f,flow));else await f.auth.launchNativeOAuth(new URL(flow.start.url).searchParams.get('ticket'));
  await f.auth.cancelNativeOAuth(flow.start.transactionId);
  if(afterCallback)await assert.rejects(f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:flow.verifier}),e=>e.status===400);
  else{const result=await f.auth.finishNativeOAuth(flow.start.transactionId,{code:'late-code'});assert.equal(new URL(result.redirectURL).searchParams.get('error'),'cancelled');}
  assert.equal([...f.rows.keys()].filter(x=>x.startsWith('auth/sessions/')).length,0);
 }
});
test('cancel during provider exchange fences late callback publication',async()=>{
 const callbackStarted=deferred(),callbackWait=deferred(),f=fixture({callbackStarted,callbackWait}),flow=await f.start();await f.auth.launchNativeOAuth(new URL(flow.start.url).searchParams.get('ticket'));
 const callback=f.auth.finishNativeOAuth(flow.start.transactionId,{code:'delayed-code'});await callbackStarted.promise;await f.auth.cancelNativeOAuth(flow.start.transactionId);callbackWait.resolve();
 const result=await callback;assert.equal(new URL(result.redirectURL).searchParams.get('error'),'cancelled');assert.equal(new URL(result.redirectURL).searchParams.get('code'),null);
});
test('expired launch and short handoff expire without accepting an old proof',async()=>{
 const f=fixture(),expired=await f.start();f.tick(600001);await assert.rejects(f.auth.launchNativeOAuth(new URL(expired.start.url).searchParams.get('ticket')),e=>e.status===400);
 const flow=await f.start(),{code}=await ready(f,flow);f.tick(120001);await assert.rejects(f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:flow.verifier}),e=>e.status===400);
});
test('only one concurrent native exchange can adopt the handoff',async()=>{
 const f=fixture(),flow=await f.start(),{code}=await ready(f,flow),body={code,state:flow.state,codeVerifier:flow.verifier};
 const results=await Promise.allSettled([f.auth.exchangeNativeOAuth(null,body),f.auth.exchangeNativeOAuth(null,body)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal([...f.rows.keys()].filter(x=>x.startsWith('auth/sessions/')).length,1);
});

test('link launch refuses a parent revoked after native start',async()=>{
 const f=fixture(),parent=await f.parent(),flow=await f.start(parent.token,'link');await f.auth.logout(parent.token,{expectedOwner:'user-a'});
 await assert.rejects(f.auth.launchNativeOAuth(new URL(flow.start.url).searchParams.get('ticket')),e=>e.status===409);
});
test('cancel while creating a native sign-in session revokes the undisclosed late result',async()=>{
 const f=fixture(),flow=await f.start(),{code}=await ready(f,flow),sessionWriteStarted=deferred(),sessionWriteWait=deferred();Object.assign(f.state,{sessionWriteStarted,sessionWriteWait});
 const exchange=f.auth.exchangeNativeOAuth(null,{code,state:flow.state,codeVerifier:flow.verifier});await sessionWriteStarted.promise;await f.auth.cancelNativeOAuth(flow.start.transactionId);sessionWriteWait.resolve();
 await assert.rejects(exchange,e=>e.status===400);
 assert.equal([...f.rows].filter(([key,row])=>key.startsWith('auth/sessions/')&&!row.value.revoked).length,0);
});
test('revocation during the link exchange provider read cannot update the old parent',async()=>{
 const f=fixture(),parent=await f.parent(),flow=await f.start(parent.token,'link'),{code}=await ready(f,flow),userReadStarted=deferred(),userReadWait=deferred();Object.assign(f.state,{userReadStarted,userReadWait});
 const exchange=f.auth.exchangeNativeOAuth(parent.token,{code,state:flow.state,codeVerifier:flow.verifier},'user-a');await userReadStarted.promise;await f.auth.logout(parent.token,{expectedOwner:'user-a'});userReadWait.resolve();
 await assert.rejects(exchange,e=>e.status===409);assert.equal(f.parentRow(parent.token).revoked,true);assert.equal(f.parentRow(parent.token).access,undefined);
});
test('identities are a fresh current-owner projection with no provider subject or credential',async()=>{
 const f=fixture({linked:true}),parent=await f.parent();const result=await f.auth.identitiesFor(parent.token,'user-a');
 assert.equal(result.user.emailVerified,true);assert.equal(result.identities.find(identity=>identity.provider==='google').emailVerified,true);
 for(const identity of result.identities)assert.deepEqual(Object.keys(identity).sort(),['email','emailVerified','provider']);
 await assert.rejects(f.auth.identitiesFor(parent.token,'other-owner'),e=>e.status===409);await assert.rejects(f.auth.identitiesFor(null,'user-a'),e=>e.status===401);
});
test('expired callback cannot publish a handoff after the provider eventually returns',async()=>{
 const callbackStarted=deferred(),callbackWait=deferred(),f=fixture({callbackStarted,callbackWait}),flow=await f.start();await f.auth.launchNativeOAuth(new URL(flow.start.url).searchParams.get('ticket'));
 const response=f.auth.finishNativeOAuth(flow.start.transactionId,{code:'slow-provider-code'});await callbackStarted.promise;f.tick(600001);callbackWait.resolve();
 const result=new URL((await response).redirectURL);assert.equal(result.searchParams.get('error'),'expired');assert.equal(result.searchParams.get('code'),null);
});

test('manual link authorize rejects same-host non-OAuth paths and unrelated auth-origin URLs',async()=>{
 for(const badURL of ['https://accounts.google.com/Logout','https://accounts.google.com/url?url=https://evil.example','https://accounts.google.com:8443/o/oauth2/v2/auth','https://appleid.apple.com/auth/authorize','https://auth.example.com/auth/v1/authorize?provider=google']){
  const f=fixture({badURL}),parent=await f.parent();await assert.rejects(f.start(parent.token,'link'),e=>e.status===503);
 }
});
test('native callback requires the requested identity, not just a confirmed account email',async()=>{
 const f=fixture({noProvider:true}),flow=await f.start(),{callback,code}=await ready(f,flow);
 assert.equal(callback.searchParams.get('error'),'failed');assert.equal(code,null);assert.equal([...f.rows.keys()].filter(key=>key.startsWith('auth/sessions/')).length,0);
});
test('manual link cannot begin from an unverified parent mailbox',async()=>{
 const f=fixture(),parent=await f.parent();f.state.verified=false;await assert.rejects(f.start(parent.token,'link'),e=>e.status===403);
 assert.equal(f.calls.filter(call=>call.url.pathname.endsWith('/user/identities/authorize')).length,0);
});
test('a changed parent primary mailbox is an account change rather than an email merge',async()=>{
 const f=fixture(),parent=await f.parent(),flow=await f.start(parent.token,'link');await f.auth.launchNativeOAuth(new URL(flow.start.url).searchParams.get('ticket'));f.state.primaryEmail='different@example.com';const callback=new URL((await f.auth.finishNativeOAuth(flow.start.transactionId,{code:'provider-code'})).redirectURL);
 assert.equal(callback.searchParams.get('error'),'account_changed');assert.equal(callback.searchParams.get('code'),null);assert.equal(f.parentRow(parent.token).user.email,'reader@example.com');
});
