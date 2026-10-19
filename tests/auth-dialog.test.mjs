import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{mountAuthDialog}from'../app/auth-dialog.mjs';
import {requestUiRoute,t as uiText} from '../app/ui-locale.mjs';

// Exercise the real controller with small DOM primitives; HTTP/provider behavior has separate tests.
async function fixture({api,locale='zh-Hans',session={passwordAvailable:true,emailAvailable:true,providers:{google:true,apple:true}}}={}){
  await requestUiRoute(locale);
  const html=await readFile(new URL('../app/home.html',import.meta.url),'utf8'),nodes=new Map(),marked=[],doc={active:null};
  class Node extends EventTarget{
    constructor(id){super();this.id=id;this.value='';this.hidden=false;this.type='password';this.dataset={};this.classList={toggle(){}};this.attrs={};}
    get validity(){return {valid:this.id!=='email'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)};}
    set disabled(v){this._disabled=v;if(v&&doc.active===this)doc.active=null;}get disabled(){return this._disabled;}
    setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}focus(){if(!this.disabled)doc.active=this;}
    querySelector(){return new Node('provider-state');}
  }
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,new Node(id));
  const toggles=['auth-password','new-password'].map(id=>{const node=new Node('toggle-'+id);node.dataset.passwordToggle=id;return node;});
  for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bdata-ui(?:-aria-label)?="[^"]+"[^>]*)>/g)){
    const attributes=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));
    const node=nodes.get(attributes.id)||new Node('marked-'+marked.length);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);marked.push(node);
  }
  const dialog=nodes.get('auth-dialog');dialog.querySelector=selector=>selector.startsWith('#')?nodes.get(selector.slice(1)):null;dialog.querySelectorAll=selector=>selector==='[data-password-toggle]'?toggles:marked;

  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'));};
  let authenticated=0,settled=0;
  const controller=mountAuthDialog({dialog,api,getSession:()=>session,getReturnTo:()=>'/library',onAuthenticated:async()=>{authenticated++;},onSessionSettled:async()=>{settled++;}});
  const fire=async(id,type='click')=>{nodes.get(id).dispatchEvent(new Event(type,{cancelable:true}));await new Promise(setImmediate);};
  const input=async(id,value)=>{nodes.get(id).value=value;await fire(id,'input');};
  return{nodes,marked,toggles,doc,dialog,controller,fire,input,counts:()=>({authenticated,settled})};
}
test('password errors restore focus after disabled controls are re-enabled',async(t)=>{
  const f=await fixture({api:async()=>{throw Error('邮箱或密码不正确');}});t.after(()=>f.controller.dispose());f.controller.open();
  await f.input('email','reader@example.com');await f.input('auth-password','fixture-password');f.nodes.get('auth-password').focus();
  await f.fire('email-form','submit');assert.equal(f.nodes.get('auth-password').disabled,false);assert.equal(f.doc.active?.id,'auth-password');f.controller.close();
});
test('English home login keeps its language across method changes, countdowns and reopening',async t=>{
  const f=await fixture({locale:'en',api:async()=>({sent:true,expiresIn:600,retryAfter:60})});t.after(()=>f.controller.dispose());f.controller.open();
  assert.equal(f.nodes.get('auth-title').textContent,'Welcome back to your reading room');
  assert.equal(f.nodes.get('send-code').textContent,'Enter reading room');
  await f.fire('use-code');await f.input('email','reader@example.com');await f.fire('email-form','submit');
  assert.equal(f.nodes.get('auth-title').textContent,'Verify your email');assert.match(f.nodes.get('resend-code').textContent,/Resend in \d+s/);
  f.controller.close();f.controller.open();assert.equal(f.nodes.get('auth-title').textContent,'Welcome back to your reading room');
});
test('English sign-in failures explain the available recovery action',async t=>{
  for(const [message,messageId,expected]of [
    ['邮箱或密码不正确，请重试或使用验证码登录','auth.error.badCredentials','The email or password is incorrect. Try again or use an email code.'],
    ['登录尝试较多，请稍后再试，也可以使用验证码登录','auth.error.passwordLimited','Too many sign-in attempts. Try again later or use an email code.'],
    ['未来新增的登录错误',undefined,'Unable to complete sign-in. Please try again or choose another sign-in method.']
  ])await t.test(message,async t=>{
    const f=await fixture({locale:'en',api:async()=>{throw Object.assign(Error(message),{messageId});}});t.after(()=>f.controller.dispose());f.controller.open();
    await f.input('email','reader@example.com');await f.input('auth-password','fixture-password');await f.fire('email-form','submit');
    assert.equal(f.nodes.get('auth-status').textContent,expected);assert.equal(f.nodes.get('auth-status').attrs.role,'alert');assert.equal(f.doc.active?.id,'auth-password');
  });
});
test('English email-code errors stay readable in sending and verification steps',async t=>{
  for(const [path,message,messageId,expected]of [
    ['/api/auth/code','验证码邮件暂时无法发出，请稍后重试','auth.error.mailUnavailable','The code email could not be sent. Please try again later.'],
    ['/api/auth/verify','验证码不正确或已过期，请重新获取','auth.error.codeInvalid','The code is incorrect or has expired. Request another one.']
  ])await t.test(path,async t=>{
    const f=await fixture({locale:'en',api:async route=>{if(route===path)throw Object.assign(Error(message),{messageId});return{sent:true,expiresIn:600,retryAfter:60};}});t.after(()=>f.controller.dispose());f.controller.open();
    await f.fire('use-code');await f.input('email','reader@example.com');await f.fire('email-form','submit');
    if(path.endsWith('verify')){await f.input('email-code','123456');await f.fire('verify-form','submit');}
    assert.equal(f.nodes.get('auth-status').textContent,expected);assert.equal(f.nodes.get('auth-code-step').hidden,false);assert.equal(f.doc.active?.id,'email-code');
  });
});
test('English password setup retains the verified flow after a rejected password',async t=>{
  for(const [message,messageId,expected]of [
    ['请设置至少 8 个字符的密码','auth.error.passwordLength','Choose a password with at least eight characters.'],
    ['这个密码不够安全，请换一个较长的密码','auth.error.weakPassword','This password is too weak. Choose a longer password.'],
    ['新密码与原密码相同，请换一个','auth.error.samePassword','This is your current password. Choose a different one.']
  ])await t.test(message,async t=>{
    const f=await fixture({locale:'en',api:async route=>{if(route.endsWith('/setup'))throw Object.assign(Error(message),{messageId});return route.endsWith('/code')?{sent:true,expiresIn:600,retryAfter:60}:{user:{id:'user-a'},passwordSetup:true,passwordSetupToken:'fixture-setup-token'};}});t.after(()=>f.controller.dispose());f.controller.open();
    await f.fire('create-account');await f.input('email','reader@example.com');await f.fire('email-form','submit');await f.input('email-code','123456');await f.fire('verify-form','submit');
    await f.input('new-password','fixture-password');await f.fire('password-setup-form','submit');
    assert.equal(f.nodes.get('auth-status').textContent,expected);assert.equal(f.nodes.get('auth-setup-step').hidden,false);assert.equal(f.controller.isSettingPasswordFor('user-a'),true);assert.equal(f.doc.active?.id,'new-password');
  });
});
test('pending verification is exposed until the receipt establishes matching password setup',async(t)=>{
  let resolve;const pending=new Promise(r=>{resolve=r;});
  const f=await fixture({api:async path=>path==='/api/auth/code'?{sent:true,expiresIn:600,retryAfter:60}:pending});t.after(()=>f.controller.dispose());f.controller.open();
  await f.fire('create-account');await f.input('email','reader@example.com');await f.fire('email-form','submit');await f.input('email-code','123456');await f.fire('verify-form','submit');
  assert.equal(f.controller.hasPendingSessionChange(),true);
  assert.equal(f.controller.isSettingPasswordFor('user-a'),false);
  resolve({user:{id:'user-a'},passwordSetup:true,passwordSetupToken:'fixture-setup-token'});await new Promise(setImmediate);
  assert.equal(f.controller.hasPendingSessionChange(),false);assert.equal(f.controller.isSettingPasswordFor('user-a'),true);assert.equal(f.controller.isSettingPasswordFor('user-b'),false);
  assert.equal(f.nodes.get('auth-setup-step').hidden,false);assert.equal(f.doc.active?.id,'new-password');f.controller.close();
});
test('SMTP-only local auth keeps password-specific registration hidden',async(t)=>{
  const f=await fixture({api:async()=>({}),session:{passwordAvailable:false,emailAvailable:true,providers:{}}});t.after(()=>f.controller.dispose());f.controller.open();
  assert.equal(f.nodes.get('auth-password-field').hidden,true);assert.equal(f.nodes.get('auth-signup').hidden,true);assert.equal(f.nodes.get('create-account').disabled,true);f.controller.close();
});

