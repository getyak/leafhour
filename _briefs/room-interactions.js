(async () => {
  const root=document.getElementById('marginalia-demo');
  const book=await window.marginaliaContentReady;
  const paragraphs=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,section:s.number,chapterId:s.chapterId||book.chapterId})));
  const validIds=new Set(paragraphs.map(p=>p.id));
  const legacyIds=new Set(['fig-1986-s001-p001','fig-1986-s001-p002','fig-1986-s002-p001','fig-1986-s002-p002']);
  const acceptedVersion=(version,id)=>version===book.contentVersion || (version==='design-sample-1' && (!id||legacyIds.has(id)));
  const layout=root.querySelector('.mr-layout');
  const panel=document.getElementById('room-personal');
  const pages={library:document.getElementById('room-library'),records:document.getElementById('room-records'),data:document.getElementById('room-data')};
  root.prepend(document.getElementById('room-nav'));
  for(const page of Object.values(pages))root.append(page);
  layout.append(panel);
  const controls=document.getElementById('room-reader-controls');controls.hidden=false;
  root.querySelector('.mr-reading-options').after(controls);
  const storeKey='marginalia-private-room-design-v1';
  const state={page:'reader',goal:'deep',comments:[],questions:[],sessions:[],pending:[],grants:{book:false,notes:false,time:false},daily:false,dailyTime:'20:30'};
  let activeId=null,activeKind='comment',lastOpener=null,running=false,elapsed=0,segmentElapsed=0,lastTick=0,segmentStart=null;
  const byId=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,action,id)=>{const b=el('button','room-link cursor-interaction',text);b.type='button';b.dataset.roomAction=action;if(id)b.dataset.id=id;return b;};
  const nextId=prefix=>prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  const tell=text=>{root.querySelector('#mr-announcement').textContent=text;};
  const persist=()=>{try{localStorage.setItem(storeKey,JSON.stringify(state));}catch{tell('当前预览无法持久保存，请导出记录保留。');}};
  try{const saved=JSON.parse(localStorage.getItem(storeKey)||'null');if(saved){for(const key of ['comments','questions','sessions','pending'])if(Array.isArray(saved[key]))state[key]=saved[key];if(['deep','language'].includes(saved.goal))state.goal=saved.goal;if(typeof saved.daily==='boolean')state.daily=saved.daily;if(/^\d\d:\d\d$/.test(saved.dailyTime||''))state.dailyTime=saved.dailyTime;for(const k of ['book','notes','time'])state.grants[k]=saved.grants?.[k]===true;}}catch{}
  function stopTimer(){
    if(!running)return;tick();running=false;
    if(segmentElapsed>0)state.sessions.push({id:nextId('focus'),bookId:book.bookId,startedAt:segmentStart,endedAt:new Date().toISOString(),durationSeconds:Math.round(segmentElapsed/1000),source:'design_preview_focus_timer'});
    segmentElapsed=0;byId('room-timer-toggle').textContent='继续';persist();
  }
  function tick(){
    if(running){const now=performance.now(),delta=Math.min(5000,Math.max(0,now-lastTick));lastTick=now;elapsed+=delta;segmentElapsed+=delta;}
    const sec=Math.floor(elapsed/1000);byId('room-elapsed').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
  }
  function showPage(page){
    if(state.page==='reader' && page!=='reader')window.MarginaliaReader?.savePosition();
    if(page!=='reader')stopTimer();
    state.page=page;root.dataset.roomPage=page;
    for(const [name,node] of Object.entries(pages))node.hidden=name!==page;
    if(page==='records')renderRecords();if(page==='data')renderData();if(page==='library')renderPending();
    if(page!=='reader')closePanel(false);tell('已打开'+({library:'我的书房',reader:'书内阅读',records:'我的记录',data:'数据与 Agent'}[page]));
    if(page==='reader')window.MarginaliaReader?.resumePosition();
  }
  function mountPanel(){const target=activeId && root.clientWidth<=900 ? root.querySelector('[data-unit="'+activeId+'"]') : layout;if(target && panel.parentNode!==target)target.append(panel);}
  function closePanel(focus=true){const id=activeId,kind=activeKind;activeId=null;panel.hidden=true;root.classList.remove('room-personal-open');for(const unit of root.querySelectorAll('.mr-unit'))unit.classList.remove('room-active');if(panel.parentNode!==layout)layout.append(panel);if(focus){const opener=lastOpener?.isConnected?lastOpener:root.querySelector('[data-room-action="'+kind+'"][data-id="'+id+'"]');opener?.focus({preventScroll:true});}}
  function openPanel(id,kind,opener){
    if(!validIds.has(id))return;
    if(root.classList.contains('notes-open'))byId('mr-note-close').click();
    activeId=id;activeKind=kind;lastOpener=opener;panel.hidden=false;root.classList.add('room-personal-open');mountPanel();for(const unit of root.querySelectorAll('.mr-unit'))unit.classList.toggle('room-active',unit.dataset.unit===activeId);
    const p=paragraphs.find(p=>p.id===id);byId('room-personal-title').textContent=kind==='comment'?'我的评论':'继续追问';byId('room-anchor-label').textContent='第 '+(book.chapters?.find(c=>c.id===p.chapterId)?.number||1)+' 章 · §'+p.section+' · 原书第 '+p.source.printedPage+' 页';
    byId('room-comment-composer').hidden=kind!=='comment';byId('room-question-composer').hidden=kind!=='question';byId('room-answer-example').hidden=true;byId('room-composer-message').textContent='';renderPanelRecords();
  }
  function recordNode(record,type){
    const row=el('article','room-record');row.append(el('span','room-record-meta',type==='comment'?'我的评论 · 仅自己可见':'我的问题 · 尚未解决'),el('p','',record.text));
    const actions=el('div','room-actions');actions.append(button('回到原文','anchor',record.passageId),button('删除这条记录',type==='comment'?'delete-comment':'delete-question',record.id));row.append(actions);return row;
  }
  function renderPanelRecords(){const container=byId('room-personal-records');container.replaceChildren();const collection=activeKind==='comment'?state.comments:state.questions;for(const r of collection.filter(r=>r.passageId===activeId))container.append(recordNode(r,activeKind));}
  function renderRecords(){const container=byId('room-records-list');container.replaceChildren();if(!state.comments.length && !state.questions.length)container.append(el('p','room-muted','还没有个人记录。在正文旁边留下一条自己的评论或问题。'));for(const r of state.comments)container.append(recordNode(r,'comment'));for(const r of state.questions)container.append(recordNode(r,'question'));}
  function renderPending(){const container=byId('room-pending-uploads');container.replaceChildren();for(const p of state.pending){const row=el('div','room-record');row.append(el('p','',p.name),el('span','room-record-meta','已选择文件 · 等待正式应用解析'));container.append(row);}}
  function renderShare(){const r=state.comments.find(r=>r.id===byId('room-share-choice').value),p=paragraphs.find(p=>p.id===r?.passageId);byId('room-share-text').value=r?'《有限与无限的游戏》\n'+r.passageId+' · 原书第 '+(p?.source.printedPage||'待核')+' 页\n\n我的评论：\n'+r.text:'';}
  function renderData(){
    const choice=byId('room-share-choice'),selected=choice.value;choice.replaceChildren();choice.append(new Option('选择一条自己的评论',''));for(const r of state.comments)choice.append(new Option(r.text.slice(0,35)+(r.text.length>35?'…':''),r.id));if(state.comments.some(r=>r.id===selected))choice.value=selected;renderShare();
    for(const key of ['book','notes','time'])byId('room-grant-'+key).checked=state.grants[key];byId('room-daily').checked=state.daily;byId('room-daily-time').value=state.dailyTime;
  }
  function exportRecords(){
    stopTimer();
    const payload={kind:'marginalia-personal-records',schemaVersion:1,bookId:book.bookId,contentVersion:book.contentVersion,comments:state.comments,questions:state.questions,readingSessions:state.sessions};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='marginalia-my-records.json';root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('已准备记录下载，包含本书的个人评论、问题与专注时段。');
  }
  function enhance(){
    if(!panel.isConnected && activeId)mountPanel();
    for(const unit of root.querySelectorAll('.mr-unit')){unit.classList.toggle('room-active',unit.dataset.unit===activeId);const actions=unit.querySelector('.mr-unit-actions');if(!actions || actions.querySelector('[data-room-action=comment]'))continue;actions.append(button('我的评论','comment',unit.dataset.unit),button('追问','question',unit.dataset.unit));}
  }
  let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhance();});});observer.observe(root.querySelector('#mr-passages'),{childList:true,subtree:true});
  root.addEventListener('click',e=>{
    const page=e.target.closest('button[data-room-page]');if(page){showPage(page.dataset.roomPage);return;}
    const b=e.target.closest('[data-room-action]');if(!b)return;
    const {roomAction:action,id}=b.dataset;
    if(action==='comment' || action==='question')openPanel(id,action,b);
    if(action==='anchor'){showPage('reader');window.MarginaliaReader?.jumpTo(id);root.querySelector('[data-unit="'+id+'"]')?.scrollIntoView({behavior:'auto',block:'start'});}
    if(action==='delete-comment' || action==='delete-question'){const key=action==='delete-comment'?'comments':'questions';state[key]=state[key].filter(r=>r.id!==id);persist();renderRecords();renderPanelRecords();renderData();tell('已删除选中的个人记录。');}
  });
  root.addEventListener('click',e=>{if(e.target.closest('[data-action=notes],[data-action=term]'))closePanel(false);},true);
  byId('room-personal-close').addEventListener('click',()=>closePanel());
  root.addEventListener('keydown',e=>{if(e.key==='Escape' && activeId)closePanel();});
  byId('room-save-comment').addEventListener('click',()=>{
    const text=byId('room-comment').value.trim();if(!text || !activeId)return;
    state.comments.push({id:nextId('comment'),bookId:book.bookId,passageId:activeId,contentVersion:book.contentVersion,text,origin:'user',createdAt:new Date().toISOString()});byId('room-comment').value='';persist();renderPanelRecords();byId('room-composer-message').textContent='评论保留为你的原话，可以导出或选择分享。';
  });
  byId('room-save-question').addEventListener('click',()=>{
    const text=byId('room-question').value.trim();if(!text || !activeId)return;
    state.questions.push({id:nextId('question'),bookId:book.bookId,passageId:activeId,contentVersion:book.contentVersion,text,origin:'user',status:'open',createdAt:new Date().toISOString()});byId('room-question').value='';persist();renderPanelRecords();byId('room-composer-message').textContent='问题已保留在对应段落；当前小样不会调用模型。';
  });
  byId('room-show-example').addEventListener('click',()=>{const p=paragraphs.find(p=>p.id===activeId),answer=byId('room-answer-example');answer.replaceChildren();const note=book.annotations.find(n=>p?.annotationIds.includes(n.id));answer.append(el('span','room-record-meta','回答示例 · 编辑旁注'),el('p','',note?note.text:'这段先说明有限游戏需要明确的终点。继续追问时，需要将当前段落与前后文一起核对。'),el('span','room-record-meta','引用：'+activeId+' · 原书第 3 页'));answer.hidden=false;});
  byId('room-goal').value=state.goal;
  byId('room-goal').addEventListener('change',e=>{state.goal=e.target.value;root.querySelector('.mr-modes [data-mode="'+(state.goal==='language'?'en':'zh')+'"]').click();persist();});
  byId('room-timer-toggle').addEventListener('click',()=>{if(running){stopTimer();return;}running=true;segmentStart=new Date().toISOString();segmentElapsed=0;lastTick=performance.now();byId('room-timer-toggle').textContent='暂停';});
  const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return;}tick();},1000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTimer();});window.addEventListener('blur',()=>stopTimer());
  byId('room-book-file').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;const ext=file.name.split('.').pop().toLowerCase();if(!['pdf','epub','txt','md'].includes(ext)){byId('room-book-status').textContent='请选择支持的书籍格式。';return;}state.pending.push({name:file.name,size:file.size});persist();byId('room-book-status').textContent='已选择 '+file.name+'。这份预览只展示导入入口，尚未解析或保存原件。';renderPending();});
  for(const id of ['room-export','room-export-records'])byId(id).addEventListener('click',exportRecords);
  byId('room-import-button').addEventListener('click',()=>byId('room-record-file').click());
  byId('room-record-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    byId('room-import-status').removeAttribute('role');
    try{
      if(file.size>2*1024*1024)throw new Error('记录包超出这份小样的大小限制。');
      const a=JSON.parse(await file.text());if(a.kind!=='marginalia-personal-records' || a.schemaVersion!==1 || a.bookId!==book.bookId || !acceptedVersion(a.contentVersion))throw new Error('请选择这本书兼容版本导出的记录包。');
      const clean=(xs,type)=>{if(!Array.isArray(xs) || xs.length>1000)throw new Error('记录数量或格式不正确。');return xs.map(r=>{if(typeof r.id!=='string' || !r.id || !validIds.has(r.passageId) || r.bookId!==book.bookId || !acceptedVersion(r.contentVersion,r.passageId) || typeof r.text!=='string' || !r.text.trim() || r.text.length>2000 || r.origin!=='user' || !Number.isFinite(Date.parse(r.createdAt)))throw new Error('有记录无法安全对应当前原文，未导入。');const out={id:r.id,bookId:r.bookId,passageId:r.passageId,contentVersion:r.contentVersion,text:r.text,origin:'user',createdAt:r.createdAt};if(type==='question')out.status='open';return out;});};
      const comments=clean(a.comments,'comment'),questions=clean(a.questions,'question');
      if(!Array.isArray(a.readingSessions) || a.readingSessions.length>1000)throw new Error('时段格式不正确。');
      const sessions=a.readingSessions.map(r=>{if(typeof r.id!=='string' || r.bookId!==book.bookId || !Number.isFinite(Date.parse(r.startedAt)) || !Number.isFinite(Date.parse(r.endedAt)) || !Number.isFinite(r.durationSeconds) || r.durationSeconds<0 || r.durationSeconds>86400 || r.source!=='design_preview_focus_timer')throw new Error('时段格式不正确。');return {id:r.id,bookId:r.bookId,startedAt:r.startedAt,endedAt:r.endedAt,durationSeconds:r.durationSeconds,source:r.source};});
      const merge=(old,incoming)=>{const map=new Map(old.map(r=>[r.id,r]));for(const r of incoming)if(!map.has(r.id))map.set(r.id,r);return [...map.values()];};
      state.comments=merge(state.comments,comments);state.questions=merge(state.questions,questions);state.sessions=merge(state.sessions,sessions);persist();renderData();byId('room-import-status').textContent='记录包已合并；重复 ID 不会重复导入。';
    }catch(error){byId('room-import-status').setAttribute('role','alert');byId('room-import-status').textContent=error.message || '记录包无法读取。';}finally{e.target.value='';}
  });
  byId('room-share-choice').addEventListener('change',renderShare);
  for(const k of ['book','notes','time'])byId('room-grant-'+k).addEventListener('change',e=>{state.grants[k]=e.target.checked;persist();});
  byId('room-daily').addEventListener('change',e=>{state.daily=e.target.checked;persist();byId('room-daily-status').textContent=state.daily?'已选择每天陪读的偏好；预览未连接 Agent，不发送消息。':'每天陪读已暂停。当前预览不创建日程或发送消息。';});
  byId('room-daily-time').addEventListener('change',e=>{state.dailyTime=e.target.value;persist();});
  new ResizeObserver(mountPanel).observe(root);
  const navigation=byId('room-nav');new ResizeObserver(()=>root.style.setProperty('--room-nav-height',navigation.getBoundingClientRect().height+'px')).observe(navigation);
  root.addEventListener('marginalia:chapter-change',()=>closePanel(false));
  root.addEventListener('marginalia:rendered',enhance);
  if(book.isSample===false){
    root.querySelector('.room-space').textContent='私人空间 · 全书双译初稿';
    const summary=byId('room-library').querySelector('.room-book .room-muted');summary.textContent=book.chapters.length+'章 · '+book.sections.length+'节 · '+paragraphs.length+'段正文';
    byId('room-library').querySelector(':scope > p:last-of-type').textContent='全书原文、两种译文与编辑注解已载入；译文为初稿，可逐段核对。';
    const downloads=el('div','room-actions');
    const choices=[['全书中英双译 Markdown','book-bilingual.md'],['中文意译','book-interpretive.md']];
    if(!window.marginaliaStandalone)choices.push(['离线阅读包','reading-pack.zip']);
    for(const [name,file] of choices){const a=el('a','room-secondary',name);a.href=(window.marginaliaStandalone?'./':'../local/finite-infinite-games/exports/')+file;a.download=file;downloads.append(a);}
    byId('room-library').append(downloads);
  }
  enhance();renderData();showPage('reader');
  if(state.goal==='language')root.querySelector('.mr-modes [data-mode=en]').click();
})();
