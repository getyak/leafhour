const encoder=new TextEncoder();
const HASH=/^[a-f0-9]{64}$/;
export const cacheError=(code,cause)=>Object.assign(new Error(code,cause?{cause}:undefined),{code});
export const encodedBytes=value=>encoder.encode(JSON.stringify(value)).byteLength;
export function canonicalChapter(value){
 if(!value||typeof value!=='object')throw cacheError('cache_stale');
 try{return {bookId:value.bookId,contentVersion:value.contentVersion,chapterId:value.chapterId,sections:structuredClone(value.sections)};}catch(error){throw cacheError('cache_stale',error);}
}
const stableJson=value=>JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a<b?-1:a>b?1:0)):row);
export async function chapterHash(value,crypto=globalThis.crypto){
 if(!crypto?.subtle)throw cacheError('cache_unavailable');
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(stableJson(canonicalChapter(value))));
 return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256;
export function bookMetadata(input){
 if(!input||!identifier(input.bookId)||!identifier(input.contentVersion)||!Array.isArray(input.chapters)||!Array.isArray(input.sections)||input.readingCache?.schemaVersion!==1||!identifier(input.readingCache.snapshotId)||!input.readingCache.chapters||typeof input.readingCache.chapters!=='object')throw cacheError('cache_stale');
 const chapters=new Set(),passages=new Set();
 for(const chapter of input.chapters){if(!identifier(chapter?.id)||chapters.has(chapter.id)||!Object.hasOwn(input.readingCache.chapters,chapter.id)||!HASH.test(input.readingCache.chapters[chapter.id]))throw cacheError('cache_stale');chapters.add(chapter.id);}
 if(Object.keys(input.readingCache.chapters).length!==chapters.size)throw cacheError('cache_stale');
 for(const section of input.sections){
  if(!section||!chapters.has(section.chapterId)||!Array.isArray(section.paragraphs)||!['number','string'].includes(typeof section.number))throw cacheError('cache_stale');
  for(const paragraph of section.paragraphs){if(!identifier(paragraph?.id)||passages.has(paragraph.id)||(paragraph.unloaded!==true&&typeof paragraph.original!=='string'))throw cacheError('cache_stale');passages.add(paragraph.id);}
 }
 const book=structuredClone(input);delete book.reading;
 book.sections=book.sections.map(section=>({...section,paragraphs:section.paragraphs.map(paragraph=>({id:paragraph.id,unloaded:true}))}));
 return book;
}
export function assertChapter(book,value){
 if(!value||value.bookId!==book.bookId||value.contentVersion!==book.contentVersion||!book.chapters.some(chapter=>chapter.id===value.chapterId)||!Array.isArray(value.sections))throw cacheError('cache_stale');
 const expected=book.sections.filter(section=>section.chapterId===value.chapterId);
 if(expected.length!==value.sections.length)throw cacheError('cache_stale');
 for(let i=0;i<expected.length;i++){
  const section=value.sections[i],wanted=expected[i];
  if(!section||section.chapterId!==value.chapterId||section.number!==wanted.number||!Array.isArray(section.paragraphs)||section.paragraphs.length!==wanted.paragraphs.length||section.paragraphs.some((paragraph,n)=>paragraph?.id!==wanted.paragraphs[n].id||paragraph.unloaded||typeof paragraph.original!=='string'))throw cacheError('cache_stale');
 }
}
