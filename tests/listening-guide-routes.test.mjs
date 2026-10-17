import test from 'node:test';import assert from 'node:assert/strict';import {createAudioRoutes} from '../server/audio-routes.mjs';
function fixture(){const calls=[],guides=Object.fromEntries(['prepare','create','get','cancel'].map(method=>[method,async(...args)=>{calls.push({method,args});return{id:'job',status:'preparing'};}])),routes=createAudioRoutes({audio:{store:{}},library:{getBook:async()=>({bookId:'b'})},guides});let sent;return{calls,async call(action,method='POST',user={id:'u'}){const handled=await routes.handle({req:{method,url:'/audio/'+action},res:{},user,bookId:'b',action,body:{intent:'intro'},send:(status,body)=>sent={status,body}});return{handled,...sent};}};}
test('guide routes use the authenticated owner for prepare, creation, polling and cancellation',async()=>{
 const f=fixture();assert.equal((await f.call('guides/prepare')).status,200);assert.equal((await f.call('guides')).status,202);assert.equal((await f.call('guides/job','GET')).status,200);assert.equal((await f.call('guides/job/cancel')).status,200);
 assert.deepEqual(f.calls.map(c=>c.method),['prepare','create','get','cancel']);assert.ok(f.calls.every(c=>c.args[0].id==='u'&&c.args[1]==='b'));
});
test('anonymous guide preparation never reaches generation',async()=>{const f=fixture();await assert.rejects(f.call('guides/prepare','POST',null),{status:401});assert.equal(f.calls.length,0);});
test('bounded chapter narration is an authenticated read-only preview with exact next offsets',async()=>{
 const book={bookId:'b',contentVersion:'v',chapters:[{id:'c'}],sections:[{chapterId:'c',paragraphs:[{id:'p',original:'A sentence. '.repeat(500)}]}]},routes=createAudioRoutes({audio:{store:{},capabilities:()=>({speechModel:'gemini-3.8-flash-tts'})},library:{getBook:async()=>book}});let response;
 const request={req:{method:'POST'},res:{},user:{id:'u'},bookId:'b',action:'prepare/narration',body:{contentVersion:'v',chapterId:'c',from:{passageId:'p',start:0}},send:(status,body)=>response={status,body}};
 assert.equal(await routes.handle(request),true);assert.equal(response.status,200);assert.equal(response.body.clips.length,10);assert.equal(response.body.continuation.start,response.body.input.parts.at(-1).end);assert.ok(response.body.estimate);await assert.rejects(routes.handle({...request,user:null}),{status:401});
});
