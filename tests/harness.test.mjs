import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const book={bookId:'test-book',contentVersion:'test-1',chapters:[{id:'ch01'}],sections:[{chapterId:'ch01',number:1,paragraphs:[{id:'p1',original:'If participants agree, the round ends.',translations:{literal:{text:'参与者同意后，这一轮结束。'},interpretive:{text:'大家达成同意，这轮就结束。'}}},{id:'p2',original:'Another round can begin.',translations:{literal:{text:'另一轮可以开始。'},interpretive:{text:'可以再开一轮。'}}}]}],privateNotes:[{text:'Do not send this private note'}],glossary:[]};

test('precompiled source outlines preserve exact anchors and are visibly structural',async()=>{
 const m=await import('../harness/content-pack.mjs').catch(()=>({}));assert.equal(typeof m.buildExperiencePack,'function','content compiler is required');
 const pack=m.buildExperiencePack(book);assert.equal(Object.keys(pack.xrays).length,2);
 for(const x of Object.values(pack.xrays)){assert.equal(x.basis,'text-structure');for(const r of x.roles){const p=book.sections[0].paragraphs.find(p=>p.id===r.sourceRef.passageId);assert.ok(p.original.includes(r.sourceRef.quote));assert.ok(p.translations.literal.text.includes(r.quotes.literal));}}
 assert.equal(pack.cards.length,0,'unknown books must not receive invented stance author positions');
});

test('expired pricing prevents provider dispatch',async t=>{
 const {apply}=await import('../harness/reader-plugin.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'reader-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'input.json'),JSON.stringify({expiresAt:Date.now()+60000,passages:[],text:'x'}));
 const hooks={},tools={},guards=[];const ctx={tools:{guard:g=>guards.push(g),register:d=>tools[d.name]=d},on:(n,f)=>hooks[n]=f};
 apply(ctx,{runDir:dir,maxRequests:4,maxToolCalls:8,maxTokens:2048,maxCostCny:.1,pricing:{inputMissPerMillion:2,outputPerMillion:8,validUntil:new Date(Date.now()-1000).toISOString()}});
 let dispatched=false;
 await assert.rejects(async()=>{for await(const c of hooks['llm/stream']({messages:[],tools:[],maxTokens:2},async function*(){dispatched=true;yield {type:'done'};})){}},/pricing/i);
 assert.equal(dispatched,false);
});

test('repeat context reads avoid duplicating private source text in model history',async t=>{
 const {apply}=await import('../harness/reader-plugin.mjs');const dir=await mkdtemp(path.join(tmpdir(),'reader-context-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'input.json'),JSON.stringify({expiresAt:Date.now()+60000,passages:[{id:'p1',original:'Current source'}],text:'My sentence'}));
 const defs={};apply({tools:{guard(){},register:d=>defs[d.name]=d},on(){}},{runDir:dir});
 const first=await defs.reader_get_context.execute();const second=await defs.reader_get_context.execute();assert.equal(first.text,'My sentence');assert.equal(second.contextAlreadyProvided,true);assert.ok(!JSON.stringify(second).includes('My sentence'));
});

test('publication refuses overlapping corrections before they become a displayed asset',async t=>{
 const {apply}=await import('../harness/reader-plugin.mjs');const dir=await mkdtemp(path.join(tmpdir(),'reader-overlap-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const original='The purpose is continuation.';
 await writeFile(path.join(dir,'input.json'),JSON.stringify({expiresAt:Date.now()+60000,text:'永远没有终点',passages:[{id:'p1',original,sourceHash:createHash('sha256').update(original).digest('hex')}]}));
 const defs={};apply({tools:{guard(){},register:d=>defs[d.name]=d},on(){}},{runDir:dir});await defs.reader_get_context.execute();
 const ref={passageId:'p1',quote:'continuation'};const asset={verdict:'needs_revision',summary:'核对目的',sourceRefs:[ref],segments:[{readerQuote:'永远',reason:'时间不等于目的',sourceRef:ref},{readerQuote:'永远没有终点',reason:'仍应按目的区分',sourceRef:ref}]};
 await assert.rejects(()=>defs.reader_publish_asset.execute({stage:'candidate',asset},{}),/overlap/i);
});

test('a run snapshot only carries current source context, original learner input and bounded public metadata',async()=>{
 const m=await import('../harness/generator.mjs').catch(()=>({}));assert.equal(typeof m.makeSnapshot,'function','bounded runtime context is required');
 const s=m.makeSnapshot({book,passageId:'p1',text:'这轮可以随便结束。',runId:'run-one'});
 assert.equal(s.text,'这轮可以随便结束。');assert.deepEqual(s.passages.map(p=>p.id),['p1','p2']);assert.ok(!JSON.stringify(s).includes('private note'));
 assert.throws(()=>m.makeSnapshot({book,passageId:'absent',text:'hello',runId:'r'}));
});

test('reader quote mapping rejects ambiguous learner spans rather than guessing a correction location',async()=>{
 const m=await import('../harness/generator.mjs').catch(()=>({}));assert.equal(typeof m.normaliseEcho,'function','echo normalisation is required');
 const text='😀这轮必须永远继续。';const value=m.normaliseEcho({verdict:'needs_revision',summary:'需要核对',segments:[{readerQuote:'永远',reason:'这段没有这个限定',sourceRef:{passageId:'p1',quote:'the round ends'}}],sourceRefs:[{passageId:'p1',quote:'the round ends'}]},text);
 assert.equal(text.slice(value.segments[0].start,value.segments[0].end),'永远');assert.equal(value.segments[0].start,6);
 assert.throws(()=>m.normaliseEcho({verdict:'needs_revision',summary:'x',segments:[{readerQuote:'再',reason:'x',sourceRef:{passageId:'p2',quote:'Another'}}],sourceRefs:[]},'再来，再来'));
});

test('explanation mode stays separate from learner corrections in snapshot and publication',async t=>{
 const {makeSnapshot}=await import('../harness/generator.mjs');
 assert.equal(makeSnapshot({book,passageId:'p1',text:'这段为什么这样说？',runId:'explain-one',kind:'explain'}).kind,'explain');
 assert.throws(()=>makeSnapshot({book,passageId:'p1',text:'x',runId:'r',kind:'other'}),/kind|模式/);
 const {apply}=await import('../harness/reader-plugin.mjs');const dir=await mkdtemp(path.join(tmpdir(),'reader-explain-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const snapshot=makeSnapshot({book,passageId:'p1',text:'这段为什么这样说？',runId:'explain-one',kind:'explain'});
 await writeFile(path.join(dir,'input.json'),JSON.stringify(snapshot));
 const defs={};apply({tools:{guard(){},register:d=>defs[d.name]=d},on(){}},{runDir:dir});await defs.reader_get_context.execute();
 const asset={verdict:'needs_revision',summary:'不得批改问题',segments:[],sourceRefs:[{passageId:'p1',quote:'participants agree'}]};
 await assert.rejects(()=>defs.reader_publish_asset.execute({stage:'candidate',asset},{}),/explanation/i);
 asset.verdict='consistent';asset.segments=[{readerQuote:'为什么',reason:'不能把问题标为错误',sourceRef:asset.sourceRefs[0]}];
 await assert.rejects(()=>defs.reader_publish_asset.execute({stage:'candidate',asset},{}),/explanation/i);
 asset.segments=[];await defs.reader_publish_asset.execute({stage:'candidate',asset},{});await defs.reader_publish_asset.execute({stage:'verified',asset},{concludeTurn(){}});
 assert.equal(JSON.parse(await readFile(path.join(dir,'output.json'),'utf8')).kind,'explain');
});
