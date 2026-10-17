// Visibility is independent of the reading clock and never records activity.
export function createReadingToolbarState({onChange=()=>{}}={}) {
  let expanded=false,timer;
  const holds=new Set();
  function cancel(){clearTimeout(timer);timer=undefined;}
  function conceal(){cancel();if(!expanded)return;expanded=false;onChange(false);}
  function arm(){cancel();if(expanded&&!holds.size)timer=setTimeout(conceal,5000);}
  return {
    get expanded(){return expanded;},
    reveal(){if(!expanded){expanded=true;onChange(true);}arm();},
    conceal,
    hold(reason,value){if(holds.has(reason)===value)return;if(value)holds.add(reason);else holds.delete(reason);arm();}
  };
}

export function mountReadingToolbar(root) {
  const trigger=root.querySelector('#reading-tools-trigger'),panel=root.querySelector('#reading-tools-panel'),close=root.querySelector('#reading-tools-close'),label=root.querySelector('#reading-tools-label'),notice=root.querySelector('#reading-tools-notice');
  let keyboard=false,status='idle',attention=false,draftCount=0,hoverPreview=false;
  const toolbar=createReadingToolbarState({onChange(expanded){
    // Focus must never remain inside a concealed, inert panel.
    if(!expanded&&panel.contains(document.activeElement))trigger.focus({preventScroll:true});
    panel.inert=!expanded;
    panel.setAttribute('aria-hidden',String(!expanded));
    trigger.setAttribute('aria-expanded',String(expanded));
    root.dataset.expanded=String(expanded);
    if(!expanded)hoverPreview=false;
    updateLabel();
  }});
  function updateLabel(){
    label.textContent=attention?'待保存':status==='active'?'阅读中':'阅读';
    root.dataset.attention=String(attention);
    root.dataset.reading=status;
    const details=[status==='active'?'正在计时':status==='paused'?'计时已暂停':'',attention?'有记录等待保存':'',draftCount?draftCount+' 份本机草稿':''].filter(Boolean).join('，');
    trigger.setAttribute('aria-label',(toolbar.expanded?'阅读工具已展开':'展开阅读工具')+(details?'，'+details:''));
    trigger.title='阅读工具 · 靠近或轻触展开'+(details?' · '+details:'');
  }
  const focusHold=()=>toolbar.hold('keyboard',keyboard&&panel.contains(document.activeElement));
  trigger.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'&&!toolbar.expanded){hoverPreview=true;toolbar.reveal();}});
  root.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')toolbar.hold('pointer',true);});
  root.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse')toolbar.hold('pointer',false);});
  trigger.addEventListener('click',()=>{if(toolbar.expanded&&!hoverPreview)toolbar.conceal();else{hoverPreview=false;toolbar.reveal();}});
  panel.addEventListener('click',event=>{if(!event.target.closest('#reading-tools-close'))toolbar.reveal();});
  close.addEventListener('click',()=>toolbar.conceal());
  document.addEventListener('keydown',event=>{if(event.key==='Tab'){keyboard=true;focusHold();}},true);
  document.addEventListener('pointerdown',()=>{keyboard=false;focusHold();},true);
  root.addEventListener('focusin',focusHold);
  root.addEventListener('focusout',()=>queueMicrotask(focusHold));
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&toolbar.expanded){event.preventDefault();event.stopPropagation();toolbar.conceal();}
  });
  // Native dialogs return focus to their opener. Keep it available throughout.
  const dialogHold=()=>toolbar.hold('dialog',!!document.querySelector('dialog[open]'));
  // Audio creates its dialog after this toolbar mounts. Observe its lifetime as
  // well as open changes, including removal of a still-open dialog.
  new MutationObserver(dialogHold).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  dialogHold();
  updateLabel();
  return {update(values){
    if(values.status!==undefined)status=values.status;
    if(values.attention!==undefined&&values.attention!==attention){attention=values.attention;notice.textContent=attention?'有阅读记录等待保存，请展开阅读工具重试或另存。':'';}
    if(values.draftCount!==undefined)draftCount=values.draftCount;
    updateLabel();
  }};
}
