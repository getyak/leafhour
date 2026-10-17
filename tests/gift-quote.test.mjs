import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBookGifts} from '../server/book-gifts.mjs';
import {createGiftQuoteService,createDeepSeekGiftQuoteGenerator,buildQuotePool,deterministicQuote,validateGiftQuoteSelection,codePointLength,MAX_QUOTE_CODEPOINTS,QUOTE_POOL_LIMITS,MAX_PROVIDER_RESPONSE_BYTES} from '../server/gift-quote.mjs';
import {DEFAULT_MODELS} from '../server/model-config.mjs';
import {readingBook} from './reading-fixtures.mjs';

const owner={id:'quote-sender',email:'sender@example.invalid'},receiver={id:'quote-recipient'};
const RECEIPT=/^[A-Za-z0-9_-]{32}$/;
const clock=()=>{let time=Date.parse('2026-10-18T04:00:00.000Z');return {now:()=>new Date(time),advance:minutes=>{time+=minutes*60000;}};};
async function harness(t,{generator=null,fetcher=fetch,env={},timer=clock(),cacheLimit=16}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'gift-quote-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const books=new Map();
  const library={getBook:async(user,id)=>{const saved=books.get((user?.id||'guest')+'\n'+id);if(!saved)throw Object.assign(Error('找不到这本书'),{status:404});return structuredClone(saved);}};
  const gifts=createBookGifts({library,dataDir:path.join(dir,'gifts'),now:timer.now});
  const quotes=createGiftQuoteService({library,gifts,generator,fetcher,env,now:timer.now,cacheLimit});
  return {dir,library,gifts,quotes,timer,register(user,book){books.set(user.id+'\n'+book.bookId,book);}};
}
const bookWith=(originals,bookId='reading-test')=>{
  const book=structuredClone(readingBook);book.bookId=bookId;book.privateNotes=['PRIVATE NOTE'];
  book.sections.forEach((section,index)=>{section.paragraphs=(originals[index]||[]).map((text,i)=>({id:'p'+(index*2+i+1),original:text,translations:{},annotationIds:[],termIds:[]}));});
  return book;
};
const fixtureBook=()=>bookWith([['Read this first.','Keep your own question.'],['Continue from here.','This is the closing paragraph.']]);
const selectFirstWord=payload=>{const entry=payload.pool[0],text=entry.text.slice(0,entry.text.indexOf(' '));return {bookId:payload.bookId,contentVersion:payload.contentVersion,passageId:entry.passageId,chapterId:entry.chapterId,start:0,end:codePointLength(text),text};};
const select=(text,poolIndex=0,start=0)=>(payload)=>{const entry=payload.pool[poolIndex]||payload.pool[0];return {bookId:payload.bookId,contentVersion:payload.contentVersion,passageId:entry.passageId,chapterId:entry.chapterId,start,end:start+codePointLength(text),text};};

test('the default quotation is a bounded source selection with honest attribution and no publication',async t=>{
  let request=null,calls=0;
  const generator=async payload=>{calls++;request=payload;return select('Read this first.')(payload);};
  const h=await harness(t,{generator}),book=fixtureBook();h.register(owner,book);
  const result=await h.quotes.prepare(owner,book.bookId);
  assert.equal(result.kind,'marginalia-gift-quote');assert.equal(result.schemaVersion,1);assert.equal(result.bookId,book.bookId);assert.equal(result.contentVersion,book.contentVersion);
  assert.equal(result.quote.selection,'ai-selected');assert.equal(result.quote.text,'Read this first.');assert.equal(result.quote.passageId,'p1');assert.equal(result.quote.chapterTitle,'Opening');
  assert.match(result.quote.receipt,RECEIPT);assert.equal(Date.parse(result.quote.expiresAt),Date.parse('2026-10-18T04:15:00.000Z'));
  assert.equal(calls,1);
  assert.ok(request.pool.length<=8,'pool keeps at most 8 passages');assert.ok(request.pool.reduce((n,p)=>n+p.text.length,0)<=12000,'pool stays bounded');
  assert.deepEqual(request.pool.map(p=>p.passageId),['p1','p2','p3','p4'],'passage and chapter identity travel with the pool');
  const sent=JSON.stringify(request);assert.ok(!sent.includes('PRIVATE NOTE'),'private notes never enter the selection request');assert.ok(!sent.includes('gutenberg-alice'));
  assert.deepEqual(await h.gifts.list(owner,book.bookId),[],'preparing a quotation never creates a link or gift');
});

