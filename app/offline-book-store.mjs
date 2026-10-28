import {createOfflineIdb} from './offline-idb.mjs';
import {assertChapter,bookMetadata,cacheError,canonicalChapter,chapterHash,encodedBytes} from './offline-book-codec.mjs';

const MARKER='leafhour:offline-reading:scope:v1';
const clone=value=>structuredClone(value);
function inputCopy(value){try{return clone(value);}catch(error){throw cacheError('cache_stale',error);}}
const scopeOf=token=>JSON.stringify([token.owner,token.epoch]);
const bookKey=(token,id)=>JSON.stringify([scopeOf(token),id]);
const chapterKey=(key,id,hash)=>JSON.stringify([key,id,hash]);
const own=(value,key)=>Object.hasOwn(value||{},key);
const knownError=error=>['offline_missing','cache_unavailable','cache_quota','cache_stale'].includes(error?.code);
function accountBytes(row,extra=0){row.bytes=extra;for(let i=0;i<8;i++){const bytes=extra+encodedBytes(row);if(bytes===row.bytes)break;row.bytes=bytes;}return row;}
const chapterCount=row=>row.book.chapters.length;
const translatedSections=sections=>sections.some(section=>section.paragraphs.some(paragraph=>Object.keys(paragraph.translations||{}).length>0));
const statusOf=row=>({complete:Object.keys(row.loaded).length===chapterCount(row),loaded:Object.keys(row.loaded).length,total:chapterCount(row),pinned:row.pinned,bytes:row.bytes});
function summaryOf(row){const {sections,reading,...metadata}=row.book;return {...metadata,...statusOf(row),lastUsed:row.lastUsed};}
function sizedBook(row){return accountBytes(row,Object.values(row.loaded).reduce((sum,chapter)=>sum+chapter.bytes,0));}

