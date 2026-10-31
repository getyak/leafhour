import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createNativeReadingCopy,NATIVE_COPY_PART_BYTES,NATIVE_COPY_TTL_MS} from '../server/native-reading-copy.mjs';
import {createHostedStore} from '../deploy/hosted-store.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {createReaderServer} from '../server/server.mjs';
import {digest} from '../server/document-import.mjs';

const owner={id:'synthetic-native-owner'},other={id:'synthetic-native-other'};
async function fixture(t,{hosted=false}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-native-copy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=1000,snapshotId='snapshot-1',loads=0,captures=0,afterLoad=null;const model={bookId:'synthetic-book',contentVersion:'source-v1',sections:[{chapterId:'chapter-1',paragraphs:[{id:'passage-1',original:'Synthetic source only.',translations:{}}]}],padding:randomBytes(1600000).toString('base64')};
 const rows=new Map(),blobs=new Map(),ranges=[];const dataStore=hosted?{read:async(k,fallback)=>structuredClone(rows.has(k)?rows.get(k):fallback),mutate:async(k,fallback,fn)=>{const row=structuredClone(rows.has(k)?rows.get(k):fallback),result=await fn(row);rows.set(k,row);return result;},putBlob:async(k,b)=>{blobs.set(k,Buffer.from(b));},blobRange:async(k,args)=>{ranges.push({key:k,...args});const bytes=blobs.get(k);return {bytes:bytes.subarray(args.offset,args.offset+args.length),offset:args.offset,total:bytes.length};},blob:()=>{throw Error('complete blob read is forbidden');}}:null;
 const service=createNativeReadingCopy({dataDir:dir,dataStore,clock:()=>now,assertAccess:async(user,id)=>{if(!user?.id)throw Object.assign(Error('sign in'),{status:401});if(user.id!==owner.id||id!==model.bookId)throw Object.assign(Error('missing'),{status:404});},captureSnapshot:async()=>{captures++;return {snapshotId,contentVersion:model.contentVersion};},loadBook:async()=>{loads++;await afterLoad?.();return structuredClone(model);}});
 return {dir,service,model,blobs,rows,ranges,get loads(){return loads;},get captures(){return captures;},advance:ms=>{now+=ms;},change:()=>{snapshotId='snapshot-2';},duringLoad:fn=>{afterLoad=fn;}};
}
async function allParts(service,plan){const parts=[];for(let offset=0;offset<plan.compressedBytes;offset+=plan.partBytes){const part=await service.part(owner,plan.bookId,{archive:plan.sha256,offset});assert.equal(part.bytes.length,Math.min(plan.partBytes,plan.compressedBytes-offset));parts.push(part.bytes);}return Buffer.concat(parts);}

test('native archive has exact plan fields and an independently hashable gzip roundtrip',async t=>{
 const f=await fixture(t),plan=await f.service.prepare(owner,f.model.bookId);
 assert.deepEqual(Object.keys(plan).sort(),['kind','bookId','contentVersion','snapshotId','sha256','compressedBytes','uncompressedBytes','partBytes','encoding'].sort());
 assert.equal(plan.kind,'leafhour-native-copy-v1');assert.equal(plan.partBytes,1048576);assert.equal(plan.encoding,'gzip');assert.ok(plan.compressedBytes>plan.partBytes);
 const bytes=await allParts(f.service,plan);assert.equal(digest(bytes),plan.sha256);assert.equal(gunzipSync(bytes).length,plan.uncompressedBytes);assert.deepEqual(JSON.parse(gunzipSync(bytes)),f.model);
 assert.deepEqual(await f.service.verify(owner,f.model.bookId,{archive:plan.sha256}),{valid:true,bookId:f.model.bookId,contentVersion:f.model.contentVersion,snapshotId:plan.snapshotId,sha256:plan.sha256});
 const again=await f.service.prepare(owner,f.model.bookId);assert.deepEqual(again,plan);assert.equal(f.loads,1,'unchanged snapshots reuse the stored archive');
});

