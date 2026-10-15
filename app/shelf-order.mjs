// Whole-shelf ordering shared by pointer, touch and keyboard controls.
export function moveShelfBook(ids,source,target,side='before'){
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||!ids.includes(source)||!ids.includes(target)||!['before','after'].includes(side))throw Error('书架刚刚有变化，请重新拖动。');
  if(source===target)return [...ids];const next=ids.filter(id=>id!==source),index=next.indexOf(target);next.splice(index+(side==='after'?1:0),0,source);return next;
}

export function mountShelfDrag({grid,getBooks,getOwner,onReorder,onError=()=>{}}){
  let drag=null;
  const cards=()=>[...grid.querySelectorAll('.book-card[data-book-id]')];
  function reset(){
    if(drag?.frame)cancelAnimationFrame(drag.frame);drag?.ghost?.remove();for(const card of cards()){card.classList.remove('is-dragging','is-drop-target');delete card.dataset.dropSide;}drag=null;grid.classList.remove('is-sorting');
  }
  function targetAt(x,y){
    const bounds=grid.getBoundingClientRect();if(x<bounds.left-15||x>bounds.right+15||y<bounds.top-30||y>bounds.bottom+30)return null;
    const hit=document.elementFromPoint(x,y)?.closest('.book-card[data-book-id]');if(hit&&grid.contains(hit))return hit;
    return cards().reduce((best,card)=>{const r=card.getBoundingClientRect(),distance=Math.hypot(x-(r.left+r.width/2),y-Math.max(r.top,Math.min(r.bottom,y)));return !best||distance<best.distance?{card,distance}:best;},null)?.card||null;
  }
  function over(x,y){
    if(!drag)return;drag.x=x;drag.y=y;const target=targetAt(x,y);for(const card of cards()){card.classList.remove('is-drop-target');delete card.dataset.dropSide;}
    drag.target=target?.dataset.bookId||null;if(!target||drag.target===drag.id)return;const r=target.getBoundingClientRect();drag.side=x<r.left+r.width/2?'before':'after';target.classList.add('is-drop-target');target.dataset.dropSide=drag.side;
  }
  function begin(card){reset();drag={id:card.dataset.bookId,owner:getOwner(),target:null,side:'before'};card.classList.add('is-dragging');grid.classList.add('is-sorting');}
  async function finish(){
    if(!drag)return;const {id,target,side,owner}=drag;reset();if(!target||target===id||owner!==getOwner())return;
    try{await onReorder(moveShelfBook(getBooks().map(b=>b.bookId),id,target,side));}catch(error){onError(error);}
  }
  grid.addEventListener('dragstart',event=>{
    const art=event.target.closest('.book-art'),card=art?.closest('.book-card[data-book-id]');if(!card||!grid.contains(card)||event.target.closest('button')){event.preventDefault();return;}
    begin(card);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-page-by-page-book',drag.id);const cover=card.querySelector('.book-cover');event.dataTransfer.setDragImage(cover,cover.offsetWidth/2,cover.offsetHeight/2);
  });
  grid.addEventListener('dragover',event=>{if(!drag||drag.pointer!==undefined)return;event.preventDefault();event.dataTransfer.dropEffect='move';over(event.clientX,event.clientY);});
  grid.addEventListener('drop',event=>{if(!drag)return;event.preventDefault();over(event.clientX,event.clientY);finish();});
  grid.addEventListener('dragend',reset);
  grid.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.book-drag-handle'),card=handle?.closest('.book-card[data-book-id]');if(!card||event.button!==0)return;
    event.preventDefault();begin(card);const cover=card.querySelector('.book-cover'),r=cover.getBoundingClientRect(),ghost=cover.cloneNode(true);ghost.classList.add('shelf-drag-ghost');ghost.setAttribute('aria-hidden','true');ghost.style.width=cover.offsetWidth+'px';ghost.style.height=cover.offsetHeight+'px';ghost.style.left=r.left+'px';ghost.style.top=r.top+'px';grid.append(ghost);
    Object.assign(drag,{ghost,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,left:r.left,top:r.top,x:event.clientX,y:event.clientY});handle.setPointerCapture(event.pointerId);
    const scroll=()=>{if(!drag||drag.pointer===undefined)return;const edge=65,speed=drag.y<edge?-8:drag.y>innerHeight-edge?8:0;if(speed){window.scrollBy(0,speed);over(drag.x,drag.y);}drag.frame=requestAnimationFrame(scroll);};drag.frame=requestAnimationFrame(scroll);
  });
  grid.addEventListener('pointermove',event=>{if(!drag||drag.pointer!==event.pointerId)return;event.preventDefault();drag.ghost.style.left=drag.left+event.clientX-drag.startX+'px';drag.ghost.style.top=drag.top+event.clientY-drag.startY+'px';over(event.clientX,event.clientY);});
  grid.addEventListener('pointerup',event=>{if(!drag||drag.pointer!==event.pointerId)return;event.preventDefault();over(event.clientX,event.clientY);finish();});
  grid.addEventListener('pointercancel',reset);grid.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();reset();}});window.addEventListener('blur',reset);
  function decorate(card){const art=card.querySelector('.book-art');if(art)art.draggable=true;}
  return {decorate,reset};
}
