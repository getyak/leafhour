import {fail} from './document-import.mjs';
const largeBook=book=>Buffer.byteLength(JSON.stringify(book))>256*1024;

// Transport projections never replace the authoritative book or its stable IDs.
// Unloaded entries are identity metadata, not empty source paragraphs.
export function readingView(book,{chapterId,passageId}={}){
 if(!largeBook(book))return book;
 const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===passageId));
 const selected=section?.chapterId||(book.chapters.some(c=>c.id===chapterId)?chapterId:null)||book.readingStart?.chapterId||book.chapters[0].id;
 return {...book,reading:{partial:true,loadedChapters:[selected],hasTranslations:book.sections.some(s=>s.paragraphs.some(p=>Object.keys(p.translations||{}).length>0))},sections:book.sections.map(s=>({...s,paragraphs:s.chapterId===selected?s.paragraphs:s.paragraphs.map(p=>({id:p.id,unloaded:true}))}))};
}
export function readingChapter(book,chapterId,contentVersion){
 if(contentVersion!==book.contentVersion)throw fail('书籍版本已更新，请重新打开这本书',409);
 if(!book.chapters.some(c=>c.id===chapterId))throw fail('找不到这一章',404);
 return {bookId:book.bookId,contentVersion:book.contentVersion,chapterId,sections:book.sections.filter(s=>s.chapterId===chapterId)};
}
