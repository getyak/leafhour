import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './annotation-dom-fixture.mjs';

test('reader login reuses the real form once, restores its opener on cancel and resumes through a fresh account-scoped document',async()=>{
 const {mountReaderLogin}=await import('../app/reader-login.mjs');
 const {document}=fixture('<body><button id="ai">AI</button></body>');
 const {document:source}=fixture(await readFile(new URL('../app/home.html',import.meta.url),'utf8'));
 const dialog=source.getElementById('auth-dialog'),opener=document.getElementById('ai');opener.focus();
 let config,opens=0,disposed=0;const navigations=[];
 const controller=mountReaderLogin({document,session:{user:null},getReturnTo:()=>'/read?book=alice&passage=p1&action=chat',navigate:url=>navigations.push(url),loadStyles:async()=>true,loadTemplate:async()=>dialog,mountAuth:options=>{config=options;return {open(){opens++;dialog.showModal();},close(){dialog.close();},dispose(){disposed++;},isSettingPasswordFor:()=>false};}});
 await controller.open();await controller.open();assert.equal(opens,2);assert.equal(document.getElementById('auth-dialog'),dialog);
 dialog.close();assert.equal(document.activeElement,opener);
 await config.onAuthenticated();assert.deepEqual(navigations,['/read?book=alice&passage=p1&action=chat']);
 controller.dispose();assert.equal(disposed,1);assert.equal(document.getElementById('auth-dialog'),null);
});

test('disposal while the shared login form is loading cannot later show a dialog',async()=>{
 const {mountReaderLogin}=await import('../app/reader-login.mjs');const {document}=fixture('<body></body>');
 let complete,opened=0;const pending=new Promise(resolve=>{complete=resolve;});
 const controller=mountReaderLogin({document,session:{user:null},getReturnTo:()=>'/read?book=alice&passage=p1&action=chat',loadStyles:async()=>true,loadTemplate:()=>pending,mountAuth:()=>({open(){opened++;},dispose(){}})});
 const opening=controller.open();controller.dispose();complete(document.createElement('dialog'));await opening;assert.equal(opened,0);
});

test('a late close session response cannot leave a reopened password flow or a newer close',async()=>{
 const {mountReaderLogin}=await import('../app/reader-login.mjs');
 for(const closeAgain of [false,true]){
  const {document}=fixture('<body></body>'),dialog=document.createElement('dialog'),pending=[],navigations=[];let settingPassword=false;
  const controller=mountReaderLogin({document,session:{user:null},getReturnTo:()=>'/read?book=alice&passage=p1&action=chat',navigate:url=>navigations.push(url),request:()=>new Promise(resolve=>pending.push(resolve)),loadStyles:async()=>true,loadTemplate:async()=>dialog,mountAuth:()=>({open(){dialog.showModal();},dispose(){},isSettingPasswordFor:()=>settingPassword})});
  await controller.open();dialog.close();await controller.open();settingPassword=!closeAgain;
  if(closeAgain)dialog.close();
  pending[0]({ok:true,json:async()=>({user:{id:'owner-a'}})});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(navigations,[],'an older close cannot redirect a newer login round');
  if(closeAgain){pending[1]({ok:true,json:async()=>({user:{id:'owner-a'}})});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(navigations,['/read?book=alice&passage=p1&action=chat']);}
  controller.dispose();
 }
});

test('closing provisional password setup does not navigate through its unresolved session',async()=>{
 const {mountReaderLogin}=await import('../app/reader-login.mjs');
 const {document}=fixture('<body></body>'),dialog=document.createElement('dialog'),navigations=[];
 const controller=mountReaderLogin({document,session:{user:null},getReturnTo:()=>'/read?book=alice&passage=p1&action=chat',navigate:url=>navigations.push(url),request:async()=>({ok:true,json:async()=>({user:{id:'owner-a'}})}),loadStyles:async()=>true,loadTemplate:async()=>dialog,mountAuth:()=>({open(){dialog.showModal();},dispose(){},isSettingPasswordFor:()=>true})});
 await controller.open();dialog.close();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(navigations,[]);controller.dispose();
});

test('the shared auth close settlement cannot redirect a newly opened login round',async()=>{
 const {mountReaderLogin}=await import('../app/reader-login.mjs');
 const {document}=fixture('<body></body>'),dialog=document.createElement('dialog'),pending=[],navigations=[];
 const controller=mountReaderLogin({document,session:{user:null},getReturnTo:()=>'/read?book=alice&passage=p1&action=chat',navigate:url=>navigations.push(url),request:()=>new Promise(resolve=>pending.push(resolve)),loadStyles:async()=>true,loadTemplate:async()=>dialog,mountAuth:options=>{
  // The real shared form clears provisional state and reconciles it before
  // the enclosing reader login's own close listener runs.
  dialog.addEventListener('close',()=>{void options.onSessionSettled();});
  return {open(){dialog.showModal();},dispose(){},isSettingPasswordFor:()=>false};
 }});
 await controller.open();dialog.close();assert.equal(pending.length,2);await controller.open();
 for(const resolve of pending){resolve({ok:true,json:async()=>({user:{id:'owner-a'}})});await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(dialog.open,true);assert.deepEqual(navigations,[]);controller.dispose();
});

test('validated login return retains only the current book, source paragraph and explicit chat action',async()=>{
 const {readerLoginUrl,safeReaderReturn}=await import('../app/reader-return.mjs');
 const login=new URL(readerLoginUrl({bookId:'alice',passageId:'p1',action:'chat',ui:'zh-Hans'}),'http://reader.test');
 assert.equal(login.searchParams.get('next'),'/read?book=alice&passage=p1&action=chat&ui=zh-Hans');
 assert.equal(safeReaderReturn('/read?book=alice&passage=p1&action=delete'),'/read?book=alice&passage=p1');
});
