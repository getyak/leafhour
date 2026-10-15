const EDGE_GAP=12;
const HEADER_GAP=8;

export function placeFloatingToolbar({anchor,fallbackAnchor=anchor,toolbar,viewport,headerBottom,gap=10}){
  const visible=anchor.bottom>headerBottom&&anchor.top<viewport.height;
  const left=Math.max(EDGE_GAP,Math.min(anchor.left,viewport.width-toolbar.width-EDGE_GAP));
  const above=anchor.top-gap-toolbar.height;
  const below=fallbackAnchor.bottom+gap;
  if(above>=headerBottom+HEADER_GAP)return {left,top:above,placement:'above',visible};
  if(below+toolbar.height<=viewport.height-EDGE_GAP)return {left,top:below,placement:'below',visible};
  const topSpace=Math.max(0,anchor.top-headerBottom);
  const bottomSpace=Math.max(0,viewport.height-fallbackAnchor.bottom);
  const placement=topSpace>=bottomSpace?'above':'below';
  const preferred=placement==='above'?above:below;
  const top=Math.max(headerBottom+HEADER_GAP,Math.min(preferred,viewport.height-toolbar.height-EDGE_GAP));
  return {left,top,placement,visible};
}

export function placeFloatingMenu({toolbar,menu,viewport,headerBottom,gap=7}){
 const minimum=headerBottom+HEADER_GAP,above=Math.max(0,toolbar.top-gap-minimum),below=Math.max(0,viewport.height-EDGE_GAP-toolbar.bottom-gap);
 const down=below>=menu.height||below>=above,maxHeight=Math.min(menu.height,down?below:above);
 return {left:Math.max(EDGE_GAP,Math.min(toolbar.right-menu.width,viewport.width-menu.width-EDGE_GAP)),top:down?toolbar.bottom+gap:toolbar.top-gap-maxHeight,maxHeight};
}
