import {arrivalExcerpt} from '../app/arrival-excerpt.mjs';
// Public catalog artifacts only; never open an instance directory or credentials.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {structuredCatalogBook} from '../server/structured-catalog.mjs';

// Audited source paragraphs: these editions open with a heading, byline or date.
// Keep the reading start intact and fail closed when an edition changes its IDs.
const excerptPassages={
 'gutenberg-rubaiyat':'518a6c37316408ff-p00002',
 'gutenberg-brazilian-tales':'ca69c2d6fbd88c50-p00056',
 'gutenberg-home-and-world':'d2d1ae6bce21a95d-p00003',
 'gutenberg-young-werther':'e74a117f3ba44a2e-p00002',
 'gutenberg-african-farm':'c24e2b5f86aa4634-p00002',
 'gutenberg-candide':'35a0415f40c38c2c-p00002',
 'gutenberg-tao-te-ching':'2645bca82104b6fa-p00002',
};

export async function buildArrivalCatalog(root){
 const entries=JSON.parse(await readFile(path.join(root,'catalog/manifest.json'),'utf8')),result={};
 for(const entry of entries.filter(row=>row.format==='structured').sort((a,b)=>a.id.localeCompare(b.id))){
  if(!/^world\/[a-z0-9-]+\.json$/.test(entry.file)||!/^[a-z][a-z0-9-]+$/.test(entry.id))throw Error('Unexpected public catalog path or ID');
  const bytes=await readFile(path.join(root,'catalog',entry.file)),book=structuredCatalogBook(entry,bytes);
  const passageId=excerptPassages[book.bookId]||book.readingStart.passageId;
  const section=book.sections.find(row=>row.paragraphs.some(p=>p.id===passageId)),paragraph=section?.paragraphs.find(row=>row.id===passageId);
  if(!paragraph)throw Error('Audited arrival passage is missing: '+book.bookId);
  const original=paragraph.original.trim();
  const chapter=book.chapters.find(row=>row.id===section.chapterId);
  result[book.bookId]={bookId:book.bookId,title:entry.title,author:entry.author,chapter:chapter.title.zh,sourceUrl:entry.sourceUrl,original:arrivalExcerpt(original),translation:null,sourceLanguage:entry.sourceLanguage||'en',context:'书中一段',passageId:paragraph.id,contentVersion:book.contentVersion};
 }
 return result;
}
export const renderArrivalCatalog=value=>'// Generated from public catalog sources by tools/build-arrival-catalog.mjs.\nexport const arrivalCatalog=Object.freeze('+JSON.stringify(value,null,2)+');\n';
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const file=path.resolve('app/arrival-catalog.mjs'),output=renderArrivalCatalog(await buildArrivalCatalog(process.cwd()));
 if(process.argv.includes('--check')){if(await readFile(file,'utf8')!==output)throw Error('Arrival catalog is stale; regenerate and review source-bound changes.');console.log('Public arrival excerpts are current.');}
 else{await writeFile(file,output);console.log('Generated public arrival excerpts.');}
}
