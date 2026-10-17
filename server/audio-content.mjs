import {createHash} from 'node:crypto';
export const audioError=(message,status=400,code='invalid_audio_request')=>Object.assign(new Error(message),{status,code});
export const audioHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const audioPassages=book=>book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,chapterId:s.chapterId})));
const boundary=(text,n)=>n===0||n===text.length||!(text.charCodeAt(n)>=0xDC00&&text.charCodeAt(n)<=0xDFFF&&text.charCodeAt(n-1)>=0xD800&&text.charCodeAt(n-1)<=0xDBFF);
// WAV is larger than MP3. Version new sessions so legacy audio keeps its exact
// source ranges, cache keys and listening positions after the provider change.
export function chunkAudio(prepared,version=2){
 if(version===1)return prepared;
 if(version!==2)throw audioError('听读分段版本不受支持。');
 return {...prepared,clips:prepared.clips.flatMap(clip=>{
  const pieces=[];
  for(let at=0;at<clip.text.length;){
   let stop=Math.min(at+200,clip.text.length);
   if(stop<clip.text.length){
    if(!boundary(clip.text,stop))stop--;
    const window=clip.text.slice(at,stop),sentences=[...window.matchAll(/[。！？.!?；;\n]/g)],spaces=[...window.matchAll(/\s/g)];
    const cut=sentences.at(-1)?.index>100?sentences.at(-1).index:spaces.at(-1)?.index>100?spaces.at(-1).index:null;
    if(cut!==null)stop=at+cut+1;
    if(!clip.text.slice(stop).trim()){
     // Keep a final spoken word with its trailing whitespace. A blank-only
     // remainder would otherwise fail after earlier clips had already billed.
     const word=/\S+\s*$/.exec(clip.text.slice(at));let cutAt=at+(word?.index||0);
     if(cutAt<=at||clip.text.length-cutAt>200){cutAt=clip.text.length-(clip.text.match(/\s*$/)?.[0].length||0)-1;if(!boundary(clip.text,cutAt))cutAt--;}
     if(cutAt<=at||cutAt-at>200||clip.text.length-cutAt>200)throw audioError('选文中连续空白过长，请缩短朗读范围。',413);
     stop=cutAt;
    }
   }
   const text=clip.text.slice(at,stop),start=(clip.start||0)+at;
   if(!text.trim())throw audioError('选文中连续空白过长，请缩短朗读范围。',413);
   pieces.push({...clip,text,textHash:audioHash(text),start,end:start+text.length});at=stop;
  }
  return pieces;
 })};
}
export function prepareReading(book,input,{chunkingVersion=1}={}){
 if(!input||input.contentVersion!==book.contentVersion)throw audioError('正文版本已变化，请重新选择。',409,'stale_source');
 if(!book.chapters.some(c=>c.id===input.chapterId))throw audioError('找不到这一章。');
 const rows=audioPassages(book),variant=input.variant||'interpretive',language=input.language||'en';
 if(!['en','zh'].includes(language)||!['literal','interpretive'].includes(variant))throw audioError('请选择原文或一种译法。');
 let parts=input.parts;
 if(input.mode==='chapter')parts=rows.filter(p=>p.chapterId===input.chapterId).map(p=>({passageId:p.id,language}));
 if(!Array.isArray(parts)||!parts.length||parts.length>80)throw audioError('请选择较短的章节范围，最多 80 段。');
 const clips=[];let previous=-1,total=0;
 for(const part of parts){
  const index=rows.findIndex(p=>p.id===part.passageId),p=rows[index],lang=part.language||language;
  if(!p||p.chapterId!==input.chapterId||index<=previous||!['en','zh'].includes(lang))throw audioError('选文顺序或出处不一致，请只选择正文的一侧。');previous=index;
  const text=lang==='en'?p.original:p.translations?.[variant]?.text;
  if(typeof text!=='string'||!text.trim())throw audioError('这份译文尚未准备好，可以改听原文。',409,'missing_translation');
  const start=part.start??0,end=part.end??text.length;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>text.length||!boundary(text,start)||!boundary(text,end)||part.text!==undefined&&part.text!==text.slice(start,end))throw audioError('选文已变化，请重新选择。',409,'selection_changed');
  total+=end-start;if(total>30000)throw audioError('朗读范围过长，请选择较短小节。',413);
  // Exact source offsets survive chunking; no text is rewritten to improve pronunciation.
  // Version 2 is segmented later from each complete selection, so an old
  // 1,200-character cut cannot break a word before the shorter WAV cuts run.
  for(let at=start;at<end;){let stop=Math.min(at+(chunkingVersion===2?30000:1200),end);if(stop<end){if(!boundary(text,stop))stop--;const slice=text.slice(at,stop),matches=[...slice.matchAll(/[。！？.!?；;\n]/g)];if(matches.length&&matches.at(-1).index>600)stop=at+matches.at(-1).index+1;}
   const value=text.slice(at,stop);clips.push({passageId:p.id,start:at,end:stop,text:value,textHash:audioHash(value),language:lang,variant,sourceHash:audioHash(text)});at=stop;}
 }
 return {bookId:book.bookId,contentVersion:book.contentVersion,chapterId:input.chapterId,language,variant,clips};
}
export function prepareNarrationBatch(book,input){
 const rows=audioPassages(book).filter(p=>p.chapterId===input?.chapterId),at=rows.findIndex(p=>p.id===input?.from?.passageId),language=input?.language||'en',variant=input?.variant||'interpretive';
 if(at<0||!Number.isInteger(input.from.start)||input.from.start<0)throw audioError('请先选择从哪一段开始朗读。');
 const clips=[];let continuation=null;
 for(let i=at;i<rows.length&&clips.length<10;i++){
  const p=rows[i],text=language==='en'?p.original:p.translations?.[variant]?.text,start=i===at?input.from.start:0;
  if(typeof text!=='string'||!text.trim())throw audioError('这份译文尚未准备好，可以改听原文。',409,'missing_translation');
  let end=Math.min(text.length,start+3000);if(!boundary(text,end))end--;
  const prepared=chunkAudio(prepareReading(book,{contentVersion:input.contentVersion,chapterId:input.chapterId,language,variant,parts:[{passageId:p.id,start,end}]},{chunkingVersion:2}),2);
  const selected=prepared.clips.slice(0,10-clips.length);clips.push(...selected);const stop=selected.at(-1).end;
  continuation=stop<text.length?{passageId:p.id,start:stop}:rows[i+1]?{passageId:rows[i+1].id,start:0}:null;
  if(stop<text.length)break;
 }
 const parts=[];for(const clip of clips){const prior=parts.at(-1);if(prior?.passageId===clip.passageId&&prior.end===clip.start)prior.end=clip.end;else parts.push({passageId:clip.passageId,start:clip.start,end:clip.end});}
 return {clips,input:{contentVersion:input.contentVersion,chapterId:input.chapterId,language,variant,parts},continuation};
}
export function dialogueScope(book,scope){
 const rows=audioPassages(book).filter(p=>p.chapterId===scope?.chapterId),ids=scope?.passageIds;
 if(!rows.length||ids!==undefined&&(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!rows.some(p=>p.id===id))))throw audioError('章节范围无效。');
 const selected=ids?rows.filter(p=>ids.includes(p.id)):rows;
 if(selected.length>80||selected.reduce((n,p)=>n+p.original.length,0)>30000)throw audioError('本章范围较大，请选择一个较短的小节。',413,'scope_too_large');
 return selected;
}
export function validateDialogue(book,scope,candidate){
 const rows=dialogueScope(book,scope),index=new Map(rows.map(p=>[p.id,p]));
 if(!Array.isArray(candidate?.turns)||!candidate.turns.length||candidate.turns.length>24)throw audioError('讲稿轮次未通过检查。',502,'invalid_dialogue');
 let total=0;
 const turns=candidate.turns.map((turn,i)=>{
  if(!['guide','questioner'].includes(turn.speaker)||typeof turn.text!=='string'||!turn.text.trim()||turn.text.length>1200||!Array.isArray(turn.sourceRefs)||!turn.sourceRefs.length||turn.sourceRefs.length>4)throw audioError('讲稿内容未通过检查。',502,'invalid_dialogue');
  total+=turn.text.length;if(total>6000)throw audioError('讲稿过长。',502,'invalid_dialogue');
  const sourceRefs=turn.sourceRefs.map(r=>{if(typeof r.quote!=='string'||!r.quote.trim()||r.quote.length>500||!index.get(r.passageId)?.original.includes(r.quote))throw audioError('讲稿出处未通过检查，请重新生成。',502,'invalid_citation');return {passageId:r.passageId,quote:r.quote};});
  return {id:'turn-'+(i+1),speaker:turn.speaker,text:turn.text,sourceRefs};
 });
 return {chapterId:scope.chapterId,passageIds:rows.map(p=>p.id),contentVersion:book.contentVersion,sourceHashes:Object.fromEntries(rows.map(p=>[p.id,audioHash(p.original)])),origin:'ai',turns};
}
export const clipCacheKey=(identity,clip,voice,model,style)=>audioHash([identity,clip.textHash,clip.language,clip.variant,voice,model,style]);