test('native copy stays bound to its owner and book on plan, range and verify',async t=>{
 const f=await fixture(t),plan=await f.service.prepare(owner,f.model.bookId);
 for(const user of [other]){await assert.rejects(f.service.prepare(user,f.model.bookId),e=>e.status===404);await assert.rejects(f.service.part(user,f.model.bookId,{archive:plan.sha256,offset:0}),e=>e.status===404);await assert.rejects(f.service.verify(user,f.model.bookId,{archive:plan.sha256}),e=>e.status===404);}
 await assert.rejects(f.service.part(owner,'another-book',{archive:plan.sha256,offset:0}),e=>e.status===404);
 await assert.rejects(f.service.prepare(null,f.model.bookId),e=>e.status===401);
});

test('native ranges reject invalid aligned offsets, hashes, expiry and corrupt stored bytes',async t=>{
 const f=await fixture(t,{hosted:true}),plan=await f.service.prepare(owner,f.model.bookId);
 for(const offset of [-1,1,0.5,NaN,Infinity,plan.compressedBytes,NATIVE_COPY_PART_BYTES*100])await assert.rejects(f.service.part(owner,f.model.bookId,{archive:plan.sha256,offset}),e=>e.status===400);
 for(const archive of ['',null,'../bad','a'.repeat(63),'A'.repeat(64)])await assert.rejects(f.service.part(owner,f.model.bookId,{archive,offset:0}),e=>e.status===400);
 await assert.rejects(f.service.part(owner,f.model.bookId,{archive:'a'.repeat(64),offset:0}),e=>e.status===404);
 const key=[...f.blobs.keys()][0];f.blobs.get(key)[0]^=1;
 await assert.rejects(f.service.part(owner,f.model.bookId,{archive:plan.sha256,offset:0}),e=>e.status===409);
 f.advance(NATIVE_COPY_TTL_MS);await assert.rejects(f.service.part(owner,f.model.bookId,{archive:plan.sha256,offset:0}),e=>e.status===410);await assert.rejects(f.service.verify(owner,f.model.bookId,{archive:plan.sha256}),e=>e.status===410);
});

test('hosted parts use bounded blobRange without loading source or fat snapshots',async t=>{
 const f=await fixture(t,{hosted:true}),plan=await f.service.prepare(owner,f.model.bookId),before=f.captures;
 await allParts(f.service,plan);assert.equal(f.loads,1);assert.equal(f.captures,before);assert.equal(f.ranges.length,Math.ceil(plan.compressedBytes/NATIVE_COPY_PART_BYTES));assert.ok(f.ranges.every(r=>r.length<=NATIVE_COPY_PART_BYTES&&r.sha256===plan.sha256));
});

test('snapshot changes during preparation and before final verification reject mixed copies',async t=>{
 const f=await fixture(t);f.duringLoad(f.change);await assert.rejects(f.service.prepare(owner,f.model.bookId),e=>e.status===409);
 const fresh=await fixture(t),plan=await fresh.service.prepare(owner,fresh.model.bookId);fresh.change();await assert.rejects(fresh.service.verify(owner,fresh.model.bookId,{archive:plan.sha256}),e=>e.status===409);
});

test('native reading archive transports the real library model with separate saved translations and no records or grants',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-native-library-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:async()=>({literal:'直译候选',interpretive:'独立意译候选',model:'synthetic-only'})});
 const book=await library.importDocument(owner,{filename:'synthetic.txt',bytes:Buffer.from('Synthetic author source.\n\nA second untranslated passage.')});
 const editorial=await library.exportLibrary(owner);editorial.books[0].book.annotations.push({id:'synthetic-editorial',title:'Synthetic editorial note',text:'An explicitly editorial synthetic note.',attribution:'editorial'});await library.restoreLibrary(owner,editorial);
 await library.translate(owner,book.bookId,book.sections[0].paragraphs[0].id);await library.addComment(owner,book.bookId,{id:'synthetic-comment',passageId:book.sections[0].paragraphs[0].id,text:'PRIVATE_RECORD_MUST_STAY_OUT'});await library.createGrant(owner,{bookId:book.bookId,scopes:['content']});
 const plan=await library.nativeCopy(owner,book.bookId),bytes=[];for(let offset=0;offset<plan.compressedBytes;offset+=plan.partBytes)bytes.push((await library.nativeCopyPart(owner,book.bookId,{archive:plan.sha256,offset})).bytes);
 const decoded=JSON.parse(gunzipSync(Buffer.concat(bytes))),actual=await library.getBook(owner,book.bookId);assert.deepEqual(decoded,actual);assert.equal(decoded.annotations[0].attribution,'editorial');assert.ok(decoded.sections[0].paragraphs[0].translations.literal);assert.ok(decoded.sections[0].paragraphs[0].translations.interpretive);assert.notDeepEqual(decoded.sections[0].paragraphs[0].translations.literal,decoded.sections[0].paragraphs[0].translations.interpretive);assert.deepEqual(decoded.sections[0].paragraphs[1].translations,{});assert.ok(!JSON.stringify(decoded).includes('PRIVATE_RECORD_MUST_STAY_OUT'));assert.equal(decoded.records,undefined);assert.equal(decoded.grants,undefined);
 assert.equal((await library.verifyNativeCopy(owner,book.bookId,{archive:plan.sha256})).valid,true);
 await library.translate(owner,book.bookId,book.sections[0].paragraphs[1].id);await assert.rejects(library.verifyNativeCopy(owner,book.bookId,{archive:plan.sha256}),e=>e.status===409);
});

