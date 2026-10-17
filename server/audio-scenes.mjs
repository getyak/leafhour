import {audioHash,audioError} from './audio-content.mjs';
const limit=160;
function splitTurn(turn,turnIndex){
 const parts=[];for(let at=0;at<turn.text.length;){let stop=Math.min(at+limit,turn.text.length);
  if(stop<turn.text.length){if(/[\uDC00-\uDFFF]/u.test(turn.text[stop]))stop--;const window=turn.text.slice(at,stop),cuts=[...window.matchAll(/[。！？.!?；;\n]|\s/g)];if(cuts.at(-1)?.index>=64)stop=at+cuts.at(-1).index+1;}
  const text=turn.text.slice(at,stop);if(!text.trim())throw audioError('讲稿中的空白过长，请缩短这一轮。',413);
  parts.push({speaker:turn.speaker,text,...(turn.kind?{kind:turn.kind}:{}),style:turn.style||'',sourceRefs:structuredClone(turn.sourceRefs),turnIndex,start:at,end:stop});at=stop;
 }return parts;
}
export function prepareDialogueScenes(bookId,dialogue){
 const clips=[];let group=[],length=0;
 const flush=()=>{if(!group.length)return;const text=group.map(t=>t.text).join(''),sourceRefs=[...new Map(group.flatMap(t=>t.sourceRefs).map(r=>[JSON.stringify(r),r])).values()];clips.push({sceneVersion:3,sceneIndex:clips.length,text,textHash:audioHash(text),sourceHash:audioHash(dialogue.sourceHashes||sourceRefs),sourceHashes:structuredClone(dialogue.sourceHashes||{}),language:'zh',variant:'interpretive',passageId:sourceRefs[0]?.passageId,sourceRefs,turns:group,start:0,end:text.length});group=[];length=0;};
 for(const [i,turn]of dialogue.turns.entries())for(const part of splitTurn(turn,i)){if(length+part.text.length>limit)flush();group.push(part);length+=part.text.length;}flush();
 return {bookId,contentVersion:dialogue.contentVersion,chapterId:dialogue.chapterId,language:'zh',variant:'interpretive',clips};
}
export const sceneCacheKey=(identity,clip,model)=>audioHash([identity,3,model,clip.language,clip.variant,clip.sourceHashes,clip.turns.map(t=>({speaker:t.speaker,kind:t.kind,text:t.text,voice:t.voice,style:t.style,sourceRefs:t.sourceRefs,turnIndex:t.turnIndex,start:t.start,end:t.end}))]);
