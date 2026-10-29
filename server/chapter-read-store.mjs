import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {digest,fail} from './document-import.mjs';
import {createLockedJsonStore} from './locked-json-store.mjs';
import {createImmutableReadCache} from './immutable-read-cache.mjs';
import {introductionContext} from '../app/book-introduction.mjs';

const contentHash=value=>digest(JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a<b?-1:a>b?1:0)):row));
const busy=()=>fail('书籍正在保存，请稍后重新打开',409);
const LEASE_MS=5*60*1000;
const active=row=>Object.values(row.writers||{}).some(until=>until>Date.now());
const valid=(row,fingerprint)=>row.snapshot?.schemaVersion===2&&row.snapshot.catalogFingerprint===fingerprint&&!active(row);

// The canonical book remains the export/agent format. Reading snapshots are
// immutable chapter documents behind one CAS-published manifest. A durable
// write fence prevents a reader from publishing a snapshot across a mutation,
// including one whose later record/index save fails.
export function createChapterReadStore({dataDir,dataStore=null,loadBook,catalogFingerprint}){
 const store=dataStore||createLockedJsonStore({dataDir:path.join(dataDir,'chapter-store'),busyMessage:'书籍正在保存，请稍后重新打开'});
 const account=user=>{if(!user?.id)throw fail('请先进入自己的书房',401);return digest(user.id);};
 const root=(user,id)=>user?path.join(dataDir,'users',account(user),'reading',digest(id)):path.join(dataDir,'public','reading',digest(id));
 const stateKey=base=>path.join(base,'manifest.json');
 const state=base=>store.read(stateKey(base),{});
 const builds=new Map(),immutableReads=createImmutableReadCache();
 function canonicalRoot(file){
  const parts=path.relative(dataDir,file).split(path.sep);
  if(parts.length!==4||parts[0]!=='users'||!['books','translations'].includes(parts[2])||!(/^[a-f0-9]{64}$/.test(parts[1]))||!(/^[a-f0-9]{64}\.json$/.test(parts[3])))return null;
  return path.join(dataDir,'users',parts[1],'reading',parts[3].slice(0,-5));
 }
 async function writing(file,operation){
  const base=canonicalRoot(file);if(!base)return operation();
  const token=randomUUID();
  await store.mutate(stateKey(base),{},row=>{row.epoch=randomUUID();if(row.snapshot){row.previousChapters=row.snapshot.chapters;row.previousAggregate=row.snapshot.aggregate;}delete row.snapshot;row.writers=Object.fromEntries(Object.entries(row.writers||{}).filter(([,until])=>until>Date.now()));row.writers[token]=Date.now()+LEASE_MS;});
  try{return await operation();}
  finally{await store.mutate(stateKey(base),{},row=>{delete row.writers?.[token];row.epoch=randomUUID();delete row.snapshot;});}
 }
 async function build(user,id,base,fingerprint){
  const started=Date.now(),token=randomUUID();let claim;
  while(!claim){
   claim=await store.mutate(stateKey(base),{},row=>{
    if(valid(row,fingerprint))return {snapshot:row.snapshot};
    if(active(row)||row.build?.until>Date.now())return null;
    row.epoch??=randomUUID();row.build={token,until:Date.now()+LEASE_MS};return {epoch:row.epoch,previousChapters:row.previousChapters,previousAggregate:row.previousAggregate};
   });
   if(!claim){if(Date.now()-started>5000)throw busy();await delay(20);}
  }
  if(claim.snapshot)return claim.snapshot;
  try{
   const full=await loadBook(user,id),book=structuredClone(full);delete book.introduction;delete book._giftReceive;
   const context=introductionContext(book),introductionSections=[{chapterId:book.chapters.find(c=>!c.kind||['body','source-section'].includes(c.kind))?.id,paragraphs:context.passages}];
   const snapshot={schemaVersion:2,id:token,catalogFingerprint:fingerprint,contentVersion:book.contentVersion,byteLength:Buffer.byteLength(JSON.stringify(book)),hasTranslations:book.sections.some(s=>s.paragraphs.some(p=>Object.keys(p.translations||{}).length)),introductionSections,book:{...book,sections:book.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({id:p.id,unloaded:true}))}))},chapters:Object.create(null)};
   const writes=[];
   for(const chapter of book.chapters){
    const value={bookId:book.bookId,contentVersion:book.contentVersion,chapterId:chapter.id,sections:book.sections.filter(s=>s.chapterId===chapter.id)},hash=contentHash(value);
    snapshot.chapters[chapter.id]=hash;
    if(claim.previousChapters?.[chapter.id]!==hash)writes.push(()=>store.mutate(path.join(base,'chapters',hash+'.json'),{},row=>{Object.assign(row,value);}));
   }
   if(snapshot.byteLength<=256*1024){
    const value={bookId:book.bookId,contentVersion:book.contentVersion,book},hash=contentHash(value);snapshot.aggregate=hash;
    if(claim.previousAggregate!==hash)writes.push(()=>store.mutate(path.join(base,'complete',hash+'.json'),{},row=>{Object.assign(row,value);}));
   }
   // Drain every started write before releasing the build lease. A failed
   // batch leaves only unreachable immutable documents, never a manifest.
   for(let offset=0;offset<writes.length;offset+=6){
    const results=await Promise.allSettled(writes.slice(offset,offset+6).map(write=>write()));
    const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   }
   const published=await store.mutate(stateKey(base),{},row=>{
    if(row.epoch!==claim.epoch||active(row)||row.build?.token!==token)return false;
    row.snapshot=snapshot;delete row.previousChapters;delete row.previousAggregate;delete row.build;return true;
   });
   if(!published)throw busy();return snapshot;
  }finally{await store.mutate(stateKey(base),{},row=>{if(row.build?.token===token)delete row.build;});}
 }
 async function manifest(user,id){
  if(typeof id!=='string'||!id||id.length>128)throw fail('找不到这本书',404);
  const fingerprint=catalogFingerprint(id);if(!user&&!fingerprint)throw fail('找不到这本书',404);
  const base=root(user,id),current=await state(base);
  if(valid(current,fingerprint))return current.snapshot;
  const key=stateKey(base);let work=builds.get(key);
  if(!work){work=build(user,id,base,fingerprint);builds.set(key,work);}
  try{return await work;}finally{if(builds.get(key)===work)builds.delete(key);}
 }
 async function assertCurrent(user,id,snapshot){const current=await state(root(user,id));if(!valid(current,catalogFingerprint(id))||current.snapshot.id!==snapshot.id)throw busy();}
 async function chapter(user,id,snapshot,chapterId){
  if(!Object.hasOwn(snapshot.chapters,chapterId))throw fail('找不到这一章',404);
  const file=path.join(root(user,id),'chapters',snapshot.chapters[chapterId]+'.json');
  return immutableReads.read(file,async()=>{
   const value=await store.read(file,null);
   if(!value||value.bookId!==id||value.chapterId!==chapterId||value.contentVersion!==snapshot.contentVersion||contentHash(value)!==snapshot.chapters[chapterId])throw fail('章节内容无法核对，请重新打开这本书',409);
   return value;
  });
 }
 async function complete(user,id,snapshot){
  if(typeof snapshot.aggregate!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.aggregate))throw fail('书籍内容无法核对，请重新打开这本书',409);
  const file=path.join(root(user,id),'complete',snapshot.aggregate+'.json'),value=await immutableReads.read(file,async()=>{
   const value=await store.read(file,null);
   if(!value||value.bookId!==id||value.contentVersion!==snapshot.contentVersion||value.book?.bookId!==id||value.book?.contentVersion!==snapshot.contentVersion||contentHash(value)!==snapshot.aggregate)throw fail('书籍内容无法核对，请重新打开这本书',409);
   return value;
  });
  return value.book;
 }
 return {writing,manifest,chapter,complete,assertCurrent};
}
