import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {validateLibraryBackup} from '../app/library-backup.mjs';
import {readingBook,readingRecords} from './reading-fixtures.mjs';

const owner={id:'gift-sender',email:'sender@example.invalid'},receiver={id:'gift-recipient'};
const load=()=>import('../server/book-gifts.mjs').catch(()=>({}));
async function fixture(t,options={}){
  const dir=await mkdtemp(path.join(tmpdir(),'marginalia-gifts-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:path.join(dir,'library'),catalogDir:null,translator:async()=>({literal:'逐字地读下去。',interpretive:'继续读，留下自己的问题。'})});
  const book=await library.importDocument(owner,{filename:'A letter.txt',bytes:Buffer.from('Read on.\n\nKeep a question.')});
  const {createBookGifts}=await load();assert.equal(typeof createBookGifts,'function','gift service is required');
  const service=createBookGifts({library,dataDir:path.join(dir,'gifts'),...options});return {dir,library,book,service};
}

test('a gift is an immutable importable original and independent translations without personal records',async t=>{
  const {library,book,service}=await fixture(t,{getProfile:async()=>({displayName:'林间',email:'PRIVATE PROFILE EMAIL',avatarUrl:'https://private.invalid/avatar'})});
  const p=book.sections[0].paragraphs[0];await library.translate(owner,book.bookId,p.id);
  await library.addComment(owner,book.bookId,{id:'personal',passageId:p.id,text:'PRIVATE NOTE'});
  await library.addComment(owner,book.bookId,{id:'question',passageId:p.id,text:'PRIVATE QUESTION'},'questions');
  await library.saveProgress(owner,book.bookId,{chapterId:'ch01',passageId:p.id,mode:'en',variant:'literal',offset:10});
  const gift=await service.create(owner,book.bookId,{message:'读到这里时，想起了你。',recipient:'小林'});
  assert.match(gift.token,/^[A-Za-z0-9_-]{32,64}$/);assert.equal(gift.shareUrl,'/gift/'+gift.token);
  const view=await service.view(gift.token);assert.equal(view.sender,'林间');assert.equal(view.recipient,'小林');assert.equal(view.message,'读到这里时，想起了你。');assert.ok(!Object.hasOwn(view,'sections'));
  const backup=await service.download(gift.token);assert.deepEqual(validateLibraryBackup(backup),{books:1,paragraphs:2,notes:0});
  assert.equal(backup.books[0].book.sections[0].paragraphs[0].id,p.id);
  assert.equal(backup.books[0].book.sections[0].paragraphs[0].translations.literal.text,'逐字地读下去。');
  assert.equal(backup.books[0].book.sections[0].paragraphs[0].translations.interpretive.text,'继续读，留下自己的问题。');
  assert.deepEqual(backup.books[0].records, {...readingRecords(),bookId:book.bookId,contentVersion:book.contentVersion});
  const encoded=JSON.stringify({view,backup});for(const secret of ['PRIVATE NOTE','PRIVATE QUESTION','PRIVATE PROFILE EMAIL','private.invalid','sender@example.invalid'])assert.ok(!encoded.includes(secret));
  await library.translate(owner,book.bookId,book.sections[0].paragraphs[1].id);
  assert.deepEqual((await service.download(gift.token)).books,backup.books,'later translations cannot change a letter already sent');
});

test('an explicit original-only gift leaves untranslated passages empty',async t=>{
  const {library,book,service}=await fixture(t);await library.translate(owner,book.bookId,book.sections[0].paragraphs[0].id);
  const gift=await service.create(owner,book.bookId,{includeTranslations:false}),backup=await service.download(gift.token);
  assert.equal(gift.includeTranslations,false);for(const p of backup.books[0].book.sections.flatMap(s=>s.paragraphs))assert.deepEqual(p.translations,{});
});

test('gift inputs and private ownership are checked before publishing',async t=>{
  const {book,service}=await fixture(t);
  for(const input of [{message:'a'.repeat(501)},{recipient:'a'.repeat(81)},{message:15},{recipient:{}},{includeTranslations:'false'},null,[]])await assert.rejects(service.create(owner,book.bookId,input),e=>e.status===400);
  await assert.rejects(service.create(null,book.bookId,{}),e=>e.status===401);
  await assert.rejects(service.create(receiver,book.bookId,{}),e=>e.status===404);
  for(const token of ['../secret','x','a'.repeat(100),null,42])await assert.rejects(service.view(token),e=>e.status===404);
});

test('only the sender can revoke, and revoked or unknown gifts have the same access boundary',async t=>{
  const {book,service}=await fixture(t),gift=await service.create(owner,book.bookId,{});
  await assert.rejects(service.revoke(null,gift.token),e=>e.status===401);
  await assert.rejects(service.revoke(receiver,gift.token),e=>e.status===404);
  await assert.rejects(service.accept(null,gift.token),e=>e.status===401);
  assert.deepEqual(await service.revoke(owner,gift.token),{revoked:true});
  for(const token of [gift.token,'A'.repeat(43)])for(const method of ['view','download'])await assert.rejects(service[method](token),e=>e.status===404);
  await assert.rejects(service.accept(receiver,gift.token),e=>e.status===404);
});

test('accepting twice preserves the recipient translations, notes, questions and position',async t=>{
  const {library,book,service}=await fixture(t),p=book.sections[0].paragraphs[0];await library.translate(owner,book.bookId,p.id);
  const gift=await service.create(owner,book.bookId,{}),first=await service.accept(receiver,gift.token);
  assert.deepEqual(first,{bookId:book.bookId,alreadyOwned:false,readUrl:'/read?book='+encodeURIComponent(book.bookId)});
  assert.equal((await library.getBook(receiver,book.bookId)).sections[0].paragraphs[0].translations.literal.text,'逐字地读下去。');
  await library.addComment(receiver,book.bookId,{id:'mine',passageId:p.id,text:'MY OWN NOTE'});
  await library.addComment(receiver,book.bookId,{id:'mine-question',passageId:p.id,text:'MY OWN QUESTION'},'questions');
  await library.saveProgress(receiver,book.bookId,{chapterId:'ch01',passageId:p.id,mode:'en',variant:'literal',offset:22});
  const snapshot=await library.exportLibrary(receiver);snapshot.books[0].book.sections[0].paragraphs[0].translations.literal.text='RECIPIENT TRANSLATION';await library.restoreLibrary(receiver,snapshot);
  const before=await library.exportLibrary(receiver),again=await service.accept(receiver,gift.token),after=await library.exportLibrary(receiver);
  assert.equal(again.alreadyOwned,true);assert.deepEqual(after.books,before.books);
});

test('an existing same source under another book id is reused without changing records',async t=>{
  const {library,book,service}=await fixture(t),gift=await service.create(owner,book.bookId,{});
  const ownBook=await library.importDocument(receiver,{filename:'My copy.txt',bytes:Buffer.from('Read on.\n\nKeep a question.')});
  await library.addComment(receiver,ownBook.bookId,{id:'keep',passageId:ownBook.sections[0].paragraphs[0].id,text:'Keep mine'});
  const got=await service.accept(receiver,gift.token);assert.equal(got.bookId,ownBook.bookId);assert.equal(got.alreadyOwned,true);
  assert.equal((await library.list(receiver)).length,1);assert.equal((await library.records(receiver,ownBook.bookId)).comments[0].text,'Keep mine');
});

test('only public catalog gifts offer direct reading and restore a hidden catalog book',async t=>{
  const {dir}=await fixture(t),library=await createLibraryService({dataDir:path.join(dir,'catalog-library')});
  const {createBookGifts}=await load();let restored;
  await library.archiveBook(receiver,'gutenberg-alice',{baseRevision:(await library.shelfState(receiver)).revision});
  const service=createBookGifts({library:{...library,restoreBook:async(user,id,input)=>{restored={user:user.id,id};return library.restoreBook(user,id,input);}},dataDir:path.join(dir,'catalog-gifts')});
  const gift=await service.create(owner,'gutenberg-alice',{}),view=await service.view(gift.token);
  assert.equal(view.readUrl,'/read?book=gutenberg-alice');assert.equal((await service.accept(receiver,gift.token)).alreadyOwned,true);
  assert.deepEqual(restored,{user:receiver.id,id:'gutenberg-alice'});
});

test('snapshot whitelist keeps editorial annotations while removing personal annotations and source paths',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),book=structuredClone(readingBook);
  book.visibility='private';book.source={...book.source,filename:'/Users/private/secret.txt',path:'/private/path',url:'file:///private/path',token:'PRIVATE TOKEN'};
  book.ownerId='PRIVATE OWNER';book.comments=[{text:'PRIVATE BOOK NOTE'}];book.localReadingDrafts={text:'PRIVATE DRAFT'};
  book.annotations=[{id:'editor',title:'原文注解',text:'Editorial insight.',attribution:'editorial',ownerId:'PRIVATE ANNOTATION OWNER'},{id:'mine',title:'Mine',text:'PRIVATE ANNOTATION',attribution:'user'}];
  book.sections[0].paragraphs[0].annotationIds=['editor','mine'];book.sections[0].paragraphs[0].secrets='PRIVATE PASSAGE SECRET';
  const service=createBookGifts({library:{getBook:async()=>book},dataDir:path.join(dir,'whitelist')}),gift=await service.create(owner,book.bookId,{}),backup=await service.download(gift.token);
  validateLibraryBackup(backup);const saved=backup.books[0].book;
  assert.deepEqual(saved.annotations,[{id:'editor',title:'原文注解',text:'Editorial insight.',attribution:'editorial'}]);assert.deepEqual(saved.sections[0].paragraphs[0].annotationIds,['editor']);
  assert.ok(!JSON.stringify(backup).includes('PRIVATE'));assert.ok(!JSON.stringify(backup).includes('/Users/'));assert.ok(!JSON.stringify(backup).includes('file:///'));assert.equal(saved.source.filename,undefined);
});

