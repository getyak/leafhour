(async () => {
  const root = document.getElementById('marginalia-demo');
  const book = await window.marginaliaContentReady;
  const sample = book.isSample !== false;
  const chapters = book.chapters || [{id:book.chapterId,number:1,title:book.title}];
  const sectionChapter = section => section.chapterId || book.chapterId;
  const paragraphs = book.sections.flatMap(s => s.paragraphs.map(p => ({...p,section:s.number,chapterId:sectionChapter(s)})));
  const byId = new Map(paragraphs.map(p => [p.id,p]));
  const termsById = new Map(book.glossary.map(t => [t.id,t]));
  const notesById = new Map(book.annotations.map(n => [n.id,n]));
  const passages = root.querySelector('#mr-passages'),note = root.querySelector('#mr-note'),noteContent = root.querySelector('#mr-note-content'),variant = root.querySelector('#mr-variant');
  const storageKey = 'marginalia-full-book-reading-v1';
  const state = {version:2,chapterId:chapters[0].id,mode:'zh',variant:'interpretive',overrides:{},noteId:null,termId:null,font:21,leading:1.9,width:680,anchors:{}};
  let noteOpener = null,scrollSave = null;
  const el = (tag,cls,text) => {const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const button = (text,action,id) => {const b=el('button','cursor-interaction',text);b.type='button';b.dataset.action=action;if(id)b.dataset.id=id;return b;};
  const say = text => {root.querySelector('#mr-announcement').textContent=text;};
  const selectedChapter = () => chapters.find(c=>c.id===state.chapterId);
  function captureAnchor() {
    if(root.querySelector('.mr-layout').hidden || (root.dataset.roomPage && root.dataset.roomPage!=='reader'))return null;
    const nodes=[...passages.querySelectorAll('[data-unit]')];
    const threshold=Math.max(5,root.querySelector('.mr-top').getBoundingClientRect().bottom+8);
    const node=nodes.find(n=>n.getBoundingClientRect().bottom>threshold) || nodes[0];
    return node?{id:node.dataset.unit,offset:node.getBoundingClientRect().top}:null;
  }
  function restoreAnchor(anchor) {
    if(!anchor || !byId.has(anchor.id))return;
    const node=passages.querySelector('[data-unit="'+anchor.id+'"]');
    if(node)window.scrollBy(0,node.getBoundingClientRect().top-anchor.offset);
  }
  function remember(anchor=captureAnchor()) {
    if(anchor)state.anchors[state.chapterId]=anchor;
    try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}
    if(window.openai?.setWidgetState)window.openai.setWidgetState({modelContent:{mode:state.mode,variant:state.variant,chapter:state.chapterId},privateContent:{marginalia:{...state}}}).catch(()=>{});
  }
  function restore(saved) {
    const s=saved?.privateContent?.marginalia || saved;
    if(!s)return;
    if(chapters.some(c=>c.id===s.chapterId))state.chapterId=s.chapterId;
    if(['zh','en','parallel'].includes(s.mode))state.mode=s.mode;
    if(['literal','interpretive'].includes(s.variant))state.variant=s.variant;
    if(typeof s.font==='number')state.font=Math.max(18,Math.min(25,s.font));
    if(typeof s.leading==='number')state.leading=Math.max(1.6,Math.min(2.2,s.leading));
    if(typeof s.width==='number')state.width=Math.max(560,Math.min(720,s.width));
    for(const [id,v] of Object.entries(s.overrides||{}))if(byId.has(id)&&['zh','en'].includes(v))state.overrides[id]=v;
    for(const [id,a] of Object.entries(s.anchors||{}))if(chapters.some(c=>c.id===id)&&byId.get(a?.id)?.chapterId===id&&Number.isFinite(a.offset))state.anchors[id]=a;
  }
  function decorate(node,text,p,language) {
    if(language==='en'){node.textContent=text;return;}
    const terms=p.termIds.map(id=>termsById.get(id)).filter(t=>t&&t.zh&&!t.zh.includes('／')).sort((a,b)=>b.zh.length-a.zh.length);
    let remaining=text;
    while(remaining){let hit=null,at=remaining.length;for(const term of terms){const i=remaining.indexOf(term.zh);if(i>=0&&i<at){hit=term;at=i;}}if(!hit){node.append(document.createTextNode(remaining));break;}if(at)node.append(document.createTextNode(remaining.slice(0,at)));const b=button(hit.zh,'term',p.id);b.classList.add('mr-term');b.dataset.term=hit.id;b.setAttribute('aria-label',hit.zh+'，查看英文术语 '+hit.en);node.append(b);remaining=remaining.slice(at+hit.zh.length);}
  }
  function prose(p,language) {
    const n=el('p','mr-prose');n.lang=language==='en'?'en':'zh-Hans';n.dataset.paragraph=p.id;
    const text=language==='en'?p.original:p.translations[state.variant]?.text;
    decorate(n,text||'本段译文尚未完成。',p,language);return n;
  }
  function renderPassages() {
    if(passages.contains(note))root.querySelector('.mr-layout').append(note);
    passages.replaceChildren();
    for(const section of book.sections.filter(s=>sectionChapter(s)===state.chapterId)){
      const wrap=el('section');wrap.id='mr-section-'+section.number;
      const label=el('div','mr-section-label');label.append(el('span','','§'+section.number),el('span','mr-section-title',section.title?'导读 · '+section.title:''),el('span',''));wrap.append(label);
      for(const raw of section.paragraphs){const p=byId.get(raw.id),unit=el('div','mr-unit');unit.dataset.unit=p.id;if(state.noteId===p.id)unit.classList.add('is-active');const language=state.overrides[p.id]||(state.mode==='en'?'en':'zh');
        if(state.mode==='parallel'){const pair=el('div','mr-pair');for(const lang of ['en','zh']){const col=el('div');col.append(el('span','mr-pair-label',lang==='en'?'英文原文':state.variant==='literal'?'中文 · 直译':'中文 · 意译'),prose(p,lang));pair.append(col);}unit.append(pair);}else unit.append(prose(p,language));
        const actions=el('div','mr-unit-actions');if(state.mode!=='parallel')actions.append(el('span','mr-language-label',language==='en'?'英文原文':state.variant==='literal'?'中文 · 直译':'中文 · 意译'),button(language==='en'?'返回中文':'查看原文','flip',p.id));
        if(p.annotationIds.length){const b=button('注解 '+p.annotationIds.length,'notes',p.id);b.setAttribute('aria-expanded',String(state.noteId===p.id));actions.append(b);}
        actions.append(el('span','mr-source-page','原书 '+p.source.printedPage+' 页'));
        unit.append(actions);wrap.append(unit);
      }passages.append(wrap);
    }
    root.dispatchEvent(new CustomEvent('marginalia:rendered'));
  }
  function renderNote() {
    const p=byId.get(state.noteId),mount=p&&root.clientWidth<=900?root.querySelector('[data-unit="'+p.id+'"]'):root.querySelector('.mr-layout');if(mount&&note.parentNode!==mount)mount.append(note);
    root.classList.toggle('notes-open',!!p);note.hidden=!p;noteContent.replaceChildren();
    for(const unit of root.querySelectorAll('.mr-unit'))unit.classList.toggle('is-active',unit.dataset.unit===state.noteId);
    for(const b of root.querySelectorAll('[data-action=notes]'))b.setAttribute('aria-expanded',String(b.dataset.id===state.noteId));if(!p)return;
    root.querySelector('#mr-note-label').textContent='旁注 · §'+p.section;
    const addTerm=t=>{const block=el('section','mr-note-block');block.append(el('span','mr-note-kind','关键术语 · 编辑补充'),el('h3','',t.zh),el('p','mr-term-en',t.en),el('p','',t.definition));noteContent.append(block);};
    if(state.termId){const t=termsById.get(state.termId);if(t)addTerm(t);noteContent.append(button('查看本段注解','notes',p.id));return;}
    for(const id of p.annotationIds){const n=notesById.get(id);if(!n)continue;const block=el('section','mr-note-block'),kind={difficulty:'理解难点',paradox:'悖论',example:'生活例子',context:'背景',cross_reference:'关联段落',term:'术语'}[n.kind]||'注解';block.append(el('span','mr-note-kind',kind+' · '+(n.attribution==='editorial'?'编辑补充':'原书注释')),el('h3','',n.title),el('p','',n.text));noteContent.append(block);}
    noteContent.append(el('p','mr-note-kind mr-terms-title','本段关键英文'));const links=el('div','mr-term-links');for(const id of p.termIds){const t=termsById.get(id);if(t){const b=button(t.zh+' · '+t.en,'term',p.id);b.dataset.term=t.id;links.append(b);}}noteContent.append(links);
  }
  const chapterChoice=el('select');chapterChoice.id='mr-chapter';chapterChoice.setAttribute('aria-label','选择章节');for(const c of chapters)chapterChoice.append(new Option(c.number+' · '+c.title.zh,c.id));
  const chapterLabel=el('label','','章节 ');chapterLabel.htmlFor='mr-chapter';chapterLabel.append(chapterChoice);root.querySelector('.mr-reading-options').prepend(chapterLabel);
  const chapterNav=el('div','mr-chapter-nav');const previous=button('上一章','previous-chapter'),next=button('下一章','next-chapter');const chapterState=el('span','mr-language-label');chapterNav.append(previous,chapterState,next);root.querySelector('.mr-footer').before(chapterNav);
  const toc=root.querySelector('.mr-toc');
  function renderToc(){toc.replaceChildren(el('p','mr-toc-label','有限与无限的游戏'));for(const c of chapters){const b=button(c.number+'　'+c.title.zh,'chapter',c.id);if(c.id===state.chapterId)b.setAttribute('aria-current','location');toc.append(b);if(c.id===state.chapterId)for(const s of book.sections.filter(s=>sectionChapter(s)===c.id)){const sb=button('§'+s.number+'　'+(s.title||''),'section',String(s.number));sb.classList.add('mr-sub');toc.append(sb);}}toc.append(el('small','',sample?'当前仅有四段设计样本。全书阅读包尚未加载。':'全书 '+book.sections.length+' 节 · 双译初稿。注解均为编辑补充。'));}
  function apply(){
    const c=selectedChapter();root.dataset.mode=state.mode;root.dataset.chapter=state.chapterId;
    root.style.setProperty('--mr-font',state.font+'px');root.style.setProperty('--mr-leading',state.leading);root.style.setProperty('--mr-width',state.width+'px');variant.value=state.variant;variant.disabled=state.mode==='en';chapterChoice.value=state.chapterId;
    root.querySelector('#mr-font').value=state.font;root.querySelector('#mr-font-value').value=state.font;root.querySelector('#mr-leading').value=state.leading;root.querySelector('#mr-leading-value').value=state.leading.toFixed(1);
    for(const b of root.querySelectorAll('.mr-modes button'))b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode));
    root.querySelector('#mr-hint').textContent=state.mode==='parallel'?'同段原文与译文逐段对齐。':state.mode==='en'?'轻点正文看中文，再点返回。':'轻点正文看原文，再点返回。';
    root.querySelector('.mr-eyebrow').textContent='James P. Carse　／　第 '+c.number+' 章';root.querySelector('h1').textContent=c.title.zh;root.querySelector('.mr-en-title').textContent=c.title.en;
    const idx=chapters.indexOf(c);previous.disabled=idx===0;next.disabled=idx===chapters.length-1;chapterState.textContent=(idx+1)+' / '+chapters.length+' 章';
    const footer=root.querySelector('.mr-footer');footer.replaceChildren(el('span','',sample?'四段设计样本 · 译文待复核':'全章双译初稿 · 未经本人复核；英文 OCR 状态见来源记录。'),el('span','',c.sectionStart?'§'+c.sectionStart+'—'+c.sectionEnd:''));
    root.querySelector('.mr-bottom').lastElementChild.textContent=sample?'阅读设计小样 · §1—2':'七章完整阅读包 · 101节';
    renderToc();renderPassages();renderNote();
  }
  function changeChapter(id,target=null){
    if(!chapters.some(c=>c.id===id))return;
    const old=captureAnchor();if(old)state.anchors[state.chapterId]=old;
    state.chapterId=id;state.noteId=null;state.termId=null;root.classList.remove('show-toc');root.dispatchEvent(new CustomEvent('marginalia:chapter-change'));
    apply();const anchor=target?{id:target,offset:root.querySelector('.mr-top').getBoundingClientRect().bottom+24}:state.anchors[id];if(anchor)restoreAnchor(anchor);else root.querySelector('h1').scrollIntoView({block:'start'});remember();say('已进入第 '+selectedChapter().number+' 章。');
  }
  function flip(id){if(state.mode==='parallel')return;const anchor=captureAnchor(),current=state.overrides[id]||(state.mode==='en'?'en':'zh');state.overrides[id]=current==='en'?'zh':'en';renderPassages();renderNote();restoreAnchor(anchor);say(current==='en'?'已显示本段中文译文。':'已显示本段英文原文。');remember(anchor);root.querySelector('[data-action=flip][data-id="'+id+'"]')?.focus({preventScroll:true});}
  root.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b){const action=b.dataset.action;if(action==='flip')flip(b.dataset.id);else if(action==='chapter')changeChapter(b.dataset.id);else if(action==='section'){const section=book.sections.find(s=>s.number===Number(b.dataset.id));if(section){changeChapter(sectionChapter(section),section.paragraphs[0].id);}}else if(action==='previous-chapter'||action==='next-chapter'){const idx=chapters.findIndex(c=>c.id===state.chapterId)+(action==='next-chapter'?1:-1);if(chapters[idx])changeChapter(chapters[idx].id);}else{noteOpener={id:b.dataset.id,term:b.dataset.term,action};state.noteId=b.dataset.id;state.termId=action==='term'?b.dataset.term:null;renderNote();remember();}return;}if(e.target.closest('button,a,input,select'))return;const p=e.target.closest('[data-paragraph]');if(p&&!window.getSelection()?.toString())flip(p.dataset.paragraph);});
  for(const b of root.querySelectorAll('.mr-modes button'))b.addEventListener('click',()=>{const a=captureAnchor();state.mode=b.dataset.mode;state.overrides={};apply();restoreAnchor(a);remember(a);});
  variant.addEventListener('change',()=>{const a=captureAnchor();state.variant=variant.value;renderPassages();renderNote();restoreAnchor(a);remember(a);});chapterChoice.addEventListener('change',()=>changeChapter(chapterChoice.value));
  root.querySelector('#mr-note-close').addEventListener('click',()=>{state.noteId=null;state.termId=null;renderNote();if(noteOpener){const q='[data-action="'+noteOpener.action+'"][data-id="'+noteOpener.id+'"]'+(noteOpener.term?'[data-term="'+noteOpener.term+'"]':'');root.querySelector(q)?.focus({preventScroll:true});}remember();});
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.noteId)root.querySelector('#mr-note-close').click();});
  root.querySelector('#mr-settings-toggle').addEventListener('click',e=>{const s=root.querySelector('#mr-settings');s.hidden=!s.hidden;e.currentTarget.setAttribute('aria-expanded',String(!s.hidden));});
  root.querySelector('#mr-toc-toggle').addEventListener('click',e=>{root.classList.toggle(root.clientWidth<=720?'show-toc':'is-focus');e.currentTarget.setAttribute('aria-pressed',String(root.classList.contains('show-toc')||root.classList.contains('is-focus')));});
  for(const key of ['font','leading'])root.querySelector('#mr-'+key).addEventListener('input',e=>{const a=captureAnchor();state[key]=Number(e.target.value);apply();restoreAnchor(a);remember(a);});
  try{restore(JSON.parse(localStorage.getItem(storageKey)||'null'));}catch{}restore(window.openai?.widgetState);apply();
  const savedAnchor=state.anchors[state.chapterId];if(savedAnchor)requestAnimationFrame(()=>restoreAnchor(savedAnchor));
  window.addEventListener('scroll',()=>{clearTimeout(scrollSave);scrollSave=setTimeout(()=>remember(),250);},{passive:true});
  window.addEventListener('pagehide',()=>remember());window.addEventListener('openai:set_globals',e=>{if(e.detail?.globals?.widgetState){restore(e.detail.globals.widgetState);apply();}});
  new ResizeObserver(()=>renderNote()).observe(root);
  window.MarginaliaReader={book,jumpTo(id){const p=byId.get(id);if(p)changeChapter(p.chapterId,id);},savePosition(){remember();},resumePosition(){restoreAnchor(state.anchors[state.chapterId]);},currentAnchor(){return captureAnchor()?.id||book.sections.find(s=>sectionChapter(s)===state.chapterId)?.paragraphs[0]?.id;},chapterId(){return state.chapterId;}};
  root.dispatchEvent(new CustomEvent('marginalia:ready'));
})();
