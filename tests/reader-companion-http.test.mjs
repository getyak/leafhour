import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('companion HTTP keeps identity guards and never generates before enabled reading observation',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'squirrel-http-'));let calls=0;
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),translator:null,sendCode:null,chatGenerator:null,companionGenerator:async()=>{calls++;return {kind:'silence'};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,url=base+'/api/library/books/gutenberg-alice/companion';
  assert.equal((await fetch(url)).status,401);const session=await server.portal.auth.localSession(),headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id,Origin:base,'Content-Type':'application/json'};
  const post=(path,value,h=headers)=>fetch(url+path,{method:'POST',headers:h,body:JSON.stringify(value)});
  const disabled=await (await fetch(url,{headers})).json();assert.equal(disabled.enabled,false);assert.equal(disabled.available,true);
  const bad=await post('',{enabled:true,contentVersion:disabled.contentVersion},{...headers,'X-Reader-Owner':'different'});assert.equal(bad.status,409);
  const enabled=await (await post('',{enabled:true,contentVersion:disabled.contentVersion})).json();assert.equal(enabled.enabled,true);
  const chat=await server.portal.chat.view(session.user,'gutenberg-alice'),input={id:'first',passageId:chat.context.passageId,contentVersion:enabled.contentVersion,revision:enabled.revision,sessionId:enabled.sessionId};
  assert.equal((await post('/messages',input)).status,409);assert.equal(calls,0);
  assert.equal((await post('/observe',{...input,active:true})).status,200);
  const off=await (await post('',{enabled:false,contentVersion:enabled.contentVersion})).json();assert.equal(off.enabled,false);assert.ok(off.revision>enabled.revision);
  assert.equal((await post('/observe',{...input,active:true})).status,409);assert.equal(calls,0);
});
