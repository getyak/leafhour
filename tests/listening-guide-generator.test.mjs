import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuideGenerator} from '../server/listening-guide-generator.mjs';
const response=value=>Response.json({choices:[{message:{content:JSON.stringify(value)}}]});
const input={stage:'outline',bookId:'book',contentVersion:'v1',intent:'intro',batchIndex:0,passages:[{id:'p1',chapterId:'ch1',original:'Read this.',privateNotes:'PRIVATE NOTE',translations:{literal:{text:'PRIVATE TRANSLATION'}}}]};

test('one bounded stage sends only whitelisted source fields to the configured text provider',async()=>{
 let sent;const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async(url,options)=>{sent={url,options};return response({summary:'开头',passageIds:['p1'],claims:[]});}});
 assert.equal((await generate(input)).summary,'开头');
 assert.equal(sent.url,'https://api.deepseek.com/chat/completions');
 const body=JSON.parse(sent.options.body),data=JSON.parse(body.messages[1].content);
 assert.deepEqual(data.passages,[{id:'p1',chapterId:'ch1',original:'Read this.'}]);
 assert.ok(!sent.options.body.includes('PRIVATE'));assert.equal(sent.options.redirect,'error');
});

test('oversized input and unknown stages fail before any provider submission',async()=>{
 let calls=0;const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>{calls++;return response({});}});
 await assert.rejects(generate({...input,passages:[{...input.passages[0],original:'x'.repeat(18001)}]}),{status:413});
 await assert.rejects(generate({...input,stage:'anything'}),{status:400});assert.equal(calls,0);
 assert.equal(createGuideGenerator({env:{}}),null);
});

test('failed and ambiguous provider stages never retry and cancelled stages forward cancellation',async()=>{
 let calls=0,signal;const controller=new AbortController(),generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async(_url,options)=>{calls++;signal=options.signal;return new Response('',{status:429});}});
 await assert.rejects(generate({...input,signal:controller.signal}),{code:'guide_unavailable'});assert.equal(calls,1);
 controller.abort();assert.equal(signal.aborted,true);
 await assert.rejects(generate({...input,signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});

test('script and support verification carry structured claim evidence without private book metadata',async()=>{
 const sent=[],generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async(_url,options)=>{sent.push(JSON.parse(options.body));return response({turns:[]});}});
 await generate({stage:'script',bookId:'b',contentVersion:'v1',intent:'book',outlines:[{summary:'Whole source',passageIds:['p1'],claims:[{text:'Read carefully.',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}]}],privateNotes:'PRIVATE'}]});
 await generate({stage:'verify',bookId:'b',contentVersion:'v1',intent:'book',passages:input.passages,turns:[{id:'turn-1',speaker:'guide',text:'仔细读。',kind:'explanation',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'Read'}],secret:'PRIVATE'}]});
 assert.ok(sent.every(x=>!JSON.stringify(x).includes('PRIVATE')));
 assert.equal(JSON.parse(sent[1].messages[1].content).turns[0].id,'turn-1');
 assert.match(sent[1].messages[0].content,/supported/);
});
