// GET-195 foundation: pure private annotation archive holding AI explanation threads and
// user follow-up words. Positional arguments, new return values, never mutates caller input.
// No network, no model calls, no storage side effects. Error status vocabulary:
// 400 malformed record, 404 unknown thread, 409 conflicting or stale source, 413 capacity.
import {validateCurrentReadingChatQuote,validateHistoricalReadingChatQuote} from './reading-chat-quote.mjs';

const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const conflict=message=>fail(message,409);
const capacity=message=>fail(message,413);
const malformed=()=>fail('Annotation record is malformed.');
const recordId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&value.isWellFormed();
// Dates must be ISO 8601 date or date-time grammar first (optional seconds, fraction and
// offset), then valid calendar/clock ranges and real parseability. This keeps rollover
// inputs like 2026-02-30 and runtime-extended strings like '10/20/2026' out.
const ISO=/^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/;
const date=value=>{
 if(typeof value!=='string'||value.length>64)return false;
 const match=ISO.exec(value);
 if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1])return false;
 if(match[4]!==undefined&&(Number(match[4])>23||Number(match[5])>59||(match[6]!==undefined&&Number(match[6])>59)))return false;
 return Number.isFinite(Date.parse(value));
};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
// Descriptor reads only: forged accessor properties must fail without invoking their getters.
const data=(value,key)=>{const descriptor=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key):undefined;return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;};
function shape(value,keys){
 if(!plain(value))malformed();
 const names=Reflect.ownKeys(value);
 if(names.length!==keys.length)malformed();
 for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(typeof name==='symbol'||!keys.includes(name)||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))malformed();}
}
// Field length limits are rejected before any index enumeration, helper allocation or
// element iteration, and key checks stay linear: no length-proportional arrays, no scans.
function list(value,max,overflow){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)malformed();
 if(value.length>max)overflow();
 const names=Reflect.ownKeys(value);
 if(names.length!==value.length+1)malformed();
 let indexed=0;
 for(const name of names){
  if(name==='length')continue;
  const descriptor=Object.getOwnPropertyDescriptor(value,name);
  if(typeof name!=='string'||!/^(0|[1-9][0-9]*)$/.test(name)||Number(name)>=value.length||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))malformed();
  indexed++;
 }
 if(indexed!==value.length)malformed();
}
const equal=(a,b)=>{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Reflect.ownKeys(a);
 return left.length===Reflect.ownKeys(b).length&&left.every(key=>Object.hasOwn(b,key)&&equal(data(a,key),data(b,key)));
};
// Capacity bounds are archive level: 1MiB JSON including tombstones. Per-field length and
// count limits are malformed input (400); overflow here is never silently trimmed (413).
const bound=archive=>{if(new TextEncoder().encode(JSON.stringify(archive)).length>1048576)capacity('Annotation archive is too large.');return archive;};
const byTime=(a,b)=>(Date.parse(a.createdAt)-Date.parse(b.createdAt))||(a.id<b.id?-1:a.id>b.id?1:0);

function sourceRef(value,book){
 shape(value,['passageId','layer','quote']);
 if(!recordId(value.passageId)||!['original','literal','interpretive'].includes(value.layer)||!text(value.quote,2000))malformed();
 const passage=Array.isArray(book?.sections)?book.sections.flatMap(section=>section.paragraphs).find(row=>row.id===value.passageId):undefined;
 const source=value.layer==='original'?passage?.original:passage?.translations?.[value.layer]?.text;
 if(typeof source!=='string'||!source.includes(value.quote))conflict('Annotation source reference cannot be proven against the supplied book.');
 return {passageId:value.passageId,layer:value.layer,quote:value.quote};
}

function message(value,book){
 const optional=[...(data(value,'provenance')!==undefined?['provenance']:[]),...(data(value,'sourceRefs')!==undefined?['sourceRefs']:[])];
 shape(value,['id','origin','body','createdAt',...optional]);
 if(!recordId(value.id)||!['ai','user'].includes(value.origin)||!text(value.body,12000)||!date(value.createdAt))malformed();
 const provenance=data(value,'provenance');
 if(value.origin==='ai'){
  if(provenance===undefined)fail('AI annotation message requires provenance.');
  shape(provenance,['source','label']);
  if(!['site-agent','external-agent'].includes(provenance.source)||!text(provenance.label,200))malformed();
 }else if(provenance!==undefined)fail('User annotation message cannot carry provenance.');
 let sourceRefs;
 if(data(value,'sourceRefs')!==undefined){const refs=data(value,'sourceRefs');list(refs,20,()=>malformed());sourceRefs=refs.map(ref=>sourceRef(ref,book));}
 return {id:value.id,origin:value.origin,body:value.body,createdAt:value.createdAt,...(provenance!==undefined?{provenance:{source:provenance.source,label:provenance.label}}:{}),...(sourceRefs!==undefined?{sourceRefs}:{})};
}