test('native copy HTTP routes require the session owner and return private binary parts',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-native-http-'));const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),bookPath:path.join(dir,'absent.json'),sendCode:null,translator:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const session=await server.portal.auth.localSession(),book=await server.portal.library.importDocument(session.user,{filename:'synthetic.txt',bytes:Buffer.from('Synthetic HTTP source.')}),base='http://127.0.0.1:'+server.address().port+'/api/library/books/'+book.bookId+'/native-copy',headers={Cookie:'marginalia_session='+session.token,'X-Reader-Owner':session.user.id};
 assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base+'/part?archive=bad&offset=bad')).status,401);assert.equal((await fetch(base,{headers:{...headers,'X-Reader-Owner':'different'}})).status,409);
 const response=await fetch(base,{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);const plan=await response.json();
 const part=await fetch(base+'/part?archive='+plan.sha256+'&offset=0',{headers});assert.equal(part.status,200);assert.match(part.headers.get('content-type'),/application\/octet-stream/);assert.equal(part.headers.get('content-encoding'),null);assert.equal(Number(part.headers.get('content-length')),plan.compressedBytes);assert.equal(digest(Buffer.from(await part.arrayBuffer())),plan.sha256);
 assert.equal((await fetch(base+'/verify?archive='+plan.sha256,{headers})).status,200);
 for(const offset of ['','1.0','1e0','0x0','-0','+0','0.1'])assert.equal((await fetch(base+'/part?archive='+plan.sha256+'&offset='+encodeURIComponent(offset),{headers})).status,400);
});


test('local archive files reject tampering and preserve private filesystem permissions',async t=>{
 const f=await fixture(t),plan=await f.service.prepare(owner,f.model.bookId),files=await readdir(f.dir,{recursive:true}),file=path.join(f.dir,files.find(name=>name.endsWith('.gzip'))),bytes=await readFile(file);assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(path.dirname(file))).mode&0o777,0o700);bytes[0]^=1;await writeFile(file,bytes);
 await assert.rejects(f.service.part(owner,f.model.bookId,{archive:plan.sha256,offset:0}),e=>e.status===409);
});

test('native plan rejects normalized models beyond 96 MiB and gzip beyond 32 MiB',async t=>{
 const plain=await fixture(t);plain.model.padding='x'.repeat(96*1024*1024);await assert.rejects(plain.service.prepare(owner,plain.model.bookId),e=>e.status===413);
 delete plain.model.padding;
 const packed=await fixture(t);packed.model.padding=randomBytes(33*1024*1024).toString('base64');await assert.rejects(packed.service.prepare(owner,packed.model.bookId),e=>e.status===413);
 assert.equal((await readdir(packed.dir,{recursive:true})).filter(name=>name.endsWith('.gzip')).length,0,'oversized compressed content is never published');
});

test('an expired snapshot can be prepared anew while ranges reject changed stored lengths',async t=>{
 const f=await fixture(t,{hosted:true}),plan=await f.service.prepare(owner,f.model.bookId);f.advance(NATIVE_COPY_TTL_MS);
 assert.equal((await f.service.prepare(owner,f.model.bookId)).sha256,plan.sha256);assert.equal(f.loads,2);assert.equal((await f.service.verify(owner,f.model.bookId,{archive:plan.sha256})).valid,true);
 const key=[...f.blobs.keys()][0];f.blobs.set(key,f.blobs.get(key).subarray(0,-1));await assert.rejects(f.service.part(owner,f.model.bookId,{archive:plan.sha256,offset:0}),e=>e.status===409);
});