test('forged model selections fall back to a deterministic sentence of this very book',async t=>{
  const source=fixtureBook(),pool=buildQuotePool(source),valid=select('Read this first.')({bookId:source.bookId,contentVersion:source.contentVersion,pool});
  const candidates=[
    {...valid,text:'A paraphrase the source never contains.'},
    {...valid,bookId:'gutenberg-alice'},
    {...valid,contentVersion:'edition-2'},
    {...valid,passageId:'<script>alert(1)</script>'},
    {...valid,chapterId:'ch99'},
    {...valid,start:-1,end:16},
    {...valid,start:8,end:4},
    {...valid,start:0,end:999},
    {...valid,start:'0',end:'16'},
    {...valid,text:valid.text+' '},
    {selection:'ai-selected'},
    null,
  ];
  for(const candidate of candidates){
    const h=await harness(t,{generator:async()=>candidate}),book=fixtureBook();h.register(owner,book);
    const result=await h.quotes.prepare(owner,book.bookId);
    assert.equal(result.quote.selection,'original-excerpt','never claim AI selection: '+JSON.stringify(candidate));
    assert.equal(result.quote.text,'Read this first.');
  }
});

test('markup cannot become a quotation, while clean excerpts survive Unicode slicing',async t=>{
  const marked=bookWith([['<img src=x onerror=alert(1)> is not a quotation.','Second sentence stays.'],['Continue from here.','This is the closing paragraph.']]);
  let h=await harness(t,{generator:async payload=>select('<img src=x onerror=alert(1)>')(payload)});h.register(owner,marked);
  let result=await h.quotes.prepare(owner,marked.bookId);
  assert.equal(result.quote.selection,'original-excerpt');assert.equal(result.quote.text,'Second sentence stays.','the fallback skips markup and stays plain source text');
  const unicode=bookWith([['澄澈的天空😀，继续读下去。这一句很长。','Tail.'],['Continue from here.','This is the closing paragraph.']]);
  const cps=[...unicode.sections[0].paragraphs[0].original],text=cps.slice(3,7).join('');
  assert.equal(text,'天空😀，');assert.equal(codePointLength(text),4);assert.equal(codePointLength('😀'),1);
  h=await harness(t,{generator:async payload=>{const entry=payload.pool[0];return {bookId:payload.bookId,contentVersion:payload.contentVersion,passageId:entry.passageId,chapterId:entry.chapterId,start:3,end:7,text};}});h.register(owner,unicode);
  result=await h.quotes.prepare(owner,unicode.bookId);
  assert.equal(result.quote.selection,'ai-selected');assert.equal(result.quote.text,'天空😀，');assert.equal(result.quote.codepoints,4);
  // Offsets counted in UTF-16 units cannot claim the code point text: the
  // equality check slices by code points and fails closed.
  h=await harness(t,{generator:async payload=>{const entry=payload.pool[0];return {bookId:payload.bookId,contentVersion:payload.contentVersion,passageId:entry.passageId,chapterId:entry.chapterId,start:3,end:8,text};}});h.register(owner,unicode);
  result=await h.quotes.prepare(owner,unicode.bookId);
  assert.equal(result.quote.selection,'original-excerpt');assert.ok(!result.quote.text.includes('😀')||result.quote.text.endsWith('。'));
  const long='字'.repeat(MAX_QUOTE_CODEPOINTS+1);
  const longBook=bookWith([[long+'尾巴。','Tail.'],['Continue from here.','This is the closing paragraph.']]);
  h=await harness(t,{generator:async payload=>select(long)(payload)});h.register(owner,longBook);
  result=await h.quotes.prepare(owner,longBook.bookId);
  assert.equal(result.quote.selection,'original-excerpt');assert.ok([...result.quote.text].length<=MAX_QUOTE_CODEPOINTS);
});

