import {createHash} from 'node:crypto';
import {createWebSearch,searchOpenLibrary} from './reading-agent-search.mjs';
const LAYERS=['original','literal','interpretive'],TARGET=7168,HARD=24576;
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const hash=x=>createHash('sha256').update(x).digest('hex');
const str=(max=128)=>({type:'string',minLength:1,maxLength:max});
const integer=max=>({type:'integer',minimum:0,maximum:max});
const layer={type:'string',enum:LAYERS};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const paging={offset:integer(1000000),limit:{type:'integer',minimum:1,maximum:20}};
const specs=[
 ['reader_get_context','读取当前阅读位置及三层正文',{},[]],
 ['reader_list_books','列出可读书籍',{query:str(2000),...paging},[]],
 ['reader_get_outline','读取真实目录',{bookId:str(),offset:integer(1000000),limit:{type:'integer',minimum:1,maximum:100}},['bookId']],
 ['reader_read_chapter','分页读取章节，或按单段游标续读',{bookId:str(),chapterId:str(),...paging,passageId:str(),layer,charOffset:integer(10000000)},['bookId','chapterId']],
 ['reader_search','检索可读原文与两种译文',{query:str(2000),bookIds:{type:'array',maxItems:20,items:str()},...paging},['query']],
 ['reader_recommend_books','检索并核实书房与外部书目候选。书房提供阅读背景，不限定推荐范围；外部书目独立检索，无需书房已有。你可以自由推荐书房之外的书，也可用已知具体书名核实候选。空结果仅表示本次检索未命中，不表示不能推荐或阅读。返回书目是检索候选，不等同于最终推荐。',{query:{...str(2000),description:'具体书名、作者或简短检索关键词，可用英文原名提高匹配机会；这是书目搜索词，不是整段推荐任务或自然语言指令。'},limit:{type:'integer',minimum:1,maximum:5,description:'各来源最多返回的候选书目数量。'}},['query']],
 ['reader_search_web','检索公开网络',{query:str(2000)},['query']],
 ['reader_cite','登记已经读到的精确引文',{bookId:str(),passageId:str(),quote:str(12000),layer},['bookId','passageId','quote']]
];
const definitions=specs.map(([name,description,p,r])=>({name,description,parameters:schema(p,r)}));
const failure=(code='UNAVAILABLE',message='无法读取这项资料')=>({error:{code,message}});
function valid(value,s){if(s.type==='object')return value!==null&&!Array.isArray(value)&&typeof value==='object'&&Object.keys(value).every(k=>Object.hasOwn(s.properties,k)&&valid(value[k],s.properties[k]))&&s.required.every(k=>Object.hasOwn(value,k));if(s.type==='string')return typeof value==='string'&&value.isWellFormed()&&value.length>=(s.minLength||0)&&value.length<=(s.maxLength||Infinity)&&(!s.enum||s.enum.includes(value));if(s.type==='integer')return Number.isSafeInteger(value)&&value>=s.minimum&&value<=s.maximum;if(s.type==='array')return Array.isArray(value)&&value.length<=s.maxItems&&value.every(v=>valid(v,s.items));return false;}
const rows=b=>b.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId})));
const text=(p,l)=>l==='original'?p.original:p.translations?.[l]?.text||'';
const titleNames=b=> (typeof b.title==='string'?[b.title]:[b.title?.zh,b.title?.en]).filter(t=>typeof t==='string'&&t.trim()).map(t=>t.trim().slice(0,500));
const matchesBook=(b,query)=>!query||[...titleNames(b),typeof b.author==='string'?b.author.slice(0,500):''].join(' ').toLowerCase().includes(query.toLowerCase());
const metadata=b=>({bookId:b.bookId,title:titleNames(b)[0]||'',author:typeof b.author==='string'?b.author.slice(0,500):'',visibility:b.visibility,owned:b.visibility==='private',url:'/read?book='+encodeURIComponent(b.bookId)});
const readUrl=(b,p)=>'/read?book='+encodeURIComponent(b)+'&passage='+encodeURIComponent(p);

