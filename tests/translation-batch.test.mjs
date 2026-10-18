import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat,readFile,writeFile,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {realpathSync} from 'node:fs';
const testTmpdir=()=>realpathSync(tmpdir());
import path from 'node:path';
import {spawn} from 'node:child_process';
import {planPassages,passageSkipReason,sourcePassagesHash,bindingFor,sameBinding,parseBatchArgs,validateServiceOrigin,openCheckpoint,acquireCheckpointLock,reconcileEntries,MAX_BATCH_REQUESTS} from '../tools/lib/translation-batch.mjs';

const paragraph=(id,original,translations={},extra={})=>({id,original,translations,annotationIds:[],termIds:[],...extra});
const draft=text=>({text,status:'draft',origin:'ai',variant:undefined,sourceVersion:'edition-1',createdAt:'2026-10-18T00:00:00.000Z'});
const fixtureBook=()=>({
  bookId:'batch-test',contentVersion:'edition-1',
  title:{zh:'合成书籍',en:'Synthetic book'},author:'',visibility:'private',sourceLanguage:'en',
  source:{format:'txt',sha256:'edition-1'},
  chapters:[
    {id:'front',number:0,kind:'frontmatter',title:{zh:'出版说明'}},
    {id:'ch01',number:1,kind:'body',title:{zh:'第一章'}},
    {id:'ch02',number:2,kind:'source-section',title:{zh:'第二章'}},
    {id:'appendix-1',number:0,kind:'appendix',title:{zh:'附录'}},
  ],
  sections:[
    {number:1,chapterId:'front',title:'卷首',paragraphs:[paragraph('fm1','Front matter text.')]},
    {number:2,chapterId:'ch01',title:'第一章',paragraphs:[
      paragraph('p1','First source paragraph.'),
      paragraph('p2','Second source paragraph.',{literal:{...draft('旧直译'),variant:'literal'}}),
      paragraph('p3','Third source paragraph.',{literal:{...draft('已复核直译'),variant:'literal',status:'reviewed'},interpretive:{...draft('已复核意译'),variant:'interpretive',status:'reviewed'}}),
      paragraph('h1','CHAPTER ONE',{}, {kind:'source_heading'}),
    ]},
    {number:3,chapterId:'ch02',title:'第二章',paragraphs:[
      paragraph('p4','Fourth source paragraph.'),
      paragraph('p5','第五段中文原文。'),
      paragraph('p6','Sixth source paragraph.',{literal:{...draft('完成直译'),variant:'literal'},interpretive:{...draft('完成意译'),variant:'interpretive'}}),
    ]},
    {number:4,chapterId:'appendix-1',title:'附录',paragraphs:[paragraph('ax1','Appendix text.')]},
  ],
  annotations:[],glossary:[]
});

test('the batch plan keeps source order and excludes front matter, appendices and metadata',()=>{
  const plan=planPassages(fixtureBook());
  assert.deepEqual(plan.eligible.map(row=>row.id),['p1','p4'],'eligible passages follow chapter and source order');
  assert.deepEqual(plan.skipped.map(row=>[row.id,row.reason]),[
    ['fm1','front-matter'],['p2','partial'],['p3','reviewed'],['h1','metadata'],['p5','chinese-source'],['p6','complete'],['ax1','appendix']
  ]);
  assert.equal(plan.counts.eligible,2);
});

test('partial translations are skipped whole so a missing version never replaces the saved one',()=>{
  const book=fixtureBook();
  const only={id:'only-one',original:'Only one saved version.',translations:{literal:{...draft('只有直译'),variant:'literal'}}};
  book.sections[1].paragraphs.push(only);
  assert.equal(passageSkipReason(only,'body'),'partial');
  const plan=planPassages(book);
  assert.ok(!plan.eligible.some(row=>row.id==='only-one'));
});

test('any reviewed translation keeps the paragraph out of batch generation',()=>{
  const reviewedDraftMix={id:'mixed',original:'One reviewed, one draft.',translations:{literal:{...draft('复核直译'),variant:'literal',status:'reviewed'},interpretive:{...draft('草稿意译'),variant:'interpretive'}}};
  assert.equal(passageSkipReason(reviewedDraftMix,'body'),'reviewed');
  assert.equal(passageSkipReason({...reviewedDraftMix,translations:{interpretive:{...draft('复核意译'),variant:'interpretive',status:'reviewed'}}},'body'),'reviewed');
});

