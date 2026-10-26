import {normalizePaletteQuery,PALETTE_RESULT_LIMIT} from './palette-library.mjs';

const fold=value=>String(value||'').normalize('NFKC').toLowerCase();
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const title=value=>value?.en||value?.zh||'';
// Search only the current reader's already authorized content. Sparse chapters
// have real IDs/titles but unloaded text; they must never become fake matches.
// No fetch, persistence, personal records or model/indexing service is involved.
export function matchPaletteBook(book,query){
 const needle=fold(normalizePaletteQuery(query));
 if(!book)return {phase:'loading',hits:[]};
 const chapters=book.chapters||[],sections=book.sections||[];
 const partial=sections.some(s=>s.paragraphs.some(p=>p.unloaded));
 const hits=[];
 if(needle){
  for(const section of sections){
   const chapter=chapters.find(c=>c.id===section.chapterId);if(!chapter)continue;
   for(const p of section.paragraphs){
    if(p.unloaded)continue;
    const text=p.original;if(typeof text!=='string'||!fold(text).includes(needle))continue;
    // Retain exact source characters in the excerpt, including surrogate pairs.
    const chars=[...segmenter.segment(text)].map(part=>part.segment),at=fold(text).indexOf(needle);let width=0,index=0;
    while(index<chars.length&&width<at)width+=fold(chars[index++]).length;
    const start=Math.max(0,index-36),snippet=chars.slice(start,start+180).join('');
    hits.push({id:'passage:'+p.id,passageId:p.id,chapterId:chapter.id,label:(start?'…':'')+snippet+(start+180<chars.length?'…':''),chapter:title(chapter.title)});
    if(hits.length===PALETTE_RESULT_LIMIT)break;
   }
   if(hits.length===PALETTE_RESULT_LIMIT)break;
  }
  for(const chapter of chapters){
   if(hits.length>=PALETTE_RESULT_LIMIT+4)break;
   if(!Object.values(chapter.title||{}).some(text=>fold(text).includes(needle)))continue;
   const passageId=chapter.startPassageId||sections.find(s=>s.chapterId===chapter.id)?.paragraphs[0]?.id;
   if(passageId)hits.push({id:'chapter:'+chapter.id,passageId,chapterId:chapter.id,label:title(chapter.title),chapter:title(chapter.title)});
  }
 }
 return {phase:partial?'partial':'ready',hits};
}