function memoryStore({limit=1000000,failPiece=false}={}){
  const documents=new Map(),writes=[];
  return {documents,writes,read:async(key,fallback)=>structuredClone(documents.has(key)?documents.get(key):fallback),mutate:async(key,fallback,operation)=>{
    const data=structuredClone(documents.has(key)?documents.get(key):fallback),result=await operation(data),size=Buffer.byteLength(JSON.stringify(data));
    if(size>limit)throw Error('hosted single-document limit');if(failPiece&&key.includes('chunks'))throw Error('injected piece failure');documents.set(key,structuredClone(data));writes.push({key,size});return result;
  }};
}

test('large hosted snapshots are bounded, durable and reconstructed without corrupting Unicode',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),book=structuredClone(readingBook);
  for(let i=0;i<50;i++)book.sections[0].paragraphs.push({id:'large-'+i,original:'纸页😀'.repeat(9800),translations:{},annotationIds:[],termIds:[]});
  const store=memoryStore(),library={getBook:async()=>book},options={library,dataDir:path.join(dir,'chunked'),dataStore:store};
  const service=createBookGifts(options),gift=await service.create(owner,book.bookId,{}),cold=createBookGifts(options),backup=await cold.download(gift.token);
  assert.equal(backup.books[0].book.sections[0].paragraphs.at(-1).original,'纸页😀'.repeat(9800));validateLibraryBackup(backup);
  assert.ok(store.writes.length>5);assert.ok(store.writes.every(row=>row.size<=1000000));assert.ok(!store.writes.at(-1).key.includes('chunks'),'metadata is published after all chunks');
  await cold.revoke(owner,gift.token);await assert.rejects(service.download(gift.token),e=>e.status===404);
});

