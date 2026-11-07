import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const {createMirrorServer,transportRejection}=await import('../tools/get273-mirror-adapter.mjs');

test('transport classification returns only the first fixed refusal category',()=>{
 const origin='http://127.0.0.1:12345',host='127.0.0.1:12345';
 const rows=[
  {remote:'::1',headers:{host:'wrong',origin:'null','sec-fetch-site':'cross-site'},want:'remote-address'},
  {remote:'127.0.0.1',headers:{host:'wrong',origin:'null','sec-fetch-site':'cross-site'},want:'host'},
  {remote:'127.0.0.1',headers:{host,origin:'null','sec-fetch-site':'cross-site'},want:'origin'},
  {remote:'127.0.0.1',headers:{host,'sec-fetch-site':'cross-site'},want:'fetch-site'},
  {remote:'127.0.0.1',headers:{host,origin,'sec-fetch-site':'same-origin'},want:null},
  {remote:'127.0.0.1',headers:{host,'sec-fetch-site':'none'},want:null},
 ];
 for(const row of rows)assert.equal(transportRejection({socket:{remoteAddress:row.remote},headers:row.headers},origin),row.want);
});

test('real HTTP browser-header combinations preserve every original gate and export counters only',async()=>{
 let captures=0,touches=0;
 const mirror=createMirrorServer({frame:async()=>{captures++;return Buffer.from('jpeg');},touch:async()=>{touches++;},abort:()=>{}}),origin=await mirror.listen();
 const marker='SYNTHETIC_PRIVATE_CANARY';
 const request=(path,headers={})=>new Promise((resolve,reject)=>{
  http.get(origin+path,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);
 });
 try{
  const rows=[
   {path:'/',headers:{'Sec-Fetch-Site':'none','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'},want:200},
   {path:'/',headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'},want:403},
   {path:'/',headers:{Origin:'https://example.invalid','Sec-Fetch-Site':'cross-site'},want:403},
   {path:'/',headers:{Host:'wrong.invalid',Origin:'null','Sec-Fetch-Site':'cross-site'},want:403},
   {path:'/',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'same-origin','Sec-Fetch-Dest':'empty'},want:200},
   {path:'/frame.jpg',headers:{'Sec-Fetch-Site':'same-site','Sec-Fetch-Mode':'no-cors','Sec-Fetch-Dest':'image',Cookie:marker},want:403},
   {path:'/',headers:{Origin:'null','Sec-Fetch-Site':'none'},want:403},
   {path:'/?private='+marker,headers:{Host:'wrong.invalid',Cookie:marker,Authorization:marker,'X-QA-CSRF':marker},want:403},
  ];
  for(const row of rows)assert.equal(await request(row.path,row.headers),row.want);
  const counts=mirror.transportRejections();
  assert.deepEqual(counts,{'remote-address':0,host:2,origin:2,'fetch-site':1});
  assert.equal(captures,0);assert.equal(touches,0);
  const bytes=JSON.stringify(counts);for(const forbidden of [marker,origin,'Cookie','Authorization','csrf','query','headers','url'])assert(!bytes.includes(forbidden));
  counts.host=999;assert.equal(mirror.transportRejections().host,2);
 }finally{await mirror.close();}
});

test('transport-only probe is visibly synthetic without changing the transport or capability gate',async()=>{
 const mirror=createMirrorServer({frame:async()=>Buffer.from('fixed synthetic image'),touch:async()=>{throw Error('disabled');},abort:()=>{}},{syntheticTransport:true});
 const origin=await mirror.listen();
 try{
  const page=await(await fetch(origin)).text();assert(page.includes('SYNTHETIC TRANSPORT ONLY'));assert(page.includes('no device'));
  assert(!page.includes('actual Primary'));assert(!page.includes('actual capture'));
  assert.equal((await fetch(origin+'/frame.jpg')).status,403);
  assert.equal((await fetch(origin,{headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal(mirror.transportRejections().origin,1);
 }finally{await mirror.close();}
});