test('a missing provider, a timeout and broken provider output all use the same source-bound fallback',async t=>{
  const generators=[null,async()=>{throw Error('timeout');},async()=>({passageId:'p1'}),async()=>({})];
  let previous=null;
  for(const generator of generators){
    const h=await harness(t,{generator}),book=fixtureBook();h.register(owner,book);
    const result=await h.quotes.prepare(owner,book.bookId);
    assert.equal(result.quote.selection,'original-excerpt');assert.equal(result.quote.text,'Read this first.');assert.equal(result.quote.passageId,'p1');assert.equal(result.quote.chapterTitle,'Opening');
    if(previous)assert.equal(result.quote.text,previous,'the fallback is deterministic');
    previous=result.quote.text;
  }
});

test('every book falls back to its own text and an empty source leaves no quotation at all',async t=>{
  let calls=0;const generator=async()=>{calls++;throw Error('no provider');};
  const h=await harness(t,{generator});
  h.register(owner,bookWith([['Alice was beginning to get very tired.','Other.'],['More.','End.']],'alice-book'));
  h.register(receiver,fixtureBook());
  const one=await h.quotes.prepare(owner,'alice-book'),two=await h.quotes.prepare(receiver,'reading-test');
  assert.equal(one.quote.text,'Alice was beginning to get very tired.');assert.equal(two.quote.text,'Read this first.');
  h.register(owner,bookWith([['   ',''],['','']],'empty-source'));
  const none=await h.quotes.prepare(owner,'empty-source');
  assert.equal(none.quote,null);assert.equal(none.bookId,'empty-source');
  assert.equal(calls,2,'an empty source never reaches the provider');
});

test('duplicate in-flight and repeated prepares coalesce per owner and version without leaking across owners',async t=>{
  let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
  const generator=async payload=>{calls++;await gate;return selectFirstWord(payload);};
  const h=await harness(t,{generator}),mine=fixtureBook(),theirs=fixtureBook();theirs.sections[0].paragraphs[0].original='Their own opening line.';
  h.register(owner,mine);h.register(receiver,theirs);
  const pending=[h.quotes.prepare(owner,mine.bookId),h.quotes.prepare(owner,mine.bookId)];
  const foreign=h.quotes.prepare(receiver,theirs.bookId);
  release();
  const [first,second]=await Promise.all(pending),other=await foreign;
  assert.equal(calls,2,'same owner/book/version shares one provider call; another owner never shares');
  assert.equal(first.quote.receipt,second.quote.receipt);assert.equal(first.quote.text,'Read');
  assert.equal(other.quote.text,'Their');
  const cached=await h.quotes.prepare(owner,mine.bookId);assert.equal(calls,2,'a repeat prepare reuses the bounded cache');assert.equal(cached.quote.text,'Read');
});

test('the selection cache is bounded and re-reads a source it has evicted',async t=>{
  let calls=0;const generator=async payload=>{calls++;return selectFirstWord(payload);};
  const h=await harness(t,{generator,cacheLimit:2}),book=fixtureBook();
  for(let version=1;version<=3;version++){h.register(owner,{...fixtureBook(),contentVersion:'edition-'+version});await h.quotes.prepare(owner,book.bookId);}
  assert.equal(calls,3);
  h.register(owner,{...fixtureBook(),contentVersion:'edition-1'});
  await h.quotes.prepare(owner,book.bookId);assert.equal(calls,4,'the oldest cache entry is evicted rather than growing without bound');
});

