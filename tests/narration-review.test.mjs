import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePassage,parseChapter} from '../server/narration-parser.mjs';
import {createNarrationService} from '../server/narration-service.mjs';
import {createQwenProvider,createMiniMaxProvider,createElevenLabsProvider} from '../server/narration-providers.mjs';

test('parser preserves all source characters including tags, apostrophes and curly quotes',()=>{
 for(const [language,text] of [['en',`Before, "Don't go," she said quietly. After.`],['zh','她低声说：“别走。” 随后离开。'],['en',`It's John's book.`]]){
  const parts=parsePassage({id:'p',original:text,translations:{interpretive:{text}}},language);
  assert.equal(parts.map(p=>p.text).join(''),text);
  assert.equal(parts.map(p=>text.slice(p.start,p.end)).join(''),text);
 }
});
test('chapter parsing includes all sections of one chapter',()=>{
 const sections=[1,2].map(i=>({chapterId:'c',paragraphs:[{id:'p'+i,original:'Part '+i}]}));
 assert.equal(parseChapter({sections},'c','en').length,2);
});
test('oversized turns split without losing Unicode or exceeding limits',()=>{
 const service=createNarrationService({env:{}}),text='😀'.repeat(1300);
 const scenes=service.groupIntoScenes([{text,voice:{id:'v'}}],2000);
 assert.equal(scenes.flat().map(s=>s.text).join(''),text);
 assert.ok(scenes.every(s=>s.reduce((n,p)=>n+p.text.length,0)<=2000));
 assert.ok(scenes.flat().every(s=>!/[\uD800-\uDBFF]$/.test(s.text)));
});
test('cache distinguishes source text, voice, zero index, and chapter',()=>{
 const s=createNarrationService({env:{}}),b={id:'b',model:'m'},clip={segmentIndex:0,text:'one',voice:{id:'v'},chapterId:'c'};
 const key=s.generateCacheKey('u','book',clip,b);
 for(const change of [{text:'two'},{voice:{id:'v2'}},{chapterId:'d'},{segmentIndex:1}])assert.notEqual(s.generateCacheKey('u','book',{...clip,...change},b),key);
});
test('Qwen sends documented input and reads WAV from output.audio.url',async()=>{
 const calls=[];
 const p=createQwenProvider({env:{DASHSCOPE_API_KEY:'test'},fetcher:async(url,options)=>{
  calls.push({url,options});return calls.length===1?Response.json({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}):new Response(Buffer.from('RIFF-test'));
 }});
 const r=await p.synthesizeTurn({text:'你好',voiceId:'Cherry'});
 assert.match(calls[0].url,/multimodal-generation\/generation$/);
 assert.equal(JSON.parse(calls[0].options.body).input.voice,'Cherry');assert.equal(r.mimeType,'audio/wav');
});
test('MiniMax sends nested voice_setting and decodes hex',async()=>{
 let body;
 const p=createMiniMaxProvider({env:{MINIMAX_API_KEY:'test'},fetcher:async(url,options)=>{
  assert.equal(url,'https://api.minimax.io/v1/t2a_v2');body=JSON.parse(options.body);return Response.json({base_resp:{status_code:0},data:{audio:'494433'}});
 }});
 const r=await p.synthesizeTurn({text:'你好',voiceId:'male-qn-qingse'});
 assert.equal(body.voice_setting.voice_id,'male-qn-qingse');assert.equal(r.bytes.toString(),'ID3');
});
test('ElevenLabs uses supported model and does not invent audio_tag fields',async()=>{
 const p=createElevenLabsProvider({env:{ELEVENLABS_API_KEY:'test'},fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.model_id,'eleven_v3');assert.equal(body.inputs[0].audio_tag,undefined);return new Response(Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]));
 }});
 await p.synthesizeScene({turns:[{text:'Hello',voiceId:'v',audioTag:'whispering'}]});
});
test('generated split scenes have separate cache identities',async()=>{
 const stored=new Map();
 const s=createNarrationService({env:{ELEVENLABS_API_KEY:'test'},store:{putClip:async(k,b)=>stored.set(k,b)},getBook:async()=>({bookId:'b',contentVersion:'v'}),fetcher:async()=>new Response(Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]))});
 const clips=await s.generateNarration('u','b',[{text:'a'.repeat(4500),voice:{id:'v'},passageId:'p'}],{bookId:'b',contentVersion:'v',provider:'elevenlabs',model:'eleven_v3',id:'bible'});
 assert.equal(clips.length,3);assert.equal(stored.size,3);assert.equal(new Set(clips.map(c=>c.id)).size,3);
});
test('split turns preserve real UTF-16 source ranges',()=>{
 const s=createNarrationService({env:{}}),text='A😀BC😀D';
 const scenes=s.groupIntoScenes([{text,start:40,end:50}],4).flat();
 let at=40;
 for(const piece of scenes){assert.equal(piece.start,at);assert.equal(piece.end-piece.start,piece.text.length);assert.equal(text.slice(piece.start-40,piece.end-40),piece.text);at=piece.end;}
 assert.equal(at,40+text.length);
});
test('Qwen orchestration bounds WAV turns before sending to provider',async()=>{
 const texts=[];
 const s=createNarrationService({env:{QWEN_API_KEY:'test'},store:{putClip:async()=>{}},getBook:async()=>({bookId:'b',contentVersion:'v'}),fetcher:async(url,options)=>{
  if(options?.method==='POST'){texts.push(JSON.parse(options.body).input.text);return Response.json({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}});}
  return new Response('RIFF-test');
 }});
 await s.generateNarration('u','b',[{text:'中'.repeat(600),voice:{id:'Cherry'}}],{bookId:'b',contentVersion:'v',provider:'qwen',model:'qwen3-tts-flash',id:'bible'});
 assert.equal(texts.length,5);assert.ok(texts.every(t=>t.length<=120));assert.equal(texts.join(''),'中'.repeat(600));
});
