import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createCoverGenerator,coverPrompt,DEFAULT_COVER_MODEL} from '../server/generated-cover.mjs';

const image=()=>{const canvas=createCanvas(400,600);canvas.getContext('2d').fillRect(0,0,400,600);return canvas.toBuffer('image/png');};
test('cover prompt follows the series without leaking source text or inventing authors',()=>{
 const prompt=coverPrompt({title:{zh:'剑来'},author:'',sections:[{paragraphs:[{original:'PRIVATE BODY'}]}]});
 assert.match(prompt,/剑来/);assert.match(prompt,/版画/);assert.ok(prompt.length<500);assert.doesNotMatch(prompt,/PRIVATE BODY|35%|烽火戏诸侯/);
});
test('configured Ark adapter requests one cover and normalizes its pixels',async()=>{
 let request;
 const generate=createCoverGenerator({ARK_API_KEY:'test-secret'},{fetchImpl:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return Response.json({data:[{b64_json:image().toString('base64')}]});}});
 const result=await generate({title:{zh:'剑来'},author:''}),decoded=await loadImage(result.bytes);
 assert.equal(request.url,'https://ark.cn-beijing.volces.com/api/v3/images/generations');assert.equal(request.body.model,DEFAULT_COVER_MODEL);
 assert.equal(request.body.response_format,'b64_json');assert.equal(request.body.size,'2K');assert.equal(request.body.stream,false);
 assert.equal(decoded.width,400);assert.equal(decoded.height,600);assert.equal(result.model,DEFAULT_COVER_MODEL);assert.match(result.prompt,/剑来/);
 const canvas=createCanvas(400,600),ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0);const top=ctx.getImageData(1,1,1,1).data;assert.ok(top[0]>180&&top[1]>180,'native typography gets a light paper ground even without host fonts');
});
test('absent credentials disable generation and provider errors never leak credentials or signed URLs',async()=>{
 assert.equal(createCoverGenerator({}),null);
 const generate=createCoverGenerator({ARK_API_KEY:'test-secret'},{fetchImpl:async()=>Response.json({error:{message:'test-secret https://private?token=secret'}},{status:403})});
 await assert.rejects(generate({title:{en:'Book'}}),error=>error.status===502&&!/test-secret|token=/.test(error.message));
});
test('only a definitive provider rejection permits another paid attempt',async()=>{
 const rejected=createCoverGenerator({ARK_API_KEY:'test-secret'},{fetchImpl:async()=>new Response(null,{status:429})});
 await assert.rejects(rejected({title:{en:'Book'}}),error=>error.coverGenerationStatus==='rejected');
 const lost=createCoverGenerator({ARK_API_KEY:'test-secret'},{fetchImpl:async()=>{throw Error('response lost');}});
 await assert.rejects(lost({title:{en:'Book'}}),error=>error.coverGenerationStatus==='uncertain');
});
test('URL-only or malformed provider images are not fetched or cached',async()=>{
 for(const data of [{url:'http://127.0.0.1/private'},{b64_json:Buffer.from('<svg/>').toString('base64')}]){
  const generate=createCoverGenerator({ARK_API_KEY:'test-secret'},{fetchImpl:async()=>Response.json({data:[data]})});
  await assert.rejects(generate({title:{en:'Book'}}));
 }
});
