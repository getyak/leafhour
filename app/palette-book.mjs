import {normalizePaletteQuery,PALETTE_RESULT_LIMIT} from './palette-library.mjs';

const fold=value=>String(value||'').normalize('NFKC').toLowerCase();
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const title=value=>value?.en||value?.zh||'';
function excerpt(text,at){
 const iterator=segmenter.segment(text)[Symbol.iterator](),chars=[];let width=0,start=0;
 while(width<at){const next=iterator.next();if(next.done)break;chars.push(next.value.segment);width+=fold(next.value.segment).length;if(chars.length>36){chars.shift();start++;}}
 while(chars.length<180){const next=iterator.next();if(next.done)return (start?'…':'')+chars.join('');chars.push(next.value.segment);}
 return (start?'…':'')+chars.join('')+(iterator.next().done?'':'…');
}
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
    const text=p.original;if(typeof text!=='string')continue;const at=fold(text).indexOf(needle);if(at<0)continue;
    // Retain exact source characters in the excerpt, including surrogate pairs.
    hits.push({id:'passage:'+p.id,passageId:p.id,chapterId:chapter.id,label:excerpt(text,at),chapter:title(chapter.title)});
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
