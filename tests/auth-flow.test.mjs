import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../app/auth-flow.mjs').catch(()=>({}));
const make=options=>{assert.equal(typeof module.createAuthFlow,'function');return module.createAuthFlow(options);};

test('resend uses an absolute deadline and survives closing and reopening the dialog',()=>{
  let now=100000;const flow=make({clock:()=>now});flow.setEmail('Reader@example.com');const ticket=flow.begin('send');assert.ok(ticket);
  flow.sent(ticket,{expiresIn:600,retryAfter:60});now+=15000;assert.equal(flow.view().cooldownSeconds,45);
  flow.close();flow.open();assert.equal(flow.view().email,'reader@example.com');assert.equal(flow.view().cooldownSeconds,45);
  now+=45000;assert.equal(flow.view().cooldownSeconds,0);assert.ok(flow.begin('send'));
});
test('changing mailbox discards the old code and a delayed send response',()=>{
  const flow=make({clock:()=>100000});flow.setEmail('one@example.com');const old=flow.begin('send');flow.changeEmail();flow.setEmail('two@example.com');flow.setCode('123456');
  assert.equal(flow.sent(old,{retryAfter:60,expiresIn:600}),false);assert.equal(flow.view().step,'email');assert.equal(flow.view().code,'');
  const next=flow.begin('send');assert.equal(next.email,'two@example.com');assert.equal(flow.sent(next,{retryAfter:60,expiresIn:600}),true);assert.equal(flow.view().step,'code');
});
test('a second submit cannot launch another concurrent send or verification',()=>{
  let now=100000;const flow=make({clock:()=>now});flow.setEmail('one@example.com');const sent=flow.begin('send');assert.equal(flow.begin('send'),null);flow.sent(sent,{retryAfter:60,expiresIn:600});
  flow.setCode('123456');const verifying=flow.begin('verify');assert.ok(verifying);assert.equal(flow.begin('verify'),null);assert.equal(flow.begin('send'),null);
});
test('a successful verification cannot be overwritten by a delayed failure',()=>{
  const flow=make({clock:()=>100000});flow.setEmail('one@example.com');const sent=flow.begin('send');flow.sent(sent,{retryAfter:60,expiresIn:600});flow.setCode('123456');const verify=flow.begin('verify');
  assert.equal(flow.verified(verify),true);assert.equal(flow.failed(verify,new Error('Late error')),false);assert.equal(flow.view().step,'success');assert.equal(flow.view().code,'');
});
test('backend rate limits update the actual wait and do not clear a recoverable mailbox',()=>{
  let now=100000;const flow=make({clock:()=>now});flow.setEmail('one@example.com');const sent=flow.begin('send');const error=Object.assign(new Error('Limited'),{retryAfter:120});flow.failed(sent,error);
  assert.equal(flow.view().cooldownSeconds,120);assert.equal(flow.view().email,'one@example.com');now+=30000;assert.equal(flow.view().cooldownSeconds,90);
});
test('closing an in-flight request invalidates its response without losing its cooldown',()=>{
  const flow=make({clock:()=>100000});flow.setEmail('one@example.com');const sent=flow.begin('send');flow.close();flow.open();
  assert.equal(flow.sent(sent,{retryAfter:60,expiresIn:600}),false);assert.equal(flow.view().busy,false);assert.equal(flow.view().cooldownSeconds,60);
});
test('pasted digits are normalized and incomplete codes cannot submit',()=>{
  const flow=make({clock:()=>100000});flow.setEmail('one@example.com');const sent=flow.begin('send');flow.sent(sent,{retryAfter:60,expiresIn:600});
  flow.setCode('12 34');assert.equal(flow.view().code,'1234');assert.equal(flow.begin('verify'),null);
  flow.setCode('12 34 56');assert.equal(flow.view().code,'123456');assert.ok(flow.begin('verify'));
});
test('cookie-changing requests remain serialized across close, reset, and a different account',()=>{
  assert.equal(typeof module.createAuthRequestGuard,'function');const requestGuard=module.createAuthRequestGuard();
  const first=make({requestGuard});first.setEmail('one@example.com');let sent=first.begin('send');first.sent(sent,{retryAfter:60,expiresIn:600});first.setCode('123456');const pending=first.begin('verify');first.close();
  const second=make({requestGuard});assert.equal(second.view().busy,true);assert.equal(second.begin('local'),null);assert.equal(second.begin('oauth'),null);second.setEmail('two@example.com');assert.equal(second.begin('send'),null);
  first.settled(pending);second.setEmail('two@example.com');sent=second.begin('send');assert.ok(sent);second.sent(sent,{retryAfter:60,expiresIn:600});second.setCode('123456');assert.ok(second.begin('verify'));assert.equal(first.verified(pending),false);
});


test('auth flow retains only a validated message descriptor, never remote prose as a catalogue key',()=>{
  for(const messageId of ['auth.error.badCredentials','source sentence','profile.saved',null]){
    const flow=make();flow.setEmail('reader@example.test');const ticket=flow.begin('password');flow.failed(ticket,{message:'Private remote prose',messageId});
    assert.deepEqual(flow.view().error,{id:messageId==='auth.error.badCredentials'?messageId:'auth.error.generic'});
    assert.equal(JSON.stringify(flow.view()).includes('Private remote prose'),false);
  }
});
