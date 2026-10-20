// GET-195: the annotation job wraps the existing reading-agent tool object
// verbatim and adds exactly one read-only tool, reader_get_annotations. The
// source tool definitions, execute path, verification and citation registry
// keep their current semantics: annotation bodies are stored AI data, never a
// verified source citation. New body pagination is UTF-16 (body.slice units),
// rejecting surrogate-splitting offsets and never silently dropping a tail.
import {createHash} from 'node:crypto';
const TARGET=18432,HARD=24576;
const hash=value=>createHash('sha256').update(value).digest('hex');
const str=(max=128)=>({type:'string',minLength:1,maxLength:max});
const integer=(max,min=0)=>({type:'integer',minimum:min,maximum:max});
const failure=(code='UNAVAILABLE',message='无法读取这项资料')=>({error:{code,message}});
const reject=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const recordId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export const READER_GET_ANNOTATIONS='reader_get_annotations';
const ANNOTATION_TOOL={
 name:READER_GET_ANNOTATIONS,
 description:'分页读取本书已有的 AI 注解消息。只返回 AI 内容，不含用户原话、私人笔记或其他对话。body 为自由 Markdown；charOffset 为 UTF-16 偏移。续读使用上次返回的 nextCursor 全部参数与 snapshot，snapshot 表示读取时的确切视图。',
 parameters:{type:'object',properties:{threadId:str(),messageId:str(),charOffset:integer(12000),limit:{type:'integer',minimum:1,maximum:20},snapshot:str(128)},required:[],additionalProperties:false}
};
const READ_KEYS=['bookId','threadId','messageId','charOffset','limit','snapshot'];
// One shared strict parser for the bounded annotation read: the in-job tool and
// the external HTTP query accept exactly these pagination identities, reject
// unknown or duplicate parameters and never repair a malformed cursor.
export function validateAnnotationReadArgs(args,{withBookId=false}={}){
 if(!args||typeof args!=='object'||Array.isArray(args))reject('注解读取参数无效');
 const allowed=withBookId?READ_KEYS:READ_KEYS.filter(key=>key!=='bookId');
 if(!Object.keys(args).every(key=>allowed.includes(key)))reject('注解读取参数无效');
 if(withBookId&&!recordId(args.bookId))reject('注解读取参数无效');
 const {threadId,messageId,charOffset,limit,snapshot}=args;
 if(threadId!==undefined&&(typeof threadId!=='string'||!threadId))reject('注解读取参数无效');
 if(messageId!==undefined&&(typeof messageId!=='string'||!messageId))reject('注解读取参数无效');
 if(charOffset!==undefined&&(!Number.isSafeInteger(charOffset)||charOffset<0||charOffset>12000))reject('注解读取参数无效');
 if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>20))reject('注解读取参数无效');
 if(snapshot!==undefined&&(typeof snapshot!=='string'||!snapshot||snapshot.length>128))reject('注解读取参数无效');
 if(charOffset!==undefined&&charOffset>0&&(!threadId||!messageId||!snapshot))reject('续读游标不完整');
 if(messageId!==undefined&&!threadId)reject('续读游标不完整');
 return args;
}
// HTTP query parser: values arrive as strings, duplicates and unknown names are
// rejected before any read, and numeric cursors never accept NaN or fractions.
export function annotationReadArgs(params){
 const args={};
 for(const [key,value]of params){
  if(!READ_KEYS.includes(key))reject('注解读取参数无效');
  if(Object.hasOwn(args,key))reject('注解读取参数重复');
  args[key]=['charOffset','limit'].includes(key)?(/^\d+$/.test(value)?Number(value):NaN):value;
 }
 return validateAnnotationReadArgs(args,{withBookId:true});
}
function validArgs(args){
 try{validateAnnotationReadArgs(args);return true;}catch{return false;}
}
const clip400=value=>[...String(value)].slice(0,400).join('');
// Read-only projection of the stored archive: AI messages only. User words,
// private notes and other chats are structurally absent from this view.
function rowsFor(archive,bookId,contentVersion){
 const rows=[];
 for(const thread of archive?.threads||[]){
  if(thread.deletedAt!==undefined)continue;
  const part=thread.quote?.parts?.[0];
  for(const message of thread.messages||[]){
   if(message.origin!=='ai'||!message.provenance)continue;
   rows.push({threadId:thread.id,messageId:message.id,provenance:'ai',attribution:{source:message.provenance.source,label:message.provenance.label},anchor:{passageId:part?.passageId||null,layer:part?.layer||null,excerpt:clip400(part?.text||''),context:'stored selected-text context, not a source citation'},body:message.body});
  }
 }
 return {rows,snapshot:hash(JSON.stringify([bookId,contentVersion,rows.map(row=>[row.threadId,row.messageId,row.anchor,row.body])]))};
}
const boundary=(value,n)=>n===0||n===value.length||!(value.charCodeAt(n-1)>=0xd800&&value.charCodeAt(n-1)<=0xdbff&&value.charCodeAt(n)>=0xdc00&&value.charCodeAt(n)<=0xdfff);
export async function readAnnotationPage(args,readView){
 let view;try{view=await readView();}catch{return failure('UNAVAILABLE','无法读取注解内容');}
 if(!view||!view.archive)return failure('UNAVAILABLE','这本书还没有注解内容');
 const {rows,snapshot}=rowsFor(view.archive,view.bookId,view.contentVersion);
 if(args.snapshot!==undefined&&args.snapshot!==snapshot)return failure('SNAPSHOT_CHANGED','注解已更新，请从头重新读取');
 const limit=args.limit||1;
 let start=0,offset=0;
 if(args.threadId!==undefined){
  start=rows.findIndex(row=>row.threadId===args.threadId);
  if(start<0)return failure('INVALID_ARGUMENTS','找不到这条注解线程');
  if(args.messageId!==undefined){
   while(start<rows.length&&!(rows[start].threadId===args.threadId&&rows[start].messageId===args.messageId))start++;
   if(start>=rows.length)return failure('INVALID_ARGUMENTS','找不到这条注解消息');
   offset=args.charOffset||0;
   const body=rows[start].body;
   if(offset>body.length||!boundary(body,offset))return failure('INVALID_ARGUMENTS','注解续读位置无效');
   if(offset===body.length){start++;offset=0;}
  }
 }
 const result={bookId:view.bookId,contentVersion:view.contentVersion,snapshot,items:[],nextCursor:null};
 let index=start;
 for(;index<rows.length&&result.items.length<limit;index++){
  const row=rows[index],startOffset=index===start?offset:0;
  const item={threadId:row.threadId,messageId:row.messageId,provenance:row.provenance,attribution:row.attribution,anchor:row.anchor,body:''};
  // Byte budget measured on the real serialization including a worst-case
  // continuation cursor; the body slice never cuts a surrogate pair and any
  // remainder stays reachable through nextCursor.
  const sizeWith=body=>Buffer.byteLength(JSON.stringify({...result,items:[...result.items,{...item,body}],nextCursor:{threadId:row.threadId,messageId:row.messageId,charOffset:endPlaceholder(),limit,snapshot}}));
  let endPlaceholder=()=>0;
  const stepTo=from=>{let stop=Math.min(row.body.length,from+512);while(stop<row.body.length&&!boundary(row.body,stop))stop++;return stop;};
  let end=startOffset;
  endPlaceholder=()=>end;
  while(end<row.body.length){
   const next=stepTo(end),candidate=row.body.slice(startOffset,next);
   if(sizeWith(candidate)>TARGET){
    let lo=end,hi=next;
    while(hi-lo>1){
     let mid=Math.floor((lo+hi)/2);while(mid>lo&&!boundary(row.body,mid))mid--;
     if(mid<=lo)break;
     if(sizeWith(row.body.slice(startOffset,mid))>TARGET)hi=mid;else lo=mid;
    }
    end=lo;break;
   }
   end=next;
  }
  if(end<=startOffset&&row.body.length>startOffset){end=Math.min(row.body.length,startOffset+1);while(end<row.body.length&&!boundary(row.body,end))end++;}
  item.body=row.body.slice(startOffset,end);
  result.items.push(item);
  if(end<row.body.length){result.nextCursor={threadId:row.threadId,messageId:row.messageId,charOffset:end,limit,snapshot};break;}
 }
 // Reaching the message limit must still expose the exact remaining position;
 // an exhausted walk ends with a null cursor and no hidden tail.
 if(!result.nextCursor&&index<rows.length)result.nextCursor={threadId:rows[index].threadId,messageId:rows[index].messageId,charOffset:0,limit,snapshot};
 if(Buffer.byteLength(JSON.stringify(result))>HARD)return failure('UNAVAILABLE','注解读取结果过大');
 return result;
}
export function createAnnotationReadTools({tools,readView}){
 if(!tools||!Array.isArray(tools.definitions)||typeof tools.execute!=='function'||typeof tools.verify!=='function'||typeof tools.sources!=='function'||typeof tools.recommendations!=='function'||typeof readView!=='function')throw TypeError('Annotation tools require the source tool object and a read-only annotation view');
 if(tools.definitions.some(definition=>definition?.name===READER_GET_ANNOTATIONS))throw TypeError('Source tools already define reader_get_annotations');
 return {
  definitions:[...structuredClone(tools.definitions),structuredClone(ANNOTATION_TOOL)],
  execute(name,args={},internal={}){if(name!==READER_GET_ANNOTATIONS)return tools.execute(name,args,internal);if(!validArgs(args))return Promise.resolve(failure('INVALID_ARGUMENTS','工具参数无效'));return readAnnotationPage(args,readView);},
  verify:tools.verify,
  sources:tools.sources,
  recommendations:tools.recommendations
 };
}