test('chapter kinds outside body and source-section never enter the batch',()=>{
  assert.equal(passageSkipReason(paragraph('x','Text.'),'frontmatter'),'front-matter');
  assert.equal(passageSkipReason(paragraph('x','Text.'),'front_matter'),'front-matter');
  assert.equal(passageSkipReason(paragraph('x','Text.'),'appendix'),'appendix');
  assert.equal(passageSkipReason(paragraph('x','Text.'),'mystery-kind'),'excluded-chapter');
  assert.equal(passageSkipReason(paragraph('x','Text.'),'body'),null);
  assert.equal(passageSkipReason(paragraph('x','Text.'),'source-section'),null);
  assert.equal(passageSkipReason(paragraph('x','Text.'),undefined),null);
});

test('the source fingerprint binds ordered passage IDs and original text',()=>{
  const book=fixtureBook(),hash=sourcePassagesHash(book);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(sourcePassagesHash(structuredClone(book)),hash,'the same source must fingerprint identically');
  const edited=structuredClone(book);edited.sections[1].paragraphs[0].original='First source paragraph changed.';
  assert.notEqual(sourcePassagesHash(edited),hash);
  const reordered=structuredClone(book);const [a,b]=reordered.sections[1].paragraphs.splice(0,2);reordered.sections[1].paragraphs.push(b,a);
  assert.notEqual(sourcePassagesHash(reordered),hash,'reordered passage IDs change the fingerprint');
});

test('checkpoint bindings pin account, origin, book and source version',()=>{
  const book=fixtureBook(),binding=bindingFor({userId:'user-a',origin:'https://leafhour.com',book});
  assert.deepEqual(Object.keys(binding).sort(),['bookId','contentVersion','origin','passagesHash','userId']);
  assert.equal(binding.contentVersion,'edition-1');
  assert.ok(sameBinding(binding,bindingFor({userId:'user-a',origin:'https://leafhour.com',book:structuredClone(book)})));
  for(const patch of [{userId:'user-b'},{origin:'https://other.example'},{contentVersion:'edition-2'}]){
    const other=bindingFor({userId:'user-a',origin:'https://leafhour.com',book}),changed={...other,...patch};
    assert.equal(sameBinding(binding,changed),false,JSON.stringify(patch));
  }
  const edited=structuredClone(book);edited.sections[3].paragraphs[0].original='Appendix text changed.';
  assert.equal(sameBinding(binding,bindingFor({userId:'user-a',origin:'https://leafhour.com',book:edited})),false);
});

