// Per-book authority is resolved by the caller before entering this read-only
// projection. Stored source text and records can never supply grants or paths.
import {createHash} from 'node:crypto';
export const AGENT_DATA_BYTES=24576;
const TARGET=16384,LAYERS=['original','literal','interpretive'];
const size=v=>Buffer.byteLength(JSON.stringify(v));
const fail=(m,status=400)=>Object.assign(Error(m),{status});
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const string=(v,max)=>typeof v==='string'&&v.isWellFormed()&&v.length<=max;
const rows=b=>b.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId})));
const select=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const bounded=value=>{if(size(value)>AGENT_DATA_BYTES)throw fail('资料元数据超过读取上限，请在书房中核对来源',413);return value;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checkSnapshot(args,snapshot){if(args.snapshot!==undefined&&args.snapshot!==snapshot)throw fail('读取内容已变化，请从当前版本重新开始分页',409);}
export function validateAgentReadInput(action,args){
 const common=['bookId','contentVersion','offset','limit','snapshot'],allowed={manifest:common,context:[...common,'passageId','layer','charOffset'],chapter:[...common,'chapterId','passageId','layer','charOffset'],passage:['bookId','contentVersion','snapshot','passageId','layer','charOffset'],search:[...common,'query'],notes:common,activity:common}[action];
 if(!allowed||Object.keys(args).some(k=>!allowed.includes(k))||!id(args.bookId))throw fail('读取参数无效');
 for(const key of ['chapterId','passageId'])if(args[key]!==undefined&&!id(args[key]))throw fail('读取锚点无效');
 if(action==='chapter'&&!id(args.chapterId)||action==='passage'&&!id(args.passageId))throw fail('读取锚点无效');
 if(args.contentVersion!==undefined&&(!string(args.contentVersion,256)||!args.contentVersion))throw fail('来源版本无效');
 if(args.snapshot!==undefined&&(typeof args.snapshot!=='string'||!/^[a-f0-9]{64}$/.test(args.snapshot)))throw fail('读取快照无效');
 for(const key of ['offset','limit','charOffset'])if(args[key]!==undefined&&(!Number.isSafeInteger(args[key])||args[key]<0||args[key]>1000000))throw fail('分页范围无效');
 if(args.limit!==undefined&&(args.limit<1||args.limit>20))throw fail('分页范围无效');
 if(args.layer!==undefined&&!LAYERS.includes(args.layer)||args.charOffset!==undefined&&(!args.layer||!args.passageId||!args.contentVersion||!args.snapshot)||args.layer!==undefined&&args.charOffset===undefined)throw fail('续读游标不完整');
 if(action==='chapter'&&args.passageId!==undefined&&!args.layer||args.layer&&args.offset!==undefined)throw fail('续读游标与段落分页不能混用');
 if(action==='search'&&(!string(args.query,200)||!args.query?.trim()))throw fail('请输入检索词');
 return args;
}
export function agentReadArgs(action,params){
 const args={};for(const [key,value]of params){if(Object.hasOwn(args,key))throw fail('读取参数重复');args[key]=['offset','limit','charOffset'].includes(key)?(/^\d+$/.test(value)?Number(value):NaN):value;}
 return validateAgentReadInput(action,args);
}
function source(value={}){
 const result={},omitted=[];
 for(const [key,max]of Object.entries({format:20,sha256:128,processor:100,review:64,filename:512,edition:500,license:1000,href:1024,elementId:512,printedPage:64})){
  if(value[key]===null)result[key]=null;else if(value[key]!==undefined){if(string(value[key],max))result[key]=value[key];else omitted.push(key);}
 }
 if(value.url!==undefined){let u;try{u=new URL(value.url);}catch{}if(u&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&string(value.url,2048)&&![...u.searchParams.keys(),...new URLSearchParams(u.hash.slice(1)).keys()].some(k=>/token|secret|password|credential|authorization|^(?:key|sig|auth|code)$/i.test(k)))result.url=value.url;else omitted.push('url');}
 if(value.pdfPage===null||Number.isSafeInteger(value.pdfPage)&&value.pdfPage>0)result.pdfPage=value.pdfPage;
 if(Array.isArray(value.pdfPages)){result.pdfPages=value.pdfPages.filter(n=>Number.isSafeInteger(n)&&n>0).slice(0,50);if(result.pdfPages.length!==value.pdfPages.length)omitted.push('pdfPages');}
 if(Array.isArray(value.corrections))result.correctionCount=value.corrections.length;
 if(value.revision){result.revision={};for(const key of ['parentBookId','parentContentVersion','operation'])if(string(value.revision[key],256))result.revision[key]=value.revision[key];}
 for(const key of ['url','license','filename','edition','href','elementId','revision','pdfPages'])if(size(result)>2048&&Object.hasOwn(result,key)){delete result[key];omitted.push(key);}
 if(omitted.length)result.omittedFields=[...new Set(omitted)];
 return result;
}
const title=value=>Object.fromEntries(['zh','en'].filter(k=>string(value?.[k],500)).map(k=>[k,value[k]]));
const chapter=c=>({id:c.id,number:c.number,kind:string(c.kind,64)?c.kind:'unknown',title:title(c.title),...(c.startPassageId?{startPassageId:c.startPassageId}:{})});
const related=p=>({annotationIds:p.annotationIds.slice(0,5),termIds:p.termIds.slice(0,5),annotationCount:p.annotationIds.length,termCount:p.termIds.length,relatedMetadataOmitted:p.annotationIds.length>5||p.termIds.length>5});
function quoteMetadata(r){const result={},omitted=[];for(const key of ['quoteOrigin','quoteLanguage'])if(r[key]!==undefined){if(key==='quoteOrigin'?['original','translation'].includes(r[key]):string(r[key],35)&&/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(r[key]))result[key]=r[key];else omitted.push(key);}if(omitted.length)result.omittedFields=omitted;return result;}
const citation=(book,p,layer='original')=>({bookId:book.bookId,chapterId:p.chapterId,passageId:p.id,contentVersion:book.contentVersion,layer,url:'/read?'+new URLSearchParams({book:book.bookId,passage:p.id,contentVersion:book.contentVersion,layer}),uri:'reader://books/'+book.bookId+'/passages/'+p.id+'?'+new URLSearchParams({contentVersion:book.contentVersion})});
function uri(book,action,args){const suffix=action==='manifest'?'manifest':action==='passage'?'passages/'+args.passageId:'chapters/'+args.chapterId,query=new URLSearchParams();for(const [key,value]of Object.entries(args))if(!['bookId','chapterId'].includes(key)&&!(action==='passage'&&key==='passageId')&&value!==undefined)query.set(key,String(value));return 'reader://books/'+book.bookId+'/'+suffix+(query.size?'?'+query:'');}
function rowPage(base,all,args,key){
 const snapshot=digest({base,all});checkSnapshot(args,snapshot);
 const start=args.offset||0,limit=args.limit||20,out={...base,snapshot,[key]:[],nextOffset:null,nextCursor:null};if(start>all.length)throw fail('分页超出范围');
 for(let i=start;i<all.length&&out[key].length<limit;i++){out[key].push(all[i]);if(size(out)>TARGET){out[key].pop();if(!out[key].length){out[key].push(all[i]);bounded(out);}break;}}
 out.nextOffset=start+out[key].length<all.length?start+out[key].length:null;if(out.nextOffset!==null)out.nextCursor={offset:out.nextOffset,contentVersion:base.contentVersion,snapshot,...(args.limit!==undefined?{limit:args.limit}:{})};return bounded(out);
}
function textPage(book,args,{single=false}={}){
 const all=rows(book),selected=single?all.filter(p=>p.id===args.passageId):all.filter(p=>p.chapterId===args.chapterId),ch=book.chapters.find(c=>c.id===(single?selected[0]?.chapterId:args.chapterId));if(!ch||single&&!selected.length)throw fail('找不到当前授权段落或章节',404);
 const snapshot=digest({bookId:book.bookId,contentVersion:book.contentVersion,source:source(book.source),chapter:chapter(ch),passages:selected.map(p=>({id:p.id,original:p.original,translations:Object.fromEntries(['literal','interpretive'].map(l=>[l,select(p.translations[l],['text','status','origin','sourceVersion','createdAt'])])),source:source(p.source),...related(p)}))});checkSnapshot(args,snapshot);
 let start=args.offset||0;if(args.layer){start=selected.findIndex(p=>p.id===args.passageId);if(start<0)throw fail('续读锚点无法对应当前章节');}
 if(start>selected.length)throw fail('分页超出范围');
 const out={bookId:book.bookId,contentVersion:book.contentVersion,snapshot,source:source(book.source),chapterId:ch.id,chapter:chapter(ch),passages:[],nextOffset:null,nextCursor:null,nextUri:null};
 const limit=single?1:args.limit||10;
 for(let i=start;i<selected.length&&out.passages.length<limit;i++){
  const p=selected[i],piece={id:p.id,chapterId:p.chapterId,original:null,translations:{},translationStatus:Object.fromEntries(['literal','interpretive'].map(l=>[l,p.translations[l]?.text?p.translations[l].status||'draft':'missing'])),source:source({...p.source,format:book.source.format,sha256:book.source.sha256}),ranges:{},citation:citation(book,p),...related(p)};
  if(size(piece)>6000){piece.annotationIds=[];piece.termIds=[];piece.relatedMetadataOmitted=true;}
  out.passages.push(piece);if(size(out)>TARGET-1024&&out.passages.length>1){out.passages.pop();out.nextOffset=i;break;}
  const first=i===start&&args.layer?LAYERS.indexOf(args.layer):0;
  for(let j=first;j<LAYERS.length;j++){
   const layer=LAYERS[j],value=layer==='original'?p.original:p.translations[layer]?.text||'',chars=Array.from(value),offset=i===start&&j===first&&args.layer?args.charOffset:0;if(offset>chars.length)throw fail('续读范围超出当前段落');
   if(layer==='original')piece.original='';else if(p.translations[layer]?.text)piece.translations[layer]={...select(p.translations[layer],['status','origin','sourceVersion','createdAt']),text:''};
   const budget=Math.max(0,TARGET-size(out)-1024);let end=offset,used=0;while(end<chars.length&&end-offset<1024){const cost=Buffer.byteLength(JSON.stringify(chars[end]))-2;if(used+cost>budget)break;used+=cost;end++;}
   if(end===offset&&end<chars.length&&j===first&&i===start)throw fail('资料元数据超过续读上限',413);
   const text=chars.slice(offset,end).join('');if(layer==='original')piece.original=text;else if(piece.translations[layer])piece.translations[layer].text=text;
   piece.ranges[layer]={charOffset:offset,charEnd:end,totalChars:chars.length,unit:'unicode-code-points'};
   if(end<chars.length){out.nextCursor={chapterId:ch.id,passageId:p.id,layer,charOffset:end,contentVersion:book.contentVersion,snapshot,...(args.limit!==undefined?{limit:args.limit}:{})};break;}
  }
  if(out.nextCursor)break;
  out.nextOffset=i+1<selected.length?i+1:null;if(size(out)>TARGET-1024)break;
 }
 if(out.nextCursor)out.nextOffset=null;
 if(out.nextCursor)out.nextUri=uri(book,single?'passage':'chapter',out.nextCursor);else if(out.nextOffset!==null)out.nextUri=uri(book,single?'passage':'chapter',{chapterId:ch.id,offset:out.nextOffset,limit:args.limit,contentVersion:book.contentVersion,snapshot});
 if(single){out.passage=out.passages[0];delete out.passages;}return bounded(out);
}
// No writes, model calls or grant management are available in this module.
export async function scopedAgentRead({action,args,book,records,activityAllowed=false}){
 validateAgentReadInput(action,args);if(args.contentVersion!==undefined&&args.contentVersion!==book.contentVersion)throw fail('来源版本已变化，请重新读取目录后继续',409);
 const base={bookId:book.bookId,contentVersion:book.contentVersion},ps=rows(book);
 if(action==='manifest'){const out=rowPage({...base,title:title(book.title),author:string(book.author,500)?book.author:undefined,source:source(book.source)},book.chapters.map(chapter),args,'chapters');out.nextUri=out.nextOffset===null?null:uri(book,'manifest',out.nextCursor);return bounded(out);}
 if(action==='chapter'||action==='passage')return textPage(book,args,{single:action==='passage'});
 if(action==='context'){
  const saved=activityAllowed?await records():null,p=ps.find(p=>p.id===(args.passageId||saved?.position?.passageId||book.readingStart?.passageId))||ps[0];if(!p)throw fail('找不到当前授权段落',404);if(args.passageId&&p.id!==args.passageId)throw fail('找不到当前授权段落',404);
  const out=textPage(book,{...args,chapterId:p.chapterId,offset:ps.filter(r=>r.chapterId===p.chapterId).findIndex(r=>r.id===p.id),limit:1});return bounded({...out,title:title(book.title),source:source(book.source),position:saved?.position?select(saved.position,['chapterId','passageId','offset','withinParagraph','contentVersion']):null,neighborIds:ps.slice(Math.max(0,ps.indexOf(p)-1),ps.indexOf(p)+2).map(r=>r.id)});
 }
 if(action==='search'){const matches=ps.filter(p=>p.original.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())).map(p=>({id:p.id,chapterId:p.chapterId,excerpt:Array.from(p.original).slice(0,400).join(''),source:source(p.source),citation:citation(book,p)}));return rowPage(base,matches,args,'results');}
 const data=await records();
 if(action==='notes'){const notes=[...data.comments.map(r=>({...select(r,['id','bookId','contentVersion','passageId','text','origin','createdAt','updatedAt','revision','status','quote']),...quoteMetadata(r),type:'comment'})),...data.questions.map(r=>({...select(r,['id','bookId','contentVersion','passageId','text','origin','createdAt','updatedAt','revision','status','quote']),...quoteMetadata(r),type:'question'}))].map(r=>({...r,bookId:book.bookId,contentVersion:book.contentVersion,quotedLayer:r.quoteOrigin==='original'?'original':r.quoteOrigin==='translation'?'translation_variant_unknown':'unknown',citation:{...citation(book,{id:r.passageId,chapterId:ps.find(p=>p.id===r.passageId)?.chapterId}),purpose:'original-passage-locator'}}));return rowPage(base,notes,args,'records');}
 if(action==='activity'){
  const anchor=p=>p?select(p,['chapterId','passageId','offset','withinParagraph']):null;
  const metadata={...base,position:data.position?select(data.position,['chapterId','passageId','offset','withinParagraph','contentVersion']):null,readingGoal:data.readingGoal?select(data.readingGoal,['minutes','updatedAt']):null,meaning:'阅读记录只记录投入和用户自己的标记，Agent 访问不计入阅读时间，时长不证明理解'};
  const events=[...(data.readingSessions||[]).map(r=>({...select(r,['id','source','status','startedAt','endedAt','durationSeconds','timeZone']),start:anchor(r.start),end:anchor(r.end),type:'session',segmentCount:r.segments?.length||0,segmentsOmitted:!!r.segments?.length})),...(data.readingMilestones||[]).map(r=>({...select(r,['id','type','chapterId','createdAt','origin']),eventType:'milestone'}))];
  const {events:selected,...rest}=rowPage(metadata,events,args,'events');
  return bounded({...rest,readingSessions:selected.filter(r=>r.type==='session'),readingMilestones:selected.filter(r=>r.eventType==='milestone')});
 }
 throw fail('找不到这个读取操作',404);
}
