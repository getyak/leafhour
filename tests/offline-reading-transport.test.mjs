import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineReadingTransport,resolveOfflineReadingContext} from '../app/offline-reading.mjs';
const chapter={bookId:'book',contentVersion:'source-v1',chapterId:'ch1',sections:[{number:1,chapterId:'ch1',paragraphs:[{id:'p1',original:'Actual saved source',translations:{}}]}]};
const book={bookId:'book',contentVersion:'source-v1',title:{en:'Book'},chapters:[{id:'ch1'}],sections:chapter.sections,annotations:[],glossary:[],readingCache:{schemaVersion:1,snapshotId:'snap1',chapters:{ch1:'hash1'}}};
function fixture(){let token='A:1',saved=structuredClone(book);return {owner:()=>token?.split(':')[0]||null,capture:()=>token,current:value=>value===token,adopt:async owner=>{token=owner+':1';},clear:async()=>{token=null;saved=null;},book:async()=>{if(!saved)throw Error('missing');return structuredClone(saved);},saveBook:async value=>{saved={...structuredClone(value),sections:saved?.readingCache.chapters.ch1===value.readingCache.chapters.ch1?saved.sections:value.sections};},chapter:async()=>structuredClone(chapter),saveChapter:async(_id,value)=>{saved.sections=value.sections;},remove:async()=>{saved=null;},pin:async()=>{},status:async()=>({complete:true,loaded:1,total:1})};}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('a verified manifest reuses a saved chapter without transferring its body',async()=>{
 const store=fixture(),paths=[],transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async path=>{paths.push(path);return json({...book,sections:[{number:1,chapterId:'ch1',paragraphs:[{id:'p1',unloaded:true}]}],reading:{partial:true,loadedChapters:[]}});}});
 const response=await transport.fetch('/api/library/books/book/reading?chapterId=ch1');assert.equal((await response.json()).sections[0].paragraphs[0].original,'Actual saved source');assert.equal(paths.length,1);assert.match(paths[0],/reading-manifest/);
});
test('network failure can read local content but explicit permission denial cannot',async()=>{
 const local=createOfflineReadingTransport({store:fixture(),bookId:'book',fetcher:async()=>{throw new TypeError('network unavailable');}});
 assert.equal((await (await local.fetch('/api/library/books/book/reading')).json()).sections[0].paragraphs[0].original,chapter.sections[0].paragraphs[0].original);assert.equal(local.isOffline(),true);
 const store=fixture(),denied=createOfflineReadingTransport({store,bookId:'book',fetcher:async()=>json({error:'denied'},403)});assert.equal((await denied.fetch('/api/library/books/book/reading')).status,403);await assert.rejects(store.book('book'));
});
test('offline writes are rejected before dispatch and cannot be queued for later submission',async()=>{
 let requests=0;const transport=createOfflineReadingTransport({store:fixture(),bookId:'book',offline:true,fetcher:async()=>{requests++;return json({});}});
 await assert.rejects(transport.fetch('/api/library/books/book/translate',{method:'POST',body:'{}'}),error=>error.code==='offline_write');assert.equal(requests,0);
});
test('changed owner rejects cached reads and late network responses',async()=>{
 const store=fixture();let resolve;const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:()=>new Promise(r=>resolve=r)}),pending=transport.fetch('/api/library/books/book/reading');await new Promise(r=>setImmediate(r));await store.clear();resolve(json(book));await assert.rejects(pending,error=>error.code==='cache_stale');
});
test('offline context is distinct from authenticated session and needs a verified retained scope',async()=>{
 const store=fixture();const context=await resolveOfflineReadingContext({store,bookId:'book',session:null,networkFailed:true});assert.equal(context.offline,true);assert.equal(context.owner,'A');assert.equal(context.session.user,null);assert.equal(context.session.offlineOwner,'A');
 const denied=await resolveOfflineReadingContext({store,bookId:'book',session:{user:null},networkFailed:false});assert.equal(denied.offline,false);assert.equal(denied.owner,null);assert.equal(store.owner(),'guest');
});
test('unavailable persistence preserves online reading without entering cache paths',async()=>{
 const store={...fixture(),adopt:async()=>{throw Object.assign(Error('storage blocked'),{code:'cache_unavailable'});},capture:()=>null,book:async()=>{throw Object.assign(Error('no scope'),{code:'cache_stale'});}};
 const context=await resolveOfflineReadingContext({store,bookId:'book',session:{user:{id:'A'}}});let requests=0;
 const transport=createOfflineReadingTransport({store,bookId:'book',enabled:context.enabled,fetcher:async()=>{requests++;return json(book);}});
 assert.equal((await transport.fetch('/api/library/books/book/reading')).status,200);assert.equal(requests,1);assert.equal(context.enabled,false);
});
test('denied content revokes the scope before a failed deletion can permit offline fallback',async()=>{
 const store=fixture();let revoked=false,requests=0;store.clear=async()=>{revoked=true;throw Object.assign(Error('IDB unavailable'),{code:'cache_unavailable'});};
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async()=>{if(requests++===0)return json({error:'denied'},403);throw new TypeError('network unavailable');}});
 assert.equal((await transport.fetch('/api/library/books/book/reading')).status,403);assert.equal(revoked,true);await assert.rejects(transport.fetch('/api/library/books/book/reading'));
});
test('whole-book download fails when a fetched chapter cannot be persisted',async()=>{
 const store=fixture();store.chapter=async()=>{throw Object.assign(Error('missing'),{code:'offline_missing'});};store.saveChapter=async()=>{throw Object.assign(Error('quota'),{code:'cache_quota'});};store.status=async()=>({complete:false,loaded:0,total:1});
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async path=>json(path.includes('/chapters/')?chapter:book)}),progress=[];
 await assert.rejects(transport.download({onProgress:value=>progress.push(value)}),error=>error.code==='cache_quota');assert.equal(progress.length,0);
});
test('refresh after a translation reads the new chapter body before offline reuse',async()=>{
 const store=fixture(),paths=[];store.chapter=async()=>{throw Object.assign(Error('missing'),{code:'offline_missing'});};let saved=null;store.saveChapter=async(_id,value)=>{saved=value;};
 const translated={...chapter,sections:[{...chapter.sections[0],paragraphs:[{...chapter.sections[0].paragraphs[0],translations:{literal:{text:'New saved translation'}}}]}]};
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async path=>{paths.push(path);return json(path.includes('/chapters/')?translated:{...book,readingCache:{...book.readingCache,chapters:{ch1:'new-hash'}}});}});
 await transport.refresh('ch1');assert.equal(saved.sections[0].paragraphs[0].translations.literal.text,'New saved translation');assert.equal(paths.length,2);
});
test('multipart reading is assembled before its content reaches the offline cache',async()=>{
 const source={...book,padding:'x'.repeat(1100000)},bytes=Buffer.from(JSON.stringify(source));
 const {createHash}=await import('node:crypto');const hash=createHash('sha256').update(bytes).digest('hex'),manifest={kind:'leafhour-book-transfer-v1',bookId:'book',contentVersion:'source-v1',snapshot:hash,totalBytes:bytes.length,partBytes:1048576};
 const store=fixture();store.book=async()=>{throw Error('missing');};let saved;store.saveBook=async value=>{saved=value;};
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async path=>{const url=new URL(path,'https://example.com');if(!url.searchParams.has('offset'))return new Response(JSON.stringify(manifest),{headers:{'X-Reader-Book-Transfer':'parts'}});const offset=Number(url.searchParams.get('offset')),end=Math.min(offset+1048576,bytes.length);return json({kind:'leafhour-book-part-v1',snapshot:hash,totalBytes:bytes.length,offset,nextOffset:end<bytes.length?end:null,data:bytes.subarray(offset,end).toString('base64')});}});
 const actual=await (await transport.fetch('/api/library/books/book/reading')).json();assert.equal(actual.padding.length,1100000);assert.equal(saved.bookId,'book');assert.equal(saved.kind,undefined);
});
test('acknowledged translation is retained before its result is delivered, without an extra network dependency',async()=>{
 const store=fixture();let stored=null;store.saveBook=async value=>{stored=structuredClone(value);};
 const translated={id:'p1',original:'Actual saved source',translations:{literal:{text:'Confirmed translation',status:'draft'},interpretive:{text:'Separate interpretation',status:'draft'}}};let calls=0;
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async()=>{calls++;return json(translated);}});
 const result=await (await transport.fetch('/api/library/books/book/translate',{method:'POST',body:'{}'})).json();assert.equal(result.id,'p1');assert.equal(stored.sections[0].paragraphs[0].translations.literal.text,'Confirmed translation');assert.notEqual(stored.readingCache.chapters.ch1,book.readingCache.chapters.ch1);assert.equal(calls,1);
});
test('a complete saved book can supply an offline recovery export without network',async()=>{
 let requests=0;const transport=createOfflineReadingTransport({store:fixture(),bookId:'book',offline:true,fetcher:async()=>{requests++;throw Error('network');}});
 const saved=await (await transport.fetch('/api/library/books/book')).json();assert.equal(saved.bookId,'book');assert.equal(saved.readingCache,undefined);assert.equal(saved.sections[0].paragraphs[0].original,'Actual saved source');assert.equal(requests,0);
});
test('a matching private manifest tag validates online without retransmitting metadata or chapters',async()=>{
 const store=fixture(),tag='"'+'a'.repeat(64)+'"',cached={...book,readingCache:{...book.readingCache,manifestTag:tag}};store.book=async()=>structuredClone(cached);store.metadata=async()=>({...structuredClone(cached),reading:{partial:true,loadedChapters:[],availableChapters:['ch1']}});let headers;
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async(_url,options)=>{headers=options.headers;return new Response(null,{status:304,headers:{ETag:tag}});}});
 const actual=await (await transport.fetch('/api/library/books/book/reading')).json();assert.equal(actual.sections[0].paragraphs[0].original,'Actual saved source');assert.equal(headers['If-None-Match'],tag);
});
test('a failed metadata save cannot serve an obsolete chapter after a fresh online manifest',async()=>{
 const store=fixture(),old={...structuredClone(book),reading:{partial:true,loadedChapters:['ch1']}};store.book=async()=>old;store.saveBook=async()=>{throw Object.assign(Error('cannot write metadata'),{code:'cache_unavailable'});};const paths=[],fresh={...book,readingCache:{...book.readingCache,snapshotId:'new',chapters:{ch1:'new-hash'}},sections:[{number:1,chapterId:'ch1',paragraphs:[{id:'p1',unloaded:true}]}],reading:{partial:true,loadedChapters:[]}},updated={...chapter,sections:[{number:1,chapterId:'ch1',paragraphs:[{id:'p1',original:'Fresh source',translations:{}}]}]};
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async path=>{paths.push(path);return json(path.includes('/chapters/')?updated:fresh);}});
 const result=await (await transport.fetch('/api/library/books/book/reading')).json();assert.equal(result.sections[0].paragraphs[0].original,'Fresh source');assert.equal(result.readingCache.snapshotId,'new');assert.equal(paths.length,2);
});
test('translation cache and cleanup failure revoke old device translations before delivering the receipt',async()=>{
 const store=fixture();let cleared=0;const originalClear=store.clear;store.saveBook=async()=>{throw Object.assign(Error('quota'),{code:'cache_quota'});};store.remove=async()=>{throw Object.assign(Error('cannot remove'),{code:'cache_unavailable'});};store.clear=async()=>{cleared++;await originalClear();};
 const transport=createOfflineReadingTransport({store,bookId:'book',fetcher:async()=>json({id:'p1',original:'Actual saved source',translations:{literal:{text:'New'},interpretive:{text:'New interpretation'}}})});
 assert.equal((await transport.fetch('/api/library/books/book/translate',{method:'POST',body:'{}'})).status,200);assert.equal(cleared,1);assert.equal(transport.hasScope(),false);transport.setOffline();await assert.rejects(transport.fetch('/api/library/books/book/reading'));
});
test('an unsaved automatic resume returns a saved chapter with an explicit fallback marker',async()=>{
 const store=fixture(),partial={...structuredClone(book),chapters:[{id:'ch1'},{id:'ch2'}],sections:[...chapter.sections,{number:2,chapterId:'ch2',paragraphs:[{id:'p2',unloaded:true}]}],reading:{partial:true,loadedChapters:['ch1'],availableChapters:['ch1']}};store.metadata=async()=>structuredClone(partial);store.book=async()=>structuredClone(partial);
 const transport=createOfflineReadingTransport({store,bookId:'book',offline:true});const opened=await (await transport.fetch('/api/library/books/book/reading?passageId=p2&chapterId=ch2')).json();assert.deepEqual(opened.reading.offlineFallback,{requestedChapterId:'ch2',chapterId:'ch1',passageId:'p1'});assert.equal(opened.sections[0].paragraphs[0].original,'Actual saved source');assert.equal(opened.chapters.length,2);
});
test('automatic offline resources respect data saving while explicit downloads remain available',async()=>{
 const {prepareOfflineResources}=await import('../app/offline-reading.mjs'),descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let registrations=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{connection:{saveData:true},serviceWorker:{getRegistration:async()=>undefined,register:async()=>{registrations++;throw Error('test registration');}}}});
 try{assert.equal(await prepareOfflineResources(),false);assert.equal(registrations,0);assert.equal(await prepareOfflineResources({explicit:true}),false);assert.equal(registrations,1);}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
