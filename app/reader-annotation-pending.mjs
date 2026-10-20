import {normalizeReadingChatQuote} from './reading-chat-quote.mjs';
import {highlightKey} from './highlights.mjs';

const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const invalid=()=>{throw Error('Invalid annotation operation');};
const locales=['en','zh-Hans','zh-Hant','ja'];
export function normalizeAnnotationOperation(value){
 if(!value||!['highlight','explain'].includes(value.phase)||!value.input||!Object.keys(value).every(key=>['phase','input','highlight'].includes(key)))invalid();
 const input=value.input;
 if(!Object.keys(input).every(key=>['id','threadId','quote','highlightId','responseLocale','text'].includes(key))||!id(input.id)||!id(input.threadId)||!locales.includes(input.responseLocale))invalid();
 const quote=normalizeReadingChatQuote(input.quote);
 if(input.highlightId!==undefined&&!id(input.highlightId))invalid();
 if(input.text!==undefined&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>2000||!input.text.isWellFormed()))invalid();
 const normalized={phase:value.phase,input:{id:input.id,threadId:input.threadId,quote,responseLocale:input.responseLocale,...(input.highlightId!==undefined?{highlightId:input.highlightId}:{}),...(input.text!==undefined?{text:input.text}:{})}};
 if(value.phase==='highlight'){
  const highlight=value.highlight;
  if(!highlight||!id(highlight.id)||highlight.bookId!==quote.bookId||highlight.contentVersion!==quote.contentVersion||highlight.chapterId!==quote.chapterId||!Array.isArray(highlight.parts)||highlight.parts.length!==quote.parts.length)invalid();
  for(const [index,part]of highlight.parts.entries()){const held=quote.parts[index];if(part.passageId!==held.passageId||part.start!==held.start||part.end!==held.end||part.text!==held.text||(part.language==='en'?'original':part.variant)!==held.layer||!['en','zh'].includes(part.language)||!['literal','interpretive'].includes(part.variant))invalid();}
  normalized.highlight={id:highlight.id,bookId:highlight.bookId,contentVersion:highlight.contentVersion,chapterId:highlight.chapterId,parts:highlight.parts.map(part=>({passageId:part.passageId,language:part.language,variant:part.variant,start:part.start,end:part.end,text:part.text}))};
 }else if(value.highlight!==undefined)invalid();
 return normalized;
}

// A private, narrowly scoped outbox for ONE explicit action. An uncertain
// response never allocates another paid request or changes its submitted words.
// Corrupt bytes are retained; callers first reconcile the authoritative view.
export function createAnnotationPending({storage,owner,bookId,contentVersion}){
 if(!owner||!bookId||!contentVersion)invalid();
 const key='marginalia-annotation-pending-v1|'+JSON.stringify([owner,bookId,contentVersion]);
 let current=null,problem=false,durable=true;
 const belongs=operation=>operation.input.quote.bookId===bookId&&operation.input.quote.contentVersion===contentVersion;
 try{const raw=storage?.getItem(key);if(raw){if(raw.length>32768)invalid();current=normalizeAnnotationOperation(JSON.parse(raw));if(!belongs(current))invalid();}}catch{current=null;problem=true;durable=false;}
 function write(){try{if(current)storage.setItem(key,JSON.stringify(current));else storage.removeItem(key);durable=true;}catch{durable=false;}return durable;}
 return {
  key,current:()=>current?structuredClone(current):null,status:()=>({problem,durable}),
  remember(value){if(problem)throw Object.assign(Error('Saved annotation request could not be read'),{status:503});const next=normalizeAnnotationOperation(value);if(!belongs(next)||current&&!same(current,next))throw Object.assign(Error('An annotation request is still unconfirmed'),{status:409});current=next;problem=false;write();return structuredClone(current);},
  highlightSaved(record){if(!current||current.phase!=='highlight'||!id(record?.id)||record.deletedAt||highlightKey(record)!==highlightKey(current.highlight))invalid();current={phase:'explain',input:{...current.input,highlightId:record.id}};write();return structuredClone(current);},
  reconcile(request){if(!current||request?.id!==current.input.id||request.threadId!==current.input.threadId||!['completed','failed','cancelled'].includes(request.status))return false;current=null;problem=false;write();return true;},
  // These explicit Web explain errors precede its atomic claim. Transport
  // errors, quota errors and unconfirmed completion failures are NOT receipts.
  rejectPreflight(status){if(!current||![400,401,403,404,409,413,422].includes(status))return false;current=null;problem=false;write();return true;},
  abandonBeforeDispatch(){if(current?.phase==='explain')return false;current=null;problem=false;write();return true;}
 };
}
