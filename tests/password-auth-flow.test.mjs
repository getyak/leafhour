import test from 'node:test';
import assert from 'node:assert/strict';
import{createAuthFlow,createAuthRequestGuard}from'../app/auth-flow.mjs';

test('password is the initial method and passwords are never copied into flow state',()=>{
  const flow=createAuthFlow();assert.equal(flow.view().method,'password');flow.setEmail('Reader@example.com');
  const ticket=flow.begin('password');assert.equal(ticket.email,'reader@example.com');assert.equal(ticket.action,'password');assert.equal('password'in ticket,false);
});
test('switching methods retains the mailbox and invalidates a pending email response',()=>{
  const flow=createAuthFlow();flow.setEmail('reader@example.com');const send=flow.begin('send');
  assert.equal(flow.choose('password'),true);assert.equal(flow.sent(send,{expiresIn:600,retryAfter:60}),false);
  assert.equal(flow.view().email,'reader@example.com');assert.equal(flow.view().method,'password');assert.equal(flow.view().step,'email');
});
test('signup proof leads to password setup while ordinary email proof finishes login',()=>{
  for(const purpose of ['signup','recovery','login']){const flow=createAuthFlow();flow.choose('code',purpose);flow.setEmail('reader@example.com');const send=flow.begin('send');flow.sent(send,{retryAfter:60,expiresIn:600});flow.setCode('123456');const verify=flow.begin('verify');assert.equal(verify.purpose,purpose);
    assert.equal(flow.verified(verify,{passwordSetup:purpose!=='login'}),true);flow.settled(verify);
    assert.equal(flow.view().step,purpose==='login'?'success':'set-password');
    if(purpose!=='login'){const save=flow.begin('save-password');assert.ok(save);assert.equal(flow.verified(save),true);}
  }
});
test('password requests remain serialized after closing and reopening',()=>{
  const guard=createAuthRequestGuard(),first=createAuthFlow({requestGuard:guard});first.setEmail('reader@example.com');const pending=first.begin('password');first.close();
  const next=createAuthFlow({requestGuard:guard});assert.equal(next.choose('code'),false);assert.equal(next.begin('password'),null);
  first.settled(pending);next.setEmail('next@example.com');assert.ok(next.begin('password'));assert.equal(first.verified(pending),false);
});
test('closing password setup resets the entry method and clears the code',()=>{
  const flow=createAuthFlow();flow.choose('code','recovery');flow.setEmail('reader@example.com');const send=flow.begin('send');flow.sent(send,{expiresIn:600,retryAfter:60});flow.setCode('123456');flow.close();flow.open();
  assert.equal(flow.view().method,'password');assert.equal(flow.view().purpose,'login');assert.equal(flow.view().code,'');assert.equal(flow.view().email,'reader@example.com');
});
