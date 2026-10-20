import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../app/account-ui-preferences-transport.mjs').catch(()=>({}));
const make=options=>{assert.equal(typeof module.createAccountUiPreferencesTransport,'function');return module.createAccountUiPreferencesTransport(options);};
const empty={revision:0,updatedAt:null,uiLocale:null};
test('only the captured verified owner and fixed same-origin endpoint travel in a preference request',async()=>{
 const calls=[],transport=make({request:async(...args)=>{calls.push(args);return Response.json(empty);}});
 assert.deepEqual(await transport.read('account-A'),empty);
 await transport.write('account-A',{baseRevision:0,uiLocale:'ja'});
 assert.equal(calls.length,2);
 for(const [url,options]of calls){assert.equal(url,'/api/account/ui-preferences');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Reader-Owner'],'account-A');assert.ok(options.signal instanceof AbortSignal);}
 assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].body,undefined);
 assert.equal(calls[1][1].method,'POST');assert.deepEqual(JSON.parse(calls[1][1].body),{baseRevision:0,uiLocale:'ja'});
});
test('missing or hostile owners and write shapes never reach the network',async()=>{
 let calls=0;const transport=make({request:async()=>{calls++;return Response.json(empty);}});
 for(const owner of [null,undefined,'','bad\nowner','x'.repeat(513),{}])await assert.rejects(transport.read(owner),error=>error.status===401);
 for(const value of [null,{},[],{baseRevision:0,uiLocale:'ja',owner:'B'},{baseRevision:-1,uiLocale:'en'},{baseRevision:0,uiLocale:'fr'}])await assert.rejects(transport.write('A',value),error=>error.status===400);
 assert.equal(calls,0);
});
test('HTTP conflict and network failure remain failures without leaking response text',async()=>{
 const transport=make({request:async()=>new Response('PRIVATE RESPONSE',{status:409})});
 await assert.rejects(transport.write('A',{baseRevision:0,uiLocale:'ja'}),error=>error.status===409&&!error.message.includes('PRIVATE'));
 const failed=make({request:async()=>{throw Error('PRIVATE KEY');}});
 await assert.rejects(failed.read('A'),error=>error.status===0&&!error.message.includes('PRIVATE'));
});
test('a changed session is rejected before JSON and invokes only the safe lifecycle callback',async()=>{
 let changed=0,json=0;const transport=make({onSessionChanged:owner=>{assert.equal(owner,'A');changed++;},request:async()=>({ok:true,status:200,headers:new Headers({'X-Reader-Session-Changed':'1'}),json:async()=>{json++;return empty;}})});
 await assert.rejects(transport.read('A'),error=>error.status===401);assert.equal(changed,1);assert.equal(json,0);
});
test('the same request deadline bounds both fetch and body decoding even if the transport ignores abort',async()=>{
 for(const request of [()=>new Promise(()=>{}),async()=>({ok:true,status:200,headers:new Headers(),json:()=>new Promise(()=>{})})]){
  const transport=make({request,timeoutMs:12});const started=Date.now();await assert.rejects(transport.read('A'),error=>error.status===0);assert.ok(Date.now()-started<1000);
 }
});
