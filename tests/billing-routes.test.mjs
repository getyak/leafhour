import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createBillingRoutes,readWebhookBytes} from '../server/billing-routes.mjs';

function fixture(user={id:'account-a',email:'reader@example.test',kind:'email',emailVerified:true}){
 const calls=[];
 const billing=new Proxy({enabled:true},{get(target,key){return key in target?target[key]:async input=>{calls.push([key,input]);return key==='catalog'?{enabled:true,mode:'test',available:false,products:[]}:{ok:true};};}});
 const routes=createBillingRoutes({billing,publicOrigin:'https://reader.example.test'});
 const run=async(path,{method='GET',body=null,headers={},as=user}={})=>{
  let result;const req={method,headers:{origin:'https://reader.example.test',...headers}},res={setHeader(){}};
  const handled=await routes.handle({req,res,url:new URL(path,'https://reader.example.test'),user:as,body,send:(status,data)=>{result={status,data};}});
  return {handled,...result};
 };
 return {calls,run};
}
test('catalog stays public and private billing rejects anonymous callers',async()=>{
 const f=fixture();assert.equal((await f.run('/api/billing/catalog',{as:null})).status,200);
 await assert.rejects(f.run('/api/billing/account',{as:null}),{status:401});
 assert.equal(f.calls.length,1);
});
test('billing mutations require matching owner and exact browser origin',async()=>{
 const f=fixture();
 await assert.rejects(f.run('/api/billing/checkouts',{method:'POST',body:{productKey:'reading_monthly_100',intentKey:'intent-a'}}),{status:409});
 await assert.rejects(f.run('/api/billing/checkouts',{method:'POST',body:{productKey:'reading_monthly_100',intentKey:'intent-a'},headers:{'x-reader-owner':'account-b'}}),{status:409});
 await assert.rejects(f.run('/api/billing/checkouts',{method:'POST',body:{productKey:'reading_monthly_100',intentKey:'intent-a'},headers:{'x-reader-owner':'account-a',origin:'https://foreign.example'}}),{status:403});
 assert.deepEqual(f.calls,[]);
});
test('checkout binds trusted account and rejects unexpected pricing or owner fields',async()=>{
 const f=fixture(),opts={method:'POST',headers:{'x-reader-owner':'account-a'},body:{productKey:'reading_monthly_100',intentKey:'intent-a'}};
 assert.equal((await f.run('/api/billing/checkouts',opts)).status,201);
 assert.deepEqual(f.calls[0],['checkout',{ownerId:'account-a',productKey:'reading_monthly_100',intentKey:'intent-a'}]);
 await assert.rejects(f.run('/api/billing/checkouts',{...opts,body:{...opts.body,ownerId:'account-b',amount:1}}),{status:400});
});
test('trial grants are explicit and require verified server identity',async()=>{
 const f=fixture();await f.run('/api/billing/account');assert.equal(f.calls[0][0],'account');
 await assert.rejects(f.run('/api/billing/trial',{method:'POST',headers:{'x-reader-owner':'account-a'},body:{},as:{id:'account-a',kind:'local'}}),{status:403});
 await f.run('/api/billing/trial',{method:'POST',headers:{'x-reader-owner':'account-a'},body:{}});
 assert.deepEqual(f.calls.at(-1),['trial',{ownerId:'account-a',verified:true}]);
});
test('raw webhook keeps exact whitespace bytes and rejects pre-parsed JSON',async()=>{
 const source=Buffer.from('{ "text": "中文", "n": 1 }\n');
 const req=Readable.from([source.subarray(0,5),source.subarray(5)]);req.headers={};
 assert.deepEqual(await readWebhookBytes(req),source);
 await assert.rejects(readWebhookBytes({body:{n:1},headers:{}}),{status:415});
 const huge=Readable.from([Buffer.alloc(256*1024+1)]);huge.headers={};
 await assert.rejects(readWebhookBytes(huge),{status:413});
});
test('private queries reject wrong methods, foreign owner header and unbounded pagination',async()=>{
 const f=fixture();
 await assert.rejects(f.run('/api/billing/account',{headers:{'x-reader-owner':'account-b'}}),{status:409});
 await assert.rejects(f.run('/api/billing/entries?limit=10000'),{status:400});
 await assert.rejects(f.run('/api/billing/catalog',{method:'POST',headers:{'x-reader-owner':'account-a'},body:{}}),{status:405});
 assert.equal((await f.run('/unrelated')).handled,false);
});


test('HTTP retry hints expose only confirmed terminal operation references',async()=>{
 const {billingErrorDetails}=await import('../server/billing-routes.mjs');const id='credit-'+'a'.repeat(64);
 assert.deepEqual(billingErrorDetails({billingOperation:{id,status:'released',reservationToken:'private',scope:{text:'private'}}}),{billingOperation:{id,status:'released'}});
 assert.deepEqual(billingErrorDetails({billingOperation:{id,status:'not_started'}}),{billingOperation:{id,status:'not_started'}});
 for(const op of [{id,status:'running'},{id:'foreign',status:'released'},{id,status:'settled'},null])assert.deepEqual(billingErrorDetails({billingOperation:op}),{});
});
