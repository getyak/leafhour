import {validateHistoricalReadingChatQuote} from './reading-chat-quote.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const text=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n&&v.isWellFormed();
const date=v=>typeof v==='string'&&v.length<=64&&Number.isFinite(Date.parse(v));
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
function recommendations(value,sources){
 return value.map(row=>{
  if(!plain(row)||!text(row.title,500)||typeof row.owned!=='boolean'||!['library','catalog','openlibrary'].includes(row.source)||row.author!==undefined&&(typeof row.author!=='string'||row.author.length>500||!row.author.isWellFormed()))fail('备份推荐书目格式不正确');
  const out={title:row.title,author:row.author||'',owned:row.owned,source:row.source,url:row.url};
  if(row.source==='openlibrary'){
   if(row.owned||typeof row.url!=='string'||!/^https:\/\/openlibrary\.org\/works\/OL\d+W$/.test(row.url))fail('备份推荐书目来源链接不正确');
  }else{
   const book=sources.get(row.bookId);if(!book||row.url!=='/read?book='+encodeURIComponent(row.bookId)||row.owned!==(book.visibility==='private')||row.source!==(row.owned?'library':'catalog'))fail('备份推荐书目无法对应书房来源');
   out.bookId=row.bookId;out.visibility=book.visibility;
  }
  return out;
 });
}
function personCitations(value){
 if(!Array.isArray(value)||new TextEncoder().encode(JSON.stringify(value)).length>96000)fail('人物引用超过备份范围');
 return value.map(ref=>{if(!plain(ref)||Object.keys(ref).some(k=>!['personId','revision','sourceId','title','url','quote','digest'].includes(k))||!id(ref.personId)||!id(ref.sourceId)||!Number.isSafeInteger(ref.revision)||ref.revision<1||!text(ref.title,2000)||typeof ref.url!=='string'||ref.url.length>2048||ref.quote!==undefined&&!text(ref.quote,6000)||ref.digest!==undefined&&!/^[a-f0-9]{64}$/.test(ref.digest))fail('人物引用格式不正确');let url;try{url=new URL(ref.url);}catch{fail('人物引用链接不正确');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)fail('人物引用链接不正确');return {...ref};});
}
// Only trusted stored history uses this adapter. Incoming archives stay strict.
export function exportChatTurn(turn,book){
 const a=turn?.answer;
 if(turn?.status!=='completed'||turn.kind==='companion'||!plain(a)||Object.keys(a).length!==3||!['origin','summary','sourceRefs'].every(k=>Object.hasOwn(a,k))||a.origin!=='ai'||!text(a.summary,12000)||!Array.isArray(a.sourceRefs)||a.sourceRefs.length>100||a.sourceRefs.some(r=>!plain(r)||Object.keys(r).length!==2||!['passageId','quote'].every(k=>Object.hasOwn(r,k))))return turn;
 if(turn.contentVersion!==book.contentVersion)fail('历史回答版本无法对应当前原文');
 const sourceRefs=a.sourceRefs.map(r=>{
  const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===r.passageId)),p=section?.paragraphs.find(p=>p.id===r.passageId);
  if(!p||!text(r.quote,12000)||!p.original.includes(r.quote))fail('历史回答引用无法对应来源原文');
  return {bookId:book.bookId,contentVersion:book.contentVersion,chapterId:section.chapterId,passageId:r.passageId,layer:'original',quote:r.quote,url:'/read?book='+encodeURIComponent(book.bookId)+'&passage='+encodeURIComponent(r.passageId)};
 });
 return {...turn,answer:{kind:'conversation',origin:'ai',summary:a.summary,sourceRefs,recommendations:[]}};
}
export function valueEqual(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every(k=>Object.hasOwn(b,k)&&valueEqual(a[k],b[k]));}
export function portableChatTurns(chat,book,books=[book]){
 if(!plain(chat)||chat.kind!=='marginalia-reader-chat'||chat.schemaVersion!==1||chat.bookId!==book.bookId||!Array.isArray(chat.turns)||chat.turns.length>100)fail('备份对话格式不正确');
 const sources=new Map(books.map(b=>[b.bookId,b])),ids=new Set(),passages=new Set(book.sections.flatMap(s=>s.paragraphs.map(p=>p.id)));
 return chat.turns.map(t=>{
  const companion=t?.kind==='companion';
  if(!plain(t)||!id(t.id)||ids.has(t.id)||!passages.has(t.passageId)||t.contentVersion!==book.contentVersion||!date(t.createdAt)||t.origin!==(companion?'ai':'user')||!companion&&!text(t.text,2000)||companion&&t.text!==null||!['running','completed','failed','cancelled'].includes(t.status))fail('备份对话的归属、版本或锚点不正确');
  const quote=t.quote===undefined?undefined:validateHistoricalReadingChatQuote(t.quote,book);if(quote&&(companion||quote.parts[0].passageId!==t.passageId))fail('备份摘录的提问归属不正确');
  if(t.scopeRevision!==undefined&&(!Number.isSafeInteger(t.scopeRevision)||t.scopeRevision<0))fail('备份对话范围版本不正确');ids.add(t.id);let answer=null;
  if(t.status==='completed'){
   const a=t.answer;if(!plain(a)||a.kind!==(companion?'companion':'conversation')||a.origin!=='ai'||!text(a.summary,12000)||!Array.isArray(a.sourceRefs)||a.sourceRefs.length>100||!Array.isArray(a.recommendations)||a.recommendations.length>20)fail('备份 AI 回答不完整');
   const refs=a.sourceRefs.map(r=>{
    const source=sources.get(r?.bookId),section=source?.sections.find(s=>s.paragraphs.some(p=>p.id===r.passageId)),p=section?.paragraphs.find(p=>p.id===r.passageId),layer=r?.layer;
    if(!source||source.contentVersion!==(r.contentVersion??(companion?t.contentVersion:null))||!section||section.chapterId!==(r.chapterId??(companion?section?.chapterId:null))||!['original','literal','interpretive'].includes(layer)||!text(r.quote,12000)||!(layer==='original'?p.original:p.translations?.[layer]?.text||'').includes(r.quote))fail('备份对话引用无法对应来源原文');
    return {bookId:r.bookId,chapterId:section.chapterId,...(r.chapterTitle!==undefined?{chapterTitle:structuredClone(r.chapterTitle)}:{}),contentVersion:source.contentVersion,passageId:r.passageId,quote:r.quote,layer,url:'/read?book='+encodeURIComponent(r.bookId)+'&passage='+encodeURIComponent(r.passageId),...(layer!=='original'?{translationStatus:p.translations[layer].status}:{})};
   });
   if(new TextEncoder().encode(JSON.stringify(a)).length>96000)fail('备份 AI 回答超过容量限制');answer={kind:a.kind,summary:a.summary,origin:'ai',sourceRefs:refs,recommendations:recommendations(a.recommendations,sources),...(a.personSources!==undefined?{personSources:personCitations(a.personSources)}:{})};
  }else if(t.answer!==null&&t.answer!==undefined)fail('未完成对话不能携带回答');
  return {id:t.id,passageId:t.passageId,contentVersion:t.contentVersion,...(t.scopeRevision!==undefined?{scopeRevision:t.scopeRevision}:{}),text:companion?null:t.text,...(quote?{quote}:{}),origin:companion?'ai':'user',...(companion?{kind:'companion'}:{}),createdAt:t.createdAt,status:t.status==='running'?'failed':t.status,answer,activity:[],...(t.status==='running'?{error:'导入前的回答已中断，未恢复生成。'}:t.error?{error:String(t.error).slice(0,2000)}:{})};
 });
}
