const invalid=()=>{throw Object.assign(Error('高亮无法对应当前文字，请重新选择。'),{status:400});};
const boundary=(text,n)=>n===0||n===text.length||!(text.charCodeAt(n-1)>=0xD800&&text.charCodeAt(n-1)<=0xDBFF&&text.charCodeAt(n)>=0xDC00&&text.charCodeAt(n)<=0xDFFF);
const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const conflict=()=>{throw Object.assign(Error('高亮标识冲突，原记录已保留。'),{status:409});};
export const activeHighlights=records=>(records?.highlights||[]).filter(row=>!row.deletedAt);
export const highlightKey=row=>JSON.stringify([row.bookId,row.contentVersion,row.chapterId,row.parts.map(p=>[p.passageId,p.language,p.language==='en'?'original':p.variant,p.start,p.end,p.text])]);

// Offsets use the browser's UTF-16 text positions. A saved translation may later
// change; keep its quote in backups, but only paint it over an exact text match.
export function normalizeHighlight(input,book,{stored=false,matchCurrent=!stored}={}){
  if(!input||!requestId(input.id)||input.bookId!==book.bookId||input.contentVersion!==book.contentVersion||input.origin!==undefined&&input.origin!=='user'||!Array.isArray(input.parts)||!input.parts.length||input.parts.length>8)invalid();
  const passages=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId}))),index=new Map(passages.map((p,i)=>[p.id,{p,i}]));
  let previous=-1,length=0,language=input.parts[0]?.language;
  const parts=input.parts.map(part=>{
    const found=index.get(part?.passageId);
    if(!found||found.p.chapterId!==input.chapterId||found.i<=previous||!['en','zh'].includes(part.language)||part.language!==language||!['literal','interpretive'].includes(part.variant)||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||part.start<0||part.end<=part.start||part.end>100000||typeof part.text!=='string'||!part.text.trim()||part.text.length!==part.end-part.start)invalid();
    previous=found.i;length+=part.text.length;if(length+2*(input.parts.length-1)>4000)invalid();
    const source=part.language==='en'?found.p.original:found.p.translations?.[part.variant]?.text;
    if((matchCurrent||part.language==='en')&&(typeof source!=='string'||part.end>source.length||!boundary(source,part.start)||!boundary(source,part.end)||source.slice(part.start,part.end)!==part.text))invalid();
    return {passageId:part.passageId,language:part.language,variant:part.language==='en'?'interpretive':part.variant,start:part.start,end:part.end,text:part.text};
  });
  const row={id:input.id,bookId:book.bookId,contentVersion:book.contentVersion,chapterId:input.chapterId,parts,origin:'user'};
  if(stored){
    if(input.origin!=='user'||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||input.deletedAt!==undefined&&(typeof input.deletedAt!=='string'||!Number.isFinite(Date.parse(input.deletedAt))||Date.parse(input.deletedAt)<Date.parse(input.createdAt)))invalid();
    row.createdAt=input.createdAt;if(input.deletedAt)row.deletedAt=input.deletedAt;
    if(input.requestIds!==undefined){if(!Array.isArray(input.requestIds)||input.requestIds.length>1000||input.requestIds.some(id=>!requestId(id)||id===input.id)||new Set(input.requestIds).size!==input.requestIds.length)invalid();row.requestIds=[...input.requestIds];}
  }else if(input.deletedAt!==undefined)invalid();
  return row;
}

export function mergeHighlights(current=[],incoming=[]){
  const rows=new Map(current.map(row=>[row.id,row]));
  for(const row of incoming){const old=rows.get(row.id);if(old&&highlightKey(old)!==highlightKey(row))conflict();const next=!old||row.deletedAt&&!old.deletedAt?row:old,requestIds=[...new Set([...(old?.requestIds||[]),...(row.requestIds||[])])];if(requestIds.length>1000)conflict();rows.set(row.id,requestIds.length?{...next,requestIds}:next);}
  const identities=new Set();for(const row of rows.values())for(const id of [row.id,...row.requestIds||[]]){if(identities.has(id))conflict();identities.add(id);}
  return [...rows.values()];
}

export const findHighlight=(rows,id)=>rows.find(row=>row.id===id||row.requestIds?.includes(id));
export function saveHighlight(rows,input,book){
  const row=normalizeHighlight(input,book,{matchCurrent:false}),old=findHighlight(rows,row.id);
  if(old){if(highlightKey(old)!==highlightKey(row))conflict();return old;}
  normalizeHighlight(input,book);
  const duplicate=rows.find(item=>!item.deletedAt&&highlightKey(item)===highlightKey(row));
  if(duplicate){if((duplicate.requestIds?.length||0)>=1000)throw Object.assign(Error('这条高亮的提交较多，请重新打开书页。'),{status:413});duplicate.requestIds=[...(duplicate.requestIds||[]),row.id];return duplicate;}
  if(rows.length>=10000)throw Object.assign(Error('高亮较多，请先导出整理。'),{status:413});
  const saved={...row,createdAt:new Date().toISOString()};rows.push(saved);return saved;
}

// Split at all boundaries so overlapping marks remain independently removable.
export function highlightSegments(text,rows){
  const valid=rows.filter(({part})=>part.start>=0&&part.end<=text.length&&text.slice(part.start,part.end)===part.text),points=[...new Set([0,text.length,...valid.flatMap(({part})=>[part.start,part.end])])].sort((a,b)=>a-b);
  return points.slice(0,-1).map((start,i)=>({text:text.slice(start,points[i+1]),ids:valid.filter(({part})=>part.start<=start&&part.end>=points[i+1]).map(({id})=>id)}));
}
