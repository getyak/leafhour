import {appearanceDefaults,appearanceBounds,normalizeAppearance} from './reading-preferences.mjs';
import {captureDOMSelection,paragraphSnapshot} from './share-model.mjs';
import {placeFloatingToolbar} from './toolbar-placement.mjs';
import {readerFetch,readerStorageKey,selectedBookId,readerSession} from './reader-api.mjs';
import {chooseReadingPosition,resolveReadingPosition,resumeSummary,acknowledgePosition,recoveredPositionNeedsChoice} from './reading-progress.mjs';
import {createProgressSync} from './progress-sync.mjs';
import {chineseOriginalOnly} from './source-language.mjs';
import {captureParagraphAnchor,paragraphScrollDelta} from './paragraph-anchor.mjs';
import {createNoteDrafts} from './note-drafts.mjs';
import {readerLoginUrl,resolveReaderEntry} from './reader-return.mjs';
import {passagePresentation,visibleQuoteLanguage} from './passage-layers.mjs';
import {catalogReadingMode,chineseSampleEntry} from './catalog-sample.mjs';
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const button=(text,action)=>{const b=el('button','',text);b.type='button';if(action)b.addEventListener('click',action);return b;};
const announce=text=>{$('announcement').textContent=text;};
let book,records,recordsUnavailable=false,paragraphs=[],paragraphMap=new Map(),notesMap=new Map(),termsMap=new Map(),selectedId=null,selectedQuote='',selectedQuoteLanguage='zh',selectedExcerpt=null,selectionKind='passage',panelTab='annotations',allRecords=false,persistTimer=null,overrides={};
let recordsRetryBusy=false,recordsRetryNotice='',recordsPositionUnresolved=false;
const state={chapterId:'ch01',mode:'zh',variant:'interpretive',...appearanceDefaults};
const draftKey=readerStorageKey('marginalia-focus-drafts-v2');let savedDrafts=null,legacyDrafts={};try{savedDrafts=JSON.parse(localStorage.getItem(draftKey)||'null');legacyDrafts=JSON.parse(localStorage.getItem(readerStorageKey('marginalia-focus-drafts-v1'))||'{}');}catch{}
const noteDrafts=createNoteDrafts(savedDrafts,legacyDrafts);
const persistDrafts=()=>{try{localStorage.setItem(draftKey,JSON.stringify(noteDrafts.snapshot()));return true;}catch{return false;}};
const api=async(url,data)=>{const response=await readerFetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||'暂时无法完成操作'),{status:response.status});return body;};
const progressKey=readerStorageKey('marginalia-focus-position-v1'),localWriterId=crypto.randomUUID();let progressSequence=0,restoringProgress=true,allowScrollSave=false;
const cachePosition=position=>{try{localStorage.setItem(progressKey,JSON.stringify(position));}catch{}};
const progressSync=createProgressSync({
  send:({localSequence,localWriterId,...position})=>api('/api/progress',position),
  beforeSend:position=>{if(position.localSequence===progressSequence)cachePosition({...position,pending:true});},
  onSaved:(saved,submitted)=>{try{const cached=JSON.parse(localStorage.getItem(progressKey)||'null'),next=acknowledgePosition(cached,saved,submitted);if(next)cachePosition({...next,chapterLabel:resumeSummary(book,next)?.label});}catch{}},
  onConflict:()=>{$('progress-notice').hidden=false;announce('阅读位置已在另一处更新。当前书页保留，请选择从哪里继续。');},
  onFailure:()=>announce('阅读位置暂未同步；本机浏览器保留当前位置。')
});
const currentChapter=()=>book.chapters.find(c=>c.id===state.chapterId);
const activeSections=()=>book.sections.filter(s=>s.chapterId===state.chapterId);
const chapterLabel=chapter=>book.source?.structure==='automatic_groups'?'自动分段 · 阅读片段 '+chapter.number:chapter.kind&&chapter.kind!=='body'?chapter.title.zh:'第 '+chapter.number+' 章';
function anchor(){
  const threshold=document.body.classList.contains('is-focused')?24:80;
  const node=[...$('chapter-text').querySelectorAll('.passage')].find(n=>n.getBoundingClientRect().bottom>threshold);
  return node?{passageId:node.dataset.id,...captureParagraphAnchor(node.getBoundingClientRect(),threshold)}:null;
}
function restoreAnchor(a){if(!a)return;const node=$('chapter-text').querySelector('[data-id="'+a.passageId+'"]'),threshold=document.body.classList.contains('is-focused')?24:80;if(node)window.scrollBy(0,paragraphScrollDelta(node.getBoundingClientRect(),a,threshold));}
function captureProgress(){
  if(!book||restoringProgress)return null;const a=anchor();if(!a)return null;
  return {...state,...a,contentVersion:book.contentVersion,baseRevision:progressSync.revision,localWriterId,localSequence:++progressSequence,chapterLabel:resumeSummary(book,{...state,...a})?.label};
}
function persist(){
  const position=captureProgress();if(!position)return;
  cachePosition({...position,pending:!!readerSession?.user||!selectedBookId});
  clearTimeout(persistTimer);if(!recordsUnavailable&&!recordsPositionUnresolved)persistTimer=setTimeout(()=>progressSync.save(position).catch(()=>{}),450);
}
const typographyFields=[['lineHeight','行高',''],['paragraphGap','段落间距','px'],['letterSpacing','字距','em'],['wordSpacing','英文词距','em'],['fontWeight','字重','']];
const fonts={song:'"Songti SC","STSong","Noto Serif CJK SC",serif',kai:'"Kaiti SC","STKaiti","KaiTi",serif',sans:'var(--interface)'};
const prettyValue=(key,value)=>['letterSpacing','wordSpacing'].includes(key)?value.toFixed(2):key==='lineHeight'?Number(value.toFixed(2)).toString():String(value);
function applyAppearance(){
  const night=state.theme==='night'||(state.theme==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.dataset.theme=state.theme==='system'?(night?'night':'paper'):state.theme;
  const page=$('book-page');page.style.setProperty('--size',state.font+'px');page.style.setProperty('--book',fonts[state.fontFamily]);page.style.setProperty('--english',state.fontFamily==='sans'?'var(--interface)':'Georgia,"Times New Roman",serif');
  for(const [key,property,unit] of [['lineHeight','--reading-line',''],['paragraphGap','--paragraph-gap','px'],['letterSpacing','--reading-tracking','em'],['wordSpacing','--word-spacing','em'],['fontWeight','--reading-weight','']])page.style.setProperty(property,state[key]+unit);
  page.style.setProperty('--reading-indent',state.indent?'2em':'0');document.body.dataset.mode=state.mode;
  $('view-mode').value=state.mode;$('translation-variant').value=state.variant;$('translation-variant').disabled=state.mode==='en';$('font-size').value=state.font;$('font-size-label').value=String(state.font);
  for(const b of document.querySelectorAll('[data-theme-choice]')){const active=b.dataset.themeChoice===state.theme;b.setAttribute('aria-pressed',String(active));if(active)$('theme-label').textContent=b.getAttribute('aria-label');}
  for(const b of document.querySelectorAll('[data-font-family]'))b.setAttribute('aria-pressed',String(b.dataset.fontFamily===state.fontFamily));
  for(const [key] of typographyFields){$('setting-'+key).value=prettyValue(key,state[key]);for(const b of document.querySelectorAll('[data-adjust="'+key+'"]'))b.disabled=Number(b.dataset.direction)<0?state[key]<=appearanceBounds[key][0]:state[key]>=appearanceBounds[key][1];}
  $('first-line-indent').checked=state.indent;
}
function adjustAppearance(patch){
  const a=anchor();Object.assign(state,normalizeAppearance({...state,...patch}));document.dispatchEvent(new CustomEvent('reader:jump'));applyAppearance();restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();persist();document.dispatchEvent(new CustomEvent('reader:layout'));
}
for(const [key,label,unit] of typographyFields){
  const row=el('div','setting-row typography-row'),name=el('span','',label),controls=el('div','type-stepper');name.id='label-'+key;
  const minus=button('−',()=>step(-1)),plus=button('+',()=>step(1)),value=el('output');value.id='setting-'+key;value.setAttribute('aria-labelledby',name.id);value.title=unit;
  function step(direction){const [min,max,increment]=appearanceBounds[key];adjustAppearance({[key]:Math.max(min,Math.min(max,Number((state[key]+direction*increment).toFixed(2))))});}
  for(const [b,direction] of [[minus,-1],[plus,1]]){b.dataset.adjust=key;b.dataset.direction=direction;b.setAttribute('aria-label',(direction<0?'减小':'增大')+label);}
  controls.append(minus,value,plus);row.append(name,controls);$('typography-controls').append(row);
}
function passageView(p){return {mode:overrides[p.id]?.mode||(state.mode==='en'?'en':'zh'),variant:overrides[p.id]?.variant||state.variant};}
function prose(layer,variant){if(layer.kind==='missing')return el('div','translation-placeholder',layer.message);const n=el('p',layer.fallback?'untranslated-original':'',layer.text);n.lang=layer.lang;n.dataset.readingLayer=layer.kind;n.dataset.variant=variant;return n;}
function fillPassage(node,p){
  if(node.contains($('note-panel')))document.body.append($('note-panel'));
  node.replaceChildren();const v=passageView(p),view=passagePresentation(p,{...v,mode:state.mode==='parallel'?'parallel':v.mode,sourceLanguage:book.sourceLanguage});
  if(state.mode==='parallel'){
    const pair=el('div','parallel-pair');for(const layer of view.layers){const column=el('div');column.append(el('span','pair-label',layer.label),prose(layer,v.variant));pair.append(column);}node.append(pair);
  }else node.append(prose(view.layers[0],v.variant));
  if(view.notice)node.append(el('span','translation-status',view.notice));
}
function renderChapter(){
  if($('chapter-text').contains($('note-panel')))document.body.append($('note-panel'));
  $('chapter-text').replaceChildren();const chapter=currentChapter();document.title=chapter.title.zh+' · 旁读';
  $('chapter-number').textContent=chapterLabel(chapter);$('chapter-title').textContent=chapter.title.zh;$('chapter-original-title').textContent=chapter.title.en;$('running-chapter').textContent=book.source?.structure==='automatic_groups'?'片段 '+chapter.number:chapterLabel(chapter);
  for(const s of activeSections()){
    const section=el('section','reading-section');section.id='section-'+s.number;if(book.source?.structure!=='source_chapters')section.append(el('p','section-number','§'+s.number));
    for(const raw of s.paragraphs){const p=paragraphMap.get(raw.id),node=el('div',p.kind==='source_heading'?'passage source-chapter-heading':'passage');node.id=p.id;node.dataset.id=p.id;node.tabIndex=0;node.setAttribute('aria-describedby','reading-instructions');fillPassage(node,p);section.append(node);if(p.id===book.chineseSample?.endPassageId){const end=el('aside','sample-boundary');end.append(el('strong','','中文试读到这里'),el('p','','以上 '+book.chineseSample.paragraphs+' 段已有独立直译与意译草稿。以下尚未翻译，可以继续阅读英文原文。'));section.append(end);}} $('chapter-text').append(section);
  }
  const index=book.chapters.findIndex(c=>c.id===chapter.id),bodyCount=book.chapters.filter(c=>c.kind==='body').length;
  $('chapter-heading').hidden=false;$('chapter-footer').hidden=false;$('chapter-fraction').textContent=chapter.kind==='body'?chapter.number+' / '+bodyCount:chapter.kind?chapter.title.zh:(index+1)+' / '+book.chapters.length;
  $('previous-chapter').disabled=index===0;$('next-chapter').disabled=index===book.chapters.length-1;
  renderToc();applyAppearance();document.dispatchEvent(new CustomEvent("reader:chapter",{detail:{chapterId:state.chapterId}}));
}
function renderToc(){
  const list=$('toc-list');list.replaceChildren();
  for(const chapter of book.chapters){
    const group=el('details');group.open=chapter.id===state.chapterId;const summary=el('summary','',(chapter.kind&&chapter.kind!=='body'?'':chapter.number+'　')+chapter.title.zh);group.append(summary);
    const start=button('从本章开始',()=>changeChapter(chapter.id));start.className='toc-chapter';group.append(start);const sections=el('div','toc-sections');
    for(const s of book.sections.filter(s=>s.chapterId===chapter.id))if(book.source?.structure==='source_chapters')sections.append(el('p','toc-source-title',chapter.title.en+' · '+s.paragraphs.length+' 段'));else sections.append(button('§'+s.number+'　'+s.title,()=>changeChapter(chapter.id,s.paragraphs[0].id)));
    group.append(sections);list.append(group);
  }
}
function changeChapter(id,target=null){
  if(!book.chapters.some(c=>c.id===id))return;persist();closePanel();dismissTools();state.chapterId=id;overrides={};selectedId=null;renderChapter();$('toc-dialog').close();
  target=target||(book.source?.structure==='source_chapters'?currentChapter().startPassageId:null);
  if(target){restoreAnchor({passageId:target,offset:document.body.classList.contains('is-focused')?45:160});}else window.scrollTo(0,0);
  persist();announce('已进入'+chapterLabel(currentChapter())+'。');
}
function dismissTools({preserveSelection=false}={}){
  $('paragraph-tools').hidden=true;$('paragraph-tools').dataset.excerpt='false';$('show-share').hidden=true;$('paragraph-more').hidden=true;$('more-actions').setAttribute('aria-expanded','false');
  if(!preserveSelection){clearPanelTextHighlight();selectionKind='passage';for(const node of $('chapter-text').querySelectorAll('.is-selected,.is-panel-anchor'))node.classList.remove('is-selected','is-panel-anchor');document.dispatchEvent(new CustomEvent('reader:selection-end'));}
}
function selectedRangeRect(){
  const selection=getSelection();if(!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
  const range=selection.getRangeAt(0),container=range.commonAncestorContainer.nodeType===Node.TEXT_NODE?range.commonAncestorContainer.parentElement:range.commonAncestorContainer;
  if(!container||!$('chapter-text').contains(container))return null;
  const rect=range.getBoundingClientRect();return rect.width||rect.height?rect:null;
}
function positionTools(){
  const tools=$('paragraph-tools'),id=tools.dataset.excerpt==='true'?selectedExcerpt?.parts.at(-1)?.passageId||selectedId:selectedId;
  const node=document.getElementById(id);if(!node)return;
  const nodeRect=node.getBoundingClientRect();tools.hidden=false;tools.inert=false;tools.style.visibility='hidden';tools.style.opacity='0';tools.style.maxWidth=Math.min(nodeRect.width,innerWidth-24)+'px';
  const rangeRect=tools.dataset.excerpt==='true'?selectedRangeRect():null,anchorRect=rangeRect||nodeRect;
  const header=document.body.classList.contains('is-focused')?0:$('reading-header').getBoundingClientRect().bottom;
  const placement=placeFloatingToolbar({anchor:anchorRect,fallbackAnchor:rangeRect?nodeRect:anchorRect,toolbar:{width:tools.offsetWidth,height:tools.offsetHeight},viewport:{width:innerWidth,height:innerHeight},headerBottom:header});
  tools.style.left=placement.left+'px';tools.style.top=placement.top+'px';tools.dataset.placement=placement.placement;tools.inert=!placement.visible;tools.setAttribute('aria-hidden',String(!placement.visible));tools.style.visibility=placement.visible?'visible':'hidden';tools.style.opacity=placement.visible?'1':'0';
}
function choosePassage(id,y=null,quote='',quoteLanguage=null){
  if(!paragraphMap.has(id))return;const p=paragraphMap.get(id),v=passageView(p);quoteLanguage=visibleQuoteLanguage(p,{...v,mode:state.mode==='parallel'?'parallel':v.mode},quoteLanguage);const node=$('chapter-text').querySelector('[data-id="'+id+'"]'),pin={passageId:id,offset:node.getBoundingClientRect().top};dismissTools();selectedId=id;selectedQuote=quote;selectedQuoteLanguage=quoteLanguage;selectionKind='passage';node.classList.add('is-selected');
  try{selectedExcerpt=paragraphSnapshot(book,p,state.chapterId,quoteLanguage,v.variant);}catch{selectedExcerpt=null;}$('show-share').hidden=true;$('paragraph-tools').dataset.excerpt='false';$('show-original').hidden=state.mode==='parallel'||chineseOriginalOnly(book);$('show-original').textContent=v.mode==='en'?'译文':'原文';$('show-annotations').hidden=!p.annotationIds.length&&!p.termIds.length;
  document.dispatchEvent(new CustomEvent("reader:selection",{detail:{passageId:id}}));positionTools();if(!$('note-panel').hidden&&!allRecords)renderPanel();restoreAnchor(pin);positionTools();
}
function mountPanel(){
  const panel=$('note-panel'),node=$('chapter-text').querySelector('[data-id="'+selectedId+'"]');
  const inline=innerWidth<1320||state.mode==='parallel';panel.classList.toggle('is-inline',inline);
  if(inline&&node)node.after(panel);else if(panel.parentNode!==document.body)document.body.append(panel);
}
function closePanel(){
  const a=anchor();$('note-panel').hidden=true;document.body.classList.remove('has-panel');clearPanelTextHighlight();for(const node of $('chapter-text').querySelectorAll('.is-selected,.is-panel-anchor'))node.classList.remove('is-selected','is-panel-anchor');if($('note-panel').parentNode!==document.body)document.body.append($('note-panel'));restoreAnchor(a);document.dispatchEvent(new CustomEvent('reader:selection-end'));
}
function recordNode(record,type,withAnchor=false){
  const row=el('section','saved-record');
  if(withAnchor){const p=paragraphMap.get(record.passageId);row.append(button((type==='question'?'问题':'想法')+' · §'+p.section,()=>{closePanel();changeChapter(p.chapterId,p.id);choosePassage(p.id);openPanel(type);}));}
  row.append(el('p','',record.text));const date=el('time','',new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',timeZone:'Asia/Singapore'}).format(new Date(record.createdAt)));date.dateTime=record.createdAt;row.append(date);return row;
}
function clearPanelTextHighlight(){
  if(typeof CSS!=='undefined'&&CSS.highlights)CSS.highlights.delete('panel-reference');
  for(const mark of $('chapter-text').querySelectorAll('.panel-reference-mark')){const parent=mark.parentNode;mark.replaceWith(document.createTextNode(mark.textContent));parent?.normalize();}
}
function syncPanelTextHighlight(){
  clearPanelTextHighlight();if(selectionKind!=='excerpt'||!selectedExcerpt?.parts?.length)return;
  const entries=[];for(const part of selectedExcerpt.parts){const passage=$('chapter-text').querySelector('[data-id="'+part.passageId+'"]');if(!passage)continue;const candidates=[...passage.querySelectorAll('p[lang]')],prose=candidates.find(node=>(node.dataset.readingLayer==='original'?'en':node.lang==='en'?'en':'zh')===part.language&&(part.language==='en'||node.dataset.variant===part.variant));if(!prose||part.start<0||part.end>prose.textContent.length)continue;entries.push({prose,part});}
  if(typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight!=='undefined'){const ranges=[];for(const {prose,part}of entries){const text=prose.firstChild;if(!text||text.nodeType!==Node.TEXT_NODE)continue;const range=new Range();range.setStart(text,part.start);range.setEnd(text,part.end);ranges.push(range);}if(ranges.length)CSS.highlights.set('panel-reference',new Highlight(...ranges));return;}
  const groups=new Map();for(const entry of entries){if(!groups.has(entry.prose))groups.set(entry.prose,[]);groups.get(entry.prose).push(entry.part);}for(const [prose,parts]of groups){const source=prose.textContent,fragment=document.createDocumentFragment();let cursor=0;for(const part of parts.sort((a,b)=>a.start-b.start)){fragment.append(document.createTextNode(source.slice(cursor,part.start)));const mark=el('mark','panel-reference-mark',source.slice(part.start,part.end));fragment.append(mark);cursor=part.end;}fragment.append(document.createTextNode(source.slice(cursor)));prose.replaceChildren(fragment);}
}
function renderPanelSource(p){
  const excerpt=selectionKind==='excerpt'&&selectedExcerpt?.parts?.length?selectedExcerpt:null,v=passageView(p),language=excerpt?.parts[0]?.language||visibleQuoteLanguage(p,v),variant=excerpt?.parts[0]?.variant||v.variant;
  const text=excerpt?excerpt.parts.map(part=>part.text).join('　'):language==='en'?p.original:p.translations[variant]?.text||'这段译文尚未准备好。';
  $('panel-source-label').textContent=(excerpt?'所选文字':'当前段落')+' · '+(language==='en'?(book.sourceLanguage==='zh'?'中文原文':'英文原文'):variant==='literal'?'中文直译':'中文意译');
  $('panel-source-text').textContent=text;$('panel-source').setAttribute('aria-label','回到正文：'+text.slice(0,120));
}
function returnToPanelSource(){
  const id=selectionKind==='excerpt'?selectedExcerpt?.parts?.[0]?.passageId:selectedId,node=id&&$('chapter-text').querySelector('[data-id="'+id+'"]');if(!node)return;
  node.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});node.focus({preventScroll:true});node.classList.remove('is-locating');requestAnimationFrame(()=>node.classList.add('is-locating'));setTimeout(()=>node.classList.remove('is-locating'),850);
}
function renderRecordsAccess(content){
  if(selectedBookId&&!readerSession?.user){
    if(!readerSession?.emailAvailable&&!readerSession?.localAvailable){content.append(el('p','empty-state','邮箱登录准备中，个人笔记暂未开放。你可以继续阅读中文试读、切换译法和核对原文。'));return;}
    content.append(el('p','empty-state','登录后，把想法和问题留在自己的书房。回来时仍在当前原文段落。'));const login=el('a','quiet-button','登录后回到这段 →');login.href=readerLoginUrl({bookId:selectedBookId,passageId:selectedId,note:allRecords?'records':panelTab==='question'?'question':'comment'});content.append(login);return;
  }
  content.append(el('p','empty-state','个人记录暂时无法读取。原来的记录不会被覆盖，正文仍可继续阅读。'));const retry=button(recordsRetryBusy?'正在读取…':'重新读取记录',recoverRecords);retry.disabled=recordsRetryBusy;content.append(retry);if(recordsRetryNotice){const notice=el('p','form-status',recordsRetryNotice);notice.setAttribute('role','status');content.append(notice);}
}
async function recoverRecords(event){
  event?.stopPropagation();if(recordsRetryBusy)return;recordsRetryBusy=true;recordsRetryNotice='';renderPanel();
  try{const fresh=await api('/api/records');if(!Array.isArray(fresh.comments)||!Array.isArray(fresh.questions))throw Error('记录格式不完整');recordsPositionUnresolved=recoveredPositionNeedsChoice(progressSync.revision,fresh.position);records=fresh;recordsUnavailable=false;if(recordsPositionUnresolved){clearTimeout(persistTimer);$('progress-notice').hidden=false;announce('记录已读取。阅读位置已在另一处更新，请选择从哪里继续。');}else{progressSync.adopt(fresh.position?.revision||0);persist();}}
  catch{recordsRetryNotice='记录仍暂时无法读取，请稍后重试；原文和已有草稿保留。';}
  finally{recordsRetryBusy=false;if(!$('note-panel').hidden)renderPanel();}
}
function renderPanel(){
  const content=$('panel-content');content.replaceChildren();const p=paragraphMap.get(selectedId);if(!p)return;
  $('panel-title').textContent=allRecords?'我的记录':panelTab==='annotations'?'段落注解':panelTab==='question'?'留下问题':'写下想法';
  $('panel-anchor').textContent='§'+p.section+(p.source?.printedPage?' · 原书 '+p.source.printedPage+' 页':p.source?.pdfPage?' · PDF 第 '+p.source.pdfPage+' 页':' · 自动分段');
  for(const tab of document.querySelectorAll('[data-panel-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.panelTab===panelTab));
  document.querySelector('.panel-tabs').hidden=allRecords;$('panel-source').hidden=allRecords;
  if(!allRecords){renderPanelSource(p);syncPanelTextHighlight();}else clearPanelTextHighlight();
  if(allRecords){
    content.append(el('h2','all-records-title','我的记录'));
    if(recordsUnavailable){renderRecordsAccess(content);mountPanel();return;}
    if(!records.comments.length&&!records.questions.length)content.append(el('p','empty-state','还没有留下记录。读到有共鸣的段落，点击正文写下一点想法。'));
    for(const record of records.comments)content.append(recordNode(record,'comment',true));for(const record of records.questions)content.append(recordNode(record,'question',true));mountPanel();return;
  }
  if(panelTab==='annotations'){
    for(const id of p.annotationIds){const n=notesMap.get(id);if(!n)continue;const block=el('section','annotation');const labels={difficulty:'理解难点',paradox:'悖论',example:'生活例子',context:'背景',cross_reference:'关联阅读',term:'术语'};block.append(el('p','attribution',(labels[n.kind]||'注解')+' · '+(n.attribution==='editorial'?'编辑补充':'原书注释')),el('h3','',n.title),el('p','',n.text));content.append(block);}
    if(p.termIds.length){const details=el('details','term-definition');details.append(el('summary','','关键英文'));for(const id of p.termIds){const t=termsMap.get(id);if(!t)continue;const line=el('p');line.append(el('strong','',t.zh+' · '+t.en),el('br'),document.createTextNode(t.definition));details.append(line);}content.append(details);}
    if(!p.annotationIds.length&&!p.termIds.length)content.append(el('p','empty-state','这一段没有编辑旁注。'));mountPanel();return;
  }
  const type=panelTab==='question'?'question':'comment',key=type==='question'?'questions':'comments',draftId=type+':'+p.id;
  if(recordsUnavailable){renderRecordsAccess(content);mountPanel();return;}
  if(noteDrafts.reconcile(draftId,records[key]))persistDrafts();
  const form=el('form','composer'),label=el('label','',type==='question'?'这个问题值得留下吗？':'用自己的话写下来'),area=el('textarea');area.id='thought-text';area.maxLength=2000;area.placeholder=type==='question'?'写下此刻没有想通的地方…':'先写你的理解，不必写完整…';label.htmlFor=area.id;area.value=noteDrafts.text(draftId);
  const save=button(''),pendingHint=el('p','form-status'),status=el('p','form-status');save.type='submit';status.setAttribute('aria-live','polite');
  const updateComposer=()=>{const pending=noteDrafts.pending(draftId),busy=noteDrafts.busy(draftId);save.disabled=busy;save.textContent=busy?'正在保存…':pending?'重试上次保存':type==='question'?'保存问题':'保存想法';pendingHint.hidden=!pending;pendingHint.textContent=pending?'待确认的提交：「'+pending.text.slice(0,80)+(pending.text.length>80?'…':'')+'」 重试先确认这次提交，新写的草稿会保留。':'';};
  updateComposer();form.append(label,area,pendingHint,save,status);content.append(form);
  area.addEventListener('input',()=>{noteDrafts.edit(draftId,area.value);if(!persistDrafts())status.textContent='浏览器无法保留草稿，请先复制文字；刷新会丢失未保存内容。';});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(noteDrafts.busy(draftId)||!area.value.trim()&&!noteDrafts.pending(draftId))return;
    noteDrafts.edit(draftId,area.value);const submission=noteDrafts.begin(draftId,{passageId:p.id,contentVersion:book.contentVersion,quote:selectedQuote,quoteLanguage:selectedQuoteLanguage==='en'?book.sourceLanguage||'en':'zh',quoteOrigin:selectedQuoteLanguage==='en'?'original':'translation'},()=>crypto.randomUUID());const durable=persistDrafts();updateComposer();status.textContent=durable?'正在保存':'正在保存；浏览器无法保留草稿，请先复制文字。';
    try{const record=await api('/api/'+key,submission);if(!records[key].some(r=>r.id===record.id))records[key].push(record);noteDrafts.acknowledge(draftId,record);const cached=persistDrafts();if(form.isConnected){area.value=noteDrafts.text(draftId);status.setAttribute('role','status');status.textContent=area.value?'上次提交已保存，新写的文字仍是草稿。'+(cached?'':'浏览器无法保留草稿，请先复制；刷新会丢失未保存内容。'):'已保存到自己的书房';content.append(recordNode(record,type));}}
    catch(error){if(form.isConnected){status.setAttribute('role','alert');status.textContent='保存尚未确认。文字仍保留，重试不会重复创建同一次提交。';}}
    finally{noteDrafts.finish(draftId);if(form.isConnected)updateComposer();else if(!allRecords&&!$('note-panel').hidden&&selectedId===p.id&&panelTab===type)renderPanel();}
  });
  for(const record of records[key].filter(r=>r.passageId===p.id))content.append(recordNode(record,type));mountPanel();
}
function openPanel(tab){
  if(!selectedId)return;const a=anchor();panelTab=tab;allRecords=false;$('note-panel').hidden=false;document.body.classList.add('has-panel');for(const node of $('chapter-text').querySelectorAll('.is-selected'))node.classList.add('is-panel-anchor');renderPanel();restoreAnchor(a);dismissTools({preserveSelection:true});
}
function updateText(){const a=anchor();for(const node of $('chapter-text').querySelectorAll('.passage'))fillPassage(node,paragraphMap.get(node.dataset.id));applyAppearance();if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();persist();document.dispatchEvent(new CustomEvent('reader:layout'));}
async function focusReading(){
  const entering=!document.body.classList.contains('is-focused'),a=anchor();dismissTools();closePanel();$('settings-dialog').close();$('toc-dialog').close();
  document.body.classList.toggle('is-focused',entering);document.dispatchEvent(new CustomEvent('reader:focus',{detail:{focused:entering}}));$('exit-focus').hidden=!entering;restoreAnchor(a);
  if(entering){try{await document.documentElement.requestFullscreen({navigationUI:'hide'});}catch{announce('已进入专注阅读。当前浏览器保留窗口模式。');}}
  else if(document.fullscreenElement)await document.exitFullscreen();restoreAnchor(a);
}
async function boot(){
  try{
    book=await api('/api/book');if(book.title?.zh){document.querySelector('.running-title').firstChild.textContent=book.title.zh;$('toc-book-title').textContent=book.title.zh;}if(selectedBookId){state.chapterId=book.readingStart?.chapterId||book.chapters[0].id;state.mode=catalogReadingMode(book);recordsUnavailable=!readerSession?.user;}else recordsUnavailable=false;try{records=await api('/api/records');}catch{recordsUnavailable=true;records={comments:[],questions:[],position:null};}
    paragraphs=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,section:s.number,chapterId:s.chapterId})));paragraphMap=new Map(paragraphs.map(p=>[p.id,p]));notesMap=new Map(book.annotations.map(n=>[n.id,n]));termsMap=new Map(book.glossary.map(t=>[t.id,t]));
    let localPosition=null;try{localPosition=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
    let position=chooseReadingPosition({book,remote:records.position,local:localPosition,remoteAvailable:!recordsUnavailable});
    progressSync.adopt(recordsUnavailable?(position?.baseRevision??position?.revision??0):(records.position?.revision||0));
    if(position&&Number.isFinite(position.offset)&&Math.abs(position.offset)<=4000&&paragraphMap.has(position.passageId)){position.chapterId=paragraphMap.get(position.passageId).chapterId;state.chapterId=position.chapterId;if(['zh','en','parallel'].includes(position.mode))state.mode=position.mode;if(['literal','interpretive'].includes(position.variant))state.variant=position.variant;if(Number.isFinite(position.font))state.font=Math.max(18,Math.min(28,position.font));Object.assign(state,normalizeAppearance(position));}else position=null;
    const requestedEntry=resolveReaderEntry(book,new URLSearchParams(location.search));if(requestedEntry){state.chapterId=requestedEntry.chapterId;if(requestedEntry.note||requestedEntry.action==='translate')state.mode='en';position={...(position||{}),...state,chapterId:requestedEntry.chapterId,passageId:requestedEntry.passageId,offset:requestedEntry.offset,withinParagraph:undefined,contentVersion:book.contentVersion};}
    const sampleEntry=!requestedEntry&&chineseSampleEntry(book,new URLSearchParams(location.search));if(sampleEntry){Object.assign(state,{chapterId:sampleEntry.chapterId,mode:sampleEntry.mode,variant:sampleEntry.variant});position={...(position||{}),...state,...sampleEntry,withinParagraph:undefined,contentVersion:book.contentVersion};const query=new URLSearchParams(location.search);query.delete('sample');history.replaceState(null,'',location.pathname+'?'+query);}
    if(selectedBookId){const onlyOriginal=chineseOriginalOnly(book);for(const option of $('view-mode').options){option.disabled=onlyOriginal&&option.value!=='en';if(option.value==='en')option.textContent=book.sourceLanguage==='zh'?'中文原文':'英文原文';if(option.value==='zh')option.textContent='中文译文';if(option.value==='parallel')option.textContent=book.sourceLanguage==='zh'?'原文与译文对照':'中英对照';}if(onlyOriginal)state.mode='en';}
    renderChapter();$('loading').hidden=true;$('load-error').hidden=true;await document.fonts.ready;if(position){restoreAnchor(position);cachePosition({...position,contentVersion:book.contentVersion,chapterLabel:resumeSummary(book,position)?.label});}else if(selectedBookId&&book.readingStart)restoreAnchor({...book.readingStart,offset:160});restoringProgress=false;document.body.dataset.ready='true';document.dispatchEvent(new CustomEvent('reader:ready'));if(requestedEntry){const query=new URLSearchParams(location.search);query.delete('passage');query.delete('note');query.delete('action');history.replaceState(null,'',location.pathname+'?'+query);if(requestedEntry.note){choosePassage(requestedEntry.passageId,null,paragraphMap.get(requestedEntry.passageId).original,'en');openPanel(requestedEntry.note==='question'?'question':'comment');if(requestedEntry.note==='records'){allRecords=true;renderPanel();}}else if(requestedEntry.action==='translate'){choosePassage(requestedEntry.passageId,null,'','en');}}
  }catch{ $('loading').hidden=true;$('load-error').hidden=false;}
}
document.addEventListener('click',e=>{
  if(e.target.closest('#note-panel,#paragraph-tools,dialog,.reading-header,#exit-focus,.experience-surface,.source-evidence'))return;
  const selection=getSelection();if(selection?.toString().trim()&&selectedExcerpt&&$('paragraph-tools').dataset.excerpt==='true')return;
  const node=e.target.closest('.passage');if(node){if(!getSelection()?.toString()){const layer=e.target.closest('p')?.dataset.readingLayer;choosePassage(node.dataset.id,e.clientY,'',layer==='original'?'en':layer==='translation'?'zh':null);}return;}
  dismissTools();closePanel();
});
function captureExcerpt(y){
  try{const excerpt=captureDOMSelection(getSelection(),paragraphMap,book);if(!excerpt){if(getSelection()?.toString().trim()){selectedExcerpt=null;dismissTools();}return;}const first=excerpt.parts[0];choosePassage(first.passageId,y,excerpt.parts.length===1?first.text:'',first.language);selectedExcerpt=excerpt;selectionKind='excerpt';for(const part of excerpt.parts)document.getElementById(part.passageId)?.classList.add('is-selected');$('show-share').hidden=false;$('paragraph-tools').dataset.excerpt='true';positionTools();}
  catch(error){selectedExcerpt=null;$('show-share').hidden=true;announce(error.message||'请重新选择正文。');}
}
document.addEventListener('pointerup',e=>{if(e.button!==0||e.target.closest('#note-panel,#paragraph-tools,dialog,.experience-surface,.source-evidence')||!book)return;captureExcerpt(e.clientY);});
document.addEventListener('keyup',e=>{if(book&&!e.target.closest('input,textarea,select,dialog')&&(e.key==='Shift'||e.shiftKey))captureExcerpt();});
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]'))return;
  if(e.target.closest('input,textarea,select')||e.target.isContentEditable)return;
  if(e.key==='Escape'){
    if(!$('paragraph-tools').hidden){dismissTools();return;}if(!$('note-panel').hidden){closePanel();$('chapter-text').querySelector('[data-id="'+selectedId+'"]')?.focus({preventScroll:true});return;}
    if(document.body.classList.contains('is-focused')&&!document.fullscreenElement)focusReading();return;
  }
  if(e.key==='Enter'&&e.target.matches('.passage')){e.preventDefault();choosePassage(e.target.dataset.id);$('paragraph-tools').querySelector('button:not([hidden])')?.focus();}
  if(e.key.toLowerCase()==='f'&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();focusReading();}
});
$('open-toc').addEventListener('click',()=>{dismissTools();$('toc-dialog').showModal();});$('open-settings').addEventListener('click',()=>{dismissTools();$('settings-dialog').showModal();});
for(const b of document.querySelectorAll('[data-close-dialog]'))b.addEventListener('click',()=>$(b.dataset.closeDialog).close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();});
$('view-mode').addEventListener('change',e=>{state.mode=e.target.value;overrides={};dismissTools();updateText();});
$('translation-variant').addEventListener('change',e=>{state.variant=e.target.value;for(const value of Object.values(overrides))delete value.variant;updateText();});
for(const b of document.querySelectorAll('[data-theme-choice]'))b.addEventListener('click',()=>adjustAppearance({theme:b.dataset.themeChoice}));
for(const b of document.querySelectorAll('[data-font-family]'))b.addEventListener('click',()=>adjustAppearance({fontFamily:b.dataset.fontFamily}));
$('font-size').addEventListener('input',e=>adjustAppearance({font:Number(e.target.value)}));
$('first-line-indent').addEventListener('change',e=>adjustAppearance({indent:e.target.checked}));
$('reset-appearance').addEventListener('click',()=>{adjustAppearance(appearanceDefaults);announce('已恢复默认排版与纸面，阅读位置和记录已保留。');});
$('settings-chapters').addEventListener('click',()=>{$('settings-dialog').close();$('toc-dialog').showModal();});
matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>applyAppearance());
$('show-original').addEventListener('click',()=>{if(!selectedId)return;const a=anchor(),p=paragraphMap.get(selectedId),v=passageView(p);overrides[selectedId]={...overrides[selectedId],mode:v.mode==='en'?'zh':'en'};fillPassage($('chapter-text').querySelector('[data-id="'+selectedId+'"]'),p);if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);$('show-original').textContent=v.mode==='en'?'原文':'译文';positionTools();});
$('show-annotations').addEventListener('click',()=>openPanel('annotations'));$('show-comment').addEventListener('click',()=>openPanel('comment'));$('show-question').addEventListener('click',()=>openPanel('question'));
$('more-actions').addEventListener('click',()=>{$('paragraph-more').hidden=!$('paragraph-more').hidden;$('more-actions').setAttribute('aria-expanded',String(!$('paragraph-more').hidden));positionTools();});
for(const b of document.querySelectorAll('[data-passage-variant]'))b.addEventListener('click',()=>{if(!selectedId)return;overrides[selectedId]={mode:'zh',variant:b.dataset.passageVariant};const a=anchor();fillPassage($('chapter-text').querySelector('[data-id="'+selectedId+'"]'),paragraphMap.get(selectedId));if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);dismissTools();});
for(const b of document.querySelectorAll('[data-panel-tab]'))b.addEventListener('click',()=>{panelTab=b.dataset.panelTab;allRecords=false;renderPanel();});
$('panel-source').addEventListener('click',returnToPanelSource);
$('close-panel').addEventListener('click',()=>{closePanel();$('chapter-text').querySelector('[data-id="'+selectedId+'"]')?.focus({preventScroll:true});});
$('show-all-records').addEventListener('click',()=>{$('settings-dialog').close();selectedId=anchor()?.passageId||activeSections()[0].paragraphs[0].id;allRecords=true;$('note-panel').hidden=false;document.body.classList.add('has-panel');renderPanel();});
$('export-records').addEventListener('click',async e=>{
  e.preventDefault();const link=e.currentTarget;if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');
  try{if(recordsUnavailable)throw Error('请先重新读取个人记录，再导出。');if(recordsPositionUnresolved||progressSync.paused)throw Error('请先选择从哪里继续，再导出当前阅读记录。');clearTimeout(persistTimer);const position=captureProgress();if(position){cachePosition({...position,pending:true});if(!await progressSync.save(position))throw Error('阅读位置正在确认，请确认后再导出。');}const data=await api('/api/records/export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),download=document.createElement('a');download.href=url;download.download='marginalia-records.json';download.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('import-status').setAttribute('role','status');$('import-status').textContent='记录与当前排版已导出。';}
  catch(error){$('import-status').textContent=error.message||'暂时无法导出记录';$('import-status').setAttribute('role','alert');}finally{link.removeAttribute('aria-busy');}
});
$('import-records').addEventListener('click',()=>$('records-file').click());$('records-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;clearTimeout(persistTimer);try{if(file.size>4*1024*1024)throw Error('记录包过大');const imported=JSON.parse(await file.text());await api('/api/records/import',imported);records=await api('/api/records');if(imported.position&&records.position){state.mode=records.position.mode;state.variant=records.position.variant;overrides={};document.dispatchEvent(new CustomEvent('reader:jump'));updateText();adjustAppearance(records.position);}$('import-status').setAttribute('role','status');$('import-status').textContent='记录已合并，排版已恢复；重复记录不会重复生成';}catch(error){$('import-status').textContent=error.message||'记录无法导入';$('import-status').setAttribute('role','alert');}finally{e.target.value='';}});
$('previous-chapter').addEventListener('click',()=>{const n=book.chapters.findIndex(c=>c.id===state.chapterId)-1;if(book.chapters[n])changeChapter(book.chapters[n].id);});$('next-chapter').addEventListener('click',()=>{const n=book.chapters.findIndex(c=>c.id===state.chapterId)+1;if(book.chapters[n])changeChapter(book.chapters[n].id);});
$('enter-focus').addEventListener('click',focusReading);$('exit-focus').addEventListener('click',focusReading);
document.addEventListener('fullscreenchange',()=>{document.body.dataset.fullscreen=document.fullscreenElement?'true':'false';});
for(const type of ['wheel','touchmove'])document.addEventListener(type,event=>{if(event.isTrusted)allowScrollSave=true;},{passive:true});
document.addEventListener('keydown',event=>{if(event.isTrusted&&!event.target.closest('input,textarea,select')&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))allowScrollSave=true;});
let scrollFrame=false;document.addEventListener('scroll',()=>{if(scrollFrame)return;scrollFrame=true;requestAnimationFrame(()=>{scrollFrame=false;if(!$('paragraph-tools').hidden)positionTools();if(allowScrollSave)persist();});},{passive:true});
async function reconcileProgress(useRemote){
  const buttons=[$('progress-use-remote'),$('progress-keep-here')];buttons.forEach(b=>b.disabled=true);restoringProgress=true;progressSequence++;clearTimeout(persistTimer);
  try{
    const fresh=await api('/api/records'),position=resolveReadingPosition(book,fresh.position);if(useRemote&&!position)throw Error('较新的位置暂时无法对应原文，请继续读这里。');clearTimeout(persistTimer);progressSync.adopt(fresh.position?.revision||0);recordsPositionUnresolved=false;
    if(useRemote){closePanel();dismissTools();records=fresh;Object.assign(state,{chapterId:position.chapterId,mode:position.mode,variant:position.variant},normalizeAppearance(position));overrides={};selectedId=null;renderChapter();restoreAnchor(position);cachePosition({...position,contentVersion:book.contentVersion,chapterLabel:resumeSummary(book,position)?.label,pending:false});allowScrollSave=false;announce('已回到另一处较新的阅读位置。');}
    else{restoringProgress=false;persist();announce('继续读这里，当前位置会保存到自己的书房。');}
    $('progress-notice').hidden=true;
  }catch(error){announce(error.message||'阅读位置暂时无法同步');}finally{restoringProgress=false;buttons.forEach(b=>b.disabled=false);}
}
$('progress-use-remote').addEventListener('click',()=>reconcileProgress(true));$('progress-keep-here').addEventListener('click',()=>reconcileProgress(false));
new ResizeObserver(()=>{if(!$('paragraph-tools').hidden)positionTools();}).observe($('paragraph-tools'));
window.addEventListener('resize',()=>{if(!$('note-panel').hidden)mountPanel();if(!$('paragraph-tools').hidden)positionTools();});
$('retry-load').addEventListener('click',()=>{$('load-error').hidden=true;$('loading').hidden=false;boot();});
window.marginaliaReader={getBook:()=>book,getState:()=>({...state}),getExcerpt:()=>selectedExcerpt?structuredClone(selectedExcerpt):null,getChapterId:()=>state.chapterId,getSelectedId:()=>selectedId,getAnchor:()=>{const a=anchor();return a?{...a,chapterId:state.chapterId}:null;},restoreAnchor:a=>{if(a&&a.chapterId===state.chapterId){restoreAnchor(a);persist();}},goToPassage:id=>{const p=paragraphMap.get(id);if(!p)return;if(p.chapterId!==state.chapterId)changeChapter(p.chapterId,id);else{restoreAnchor({passageId:id,offset:document.body.classList.contains('is-focused')?45:100});persist();}document.dispatchEvent(new CustomEvent('reader:jump',{detail:{passageId:id}}));},dismissTools};
document.addEventListener('reader:translation',e=>{const p=paragraphMap.get(e.detail.id);if(!p)return;p.translations=e.detail.translations;const raw=book.sections.flatMap(s=>s.paragraphs).find(x=>x.id===p.id);if(raw)raw.translations=p.translations;const reveal=e.detail.reveal!==false&&selectedId===p.id;if(reveal)state.mode='parallel';if(p.chapterId===state.chapterId)updateText();announce(reveal?'这段双译草稿已保存，可随时核对原文。':'之前选择的段落双译已保存，可以继续阅读。');});
boot();