function thread(value,book,historical){
 const optional=[...(data(value,'highlightId')!==undefined?['highlightId']:[]),...(data(value,'deletedAt')!==undefined?['deletedAt']:[])];
 shape(value,['id','quote','createdAt','updatedAt','messages',...optional]);
 if(!recordId(value.id)||!date(value.createdAt)||!date(value.updatedAt)||(data(value,'deletedAt')!==undefined&&!date(value.deletedAt))||(data(value,'highlightId')!==undefined&&!recordId(value.highlightId)))malformed();
 // Stored quotes stay typed snapshots: current validation for live data, historical only on request.
 const quote=historical?validateHistoricalReadingChatQuote(value.quote,book):validateCurrentReadingChatQuote(value.quote,book);
 list(value.messages,20,()=>capacity('Annotation thread holds too many messages.'));
 const messages=value.messages.map(row=>message(row,book)),seen=new Set();
 for(const row of messages){if(seen.has(row.id))fail('Annotation message IDs must be unique.');seen.add(row.id);}
 return {id:value.id,quote,createdAt:value.createdAt,updatedAt:value.updatedAt,messages,...(data(value,'highlightId')!==undefined?{highlightId:value.highlightId}:{}),...(data(value,'deletedAt')!==undefined?{deletedAt:value.deletedAt}:{})};
}

function normalizeArchive(value,book,historical){
 shape(value,['kind','schemaVersion','bookId','revision','threads']);
 if(value.kind!=='leafhour-reader-annotations'||value.schemaVersion!==1||!recordId(value.bookId)||!Number.isSafeInteger(value.revision)||value.revision<0)malformed();
 if(!book||book.bookId!==value.bookId||!Array.isArray(book.sections))conflict('Annotation archive belongs to another book.');
 list(value.threads,100,()=>capacity('Annotation archive holds too many threads.'));
 const threads=value.threads.map(row=>thread(row,book,historical)),seen=new Set();
 for(const row of threads){if(seen.has(row.id))fail('Annotation thread IDs must be unique.');seen.add(row.id);}
 return bound({kind:'leafhour-reader-annotations',schemaVersion:1,bookId:value.bookId,revision:value.revision,threads});
}

// Checked increment: an exhausted safe revision refuses real writes instead of emitting
// a value this module would later reject. No-op retries return before calling bump.
const bump=revision=>{if(revision>=Number.MAX_SAFE_INTEGER)capacity('Annotation archive revision is exhausted.');return revision+1;};
const timestamp=options=>{
 const opts=options===undefined?{}:options;
 shape(opts,data(opts,'now')!==undefined?['now']:[]);
 if(data(opts,'now')===undefined)return undefined;
 if(!date(opts.now))fail('Annotation timestamp is invalid.');
 return opts.now;
};
// Historical relaxation is opt-in via an exact plain {historical:boolean} own record;
// accessors, forged prototypes and unknown fields are rejected without invocation.
const historyMode=options=>{
 const opts=options===undefined?{}:options;
 shape(opts,data(opts,'historical')!==undefined?['historical']:[]);
 if(data(opts,'historical')!==undefined&&typeof opts.historical!=='boolean')malformed();
 return opts.historical===true;
};

export function createAnnotationArchive(bookId){
 if(!recordId(bookId))malformed();
 return {kind:'leafhour-reader-annotations',schemaVersion:1,bookId,revision:0,threads:[]};
}

// Returns a fully normalized detached clone; revision, dates and text are preserved as given.
export function validateAnnotationArchive(value,book,options={}){
 return normalizeArchive(value,book,historyMode(options));
}