test('a failed snapshot piece never publishes a usable gift and oversized packages are rejected',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),book=structuredClone(readingBook),store=memoryStore({failPiece:true});
  const options={library:{getBook:async()=>book},dataDir:path.join(dir,'failed'),dataStore:store},service=createBookGifts(options);
  await assert.rejects(service.create(owner,book.bookId,{}),/piece failure/);assert.equal(store.documents.size,0);
  for(let i=0;i<230;i++)book.sections[0].paragraphs.push({id:'oversized-'+i,original:'x'.repeat(99999),translations:{},annotationIds:[],termIds:[]});
  await assert.rejects(service.create(owner,book.bookId,{}),e=>e.status===413);assert.equal(store.documents.size,0);
});

test('bounded gift downloads reject mixed snapshots, invalid ranges and revoked access',async t=>{
  const {book,service}=await fixture(t),gift=await service.create(owner,book.bookId,{});
  assert.equal(typeof service.downloadPart,'function');
  const part=await service.downloadPart(gift.token);assert.equal(part.kind,'marginalia-book-gift-part');assert.equal(part.schemaVersion,1);assert.equal(part.offset,0);assert.equal(part.nextOffset,null);
  const {createHash}=await import('node:crypto'),bytes=Buffer.from(part.data,'base64');assert.equal(part.totalBytes,bytes.length);assert.equal(part.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(part.snapshot,part.sha256);
  for(const offset of [-1,1.5,'0',part.totalBytes])await assert.rejects(service.downloadPart(gift.token,{offset}),e=>e.status===400);
  await assert.rejects(service.downloadPart(gift.token,{snapshot:'wrong'}),e=>e.status===409);
  await service.revoke(owner,gift.token);await assert.rejects(service.downloadPart(gift.token),e=>e.status===404);
});

test('the browser assembles verified bounded chunks into a real importable download',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),book=structuredClone(readingBook);
  for(let i=0;i<50;i++)book.sections[0].paragraphs.push({id:'download-'+i,original:'纸页😀'.repeat(9800),translations:{},annotationIds:[],termIds:[]});
  const service=createBookGifts({library:{getBook:async()=>book},dataDir:path.join(dir,'download-parts'),dataStore:memoryStore()}),gift=await service.create(owner,book.bookId,{});
  const {downloadGiftPackage}=await import('../app/book-gift.mjs');let requests=0;
  const request=async url=>{requests++;const u=new URL(url,'https://fixture.invalid');return service.downloadPart(gift.token,{offset:Number(u.searchParams.get('offset')),snapshot:u.searchParams.get('snapshot')});};
  const blob=await downloadGiftPackage({token:gift.token,request});assert.ok(blob instanceof Blob);assert.ok(requests>5);
  const backup=JSON.parse(await blob.text());validateLibraryBackup(backup);assert.equal(backup.books[0].book.sections[0].paragraphs.at(-1).original,'纸页😀'.repeat(9800));
  for(const corruption of ['sha256','data','offset','snapshot','totalBytes'])await assert.rejects(downloadGiftPackage({token:gift.token,request:async url=>{const part=await request(url);if(corruption==='data')part.data='QQ==';else if(corruption==='offset')part.offset++;else if(corruption==='totalBytes')part.totalBytes=21*1024*1024;else part[corruption]='0'.repeat(64);return part;}}),/阅读包|分段|校验|版本/);
});

