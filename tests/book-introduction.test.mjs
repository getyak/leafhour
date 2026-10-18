import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {zipSync,strToU8} from 'fflate';
import {createLibraryService} from '../server/library-service.mjs';
import {makeBook} from '../server/document-import.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';

const shared=await import('../app/book-introduction.mjs').catch(()=>({}));
const services=await import('../server/book-introduction.mjs').catch(()=>({}));
const owner={id:'introduction-owner'},other={id:'introduction-other'};
const draft=(book,text='开头呈现了阅读与提问之间的联系。')=>({kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text,contentVersion:book.contentVersion,createdAt:'2026-10-18T00:00:00.000Z',model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:[book.sections[0].paragraphs[0].id]});
async function fixture(t,{generator=async()=>({text:'开头呈现了阅读与提问之间的联系。'}),timeoutMs=60000}={}){
  assert.equal(typeof services.createBookIntroductionService,'function','bounded introduction service is required');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-introduction-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:path.join(dir,'library'),catalogDir:null});
  const book=await library.importDocument(owner,{filename:'A reading.txt',bytes:Buffer.from('Read slowly.\n\nKeep a question.\n\nReturn to the source.')});
  let now=Date.parse('2026-10-18T00:00:00Z');
  const service=services.createBookIntroductionService({library,generator,clock:()=>now,timeoutMs});
  return {dir,library,book,service,advance:ms=>now+=ms};
}

test('existing descriptions take precedence, and an ungenerated book has an honest empty state',()=>{
  assert.equal(typeof shared.introductionFor,'function');
  const book={...readingBook,description:'已存在的书目简介。',introduction:draft(readingBook)};
  assert.deepEqual(shared.introductionFor(book),{source:'provided',text:'已存在的书目简介。'});
  assert.equal(shared.introductionFor({...book,description:''}).source,'ai');
  assert.deepEqual(shared.introductionFor({...book,description:'',introduction:undefined}),{source:'missing',text:''});
});

test('AI provenance is whitelisted, version-bound, draft-only and linked to actual paragraphs',()=>{
  assert.equal(typeof shared.validateBookIntroduction,'function');
  assert.deepEqual(shared.validateBookIntroduction({...draft(readingBook),secret:'never export'},readingBook),draft(readingBook));
  for(const patch of [{origin:'user'},{status:'reviewed'},{contentVersion:'old'},{sourcePassageIds:['unknown']},{text:'x'.repeat(1201)},{model:'invented'},{createdAt:'yesterday'}])assert.throws(()=>shared.validateBookIntroduction({...draft(readingBook),...patch},readingBook));
});

test('stored provenance must refer to the actual bounded opening, not later or excluded paragraphs',()=>{
  const book=structuredClone(readingBook);
  book.sections[0].paragraphs=Array.from({length:10},(_,i)=>({...readingBook.sections[0].paragraphs[0],id:'p'+i,original:'Opening paragraph '+i}));
  book.sections=book.sections.slice(0,1);
  assert.deepEqual(shared.introductionContext(book).passages.map(p=>p.id),['p0','p1','p2','p3','p4','p5']);
  assert.throws(()=>shared.validateBookIntroduction({...draft(book),sourcePassageIds:['p9']},book),e=>e.status===400);
  const frontmatter={...structuredClone(book.sections[0]),chapterId:'front'};
  frontmatter.paragraphs=[{...frontmatter.paragraphs[0],id:'front-note'}];
  book.chapters.unshift({id:'front',kind:'frontmatter',title:{zh:'前言'}});book.sections.unshift(frontmatter);
  assert.throws(()=>shared.validateBookIntroduction({...draft(book),sourcePassageIds:['front-note']},book),e=>e.status===400);
  book.chapters.push({id:'appendix',kind:'appendix',title:{zh:'附录'}});book.sections.unshift({...frontmatter,chapterId:'appendix',paragraphs:[{...frontmatter.paragraphs[0],id:'appendix-note'}]});
  assert.throws(()=>shared.validateBookIntroduction({...draft(book),sourcePassageIds:['appendix-note']},book),e=>e.status===400);
});