test('login availability follows native email validity and password input, including busy requests',async(t)=>{
  let reject;const pending=new Promise((_,r)=>{reject=r;});
  const f=await fixture({api:()=>pending});t.after(()=>f.controller.dispose());f.controller.open();
  assert.equal(f.nodes.get('send-code').disabled,true);
  await f.input('email','reader');await f.input('auth-password','fixture-password');assert.equal(f.nodes.get('send-code').disabled,true);
  await f.input('email','reader@example.com');assert.equal(f.nodes.get('send-code').disabled,false);
  await f.fire('email-form','submit');assert.equal(f.dialog.attrs['aria-busy'],'true');assert.equal(f.nodes.get('send-code').disabled,true);
  reject(Error('网络暂时无法连接'));await new Promise(setImmediate);
  assert.equal(f.dialog.attrs['aria-busy'],'false');assert.equal(f.nodes.get('send-code').disabled,false);assert.equal(f.nodes.get('auth-status').attrs.role,'alert');
});
test('a failed code send retains the verification step with visible focus and an announced error',async(t)=>{
  const f=await fixture({api:async()=>{throw Error('验证码暂时无法发送');}});t.after(()=>f.controller.dispose());f.controller.open();
  await f.fire('use-code');await f.input('email','reader@example.com');await f.fire('email-form','submit');
  assert.equal(f.nodes.get('auth-code-step').hidden,false);assert.equal(f.doc.active?.id,'email-code');assert.equal(f.nodes.get('email-code').attrs['aria-invalid'],'true');assert.equal(f.nodes.get('auth-status').attrs.role,'alert');
});


