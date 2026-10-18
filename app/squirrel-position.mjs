// Device-local placement. Moving the character never schedules model work.
const KEY='marginalia:squirrel-position:v1',GAP=8,MARGIN=12;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const bounds=window=>{const v=window?.visualViewport;return {left:(v?.offsetLeft||0)+MARGIN,top:(v?.offsetTop||0)+MARGIN,width:Math.max(0,(v?.width||window?.innerWidth||0)-MARGIN*2),height:Math.max(0,(v?.height||window?.innerHeight||0)-MARGIN*2)};};
// One clamp routine places any floating node near an anchor rect inside bounds.
const listeners=()=>{const held=[];const on=(node,name,fn,options)=>{node.addEventListener(name,fn,options);held.push(()=>node.removeEventListener(name,fn,options));};return {on,release(){for(const remove of held)remove();}};};
const placeNear=(node,r,b)=>{
 const above=Math.max(0,r.top-b.top-GAP),below=Math.max(0,b.top+b.height-r.bottom-GAP);node.style.maxHeight=Math.max(40,above,below)+'px';node.style.maxWidth=b.width+'px';
 const size=node.getBoundingClientRect(),under=above<size.height&&below>above,left=clamp(r.left+r.width/2<b.left+b.width/2?r.left:r.right-size.width,b.left,Math.max(b.left,b.left+b.width-size.width)),top=clamp(under?r.bottom+GAP:r.top-size.height-GAP,b.top,Math.max(b.top,b.top+b.height-size.height));
 Object.assign(node.style,{left:left+'px',top:top+'px',right:'auto',bottom:'auto'});node.classList.toggle('is-below',under);
};

export function mountSquirrelPosition({launcher,window=globalThis.window,storage=globalThis.localStorage}){
 if(!window?.addEventListener||typeof launcher?.setPointerCapture!=='function')return {attach:()=>()=>{},layout(){},dispose(){}};
 let position=null,drag=null,suppressClick=false;const held=listeners(),floating=new Set();
 try{const value=JSON.parse(storage?.getItem(KEY)||'null');if(value&&[value.x,value.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))position=value;}catch{}
 const listen=held.on;
 const place=(left,top)=>{Object.assign(launcher.style,{left:left+'px',top:top+'px',right:'auto',bottom:'auto'});};
 function normalized(left,top){const b=bounds(window),r=launcher.getBoundingClientRect();return {x:clamp((left-b.left)/Math.max(1,b.width-r.width),0,1),y:clamp((top-b.top)/Math.max(1,b.height-r.height),0,1)};}
 function bubbles(){const b=bounds(window),r=launcher.getBoundingClientRect();for(const node of floating)if(!node.hidden)placeNear(node,r,b);}
 function layout(){
  const b=bounds(window);if(!position)for(const key of ['left','top','right','bottom'])launcher.style.removeProperty(key);
  const r=launcher.getBoundingClientRect(),left=position?b.left+position.x*Math.max(0,b.width-r.width):clamp(r.left,b.left,Math.max(b.left,b.left+b.width-r.width)),top=position?b.top+position.y*Math.max(0,b.height-r.height):clamp(r.top,b.top,Math.max(b.top,b.top+b.height-r.height));
  if(position||left!==r.left||top!==r.top)place(left,top);bubbles();
 }
 const save=()=>{try{storage?.setItem(KEY,JSON.stringify(position));}catch{}};
 function end(cancelled=false){
  const current=drag;if(!current)return;drag=null;delete launcher.dataset.dragging;
  if(current.moved){suppressClick=true;if(cancelled)position=current.before;else save();layout();}
  try{launcher.releasePointerCapture(current.id);}catch{}
 }
 listen(launcher,'pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||drag)return;suppressClick=false;const r=launcher.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top,before:position,moved:false};
  try{launcher.setPointerCapture(event.pointerId);}catch{drag=null;}
 });
 listen(launcher,'pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<6)return;
  drag.moved=true;launcher.dataset.dragging='true';event.preventDefault();position=normalized(drag.left+dx,drag.top+dy);layout();
 });
 listen(launcher,'pointerup',event=>{if(drag?.id===event.pointerId)end();});
 for(const name of ['pointercancel','lostpointercapture'])listen(launcher,name,event=>{if(drag?.id===event.pointerId)end(true);});
 listen(launcher,'click',event=>{if(suppressClick&&event.detail!==0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 listen(launcher,'keydown',event=>{
  if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();end(true);return;}
  const moves={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};if(!event.altKey||!moves[event.key])return;
  event.preventDefault();event.stopPropagation();const r=launcher.getBoundingClientRect(),[x,y]=moves[event.key];position=normalized(r.left+x,r.top+y);layout();save();
 });
 const resized=()=>{if(drag)end(true);layout();};listen(window,'resize',resized);listen(window,'blur',()=>end(true));
 if(window.visualViewport)for(const name of ['resize','scroll'])listen(window.visualViewport,name,resized);
 launcher.setAttribute('aria-description','可拖动调整位置，也可按住 Alt 并使用方向键移动。');launcher.setAttribute('title','阅读对话 · 可拖动调整位置');layout();
 return {attach(node){floating.add(node);layout();return ()=>floating.delete(node);},layout,dispose(){end(true);held.release();floating.clear();}};
}
