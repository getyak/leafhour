export function validParagraphAnchor(position){
  return !!position&&Number.isFinite(position.offset)&&Math.abs(position.offset)<=4000&&(position.withinParagraph===undefined||Number.isFinite(position.withinParagraph)&&position.withinParagraph>=0&&position.withinParagraph<=1);
}
export function captureParagraphAnchor({top,height},threshold){
  const anchor={offset:Math.max(-4000,Math.min(4000,top))};
  if(top<threshold&&Number.isFinite(height)&&height>0)anchor.withinParagraph=Math.max(0,Math.min(1,(threshold-top)/height));
  return anchor;
}
export function paragraphScrollDelta({top,height},anchor,threshold){
  return anchor.withinParagraph!==undefined&&height>0?top+anchor.withinParagraph*height-threshold:top-anchor.offset;
}
