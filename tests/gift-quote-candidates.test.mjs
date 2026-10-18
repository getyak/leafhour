import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekGiftQuoteGenerator,createGiftQuoteService,codePointLength} from '../server/gift-quote.mjs';

const entry=(text,passageId='p1',chapterId='ch1')=>({text,passageId,chapterId});
const reply=content=>Response.json({choices:[{message:{content:JSON.stringify(content)}}]});
const job=pool=>({bookId:'candidate-book',contentVersion:'candidate-edition',pool});
const bookFor=pool=>({bookId:'candidate-book',contentVersion:'candidate-edition',chapters:[{id:'ch1',kind:'body',title:{en:'Opening'}}],sections:[{chapterId:'ch1',paragraphs:pool.map(p=>({id:p.passageId,original:p.text}))}]});

test('the built-in provider chooses an ID while the server owns Unicode offsets and source identity',async()=>{
 const original='A quiet page😀 begins here. Read the next sentence carefully.';
 let request;
 const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async(_,options)=>{request=JSON.parse(options.body);return reply({candidateId:'q2'});}});
 const chosen=await generate(job([entry(original)]));
 const text='Read the next sentence carefully.',start=codePointLength(original.slice(0,original.indexOf(text)));
 assert.deepEqual(chosen,{bookId:'candidate-book',contentVersion:'candidate-edition',chapterId:'ch1',passageId:'p1',start,end:start+codePointLength(text),text});
 const sent=JSON.parse(request.messages[1].content);
 assert.deepEqual(Object.keys(sent),['candidates']);
 assert.deepEqual(sent.candidates,[{id:'q1',text:'A quiet page😀 begins here.'},{id:'q2',text}]);
 assert.equal(JSON.stringify(sent).includes('candidate-edition'),false);
 assert.match(request.messages[0].content,/资料/);
 assert.ok(request.max_tokens<=400);
});

test('candidate caps keep later passages represented and exclude names, headings and pool escapes',async()=>{
 let sent;
 const pool=Array.from({length:9},(_,i)=>entry(Array.from({length:10},(_,j)=>'Sentence '+i+' number '+j+' is complete.').join(' '),'p'+i));
 const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async(_,options)=>{sent=JSON.parse(JSON.parse(options.body).messages[1].content);return reply({candidateId:'q24'});}});
 const selected=await generate(job(pool));
 assert.equal(sent.candidates.length,24);
 assert.equal(selected.passageId,'p7');
 assert.equal(selected.text,'Sentence 7 number 2 is complete.');
 assert.equal(JSON.stringify(sent).includes('Sentence 8'),false);
 const filtered=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async(_,options)=>{sent=JSON.parse(JSON.parse(options.body).messages[1].content);return reply({candidateId:'q1'});}});
 const actual=await filtered(job([entry('Alice'),entry('A complete source sentence.','p2')]));
 assert.equal(actual.text,'A complete source sentence.');
 assert.deepEqual(sent.candidates,[{id:'q1',text:'A complete source sentence.'}]);
});

test('no complete sentence avoids a provider request and malformed or invented IDs fail closed',async()=>{
 let calls=0;
 const empty=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async()=>{calls++;return reply({candidateId:'q1'});}});
 await assert.rejects(empty(job([entry('Alice')])));
 assert.equal(calls,0);
 for(const value of [{candidateId:'q999'},{candidateId:'q1',text:'A rewrite.'},{candidateId:1},{text:'A complete source sentence.'}]){
  const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async()=>reply(value)});
  await assert.rejects(generate(job([entry('A complete source sentence.')])));
 }
});

test('repeated sentences retain the chosen occurrence and a clipped attribution cannot become AI-selected',async()=>{
 const repeated='Read this first. Read this first.',pool=[entry(repeated)],book=bookFor(pool);
 const service=createGiftQuoteService({library:{getBook:async()=>book},gifts:{prepareQuote:async()=>{}},env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async()=>reply({candidateId:'q2'})});
 const selected=await service.choose({id:'owner'},book);
 assert.equal(selected.selection,'ai-selected');assert.equal(selected.start,17);assert.equal(selected.end,33);
 const quote='“Keep going.”',original='x'.repeat(4000-codePointLength(quote)-2)+'. '+quote+' said Alice.';
 const clippedBook=bookFor([entry(original)]),events=[];
 const clipped=createGiftQuoteService({library:{getBook:async()=>clippedBook},gifts:{prepareQuote:async()=>{}},env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async()=>reply({candidateId:'q1'}),onDiagnostic:event=>events.push(event)});
 assert.equal(await clipped.choose({id:'owner'},clippedBook),null,'the full source still owns sentence boundaries after pool clipping');
 assert.deepEqual(events,[{kind:'gift-quote-fallback',reason:'source-rejected'}]);
});

test('invalid JSON and unknown candidates produce distinct safe categories without forwarding provider bodies',async()=>{
 const pool=[entry('A complete source sentence.')],book=bookFor(pool);
 for(const [content,reason]of [['SYNTHETIC-RAW-BODY-MARKER','invalid-response'],[JSON.stringify({candidateId:'q999'}),'unknown-candidate']]){
  const events=[],service=createGiftQuoteService({library:{getBook:async()=>book},gifts:{prepareQuote:async()=>{}},env:{DEEPSEEK_API_KEY:'synthetic-key'},fetcher:async()=>Response.json({choices:[{message:{content}}]}),onDiagnostic:event=>events.push(event)});
  assert.equal((await service.choose({id:'owner'},book)).selection,'original-excerpt');
  assert.deepEqual(events,[{kind:'gift-quote-fallback',reason}]);
 }
});

test('fallback diagnostics contain only a whitelisted category and never disrupt source recovery',async()=>{
 const pool=[entry('A complete source sentence.')],book=bookFor(pool),events=[];
 const service=createGiftQuoteService({library:{getBook:async()=>book},gifts:{prepareQuote:async()=>{}},env:{DEEPSEEK_API_KEY:'SYNTHETIC-KEY-MARKER'},fetcher:async()=>new Response('SYNTHETIC-RAW-BODY-MARKER',{status:503}),onDiagnostic:event=>{events.push(event);}});
 const selection=await service.choose({id:'SYNTHETIC-OWNER-MARKER'},book);
 assert.equal(selection.selection,'original-excerpt');
 assert.deepEqual(events,[{kind:'gift-quote-fallback',reason:'provider-unavailable'}]);
 assert.equal(/SYNTHETIC|complete source|candidate-book/.test(JSON.stringify(events)),false);
 const throwing=createGiftQuoteService({library:{getBook:async()=>book},gifts:{prepareQuote:async()=>{}},env:{},onDiagnostic:()=>{throw Error('SYNTHETIC-LOGGER-ERROR');}});
 assert.equal((await throwing.choose({id:'owner'},book)).selection,'original-excerpt');
 const rejecting=createGiftQuoteService({library:{getBook:async()=>book},gifts:{prepareQuote:async()=>{}},env:{},onDiagnostic:()=>Promise.reject(Error('SYNTHETIC-LOGGER-ERROR'))});
 assert.equal((await rejecting.choose({id:'owner'},book)).selection,'original-excerpt');
 await new Promise(resolve=>setImmediate(resolve));
});
