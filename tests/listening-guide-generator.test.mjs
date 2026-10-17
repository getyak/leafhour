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
 await assert.rejects(generate({...input,passages:[{...input.passages[0],original:'x'.repeat(24001)}]}),{status:413});
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

test('support verification sends complete long referenced paragraphs within its separate request budget',async()=>{
 let payload;const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async(_url,options)=>{payload=JSON.parse(JSON.parse(options.body).messages[1].content);return response({checks:[{turnId:'turn-1',supported:true}]});}});
 const passages=Array.from({length:4},(_,i)=>({id:'p'+i,chapterId:'ch1',original:'x'.repeat(19000)})),turns=[{id:'turn-1',speaker:'guide',text:'解释',kind:'explanation',sourceRefs:[{passageId:'p0',quote:'x'}]}];
 await generate({...input,stage:'verify',passages,turns});assert.deepEqual(payload.passages,passages);
 await assert.rejects(generate({...input,stage:'verify',passages:[{...passages[0],original:'x'.repeat(100001)}],turns}),{status:413});
});

test('one long paragraph stays complete without expanding normal multi-paragraph reading requests',async()=>{
 const payloads=[],generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async(_url,options)=>{payloads.push(JSON.parse(JSON.parse(options.body).messages[1].content));return response({});}});
 const original='x'.repeat(19000);await generate({...input,passages:[{id:'p',chapterId:'ch1',original}]});assert.equal(payloads[0].passages[0].original,original);
 await assert.rejects(generate({...input,passages:[{id:'p1',chapterId:'ch1',original:'x'.repeat(9500)},{id:'p2',chapterId:'ch1',original:'y'.repeat(9500)}]}),{status:413});assert.equal(payloads.length,1);
});

test('outline formatting restores an unambiguous source quote and retains claims when the overview is verbose',async()=>{
 const original='A second, and generally a later expedient, was the establishment of constitutional checks; by which consent was needed.';
 const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>response({passageIds:['p1'],summary:'概括'.repeat(106),claims:[{text:'权力也受到宪制约束。',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'a second, and generally a later expedient,\nwas the establishment of constitutional checks'}]}]})});
 const result=await generate({...input,intent:'explain',passages:[{id:'p1',chapterId:'ch1',original}]});
 assert.equal(result.summary,'权力也受到宪制约束。');assert.equal(result.claims[0].text,'权力也受到宪制约束。');
 assert.equal(result.claims[0].sourceRefs[0].quote,'A second, and generally a later expedient, was the establishment of constitutional checks');
 assert.ok(original.includes(result.claims[0].sourceRefs[0].quote));
});

test('quote formatting never invents words, changes internal case, guesses another passage, or resolves an ambiguous match',async()=>{
 const cases=[['It is not permitted.','It is permitted.'],['The symbol X differs.','The symbol x differs.'],['A rule.\nA  rule.','a rule.'],['A A  A','a A']];
 for(const [original,quote]of cases){const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>response({passageIds:['p1'],summary:'概括',claims:[{text:'观点',sourceRefs:[{passageId:'p1',quote}]}]})});const result=await generate({...input,passages:[{id:'p1',chapterId:'ch1',original}]});assert.equal(result.claims[0].sourceRefs[0].quote,quote);}
 const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>response({turns:[{speaker:'guide',text:'讲解',sourceRefs:[{passageId:'p2',quote:'a rule.'}]}]})});
 const result=await generate({stage:'script',bookId:'b',contentVersion:'v',intent:'explain',outlines:[{summary:'概要',passageIds:['p1'],claims:[{text:'观点',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'A rule.'}]}]}]});assert.equal(result.turns[0].sourceRefs[0].quote,'a rule.');
});

test('script citations restore exact provided evidence without changing spoken interpretation',async()=>{
 const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>response({turns:[{speaker:'guide',text:'这是解释。',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'a rule.'}]}]})});
 const result=await generate({stage:'script',bookId:'b',contentVersion:'v',intent:'explain',outlines:[{summary:'概要',passageIds:['p1'],claims:[{text:'观点',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'A rule.'}]}]}]});assert.equal(result.turns[0].sourceRefs[0].quote,'A rule.');assert.equal(result.turns[0].text,'这是解释。');
});

test('an explicitly quoted spoken turn restores author formatting only when it repeats the model citation exactly',async()=>{
 for(const [text,expected] of [['a rule.','A rule.'],['A different rule.','A different rule.']]){
  const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>response({turns:[{speaker:'guide',kind:'quote',text,sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'a rule.'}]}]})});
  const result=await generate({stage:'script',bookId:'b',contentVersion:'v',intent:'explain',outlines:[{summary:'概要',passageIds:['p1'],claims:[{text:'观点',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'A rule.'}]}]}]});assert.equal(result.turns[0].text,expected);
 }
});

test('an ambiguous supplied excerpt cannot be hidden by another shorter excerpt for the same passage',async()=>{
 const generate=createGuideGenerator({env:{DEEPSEEK_API_KEY:'fixture-only'},fetcher:async()=>response({turns:[{speaker:'guide',text:'讲解',sourceRefs:[{passageId:'p1',quote:'a rule.'}]}]})});
 const result=await generate({stage:'script',bookId:'b',contentVersion:'v',intent:'explain',outlines:[{summary:'概要',passageIds:['p1'],claims:[{text:'观点',sourceRefs:[{chapterId:'ch1',passageId:'p1',quote:'A rule. A  rule.'},{chapterId:'ch1',passageId:'p1',quote:'A rule.'}]}]}]});assert.equal(result.turns[0].sourceRefs[0].quote,'a rule.');
});