test('senders can reload their own sent letters and revoke them without keeping browser state',async t=>{
  const {dir,library,book,service}=await fixture(t),gift=await service.create(owner,book.bookId,{recipient:'友人',message:'再读一遍'}),{createBookGifts}=await load(),cold=createBookGifts({library,dataDir:path.join(dir,'gifts')});
  assert.equal(typeof cold.list,'function');let letters=await cold.list(owner,book.bookId);assert.equal(letters.length,1);assert.equal(letters[0].token,gift.token);assert.equal(letters[0].shareUrl,'/gift/'+gift.token);assert.equal(letters[0].revoked,false);
  assert.deepEqual(await cold.list({id:'unrelated'},'gutenberg-alice').catch(error=>error.status),404);
  const shared=await cold.accept(receiver,gift.token);assert.equal(shared.bookId,book.bookId);assert.deepEqual(await cold.list(receiver,book.bookId),[]);
  await cold.revoke(owner,gift.token);letters=await service.list(owner,book.bookId);assert.equal(letters[0].revoked,true);
  await assert.rejects(cold.list(null,book.bookId),error=>error.status===401);
});

test('the per-sender active link limit is durable and revocation frees a slot',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),store=memoryStore(),library={getBook:async()=>structuredClone(readingBook)},options={library,dataDir:path.join(dir,'limited'),dataStore:store},service=createBookGifts(options);
  const first=await service.create(owner,readingBook.bookId,{});for(let i=1;i<100;i++)await service.create(owner,readingBook.bookId,{});
  await assert.rejects(createBookGifts(options).create(owner,readingBook.bookId,{}),error=>error.status===429);
  await service.revoke(owner,first.token);assert.ok((await createBookGifts(options).create(owner,readingBook.bookId,{})).token);
});

