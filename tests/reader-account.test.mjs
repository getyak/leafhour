import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './annotation-dom-fixture.mjs';
import {mountReaderAccount} from '../app/reader-account.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function owner({signedIn=true,request=async()=>Response.json({signedOut:true})}={}){
 const {document}=fixture('<body><button id="entry"></button></body>'),trigger=document.getElementById('entry');let departures=0,href='/library?login=1&next=one';
 const surface=mountReaderAccount({document,trigger,session:{user:signedIn?{id:'one',displayName:'Reader',email:'fixture@example.test'}:null},request,loginHref:()=>href,onSignedOut:()=>departures++});
 return {document,trigger,surface,$:id=>document.getElementById(id),departures:()=>departures,setHref:value=>{href=value;}};
}
for(const locale of ['en','zh-Hans','zh-Hant','ja'])test('reader account confirms explicitly and cancels without logout in '+locale,async()=>{
 await requestUiRoute(locale);let requests=0;const f=owner({request:async()=>{requests++;return Response.json({signedOut:true});}});
 try{
  f.surface.open();assert.equal(f.$('reader-account-email').textContent,'fixture@example.test');assert.equal(requests,0);
  f.$('reader-account-logout').dispatchEvent(new Event('click'));assert.equal(requests,0);assert.equal(f.$('reader-account-consequence').hidden,false);assert.ok(f.document.activeElement===f.$('reader-account-cancel'));
  f.$('reader-account-cancel').dispatchEvent(new Event('click'));assert.equal(requests,0);assert.equal(f.$('reader-account-consequence').hidden,true);
  f.$('reader-account-logout').dispatchEvent(new Event('click'));f.$('reader-account-logout').dispatchEvent(new Event('click'));await tick();assert.equal(requests,1);assert.equal(f.departures(),1);
 }finally{f.surface.unmount();}
});
test('anonymous reader has a current return link and no logout action',()=>{
 const f=owner({signedIn:false});try{f.surface.open();assert.equal(f.$('reader-account-logout').hidden,true);assert.equal(f.$('reader-account-login').hidden,false);f.setHref('/library?login=1&next=two');f.surface.open();assert.equal(f.$('reader-account-login').href,'/library?login=1&next=two');}finally{f.surface.unmount();}
});
test('failed logout preserves the reader and allows an explicit retry',async()=>{
 const f=owner({request:async()=>Response.json({error:'unavailable'},{status:503})});try{f.surface.open();f.$('reader-account-logout').dispatchEvent(new Event('click'));f.$('reader-account-logout').dispatchEvent(new Event('click'));await tick();assert.equal(f.departures(),0);assert.equal(f.$('reader-account').open,true);assert.ok(f.$('reader-account-status').textContent);assert.equal(f.$('reader-account-logout').disabled,false);}finally{f.surface.unmount();}
});
test('unmount withdraws pending logout UI, locale subscriptions and late navigation',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;}),f=owner({request:()=>waiting});f.surface.open();f.$('reader-account-logout').dispatchEvent(new Event('click'));f.$('reader-account-logout').dispatchEvent(new Event('click'));f.surface.unmount();release(Response.json({signedOut:true}));await tick();await requestUiRoute('en');assert.equal(f.departures(),0);assert.equal(f.$('reader-account'),null);assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
});
test('account Tab order stays inside visible actions and does not consume browser shortcuts',()=>{
 const f=owner();try{
  f.surface.open();const press=(shiftKey=false,extra={})=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'Tab',shiftKey,...extra});f.$('reader-account').dispatchEvent(event);return event;};
  assert.equal(press().defaultPrevented,true);assert.ok(f.document.activeElement===f.$('reader-account-logout'));
  press();assert.ok(f.document.activeElement===f.$('reader-account-close'));press(true);assert.ok(f.document.activeElement===f.$('reader-account-logout'));
  f.$('reader-account-logout').dispatchEvent(new Event('click'));assert.ok(f.document.activeElement===f.$('reader-account-cancel'));press();assert.ok(f.document.activeElement===f.$('reader-account-logout'));press();assert.ok(f.document.activeElement===f.$('reader-account-close'));
  assert.equal(press(false,{ctrlKey:true}).defaultPrevented,false);assert.ok(f.document.activeElement===f.$('reader-account-close'));
 }finally{f.surface.unmount();}
});
