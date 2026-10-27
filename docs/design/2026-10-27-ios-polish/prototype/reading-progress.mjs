import {normalizeReadingPosition} from './reading-position.mjs';
const clamp=value=>Math.max(0,Math.min(1,value));
const content=(passages,layer)=>passages.filter(p=>typeof p[layer]==='string'&&p[layer].length);
export function positionAtProgress(fraction,passages,identity){
  if(!Number.isFinite(fraction))return null;
  const list=content(passages,identity.layer),total=list.reduce((n,p)=>n+p[identity.layer].length,0);
  if(!total)return null;
  let offset=Math.round(clamp(fraction)*(total-1));
  for(const p of list){
    const text=p[identity.layer];
    if(offset<text.length)return normalizeReadingPosition({schema:1,...identity,passageId:p.id,offsetUtf16:offset,fraction:offset/Math.max(1,text.length-1),viewportOffsetPx:8},identity,text)?.position||null;
    offset-=text.length;
  }
  return null;
}
export function progressAtPosition(position,passages,layer){
  if(!position)return 0;
  const list=content(passages,layer),total=list.reduce((n,p)=>n+p[layer].length,0);
  let before=0;
  for(const p of list){
    if(p.id===position.passageId){
      const max=p[layer].length-1,offset=position.layer===layer?position.offsetUtf16:position.fraction*max;
      return clamp((before+Math.max(0,Math.min(max,Number(offset)||0)))/Math.max(1,total-1));
    }
    before+=p[layer].length;
  }
  return 0;
}
