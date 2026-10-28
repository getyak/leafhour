import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const offline=await import('../app/offline-book-store.mjs').catch(()=>({}));
const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const canonical=value=>JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a<b?-1:a>b?1:0)):row);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function sample(id='book',text='Original passage'){
 const book={bookId:id,title:'Offline sample',author:'Sample author',contentVersion:'source-v1',chapters:[{id:'one',title:'One'},{id:'two',title:'Two'}],sections:[{chapterId:'one',number:1,title:'Start',paragraphs:[{id:'p-one',original:text,translations:{literal:{text:'Literal draft',status:'draft'},interpretive:{text:'Interpretive draft',status:'draft'}}}]},{chapterId:'two',number:2,paragraphs:[{id:'p-two',original:'The next passage',translations:{}}]}]};
 book.readingCache={schemaVersion:1,snapshotId:'snapshot-'+id,chapters:Object.fromEntries(book.chapters.map(c=>[c.id,digest(payload(book,c.id))]))};return book;
}
function payload(book,id){return {bookId:book.bookId,contentVersion:book.contentVersion,chapterId:id,sections:clone(book.sections.filter(s=>s.chapterId===id))};}
function manifest(book){const result=clone(book);result.sections=result.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({id:p.id,unloaded:true}))}));result.reading={partial:true,loadedChapters:[],hasTranslations:true};return result;}
function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function memoryBackend(){
 let rows={books:new Map(),chapters:new Map()},queue=Promise.resolve();
 const backend={fail:false,gate:null,bodyReads:0,async run(mode,operation){
  const task=queue.then(async()=>{if(backend.gate){const gate=backend.gate;backend.gate=null;await gate.promise;}if(backend.fail)throw Error('Storage failed');
   const next=mode==='readwrite'?clone(rows):rows;
   const tx={async get(store,key){if(store==='chapters')backend.bodyReads++;return clone(next[store].get(key));},async all(store){if(store==='chapters')throw Error('Capacity must not scan chapter text');return [...next[store].values()].map(clone);},async keys(store,index,key){return [...next[store]].filter(([,row])=>!index||row[index]===key).map(([id])=>id);},async put(store,row){next[store].set(row.key,clone(row));},async delete(store,key){next[store].delete(key);}};
   const result=await operation(tx);if(mode==='readwrite')rows=next;return result;
  });queue=task.catch(()=>{});return task;
 },damageChapter(change){for(const row of rows.chapters.values()){change(row);break;}},dropChapter(){rows.chapters.delete(rows.chapters.keys().next().value);}};return backend;
}
function setup(options={}){assert.equal(typeof offline.createOfflineBookStore,'function','Persistent offline chapter storage is not implemented');const storage=memoryStorage(),backend=memoryBackend();return {storage,backend,store:offline.createOfflineBookStore({storage,backend,...options})};}
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('complete saved books reopen with exact original and distinct translations',async()=>{
 const {store,storage,backend}=setup(),book=sample();await store.adopt('account-a');await store.saveBook(book,{pin:true});book.sections[0].paragraphs[0].original='Changed after save';
 const reopened=offline.createOfflineBookStore({storage,backend});assert.equal(reopened.owner(),'account-a');const saved=await reopened.book('book');
 assert.equal(saved.sections[0].paragraphs[0].original,'Original passage');assert.equal(saved.sections[0].paragraphs[0].translations.literal.text,'Literal draft');assert.equal(saved.sections[0].paragraphs[0].translations.interpretive.text,'Interpretive draft');assert.deepEqual(saved.reading,{partial:true,loadedChapters:['one','two'],hasTranslations:true});
 assert.deepEqual(await reopened.status('book'),{complete:true,loaded:2,total:2,pinned:true,bytes:(await reopened.status('book')).bytes});
 saved.sections[0].paragraphs[0].original='Mutated read';assert.equal((await reopened.chapter('book','one')).sections[0].paragraphs[0].original,'Original passage');
});
test('manifest-only books expose only actually stored chapter bodies',async()=>{
 const {store}=setup(),book=sample();await store.adopt('guest');await store.saveBook(manifest(book));assert.deepEqual((await store.book('book')).reading.loadedChapters,[]);await rejectsCode(store.chapter('book','one'),'offline_missing');
 await store.saveChapter('book',payload(book,'one'));const cached=await store.book('book');assert.deepEqual(cached.reading.loadedChapters,['one']);assert.equal(cached.sections[1].paragraphs[0].unloaded,true);assert.deepEqual({...await store.status('book'),bytes:0},{complete:false,loaded:1,total:2,pinned:false,bytes:0});
});
test('chapter hash and stable paragraph structure both fence invalid content',async()=>{
 const {store}=setup(),book=sample();await store.adopt('guest');await store.saveBook(manifest(book));const bad=payload(book,'one');bad.sections[0].paragraphs[0].original='Wrong contents';await rejectsCode(store.saveChapter('book',bad),'cache_stale');
 const changed=sample();changed.sections[0].paragraphs[0].id='wrong-id';const canonicalButWrong=payload(changed,'one'),metadata=manifest(book);metadata.readingCache.chapters.one=digest(canonicalButWrong);await store.saveBook(metadata);await rejectsCode(store.saveChapter('book',canonicalButWrong),'cache_stale');assert.equal((await store.status('book')).loaded,0);
});
test('translation changes invalidate only the changed chapter despite stable source version',async()=>{
 const {store}=setup(),book=sample();await store.adopt('account-a');await store.saveBook(book,{pin:true});const newer=sample();newer.sections[0].paragraphs[0].translations.literal.text='New literal draft';newer.readingCache.snapshotId='snapshot-new';newer.readingCache.chapters.one=digest(payload(newer,'one'));await store.saveBook(manifest(newer));
 assert.deepEqual((await store.book('book')).reading.loadedChapters,['two']);assert.equal((await store.status('book')).pinned,true);await rejectsCode(store.chapter('book','one',{hash:book.readingCache.chapters.one}),'cache_stale');await rejectsCode(store.saveChapter('book',payload(book,'one')),'cache_stale');await store.saveChapter('book',payload(newer,'one'));assert.equal((await store.chapter('book','one')).sections[0].paragraphs[0].translations.literal.text,'New literal draft');
});
test('same-owner adoption preserves tokens while a cross-tab owner change fences old reads and writes',async()=>{
 const {store,storage,backend}=setup();await store.adopt('account-a');const token=store.capture();await store.saveBook(sample());await store.adopt('account-a');assert.equal(store.current(token),true);
 const other=offline.createOfflineBookStore({storage,backend});await other.adopt('account-b');assert.equal(store.owner(),null);assert.equal(store.current(token),false);await rejectsCode(store.book('book',{token}),'cache_stale');await rejectsCode(store.saveBook(sample('late'),{token}),'cache_stale');assert.deepEqual(await other.list(),[]);await other.adopt('account-a');await rejectsCode(other.book('book'),'offline_missing');
});
test('clear revokes the owner synchronously even if persistent deletion fails',async()=>{
 const {store,storage,backend}=setup();await store.adopt('account-a');await store.saveBook(sample());storage.setItem('reader-note-drafts|account-a','Keep draft');storage.setItem('reader-progress|account-a','Keep progress');backend.fail=true;const clearing=store.clear();assert.equal(store.owner(),null);assert.equal(offline.createOfflineBookStore({storage,backend}).owner(),null);await rejectsCode(clearing,'cache_unavailable');backend.fail=false;await store.adopt('account-a');await rejectsCode(store.book('book'),'offline_missing');assert.equal(storage.getItem('reader-note-drafts|account-a'),'Keep draft');assert.equal(storage.getItem('reader-progress|account-a'),'Keep progress');
});
test('a delayed transaction cannot publish a former owner’s book after clear',async()=>{
 const {store,backend}=setup();await store.adopt('account-a');const gate=deferred();backend.gate=gate;const saving=store.saveBook(manifest(sample()));const clearing=store.clear();gate.resolve();await rejectsCode(saving,'cache_stale');await clearing;await store.adopt('account-a');assert.deepEqual(await store.list(),[]);
});
test('capacity evicts the least recently used automatic book and keeps explicitly pinned books',async()=>{
 let time=1;const {store,backend}=setup({maxBytes:11000,now:()=>time++});await store.adopt('guest');const a=sample('a','A'.repeat(1800)),b=sample('b','B'.repeat(1800)),c=sample('c','C'.repeat(1800));await store.saveBook(a,{pin:true});await store.saveBook(b);await store.book('a');backend.bodyReads=0;await store.saveBook(c);
 const list=await store.list();assert.deepEqual(list.map(b=>b.bookId).sort(),['a','c']);assert.equal(list.find(b=>b.bookId==='a').pinned,true);assert.equal(backend.bodyReads,0,'Capacity accounting reads metadata, never chapter bodies');
});
test('quota rejection preserves pinned content and leaves an unsuccessful new book absent',async()=>{
 const {store}=setup({maxBytes:11000});await store.adopt('guest');await store.saveBook(sample('pinned','A'.repeat(1600)),{pin:true});await rejectsCode(store.saveBook(sample('too-large','Z'.repeat(8500)),{pin:true}),'cache_quota');assert.deepEqual((await store.list()).map(b=>b.bookId),['pinned']);assert.equal((await store.status('pinned')).complete,true);
});
test('remove and unpin operate on the selected book only',async()=>{
 const {store}=setup();await store.adopt('guest');await store.saveBook(sample('a'),{pin:true});await store.saveBook(sample('b'));await store.pin('a',false);assert.equal((await store.status('a')).pinned,false);await store.remove('a');await rejectsCode(store.book('a'),'offline_missing');assert.deepEqual((await store.list()).map(b=>b.bookId),['b']);
});
test('damaged and missing persisted chapters never count as readable complete books',async()=>{
 const {store,backend}=setup();await store.adopt('guest');await store.saveBook(sample());backend.damageChapter(row=>row.payload.sections[0].paragraphs[0].original='Corrupted');const cached=await store.book('book');assert.deepEqual(cached.reading.loadedChapters,['two']);assert.equal((await store.status('book')).complete,false);backend.dropChapter();assert.equal((await store.status('book')).loaded,0);
});
test('unavailable browser storage reports an operational cache error',async()=>{
 assert.equal(typeof offline.createOfflineBookStore,'function');const store=offline.createOfflineBookStore({indexedDB:null,storage:memoryStorage()});await rejectsCode(store.adopt('guest'),'cache_unavailable');
});

