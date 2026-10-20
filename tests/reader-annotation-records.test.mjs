import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnnotationArchive,validateAnnotationArchive,createAnnotationThread,appendAnnotationMessage,removeAnnotationThread,mergeAnnotationArchives} from '../app/reader-annotation-records.mjs';

const book=()=>({bookId:'ann-book',contentVersion:'v1',sections:[
  {chapterId:'ch1',paragraphs:[
    {id:'p1',original:'原文😀 end',translations:{literal:{text:'A literal translation.',status:'draft'},interpretive:{text:'An interpretation.',status:'reviewed'}}},
    {id:'p2',original:'Second source paragraph',translations:{literal:{text:'Second literal.',status:'draft'}}}]},
  {chapterId:'ch2',paragraphs:[{id:'p3',original:'Third source',translations:{}}]}]});
const originalQuote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:2,text:'原文'}]});
const literalQuote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'literal',start:0,end:22,text:'A literal translation.',translationStatus:'draft'}]});
const interpretiveQuote=()=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'ann-book',contentVersion:'v1',chapterId:'ch1',parts:[{passageId:'p1',layer:'interpretive',start:0,end:18,text:'An interpretation.',translationStatus:'reviewed'}]});
const aiMessage=(patch={})=>({id:'msg-ai-1',origin:'ai',body:'## 解释\n- 要点😀',createdAt:'2026-01-02T00:00:00.000Z',provenance:{source:'site-agent',label:'站内陪读'},sourceRefs:[{passageId:'p1',layer:'original',quote:'原文'}],...patch});
const userMessage=(patch={})=>({id:'msg-user-1',origin:'user',body:'我自己的话',createdAt:'2026-01-03T00:00:00.000Z',...patch});
const status=(fn,want)=>assert.throws(fn,error=>error.status===want);
const started=(patch={})=>createAnnotationThread(createAnnotationArchive('ann-book'),book(),{id:'thread-1',quote:originalQuote(),...patch},{now:'2026-01-01T00:00:00.000Z'});

test('an empty archive is the frozen JSON shape and validates as given',()=>{
  const archive=createAnnotationArchive('ann-book');
  assert.deepEqual(archive,{kind:'leafhour-reader-annotations',schemaVersion:1,bookId:'ann-book',revision:0,threads:[]});
  assert.deepEqual(validateAnnotationArchive(archive,book()),archive);
  status(()=>createAnnotationArchive('bad id'),400);
  status(()=>validateAnnotationArchive({...archive,bookId:'other'},book()),409);
});