test('prepared selections expire, stay private to their owner and fail closed when forged',async t=>{
  const h=await harness(t),book=fixtureBook();h.register(owner,book);h.register(owner,bookWith([['Read this first.','Keep your own question.'],['Continue from here.','This is the closing paragraph.']],'other-book'));
  h.register(receiver,bookWith([['Their own opening line.','Keep.'],['Continue from here.','This is the closing paragraph.']],'receiver-book'));
  const prepared=await h.quotes.prepare(owner,book.bookId),receipt=prepared.quote.receipt;
  await assert.rejects(h.gifts.create(owner,book.bookId,{quoteReceipt:'x'.repeat(32)}),e=>e.status===409);
  await assert.rejects(h.gifts.create(owner,book.bookId,{quoteReceipt:receipt+'A'}),e=>e.status===400);
  await assert.rejects(h.gifts.create(receiver,'receiver-book',{quoteReceipt:receipt}),e=>e.status===409,'another owner can never redeem this receipt');
  await assert.rejects(h.gifts.create(owner,'other-book',{quoteReceipt:receipt}),e=>e.status===409,'a receipt is bound to its own book');
  const forged=await h.gifts.create(owner,book.bookId,{quoteReceipt:receipt,quoteText:'FORGED BY CLIENT',quote:{text:'FORGED',selection:'ai-selected'}});
  assert.equal(forged.quote.text,'Read this first.');assert.equal(forged.quote.selection,'original-excerpt','the honest label comes from the prepared record, never from the client');
  h.timer.advance(16);
  await assert.rejects(h.gifts.create(owner,book.bookId,{quoteReceipt:receipt}),e=>e.status===409,'receipts expire after fifteen minutes');
});

test('sealing reloads the prepared excerpt and revalidates it against the exact snapshot',async t=>{
  let calls=0;const generator=async payload=>{calls++;return select('Read this first.')(payload);};
  const h=await harness(t,{generator}),book=fixtureBook();h.register(owner,book);
  const prepared=await h.quotes.prepare(owner,book.bookId);
  h.register(owner,bookWith([['Read this first, revised.','Keep your own question.'],['Continue from here.','This is the closing paragraph.']]));
  await assert.rejects(h.gifts.create(owner,book.bookId,{quoteReceipt:prepared.quote.receipt}),e=>e.status===409,'a changed snapshot cannot carry a prepared excerpt');
  h.register(owner,{...fixtureBook(),contentVersion:'edition-2'});
  await assert.rejects(h.gifts.create(owner,book.bookId,{quoteReceipt:prepared.quote.receipt}),e=>e.status===409,'a new content version cannot reuse an old selection');
  assert.equal(calls,1,'sealing never charges the provider again');
});

test('preview to seal to view to revoke stores only the excerpt and its locator',async t=>{
  const h=await harness(t,{generator:async payload=>select('Read this first.')(payload)}),book=fixtureBook();h.register(owner,book);
  const prepared=await h.quotes.prepare(owner,book.bookId);
  const gift=await h.gifts.create(owner,book.bookId,{recipient:'小林',message:'读到这里时，想起了你。',includeTranslations:true,quoteReceipt:prepared.quote.receipt});
  assert.deepEqual(gift.quote,{text:'Read this first.',selection:'ai-selected',chapterTitle:'Opening',passageId:'p1',start:0,end:16});
  const view=await h.gifts.view(gift.token);
  assert.deepEqual(view.quote,gift.quote);
  const encoded=JSON.stringify(view);assert.ok(!encoded.includes(prepared.quote.receipt),'the private receipt never leaves the sender storage');assert.ok(!encoded.includes('PRIVATE NOTE'));
  const backup=await h.gifts.download(gift.token);assert.equal(backup.books[0].book.sections[0].paragraphs[0].original,'Read this first.');
  await h.gifts.revoke(owner,gift.token);await assert.rejects(h.gifts.view(gift.token),e=>e.status===404);
  const plain=await h.gifts.create(owner,book.bookId,{});
  assert.equal(plain.quote,undefined);assert.equal((await h.gifts.view(plain.token)).quote,undefined,'letters without a quotation render normally');
});

test('prepared selections are pruned to a bound instead of growing in the owner store',async t=>{
  const h=await harness(t),book=bookWith([['abcdefghijklmnopqrstuvwxyz0123456789','Tail.'],['Continue from here.','This is the closing paragraph.']]);h.register(owner,book);
  const original=book.sections[0].paragraphs[0].original,receipts=[];
  for(let start=0;start<25;start++){
    const text=[...original].slice(start,start+4).join('');
    const prepared=await h.gifts.prepareQuote(owner,{bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'ch01',chapterTitle:'Opening',passageId:'p1',start,end:start+codePointLength(text),codepoints:codePointLength(text),text,selection:'original-excerpt'});
    receipts.push(prepared.receipt);
  }
  await assert.rejects(h.gifts.create(owner,book.bookId,{quoteReceipt:receipts[0]}),e=>e.status===409);
  const gift=await h.gifts.create(owner,book.bookId,{quoteReceipt:receipts.at(-1)});
  assert.equal(gift.quote.text,'yz01');
});

