import test from 'node:test';import assert from 'node:assert/strict';
import {prepareReading,validateDialogue,clipCacheKey,chunkAudio} from '../server/audio-content.mjs';
import {mediaConfiguration} from '../server/media-config.mjs';
import {audioBook,audioSelection as selection} from './audio-fixture.mjs';
test('audio selections retain exact source ranges, independent translations and Unicode boundaries',()=>{
 const book=audioBook();assert.equal(prepareReading(book,selection).clips[0].text,'Read');
 for(const change of [{contentVersion:'old'},{chapterId:'ch2'},{parts:[{...selection.parts[0],text:'Fake'}]},{parts:[{passageId:'p1',start:6,end:8,language:'en'}]}])assert.throws(()=>prepareReading(book,{...selection,...change}));
 assert.throws(()=>prepareReading(book,{...selection,language:'zh',parts:[{passageId:'p2',language:'zh'}]}),/译文/);
 assert.equal(prepareReading(book,{...selection,language:'zh',variant:'literal',parts:[{passageId:'p1',language:'zh'}]}).clips[0].text,'仔细读😀这一句。');
 assert.throws(()=>prepareReading(book,{...selection,parts:[selection.parts[0],selection.parts[0]]}));
 assert.throws(()=>prepareReading(book,{...selection,parts:[{passageId:'p2'},{passageId:'p1'}]}));
});
test('changed translation invalidates cache even when the book version stays fixed',()=>{const book=audioBook(),input={...selection,language:'zh',parts:[{passageId:'p1',language:'zh'}]};const a=prepareReading(book,input).clips[0];book.sections[0].paragraphs[0].translations.interpretive.text='新的译文。';const b=prepareReading(book,input).clips[0];assert.notEqual(clipCacheKey('owner',a,'Sulafat','model',''),clipCacheKey('owner',b,'Sulafat','model',''));assert.notEqual(clipCacheKey('a',a,'Sulafat','model',''),clipCacheKey('b',a,'Sulafat','model',''));});
test('dialogue refuses unknown citations, oversized context and oversized output',()=>{const book=audioBook(),scope={chapterId:'ch1',passageIds:['p1','p2']},candidate={turns:[{speaker:'guide',text:'认真读。',sourceRefs:[{passageId:'p1',quote:'Read'}]}]};assert.equal(validateDialogue(book,scope,candidate).turns.length,1);assert.throws(()=>validateDialogue(book,scope,{turns:[{...candidate.turns[0],sourceRefs:[{passageId:'p3',quote:'Another'}]}]}));assert.throws(()=>validateDialogue(book,scope,{turns:Array(25).fill(candidate.turns[0])}));book.sections[0].paragraphs[0].original='x'.repeat(30001);assert.throws(()=>validateDialogue(book,scope,candidate),/范围/);});
test('public model settings never reveal credentials',()=>{const config=mediaConfiguration({GEMINI_API_KEY:'private-test-key',DEEPSEEK_API_KEY:'secret-text-key'});assert.equal(config.public.speechModel,'gemini-3.8-flash-tts');assert.equal(config.public.imageModel,'google/gemini-nano-banana-2.1');assert.ok(!JSON.stringify(config.public).includes('key'));});

test('short WAV clips keep English words together and preserve trailing whitespace without empty speech',()=>{
 for(const text of ['A careful sentence. '.repeat(10)+' ','A careful reader follows every word through a longer sentence. '.repeat(10)]){
  const prepared=chunkAudio({clips:[{text,start:37,end:37+text.length,sourceHash:'source'}]});assert.equal(prepared.clips.map(c=>c.text).join(''),text);
  for(const clip of prepared.clips){assert.ok(clip.text.trim());assert.ok(clip.text.length<=200);assert.equal(text.slice(clip.start-37,clip.end-37),clip.text);const at=clip.end-37;if(at<text.length)assert.ok(!(/[A-Za-z]/.test(text[at-1])&&/[A-Za-z]/.test(text[at])));}
 }
});
test('chapter narration prepares exact bounded clips and a continuation without losing source characters',async()=>{
 const {prepareNarrationBatch}=await import('../server/audio-content.mjs');const book={bookId:'batch',contentVersion:'v',chapters:[{id:'c'}],sections:[{chapterId:'c',paragraphs:[{id:'p',original:'A complete sentence. '.repeat(500)},{id:'q',original:'Last source.'}]}]};
 let input={contentVersion:'v',chapterId:'c',language:'en',from:{passageId:'p',start:0}},text='',count=0;
 do{const result=prepareNarrationBatch(book,input);assert.ok(result.clips.length>0&&result.clips.length<=10);assert.ok(chunkAudio(prepareReading(book,result.input,{chunkingVersion:2}),2).clips.length<=10);text+=result.clips.map(c=>c.text).join('');count++;input=result.continuation?{...input,from:result.continuation}:null;}while(input&&count<30);
 assert.equal(input,null);assert.equal(text,book.sections[0].paragraphs.map(p=>p.original).join(''));
 const tiny={...book,sections:[{chapterId:'c',paragraphs:Array.from({length:50},(_,i)=>({id:'p'+i,original:'Tiny.'}))}]};assert.equal(prepareNarrationBatch(tiny,{contentVersion:'v',chapterId:'c',from:{passageId:'p0',start:0}}).clips.length,10);
 assert.throws(()=>prepareNarrationBatch(book,{contentVersion:'v',chapterId:'c',language:'zh',from:{passageId:'p',start:0}}),{code:'missing_translation'});
});