test('language changes reformat a pending login and its failure without clearing secrets, selection or request ownership',async t=>{
  let reject,calls=0;const f=await fixture({locale:'en',api:()=>{calls++;return new Promise((_,no)=>{reject=no;});}});t.after(()=>f.controller.dispose());f.controller.open();
  await f.input('email','reader@example.test');await f.input('auth-password','synthetic-password');f.nodes.get('auth-password').focus();
  await f.fire('email-form','submit');
  const password=f.nodes.get('auth-password');password.selectionStart=2;password.selectionEnd=7;
  // Count real property writes after the operation has begun. A locale handler
  // must not even assign the same draft value or run the disabled/focus path.
  let value=password.value,writes=0;Object.defineProperty(password,'value',{get:()=>value,set:next=>{writes++;value=next;},configurable:true});
  const focus=f.doc.active;await requestUiRoute('ja');
  assert.equal(calls,1);assert.equal(password.value,'synthetic-password');assert.equal(writes,0);assert.equal(password.selectionStart,2);assert.equal(password.selectionEnd,7);assert.equal(f.doc.active,focus);
  assert.equal(f.nodes.get('email').value,'reader@example.test');assert.equal(f.nodes.get('send-code').textContent,uiText('auth.entering'));assert.equal(f.nodes.get('send-code').disabled,true);
  assert.ok(f.marked.some(x=>x.getAttribute('data-ui')==='auth.email.label'&&x.textContent===uiText('auth.email.label')));
  reject(Object.assign(Error('Provider prose must not render'),{messageId:'auth.error.badCredentials'}));await new Promise(setImmediate);
  assert.equal(f.nodes.get('auth-status').textContent,uiText('auth.error.badCredentials'));await requestUiRoute('zh-Hant');assert.equal(calls,1);assert.equal(f.nodes.get('auth-status').textContent,uiText('auth.error.badCredentials'));assert.equal(password.value,'synthetic-password');
});

test('language changes keep the absolute email cooldown and entered code without sending again',async t=>{
  let calls=0;const f=await fixture({locale:'en',api:async()=>{calls++;return {sent:true,expiresIn:600,retryAfter:120};}});t.after(()=>f.controller.dispose());f.controller.open();
  await f.fire('use-code');await f.input('email','reader@example.test');await f.fire('email-form','submit');await f.input('email-code','123456');
  const code=f.nodes.get('email-code');code.focus();await requestUiRoute('ja');
  assert.equal(calls,1);assert.equal(code.value,'123456');assert.equal(f.doc.active,code);assert.equal(f.nodes.get('auth-code-step').hidden,false);assert.equal(f.nodes.get('resend-code').disabled,true);assert.match(f.nodes.get('resend-code').textContent,/1[12][0-9]/);assert.equal(f.nodes.get('auth-expiry').textContent,uiText('auth.code.valid'));
});