test('malformed cache inputs fail with stable operational codes',async()=>{
 const {store}=setup();await store.adopt('guest');await rejectsCode(store.saveBook(null),'cache_stale');await rejectsCode(store.saveChapter('book',null),'cache_stale');await rejectsCode(store.saveBook({notCloneable(){}}),'cache_stale');
});
test('a storage marker write failure removes the previous owner before reuse',async()=>{
 const {store,storage,backend}=setup();await store.adopt('account-a');await store.saveBook(sample());const unavailable=offline.createOfflineBookStore({backend,storage:{getItem:storage.getItem,setItem(){throw new DOMException('Full','QuotaExceededError');},removeItem:storage.removeItem}});await rejectsCode(unavailable.adopt('account-b'),'cache_unavailable');assert.equal(store.current(store.capture()),false);assert.equal(offline.createOfflineBookStore({storage,backend}).owner(),null);
});
test('a hash verification completing after account replacement cannot persist or return old text',async()=>{
 const {storage,backend}=setup(),started=deferred(),gate=deferred();let delay=false;
 const crypto={subtle:{async digest(...args){if(delay){delay=false;started.resolve();await gate.promise;}return globalThis.crypto.subtle.digest(...args);}}};
 const store=offline.createOfflineBookStore({storage,backend,crypto});await store.adopt('account-a');await store.saveBook(sample());const token=store.capture();delay=true;const reading=store.book('book',{token});await started.promise;const other=offline.createOfflineBookStore({storage,backend});await other.adopt('account-b');gate.resolve();await rejectsCode(reading,'cache_stale');assert.deepEqual(await other.list(),[]);
});
test('metadata alone consumes quota and a missing book has no status',async()=>{
 const {store}=setup({maxBytes:128});await store.adopt('guest');await rejectsCode(store.saveBook(manifest(sample())),'cache_quota');await rejectsCode(store.status('book'),'offline_missing');
});
test('automatic eviction follows recent reading rather than initial save order',async()=>{
 let time=1;const {store}=setup({maxBytes:11000,now:()=>time++});await store.adopt('guest');await store.saveBook(sample('a','A'.repeat(1800)));await store.saveBook(sample('b','B'.repeat(1800)));await store.chapter('a','one');await store.saveBook(sample('c','C'.repeat(1800)));assert.deepEqual((await store.list()).map(b=>b.bookId).sort(),['a','c']);
});