test('service origins accept HTTPS and loopback HTTP but refuse userinfo, paths and queries',()=>{
  assert.equal(validateServiceOrigin('https://leafhour.com'),'https://leafhour.com');
  assert.equal(validateServiceOrigin('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  assert.equal(validateServiceOrigin('http://localhost:8787'),'http://localhost:8787');
  assert.equal(validateServiceOrigin('http://[::1]:8787'),'http://[::1]:8787');
  for(const bad of ['http://leafhour.com','https://user@leafhour.com','https://leafhour.com/reader','https://leafhour.com/?x=1','https://leafhour.com/#frag','ftp://127.0.0.1','not a url',''])assert.throws(()=>validateServiceOrigin(bad),{code:'bad-origin'},bad);
});

test('argument parsing keeps dry-run the default and demands an explicit bounded request count',()=>{
  const dry=parseBatchArgs(['--origin','https://leafhour.com','--book','gutenberg-alice']);
  assert.equal(dry.execute,false);assert.equal(dry.maxRequests,null);assert.equal(dry.bookId,'gutenberg-alice');
  const run=parseBatchArgs(['--origin','https://leafhour.com','--book','b1','--execute','--max-requests','20']);
  assert.equal(run.execute,true);assert.equal(run.maxRequests,20);
  assert.equal(MAX_BATCH_REQUESTS,20);
  assert.throws(()=>parseBatchArgs(['--origin','https://leafhour.com','--book','b1','--execute']),{code:'usage'});
  assert.throws(()=>parseBatchArgs(['--origin','https://leafhour.com','--book','b1','--max-requests','5']),{code:'usage'},'a request bound alone must not authorize execution');
  for(const value of ['0','21','-1','2.5','abc',''])assert.throws(()=>parseBatchArgs(['--origin','https://leafhour.com','--book','b1','--execute','--max-requests',value]),{code:'usage'},value);
  for(const argv of [['--book','b1'],['--origin','https://leafhour.com'],['--origin','https://leafhour.com','--book','b1','--session','token'],['--origin','https://leafhour.com','--book','b1','--password','secret'],['--origin','https://leafhour.com','--book','../escape']])assert.throws(()=>parseBatchArgs(argv),{code:'usage'},argv.join(' '));
});

test('checkpoints are atomic private JSON that keeps secrets and content out',async t=>{
  const root=await mkdtemp(path.join(testTmpdir(),'translation-checkpoint-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'nested','batch.json'),book=fixtureBook(),binding=bindingFor({userId:'user-a',origin:'https://leafhour.com',book});
  const store=await openCheckpoint({file,binding,create:true});
  store.record('p1',{state:'saved',reason:'https-credential-must-not-appear'});
  await store.save();
  const dir=await stat(path.dirname(file)),stored=await stat(file);
  assert.equal(dir.mode&0o777,0o700,'checkpoint parent stays private');
  assert.equal(stored.mode&0o777,0o600,'checkpoint files stay private');
  const raw=await readFile(file,'utf8');
  assert.ok(!raw.includes('First source paragraph.'),'original text never enters the checkpoint');
  assert.ok(!raw.includes('旧直译'),'translations never enter the checkpoint');
  const parsed=JSON.parse(raw);
  assert.equal(parsed.kind,'leafhour-translation-batch-checkpoint');
  assert.deepEqual(parsed.entries.p1,{state:'saved',reason:'https-credential-must-not-appear',attempts:1,updatedAt:parsed.entries.p1.updatedAt});
  const reopened=await openCheckpoint({file,binding,create:false});
  assert.equal(reopened.data.entries.p1.state,'saved');
});

test('a checkpoint refuses binding changes and symlink targets without touching either file',async t=>{
  const root=await mkdtemp(path.join(testTmpdir(),'translation-checkpoint-guard-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'batch.json'),book=fixtureBook(),binding=bindingFor({userId:'user-a',origin:'https://leafhour.com',book});
  const store=await openCheckpoint({file,binding,create:true});store.record('p1',{state:'saved'});await store.save();
  const before=await readFile(file,'utf8');
  await assert.rejects(openCheckpoint({file,binding:{...binding,userId:'user-b'},create:true}),{code:'binding-mismatch'});
  await assert.rejects(openCheckpoint({file,binding:{...binding,origin:'https://other.example'},create:true}),{code:'binding-mismatch'});
  await assert.rejects(openCheckpoint({file,binding:{...binding,contentVersion:'edition-9'},create:true}),{code:'binding-mismatch'});
  assert.equal(await readFile(file,'utf8'),before,'a refused binding never rewrites the checkpoint');
  const outside=path.join(root,'outside.json');await writeFile(outside,'outside-content');
  await rm(file);await symlink(outside,file);
  await assert.rejects(openCheckpoint({file,binding,create:true}),{code:'symlink'});
  await assert.rejects(openCheckpoint({file,binding,create:false}),{code:'symlink'});
  assert.equal(await readFile(outside,'utf8'),'outside-content','a symlink target is never written through');
});

test('concurrent execution on one checkpoint is refused and a crashed lock is reclaimed',async t=>{
  const root=await mkdtemp(path.join(testTmpdir(),'translation-lock-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'batch.json');
  const release=await acquireCheckpointLock(file);
  await assert.rejects(acquireCheckpointLock(file),{code:'locked'});
  await release();
  const second=await acquireCheckpointLock(file);await second();
  const child=spawn(process.execPath,['-e','']);await new Promise(resolve=>child.once('exit',resolve));
  await writeFile(file+'.lock',JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()}));
  const reclaimed=await acquireCheckpointLock(file);await reclaimed();
  await writeFile(file+'.lock',JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  await assert.rejects(acquireCheckpointLock(file),{code:'locked'},'a live owner keeps its lock');
  await rm(file+'.lock');
});

test('failed and unknown outcomes stay retryable and reconcile from actual saved translations',()=>{
  const book=fixtureBook();
  book.sections[1].paragraphs[0].translations={literal:{...draft('完成直译'),variant:'literal'},interpretive:{...draft('完成意译'),variant:'interpretive'}};
  book.sections[1].paragraphs[1].translations={literal:{...draft('失败后人工复核'),variant:'literal',status:'reviewed'}};
  const entries={
    p1:{state:'unknown',reason:'timeout',attempts:1},
    p2:{state:'failed',reason:'http-502',attempts:1},
    p4:{state:'failed',reason:'http-429',attempts:2},
    p6:{state:'saved',reason:undefined,attempts:1}
  };
  const merged=reconcileEntries(entries,book);
  assert.equal(merged.p1.state,'saved');
  assert.equal(merged.p1.reason,'reconciled');
  assert.equal(merged.p2.state,'saved','a failed request that actually saved is reconciled, not regenerated');
  assert.equal(merged.p4.state,'failed','still-untranslated failures stay retryable');
  assert.equal(merged.p6.state,'saved','saved entries are never redone');
});