// The marker is an access fence, not an authentication credential. An epoch is
// part of every IndexedDB key: residual rows after failed deletion are unreachable
// even when the same account signs in again. Same-owner confirmation keeps it.
export function createOfflineBookStore({indexedDB=globalThis.indexedDB,storage=globalThis.localStorage,maxBytes=100*1024*1024,backend=null,now=Date.now,crypto=globalThis.crypto}={}){
 const db=backend||createOfflineIdb({indexedDB});
 const readMarker=()=>{if(!storage?.getItem)throw cacheError('cache_unavailable');try{const marker=JSON.parse(storage.getItem(MARKER)||'null');return marker?.schemaVersion===1&&typeof marker.epoch==='string'&&typeof marker.owner==='string'&&marker.owner?{owner:marker.owner,epoch:marker.epoch}:null;}catch(error){if(error instanceof SyntaxError)return null;throw cacheError('cache_unavailable',error);}};
 let active;try{active=readMarker();}catch{active=null;}
 const epoch=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
 function writeMarker(value){
  if(!storage?.setItem)throw cacheError('cache_unavailable');
  try{storage.setItem(MARKER,JSON.stringify({schemaVersion:1,owner:value?.owner||null,epoch:value?.epoch||epoch()}));}
  catch(error){try{storage.removeItem(MARKER);}catch{}throw cacheError('cache_unavailable',error);}
 }
 function current(token){if(!token||!active||token.owner!==active.owner||token.epoch!==active.epoch)return false;try{const marker=readMarker();return marker?.owner===token.owner&&marker.epoch===token.epoch;}catch{return false;}}
 const capture=()=>current(active)?Object.freeze({...active}):null;
 const guard=token=>{if(!current(token))throw cacheError('cache_stale');};
 async function run(mode,token,operation){
  guard(token);try{const result=await db.run(mode,async tx=>{guard(token);const value=await operation(tx);guard(token);return value;});guard(token);return result;}
  catch(error){if(knownError(error))throw error;throw cacheError(error?.name==='QuotaExceededError'?'cache_quota':'cache_unavailable',error);}
 }
 async function erase(tx,row){for(const key of await tx.keys('chapters','bookKey',row.key))await tx.delete('chapters',key);await tx.delete('books',row.key);}
 async function trim(tx,row){
  const keys=new Set(await tx.keys('chapters','bookKey',row.key));
  for(const [id,chapter] of Object.entries(row.loaded))if(!keys.has(chapterKey(row.key,id,chapter.hash))||row.book.readingCache.chapters[id]!==chapter.hash)delete row.loaded[id];
  return sizedBook(row);
 }
 async function getBook(tx,token,id){const row=await tx.get('books',bookKey(token,id));if(!row)throw cacheError('offline_missing');return trim(tx,row);}
 async function fit(tx,replacement){
  const books=(await tx.all('books')).filter(row=>row.key!==replacement.key);
  let total=books.reduce((sum,row)=>sum+row.bytes,0)+replacement.bytes;
  const evicted=[];for(const row of books.filter(row=>!row.pinned).sort((a,b)=>a.lastUsed-b.lastUsed)){if(total<=maxBytes)break;total-=row.bytes;evicted.push(row);}
  if(total>maxBytes)throw cacheError('cache_quota');for(const row of evicted)await erase(tx,row);
 }
 async function verify(book,value,hash,token){guard(token);assertChapter(book,value);if(await chapterHash(value,crypto)!==hash)throw cacheError('cache_stale');guard(token);return canonicalChapter(value);}
 async function discard(id,chapters,token){if(!chapters.length)return;await run('readwrite',token,async tx=>{const row=await tx.get('books',bookKey(token,id));if(!row)return;for(const [chapterId,hash] of chapters){if(row.loaded[chapterId]?.hash!==hash)continue;await tx.delete('chapters',chapterKey(row.key,chapterId,hash));delete row.loaded[chapterId];}sizedBook(row);await tx.put('books',row);});}
 async function latest(tx,token,id,expected){const row=await getBook(tx,token,id);if(row.book.contentVersion!==expected.contentVersion||row.book.readingCache.snapshotId!==expected.readingCache.snapshotId)throw cacheError('cache_stale');return row;}

 async function adopt(owner){
  if(typeof owner!=='string'||!owner||owner.length>256)throw cacheError('cache_stale');
  const previous=readMarker(),next=previous?.owner===owner?previous:{owner,epoch:epoch()};
  if(previous?.owner!==owner)writeMarker(next);active=next;const token=capture();
  await run('readwrite',token,async tx=>{for(const row of await tx.all('books'))if(row.scope!==scopeOf(token))await erase(tx,row);});return owner;
 }
 async function clear(){
  const previous=active;active=null;
  // This part intentionally precedes the first await, including failure paths.
  const marker=readMarker();if(previous&&marker?.owner===previous.owner&&marker.epoch===previous.epoch)writeMarker(null);
  if(!previous)return;
  try{await db.run('readwrite',async tx=>{for(const row of await tx.all('books'))if(row.scope===scopeOf(previous))await erase(tx,row);});}
  catch(error){throw cacheError('cache_unavailable',error);}
 }
 async function saveBook(input,{pin=false,token=capture()}={}){
  guard(token);const source=inputCopy(input),book=bookMetadata(source),chapters=[];
  for(const chapter of book.chapters){
   const sections=source.sections.filter(section=>section.chapterId===chapter.id);
   const complete=sections.every(section=>section.paragraphs.every(paragraph=>!paragraph.unloaded&&typeof paragraph.original==='string'))&&(!source.reading?.partial||source.reading.loadedChapters?.includes(chapter.id)||sections.some(section=>section.paragraphs.length));
   if(!complete)continue;
   const value={bookId:book.bookId,contentVersion:book.contentVersion,chapterId:chapter.id,sections};chapters.push({id:chapter.id,hash:book.readingCache.chapters[chapter.id],payload:await verify(book,value,book.readingCache.chapters[chapter.id],token)});
  }
  return run('readwrite',token,async tx=>{
   const key=bookKey(token,book.bookId),existing=await tx.get('books',key),loaded=Object.create(null);
   if(existing&&existing.book.contentVersion===book.contentVersion)for(const [id,row] of Object.entries(existing.loaded))if(own(book.readingCache.chapters,id)&&book.readingCache.chapters[id]===row.hash)loaded[id]=row;
   const row={key,scope:scopeOf(token),bookId:book.bookId,book,loaded,hasTranslations:source.reading?.hasTranslations===true||translatedSections(source.sections),pinned:Boolean(pin||existing?.pinned),lastUsed:now(),bytes:0};
   const writes=chapters.map(chapter=>accountBytes({key:chapterKey(key,chapter.id,chapter.hash),scope:row.scope,bookKey:key,chapterId:chapter.id,hash:chapter.hash,payload:chapter.payload,bytes:0}));
   await trim(tx,row);for(const chapter of writes)row.loaded[chapter.chapterId]={hash:chapter.hash,bytes:chapter.bytes};sizedBook(row);await fit(tx,row);
   const retained=new Set(Object.entries(row.loaded).map(([id,value])=>chapterKey(key,id,value.hash)));for(const old of await tx.keys('chapters','bookKey',key))if(!retained.has(old))await tx.delete('chapters',old);
   for(const chapter of writes)await tx.put('chapters',chapter);await tx.put('books',row);return statusOf(row);
  });
 }
 async function saveChapter(id,input,{token=capture()}={}){
  guard(token);const value=canonicalChapter(input),previous=await run('readonly',token,tx=>getBook(tx,token,id)),hash=previous.book.readingCache.chapters[value.chapterId];await verify(previous.book,value,hash,token);
  return run('readwrite',token,async tx=>{
   const row=await getBook(tx,token,id);if(row.book.contentVersion!==value.contentVersion||row.book.readingCache.chapters[value.chapterId]!==hash)throw cacheError('cache_stale');assertChapter(row.book,value);
   const chapter=accountBytes({key:chapterKey(row.key,value.chapterId,hash),scope:row.scope,bookKey:row.key,chapterId:value.chapterId,hash,payload:value,bytes:0});row.loaded[value.chapterId]={hash,bytes:chapter.bytes};row.hasTranslations=Boolean(row.hasTranslations||translatedSections(value.sections));row.lastUsed=now();sizedBook(row);await fit(tx,row);await tx.put('chapters',chapter);await tx.put('books',row);return statusOf(row);
  });
 }
 async function metadata(id,{token=capture()}={}){
  return run('readonly',token,async tx=>{const row=await getBook(tx,token,id),result=clone(row.book);result.reading={partial:true,loadedChapters:[],hasTranslations:Boolean(row.hasTranslations),availableChapters:result.chapters.filter(chapter=>own(row.loaded,chapter.id)).map(chapter=>chapter.id)};return result;});
 }
 async function book(id,{chapterId,token=capture()}={}){
  const {row,chapters}=await run('readonly',token,async tx=>{const row=await getBook(tx,token,id),chapters=[];for(const [id,entry] of Object.entries(row.loaded))if(chapterId===undefined||id===chapterId)chapters.push([id,entry.hash,await tx.get('chapters',chapterKey(row.key,id,entry.hash))]);return {row,chapters};});
  const loaded=new Map(),damaged=[];
  for(const [chapterId,hash,entry] of chapters){try{if(!entry)throw cacheError('offline_missing');loaded.set(chapterId,(await verify(row.book,entry.payload,hash,token)).sections);}catch(error){guard(token);if(error?.code==='cache_unavailable')throw error;damaged.push([chapterId,hash]);}}
  await discard(id,damaged,token);await run('readwrite',token,async tx=>{const fresh=await latest(tx,token,id,row.book);fresh.lastUsed=now();sizedBook(fresh);await tx.put('books',fresh);});
  const result=clone(row.book),offsets=new Map();result.sections=result.sections.map(section=>{if(!loaded.has(section.chapterId))return section;const offset=offsets.get(section.chapterId)||0;offsets.set(section.chapterId,offset+1);return loaded.get(section.chapterId)[offset];});
  result.reading={partial:true,loadedChapters:result.chapters.filter(chapter=>loaded.has(chapter.id)).map(chapter=>chapter.id),hasTranslations:Boolean(row.hasTranslations||translatedSections(result.sections))};guard(token);return result;
 }
 async function chapter(id,chapterId,{hash,token=capture()}={}){
  const {row,entry,expected}=await run('readonly',token,async tx=>{const row=await getBook(tx,token,id),expected=row.book.readingCache.chapters[chapterId];if(hash&&hash!==expected)throw cacheError('cache_stale');if(!own(row.loaded,chapterId))throw cacheError('offline_missing');return {row,expected,entry:await tx.get('chapters',chapterKey(row.key,chapterId,expected))};});
  let value;try{if(!entry)throw cacheError('offline_missing');value=await verify(row.book,entry.payload,expected,token);}catch(error){guard(token);if(error?.code==='cache_unavailable')throw error;await discard(id,[[chapterId,expected]],token);throw cacheError('offline_missing',error);}
  await run('readwrite',token,async tx=>{const fresh=await latest(tx,token,id,row.book);fresh.lastUsed=now();sizedBook(fresh);await tx.put('books',fresh);});return value;
 }
 async function list(){const token=capture();return run('readonly',token,async tx=>{const rows=[];for(const row of await tx.all('books'))if(row.scope===scopeOf(token))rows.push(summaryOf(await trim(tx,row)));return rows.sort((a,b)=>b.lastUsed-a.lastUsed);});}
 async function status(id){const token=capture();return run('readonly',token,async tx=>statusOf(await getBook(tx,token,id)));}
 async function remove(id){const token=capture();return run('readwrite',token,async tx=>{const row=await tx.get('books',bookKey(token,id));if(!row)return false;await erase(tx,row);return true;});}
 async function pin(id,value=true){const token=capture();return run('readwrite',token,async tx=>{const row=await getBook(tx,token,id);row.pinned=Boolean(value);sizedBook(row);await fit(tx,row);await tx.put('books',row);return statusOf(row);});}
 return {adopt,owner:()=>capture()?.owner||null,capture,current,clear,saveBook,saveChapter,metadata,book,chapter,list,remove,pin,status};
}