function hostedAdapterFixture(){
 const rows=new Map(),blobs=new Map(),requests=[];return {requests,env:{SUPABASE_URL:'https://synthetic.example',SUPABASE_SECRET_KEY:'synthetic-placeholder'},fetcher:async(url,options={})=>{
  const parsed=new URL(url);requests.push({path:parsed.pathname,method:options.method||'GET',range:options.headers?.Range});
  if(parsed.pathname==='/rest/v1/reader_documents'){const key=parsed.searchParams.get('key').slice(3);return Response.json(rows.has(key)?[structuredClone(rows.get(key))]:[]);}
  if(parsed.pathname==='/rest/v1/rpc/reader_document_cas'){const input=JSON.parse(options.body),old=rows.get(input.document_key),valid=(old?.version||0)===input.expected_version;if(valid)rows.set(input.document_key,{version:input.expected_version+1,value:structuredClone(input.document_value)});return Response.json(valid);}
  if(parsed.pathname.startsWith('/storage/v1/object/reader-originals/')){
   if(options.method==='POST'){blobs.set(parsed.pathname,Buffer.from(options.body));return Response.json({});}
   const bytes=blobs.get(parsed.pathname);if(!bytes)return new Response(null,{status:404});
   if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(bytes.length)}});
   if(options.headers?.Range){const [,start,end]=options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);return new Response(bytes.subarray(Number(start),Number(end)+1),{status:206,headers:{'Content-Length':String(Number(end)-Number(start)+1),'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}});}
   return new Response(bytes);
  }
  throw Error('Unexpected synthetic storage route');
 }};
}

test('existing hosted blob adapter serves multi-object gzip copies using bounded HTTP ranges',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-native-hosted-'));t.after(()=>rm(dir,{recursive:true,force:true}));const fixture=hostedAdapterFixture(),store=createHostedStore(fixture),model={bookId:'hosted-synthetic-book',contentVersion:'v1',padding:randomBytes(9*1024*1024).toString('base64')};
 const service=createNativeReadingCopy({dataDir:dir,dataStore:store,assertAccess:async(user,id)=>assert.ok(user.id===owner.id&&id===model.bookId),captureSnapshot:async()=>({snapshotId:'snapshot-adapter',contentVersion:'v1'}),loadBook:async()=>model});
 const plan=await service.prepare(owner,model.bookId);assert.ok(plan.compressedBytes>8*1024*1024);const transferred=await allParts(service,plan);assert.equal(digest(transferred),plan.sha256);assert.deepEqual(JSON.parse(gunzipSync(transferred)),model);
 const ranges=fixture.requests.filter(r=>r.range);assert.ok(ranges.length>8);assert.ok(ranges.every(r=>{const [,start,end]=r.range.match(/^bytes=(\d+)-(\d+)$/);return Number(end)-Number(start)+1<=1048576;}));
});


test('saved editorial introduction participates in the native snapshot fence',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'leafhour-native-introduction-'));t.after(()=>rm(dir,{recursive:true,force:true}));const library=await createLibraryService({dataDir:dir,catalogDir:null,translator:null}),book=await library.importDocument(owner,{filename:'synthetic.txt',bytes:Buffer.from('A synthetic opening source.')});
 const draft=text=>({kind:'leafhour-book-introduction',schemaVersion:1,origin:'ai',status:'draft',text,contentVersion:book.contentVersion,createdAt:'2026-10-31T00:00:00Z',model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:[book.sections[0].paragraphs[0].id]});
 await library.introductions.restore(owner,{...book,introduction:draft('Synthetic saved draft one.')});const plan=await library.nativeCopy(owner,book.bookId),part=await library.nativeCopyPart(owner,book.bookId,{archive:plan.sha256,offset:0});assert.equal(JSON.parse(gunzipSync(part.bytes)).introduction.text,'Synthetic saved draft one.');
 await library.introductions.restore(owner,{...book,introduction:draft('Synthetic saved draft two.')});await assert.rejects(library.verifyNativeCopy(owner,book.bookId,{archive:plan.sha256}),e=>e.status===409);
 const latest=await library.nativeCopy(owner,book.bookId);assert.notEqual(latest.snapshotId,plan.snapshotId);assert.notEqual(latest.sha256,plan.sha256);
});
