import test from 'node:test';import assert from 'node:assert/strict';
import {prepareReading,validateDialogue,clipCacheKey} from '../server/audio-content.mjs';
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
