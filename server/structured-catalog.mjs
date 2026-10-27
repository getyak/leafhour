import {makeBook,digest} from './document-import.mjs';

// Intern only decoded public-source documents, keyed by their exact bytes.
// Account overlays and mutable book objects never enter this bounded cache.
const sourceDocuments=new Map(),sourceBudget=64*1024*1024;let sourceBytes=0;
function rememberSource(hash,document,bytes){
 if(sourceDocuments.has(hash))return;
 if(bytes>sourceBudget)return;
 while(sourceDocuments.size&&(sourceBytes+bytes>sourceBudget||sourceDocuments.size>=128)){const key=sourceDocuments.keys().next().value;sourceBytes-=sourceDocuments.get(key).bytes;sourceDocuments.delete(key);}
 sourceDocuments.set(hash,{document,bytes});sourceBytes+=bytes;
}

// Only trusted, versioned catalog artifacts use this path. User uploads keep the
// normal import/review boundary and cannot supply executable extraction rules.
export function structuredCatalogBook(entry,bytes){
 const hash=digest(bytes),document=sourceDocuments.get(hash)?.document||JSON.parse(bytes.toString('utf8'));
 if(document.schemaVersion!==1||!Array.isArray(document.chapters)||!document.chapters.length)throw Error('Invalid structured catalog: '+entry.id);
 const book=makeBook({bookId:entry.id,filename:entry.file,sourceHash:hash,extracted:{format:'json',review:'extracted_unreviewed',pages:[{page:null,text:document.chapters[0].paragraphs.join('\n\n')}]},title:entry.title,author:entry.author,visibility:'public',sourceUrl:entry.sourceUrl,license:document.license});
 book.chapters=[];book.sections=[];let count=0,number=0;
 const layouts=document.layouts||{};
 if(!layouts||typeof layouts!=='object'||Array.isArray(layouts))throw Error('Invalid catalog source layout: '+entry.id);
 for(const [key,layout] of Object.entries(layouts)){
  const match=/^(\d+):(\d+)$/.exec(key),chapter=match&&document.chapters[Number(match[1])];
  if(!match||String(Number(match[1]))!==match[1]||String(Number(match[2]))!==match[2]||!chapter?.paragraphs?.[Number(match[2])]||!layout||layout.presentation!=='preformatted'||Object.keys(layout).some(k=>k!=='presentation'))throw Error('Invalid catalog source layout: '+entry.id);
 }
 for(const [index,chapter] of document.chapters.entries()){
  if(typeof chapter.title!=='string'||!chapter.title||!['body','frontmatter','appendix'].includes(chapter.kind)||!Array.isArray(chapter.paragraphs)||!chapter.paragraphs.length||chapter.paragraphs.some(p=>typeof p!=='string'||!p.trim()||p.length>100000))throw Error('Invalid catalog chapter: '+entry.id);
  const id='ch'+String(index+1).padStart(2,'0'),paragraphs=chapter.paragraphs.map((original,paragraphIndex)=>({id:hash.slice(0,16)+'-p'+String(++count).padStart(5,'0'),original,translations:{},source:{pdfPage:null,printedPage:null,review:'extracted_unreviewed',...(layouts[index+':'+paragraphIndex]?{presentation:'preformatted'}:{})},annotationIds:[],termIds:[]}));
  const title={zh:chapter.title,en:chapter.title};
  if(chapter.sourceHeadings!==undefined&&(!Array.isArray(chapter.sourceHeadings)||chapter.sourceHeadings.some(value=>typeof value!=='string'||!value.trim()||value.length>10000)))throw Error('Invalid catalog source headings: '+entry.id);
  book.chapters.push({id,number:chapter.kind==='body'?++number:0,kind:chapter.kind,title,titleAttribution:structuredClone(chapter.titleAttribution||'source'),startPassageId:paragraphs[0].id,...(chapter.sourceHeadings?{sourceHeadings:[...chapter.sourceHeadings]}:{})});
  book.sections.push({number:index+1,chapterId:id,title:chapter.title,paragraphs});
  if(chapter.kind==='body'&&!book.readingStart)book.readingStart={chapterId:id,passageId:paragraphs[0].id};
 }
 if(!book.readingStart)throw Error('Catalog has no body: '+entry.id);
 const resources=[];
 if(document.resources!==undefined&&(!Array.isArray(document.resources)||document.resources.length>100))throw Error('Invalid catalog source resources: '+entry.id);
 for(const item of document.resources||[]){
  const paragraph=Number.isSafeInteger(item.chapterIndex)&&Number.isSafeInteger(item.paragraphIndex)&&book.sections[item.chapterIndex]?.paragraphs[item.paragraphIndex];
  if(!paragraph||!/^\/book-assets\/[a-z0-9][a-z0-9_.-]*\.(?:png|jpe?g|gif|webp)$/.test(item.url||'')||typeof item.title!=='string'||!item.title.trim()||item.title.length>500||!/^[a-f0-9]{64}$/.test(item.sha256||'')||!/^image\/(?:png|jpeg|gif|webp)$/.test(item.mime||'')||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.anchorSha256&&digest(paragraph.original)!==item.anchorSha256)throw Error('Invalid catalog source resource: '+entry.id);
  const resource=structuredClone({url:item.url,title:item.title,sha256:item.sha256,mime:item.mime,bytes:item.bytes,...(item.originalUrl?{originalUrl:item.originalUrl}:{}),...(item.width?{width:item.width,height:item.height}:{})});
  (paragraph.source.resources??=[]).push(resource);resources.push(resource);
 }
 book.source={...book.source,structure:'source_chapters',structureVersion:'structured-catalog-1',chapterBoundaryReview:'source_headings_checked',downloadUrl:document.downloadUrl,downloadSha256:document.downloadSha256,translation:entry.translation||null,originalLanguage:entry.originalLanguage||'en',edition:document.edition,scope:document.scope,illustrations:resources.length?'linked_originals':'not_included',...(resources.length?{resources}:{})};
 book.source=structuredClone(book.source);book.licenseNotices=structuredClone(document.notices);
 book.title.en=entry.originalTitle;book.description=entry.description;book.cover=entry.cover;book.topics=entry.topics;book.sourceLanguage=entry.sourceLanguage||'en';
 if(document.layouts&&Object.keys(document.layouts).length)book.source.formattedTables=true;
 book.createdAt=structuredClone(document.importedAt);
 rememberSource(hash,document,bytes.length);
 return book;
}