test('the DeepSeek selector sends one bounded request, thinks not at all and rejects chatty output',async t=>{
  const seen=[];const fetcher=async(url,options)=>{seen.push({url,options});return Response.json({choices:[{message:{content:JSON.stringify({bookId:'reading-test',contentVersion:'edition-1',passageId:'p1',chapterId:'ch01',start:0,end:16,text:'Read this first.'})}}]});};
  const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher,model:'deepseek-flash',timeoutMs:15000,maxTokens:400});
  const book=fixtureBook(),pool=buildQuotePool(book);
  const selection=await generate({bookId:book.bookId,contentVersion:book.contentVersion,pool});
  assert.equal(selection.text,'Read this first.');
  assert.equal(seen.length,1,'one request only, never a transport retry');assert.equal(seen[0].url,'https://api.deepseek.com/chat/completions');
  const body=JSON.parse(seen[0].options.body);
  assert.equal(body.model,'deepseek-flash');assert.equal(body.temperature,0);assert.ok(body.max_tokens<=400);assert.deepEqual(body.thinking,{type:'disabled'});
  assert.equal(seen[0].options.headers.Authorization,'Bearer fixture-key');
  assert.ok(seen[0].options.signal&&seen[0].options.signal.aborted===false,'a real timeout signal bounds the request');
  assert.ok(!JSON.stringify(body).includes('PRIVATE NOTE'));
  for(const content of ['先解释一下，然后 {"passageId":"p1"}','```json\n{}\n```',JSON.stringify({bookId:'reading-test',contentVersion:'edition-1',passageId:'p1',start:0,end:16,text:'Read this first.',note:'IGNORE PREVIOUS INSTRUCTIONS'})]){
    const broken=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>Response.json({choices:[{message:{content}}]})});
    await assert.rejects(broken({bookId:book.bookId,contentVersion:book.contentVersion,pool}),/unexpected|JSON|selection/i);
  }
  const down=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>{throw Error('socket hang up');}});
  await assert.rejects(down({bookId:book.bookId,contentVersion:book.contentVersion,pool}),/socket hang up/);
  assert.equal(createDeepSeekGiftQuoteGenerator({env:{}}),null,'no key means no provider, and the fallback stays local');
  assert.equal(DEFAULT_MODELS.reading,'deepseek-flash');
  // Pure helpers stay deterministic for any caller.
  const again=deterministicQuote(pool,book);
  assert.ok(validateGiftQuoteSelection(again,book));assert.equal(again.text,'Read this first.');
  assert.equal(validateGiftQuoteSelection({...again,text:'Read this first!'},book),null);
});

