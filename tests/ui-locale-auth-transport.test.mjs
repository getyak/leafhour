import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHostedHandler} from '../api/[...path].js';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {createPortal} from '../server/portal.mjs';
import {createReaderServer} from '../server/server.mjs';
import {createOwnerScope,readOwnerResponse} from '../app/owner-scope.mjs';
import {createAuthFlow} from '../app/auth-flow.mjs';
import {authFixture} from './auth-fixture.mjs';

const disabled={translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null};
async function clientError(response){
  const scope=createOwnerScope();let error;
  try{await readOwnerResponse(scope,scope.capture(),async()=>response,()=>assert.fail('not an owner transition'));}catch(cause){error=cause;}
  assert.ok(error);const flow=createAuthFlow();flow.setEmail('reader@example.test');const ticket=flow.begin('password');flow.failed(ticket,error);
  return {error,descriptor:flow.view().error};
}

test('actual hosted provider failure crosses the public JSON adapter into the browser flow as a bounded ID',async t=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'locale-auth-hosted-')),portals=[];
  t.after(async()=>{for(const portal of portals)await Promise.all([portal.chat.close(),portal.ingestionRunner.close(),portal.audio?.close()]);await rm(dataDir,{recursive:true,force:true});});
  for(const [providerCode,expected]of [['invalid_credentials','auth.error.badCredentials'],['email_not_confirmed','auth.error.emailUnconfirmed']]){
    const fixture=authFixture({onProvider:({url})=>url.searchParams.get('grant_type')==='password'?Response.json({error_code:providerCode,msg:'Untrusted provider prose'},{status:400}):undefined});
    const handler=createHostedHandler({env:fixture.env,storeFactory:()=>fixture.store(),authFactory:({store,env})=>createHostedAuth({...fixture,store,env}),portalFactory:async options=>{const portal=await createPortal({...options,...disabled,dataDir});portals.push(portal);return portal;}});
    let body;const res={setHeader(){},end(bytes){body=JSON.parse(bytes);}};
    await handler({url:'/api/auth/password',method:'POST',headers:{origin:fixture.env.READER_PUBLIC_ORIGIN,'content-type':'application/json'},body:{email:'reader@example.test',password:'synthetic-password'},socket:{remoteAddress:'127.0.0.1'}},res);
    assert.equal(res.statusCode,401);assert.equal(body.messageId,expected);assert.equal(JSON.stringify(body).includes('Untrusted provider prose'),false);
    const received=await clientError(Response.json(body,{status:res.statusCode}));assert.equal(received.error.messageId,expected);assert.deepEqual(received.descriptor,{id:expected});
  }
});

test('actual local HTTP validation sends the same bounded descriptor to the browser',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'locale-auth-local-'));
  const server=await createReaderServer({...disabled,env:{},sendCode:null,bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+server.address().port;
  const response=await fetch(origin+'/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:'invalid-address',code:'123456'})});
  assert.equal(response.status,400);const result=await clientError(response);assert.equal(result.error.messageId,'auth.error.emailInvalid');assert.deepEqual(result.descriptor,{id:'auth.error.emailInvalid'});
});

test('unknown transported identifiers cannot select unrelated labels or surface provider prose',async()=>{
  for(const messageId of ['profile.saved','source text',{},null]){
    const result=await clientError(Response.json({error:'Untrusted provider prose',messageId,retryAfter:120},{status:429}));
    assert.equal(result.error.messageId,undefined);assert.equal(result.error.retryAfter,120);assert.deepEqual(result.descriptor,{id:'auth.error.generic'});
  }
});
