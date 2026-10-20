import test from 'node:test';import assert from 'node:assert/strict';
import {createSpeechProvider} from '../server/audio-provider.mjs';import {createDialogueGenerator} from '../server/dialogue-generator.mjs';
import {pcmWav,geminiSpeechResponse} from './audio-fixture.mjs';
const env={GEMINI_API_KEY:'google-speech-secret',DEEPSEEK_API_KEY:'text-secret',OPENROUTER_API_KEY:'old-router-secret'},turns=[{text:'这一句。',voice:'Sulafat',instructions:'平静自然'}];
test('speech uses Google official authentication and verbatim metadata, returning playable WAV',async()=>{
 let payload;const bytes=pcmWav(),provider=createSpeechProvider({env:{...env,READER_SPEECH_MODEL:'google/gemini-3.8-flash-tts'},fetcher:async(url,o)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(o.headers['x-goog-api-key'],env.GEMINI_API_KEY);assert.equal(o.headers.Authorization,undefined);assert.equal(o.redirect,'error');payload=JSON.parse(o.body);return Response.json(geminiSpeechResponse(bytes));
 }});
 const result=await provider.synthesize({turns});assert.equal(provider.available,true);assert.equal(result.mimeType,'audio/wav');assert.deepEqual(result.bytes,bytes);assert.equal(result.generationId,'gemini-generation');assert.equal(payload.model,'gemini-3.8-flash-tts');assert.equal(payload.store,false);assert.equal(payload.response_format.mime_type,'audio/wav');assert.ok(payload.generation_config.max_output_tokens<=2000);
 assert.deepEqual(payload.input[0].content,[{type:'text',text:'这一句。',annotations:[{type:'speech_metadata',style:'平静自然'}]}]);assert.deepEqual(payload.generation_config.speech_config,[{voice:'Sulafat'}]);assert.doesNotMatch(JSON.stringify(payload),/secret/);
});
test('two voices retain speaker attribution and exact text without spoken speaker prefixes',async()=>{
 let payload;const provider=createSpeechProvider({env,fetcher:async(_,o)=>{payload=JSON.parse(o.body);return Response.json(geminiSpeechResponse());}});
 const rows=[{text:'First.',voice:'Charon'},{text:'Why?',voice:'Puck'},{text:'Again.',voice:'Charon'}];await provider.synthesize({turns:rows});
 const speakers=payload.generation_config.speech_config.speakers;assert.deepEqual(speakers.map(s=>s.voice),['Charon','Puck']);const content=payload.input[0].content;assert.deepEqual(content.map(c=>c.text),rows.map(t=>t.text));assert.deepEqual(content.map(c=>c.annotations[0].speaker),[speakers[0].speaker,speakers[1].speaker,speakers[0].speaker]);
});
test('a legacy OpenRouter key alone cannot enable or receive official speech requests',async()=>{
 let calls=0;const provider=createSpeechProvider({env:{OPENROUTER_API_KEY:'old-router-secret'},fetcher:async()=>{calls++;throw Error('must not call');}});assert.equal(provider.available,false);await assert.rejects(provider.synthesize({turns}),{status:503,code:'not_configured'});assert.equal(calls,0);
});
test('malformed, incomplete or incorrectly encoded official output never becomes playable audio',async()=>{
 const damaged=pcmWav();damaged.writeUInt32LE(999999,40);
 const responses=[{},geminiSpeechResponse(Buffer.from('{}')),geminiSpeechResponse(damaged),geminiSpeechResponse(pcmWav(),{status:'incomplete'}),{status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:'%%%='}]}]},geminiSpeechResponse(pcmWav(),{steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/mpeg',data:pcmWav().toString('base64')}]}]})];
 for(const data of responses)await assert.rejects(createSpeechProvider({env,fetcher:async()=>Response.json(data)}).synthesize({turns}),{code:'invalid_audio'});
});
test('Google key and quota failures are actionable, never retried and never disclose provider bodies',async()=>{
 for(const status of [400,401,403,402,429,500]){let calls=0;const provider=createSpeechProvider({env,fetcher:async()=>{calls++;return Response.json({error:{message:'google-speech-secret'}},{status});}});await assert.rejects(provider.synthesize({turns}),error=>!error.message.includes('secret')&&(status!==429||error.code==='rate_limited')&&(status!==403||/Gemini.*Key/.test(error.message)));assert.equal(calls,1);}
});
test('cancelled, oversized and invalid speech cannot publish audio or start extra requests',async()=>{
 const c=new AbortController();c.abort();let calls=0;await assert.rejects(createSpeechProvider({env,fetcher:async()=>{calls++;}}).synthesize({turns,signal:c.signal}));assert.equal(calls,0);
 const late=new AbortController();await assert.rejects(createSpeechProvider({env,fetcher:async()=>{late.abort();return Response.json(geminiSpeechResponse());}}).synthesize({turns,signal:late.signal}));
 await assert.rejects(createSpeechProvider({env,fetcher:async()=>new Response('x'.repeat(5500001),{headers:{'content-type':'application/json'}})}).synthesize({turns}),{code:'invalid_audio'});
 await assert.rejects(createSpeechProvider({env,fetcher:async()=>Response.json(geminiSpeechResponse(pcmWav(2000001)))}).synthesize({turns}),{code:'invalid_audio'});
 for(const rows of [[{text:'',voice:'Sulafat'}],[{text:'x'.repeat(4001),voice:'Sulafat'}],[{text:'Read',voice:'unknown'}],[{text:'a',voice:'Sulafat'},{text:'b',voice:'Puck'},{text:'c',voice:'Kore'}]])await assert.rejects(createSpeechProvider({env,fetcher:async()=>{throw Error('must not call');}}).synthesize({turns:rows}),{code:'invalid_audio_request'});
});
test('dialogue generator uses DeepSeek with bounded source JSON and propagates cancellation',async()=>{let payload;const generate=createDialogueGenerator({env,fetcher:async(url,o)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');payload=JSON.parse(o.body);return Response.json({choices:[{message:{content:JSON.stringify({turns:[]})}}]});}});assert.deepEqual(await generate({bookId:'b',contentVersion:'v',passages:[{id:'p',original:'Read.'}]}),{turns:[]});assert.equal(payload.model,'deepseek-flash');assert.deepEqual(payload.thinking,{type:'disabled'});assert.ok(payload.max_tokens<=5000);assert.match(payload.messages[1].content,/Read/);});

test('a longer valid WAV response stays within bounds and decodes without a parser stack failure',async()=>{
 const bytes=pcmWav(96000),provider=createSpeechProvider({env,fetcher:async()=>Response.json(geminiSpeechResponse(bytes))});assert.deepEqual((await provider.synthesize({turns})).bytes,bytes);
});
