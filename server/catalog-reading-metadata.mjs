import {digest} from './document-import.mjs';

// Layout/provenance corrections are pinned to immutable published text. They do
// not replace originals, content versions, paragraph IDs or personal overlays.
export function applyCatalogReadingMetadata(book,metadata){
 const invalid=()=>{throw Error('Invalid catalog reading metadata: '+book.bookId);};
 if(metadata.contentVersion!==book.contentVersion||!metadata.passages||typeof metadata.passages!=='object'||Array.isArray(metadata.passages))invalid();
 const paragraphs=new Map(book.sections.flatMap(s=>s.paragraphs).map(p=>[p.id,p]));
 const pending=[];
 for(const [id,layout] of Object.entries(metadata.passages)){
  const p=paragraphs.get(id);if(!p||layout.sha256!==digest(p.original))invalid();
  const breaks=layout.lineBreaks;
  if(breaks!==undefined&&(!Array.isArray(breaks)||!breaks.length||breaks.length>1000||breaks.some((n,i)=>!Number.isSafeInteger(n)||n<=0||n>=p.original.length||i>0&&n<=breaks[i-1]||/[\uD800-\uDBFF]/.test(p.original[n-1])&&/[\uDC00-\uDFFF]/.test(p.original[n]))))invalid();
  if(layout.labelBefore!==undefined&&(typeof layout.labelBefore!=='string'||!layout.labelBefore.trim()||layout.labelBefore.length>400))invalid();
  pending.push([p,{...(breaks?{lineBreaks:[...breaks]}:{}),...(layout.labelBefore?{labelBefore:layout.labelBefore}:{})}]);
 }
 if(metadata.notices!==undefined&&typeof metadata.notices!=='string')invalid();
 // Validate the entire mapping before changing anything.
 for(const [p,layout] of pending)p.source={...p.source,...layout};
 if(metadata.notices)book.licenseNotices=[book.licenseNotices,metadata.notices].filter(Boolean).join('\n\n');
 return book;
}