test('trusted saved introduction remains readable while opening chapters are unloaded',()=>{
  const book=structuredClone(readingBook);book.introduction=draft(book);
  book.reading={loadedChapters:['ch02']};
  book.sections[0].paragraphs=book.sections[0].paragraphs.map(({original,...p})=>({...p,unloaded:true}));
  assert.deepEqual(shared.introductionFor(book),{source:'ai',text:book.introduction.text});
});

test('only bounded original opening and chapter metadata reach the model',()=>{
  assert.equal(typeof shared.introductionContext,'function');
  const book=structuredClone(readingBook);book.comments=[{text:'PRIVATE NOTE'}];book.history=['PRIVATE HISTORY'];book.sections[0].paragraphs=Array.from({length:30},(_,i)=>({id:'p'+i,original:'原文'.repeat(1000),translations:{literal:{text:'PRIVATE TRANSLATION'}}}));book.chapters=Array.from({length:40},(_,i)=>({id:'ch'+i,title:{zh:'目录'+i}}));
  const context=shared.introductionContext(book),encoded=JSON.stringify(context);
  assert.ok(context.passages.length<=6);assert.ok(context.passages.reduce((n,p)=>n+[...p.original].length,0)<=6000);assert.equal(context.chapters.length,24);
  for(const secret of ['PRIVATE NOTE','PRIVATE HISTORY','PRIVATE TRANSLATION'])assert.ok(!encoded.includes(secret));
});

test('PDF outlines and recognized source headings retain bounded introduction context',()=>{
  const pages=[{page:1,text:'Opening source. '.repeat(180)},{page:2,text:'Second source. '.repeat(180)}];
  for(const extracted of [
    {format:'pdf',review:'extracted_unreviewed',pages,outline:[{page:1,title:'Opening'},{page:2,title:'Continuation'}]},
    {format:'pdf',review:'extracted_unreviewed',pages:pages.map((page,i)=>({...page,blocks:[{text:'Chapter '+(i+1),type:'doc_title'},{text:page.text,type:'text'}]}))}
  ]){
    const book=makeBook({bookId:'source-heading-book',filename:'source.pdf',sourceHash:'source-version',extracted});
    assert.ok(book.chapters.every(c=>c.kind==='source-section'));
    const context=shared.introductionContext(book);
    assert.ok(context.passages.length>0,book.source.structure+' must retain its actual original');
    assert.ok(context.passages.length<=6);assert.ok(context.passages.reduce((n,p)=>n+[...p.original].length,0)<=6000);
  }
});

test('a real EPUB import can generate and restore its introduction from source sections',async t=>{
  const f=await fixture(t),files={
    mimetype:'application/epub+zip',
    'META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/package.opf':'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:introduction-test</dc:identifier><dc:title>Opening source</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
    'OPS/one.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Opening</title></head><body>'+Array.from({length:8},(_,i)=>'<p>Original opening paragraph '+i+'.</p>').join('')+'</body></html>'
  };
  const bytes=Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,strToU8(value)])),{level:0})),book=await f.library.importDocument(owner,{filename:'opening.epub',bytes});
  assert.equal(book.source.structure,'epub_spine');assert.ok(book.chapters.every(c=>c.kind==='source-section'));
  const generated=await f.service.generate(owner,book.bookId,{contentVersion:book.contentVersion});
  assert.equal(generated.source,'ai');assert.deepEqual(generated.introduction.sourcePassageIds,book.sections.flatMap(s=>s.paragraphs).slice(0,6).map(p=>p.id));
  const clean=await createLibraryService({dataDir:path.join(f.dir,'epub-restored'),catalogDir:null});await clean.restoreLibrary(owner,await f.library.exportLibrary(owner));
  assert.deepEqual((await clean.getBook(owner,book.bookId)).introduction,generated.introduction);
});

