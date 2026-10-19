// Selected text is attributed user data, never a verified AI citation or grant.
const fail=(status=400)=>{throw Object.assign(Error('Selected text is invalid or has changed.'),{status});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&value.isWellFormed();
const boundary=(value,n)=>n===0||n===value.length||!(value.charCodeAt(n-1)>=0xd800&&value.charCodeAt(n-1)<=0xdbff&&value.charCodeAt(n)>=0xdc00&&value.charCodeAt(n)<=0xdfff);
function record(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const names=Reflect.ownKeys(value);if(names.length!==keys.length||names.some(key=>!keys.includes(key)||!Object.getOwnPropertyDescriptor(value,key)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))fail();
}
export function normalizeReadingChatQuote(value){
 record(value,['kind','schemaVersion','bookId','contentVersion','chapterId','parts']);
 if(value.kind!=='leafhour-reading-quote'||value.schemaVersion!==1||!id(value.bookId)||!id(value.chapterId)||!text(value.contentVersion,256)||!Array.isArray(value.parts)||Object.getPrototypeOf(value.parts)!==Array.prototype||value.parts.length<1||value.parts.length>8)fail();
 const keys=Reflect.ownKeys(value.parts),expected=Array.from({length:value.parts.length},(_,i)=>String(i));if(keys.length!==expected.length+1||expected.some(key=>!Object.hasOwn(value.parts,key))||keys.some(key=>key!=='length'&&(!expected.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value.parts,key),'value'))))fail();
 let total=0,layer;const seen=new Set();
 const parts=value.parts.map(part=>{
  const descriptor=part&&Object.getOwnPropertyDescriptor(part,'layer');if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();const original=descriptor.value==='original';
  record(part,['passageId','layer','start','end','text',...(original?[]:['translationStatus'])]);
  if(!id(part.passageId)||seen.has(part.passageId)||!['original','literal','interpretive'].includes(part.layer)||layer&&layer!==part.layer||!text(part.text,2000)||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||part.start<0||part.end<=part.start||part.end>1000000||part.end-part.start!==part.text.length||!original&&!['draft','reviewed'].includes(part.translationStatus))fail();
  total+=part.text.length;if(total>2000)fail();layer=part.layer;seen.add(part.passageId);
  return {passageId:part.passageId,layer:part.layer,start:part.start,end:part.end,text:part.text,...(original?{}:{translationStatus:part.translationStatus})};
 });
 return {kind:'leafhour-reading-quote',schemaVersion:1,bookId:value.bookId,contentVersion:value.contentVersion,chapterId:value.chapterId,parts};
}
function validate(value,book,current){
 const quote=normalizeReadingChatQuote(value);
 if(!book||quote.bookId!==book.bookId||quote.contentVersion!==book.contentVersion||!Array.isArray(book.sections))fail(409);
 const rows=book.sections.flatMap(section=>section.paragraphs.map(paragraph=>({paragraph,chapterId:section.chapterId})));let previous=-1;
 for(const part of quote.parts){
  const position=rows.findIndex(row=>row.paragraph.id===part.passageId),row=rows[position];
  if(!row||position<=previous||row.chapterId!==quote.chapterId)fail(409);previous=position;
  if(!current)continue;
  const translation=row.paragraph.translations?.[part.layer],source=part.layer==='original'?row.paragraph.original:translation?.text;
  if(typeof source!=='string'||!source.isWellFormed()||part.end>source.length||!boundary(source,part.start)||!boundary(source,part.end)||source.slice(part.start,part.end)!==part.text||part.layer!=='original'&&translation?.status!==part.translationStatus)fail(409);
 }
 return quote;
}
export const validateCurrentReadingChatQuote=(value,book)=>validate(value,book,true);
export const validateHistoricalReadingChatQuote=(value,book)=>validate(value,book,false);
export function readingChatQuoteFromExcerpt(snapshot,book){
 if(!snapshot||!Array.isArray(snapshot.parts)||snapshot.parts.length<1||snapshot.parts.length>8)fail();
 const parts=snapshot.parts.map(part=>{
  if(!['en','zh'].includes(part.language)||part.language==='zh'&&!['literal','interpretive'].includes(part.variant))fail();
  const layer=part.language==='en'?'original':part.variant,paragraph=book?.sections?.flatMap(section=>section.paragraphs).find(p=>p.id===part.passageId);
  return {passageId:part.passageId,layer,start:part.start,end:part.end,text:part.text,...(layer==='original'?{}:{translationStatus:paragraph?.translations?.[layer]?.status})};
 });
 return validateCurrentReadingChatQuote({kind:'leafhour-reading-quote',schemaVersion:1,bookId:snapshot.bookId,contentVersion:snapshot.contentVersion,chapterId:snapshot.chapterId,parts},book);
}

// The reader supplies a synchronous DOM observation; no hidden text is fetched.
export function readingChatExcerptIsVisible(snapshot,readPart){
 return !!snapshot&&Array.isArray(snapshot.parts)&&snapshot.parts.length>0&&snapshot.parts.length<=8&&snapshot.parts.every(part=>{const view=readPart(part);return view?.visible===true&&typeof view.text==='string'&&view.text.slice(part.start,part.end)===part.text;});
}
