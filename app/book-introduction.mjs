const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&value.isWellFormed();
const invalid=()=>Object.assign(Error('AI 简介的来源或格式不完整'),{status:400});
function normalizeIntroduction(value,book,ids){
  if(!value||value.kind!=='leafhour-book-introduction'||value.schemaVersion!==1||value.origin!=='ai'||value.status!=='draft'||value.model!=='deepseek-flash'||value.scope!=='opening-sample'||value.contentVersion!==book.contentVersion||!text(value.text,1200)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Array.isArray(value.sourcePassageIds)||!value.sourcePassageIds.length||value.sourcePassageIds.length>6||new Set(value.sourcePassageIds).size!==value.sourcePassageIds.length||value.sourcePassageIds.some(id=>!ids.has(id)))throw invalid();
  return {kind:value.kind,schemaVersion:1,origin:'ai',status:'draft',text:value.text.trim(),contentVersion:book.contentVersion,createdAt:value.createdAt,model:'deepseek-flash',scope:'opening-sample',sourcePassageIds:[...value.sourcePassageIds]};
}
export function validateBookIntroduction(value,book){
  return normalizeIntroduction(value,book,new Set(introductionContext(book).passages.map(p=>p.id)));
}
export function introductionFor(book){
  if(typeof book?.description==='string'&&book.description.trim()&&book.description.isWellFormed())return {source:'provided',text:book.description};
  // Reading responses can omit unloaded chapter text. Storage and backup restore
  // validate the actual opening; presentation only reads that validated record.
  if(book?.introduction)try{return {source:'ai',text:normalizeIntroduction(book.introduction,book,new Set((book.sections||[]).flatMap(s=>s.paragraphs||[]).map(p=>p.id))).text};}catch{}
  return {source:'missing',text:''};
}
export function introductionContext(book){
  const clip=(value,max)=>typeof value==='string'?[...value].slice(0,max).join(''):'';
  const chapters=(book.chapters||[]).slice(0,24).map(c=>({id:c.id,title:{zh:clip(c.title?.zh,200),en:clip(c.title?.en,200)}}));
  const excluded=new Set((book.chapters||[]).filter(c=>c.kind&&!['body','source-section'].includes(c.kind)).map(c=>c.id));
  const passages=[];let remaining=6000;
  for(const section of book.sections||[]){
    if(excluded.has(section.chapterId))continue;
    for(const p of section.paragraphs||[]){
      if(passages.length===6||!remaining)break;
      if(p.kind==='source_heading'||!text(p.original,100000))continue;
      const original=clip(p.original,remaining);remaining-=[...original].length;passages.push({id:p.id,original});
    }
    if(passages.length===6||!remaining)break;
  }
  const context={title:{zh:clip(book.title?.zh,500),en:clip(book.title?.en,500)},author:clip(book.author,500),chapters,passages,scope:'opening-sample'};
  // The existing Harness envelope also includes a location and its prompt.
  // Bound encoded bytes as well as characters for long CJK/Unicode metadata.
  const size=()=>new TextEncoder().encode(JSON.stringify(context)).length;
  const metadataSize=()=>new TextEncoder().encode(JSON.stringify({...context,passages:[]})).length;
  while(metadataSize()>6000&&chapters.length)chapters.pop();
  while(size()>18000&&passages.length){const last=passages.at(-1),chars=[...last.original];if(chars.length<=128)passages.pop();else last.original=chars.slice(0,-128).join('');}
  return context;
}
