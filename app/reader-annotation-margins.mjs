// Presentation only: reading, hiding and arranging saved annotations never write
// records, move the reading anchor or request a model response.
export function annotationRails({left,right,viewport,paginated=false,blocked=[]}){
 const fits=(start,end)=>end-start>=204&&!blocked.some(r=>r.left<end&&r.right>start);
 if(paginated)return [];
 const rails=[];
 if(fits(24,left-24))rails.push({side:'left',left:Math.max(24,left-280),width:Math.min(256,left-48)});
 if(fits(right+24,viewport-24))rails.push({side:'right',left:right+24,width:Math.min(256,viewport-right-48)});
 return rails;
}
export function arrangeMarginNotes(entries,rails,{gap=14,height=126}={}){
 const bottoms=rails.map(()=>-Infinity);
 return entries.map((entry,index)=>{
  if(!rails.length)return {...entry,side:'compact'};
  const costs=rails.map((rail,i)=>Math.max(entry.top,bottoms[i]+gap));let column=index%rails.length;
  for(let i=0;i<costs.length;i++)if(costs[i]<costs[column])column=i;
  const top=costs[column];bottoms[column]=top+height;return {...entry,...rails[column],top};
 });
}
export function mountAnnotationMargins({document,storage,getScope,getEntries,onOpen,onHide,onRetry,write}){
 const view=document.defaultView,nodes=new Map(),listeners=[];
 let scope=null,visible=true,disposed=false,frame=null,active=null,loadingTimer=null;
 const region=document.createElement('aside');region.id='reader-annotation-margins';region.className='reader-annotation-margins';write(region,'title','aria-label');
 const toggle=document.createElement('button');toggle.id='reader-annotations-toggle';toggle.type='button';toggle.className='reader-annotations-toggle';toggle.setAttribute('aria-controls',region.id);write(toggle,'title');
 const status=document.createElement('span');status.className='reader-annotation-load-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const controls=document.createElement('div');controls.className='reader-annotation-controls';controls.append(toggle,status);
 const key=()=> 'marginalia-annotation-visible-v1|'+scope;
 const listen=(target,event,fn,options)=>{target?.addEventListener(event,fn,options);listeners.push(()=>target?.removeEventListener(event,fn,options));};
 function reset(){
  const next=getScope();if(next===scope)return;scope=next;active=null;
  for(const node of nodes.values())node.remove();nodes.clear();region.remove();controls.remove();visible=true;
  try{visible=storage?.getItem(key())!=='false';}catch{}
  if(scope){document.body.append(region);(document.getElementById('reading-tools-panel')||document.body).append(controls);document.body.dataset.annotationsState='pending';}
  else{delete document.body.dataset.annotationsState;delete document.body.dataset.annotationsVisible;}
  sync();
 }
 function sync(){
  toggle.setAttribute('aria-pressed',String(visible));write(toggle,visible?'hide':'show','aria-label');region.hidden=!visible;document.body.dataset.annotationsVisible=String(visible);
  for(const node of nodes.values())node.hidden=!visible;
 }
 function rails(){
  const text=document.getElementById('reading-pages')||document.getElementById('chapter-text');if(!text)return [];
  const rect=text.getBoundingClientRect();
  const blocked=[...document.querySelectorAll('.library-chat-dialog:not([hidden]),.note-panel:not([hidden])')].map(n=>n.getBoundingClientRect()).filter(r=>r.width&&r.height);
  return annotationRails({left:rect.left,right:rect.right,viewport:view.innerWidth,paginated:document.body.dataset.paginated==='true',blocked});
 }
 function rectFor(id){
  const passage=document.getElementById(id);if(!passage)return null;
  const rect=[...passage.getClientRects()].find(r=>r.right>0&&r.left<view.innerWidth&&r.bottom>0&&r.top<view.innerHeight);
  return rect||(document.body.dataset.paginated==='true'?null:passage.getBoundingClientRect());
 }
 function refresh(){
  if(disposed)return;reset();if(!scope)return;const entries=getEntries(),wanted=new Set(entries.map(e=>e.id));
  for(const [id,node]of nodes)if(!wanted.has(id)){node.remove();nodes.delete(id);}
  for(const entry of entries){
   let node=nodes.get(entry.id);
   if(!node){node=document.createElement('button');node.type='button';node.className='reader-annotation-summary reader-annotation-indicator';node.dataset.annotationThread=entry.id;node.dataset.annotationPassage=entry.passageId;node.addEventListener('click',event=>{event.stopPropagation();onOpen(entry.id,node);});region.append(node);nodes.set(entry.id,node);}
   const signature=JSON.stringify([entry.text,entry.origin,entry.quote]);
   if(node.dataset.summary!==signature){
    node.dataset.summary=signature;node.replaceChildren();const author=document.createElement('span');author.className='reader-annotation-summary-author';write(author,entry.origin==='user'?'personalSummary':'ai');
    const text=document.createElement('span');text.className='reader-annotation-summary-text';text.textContent=(entry.text||entry.quote||'').slice(0,280);author.id='reader-note-author-'+entry.id;text.id='reader-note-summary-'+entry.id;
    node.append(author,text);node.setAttribute('aria-labelledby',author.id+' '+text.id);
   }
   node.hidden=!visible;node.setAttribute('aria-expanded',String(active===entry.id));
  }
  layout();
 }
 function layout(){
  if(disposed||!scope)return;const entries=[];
  for(const [id,node]of nodes){const rect=rectFor(node.dataset.annotationPassage),nearby=rect&&rect.bottom>-view.innerHeight&&rect.top<view.innerHeight*2&&rect.right>0&&rect.left<view.innerWidth;node.hidden=!visible||!nearby;if(nearby)entries.push({id,top:rect.top+view.scrollY,rect});}
  const placements=arrangeMarginNotes(entries.sort((a,b)=>a.top-b.top),rails());let previousPassage=null;
  for(const entry of placements){
   const node=nodes.get(entry.id);node.dataset.side=entry.side;const passage=node.dataset.annotationPassage;
   if(entry.side==='compact'){node.hidden=!visible||previousPassage===passage;previousPassage=passage;node.style.left=Math.min(view.innerWidth-28,entry.rect.right+4)+'px';node.style.top=entry.rect.top+view.scrollY+'px';node.style.width='24px';}
   else{node.style.left=entry.left+'px';node.style.top=entry.top+'px';node.style.width=entry.width+'px';}
  }
 }
 function schedule(){if(frame!==null)return;frame=view.requestAnimationFrame(()=>{frame=null;layout();});}
 listen(toggle,'click',()=>{if(document.body.dataset.annotationsState==='error'){onRetry?.();return;}visible=!visible;try{storage?.setItem(key(),String(visible));}catch{}if(!visible)onHide();sync();layout();});
 listen(view,'scroll',schedule,{passive:true});listen(view,'resize',schedule);listen(view.visualViewport,'resize',schedule);
 for(const event of ['reader:layout','reader:content','reader:page'])listen(document,event,refresh);
 reset();
 return {refresh,reset,rails,rectFor,
  select(id){active=id;for(const [key,node]of nodes)node.setAttribute('aria-expanded',String(key===id));},
  reveal(){if(visible)return;visible=true;try{storage?.setItem(key(),'true');}catch{}sync();layout();},
  state(value){if(!scope||disposed)return;clearTimeout(loadingTimer);document.body.dataset.annotationsState=value;status.textContent='';if(value==='pending')loadingTimer=view.setTimeout(()=>{if(!disposed&&document.body.dataset.annotationsState==='pending')write(status,'loading');},600);else if(value==='error')write(status,'loadFailed');},
  dispose(){disposed=true;clearTimeout(loadingTimer);if(frame!==null)view.cancelAnimationFrame(frame);for(const off of listeners)off();region.remove();controls.remove();nodes.clear();delete document.body.dataset.annotationsState;delete document.body.dataset.annotationsVisible;}
 };
}