test('a new thread opens with zero messages and fabricates no user question',()=>{
  const created=started({highlightId:'highlight-1'});
  assert.equal(created.revision,1);
  const [thread]=created.threads;
  assert.deepEqual(thread.messages,[]);
  assert.equal(thread.highlightId,'highlight-1');
  assert.equal(thread.createdAt,'2026-01-01T00:00:00.000Z');
  assert.equal(thread.updatedAt,'2026-01-01T00:00:00.000Z');
  assert.equal(thread.deletedAt,undefined);
  assert.deepEqual(thread.quote,originalQuote());
  assert.deepEqual(validateAnnotationArchive(created,book()),created);
  const defaulted=createAnnotationThread(createAnnotationArchive('ann-book'),book(),{id:'thread-2',quote:originalQuote()});
  assert.equal(Number.isFinite(Date.parse(defaulted.threads[0].createdAt)),true);
  status(()=>createAnnotationThread(createAnnotationArchive('ann-book'),book(),{id:'thread-3',quote:originalQuote()},{now:'garbage'}),400);
  status(()=>createAnnotationThread(createAnnotationArchive('ann-book'),book(),{id:'thread-3',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z',extra:1}),400);
});

test('two caller clones stay untouched and equal inputs produce equal archives',()=>{
  const base=createAnnotationArchive('ann-book'),one=structuredClone(base),two=structuredClone(base),input={id:'thread-1',quote:literalQuote()};
  const before=structuredClone(input);
  const first=createAnnotationThread(one,book(),input,{now:'2026-01-01T00:00:00.000Z'});
  const second=createAnnotationThread(two,book(),input,{now:'2026-01-01T00:00:00.000Z'});
  assert.deepEqual(one,base);assert.deepEqual(two,base);assert.deepEqual(input,before);
  assert.deepEqual(first,second);
  const words=userMessage(),wordsBefore=structuredClone(words),grown=appendAnnotationMessage(first,book(),'thread-1',words);
  assert.deepEqual(words,wordsBefore);
  assert.deepEqual(first.threads[0].messages,[]);
  assert.deepEqual(validateAnnotationArchive(grown,book()),grown);
});

test('exact retries return unchanged archives while conflicting reuse fails',()=>{
  const created=started();
  const retry=createAnnotationThread(created,book(),{id:'thread-1',quote:originalQuote()},{now:'2026-03-03T00:00:00.000Z'});
  assert.deepEqual(retry,created);
  assert.equal(retry.revision,created.revision);
  status(()=>createAnnotationThread(created,book(),{id:'thread-1',quote:literalQuote()},{now:'2026-01-01T00:00:00.000Z'}),409);
  status(()=>createAnnotationThread(created,book(),{id:'thread-1',quote:originalQuote(),highlightId:'highlight-9'},{now:'2026-01-01T00:00:00.000Z'}),409);
  const withWords=appendAnnotationMessage(created,book(),'thread-1',userMessage());
  const again=appendAnnotationMessage(withWords,book(),'thread-1',userMessage());
  assert.deepEqual(again,withWords);
  assert.equal(again.revision,withWords.revision);
  status(()=>appendAnnotationMessage(withWords,book(),'thread-1',userMessage({body:'改口的话'})),409);
});

test('messages keep their roles, raw Markdown and the typed quote anchor',()=>{
  const created=started(),threadId=created.threads[0].id;
  const one=appendAnnotationMessage(created,book(),threadId,aiMessage());
  const two=appendAnnotationMessage(one,book(),threadId,userMessage());
  assert.equal(two.revision,3);
  assert.deepEqual(two.threads[0].quote,originalQuote());
  assert.equal(two.threads[0].updatedAt,'2026-01-03T00:00:00.000Z');
  const [ai,user]=two.threads[0].messages;
  assert.equal(ai.origin,'ai');assert.equal(ai.provenance.source,'site-agent');
  assert.equal(user.origin,'user');assert.equal(Object.hasOwn(user,'provenance'),false);
  assert.equal(ai.body,'## 解释\n- 要点😀');
  assert.deepEqual(ai.sourceRefs,[{passageId:'p1',layer:'original',quote:'原文'}]);
  const translated=appendAnnotationMessage(started({quote:literalQuote()}),book(),'thread-1',aiMessage());
  assert.equal(Object.hasOwn(translated.threads[0].quote.parts[0],'translationStatus'),true);
  assert.equal(translated.threads[0].quote.parts[0].translationStatus,'draft');
  assert.equal(Object.hasOwn(started().threads[0].quote.parts[0],'translationStatus'),false);
  const twinBase=appendAnnotationMessage(started(),book(),'thread-1',userMessage());
  const twin=appendAnnotationMessage(createAnnotationThread(twinBase,book(),{id:'thread-2',quote:literalQuote()},{now:'2026-01-01T00:00:00.000Z'}),book(),'thread-2',userMessage());
  assert.deepEqual(twin.threads.map(row=>row.messages.map(entry=>entry.id)),[['msg-user-1'],['msg-user-1']]);
});

test('AI provenance is required, user words cannot carry provenance',()=>{
  const created=started(),threadId=created.threads[0].id;
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({provenance:undefined})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({provenance:{source:'model-tool',label:'读过'}})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({provenance:{source:'site-agent',label:'  '}})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({provenance:{source:'site-agent',label:'x'.repeat(201)}})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,userMessage({provenance:{source:'site-agent',label:'冒名'}})),400);
  const external=appendAnnotationMessage(created,book(),threadId,aiMessage({provenance:{source:'external-agent',label:'外部阅读器'}}));
  assert.equal(external.threads[0].messages[0].provenance.source,'external-agent');
});

test('message bodies preserve raw Unicode Markdown exactly and stay bounded',()=>{
  const created=started(),threadId=created.threads[0].id;
  const raw='   ## 不是标题\n\u{1F600}\ttab 结尾   ';
  const saved=appendAnnotationMessage(created,book(),threadId,userMessage({body:raw}));
  assert.equal(saved.threads[0].messages[0].body,raw);
  const longest=appendAnnotationMessage(created,book(),threadId,userMessage({body:'x'.repeat(12000)}));
  assert.equal(longest.threads[0].messages[0].body.length,12000);
  status(()=>appendAnnotationMessage(created,book(),threadId,userMessage({body:'x'.repeat(12001)})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,userMessage({body:'   '})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,userMessage({body:'坏\uD800字符'})),400);
});

test('quote snapshots require intact Unicode boundaries and bounded parts',()=>{
  const created=createAnnotationArchive('ann-book'),b=book();
  const astral={...originalQuote(),parts:[{passageId:'p1',layer:'original',start:2,end:4,text:'😀'}]};
  assert.deepEqual(validateAnnotationArchive(createAnnotationThread(created,b,{id:'thread-1',quote:astral},{now:'2026-01-01T00:00:00.000Z'}),b).threads[0].quote.parts[0].text,'😀');
  status(()=>createAnnotationThread(created,b,{id:'thread-2',quote:{...originalQuote(),parts:[{passageId:'p1',layer:'original',start:2,end:3,text:'\ud83d'}]}},{}),400);
  status(()=>createAnnotationThread(created,b,{id:'thread-3',quote:{...originalQuote(),parts:[{passageId:'p1',layer:'original',start:0,end:2001,text:'x'.repeat(2001)}]}},{}),400);
  status(()=>createAnnotationThread(created,b,{id:'thread-4',quote:{...originalQuote(),parts:Array.from({length:9},()=>({passageId:'p1',layer:'original',start:0,end:2,text:'原文'}))}},{}),400);
});

test('source and translation snapshots survive changes while stale threads stop accepting words',()=>{
  const b=book();
  const archive=appendAnnotationMessage(createAnnotationThread(createAnnotationArchive('ann-book'),b,{id:'thread-src',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'}),b,'thread-src',userMessage({id:'msg-src'}));
  const mixed=appendAnnotationMessage(createAnnotationThread(archive,b,{id:'thread-tr',quote:literalQuote()},{now:'2026-01-01T00:00:00.000Z'}),b,'thread-tr',aiMessage({id:'msg-tr',sourceRefs:[]}));
  const changed=book();
  changed.sections[0].paragraphs[0].translations.literal={text:'Rewritten translation.',status:'reviewed'};
  status(()=>validateAnnotationArchive(mixed,changed),409);
  const historical=validateAnnotationArchive(mixed,changed,{historical:true});
  assert.deepEqual(historical.threads[1].quote.parts[0],{passageId:'p1',layer:'literal',start:0,end:22,text:'A literal translation.',translationStatus:'draft'});
  status(()=>appendAnnotationMessage(mixed,changed,'thread-tr',userMessage({id:'msg-late'})),409);
  const grown=appendAnnotationMessage(mixed,changed,'thread-src',userMessage({id:'msg-late'}));
  assert.equal(grown.threads[0].messages.length,2);
  assert.deepEqual(validateAnnotationArchive(grown,changed,{historical:true}),grown);
  const retyped=book();
  retyped.sections[0].paragraphs[0].translations.literal={text:'A literal translation.',status:'reviewed'};
  status(()=>validateAnnotationArchive(mixed,retyped),409);
  assert.deepEqual(validateAnnotationArchive(mixed,retyped,{historical:true}),mixed);
});

test('sourceRefs must be proven against the supplied book without URL or verification claims',()=>{
  const b=book(),created=started(),threadId=created.threads[0].id;
  const refs=[{passageId:'p1',layer:'original',quote:'原文'},{passageId:'p1',layer:'literal',quote:'translation'},{passageId:'p2',layer:'literal',quote:'Second literal.'}];
  const saved=appendAnnotationMessage(created,book(),threadId,aiMessage({sourceRefs:refs}));
  assert.deepEqual(saved.threads[0].messages[0].sourceRefs,refs);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({sourceRefs:[{passageId:'p1',layer:'original',quote:'不是原文'}]})),409);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({sourceRefs:[{passageId:'p1',layer:'literal',quote:'Missing translation.'}]})),409);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({sourceRefs:[{passageId:'p1',layer:'original',quote:'原文',url:'https://example.test/cite'}]})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({sourceRefs:[{passageId:'p1',layer:'original',quote:'原文',toolVerified:true}]})),400);
  status(()=>appendAnnotationMessage(created,book(),threadId,aiMessage({sourceRefs:Array.from({length:21},()=>({passageId:'p1',layer:'original',quote:'原文'}))})),400);
  const refArchive=appendAnnotationMessage(createAnnotationThread(createAnnotationArchive('ann-book'),b,{id:'thread-1',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'}),b,'thread-1',aiMessage({sourceRefs:[{passageId:'p1',layer:'literal',quote:'A literal translation.'}]}));
  const changed=book();
  changed.sections[0].paragraphs[0].translations.literal={text:'Rewritten translation.',status:'draft'};
  status(()=>validateAnnotationArchive(refArchive,changed,{historical:true}),409);
});

test('deletion keeps the tombstone and old backups cannot resurrect the thread',()=>{
  const withWords=appendAnnotationMessage(started(),book(),'thread-1',userMessage());
  const backup=structuredClone(withWords);
  const removed=removeAnnotationThread(withWords,book(),'thread-1',{now:'2026-02-01T00:00:00.000Z'});
  assert.equal(removed.revision,3);
  assert.equal(removed.threads[0].deletedAt,'2026-02-01T00:00:00.000Z');
  assert.deepEqual(removed.threads[0].messages,withWords.threads[0].messages);
  const repeated=removeAnnotationThread(removed,book(),'thread-1',{now:'2026-04-04T00:00:00.000Z'});
  assert.deepEqual(repeated,removed);
  status(()=>appendAnnotationMessage(removed,book(),'thread-1',userMessage({id:'msg-late'})),409);
  assert.deepEqual(createAnnotationThread(removed,book(),{id:'thread-1',quote:originalQuote()},{now:'2026-05-05T00:00:00.000Z'}),removed);
  status(()=>createAnnotationThread(removed,book(),{id:'thread-1',quote:literalQuote()},{now:'2026-05-05T00:00:00.000Z'}),409);
  const restored=mergeAnnotationArchives(removed,backup,book());
  assert.equal(restored.threads[0].deletedAt,'2026-02-01T00:00:00.000Z');
  assert.deepEqual(restored.threads[0].messages,withWords.threads[0].messages);
  assert.equal(restored.revision,removed.revision);
  assert.deepEqual(validateAnnotationArchive(restored,book(),{historical:true}),restored);
  const incomingTombstone=mergeAnnotationArchives(backup,removed,book());
  assert.equal(incomingTombstone.threads[0].deletedAt,'2026-02-01T00:00:00.000Z');
  status(()=>removeAnnotationThread(withWords,book(),'thread-unknown',{now:'2026-02-01T00:00:00.000Z'}),404);
  status(()=>appendAnnotationMessage(withWords,book(),'thread-unknown',userMessage()),404);
  status(()=>removeAnnotationThread(withWords,book(),'not an id',{now:'2026-02-01T00:00:00.000Z'}),400);
});

test('concurrent branches union words in deterministic order and conflicts stay honest',()=>{
  const base=appendAnnotationMessage(started(),book(),'thread-1',userMessage({id:'msg-1',createdAt:'2026-01-02T00:00:00.000Z'}));
  const branchA=appendAnnotationMessage(structuredClone(base),book(),'thread-1',userMessage({id:'msg-a',createdAt:'2026-01-05T00:00:00.000Z'}));
  const branchB=appendAnnotationMessage(structuredClone(base),book(),'thread-1',aiMessage({id:'msg-b',createdAt:'2026-01-03T00:00:00.000Z',sourceRefs:[]}));
  const merged=mergeAnnotationArchives(branchA,branchB,book());
  assert.deepEqual(merged.threads[0].messages.map(row=>row.id),['msg-1','msg-b','msg-a']);
  assert.equal(merged.revision,4);
  assert.equal(merged.threads[0].updatedAt,'2026-01-05T00:00:00.000Z');
  assert.deepEqual(mergeAnnotationArchives(merged,branchB,book()),merged);
  assert.deepEqual(mergeAnnotationArchives(branchB,branchA,book()).threads[0].messages.map(row=>row.id),['msg-1','msg-b','msg-a']);
  const ahead=structuredClone(branchB);ahead.revision=50;
  const adopted=mergeAnnotationArchives(merged,ahead,book());
  assert.equal(adopted.revision,50);
  assert.deepEqual(adopted.threads,merged.threads);
  assert.deepEqual(mergeAnnotationArchives(adopted,ahead,book()),adopted);
  const clash=appendAnnotationMessage(structuredClone(base),book(),'thread-1',userMessage({id:'msg-a',body:'别的话',createdAt:'2026-01-05T00:00:00.000Z'}));
  status(()=>mergeAnnotationArchives(branchA,clash,book()),409);
  const otherThread=appendAnnotationMessage(createAnnotationThread(createAnnotationArchive('ann-book'),book(),{id:'thread-1',quote:interpretiveQuote()},{now:'2026-01-01T00:00:00.000Z'}),book(),'thread-1',userMessage());
  status(()=>mergeAnnotationArchives(base,otherThread,book()),409);
});

test('archive bounds reject new threads, new messages and oversized JSON without trimming',()=>{
  const b=book();
  let many=createAnnotationArchive('ann-book');
  for(let i=0;i<100;i++)many=createAnnotationThread(many,b,{id:'thread-'+i,quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'});
  assert.equal(many.threads.length,100);
  status(()=>createAnnotationThread(many,b,{id:'thread-100',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'}),413);
  let full=started();
  for(let i=0;i<20;i++)full=appendAnnotationMessage(full,b,'thread-1',userMessage({id:'msg-'+i,body:'话'+i}));
  assert.equal(full.threads[0].messages.length,20);
  status(()=>appendAnnotationMessage(full,b,'thread-1',userMessage({id:'msg-20'})),413);
  const overThreads={kind:'leafhour-reader-annotations',schemaVersion:1,bookId:'ann-book',revision:0,threads:Array.from({length:101},(_,i)=>({id:'thread-'+i,quote:originalQuote(),createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',messages:[]}))};
  status(()=>validateAnnotationArchive(overThreads,b),413);
  const overMessages={kind:'leafhour-reader-annotations',schemaVersion:1,bookId:'ann-book',revision:0,threads:[{id:'thread-1',quote:originalQuote(),createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',messages:Array.from({length:21},(_,i)=>({id:'msg-'+i,origin:'user',body:'话',createdAt:'2026-01-01T00:00:00.000Z'}))}]};
  status(()=>validateAnnotationArchive(overMessages,b),413);
  let huge=createAnnotationArchive('ann-book');
  for(let i=0;i<5;i++)huge=createAnnotationThread(huge,b,{id:'thread-'+i,quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'});
  let last=null,thrown=null;
  for(let i=0;thrown===null;i++){
    try{last=appendAnnotationMessage(huge,b,'thread-'+(i%5),userMessage({id:'msg-'+i,body:'x'.repeat(12000),createdAt:'2026-01-0'+(1+i%5)+'T00:00:00.000Z'}));huge=last;}
    catch(error){thrown=error;}
  }
  assert.equal(thrown.status,413);
  assert.equal(last.threads.every(row=>row.messages.length<20),true);
  const bytes=new TextEncoder().encode(JSON.stringify(last)).length;
  assert.equal(bytes>900000&&bytes<=1048576,true);
  assert.deepEqual(validateAnnotationArchive(last,b),last);
});

test('forged prototypes, accessors and dangerous keys fail without invoking getters',()=>{
  const b=book();
  let touched=false;
  const stealing=createAnnotationArchive('ann-book');
  Object.defineProperty(stealing,'threads',{enumerable:true,get(){touched=true;throw Error('getter invoked');}});
  status(()=>validateAnnotationArchive(stealing,b),400);
  assert.equal(touched,false);
  const tricky=aiMessage();
  Object.defineProperty(tricky,'provenance',{enumerable:true,get(){touched=true;throw Error('getter invoked');}});
  status(()=>appendAnnotationMessage(started(),b,'thread-1',tricky),400);
  assert.equal(touched,false);
  const wrongPrototype=started();
  Object.setPrototypeOf(wrongPrototype,{grant:true});
  status(()=>validateAnnotationArchive(wrongPrototype,b),400);
  const wrongList=started();
  Object.setPrototypeOf(wrongList.threads,class extends Array{}.prototype);
  status(()=>validateAnnotationArchive(wrongList,b),400);
  const hidden=aiMessage();Object.defineProperty(hidden,'grant',{value:'library'});
  status(()=>appendAnnotationMessage(started(),b,'thread-1',hidden),400);
  status(()=>appendAnnotationMessage(started(),b,'thread-1',aiMessage({[Symbol('hidden')]:true})),400);
  status(()=>appendAnnotationMessage(started(),b,'thread-1',JSON.parse('{"id":"msg-json","origin":"user","body":"话","createdAt":"2026-01-03T00:00:00.000Z","__proto__":{"polluted":true}}')),400);
  status(()=>validateAnnotationArchive({...createAnnotationArchive('ann-book'),token:'secret',run:'active'},b),400);
  const rogue=createAnnotationArchive('ann-book');
  rogue.threads['Infinity']=started().threads[0];
  status(()=>validateAnnotationArchive(rogue,b),400);
});

test('oversized array lengths are refused before index enumeration or helper allocation',()=>{
  const b=book(),probes=[];
  for(const field of ['threads','messages','sourceRefs']){
    const archive=started(),input=userMessage(),oversized=[];oversized.length=0xffffffff;
    if(field==='threads')archive.threads=oversized;
    if(field==='messages')archive.threads[0].messages=oversized;
    if(field==='sourceRefs')input.sourceRefs=oversized;
    const originalKeys=Reflect.ownKeys,originalFrom=Array.from;let enumerated=false,allocated=false;
    Reflect.ownKeys=function(value){if(value===oversized)enumerated=true;return originalKeys.call(this,value);};
    Array.from=function(value,...args){if(value&&typeof value==='object'&&value.length>100)allocated=true;return originalFrom.call(this,value,...args);};
    let status=null;
    try{if(field==='sourceRefs')appendAnnotationMessage(archive,b,'thread-1',input);else validateAnnotationArchive(archive,b);}
    catch(error){status=error.status;}
    finally{Reflect.ownKeys=originalKeys;Array.from=originalFrom;}
    probes.push({field,enumerated,allocated,status});
  }
  assert.deepEqual(probes,[
    {field:'threads',enumerated:false,allocated:false,status:413},
    {field:'messages',enumerated:false,allocated:false,status:413},
    {field:'sourceRefs',enumerated:false,allocated:false,status:400}]);
});

test('historical option must be an exact plain boolean record and never executes getters',()=>{
  const b=book();
  const archive=appendAnnotationMessage(started(),b,'thread-1',userMessage());
  let reads=0;
  for(const options of [{get historical(){reads++;return true;}},Object.create({historical:true}),{historical:true,grant:'extra'},{historical:'true'},{historical:undefined},null])status(()=>validateAnnotationArchive(archive,b,options),400);
  assert.equal(reads,0);
  assert.deepEqual(validateAnnotationArchive(archive,b,{historical:false}),archive);
  const changed=book();
  changed.sections[0].paragraphs[0].translations.literal={text:'Rewritten translation.',status:'draft'};
  const stale=appendAnnotationMessage(createAnnotationThread(createAnnotationArchive('ann-book'),b,{id:'thread-1',quote:literalQuote()},{now:'2026-01-01T00:00:00.000Z'}),b,'thread-1',userMessage());
  status(()=>validateAnnotationArchive(stale,changed,{historical:false}),409);
  assert.deepEqual(validateAnnotationArchive(stale,changed,{historical:true}),stale);
});

test('supplied now is validated even when the operation itself is a no-op retry',()=>{
  const b=book(),archive=started(),deleted=removeAnnotationThread(archive,b,'thread-1',{now:'2026-02-01T00:00:00.000Z'});
  status(()=>createAnnotationThread(archive,b,{id:'thread-1',quote:originalQuote()},{now:'invalid'}),400);
  status(()=>removeAnnotationThread(deleted,b,'thread-1',{now:'10/20/2026'}),400);
  status(()=>createAnnotationThread(archive,b,{id:'thread-1',quote:originalQuote()},{now:'2026-01-01',extra:1}),400);
  assert.deepEqual(createAnnotationThread(archive,b,{id:'thread-1',quote:originalQuote()},{now:'2026-03-03T00:00:00.000Z'}),archive);
  assert.deepEqual(removeAnnotationThread(deleted,b,'thread-1',{now:'2026-03-03T00:00:00.000Z'}),deleted);
});

test('an exhausted safe revision refuses real writes but still allows no-op retries',()=>{
  const b=book();
  const empty=createAnnotationArchive('ann-book');empty.revision=Number.MAX_SAFE_INTEGER;
  status(()=>createAnnotationThread(empty,b,{id:'thread-1',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'}),413);
  const full=started();full.revision=Number.MAX_SAFE_INTEGER;
  status(()=>appendAnnotationMessage(full,b,'thread-1',userMessage()),413);
  status(()=>removeAnnotationThread(full,b,'thread-1',{now:'2026-01-01T00:00:00.000Z'}),413);
  status(()=>mergeAnnotationArchives(full,appendAnnotationMessage(started(),b,'thread-1',userMessage()),b),413);
  const retry=createAnnotationThread(full,b,{id:'thread-1',quote:originalQuote()},{now:'2026-01-01T00:00:00.000Z'});
  assert.equal(retry.revision,Number.MAX_SAFE_INTEGER);
  assert.deepEqual(validateAnnotationArchive(retry,b),retry);
  const noMerge=mergeAnnotationArchives(full,structuredClone(full),b);
  assert.equal(noMerge.revision,Number.MAX_SAFE_INTEGER);
  assert.deepEqual(validateAnnotationArchive(noMerge,b),noMerge);
});

test('timestamps follow ISO grammar first and preserve valid strings verbatim',()=>{
  const b=book();
  for(const now of ['0','10/20/2026','October 20, 2026','2026-13-01T00:00:00.000Z','2026-02-30T00:00:00.000Z','2026-02-29T00:00:00.000Z','2026-10-20T25:00:00.000Z'])status(()=>createAnnotationThread(createAnnotationArchive('ann-book'),b,{id:'thread-1',quote:originalQuote()},{now}),400);
  for(const now of ['2026-10-20T00:00:00.000Z','2026-10-20T12:30:45.123+08:00','2026-10-20T12:30','2026-10-20','2024-02-29T00:00:00.000Z']){
    const created=createAnnotationThread(createAnnotationArchive('ann-book'),b,{id:'thread-1',quote:originalQuote()},{now});
    assert.equal(created.threads[0].createdAt,now);
    assert.equal(created.threads[0].updatedAt,now);
  }
});

test('merge that reorders messages counts one actual change then stays idempotent',()=>{
  const b=book();
  let archive=started();
  archive=appendAnnotationMessage(archive,b,'thread-1',userMessage({id:'z',createdAt:'2026-10-21T00:00:00.000Z'}));
  archive=appendAnnotationMessage(archive,b,'thread-1',userMessage({id:'a',createdAt:'2026-10-20T00:00:00.000Z'}));
  assert.deepEqual(archive.threads[0].messages.map(row=>row.id),['z','a']);
  const merged=mergeAnnotationArchives(archive,archive,b);
  assert.deepEqual(merged.threads[0].messages.map(row=>row.id),['a','z']);
  assert.equal(merged.revision,archive.revision+1);
  const repeated=mergeAnnotationArchives(merged,archive,b);
  assert.deepEqual(repeated,merged);
  assert.equal(repeated.revision,merged.revision);
  assert.deepEqual(validateAnnotationArchive(merged,b),merged);
});

test('validate returns a detached normalized clone with unique IDs per scope',()=>{
  const grown=appendAnnotationMessage(started(),book(),'thread-1',userMessage());
  const clone=validateAnnotationArchive(grown,book());
  assert.deepEqual(clone,grown);
  assert.notEqual(clone,grown);
  assert.notEqual(clone.threads,grown.threads);
  clone.threads[0].messages[0].body='改写';
  clone.threads[0].quote.parts[0].text='伪造';
  assert.equal(grown.threads[0].messages[0].body,'我自己的话');
  assert.equal(grown.threads[0].quote.parts[0].text,'原文');
  const duplicateThreads={...grown,threads:[grown.threads[0],structuredClone(grown.threads[0])]};
  status(()=>validateAnnotationArchive(duplicateThreads,book()),400);
  const second=structuredClone(grown.threads[0]);second.id='thread-2';
  const duplicateMessages={...grown,threads:[{...grown.threads[0],messages:[grown.threads[0].messages[0],structuredClone(grown.threads[0].messages[0])]},second]};
  status(()=>validateAnnotationArchive(duplicateMessages,book()),400);
  status(()=>validateAnnotationArchive({...grown,revision:-1},book()),400);
  status(()=>validateAnnotationArchive({...grown,revision:1.5},book()),400);
});
