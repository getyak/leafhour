import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCreemWebhookHandler} from '../api/creem-webhook.js';
test('Creem webhook reaches its raw-body handler before the general API rewrite',async()=>{
 const {rewrites}=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const webhook=rewrites.findIndex(route=>route.source==='/api/webhooks/creem');
 const general=rewrites.findIndex(route=>route.source==='/api/:path*');
 assert.ok(webhook>=0&&general>=0,'both hosted API routes must exist');
 assert.equal(rewrites[webhook].destination,'/api/creem-webhook');
 assert.ok(webhook<general,'the first matching rewrite must preserve the signed webhook bytes');
});
test('hosted webhook keeps original bytes and never requires a browser session or Origin',async()=>{
 const raw='{  "id" : "synthetic", "utf8":"书" }\n',seen=[];
 const handler=createCreemWebhookHandler({serviceFactory:async()=>({webhook:async facts=>{seen.push(facts);return {received:true};}})});
 const response=await handler.fetch(new Request('https://reader.example/api/webhooks/creem',{method:'POST',headers:{'content-type':'application/json','creem-signature':'signature'},body:raw}));
 assert.equal(response.status,200);assert.deepEqual(seen[0].rawBody,Buffer.from(raw));assert.equal(seen[0].signature,'signature');
});
test('hosted webhook caps payload and handles method or service failures without leaking details',async()=>{
 let calls=0;const handler=createCreemWebhookHandler({serviceFactory:async()=>({webhook:async()=>{calls++;throw Error('private detail');}})});
 assert.equal((await handler.fetch(new Request('https://reader.example/api/webhooks/creem'))).status,405);
 assert.equal((await handler.fetch(new Request('https://reader.example/api/webhooks/creem',{method:'POST',body:'x'.repeat(262145)}))).status,413);assert.equal(calls,0);
 const failed=await handler.fetch(new Request('https://reader.example/api/webhooks/creem',{method:'POST',body:'{}'}));assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private detail/);
});