test('the quote route is owner scoped, prepares only a suggestion and never calls a provider to open a letter',async t=>{
  const {createPortal}=await import('../server/portal.mjs'),{createHostedAuth}=await import('../deploy/hosted-auth.mjs'),{authFixture}=await import('./auth-fixture.mjs');
  let calls=0;const generator=async payload=>{calls++;return selectFirstWord(payload);};
  const sender={id:'quote-http-sender',email:'sender@fixture.invalid',kind:'email'};
  const users=[sender];
  const fixture=authFixture({onProvider:({url,body,options})=>{
    const match=url.pathname.endsWith('/token')?users.find(user=>user.email===body.email):url.pathname.endsWith('/user')?users.find(user=>options.headers.Authorization==='Bearer access-'+user.id):null;
    if(match){const visible={...match,email_confirmed_at:'2026-10-15T00:00:00Z',user_metadata:{full_name:match.id},app_metadata:{provider:'email'}};return Response.json(url.pathname.endsWith('/user')?visible:{user:visible,access_token:'access-'+match.id,refresh_token:'refresh-'+match.id,expires_in:3600});}
  }}),dataDir=await mkdtemp(path.join(tmpdir(),'gift-quote-http-')),auth=createHostedAuth({...fixture,store:fixture.store()});
  const portal=await createPortal({dataDir,catalogDir:null,publicOrigin:fixture.env.READER_PUBLIC_ORIGIN,allowLocal:false,dataStore:fixture.store(),authService:auth,translator:null,chatGenerator:null,giftQuoteGenerator:generator});
  const server=createServer(async(req,res)=>{
    const send=(status,body,type='application/json')=>{res.statusCode=status;res.setHeader('Content-Type',type+'; charset=utf-8');res.end(type==='application/json'?JSON.stringify(body):body);};
    try{if(!await portal.handle({req,res,url:new URL(req.url,fixture.env.READER_PUBLIC_ORIGIN),send}))send(404,{error:'missing'});}catch(error){send(error.status||500,{error:error.message});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body,cookie)=>fetch(base+route,{method:'POST',headers:{Origin:fixture.env.READER_PUBLIC_ORIGIN,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body||{})});
  const get=(route,cookie)=>fetch(base+route,{headers:cookie?{Cookie:cookie}:{}});
  const signed=await post('/api/auth/password',{email:sender.email,password:'fixture-password'});
  assert.equal(signed.status,200);const session=signed.headers.get('set-cookie').split(';')[0];
  const seeded=fixtureBook();seeded.bookId='quote-http-book';seeded.visibility='private';
  await portal.library.restoreLibrary(sender,{kind:'marginalia-library',schemaVersion:1,books:[{book:seeded,records:{kind:'marginalia-personal-records',schemaVersion:3,bookId:seeded.bookId,contentVersion:seeded.contentVersion,comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null}}]});
  const route='/api/library/books/'+seeded.bookId+'/gift-quote';
  assert.equal((await post(route)).status,401,'preparing requires the authenticated owner');
  assert.equal((await post(route,{},session.replace(/=[^;]*/,'=wrong-session'))).status,401);
  const response=await post(route,{},session);assert.equal(response.status,200);
  const payload=await response.json();assert.equal(payload.kind,'marginalia-gift-quote');assert.match(payload.quote.receipt,RECEIPT);
  assert.ok(!JSON.stringify(payload).includes('fixture-key')&&!JSON.stringify(payload).includes('DEEPSEEK'));
  assert.equal(calls,1,'one bounded provider call for the owner');
  assert.deepEqual((await (await get('/api/library/books/'+seeded.bookId+'/gifts',session)).json()).gifts,[],'a prepared quotation is not a gift');
  const letter=await post('/api/library/books/'+seeded.bookId+'/gifts',{quoteReceipt:payload.quote.receipt},session);assert.equal(letter.status,201);
  const gift=await letter.json();assert.equal(gift.quote.text,payload.quote.text);
  const before=calls;const opened=await get('/api/book-gifts/'+gift.token);assert.equal(opened.status,200);
  assert.equal((await opened.json()).quote.text,payload.quote.text);assert.equal(calls,before,'opening a received letter never calls a provider');
  for(const asset of ['/gift-quote.mjs','/gift-waves.mjs','/book-gift.mjs'])assert.equal((await get(asset)).status,200,asset);
  const again=await post(route,{},session);assert.equal(again.status,200);
  assert.equal(calls,1,'the bounded cache serves the same owner/book/version');
});

const paragraph=id=>text=>({id,original:text,translations:{},annotationIds:[],termIds:[]});
const singleSection=paragraphs=>{const book=structuredClone(readingBook);book.sections=[{number:1,chapterId:'ch01',paragraphs}];return book;};
test('a selection outside the submitted pool or beyond its submitted prefix cannot claim the AI label',async t=>{
  const paragraphs=Array.from({length:9},(_,i)=>paragraph('p'+(i+1))('Passage number '+(i+1)+' for the pool.'));
  const book=singleSection(paragraphs),pool=buildQuotePool(book);
  assert.deepEqual(pool.map(row=>row.passageId),['p1','p2','p3','p4','p5','p6','p7','p8']);
  const ninth={bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'ch01',passageId:'p9',start:0,end:7,text:'Passage',selection:'ai-selected'};
  assert.ok(validateGiftQuoteSelection(ninth,book),'red: full-snapshot validation alone accepted a9th passage outside the pool');
  assert.equal(validateGiftQuoteSelection(ninth,book,{pool}),null,'green: the exact submitted pool rejects it');
  const long='x'.repeat(5000)+' Trailing tail.',longBook=singleSection([paragraph('p1')(long)]),longPool=buildQuotePool(longBook);
  assert.equal(codePointLength(longPool[0].text),QUOTE_POOL_LIMITS.maxPassageChars);
  const beyond={bookId:longBook.bookId,contentVersion:longBook.contentVersion,chapterId:'ch01',passageId:'p1',start:4900,end:4910,text:'x'.repeat(10),selection:'ai-selected'};
  assert.ok(validateGiftQuoteSelection(beyond,longBook),'red: full-snapshot validation alone accepted text beyond the submitted prefix');
  assert.equal(validateGiftQuoteSelection(beyond,longBook,{pool:longPool}),null,'green: the submitted prefix bound rejects it');
  for(const [candidate,source]of [[ninth,book],[beyond,longBook]]){
    const h=await harness(t,{generator:async()=>candidate});h.register(owner,source);
    const result=await h.quotes.prepare(owner,candidate.bookId);
    assert.equal(result.quote.selection,'original-excerpt','rejected pool escapes degrade to a source excerpt');
    assert.ok(result.quote.text.startsWith(candidate===ninth?'Passage number 1':'x'.repeat(10)),'the fallback stays source bound');
  }
  assert.ok(Object.isFrozen(QUOTE_POOL_LIMITS),'pool limits are fixed, never provider values');
});
test('the submitted prefix cuts on a code point boundary and keeps emoji intact',()=>{
  const book=singleSection([paragraph('p1')('a'.repeat(3999)+'😀'+'bcdef tail.')]),pool=buildQuotePool(book);
  assert.equal(codePointLength(pool[0].text),QUOTE_POOL_LIMITS.maxPassageChars);
  assert.ok(pool[0].text.endsWith('😀'),'a prefix cut never splits the emoji');
  assert.ok(pool[0].text.isWellFormed());
  const emoji={bookId:book.bookId,contentVersion:book.contentVersion,chapterId:'ch01',passageId:'p1',start:3999,end:4000,text:'😀',selection:'ai-selected'};
  assert.ok(validateGiftQuoteSelection(emoji,book,{pool}),'the last code point of the prefix is selectable');
  assert.equal(validateGiftQuoteSelection({...emoji,end:4001,text:'😀b'},book,{pool}),null,'a selection can never widen past the submitted prefix');
  assert.equal(validateGiftQuoteSelection({...emoji,text:'😀'},singleSection([paragraph('p1')('zz other book')]),{pool}),null);
});
test('oversized or unreadable provider responses stay bounded, cancel their bodies and fall back to an original excerpt',async t=>{
  const book=fixtureBook(),pool=buildQuotePool(book);
  const envelope=JSON.stringify({choices:[{message:{content:JSON.stringify({bookId:'reading-test',contentVersion:'edition-1',chapterId:'ch01',passageId:'p1',start:0,end:16,text:'Read this first.'})}}]});
  let fastCancelled=false;const fastChunk=new Uint8Array(64);
  const fastStream=new ReadableStream({start(controller){controller.enqueue(fastChunk);controller.close();},cancel(){fastCancelled=true;}});
  const declared=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>new Response(fastStream,{headers:{'content-length':String(MAX_PROVIDER_RESPONSE_BYTES+1)}})});
  await assert.rejects(declared({bookId:book.bookId,contentVersion:book.contentVersion,pool}),/too large/,'an oversized Content-Length is rejected before reading');
  assert.equal(fastCancelled,true,'the unconsumed body is cancelled on the Content-Length fast rejection');
  let cancelled=false;const chunk=new Uint8Array(8*1024);
  const stream=new ReadableStream({start(controller){for(let index=0;index<16;index++)controller.enqueue(chunk);controller.close();},cancel(){cancelled=true;}});
  const chunked=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>new Response(stream,{headers:{'content-type':'application/json'}})});
  await assert.rejects(chunked({bookId:book.bookId,contentVersion:book.contentVersion,pool}),/too large/,'a chunked oversize body is stopped at the byte budget');
  assert.equal(cancelled,true,'the oversize stream is cancelled and released');
  for(const fetcher of [async()=>new Response('SECRET-BODY-MARKER '.repeat(4000),{headers:{'content-length':String(MAX_PROVIDER_RESPONSE_BYTES*4)}}),async()=>new Response(new ReadableStream({start(controller){for(let index=0;index<16;index++)controller.enqueue(chunk);controller.close();}}))]){
    const h=await harness(t,{generator:null,env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher});h.register(owner,fixtureBook());
    const result=await h.quotes.prepare(owner,'reading-test');
    assert.equal(result.quote.selection,'original-excerpt','an unreadable body degrades to the source excerpt, never an AI label');
    assert.equal(result.quote.text,'Read this first.');
  }
  const leak=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>new Response('SECRET-BODY-MARKER'.repeat(100),{headers:{'content-length':String(MAX_PROVIDER_RESPONSE_BYTES+1)}})});
  await assert.rejects(leak({bookId:book.bookId,contentVersion:book.contentVersion,pool}),error=>!error.message.includes('SECRET-BODY-MARKER'),'the response body is never logged or echoed');
});
test('an error status cancels its unconsumed body and degrades to the original excerpt after one request',async t=>{
  const book=fixtureBook(),pool=buildQuotePool(book);
  let cancelled=false,requests=0;const chunk=new TextEncoder().encode('temporarily busy');
  const statusStream=()=>new ReadableStream({start(controller){controller.enqueue(chunk);controller.close();},cancel(){cancelled=true;}});
  const generate=createDeepSeekGiftQuoteGenerator({env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>{requests++;return new Response(statusStream(),{status:429,headers:{'content-type':'application/json'}});}});
  await assert.rejects(generate({bookId:book.bookId,contentVersion:book.contentVersion,pool}),/unavailable/);
  assert.equal(cancelled,true,'an error status still cancels its unconsumed body');
  assert.equal(requests,1,'one request only, never a transport retry');
  cancelled=false;let pipelineCalls=0;
  const h=await harness(t,{generator:null,env:{DEEPSEEK_API_KEY:'fixture-key'},fetcher:async()=>{pipelineCalls++;return new Response(statusStream(),{status:503,headers:{'content-type':'application/json'}});}});h.register(owner,book);
  const result=await h.quotes.prepare(owner,'reading-test');
  assert.equal(result.quote.selection,'original-excerpt','an error status degrades to the source excerpt, never an AI label');
  assert.equal(result.quote.text,'Read this first.');
  assert.equal(pipelineCalls,1);assert.equal(cancelled,true,'the fallback path also releases the provider body');
});
test('a provider failure is never cached as success; only an explicit recovery asks again',async t=>{
  let calls=0,fail=true;
  const generator=async payload=>{calls++;if(fail)throw Error('provider down');return selectFirstWord(payload);};
  const h=await harness(t,{generator}),book=fixtureBook();h.register(owner,book);
  const [first,twin]=await Promise.all([h.quotes.prepare(owner,book.bookId),h.quotes.prepare(owner,book.bookId)]);
  assert.equal(calls,1,'one provider attempt per request and its concurrent duplicates, never an automatic retry');
  for(const result of [first,twin]){assert.equal(result.quote.selection,'original-excerpt');assert.equal(result.quote.text,'Read this first.');}
  fail=false;
  const retried=await h.quotes.prepare(owner,book.bookId);
  assert.equal(calls,2,'an explicit recovery may ask the provider again after a failure');
  assert.equal(retried.quote.selection,'ai-selected');assert.equal(retried.quote.text,'Read');
  const cached=await h.quotes.prepare(owner,book.bookId);
  assert.equal(calls,2,'a validated AI selection is reused exactly once');assert.equal(cached.quote.receipt,retried.quote.receipt);
  h.register(receiver,bookWith([['Their own opening line.','Keep.'],['Continue from here.','This is the closing paragraph.']]));
  const other=await h.quotes.prepare(receiver,'reading-test');
  assert.equal(calls,3,'the cache never leaks across owners');assert.equal(other.quote.text,'Their');
});