test('generation persists an account draft, is idempotent, and does not mutate source/records',async t=>{
  let calls=0;const f=await fixture(t,{generator:async job=>{calls++;assert.equal(job.book.bookId,f.book.bookId);return {text:'开头呈现了阅读与提问之间的联系。'};}});
  const before=await f.library.records(owner,f.book.bookId);
  const first=await f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion});
  assert.equal(first.introduction.status,'draft');assert.equal(first.introduction.origin,'ai');
  assert.equal((await f.library.getBook(owner,f.book.bookId)).description,undefined);
  assert.equal((await f.library.getBook(owner,f.book.bookId)).introduction.text,first.introduction.text);
  assert.deepEqual(await f.library.records(owner,f.book.bookId),before);
  assert.deepEqual(await f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),first);assert.equal(calls,1);
});

test('reading existing metadata never starts a generation, including a provided description',async t=>{
  let calls=0;const f=await fixture(t,{generator:async()=>{calls++;throw Error('must not call');}});
  assert.equal((await f.service.view(owner,f.book.bookId)).source,'missing');assert.equal(calls,0);
  const library={...f.library,getBook:async()=>({...f.book,description:'目录中已有介绍。'})};
  const service=services.createBookIntroductionService({library,generator:async()=>{calls++;throw Error();}});
  assert.equal((await service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion})).source,'provided');assert.equal(calls,0);
});

test('anonymous, other account, stale version and arbitrary generation inputs are rejected first',async t=>{
  let calls=0;const f=await fixture(t,{generator:async()=>{calls++;return {text:'正文介绍'};}});
  for(const user of [null,other])await assert.rejects(f.service.generate(user,f.book.bookId,{contentVersion:f.book.contentVersion}),e=>[401,404].includes(e.status));
  await assert.rejects(f.service.generate(owner,f.book.bookId,{contentVersion:'older'}),e=>e.status===409);
  for(const input of [null,[],{}, {contentVersion:f.book.contentVersion,prompt:'read my private notes'}])await assert.rejects(f.service.generate(owner,f.book.bookId,input),e=>e.status===400);
  assert.equal(calls,0);
});

test('two service instances cannot generate the same active book twice',async t=>{
  let finish,started;const running=new Promise(r=>started=r);let calls=0;
  const f=await fixture(t,{generator:async()=>{calls++;started();return new Promise(r=>finish=r);}});
  const secondLibrary=await createLibraryService({dataDir:path.join(f.dir,'library'),catalogDir:null});
  const second=services.createBookIntroductionService({library:secondLibrary,generator:async()=>{calls++;return {text:'不应生成第二次'};},clock:()=>Date.parse('2026-10-18T00:00:00Z')});
  const first=f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion});await running;
  await assert.rejects(second.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),e=>e.status===409);assert.equal(calls,1);
  finish({text:'同一本书的初稿。'});await first;
});

test('model failure leaves no draft, releases its lease, and allows an explicit retry',async t=>{
  let calls=0;const f=await fixture(t,{generator:async()=>{if(++calls===1)throw Error('provider private detail');return {text:'稍后明确重试的简介。'};}});
  await assert.rejects(f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),e=>e.status===502&&!e.message.includes('provider private detail'));
  assert.equal((await f.service.view(owner,f.book.bookId)).source,'missing');
  assert.equal((await f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion})).source,'ai');assert.equal(calls,2);
});

test('a timed out provider that ignores cancellation cannot publish late',async t=>{
  let finish;const f=await fixture(t,{timeoutMs:20,generator:async()=>new Promise(r=>finish=r)});
  await assert.rejects(f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),e=>e.status===504);
  finish({text:'已经过期的回答。'});await new Promise(r=>setTimeout(r,10));
  assert.equal((await f.service.view(owner,f.book.bookId)).source,'missing');
});

test('logout and source revisions are rechecked before saving',async t=>{
  for(const condition of ['logout','version']){
    let finish,started;const running=new Promise(r=>started=r);const f=await fixture(t,{generator:async()=>{started();return new Promise(r=>finish=r);}});
    const original=f.library.getBook;let authorized=true;
    const pending=f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion},{authorize:async()=>authorized});await running;
    if(condition==='logout')authorized=false;else f.library.getBook=async(...args)=>({...await original(...args),contentVersion:'new-source'});
    finish({text:'旧请求不能保存的简介。'});await assert.rejects(pending,e=>[401,409].includes(e.status));f.library.getBook=original;
    assert.equal((await f.service.view(owner,f.book.bookId)).source,'missing');
  }
});