export function createAnnotationThread(archive,book,input,options={}){
 const state=normalizeArchive(archive,book,true);
 const optional=data(input,'highlightId')!==undefined?['highlightId']:[];
 shape(input,['id','quote',...optional]);
 if(!recordId(input.id)||(optional.length&&!recordId(input.highlightId)))malformed();
 const now=timestamp(options);
 const quote=validateCurrentReadingChatQuote(input.quote,book);
 const existing=state.threads.find(row=>row.id===input.id);
 if(existing){
  // Exact retry stays unchanged; a deleted thread id is never resurrected.
  if(!equal(existing.quote,quote)||existing.highlightId!==input.highlightId)conflict('Annotation thread ID is already used.');
  return state;
 }
 if(state.threads.length>=100)capacity('Annotation archive holds too many threads.');
 const stamp=now??new Date().toISOString();
 return bound({...state,revision:bump(state.revision),threads:[...state.threads,{id:input.id,quote,createdAt:stamp,updatedAt:stamp,messages:[],...(optional.length?{highlightId:input.highlightId}:{})}]});
}

export function appendAnnotationMessage(archive,book,threadId,input){
 const state=normalizeArchive(archive,book,true);
 if(!recordId(threadId))malformed();
 const row=state.threads.find(candidate=>candidate.id===threadId);
 if(!row)fail('Annotation thread is unknown.',404);
 if(row.deletedAt!==undefined)conflict('Annotation thread is deleted.');
 validateCurrentReadingChatQuote(row.quote,book);
 const entry=message(input,book);
 const existing=row.messages.find(other=>other.id===entry.id);
 if(existing){
  if(!equal(existing,entry))conflict('Annotation message ID is already used.');
  return state;
 }
 if(row.messages.length>=20)capacity('Annotation thread holds too many messages.');
 return bound({...state,revision:bump(state.revision),threads:state.threads.map(candidate=>candidate.id===threadId?{...candidate,updatedAt:entry.createdAt,messages:[...candidate.messages,entry]}:candidate)});
}

export function removeAnnotationThread(archive,book,threadId,options={}){
 const state=normalizeArchive(archive,book,true);
 if(!recordId(threadId))malformed();
 const now=timestamp(options);
 const row=state.threads.find(candidate=>candidate.id===threadId);
 if(!row)fail('Annotation thread is unknown.',404);
 if(row.deletedAt!==undefined)return state;
 return bound({...state,revision:bump(state.revision),threads:state.threads.map(candidate=>candidate.id===threadId?{...candidate,deletedAt:now??new Date().toISOString()}:candidate)});
}

// Private restore path: historical anchors, tombstones dominate, words are never discarded.
export function mergeAnnotationArchives(current,incoming,book){
 const a=normalizeArchive(current,book,true),b=normalizeArchive(incoming,book,true);
 const threads=a.threads.map(row=>({...row,messages:[...row.messages]}));
 for(const row of b.threads){
  const index=threads.findIndex(candidate=>candidate.id===row.id);
  if(index<0){threads.push({...row,messages:[...row.messages]});continue;}
  const merged=threads[index];
  if(!equal(merged.quote,row.quote)||merged.highlightId!==row.highlightId)conflict('Annotation thread conflicts with the imported archive.');
  const messages=[...merged.messages];
  for(const entry of row.messages){
   const at=messages.findIndex(other=>other.id===entry.id);
   if(at<0)messages.push(entry);
   else if(!equal(messages[at],entry))conflict('Annotation message conflicts with the imported archive.');
  }
  if(messages.length>20)capacity('Annotation thread holds too many messages.');
  const deletedAt=merged.deletedAt??row.deletedAt;
  threads[index]={...merged,updatedAt:Date.parse(row.updatedAt)>Date.parse(merged.updatedAt)?row.updatedAt:merged.updatedAt,messages,...(deletedAt!==undefined?{deletedAt}:{})};
 }
 if(threads.length>100)capacity('Annotation archive holds too many threads.');
 const result=threads.map(row=>({...row,messages:[...row.messages].sort(byTime)}));
 const before=new Map(a.threads.map(row=>[row.id,row]));
 // Observable value changes — including message reordering — count as one actual change.
 const changed=result.some(row=>{const old=before.get(row.id);return !old||!equal(old,row);});
 const revision=changed?bump(Math.max(a.revision,b.revision)):Math.max(a.revision,b.revision);
 return bound({kind:'leafhour-reader-annotations',schemaVersion:1,bookId:a.bookId,revision,threads:result});
}
