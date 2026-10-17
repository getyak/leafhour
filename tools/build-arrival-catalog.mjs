// Public catalog artifacts only; never open an instance directory or credentials.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {structuredCatalogBook} from '../server/structured-catalog.mjs';

export async function buildArrivalCatalog(root){
 const entries=JSON.parse(await readFile(path.join(root,'catalog/manifest.json'),'utf8')),result={};
 for(const entry of entries.filter(row=>row.format==='structured').sort((a,b)=>a.id.localeCompare(b.id))){
  if(!/^world\/[a-z0-9-]+\.json$/.test(entry.file)||!/^[a-z][a-z0-9-]+$/.test(entry.id))throw Error('Unexpected public catalog path or ID');
  const bytes=await readFile(path.join(root,'catalog',entry.file)),book=structuredCatalogBook(entry,bytes);
  const section=book.sections.find(row=>row.chapterId===book.readingStart.chapterId),paragraph=section.paragraphs.find(row=>row.id===book.readingStart.passageId),original=paragraph.original.trim();
  const chapter=book.chapters.find(row=>row.id===section.chapterId);
  result[book.bookId]={bookId:book.bookId,title:entry.title,author:entry.author,chapter:chapter.title.zh,sourceUrl:entry.sourceUrl,original:original.length>280?original.slice(0,280).trimEnd()+'…':original,translation:null,sourceLanguage:'en',context:'书中一段',passageId:paragraph.id,contentVersion:book.contentVersion};
 }
 return result;
}
export const renderArrivalCatalog=value=>'// Generated from public catalog sources by tools/build-arrival-catalog.mjs.\nexport const arrivalCatalog=Object.freeze('+JSON.stringify(value,null,2)+');\n';
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const file=path.resolve('app/arrival-catalog.mjs'),output=renderArrivalCatalog(await buildArrivalCatalog(process.cwd()));
 if(process.argv.includes('--check')){if(await readFile(file,'utf8')!==output)throw Error('Arrival catalog is stale; regenerate and review source-bound changes.');console.log('Public arrival excerpts are current.');}
 else{await writeFile(file,output);console.log('Generated public arrival excerpts.');}
}