test('account hourly quota survives service recreation and rejects the sixth failed attempt',async t=>{
  const f=await fixture(t,{generator:async()=>{throw Error('failed');}});
  for(let i=0;i<5;i++)await assert.rejects(f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),e=>e.status===502);
  const fresh=services.createBookIntroductionService({library:f.library,generator:async()=>({text:'不应生成'}),clock:()=>Date.parse('2026-10-18T00:00:00Z')});
  await assert.rejects(fresh.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),e=>e.status===429);
  f.advance(3600001);assert.equal((await f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}).catch(e=>e)).status,502);
});

test('AI draft backup restores into a clean instance without changing source or personal records',async t=>{
  const f=await fixture(t);await f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion});
  await f.library.addComment(owner,f.book.bookId,{id:'keep-note',passageId:f.book.sections[0].paragraphs[0].id,text:'Only my note.'});
  const backup=await f.library.exportLibrary(owner),clean=await createLibraryService({dataDir:path.join(f.dir,'restored'),catalogDir:null});
  assert.equal(backup.books[0].book.introduction.status,'draft');await clean.restoreLibrary(owner,backup);
  assert.deepEqual((await clean.getBook(owner,f.book.bookId)).introduction,backup.books[0].book.introduction);
  assert.deepEqual((await clean.getBook(owner,f.book.bookId)).sections,backup.books[0].book.sections);assert.deepEqual((await clean.records(owner,f.book.bookId)).comments,backup.books[0].records.comments);
  const invalid=structuredClone(backup);invalid.books[0].book.introduction.status='reviewed';const empty=await createLibraryService({dataDir:path.join(f.dir,'invalid'),catalogDir:null});
  await assert.rejects(empty.restoreLibrary(owner,invalid),e=>e.status===400);assert.equal((await empty.list(owner)).length,0);
});

test('restore rejects later-paragraph provenance before any write, including preserveExisting',async t=>{
  const f=await fixture(t);
  const book=await f.library.importDocument(owner,{filename:'ten-paragraphs.txt',bytes:Buffer.from(Array.from({length:10},(_,i)=>'Paragraph number '+i+'.').join('\n\n'))});
  await f.service.generate(owner,book.bookId,{contentVersion:book.contentVersion});
  const backup=await f.library.exportLibrary(owner),entry=backup.books.find(row=>row.book.bookId===book.bookId);
  const original=structuredClone(entry.book.introduction);
  entry.book.introduction.sourcePassageIds=[book.sections.flatMap(s=>s.paragraphs).at(-1).id];
  const empty=await createLibraryService({dataDir:path.join(f.dir,'invalid-provenance'),catalogDir:null});
  await assert.rejects(empty.restoreLibrary(owner,backup),e=>e.status===400);
  assert.equal((await empty.list(owner)).length,0);
  await assert.rejects(f.library.restoreLibrary(owner,backup,{preserveExisting:true}),e=>e.status===400);
  assert.deepEqual((await f.library.getBook(owner,book.bookId)).introduction,original);
});

test('existing gifts omit the private AI introduction overlay',async t=>{
  const f=await fixture(t);await f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion});
  const {createBookGifts}=await import('../server/book-gifts.mjs'),gifts=createBookGifts({library:f.library,dataDir:path.join(f.dir,'gifts')});
  const gift=await gifts.create(owner,f.book.bookId,{}),snapshot=await gifts.download(gift.token);
  assert.ok(!Object.hasOwn(snapshot.books[0].book,'introduction'));assert.ok(!JSON.stringify(snapshot).includes('开头呈现了阅读与提问之间的联系'));
});

test('worst-case Unicode metadata still fits the existing 24 KiB Harness envelope',()=>{
  const book=structuredClone(readingBook);book.title={zh:'题'.repeat(500),en:'名'.repeat(500)};book.author='人'.repeat(500);book.chapters=Array.from({length:24},(_,i)=>({id:'ch'+i,title:{zh:'目'.repeat(200),en:'录'.repeat(200)}}));book.sections[0].paragraphs[0].original='文'.repeat(10000);
  const context=shared.introductionContext(book);assert.ok(Buffer.byteLength(JSON.stringify(context))<=18000);assert.ok(context.passages.length>0);
});

