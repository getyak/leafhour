import {makeBook,digest} from './document-import.mjs';

// Only trusted, versioned catalog artifacts use this path. User uploads keep the
// normal import/review boundary and cannot supply executable extraction rules.
export function structuredCatalogBook(entry,bytes){
 const document=JSON.parse(bytes.toString('utf8'));
 if(document.schemaVersion!==1||!Array.isArray(document.chapters)||!document.chapters.length)throw Error('Invalid structured catalog: '+entry.id);
 const hash=digest(bytes),book=makeBook({bookId:entry.id,filename:entry.file,sourceHash:hash,extracted:{format:'json',review:'extracted_unreviewed',pages:[{page:null,text:document.chapters[0].paragraphs.join('\n\n')}]},title:entry.title,author:entry.author,visibility:'public',sourceUrl:entry.sourceUrl,license:document.license});
 book.chapters=[];book.sections=[];let count=0,number=0;
 for(const [index,chapter] of document.chapters.entries()){
  if(!chapter.title||!['body','frontmatter','appendix'].includes(chapter.kind)||!Array.isArray(chapter.paragraphs)||!chapter.paragraphs.length||chapter.paragraphs.some(p=>typeof p!=='string'||!p.trim()||p.length>100000))throw Error('Invalid catalog chapter: '+entry.id);
  const id='ch'+String(index+1).padStart(2,'0'),paragraphs=chapter.paragraphs.map(original=>({id:hash.slice(0,16)+'-p'+String(++count).padStart(5,'0'),original,translations:{},source:{pdfPage:null,printedPage:null,review:'extracted_unreviewed'},annotationIds:[],termIds:[]}));
  const title={zh:chapter.title,en:chapter.title};
  book.chapters.push({id,number:chapter.kind==='body'?++number:0,kind:chapter.kind,title,titleAttribution:'source',startPassageId:paragraphs[0].id});
  book.sections.push({number:index+1,chapterId:id,title:chapter.title,paragraphs});
  if(chapter.kind==='body'&&!book.readingStart)book.readingStart={chapterId:id,passageId:paragraphs[0].id};
 }
 if(!book.readingStart)throw Error('Catalog has no body: '+entry.id);
 book.source={...book.source,structure:'source_chapters',structureVersion:'structured-catalog-1',chapterBoundaryReview:'source_headings_checked',downloadUrl:document.downloadUrl,downloadSha256:document.downloadSha256,translation:entry.translation||null,originalLanguage:entry.originalLanguage||'en',edition:document.edition,scope:document.scope,illustrations:'not_included'};
 book.licenseNotices=document.notices;
 book.title.en=entry.originalTitle;book.description=entry.description;book.cover=entry.cover;book.topics=entry.topics;book.sourceLanguage='en';
 book.createdAt=document.importedAt;
 return book;
}
