import {valueEqual} from './portable-chat.mjs';
import {validatePersonalRecordMetadata} from './personal-records.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const fields=new Set(['id','bookId','contentVersion','passageId','text','origin','createdAt','updatedAt','revision','lastEditId','status','quote','quoteLanguage','quoteOrigin']);
const originalDerivatives=new Set(['PaddleOCR-VL-1.6','pdfjs-native','native+paddle-auto-v1','epub-spine-v1','source-review-v1']);
// Derivative content has its own version while retaining the original SHA.
// This association policy is shared by original downloads and ZIP preflight;
// it never replaces original-byte hashing, private ownership or conflict checks.
export function hasOriginalSourceVersion(book){
 const hash=book?.source?.sha256;
 return typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&(hash===book.contentVersion||originalDerivatives.has(book.source.processor));
}
export function portableSourceNote(record){return Object.fromEntries(Object.entries(record).filter(([key])=>fields.has(key)));}

// Pending records are private record-domain objects, never book/Agent content.
// Their quoted old source is self-contained so a single-book backup is useful.
export function validatePendingAnchors(records,book){
 const receipt=records.sourceRevisionMigration,revision=book.source?.revision;
 if(receipt!==undefined&&(!object(receipt)||Object.keys(receipt).some(k=>!['parentBookId','parentContentVersion','contentVersion','completedAt'].includes(k))||!id(receipt.parentBookId)||!text(receipt.parentContentVersion,256)||receipt.contentVersion!==book.contentVersion||!date(receipt.completedAt)||revision?.parentBookId!==receipt.parentBookId||revision?.parentContentVersion!==receipt.parentContentVersion))throw fail('校对迁移回执无法对应当前修订与原书');
 if(records.pendingAnchors===undefined)return;
 const rows=records.pendingAnchors,passages=new Set(book.sections.flatMap(s=>s.paragraphs.map(p=>p.id))),seen=new Set();
 if(!Array.isArray(rows)||rows.length>10000)throw fail('待确认锚点超过容量或格式不完整');
 for(const row of rows){
  const n=row?.record,s=row?.source;
  if(!object(row)||!id(row.id)||seen.has(row.id)||!['comments','questions'].includes(row.type)||!['pending','resolved'].includes(row.state)||!object(s)||!id(s.bookId)||!text(s.contentVersion,256)||!id(s.passageId)||!text(s.original,100000)||!object(n)||Object.keys(n).some(k=>!fields.has(k))||!text(n.id,128)||!text(n.text)||n.origin!=='user'||!date(n.createdAt)||n.bookId!==s.bookId||n.contentVersion!==s.contentVersion||n.passageId!==s.passageId||n.quote!==undefined&&(typeof n.quote!=='string'||n.quote.length>4000))throw fail('待确认记录的原话或旧版来源不完整');
  validatePersonalRecordMetadata(n);seen.add(row.id);
  if(row.state==='resolved'){
   const target=records[row.type]?.find(note=>note.id===row.recordId);
   if(!id(row.passageId)||!passages.has(row.passageId)||!text(row.recordId,128)||!date(row.resolvedAt)||!target||target.passageId!==row.passageId)throw fail('已确认锚点无法对应私人记录');
  }else if(row.passageId!==undefined||row.recordId!==undefined||row.resolvedAt!==undefined)throw fail('待确认锚点不能伪装为已定位');
 }
}
export function mergePendingAnchors(current=[],incoming=[]){
 const rows=new Map(current.map(row=>[row.id,structuredClone(row)]));
 for(const row of incoming){const old=rows.get(row.id);if(!old){rows.set(row.id,structuredClone(row));continue;}
  if(old.type!==row.type||!valueEqual(old.source,row.source)||!valueEqual(old.record,row.record))throw fail('待确认记录标识与原话冲突，未覆盖记录',409);
  if(old.state==='resolved'&&row.state==='resolved'&&(old.passageId!==row.passageId||old.recordId!==row.recordId))throw fail('锚点已在另一处确认，请先读取较新结果',409);
  if(old.state==='pending'&&row.state==='resolved')rows.set(row.id,structuredClone(row));
 }return [...rows.values()];
}