test('metadata reports available chapters without reading or hashing any chapter body',async()=>{
 let hashes=0;const crypto={subtle:{digest(...args){hashes++;return globalThis.crypto.subtle.digest(...args);}}};const {store,backend}=setup({crypto}),book=sample();book.readingCache.manifestTag='"'+'a'.repeat(64)+'"';await store.adopt('guest');await store.saveBook(book);backend.bodyReads=0;hashes=0;
 assert.equal(typeof store.metadata,'function','Metadata-only offline reading is not implemented');const metadata=await store.metadata('book');assert.equal(backend.bodyReads,0);assert.equal(hashes,0);assert.equal(metadata.readingCache.manifestTag,'"'+'a'.repeat(64)+'"');assert.ok(metadata.sections.every(section=>section.paragraphs.every(p=>p.unloaded===true&&p.original===undefined)));assert.deepEqual(metadata.reading,{partial:true,loadedChapters:[],hasTranslations:true,availableChapters:['one','two']});
 backend.dropChapter();assert.deepEqual((await store.metadata('book')).reading.availableChapters,['two']);assert.equal(backend.bodyReads,0);assert.equal(hashes,0);
});
test('selected-only recovery reads one body and retains the whole book translation setting',async()=>{
 let hashes=0;const crypto={subtle:{digest(...args){hashes++;return globalThis.crypto.subtle.digest(...args);}}};const {store,backend}=setup({crypto});await store.adopt('guest');await store.saveBook(sample());backend.bodyReads=0;hashes=0;const book=await store.book('book',{chapterId:'two'});
 assert.equal(backend.bodyReads,1);assert.equal(hashes,1);assert.deepEqual(book.reading.loadedChapters,['two']);assert.equal(book.reading.hasTranslations,true);assert.equal(book.sections[0].paragraphs[0].unloaded,true);assert.equal(book.sections[1].paragraphs[0].original,'The next passage');assert.equal((await store.chapter('book','one')).sections[0].paragraphs[0].translations.literal.text,'Literal draft');
});
test('selected-only recovery discards a damaged body without hydrating other cached chapters',async()=>{
 const {store,backend}=setup();await store.adopt('guest');await store.saveBook(sample());backend.damageChapter(row=>row.payload.sections[0].paragraphs[0].original='Tampered');backend.bodyReads=0;const book=await store.book('book',{chapterId:'one'});
 assert.equal(backend.bodyReads,1);assert.deepEqual(book.reading.loadedChapters,[]);assert.ok(book.sections.every(section=>section.paragraphs.every(p=>p.unloaded)));assert.deepEqual((await store.metadata('book')).reading.availableChapters,['two']);assert.equal((await store.chapter('book','two')).sections[0].paragraphs[0].original,'The next passage');
});
test('full recovery still hydrates and verifies every stored chapter when no chapter is selected',async()=>{
 const {store,backend}=setup();await store.adopt('guest');await store.saveBook(sample());backend.bodyReads=0;const book=await store.book('book');assert.equal(backend.bodyReads,2);assert.deepEqual(book.reading,{partial:true,loadedChapters:['one','two'],hasTranslations:true});assert.equal(book.sections[0].paragraphs[0].original,'Original passage');assert.equal(book.sections[1].paragraphs[0].original,'The next passage');
});
test('global translation availability survives metadata-only manifests and resets with a new manifest',async()=>{
 const {store}=setup();await store.adopt('guest');const book=sample();await store.saveBook(manifest(book));assert.equal((await store.metadata('book')).reading.hasTranslations,true);await store.saveChapter('book',payload(book,'two'));assert.equal((await store.book('book',{chapterId:'two'})).reading.hasTranslations,true);
 const untranslated=sample();untranslated.sections[0].paragraphs[0].translations={};untranslated.readingCache.snapshotId='without-translations';untranslated.readingCache.chapters.one=digest(payload(untranslated,'one'));const next=manifest(untranslated);next.reading.hasTranslations=false;await store.saveBook(next);assert.equal((await store.metadata('book')).reading.hasTranslations,false);assert.equal((await store.book('book',{chapterId:'two'})).reading.hasTranslations,false);
});
test('metadata-only reads remain fenced when another tab adopts a different account',async()=>{
 const {store,storage,backend}=setup();await store.adopt('account-a');await store.saveBook(sample());const token=store.capture(),other=offline.createOfflineBookStore({storage,backend});await other.adopt('account-b');assert.equal(typeof store.metadata,'function');await rejectsCode(store.metadata('book',{token}),'cache_stale');
});