test('cancelling during response reauthorization cannot publish the already-returned model result',async t=>{
  let reauthorize,entered;const stopped=new Promise(r=>entered=r),controller=new AbortController();let calls=0;
  const f=await fixture(t);const pending=f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion},{signal:controller.signal,authorize:async()=>{if(++calls===1)return true;entered();return new Promise(r=>reauthorize=r);}});
  await stopped;controller.abort();reauthorize(true);await assert.rejects(pending,e=>e.status===409);assert.equal((await f.service.view(owner,f.book.bookId)).source,'missing');
});

test('independent Node processes cannot simultaneously claim one introduction lease',async t=>{
  const f=await fixture(t),dir=path.join(f.dir,'library','book-introductions'),module=new URL('../server/book-introduction-store.mjs',import.meta.url).href;
  const script=`import {createBookIntroductionStore} from ${JSON.stringify(module)}; const s=createBookIntroductionStore({dataDir:process.argv[1]}); try{await s.claim({id:'introduction-owner'},JSON.parse(process.argv[2]),process.argv[3],Date.now(),60000);console.log('claimed');}catch(e){console.log('denied:'+e.status);}`;
  const run=promisify(execFile),results=await Promise.all(['one','two'].map(n=>run(process.execPath,['--input-type=module','-e',script,dir,JSON.stringify(f.book),n])));
  assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),['claimed','denied:409']);
});

test('an expired nonce cannot finish or release the replacement lease',async t=>{
  const f=await fixture(t),s=f.library.introductions,now=Date.parse('2026-10-18T00:00:00Z');
  await s.claim(owner,f.book,'expired',now,10);await s.claim(owner,f.book,'replacement',now+11,60000);await s.release(owner,f.book,'expired');
  await assert.rejects(s.complete(owner,f.book,'expired',draft(f.book),now+12),e=>e.status===409);
  assert.equal((await s.complete(owner,f.book,'replacement',draft(f.book),now+13)).status,'draft');
});

test('shared capacity is atomic across different books and is released after completion',async t=>{
  const waiting=[];let ready;const started=new Promise(r=>ready=r);const f=await fixture(t,{generator:async()=>{const result=new Promise(r=>waiting.push(r));if(waiting.length===2)ready();return result;}});
  const b=await f.library.importDocument(owner,{filename:'second.txt',bytes:Buffer.from('Another source.')}),c=await f.library.importDocument(other,{filename:'third.txt',bytes:Buffer.from('Third source.')});
  const first=f.service.generate(owner,f.book.bookId,{contentVersion:f.book.contentVersion}),second=f.service.generate(owner,b.bookId,{contentVersion:b.contentVersion});await started;
  await assert.rejects(f.service.generate(other,c.bookId,{contentVersion:c.contentVersion}),e=>e.status===429);
  for(const done of waiting)done({text:'当前原文的有限取样介绍。'});await Promise.all([first,second]);
  const clean=services.createBookIntroductionService({library:f.library,generator:async()=>({text:'额度释放后的介绍。'}),clock:()=>Date.parse('2026-10-18T00:00:00Z')});assert.equal((await clean.generate(other,c.bookId,{contentVersion:c.contentVersion})).source,'ai');
});

test('generator adapter pins one request, no tools/history and the frozen budget',async()=>{
  const {createIntroductionGenerator}=await import('../harness/introduction-generator.mjs');let config,job;
  const generate=createIntroductionGenerator({makeGenerator:options=>{config=options;return async value=>{job=value;return {summary:'{"text":"根据正文取样的介绍。"}'};};}});
  assert.deepEqual(await generate({book:readingBook,context:{title:'source only'},history:[{role:'user',content:'PRIVATE'}]}),{text:'根据正文取样的介绍。'});
  for(const [key,value]of Object.entries({maxRequests:1,maxToolCalls:0,maxTokens:600,maxCostCny:.1,timeoutMs:60000}))assert.equal(config[key],value);
  assert.deepEqual(job.tools.definitions,[]);assert.deepEqual(job.history,[]);assert.equal(job.text,'{"title":"source only"}');
});
