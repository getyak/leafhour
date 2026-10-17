import {audioError, audioHash, audioPassages} from './audio-content.mjs';

export const guideLimits=Object.freeze({chapterCharacters:30000,bookCharacters:900000,bookPassages:6000,batchCharacters:18000,batchPassages:48,batches:64,openingCharacters:6000,openingPassages:3});
export const guideTextLimits=Object.freeze({intro:300,explain:1200,book:900});
const same=(a,b)=>audioHash(a)===audioHash(b);
const tooLarge=()=>audioError('这次导听的原文范围太长，请缩小范围；尚未开始生成。',413,'scope_too_large');
const stale=()=>audioError('导听依据的原文已变化，请重新选择范围。',409,'stale_source');

// Scopes describe originals only. Translations, annotations and private records
// never become source material merely because they exist on a book object.
export function guideScope(book,input){
 if(!input||input.contentVersion!==book.contentVersion)throw stale();
 if(!['intro','explain','book'].includes(input.intent))throw audioError('请选择开篇导听、讲解或全书导览。');
 const all=audioPassages(book);
 if(!all.length||new Set(all.map(p=>p.id)).size!==all.length||all.some(p=>typeof p.original!=='string'||!p.original.trim()||!book.chapters.some(c=>c.id===p.chapterId)))throw audioError('原文段落或章节信息不完整。',409,'invalid_source');
 let selected,scopeMode,chapterId=null,throughPassageId=null,total;
 if(input.intent==='book'){
  if(input.scopeMode&&input.scopeMode!=='book')throw audioError('全书导览须包含整本书。');
  selected=all;scopeMode='book';total=all.length;
  if(all.length>guideLimits.bookPassages||all.reduce((n,p)=>n+p.original.length,0)>guideLimits.bookCharacters)throw tooLarge();
 }else{
  chapterId=input.chapterId;
  const chapter=all.filter(p=>p.chapterId===chapterId);
  if(!chapter.length)throw audioError('找不到这一章。');
  total=chapter.length;
  if(input.intent==='intro'){
   if(input.scopeMode&&input.scopeMode!=='opening')throw audioError('开篇导听只能使用开头的原文。');
   selected=[];let characters=0;
   for(const p of chapter.slice(0,guideLimits.openingPassages)){
    if(characters+p.original.length>guideLimits.openingCharacters)break;
    selected.push(p);characters+=p.original.length;
   }
   if(!selected.length)throw tooLarge();scopeMode='opening';
  }else{
   scopeMode=input.scopeMode||'through';
   if(!['through','chapter'].includes(scopeMode))throw audioError('讲解范围无效。');
   if(scopeMode==='through'){
    const at=chapter.findIndex(p=>p.id===input.throughPassageId);
    if(at<0)throw audioError('请选择本章当前读到的段落。');
    selected=chapter.slice(0,at+1);throughPassageId=chapter[at].id;
   }else selected=chapter;
   if(selected.length>200||selected.reduce((n,p)=>n+p.original.length,0)>guideLimits.chapterCharacters)throw tooLarge();
  }
 }
 const scope={intent:input.intent,contentVersion:book.contentVersion,chapterId,scopeMode,throughPassageId,passageIds:selected.map(p=>p.id),sourceHashes:Object.fromEntries(selected.map(p=>[p.id,audioHash(p.original)])),coverage:{covered:selected.length,total,complete:selected.length===total,chapterIds:[...new Set(selected.map(p=>p.chapterId))]}};
 // A saved scope is a source snapshot, not permission to silently regenerate
 // against changed text, a different paragraph order or expanded coverage.
 for(const key of ['passageIds','sourceHashes','coverage'])if(input[key]!==undefined&&!same(input[key],scope[key]))throw stale();
 guideBatches(book,scope);
 return scope;
}

export function guideBatches(book,scope){
 const ids=new Set(scope.passageIds),rows=audioPassages(book).filter(p=>ids.has(p.id)),batches=[];
 let batch=[],characters=0;
 for(const p of rows){
  if(p.original.length>guideLimits.batchCharacters)throw tooLarge();
  if(batch.length&&(batch.length>=guideLimits.batchPassages||characters+p.original.length>guideLimits.batchCharacters)){batches.push(batch);batch=[];characters=0;}
  batch.push({id:p.id,chapterId:p.chapterId,original:p.original});characters+=p.original.length;
 }
 if(batch.length)batches.push(batch);
 if(!batches.length||batches.length>guideLimits.batches)throw tooLarge();
 return batches;
}

export function validateGuide(book,input,candidate){
 const scope=guideScope(book,input),rows=audioPassages(book),index=new Map(rows.filter(p=>scope.passageIds.includes(p.id)).map(p=>[p.id,p]));
 if(candidate?.intent!==undefined&&candidate.intent!==scope.intent||candidate?.contentVersion!==undefined&&candidate.contentVersion!==scope.contentVersion)throw stale();
 for(const key of ['passageIds','sourceHashes'])if(candidate?.[key]!==undefined&&!same(candidate[key],scope[key]))throw stale();
 if(candidate?.scope!==undefined&&!same(candidate.scope,scope))throw stale();
 if(candidate?.coverage!==undefined&&!same(candidate.coverage,scope.coverage))throw audioError('讲稿的原文覆盖记录不一致。',502,'invalid_coverage');
 if(!Array.isArray(candidate?.turns)||!candidate.turns.length||candidate.turns.length>24)throw audioError('讲稿轮次未通过检查。',502,'invalid_dialogue');
 let characters=0;
 const turns=candidate.turns.map((turn,i)=>{
  if(!['guide','questioner'].includes(turn.speaker)||typeof turn.text!=='string'||!turn.text.trim()||turn.text.length>1200||!Array.isArray(turn.sourceRefs)||!turn.sourceRefs.length||turn.sourceRefs.length>4)throw audioError('讲稿内容未通过检查。',502,'invalid_dialogue');
  characters+=turn.text.length;if(characters>guideTextLimits[scope.intent])throw audioError('讲稿超出这次导听的时长，请缩短后重新生成。',502,'invalid_dialogue');
  const style=turn.style||'calm',kind=turn.kind||(turn.speaker==='questioner'?'question':'explanation');
  if(!['calm','curious','reflective','emphatic'].includes(style)||!['explanation','question','example','quote'].includes(kind))throw audioError('讲稿的表达标记无效。',502,'invalid_dialogue');
  const sourceRefs=turn.sourceRefs.map(ref=>{
   const p=index.get(ref?.passageId);
   if(!p||ref.chapterId!==undefined&&ref.chapterId!==p.chapterId||typeof ref.quote!=='string'||!ref.quote.trim()||ref.quote.length>500||!p.original.includes(ref.quote))throw audioError('讲稿出处须与授权原文精确对应。',502,'invalid_citation');
   return {chapterId:p.chapterId,passageId:p.id,quote:ref.quote};
  });
  if(kind==='example'&&!/(例子|举例|假设|比方|illustrat|example|imagine)/i.test(turn.text))throw audioError('补充例子须在台词中说明归属。',502,'unattributed_example');
  if(kind==='quote'&&turn.text!==sourceRefs.map(r=>r.quote).join(' '))throw audioError('原文摘录不能改写。',502,'invalid_citation');
  return {id:'turn-'+(i+1),speaker:turn.speaker,text:turn.text,style,kind,sourceRefs};
 });
 return {kind:'guided-listening',intent:scope.intent,scope,chapterId:scope.chapterId,contentVersion:book.contentVersion,passageIds:scope.passageIds,sourceHashes:scope.sourceHashes,coverage:scope.coverage,origin:'ai',turns};
}