test('two local service instances retain both concurrently created sent letters',async t=>{
  const {dir,library,book,service}=await fixture(t),{createBookGifts}=await load(),cold=createBookGifts({library,dataDir:path.join(dir,'gifts')});
  const letters=await Promise.all([service.create(owner,book.bookId,{message:'First'}),cold.create(owner,book.bookId,{message:'Second'})]);
  const saved=await cold.list(owner,book.bookId);assert.equal(saved.length,2);assert.deepEqual(new Set(saved.map(row=>row.token)),new Set(letters.map(row=>row.token)));
});

test('a large gift downloads intact but hosted acceptance rejects the unreadable combined size before recipient writes',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),store=memoryStore({limit:3500000}),book=structuredClone(readingBook);
  book.visibility='private';for(let i=0;i<160;i++)book.sections[0].paragraphs.push({id:'receive-'+i,original:'Original. '.repeat(1000),translations:Object.fromEntries(['literal','interpretive'].map(variant=>[variant,{text:(variant==='literal'?'直':'意').repeat(2700),variant,origin:'ai',status:'draft',sourceVersion:book.contentVersion}])),annotationIds:[],termIds:[]});
  const library=await createLibraryService({dataDir:path.join(dir,'hosted-receiver'),catalogDir:null,dataStore:store}),service=createBookGifts({library:{...library,getBook:(user,id)=>user?.id===owner.id?Promise.resolve(book):library.getBook(user,id)},dataDir:path.join(dir,'hosted-gifts'),dataStore:store});
  const gift=await service.create(owner,book.bookId,{}),downloaded=await service.download(gift.token);
  assert.ok(Buffer.byteLength(JSON.stringify(downloaded.books[0].book))>3500000);validateLibraryBackup(downloaded);
  assert.equal(downloaded.books[0].book.sections[0].paragraphs.at(-1).translations.interpretive.text,'意'.repeat(2700));assert.equal(downloaded.books[0].book.sections[0].paragraphs.at(-1).original,'Original. '.repeat(1000));
  const beforeWrites=store.writes.length;await assert.rejects(service.accept(receiver,gift.token),error=>error.status===413);
  assert.equal(store.writes.length,beforeWrites,'rejected acceptance must not write recipient originals, translations, records or shelf metadata');
  await assert.rejects(library.getBook(receiver,book.bookId),error=>error.status===404);assert.deepEqual(await library.list(receiver),[]);
});

test('retrying an interrupted hosted acceptance completes translations without losing a note written meanwhile',async t=>{
  const {dir}=await fixture(t),{createBookGifts}=await load(),store=memoryStore({limit:3500000}),book=structuredClone(readingBook);book.visibility='private';
  book.sections[0].paragraphs[0].translations={literal:{text:'逐字版本',origin:'ai',status:'draft'},interpretive:{text:'自然版本',origin:'ai',status:'draft'}};
  let failNextOverlay=true;const write=store.mutate;store.mutate=async(key,...args)=>{if(failNextOverlay&&key.includes('/translations/')){failNextOverlay=false;throw Object.assign(Error('isolated overlay unavailable'),{status:503});}return write(key,...args);};
  const library=await createLibraryService({dataDir:path.join(dir,'interrupted-library'),catalogDir:null,dataStore:store}),service=createBookGifts({library:{...library,getBook:(user,id)=>user?.id===owner.id?Promise.resolve(book):library.getBook(user,id)},dataDir:path.join(dir,'interrupted-gifts'),dataStore:store});
  const gift=await service.create(owner,book.bookId,{});await assert.rejects(service.accept(receiver,gift.token),error=>error.status===503);
  await library.addComment(receiver,book.bookId,{id:'new-during-recovery',passageId:'p1',text:'Keep this while the book finishes arriving.'});
  const received=await service.accept(receiver,gift.token);assert.equal(received.alreadyOwned,true);
  const saved=await library.getBook(receiver,book.bookId);assert.equal(saved.sections[0].paragraphs[0].translations.literal.text,'逐字版本');assert.equal(saved.sections[0].paragraphs[0].translations.interpretive.text,'自然版本');
  assert.equal((await library.records(receiver,book.bookId)).comments[0].text,'Keep this while the book finishes arriving.');
});
