// A waiting screen carries one short source sentence, without paraphrasing it.
export function arrivalExcerpt(original){
 const text=typeof original==='string'?original.trim():'';
 for(const match of text.matchAll(/[。！？](?:["'”’])?|[.!?](?:["'”’])?(?=\s|$)/gu)){
  const end=match.index+match[0].length;
  if(end>160)break;
  if(end>=8&&!/\b(?:Mr|Mrs|Ms|Dr|Prof|St)\.$/.test(text.slice(0,end)))return text.slice(0,end);
 }
 if([...text].length<=160)return text;
 const prefix=[...text].slice(0,160).join(''),space=prefix.lastIndexOf(' ');
 return (space>=80?prefix.slice(0,space):prefix).trimEnd()+'…';
}
