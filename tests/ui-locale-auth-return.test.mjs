import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createPortal} from '../server/portal.mjs';
import {createHostedAuth} from '../deploy/hosted-auth.mjs';
import {authFixture} from './auth-fixture.mjs';
import {safeAuthReturn,authEntryReturn} from '../app/auth-return.mjs';
import {authReturnTarget} from '../app/library-view-state.mjs';
import {readerLoginUrl,safeGiftReturn} from '../app/reader-return.mjs';

const codes=['en','zh-Hans','zh-Hant','ja'];
const gift='/gift/'+'A'.repeat(43);
const targets=['/read?book=alice&passage=p1&contentVersion=v1&layer=original',gift,'/library?upload=1'];
const disabled={translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:null,dialogueGenerator:null,guideGenerator:null,paddleProvider:null};

test('one validated outer/inner ui survives bounded auth entry; ambiguous values never become a next',()=>{
  for(const ui of codes)for(const raw of targets){
    const next=raw+(raw.includes('?')?'&':'?')+'ui='+ui;
    assert.equal(safeAuthReturn(next),next);
    assert.equal(authEntryReturn(new URLSearchParams({ui,next})),next);
    assert.equal(authReturnTarget({readerReturn:next,ui}),next);
    assert.equal(authEntryReturn(new URLSearchParams({next})),next);
    for(const invalid of [ui+'&ui='+ui,ui+'&ui=xx','xx']){
      assert.equal(authEntryReturn('ui='+invalid+'&next='+encodeURIComponent(next)),null);
      assert.equal(safeAuthReturn(raw+(raw.includes('?')?'&':'?')+'ui='+invalid),null);
    }
    const conflict=ui==='en'?'ja':'en';
    assert.equal(authEntryReturn(new URLSearchParams({ui:conflict,next})),null);
    assert.equal(authEntryReturn(new URLSearchParams([['ui',ui],['next',next],['next',next]])),null);
  }
  assert.equal(safeAuthReturn(gift),gift);
  for(const suffix of ['??ui=ja','?ui=ja?admin=1','?ui=ja?ui=en'])assert.equal(safeGiftReturn(gift+suffix),null);
  for(const raw of [gift+'?admin=1',gift+'#private',gift.replace('/gift/','/gift/../gift/'),'//evil.example'+gift])assert.equal(safeAuthReturn(raw),null);
  const login=new URL(readerLoginUrl({bookId:'alice',passageId:'p1',contentVersion:'v1',layer:'original',ui:'ja'}),'https://reader.example');
  assert.equal(login.searchParams.get('ui'),'ja');assert.equal(new URL(login.searchParams.get('next'),'https://reader.example').searchParams.get('ui'),'ja');
});

test('actual HTTP OAuth success, cancellation, expiration and unavailable callbacks preserve four-language reader/gift/upload returns',async t=>{
  let providerUnavailable=false;
  const f=authFixture({onProvider:({url})=>providerUnavailable&&url.searchParams.get('grant_type')==='pkce'?Response.json({error_code:'unexpected_failure'},{status:503}):undefined});
  const dataDir=await mkdtemp(path.join(tmpdir(),'locale-auth-return-'));
  const portal=await createPortal({...disabled,env:f.env,dataDir,publicOrigin:f.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:f.store(),authService:createHostedAuth({...f,store:f.store()}),catalogDir:null});
  const server=createServer(async(req,res)=>{
    const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    try{if(!await portal.handle({req,res,url:new URL(req.url,f.env.READER_PUBLIC_ORIGIN),send}))send(404,{});}catch(error){send(error.status||500,{error:error.message});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await Promise.all([portal.chat.close(),portal.ingestionRunner.close(),portal.audio?.close()]);await rm(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const start=next=>fetch(base+'/api/auth/oauth',{method:'POST',headers:{Origin:f.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({provider:'google',next})});
  let callbacks=0;
  for(const ui of codes)for(const raw of targets)for(const outcome of ['success','cancelled','expired','unavailable']){
    const next=raw+(raw.includes('?')?'&':'?')+'ui='+ui;
    providerUnavailable=false;const response=await start(next);assert.equal(response.status,200);await response.json();
    const cookie=response.headers.get('set-cookie').split(';')[0];
    if(outcome==='expired')for(const [key,row] of f.rows)if(key.startsWith('auth/oauth/')&&!row.value.consumed)row.value.expiresAt=Date.now()-1;
    providerUnavailable=outcome==='unavailable';
    const callback=await fetch(base+'/api/auth/callback?'+(outcome==='cancelled'?'error=access_denied&error_description=PRIVATE_DETAIL':'code=provider-code'),{headers:{Cookie:cookie,'X-Forwarded-Host':'evil.example'},redirect:'manual'});
    assert.equal(callback.status,303);callbacks++;
    const location=new URL(callback.headers.get('location'));assert.equal(location.origin,f.env.READER_PUBLIC_ORIGIN);assert.equal(location.searchParams.getAll('ui').length,1);assert.equal(location.searchParams.get('ui'),ui);assert.equal(location.href.includes('PRIVATE_DETAIL'),false);
    if(outcome==='success'){
      assert.equal(location.pathname+location.search,next);assert.match(callback.headers.get('set-cookie'),/marginalia_session=/);
    }else{
      assert.equal(location.searchParams.get('auth_error'),outcome);assert.equal(location.searchParams.get('login'),'1');
      if(raw.includes('upload=1')){assert.equal(location.searchParams.get('upload'),'1');assert.equal(location.searchParams.has('next'),false);}
      else{const inner=location.searchParams.get('next');assert.equal(inner,next);assert.equal(authEntryReturn(location.searchParams),next);assert.equal(new URL(inner,f.env.READER_PUBLIC_ORIGIN).searchParams.getAll('ui').length,1);}
      assert.doesNotMatch(callback.headers.get('set-cookie'),/marginalia_session=/);
    }
  }
  assert.equal(callbacks,48);
  for(const next of [gift+'?ui=ja&ui=ja','/read?book=alice&ui=ja&ui=en','/library?ui=unsupported']){
    const before=[...f.rows.keys()].filter(key=>key.startsWith('auth/oauth/')).length;
    const response=await start(next);assert.equal(response.status,400);await response.json();
    assert.equal([...f.rows.keys()].filter(key=>key.startsWith('auth/oauth/')).length,before);
  }
});