export function createReadingAgentTools({library,user,bookId,passageId,signal,onActivity=async()=>{},searchWeb,searchBooks=searchOpenLibrary,env=process.env}){
  searchWeb??=createWebSearch({env});
  const accessed=new Map(),visible=new Map(),refs=[],candidates=[];
  const check=()=>signal?.throwIfAborted();
  const abortable=(operation,activeSignal=signal)=>{if(!activeSignal)return operation;if(activeSignal.aborted){Promise.resolve(operation).catch(()=>{});activeSignal.throwIfAborted();}return new Promise((resolve,reject)=>{const abort=()=>reject(activeSignal.reason);activeSignal.addEventListener('abort',abort,{once:true});Promise.resolve(operation).then(resolve,reject).finally(()=>activeSignal.removeEventListener('abort',abort));});};
  async function get(id){check();const b=await library.getBook(user,id);check();const previous=accessed.get(id);if(previous&&previous!==b.contentVersion)throw Error('Version changed');accessed.set(id,b.contentVersion);return b;}
  function remember(b,p,l,start,end,store=visible){const key=JSON.stringify([b.bookId,p.id,l]),value=text(p,l);let entry=store.get(key);if(entry&&entry.hash!==hash(value))throw Error('Source changed');if(!entry){entry={bookId:b.bookId,passageId:p.id,layer:l,hash:hash(value),ranges:[]};store.set(key,entry);}entry.ranges.push({start,end,text:Array.from(value).slice(start,end).join('')});entry.ranges.sort((a,b)=>a.start-b.start);const merged=[];for(const r of entry.ranges){const last=merged.at(-1);if(last&&r.start<=last.end){last.text+=Array.from(r.text).slice(Math.max(0,last.end-r.start)).join('');last.end=Math.max(last.end,r.end);}else merged.push({...r});}entry.ranges=merged;}
  function page(b,chapterId,args={},effects){
    const chapter=b.chapters.find(c=>c.id===chapterId);if(!chapter)throw Error('Missing chapter');
    const all=rows(b).filter(p=>p.chapterId===chapterId);let offset=args.offset||0;
    if(args.passageId){offset=all.findIndex(p=>p.id===args.passageId);if(offset<0||!args.layer)throw Error('Invalid cursor');}
    const out={bookId:b.bookId,title:metadata(b).title,contentVersion:b.contentVersion,chapterId,chapterTitle:chapter.title,passages:[],nextOffset:null,nextCursor:null,truncated:false};
    let used=bytes(out);const limit=args.limit||20;
    for(let i=offset;i<all.length&&out.passages.length<limit;i++){
      const p=all[i],piece={passageId:p.id,original:null,literal:null,interpretive:null,translationStatus:{literal:p.translations?.literal?.text?p.translations.literal.status||'draft':'missing',interpretive:p.translations?.interpretive?.text?p.translations.interpretive.status||'draft':'missing'},visibleRanges:{}};
      const first=i===offset&&args.passageId?LAYERS.indexOf(args.layer):0;
      for(let j=first;j<LAYERS.length;j++){
        const l=LAYERS[j],value=text(p,l),chars=Array.from(value),start=i===offset&&j===first&&args.passageId?args.charOffset||0:0;if(start>chars.length)throw Error('Invalid cursor');
        let end=start,budget=Math.max(0,TARGET-used-bytes(piece)-500),size=0;
        while(end<chars.length){const cost=Buffer.byteLength(JSON.stringify(chars[end]))-2;if(size+cost>budget)break;size+=cost;end++;}
        piece[l]=chars.slice(start,end).join('');piece.visibleRanges[l]={charOffset:start,charEnd:end,totalChars:chars.length};effects.ranges.push([b,p,l,start,end]);
        if(end<chars.length){out.nextCursor={bookId:b.bookId,chapterId,passageId:p.id,layer:l,charOffset:end};out.truncated=true;break;}
      }
      out.passages.push(piece);used=bytes(out);if(out.nextCursor){out.nextOffset=null;break;}
      if(i+1<all.length){out.nextOffset=i+1;if(used>TARGET-1000)break;}else out.nextOffset=null;
    }
    if(!out.nextCursor&&offset+out.passages.length<all.length)out.nextOffset=offset+out.passages.length;
    if(bytes(out)>HARD)throw Error('Result too large');return out;
  }
  async function run(name,a,{reserveRequest,signal:runtimeSignal}={},effects){
    const activeSignal=runtimeSignal||signal,checkRun=()=>activeSignal?.throwIfAborted();checkRun();
    if(name==='reader_list_books'){const all=(await library.list(user)).filter(b=>matchesBook(b,a.query)).map(metadata);return {books:all.slice(a.offset||0,(a.offset||0)+(a.limit||20)),nextOffset:(a.offset||0)+(a.limit||20)<all.length?(a.offset||0)+(a.limit||20):null};}
    if(name==='reader_get_context'){const b=await get(bookId),p=rows(b).find(p=>p.id===(passageId||b.readingStart?.passageId))||rows(b)[0];if(!p)throw Error('Missing passage');return {...page(b,p.chapterId,{passageId:p.id,layer:'original',limit:1},effects),passageId:p.id};}
    if(name==='reader_get_outline'){const b=await get(a.bookId),offset=a.offset||0,limit=a.limit||100;return {bookId:b.bookId,contentVersion:b.contentVersion,chapters:b.chapters.slice(offset,offset+limit).map(c=>({id:c.id,title:c.title,startPassageId:c.startPassageId})),nextOffset:offset+limit<b.chapters.length?offset+limit:null};}
    if(name==='reader_read_chapter')return page(await get(a.bookId),a.chapterId,a,effects);
    if(name==='reader_search'){const ids=a.bookIds|| (await library.list(user)).map(b=>b.bookId),results=[];for(const id of ids){const b=await get(id);for(const p of rows(b))for(const l of LAYERS){const value=text(p,l),n=value.toLocaleLowerCase().indexOf(a.query.toLocaleLowerCase());if(n<0)continue;const begin=Array.from(value.slice(0,n)).length,start=Math.max(0,begin-60),end=Math.min(Array.from(value).length,begin+Array.from(a.query).length+100),excerpt=Array.from(value).slice(start,end).join('');results.push({bookId:b.bookId,chapterId:p.chapterId,passageId:p.id,layer:l,excerpt,charOffset:start,charEnd:end,url:readUrl(b.bookId,p.id),_b:b,_p:p});}}
      const offset=a.offset||0,limit=a.limit||20,selected=[];for(const r of results.slice(offset,offset+limit)){const {_b,_p,...publicResult}=r;if(bytes({results:[...selected,publicResult]})>TARGET&&selected.length)break;effects.ranges.push([_b,_p,r.layer,r.charOffset,r.charEnd]);selected.push(publicResult);}return {results:selected,nextOffset:offset+selected.length<results.length?offset+selected.length:null};}
    if(name==='reader_cite'){const l=a.layer||'original',entry=visible.get(JSON.stringify([a.bookId,a.passageId,l]));if(!entry||!entry.ranges.some(r=>r.text.includes(a.quote)))return failure('UNREAD_SOURCE','引用必须精确对应本轮已读文字');const b=await get(a.bookId),p=rows(b).find(p=>p.id===a.passageId);if(!p||hash(text(p,l))!==entry.hash)throw Error('Source changed');const ref={bookId:b.bookId,chapterId:p.chapterId,chapterTitle:b.chapters.find(c=>c.id===p.chapterId)?.title,contentVersion:b.contentVersion,passageId:p.id,quote:a.quote,layer:l,url:readUrl(b.bookId,p.id),...(l==='original'?{}:{translationStatus:p.translations?.[l]?.status||'draft'})};if(!refs.some(r=>JSON.stringify(r)===JSON.stringify(ref)))effects.refs.push(ref);return structuredClone(ref);}
    if(name==='reader_recommend_books'){const limit=a.limit||5,local=(await library.list(user)).filter(b=>matchesBook(b,a.query)).map(metadata).slice(0,limit).map(b=>({...b,source:b.owned?'library':'catalog'}));let external;try{const found=await searchBooks(a.query,{signal:activeSignal,limit});checkRun();external={status:'completed',books:found.filter(b=>typeof b.title==='string'&&/^https:\/\/openlibrary.org\/works\/OL\d+W$/.test(b.url)).slice(0,limit).map(b=>({title:b.title.slice(0,500),author:String(b.author||'').slice(0,500),url:b.url,owned:false,source:'openlibrary'}))};}catch{checkRun();external={status:'failed',books:[],message:'外部书目暂时无法检索'};}for(const b of [...local,...external.books])if(!candidates.some(c=>c.url===b.url))effects.candidates.push(b);return {local,external};}
    if(name==='reader_search_web'){const result=await searchWeb(a.query,{signal:activeSignal,reserveRequest});checkRun();return {sources:(result.sources||[]).filter(s=>{try{return ['http:','https:'].includes(new URL(s.url).protocol);}catch{return false;}}).slice(0,10).map(s=>({title:String(s.title||'').slice(0,300),url:s.url.slice(0,2000),snippet:String(s.snippet||'').slice(0,600)}))};}
  }
  return {definitions:structuredClone(definitions),async execute(name,args={},internal={}){const activeSignal=internal.signal&&signal?AbortSignal.any([signal,internal.signal]):internal.signal||signal,checkActive=()=>activeSignal?.throwIfAborted();checkActive();const d=definitions.find(d=>d.name===name);if(!d||!valid(args,d.parameters)||args.passageId&&name==='reader_read_chapter'&&(!args.layer||args.charOffset===undefined))return failure('INVALID_ARGUMENTS','工具参数无效');const activity={tool:name,label:({reader_get_context:'正在阅读当前位置',reader_read_chapter:'正在阅读章节',reader_get_outline:'正在查看目录',reader_search:'正在搜索书房',reader_list_books:'正在查看书房',reader_recommend_books:'正在查找书目',reader_search_web:'正在搜索网络',reader_cite:'正在核对引文'})[name],...(args.bookId?{bookId:args.bookId}:{}),...(args.chapterId?{chapterId:args.chapterId}:{})};await abortable(onActivity({...activity,status:'running'}),activeSignal);checkActive();try{const effects={ranges:[],refs:[],candidates:[]};const result=await abortable(run(name,args,{...internal,signal:activeSignal},effects),activeSignal);checkActive();if(bytes(result)>HARD)throw Error('Result too large');await abortable(onActivity({...activity,...(result.bookId?{bookId:result.bookId}:{}),...(result.chapterId?{chapterId:result.chapterId}:{}),status:result.error?'failed':'completed'}),activeSignal);checkActive();if(!result.error){const nextVisible=new Map([...visible].map(([key,value])=>[key,structuredClone(value)]));for(const range of effects.ranges)remember(...range,nextVisible);visible.clear();for(const [key,value]of nextVisible)visible.set(key,value);for(const ref of effects.refs)if(!refs.some(r=>JSON.stringify(r)===JSON.stringify(ref)))refs.push(ref);for(const candidate of effects.candidates)if(!candidates.some(c=>c.url===candidate.url))candidates.push(candidate);}return result;}catch(error){checkActive();if(error?.name==='AbortError')throw error;await abortable(onActivity({...activity,status:'failed'}),activeSignal);checkActive();return failure();}},async verify(){check();for(const [id,version]of accessed){const b=await library.getBook(user,id);check();if(b.contentVersion!==version)throw Error('Source version changed');for(const ref of refs.filter(r=>r.bookId===id)){const p=rows(b).find(p=>p.id===ref.passageId),entry=visible.get(JSON.stringify([id,ref.passageId,ref.layer]));if(!p||hash(text(p,ref.layer))!==entry.hash)throw Error('Cited source changed');}}},sources:()=>structuredClone(refs),recommendations:()=>structuredClone(candidates)};
}
