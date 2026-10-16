import {appearanceDefaults,appearanceBounds,normalizeAppearance,openingReadingPreferences} from './reading-preferences.mjs';
import {captureDOMSelection,paragraphSnapshot} from './share-model.mjs';
import {placeFloatingToolbar,placeFloatingMenu} from './toolbar-placement.mjs';
import {readerFetch,readerStorageKey,selectedBookId,readerSession} from './reader-api.mjs';
import {chooseReadingPosition,resolveReadingPosition,resumeSummary,acknowledgePosition,recoveredPositionNeedsChoice} from './reading-progress.mjs';
import {createProgressSync} from './progress-sync.mjs';
import {chineseOriginalOnly} from './source-language.mjs';
import {captureParagraphAnchor,paragraphScrollDelta} from './paragraph-anchor.mjs';
import {createNoteDrafts} from './note-drafts.mjs';
import {createReadingDraftStore} from './reading-draft-store.mjs';
import {readerLoginUrl,resolveReaderEntry} from './reader-return.mjs';
import {passagePresentation,visibleQuoteLanguage} from './passage-layers.mjs';
import {chineseSampleEntry} from './catalog-sample.mjs';
import {createChapterFlow,isReadingDivider} from './reading-flow.mjs';
import {startReadingLoad,mergeLoadedReadingRecords} from './reading-load.mjs';
import {noteSaveReceipt,positionSaveState,draftSaveReceipt} from './save-receipts.mjs';
import {mountReadingArrival} from './reading-arrival.mjs';
import {mountBookIntroduction,renderBookContents} from './reader-navigation.mjs';
import {mountParallelSettings,applyParallelAppearance,createParallelPair} from './parallel-reading.mjs';
import {mountReaderPagination} from './reader-pagination.mjs';
import {mountReaderImmersion} from './reader-immersion.mjs';
import {mountReaderConversation,readerInteractionBlocked} from './reader-conversation.mjs';
import {mountReaderSettings} from './reader-settings.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {activeHighlights,highlightKey} from './highlights.mjs';
import {mountReaderHighlights,textRange} from './reader-highlights.mjs';
const $=id=>document.getElementById(id);
const arrival=mountReadingArrival($('loading'));
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const button=(text,action)=>{const b=el('button','',text);b.type='button';if(action)b.addEventListener('click',action);return b;};
const announce=text=>{$('announcement').textContent=text;};
let book,records,recordsUnavailable=false,paragraphs=[],paragraphMap=new Map(),notesMap=new Map(),termsMap=new Map(),selectedId=null,selectedQuote='',selectedQuoteLanguage='zh',selectedExcerpt=null,selectionKind='passage',panelTab='annotations',allRecords=false,persistTimer=null,overrides={};
let recordsRetryBusy=false,recordsRetryNotice='',recordsPositionUnresolved=false,recordsPending=false,loadGeneration=0,entryInteracted=false,flow=null,flowIdle=null,flowFrame=false,deferredProgress=false;
let continuous=true;try{continuous=localStorage.getItem(readerStorageKey('marginalia-continuous-v1'))!=='false';}catch{}
$('continuous-reading').checked=continuous;document.body.dataset.continuous=String(continuous);
const state={chapterId:'ch01',...openingReadingPreferences()};
const revealedTranslations=new Set();
const pagination=mountReaderPagination({document,isBlocked:target=>readerInteractionBlocked(document,target)||!$('note-panel').hidden,hasBoundary:direction=>!!book&&!!book.chapters[book.chapters.findIndex(c=>c.id===state.chapterId)+direction],onTurn:()=>{dismissTools();persist();document.dispatchEvent(new CustomEvent('reader:page'));},onBoundary:direction=>{const chapter=book?.chapters[book.chapters.findIndex(c=>c.id===state.chapterId)+direction];if(!chapter)return false;changeChapter(chapter.id);if(direction<0)pagination.last();persist();return true;}});
const settingsUI=mountReaderSettings({document});
const immersion=mountReaderImmersion({document,announce,beforeLayout:()=>anchor(),afterLayout:a=>{restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();document.dispatchEvent(new CustomEvent('reader:layout'));}});
const draftKey=readerStorageKey('marginalia-focus-drafts-v2');let savedDrafts=null,legacyDrafts={};try{savedDrafts=JSON.parse(localStorage.getItem(draftKey)||'null');legacyDrafts=JSON.parse(localStorage.getItem(readerStorageKey('marginalia-focus-drafts-v1'))||'{}');}catch{}
let noteDrafts=createNoteDrafts(savedDrafts,legacyDrafts),noteDraftError=null;
const persistDrafts=()=>{try{if(noteDraftError)return false;if(noteDrafts.persist)noteDrafts.persist();else localStorage.setItem(draftKey,JSON.stringify(noteDrafts.snapshot()));document.dispatchEvent(new CustomEvent('reader:drafts-updated'));return true;}catch{return false;}};
const api=async(url,data)=>{const response=await readerFetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||'暂时无法完成操作'),{status:response.status});return body;};
const highlights=mountReaderHighlights({document,getRecords:()=>records,signedIn:()=>!selectedBookId||!!readerSession?.user,available:()=>!recordsUnavailable,selectionMatches:snapshot=>{try{const native=captureDOMSelection(getSelection(),paragraphMap,book);return !!native&&highlightKey(native)===highlightKey(snapshot);}catch{return false;}},api,onSelect:selectHighlight,onNote:()=>openPanel('comment'),onChange:()=>{flow?.invalidatePrepared();if(!$('note-panel').hidden)renderPanel();document.dispatchEvent(new CustomEvent('reader:records-updated'));},announce,loginUrl:()=>readerLoginUrl({bookId:selectedBookId,passageId:selectedId})});
const progressKey=readerStorageKey('marginalia-focus-position-v1'),localWriterId=crypto.randomUUID();let progressSequence=0,restoringProgress=true,allowScrollSave=false;
let latestPositionAttempt=null,latestPositionDurable=false,confirmedPosition=null;
const positionChanged=()=>document.dispatchEvent(new CustomEvent('reader:position-status'));
const cachePosition=(position,{track=true}={})=>{let durable=false;try{localStorage.setItem(progressKey,JSON.stringify(position));durable=true;}catch{}if(track){latestPositionAttempt=position;latestPositionDurable=durable;}positionChanged();return durable;};
const progressSync=createProgressSync({
  send:({localSequence,localWriterId,...position})=>api('/api/progress',position),
  beforeSend:position=>{if(position.localSequence===progressSequence)cachePosition({...position,pending:true});},
  onSaved:(saved,submitted)=>{confirmedPosition={...submitted,...saved};try{const cached=JSON.parse(localStorage.getItem(progressKey)||'null'),next=acknowledgePosition(cached,saved,submitted);if(next){const durable=cachePosition({...next,chapterLabel:resumeSummary(book,next)?.label},{track:false});if(latestPositionAttempt?.localWriterId===submitted.localWriterId&&latestPositionAttempt?.localSequence===submitted.localSequence)latestPositionDurable=durable;}}catch{}positionChanged();},
  onConflict:()=>{$('progress-notice').hidden=false;announce('阅读位置已在另一处更新。当前书页保留，请选择从哪里继续。');positionChanged();},
  onFailure:error=>{announce((error.status===413?error.message+'；':'阅读位置暂未同步；')+(latestPositionDurable?'当前位置已留本机。':'当前位置仅在当前页面，离开前请重试保存。'));positionChanged();}
});
const currentChapter=()=>book.chapters.find(c=>c.id===state.chapterId);
const activeSections=()=>book.sections.filter(s=>s.chapterId===state.chapterId);
const chapterLabel=chapter=>book.source?.structure==='automatic_groups'?'自动分段 · 阅读片段 '+chapter.number:chapter.kind&&chapter.kind!=='body'?chapter.title.zh:'第 '+chapter.number+' 章';
mountBookIntroduction({document,getBook:()=>book,getChapter:()=>book&&currentChapter(),onOpen:dismissTools});
function anchor(){
  if(pagination.active)return pagination.anchor();
  const threshold=document.body.classList.contains('is-focused')?24:80;
  const node=[...$('chapter-text').querySelectorAll('.passage')].find(n=>n.getBoundingClientRect().bottom>threshold);
  return node?{passageId:node.dataset.id,...captureParagraphAnchor(node.getBoundingClientRect(),threshold)}:null;
}
function restoreAnchor(a){
  if(pagination.active){pagination.restore(a);return;}
  if(!a)return;const node=$('chapter-text').querySelector('[data-id="'+a.passageId+'"]'),threshold=document.body.classList.contains('is-focused')?24:80;if(!node)return;
  // Make room below an end-of-chapter anchor before the browser clamps scrolling.
  while(continuous&&flow?.nextId&&scrollY+paragraphScrollDelta(node.getBoundingClientRect(),a,threshold)>document.documentElement.scrollHeight-innerHeight+.5){if(!insertFollowingChapter())break;}
  window.scrollBy(0,paragraphScrollDelta(node.getBoundingClientRect(),a,threshold));
}
function captureProgress(){
  if(!book||restoringProgress)return null;const a=anchor();if(!a)return null;
  return {...state,...a,chapterId:paragraphMap.get(a.passageId)?.chapterId||state.chapterId,contentVersion:book.contentVersion,baseRevision:progressSync.revision,localWriterId,localSequence:++progressSequence,chapterLabel:resumeSummary(book,{...state,...a})?.label};
}
function persist(){
  const position=captureProgress();if(!position)return;
  cachePosition({...position,pending:!!readerSession?.user||!selectedBookId});
  clearTimeout(persistTimer);if(recordsUnavailable||recordsPositionUnresolved){deferredProgress=true;return;}deferredProgress=false;persistTimer=setTimeout(()=>progressSync.save(position).catch(()=>{}),450);
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
  applyParallelAppearance(document,state);
  pagination.update(state);settingsUI.update(state);
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
    node.append(createParallelPair({document,layers:view.layers,variant:v.variant,prose,passageId:p.id,revealed:revealedTranslations,onReveal:change=>{const a=anchor();change();restoreAnchor(a);document.dispatchEvent(new CustomEvent('reader:layout'));}}));
  }else node.append(prose(view.layers[0],v.variant));
  if(view.notice)node.append(el('span','translation-status',view.notice));
  for(const text of node.querySelectorAll('p[data-reading-layer]'))highlights.paint(text,p.id);
}
function buildChapter(chapter){
  const wrapper=el('section','flow-chapter');wrapper.dataset.chapterId=chapter.id;wrapper.setAttribute('aria-label',chapterLabel(chapter)+' · '+chapter.title.zh);
  const heading=el('header','flow-heading');heading.append(el('p','chapter-number',chapterLabel(chapter)),el('h2','',chapter.title.zh));wrapper.append(heading);
  for(const s of book.sections.filter(s=>s.chapterId===chapter.id)){
    const section=el('section','reading-section');section.id='section-'+s.number;if(book.source?.structure!=='source_chapters')section.append(el('p','section-number','§'+s.number));
    for(const raw of s.paragraphs){
      const p=paragraphMap.get(raw.id),divider=isReadingDivider(p.original),node=el('div',p.kind==='source_heading'?'passage source-chapter-heading':divider?'passage reading-divider':'passage');node.id=p.id;node.dataset.id=p.id;node.tabIndex=0;node.setAttribute('aria-describedby','reading-instructions');fillPassage(node,p);section.append(node);
      if(p.id===book.chineseSample?.endPassageId){const end=el('aside','sample-boundary');end.append(el('strong','','中文试读到这里'),el('p','','以上 '+book.chineseSample.paragraphs+' 段已有独立直译与意译草稿。以下尚未翻译，可以继续阅读英文原文。'));section.append(end);}
    }wrapper.append(section);
  }
  const ending=el('div','flow-chapter-end');ending.append(el('span','',chapterLabel(chapter)+' · 章末'));
  if(!chapter.kind||chapter.kind==='body'){const mark=button('标记本章读完',()=>document.dispatchEvent(new CustomEvent('reader:mark-chapter',{detail:{chapterId:chapter.id}})));mark.dataset.markChapter=chapter.id;mark.hidden=true;ending.append(mark);}
  wrapper.append(ending);return wrapper;
}
function updateChapterNavigation(){
  const chapter=currentChapter(),index=book.chapters.findIndex(c=>c.id===chapter.id),bodyCount=book.chapters.filter(c=>c.kind==='body').length;
  document.title=chapter.title.zh+' · 循页';$('running-chapter').textContent=book.source?.structure==='automatic_groups'?'片段 '+chapter.number:chapterLabel(chapter);
  $('chapter-fraction').textContent=chapter.kind==='body'?chapter.number+' / '+bodyCount:chapter.kind?chapter.title.zh:(index+1)+' / '+book.chapters.length;
  $('previous-chapter').disabled=index===0;$('next-chapter').disabled=index===book.chapters.length-1;
  renderToc();document.dispatchEvent(new CustomEvent('reader:chapter',{detail:{chapterId:state.chapterId}}));
}
function queueReadingFlow(){if(flowFrame)return;flowFrame=true;requestAnimationFrame(()=>{flowFrame=false;syncFlowChapter();extendReadingFlow();});}
function prepareFollowingChapter(){
  if(pagination.active||!continuous||!flow?.nextId)return;
  if(flowIdle!==null){if(window.cancelIdleCallback)cancelIdleCallback(flowIdle);else clearTimeout(flowIdle);}
  const prepare=()=>{flowIdle=null;if(continuous)flow?.prepareNext();};
  flowIdle=window.requestIdleCallback?requestIdleCallback(prepare,{timeout:800}):setTimeout(prepare,80);
}
function extendReadingFlow(){
  if(pagination.active||!continuous||restoringProgress||!flow?.nextId||document.hidden||document.querySelector('dialog[open]:not(.library-chat-dialog)')||!$('note-panel').hidden||$('chapter-footer').contains(document.activeElement))return;
  const last=$('chapter-text').lastElementChild;if(!last||last.getBoundingClientRect().bottom>innerHeight*2.5)return;
  insertFollowingChapter();
}
function insertFollowingChapter(){
  const next=flow?.appendNext();if(!next)return false;$('chapter-text').append(next.node);prepareFollowingChapter();document.dispatchEvent(new CustomEvent('reader:layout'));document.dispatchEvent(new CustomEvent('reader:flow-extended'));queueReadingFlow();return true;
}
function syncFlowChapter(){
  if(pagination.active||!continuous||restoringProgress||!book||document.querySelector('dialog[open]:not(.library-chat-dialog)')||!$('note-panel').hidden||document.querySelector('.experience-surface'))return;
  const id=paragraphMap.get(anchor()?.passageId)?.chapterId;if(id&&id!==state.chapterId){state.chapterId=id;updateChapterNavigation();}
}
function renderChapter(){
  if($('chapter-text').contains($('note-panel')))document.body.append($('note-panel'));
  flow=createChapterFlow({chapters:book.chapters,render:buildChapter});const first=flow.start(state.chapterId);first.dataset.first='true';$('chapter-text').replaceChildren(first);const chapter=currentChapter();
  $('chapter-number').textContent=chapterLabel(chapter);$('chapter-title').textContent=chapter.title.zh;$('chapter-original-title').textContent=chapter.title.en;
  $('chapter-heading').hidden=false;$('chapter-footer').hidden=false;applyAppearance();updateChapterNavigation();prepareFollowingChapter();
}
function renderToc(){
  renderBookContents({list:$('toc-list'),book,chapterId:state.chapterId,onNavigate:changeChapter});
  $('open-toc').disabled=false;$('settings-chapters').disabled=false;
}
function changeChapter(id,target=null){
  if(!book.chapters.some(c=>c.id===id))return;persist();closePanel();dismissTools();state.chapterId=id;selectedId=null;
  const existing=continuous&&flow?.renderedIds.includes(id);
  if(existing)updateChapterNavigation();else{overrides={};renderChapter();}$('toc-dialog').close();
  target=target||currentChapter().startPassageId||book.sections.find(s=>s.chapterId===id)?.paragraphs[0]?.id;
  if(target)restoreAnchor({passageId:target,offset:document.body.classList.contains('is-focused')?45:100});else window.scrollTo(0,0);
  persist();prepareFollowingChapter();announce('已进入'+chapterLabel(currentChapter())+'。');
}
function dismissTools({preserveSelection=false}={}){
  highlights.updateTools(null);
  $('paragraph-tools').hidden=true;$('paragraph-tools').dataset.excerpt='false';$('show-share').hidden=true;$('paragraph-more').hidden=true;$('more-actions').setAttribute('aria-expanded','false');
  if(!preserveSelection){clearPanelTextHighlight();selectionKind='passage';for(const node of $('chapter-text').querySelectorAll('.is-selected,.is-panel-anchor'))node.classList.remove('is-selected','is-panel-anchor');document.dispatchEvent(new CustomEvent('reader:selection-end'));}
}
function selectedRangeRect(){
  const selection=getSelection();if(!selection||selection.isCollapsed||selection.rangeCount!==1){
    if(selectionKind!=='excerpt'||!selectedExcerpt)return null;
    const rects=selectedExcerpt.parts.flatMap(part=>{const prose=proseForPart(part);if(!prose||prose.textContent.slice(part.start,part.end)!==part.text)return [];return [...(textRange(document,prose,part.start,part.end)?.getClientRects()||[])];});
    return rects.find(rect=>rect.bottom>80&&rect.top<innerHeight-60)||rects[0]||null;
  }
  const range=selection.getRangeAt(0),container=range.commonAncestorContainer.nodeType===Node.TEXT_NODE?range.commonAncestorContainer.parentElement:range.commonAncestorContainer;
  if(!container||!$('chapter-text').contains(container))return null;
  const rect=range.getBoundingClientRect();return rect.width||rect.height?rect:null;
}
function positionTools(){
  const tools=$('paragraph-tools'),id=tools.dataset.excerpt==='true'?selectedExcerpt?.parts.at(-1)?.passageId||selectedId:selectedId;
  const node=document.getElementById(id);if(!node)return;
  const nodeRect=(pagination.active&&pagination.visibleRect(node))||node.getBoundingClientRect();tools.hidden=false;tools.inert=false;tools.style.visibility='hidden';tools.style.opacity='0';tools.style.maxWidth=Math.min(nodeRect.width,innerWidth-24)+'px';
  const rangeRect=tools.dataset.excerpt==='true'?selectedRangeRect():null,anchorRect=rangeRect||nodeRect;
  const header=document.body.classList.contains('is-focused')?0:$('reading-header').getBoundingClientRect().bottom;
  const placement=placeFloatingToolbar({anchor:anchorRect,fallbackAnchor:rangeRect?nodeRect:anchorRect,toolbar:{width:tools.offsetWidth,height:tools.offsetHeight},viewport:{width:innerWidth,height:innerHeight},headerBottom:header});
  tools.style.left=placement.left+'px';tools.style.top=placement.top+'px';tools.dataset.placement=placement.placement;tools.inert=!placement.visible;tools.setAttribute('aria-hidden',String(!placement.visible));tools.style.visibility=placement.visible?'visible':'hidden';tools.style.opacity=placement.visible?'1':'0';
  const menu=$('paragraph-more');if(!menu.hidden){menu.style.maxHeight='';const at=placeFloatingMenu({toolbar:tools.getBoundingClientRect(),menu:{width:menu.offsetWidth,height:menu.scrollHeight+2},viewport:{width:innerWidth,height:innerHeight},headerBottom:header});Object.assign(menu.style,{position:'absolute',left:(at.left-tools.getBoundingClientRect().left)+'px',top:(at.top-tools.getBoundingClientRect().top)+'px',right:'auto',bottom:'auto',maxHeight:at.maxHeight+'px'});}
}
function choosePassage(id,y=null,quote='',quoteLanguage=null){
  if(!paragraphMap.has(id))return;const p=paragraphMap.get(id),v=passageView(p);quoteLanguage=visibleQuoteLanguage(p,{...v,mode:state.mode==='parallel'?'parallel':v.mode,translationHidden:state.mode==='parallel'&&state.parallelStyle==='reveal'&&!revealedTranslations.has(id+':'+v.variant)},quoteLanguage);const node=$('chapter-text').querySelector('[data-id="'+id+'"]'),pin=pagination.active?anchor():{passageId:id,offset:node.getBoundingClientRect().top};dismissTools();selectedId=id;selectedQuote=quote;selectedQuoteLanguage=quoteLanguage;selectionKind='passage';node.classList.add('is-selected');
  try{selectedExcerpt=paragraphSnapshot(book,p,p.chapterId,quoteLanguage,v.variant);}catch{selectedExcerpt=null;}$('show-share').hidden=true;$('paragraph-tools').dataset.excerpt='false';$('show-original').hidden=state.mode==='parallel'||chineseOriginalOnly(book);$('show-original').textContent=v.mode==='en'?'译文':'原文';$('show-annotations').hidden=!p.annotationIds.length&&!p.termIds.length;
  document.dispatchEvent(new CustomEvent("reader:selection",{detail:{passageId:id}}));positionTools();if(!$('note-panel').hidden&&!allRecords)renderPanel();restoreAnchor(pin);positionTools();
}
function proseForPart(part){const passage=document.getElementById(part.passageId);return passage&&[...passage.querySelectorAll('p[data-reading-layer]')].find(node=>(node.dataset.readingLayer==='original'?'en':'zh')===part.language&&(part.language==='en'||node.dataset.variant===part.variant));}
function selectHighlight(row,{passageId}={}){
  closePanel();const first=row.parts[0],target=row.parts.find(part=>part.passageId===passageId)||first,p=paragraphMap.get(first.passageId);if(!p)return;
  state.mode=first.language==='en'?'en':'zh';state.variant=first.variant;overrides={};
  if(!document.getElementById(p.id)||state.chapterId!==p.chapterId)changeChapter(p.chapterId,p.id);overrides=Object.fromEntries(row.parts.map(part=>[part.passageId,{mode:part.language==='en'?'en':'zh',variant:part.variant}]));updateText();
  window.marginaliaReader?.goToPassage(p.id);choosePassage(p.id,null,row.parts.map(part=>part.text).join('\n\n'),first.language);
  selectedExcerpt=structuredClone(row);selectionKind='excerpt';$('paragraph-tools').dataset.excerpt='true';$('show-share').hidden=false;highlights.updateTools(selectedExcerpt);positionTools();
  const prose=proseForPart(target),rect=prose&&prose.textContent.slice(target.start,target.end)===target.text&&textRange(document,prose,target.start,target.end)?.getClientRects()[0];if(rect){if(pagination.active)pagination.revealRect(rect,target.passageId);else window.scrollBy(0,rect.top-160);persist();positionTools();}
  if(row.parts.some(part=>{const source=paragraphMap.get(part.passageId),text=part.language==='en'?source?.original:source?.translations?.[part.variant]?.text;return text?.slice(part.start,part.end)!==part.text;}))highlights.notify('当前文字已更新，保留当时的高亮摘录；请核对后重新标记。');
}
function mountPanel(){
  const panel=$('note-panel'),node=$('chapter-text').querySelector('[data-id="'+selectedId+'"]');
  const inline=!pagination.active&&(innerWidth<1320||state.mode==='parallel');panel.classList.toggle('is-inline',inline);
  if(inline&&node)node.after(panel);else if(panel.parentNode!==document.body)document.body.append(panel);
}
function closePanel(){queueReadingFlow();
  const a=anchor();$('note-panel').hidden=true;document.body.classList.remove('has-panel');clearPanelTextHighlight();for(const node of $('chapter-text').querySelectorAll('.is-selected,.is-panel-anchor'))node.classList.remove('is-selected','is-panel-anchor');if($('note-panel').parentNode!==document.body)document.body.append($('note-panel'));restoreAnchor(a);document.dispatchEvent(new CustomEvent('reader:selection-end'));
}
function recordNode(record,type,withAnchor=false){
  const row=el('section','saved-record');
  if(withAnchor){const p=paragraphMap.get(record.passageId);row.append(button((type==='question'?'问题':'想法')+' · §'+p.section,()=>{closePanel();changeChapter(p.chapterId,p.id);choosePassage(p.id);openPanel(type);}));}
  row.append(el('p','',record.text));const date=el('time','',new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',timeZone:'Asia/Singapore'}).format(new Date(record.createdAt)));date.dateTime=record.createdAt;row.append(date);return row;
}
function clearPanelTextHighlight(){
  if(typeof CSS!=='undefined'&&CSS.highlights)CSS.highlights.delete('panel-reference');
  for(const mark of $('chapter-text').querySelectorAll('.panel-reference-mark')){const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize();}
}
function syncPanelTextHighlight(){
  clearPanelTextHighlight();if(selectionKind!=='excerpt'||!selectedExcerpt?.parts?.length)return;
  const entries=[];for(const part of selectedExcerpt.parts){const passage=$('chapter-text').querySelector('[data-id="'+part.passageId+'"]');if(!passage)continue;const candidates=[...passage.querySelectorAll('p[lang]')],prose=candidates.find(node=>(node.dataset.readingLayer==='original'?'en':node.lang==='en'?'en':'zh')===part.language&&(part.language==='en'||node.dataset.variant===part.variant));if(!prose||part.start<0||part.end>prose.textContent.length||prose.textContent.slice(part.start,part.end)!==part.text)continue;entries.push({prose,part});}
  if(typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight!=='undefined'){const ranges=[];for(const {prose,part}of entries){const range=textRange(document,prose,part.start,part.end);if(range)ranges.push(range);}if(ranges.length)CSS.highlights.set('panel-reference',new Highlight(...ranges));return;}
  for(const {prose,part}of entries){const range=textRange(document,prose,part.start,part.end);if(!range)continue;const mark=el('mark','panel-reference-mark');mark.append(range.extractContents());range.insertNode(mark);}
}
function renderPanelSource(p){
  const excerpt=selectionKind==='excerpt'&&selectedExcerpt?.parts?.length?selectedExcerpt:null,v=passageView(p),language=excerpt?.parts[0]?.language||visibleQuoteLanguage(p,v,selectedQuoteLanguage),variant=excerpt?.parts[0]?.variant||v.variant;
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
    if(!readerSession?.emailAvailable&&!readerSession?.localAvailable&&!readerSession?.providers?.google&&!readerSession?.providers?.apple){content.append(el('p','empty-state','邮箱登录准备中，个人笔记暂未开放。你可以继续阅读中文试读、切换译法和核对原文。'));return;}
    content.append(el('p','empty-state','登录后，把想法和问题留在自己的书房。回来时仍在当前原文段落。'));const login=el('a','quiet-button','登录后回到这段 →');login.href=readerLoginUrl({bookId:selectedBookId,passageId:selectedId,note:allRecords?'records':panelTab==='question'?'question':'comment'});content.append(login);return;
  }
  if(recordsPending){content.append(el('p','empty-state','正在同步你的记录，正文可以先读。'));return;}
  content.append(el('p','empty-state','个人记录暂时无法读取。原来的记录不会被覆盖，正文仍可继续阅读。'));const retry=button(recordsRetryBusy?'正在读取…':'重新读取记录',recoverRecords);retry.className='records-retry';retry.disabled=recordsRetryBusy;content.append(retry);if(recordsRetryNotice){const notice=el('p','form-status',recordsRetryNotice);notice.setAttribute('role','status');content.append(notice);}
}
async function recoverRecords(event){
  event?.stopPropagation();if(recordsRetryBusy)return;const focus=trackActionFocus(document,event?.currentTarget);recordsRetryBusy=true;recordsRetryNotice='';renderPanel();
  try{const fresh=await api('/api/records');if(!Array.isArray(fresh.comments)||!Array.isArray(fresh.questions))throw Error('记录格式不完整');recordsPositionUnresolved=recoveredPositionNeedsChoice(progressSync.revision,fresh.position);records=fresh;recordsUnavailable=false;document.dispatchEvent(new CustomEvent('reader:records-updated'));if(recordsPositionUnresolved){clearTimeout(persistTimer);$('progress-notice').hidden=false;announce('记录已读取。阅读位置已在另一处更新，请选择从哪里继续。');}else{progressSync.adopt(fresh.position?.revision||0);persist();}}
  catch{recordsRetryNotice='记录仍暂时无法读取，请稍后重试；原文和已有草稿保留。';}
  finally{recordsRetryBusy=false;if(!$('note-panel').hidden){renderPanel();focus.restore(recordsUnavailable?$('panel-content').querySelector('button'):recordsPositionUnresolved?$('progress-use-remote'):document.querySelector('[data-panel-tab="'+panelTab+'"]'));}else focus.stop();}
}
function renderPanel(){
  const content=$('panel-content');content.replaceChildren();const p=paragraphMap.get(selectedId);if(!p)return;
  $('panel-title').textContent=allRecords?'我的记录':panelTab==='annotations'?'段落注解':panelTab==='question'?'留下问题':'写下想法';
  $('panel-anchor').textContent='§'+p.section+(p.source?.printedPage?' · 原书 '+p.source.printedPage+' 页':p.source?.pdfPage?' · PDF 第 '+p.source.pdfPage+' 页':' · 自动分段');
  for(const tab of document.querySelectorAll('[data-panel-tab]')){const active=tab.dataset.panelTab===panelTab;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}content.setAttribute('aria-labelledby','panel-tab-'+panelTab);
  document.querySelector('.panel-tabs').hidden=allRecords;$('panel-source').hidden=allRecords;
  if(!allRecords){renderPanelSource(p);syncPanelTextHighlight();}else clearPanelTextHighlight();
  if(allRecords){
    content.append(el('h2','all-records-title','我的记录'));
    if(recordsUnavailable){renderRecordsAccess(content);mountPanel();return;}
    const marks=activeHighlights(records);for(const row of marks)content.append(highlights.recordNode(row));
    if(!marks.length&&!records.comments.length&&!records.questions.length)content.append(el('p','empty-state','还没有留下记录。可以选中文字高亮，或点击正文写下一点想法。'));
    for(const record of records.comments)content.append(recordNode(record,'comment',true));for(const record of records.questions)content.append(recordNode(record,'question',true));mountPanel();return;
  }
  if(panelTab==='annotations'){
    for(const id of p.annotationIds){const n=notesMap.get(id);if(!n)continue;const block=el('section','annotation');const labels={difficulty:'理解难点',paradox:'悖论',example:'生活例子',context:'背景',cross_reference:'关联阅读',term:'术语'};block.append(el('p','attribution',(labels[n.kind]||'注解')+' · '+(n.attribution==='editorial'?'编辑补充':'原书注释')),el('h3','',n.title),el('p','',n.text));content.append(block);}
    if(p.termIds.length){const details=el('details','term-definition');details.append(el('summary','','关键英文'));for(const id of p.termIds){const t=termsMap.get(id);if(!t)continue;const line=el('p');line.append(el('strong','',t.zh+' · '+t.en),el('br'),document.createTextNode(t.definition));details.append(line);}content.append(details);}
    if(!p.annotationIds.length&&!p.termIds.length)content.append(el('p','empty-state','这一段没有编辑旁注。'));mountPanel();return;
  }
  const type=panelTab==='question'?'question':'comment',key=type==='question'?'questions':'comments',draftId=type+':'+p.id;
  if(recordsUnavailable){renderRecordsAccess(content);mountPanel();return;}
  noteDrafts.activate?.(draftId);if(noteDrafts.reconcile(draftId,records[key]))persistDrafts();
  const form=el('form','composer'),label=el('label','',type==='question'?'这个问题值得留下吗？':'用自己的话写下来'),area=el('textarea');area.id='thought-text';area.maxLength=2000;area.placeholder=type==='question'?'写下此刻没有想通的地方…':'先写你的理解，不必写完整…';label.htmlFor=area.id;area.value=noteDrafts.text(draftId);
  const save=button(''),pendingHint=el('p','form-status'),status=el('p','form-status');save.type='submit';status.setAttribute('aria-live','polite');
  const updateComposer=()=>{const pending=noteDrafts.pending(draftId),busy=noteDrafts.busy(draftId);save.disabled=busy||!noteDrafts.text(draftId).trim()&&!pending;save.textContent=busy?'正在保存…':pending?'重试上次保存':type==='question'?'保存问题':'保存想法';pendingHint.hidden=!pending;pendingHint.textContent=pending?'待确认的提交：「'+pending.text.slice(0,80)+(pending.text.length>80?'…':'')+'」 重试先确认这次提交，新写的草稿会保留。':'';};
  updateComposer();form.append(label,area,pendingHint,save,status);content.append(form);
  area.addEventListener('input',()=>{noteDrafts.edit(draftId,area.value);updateComposer();status.textContent=draftSaveReceipt({durable:persistDrafts()});});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(noteDrafts.busy(draftId)||!area.value.trim()&&!noteDrafts.pending(draftId))return;
    const draftEntryId=noteDrafts.activeId?.(draftId);noteDrafts.edit(draftId,area.value);const submission=noteDrafts.begin(draftId,{passageId:p.id,contentVersion:book.contentVersion,quote:selectedQuote,quoteLanguage:selectedQuoteLanguage==='en'?book.sourceLanguage||'en':'zh',quoteOrigin:selectedQuoteLanguage==='en'?'original':'translation'},()=>crypto.randomUUID());const durable=persistDrafts();updateComposer();status.textContent=durable?'正在保存':'正在保存；浏览器无法保留草稿，请先复制文字。';
    try{const record=await api('/api/'+key,submission);if(!noteDrafts.acknowledge(draftId,record,draftEntryId))throw Error('服务尚未确认这次提交。');if(!records[key].some(r=>r.id===record.id))records[key].push(record);const cached=persistDrafts();if(form.isConnected){area.value=noteDrafts.text(draftId);status.setAttribute('role','status');status.textContent=noteSaveReceipt({confirmed:true,durable:cached,hasDraft:!!area.value});content.append(recordNode(record,type));}}
    catch(error){if(form.isConnected){status.setAttribute('role','alert');status.textContent=(error.status===413?error.message+'。':'')+noteSaveReceipt({durable:persistDrafts()});}}
    finally{noteDrafts.finish(draftId,draftEntryId);if(form.isConnected)updateComposer();else if(!allRecords&&!$('note-panel').hidden&&selectedId===p.id&&panelTab===type)renderPanel();}
  });
  for(const record of records[key].filter(r=>r.passageId===p.id))content.append(recordNode(record,type));mountPanel();
}
function openPanel(tab){
  if(!selectedId)return;const a=anchor();panelTab=tab;allRecords=false;$('note-panel').hidden=false;document.body.classList.add('has-panel');for(const node of $('chapter-text').querySelectorAll('.is-selected'))node.classList.add('is-panel-anchor');renderPanel();restoreAnchor(a);dismissTools({preserveSelection:true});document.querySelector('[data-panel-tab="'+tab+'"]')?.focus({preventScroll:true});if($('note-panel').classList.contains('is-inline'))$('note-panel').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function updateText(){flow?.invalidatePrepared();prepareFollowingChapter();const a=anchor();for(const node of $('chapter-text').querySelectorAll('.passage'))fillPassage(node,paragraphMap.get(node.dataset.id));applyAppearance();if(!$('note-panel').hidden)renderPanel();restoreAnchor(a);if(!$('paragraph-tools').hidden)positionTools();persist();document.dispatchEvent(new CustomEvent('reader:layout'));}
async function boot(){
  const generation=++loadGeneration,arrivalTicket=arrival.start();entryInteracted=false;restoringProgress=true;
  const loading=startReadingLoad({readBook:()=>api('/api/book'),readRecords:()=>api('/api/records')});
  try{
    book=await loading.book;if(generation!==loadGeneration)return;if(selectedBookId){try{noteDrafts=createReadingDraftStore({storage:localStorage,scope:readerStorageKey('marginalia-reading-ending-drafts-v1'),book});noteDraftError=null;}catch(error){noteDraftError=error;announce('本机草稿暂时无法读取，原数据保留。请先另存待同步数据或复制新写的文字。');}}if(book.title?.zh){$('running-book-title').textContent=book.title.zh;$('toc-book-title').textContent=book.title.zh;}if(selectedBookId){state.chapterId=book.readingStart?.chapterId||book.chapters[0].id;state.mode='en';recordsUnavailable=!readerSession?.user;}else recordsUnavailable=false;const initialRecords=loading.peekRecords();recordsPending=initialRecords===undefined;records=initialRecords||{comments:[],questions:[],readingSessions:[],readingMilestones:[],position:null};recordsUnavailable=selectedBookId&&!readerSession?.user||!initialRecords;
    paragraphs=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,section:s.number,chapterId:s.chapterId})));paragraphMap=new Map(paragraphs.map(p=>[p.id,p]));notesMap=new Map(book.annotations.map(n=>[n.id,n]));termsMap=new Map(book.glossary.map(t=>[t.id,t]));
    let localPosition=null;try{localPosition=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
    let position=chooseReadingPosition({book,remote:records.position,local:localPosition,remoteAvailable:!recordsUnavailable});
    progressSync.adopt(recordsUnavailable?(position?.baseRevision??position?.revision??0):(records.position?.revision||0));
    if(position&&Number.isFinite(position.offset)&&Math.abs(position.offset)<=4000&&paragraphMap.has(position.passageId)){position.chapterId=paragraphMap.get(position.passageId).chapterId;state.chapterId=position.chapterId;Object.assign(state,openingReadingPreferences(position));}else position=null;
    const requestedEntry=resolveReaderEntry(book,new URLSearchParams(location.search));if(requestedEntry){state.chapterId=requestedEntry.chapterId;if(requestedEntry.note||requestedEntry.action==='translate')state.mode='en';position={...(position||{}),...state,chapterId:requestedEntry.chapterId,passageId:requestedEntry.passageId,offset:requestedEntry.offset,withinParagraph:undefined,contentVersion:book.contentVersion};}
    const sampleEntry=!requestedEntry&&chineseSampleEntry(book,new URLSearchParams(location.search));if(sampleEntry){Object.assign(state,{chapterId:sampleEntry.chapterId,mode:sampleEntry.mode,variant:sampleEntry.variant});position={...(position||{}),...state,...sampleEntry,withinParagraph:undefined,contentVersion:book.contentVersion};const query=new URLSearchParams(location.search);query.delete('sample');history.replaceState(null,'',location.pathname+'?'+query);}
    if(selectedBookId){const onlyOriginal=chineseOriginalOnly(book);for(const option of $('view-mode').options){option.disabled=onlyOriginal&&option.value!=='en';if(option.value==='en')option.textContent=book.sourceLanguage==='zh'?'中文原文':'英文原文';if(option.value==='zh')option.textContent='中文译文';if(option.value==='parallel')option.textContent=book.sourceLanguage==='zh'?'原文与译文对照':'中英对照';}if(onlyOriginal)state.mode='en';}
    renderChapter();arrival.finish(arrivalTicket);$('load-error').hidden=true;await document.fonts.ready;if(position){restoreAnchor(position);cachePosition({...position,contentVersion:book.contentVersion,chapterLabel:resumeSummary(book,position)?.label});}else if(selectedBookId&&book.readingStart)restoreAnchor({...book.readingStart,offset:160});restoringProgress=false;document.body.dataset.ready='true';document.body.dataset.readableMs=String(Math.round(performance.now()));document.body.dataset.recordsState=recordsPending?'pending':recordsUnavailable?'unavailable':'ready';document.dispatchEvent(new CustomEvent('reader:ready'));performance.mark('reader:readable');queueReadingFlow();if(recordsPending)loading.records.then(fresh=>adoptLoadedRecords(fresh,{generation,explicitEntry:!!requestedEntry||!!sampleEntry}));if(requestedEntry){const query=new URLSearchParams(location.search);query.delete('passage');query.delete('note');query.delete('action');history.replaceState(null,'',location.pathname+'?'+query);if(requestedEntry.note){choosePassage(requestedEntry.passageId,null,paragraphMap.get(requestedEntry.passageId).original,'en');openPanel(requestedEntry.note==='question'?'question':'comment');if(requestedEntry.note==='records'){allRecords=true;renderPanel();}}else if(requestedEntry.action==='translate'){choosePassage(requestedEntry.passageId,null,'','en');}}
  }catch{if(generation===loadGeneration){arrival.finish(arrivalTicket);$('load-error').hidden=false;}}
}
async function adoptLoadedRecords(fresh,{generation,explicitEntry}){
  if(generation!==loadGeneration)return;recordsPending=false;document.body.dataset.recordsState=fresh?'ready':'unavailable';
  if(!fresh||!Array.isArray(fresh.comments)||!Array.isArray(fresh.questions)){if(!$('note-panel').hidden)renderPanel();return;}
  records=mergeLoadedReadingRecords(fresh,records);recordsUnavailable=!!selectedBookId&&!readerSession?.user;
  const remote=resolveReadingPosition(book,fresh.position);
  if(remote&&!explicitEntry){
    if(!entryInteracted){
      let local=null;try{local=JSON.parse(localStorage.getItem(progressKey)||'null');}catch{}
      const chosen=chooseReadingPosition({book,remote,local});
      if(chosen){restoringProgress=true;Object.assign(state,{chapterId:chosen.chapterId},openingReadingPreferences(chosen));renderChapter();restoreAnchor(chosen);cachePosition({...chosen,chapterLabel:resumeSummary(book,chosen)?.label});restoringProgress=false;}
    }else if(recoveredPositionNeedsChoice(progressSync.revision,fresh.position)){
      recordsPositionUnresolved=true;clearTimeout(persistTimer);$('progress-notice').hidden=false;announce('上次的位置已就绪。当前书页保留，可以选择回去或继续读这里。');
    }
  }
  if(!recordsPositionUnresolved){progressSync.adopt(fresh.position?.revision||0);if(deferredProgress)persist();}
  if(!$('note-panel').hidden)renderPanel();document.dispatchEvent(new CustomEvent('reader:records-updated'));queueReadingFlow();
}
for(const type of ['pointerdown','wheel','touchstart','keydown'])document.addEventListener(type,event=>{if(event.isTrusted)entryInteracted=true;},{capture:true,passive:true});
$('continuous-reading').addEventListener('change',event=>{
  const a=anchor();if(a&&paragraphMap.has(a.passageId))state.chapterId=paragraphMap.get(a.passageId).chapterId;continuous=event.target.checked;document.body.dataset.continuous=String(continuous);try{localStorage.setItem(readerStorageKey('marginalia-continuous-v1'),String(continuous));}catch{}
  closePanel();dismissTools();renderChapter();restoreAnchor(a);queueReadingFlow();persist();
});
document.addEventListener('click',e=>{
  if(e.target.closest('#note-panel,#paragraph-tools,#reading-session,dialog,.library-chat-launcher,.reading-header,.focus-actions,.experience-surface,.source-evidence'))return;
  const selection=getSelection();if(selection?.toString().trim()&&selectedExcerpt&&$('paragraph-tools').dataset.excerpt==='true')return;
  const node=e.target.closest('.passage');if(node){if(!getSelection()?.toString()){const layer=e.target.closest('p')?.dataset.readingLayer;choosePassage(node.dataset.id,e.clientY,'',layer==='original'?'en':layer==='translation'?'zh':null);}return;}
  dismissTools();closePanel();
});
function captureExcerpt(y){
  try{const excerpt=captureDOMSelection(getSelection(),paragraphMap,book);if(!excerpt){if(getSelection()?.toString().trim()){selectedExcerpt=null;dismissTools();}return;}if(selectionKind==='excerpt'&&!$('paragraph-tools').hidden&&selectedExcerpt&&highlightKey(selectedExcerpt)===highlightKey(excerpt))return;const first=excerpt.parts[0];choosePassage(first.passageId,y,excerpt.parts.map(part=>part.text).join('\n\n'),first.language);selectedExcerpt=excerpt;selectionKind='excerpt';for(const part of excerpt.parts)document.getElementById(part.passageId)?.classList.add('is-selected');$('show-share').hidden=false;$('paragraph-tools').dataset.excerpt='true';highlights.updateTools(excerpt);positionTools();}
  catch(error){selectedExcerpt=null;dismissTools();announce(error.message||'请重新选择正文。');}
}
document.addEventListener('pointerup',e=>{if(e.button!==0||e.target.closest('#note-panel,#paragraph-tools,#reading-session,dialog,.library-chat-launcher,[popover],.experience-surface,.source-evidence')||!book)return;captureExcerpt(e.clientY);});
let excerptTimer;document.addEventListener('selectionchange',()=>{clearTimeout(excerptTimer);if(book&&getSelection()?.toString().trim()&&$('chapter-text').contains(getSelection().anchorNode))excerptTimer=setTimeout(()=>captureExcerpt(),120);});
document.addEventListener('keyup',e=>{if(book&&!e.target.closest('input,textarea,select,dialog,.library-chat-launcher,[popover]')&&(e.key==='Shift'||e.shiftKey))captureExcerpt();});
document.addEventListener('keydown',e=>{
  if(readerInteractionBlocked(document,e.target))return;
  if(e.target.closest('input,textarea,select')||e.target.isContentEditable)return;
  if(e.key==='Escape'){
    if(!$('paragraph-tools').hidden){dismissTools();return;}if(!$('note-panel').hidden){closePanel();$('chapter-text').querySelector('[data-id="'+selectedId+'"]')?.focus({preventScroll:true});return;}
    if(!document.fullscreenElement)immersion.closeTools({restoreFocus:true});return;
  }
  if(e.key==='Enter'&&e.target.matches('.passage')){e.preventDefault();choosePassage(e.target.dataset.id);$('paragraph-tools').querySelector('button:not([hidden])')?.focus();}
  if(e.key.toLowerCase()==='f'&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();immersion.toggleFullscreen();}
});
function openContents(){if(!book)return;dismissTools();renderToc();$('toc-dialog').showModal();$('open-toc').setAttribute('aria-expanded','true');const list=$('toc-list'),active=list.querySelector('[aria-current=location]');if(active){const top=active.offsetTop-list.offsetTop;if(top<list.scrollTop||top+active.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=Math.max(0,top-list.clientHeight/3);}}
$('toc-dialog').addEventListener('close',()=>$('open-toc').setAttribute('aria-expanded','false'));
$('open-toc').addEventListener('click',openContents);$('open-settings').addEventListener('click',()=>{dismissTools();$('settings-dialog').showModal();});
for(const b of document.querySelectorAll('[data-close-dialog]'))b.addEventListener('click',()=>$(b.dataset.closeDialog).close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();});
$('page-layout').addEventListener('change',e=>{const a=anchor();state.chapterId=paragraphMap.get(a?.passageId)?.chapterId||state.chapterId;Object.assign(state,normalizeAppearance({...state,pageLayout:e.target.value}));dismissTools();closePanel();renderChapter();restoreAnchor(a);persist();document.dispatchEvent(new CustomEvent('reader:layout'));});
$('view-mode').addEventListener('change',e=>{state.mode=e.target.value;overrides={};dismissTools();updateText();});
mountParallelSettings({document,onChange:adjustAppearance});
$('translation-variant').addEventListener('change',e=>{state.variant=e.target.value;for(const value of Object.values(overrides))delete value.variant;updateText();});
for(const b of document.querySelectorAll('[data-theme-choice]'))b.addEventListener('click',()=>adjustAppearance({theme:b.dataset.themeChoice}));
for(const b of document.querySelectorAll('[data-font-family]'))b.addEventListener('click',()=>adjustAppearance({fontFamily:b.dataset.fontFamily}));
$('font-size').addEventListener('input',e=>adjustAppearance({font:Number(e.target.value)}));
$('first-line-indent').addEventListener('change',e=>adjustAppearance({indent:e.target.checked}));
$('reset-appearance').addEventListener('click',()=>{adjustAppearance(appearanceDefaults);announce('已恢复默认排版与纸面，阅读位置和记录已保留。');});
$('settings-chapters').addEventListener('click',()=>{$('settings-dialog').close();openContents();});
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
$('import-records').addEventListener('click',()=>$('records-file').click());$('records-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;clearTimeout(persistTimer);try{if(file.size>4*1024*1024)throw Error('记录包过大');const imported=JSON.parse(await file.text());await api('/api/records/import',imported);records=await api('/api/records');document.dispatchEvent(new CustomEvent('reader:records-updated'));if(imported.position&&records.position){state.mode=records.position.mode;state.variant=records.position.variant;overrides={};document.dispatchEvent(new CustomEvent('reader:jump'));updateText();adjustAppearance(records.position);}$('import-status').setAttribute('role','status');$('import-status').textContent='记录已合并，排版已恢复；重复记录不会重复生成';}catch(error){$('import-status').textContent=error.message||'记录无法导入';$('import-status').setAttribute('role','alert');}finally{e.target.value='';}});
$('previous-chapter').addEventListener('click',()=>{const n=book.chapters.findIndex(c=>c.id===state.chapterId)-1;if(book.chapters[n])changeChapter(book.chapters[n].id);});$('next-chapter').addEventListener('click',()=>{const n=book.chapters.findIndex(c=>c.id===state.chapterId)+1;if(book.chapters[n])changeChapter(book.chapters[n].id);});
for(const type of ['wheel','touchmove'])document.addEventListener(type,event=>{if(event.isTrusted)allowScrollSave=true;},{passive:true});
document.addEventListener('keydown',event=>{if(event.isTrusted&&!event.target.closest('input,textarea,select')&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))allowScrollSave=true;});
let scrollFrame=false;document.addEventListener('scroll',()=>{if(scrollFrame)return;scrollFrame=true;requestAnimationFrame(()=>{scrollFrame=false;syncFlowChapter();extendReadingFlow();if(!$('paragraph-tools').hidden)positionTools();if(allowScrollSave)persist();});},{passive:true});
async function reconcileProgress(useRemote,event){
  const trigger=event?.currentTarget,focus=trackActionFocus(document,trigger);
  const buttons=[$('progress-use-remote'),$('progress-keep-here')];buttons.forEach(b=>b.disabled=true);restoringProgress=true;progressSequence++;clearTimeout(persistTimer);
  try{
    const fresh=await api('/api/records'),position=resolveReadingPosition(book,fresh.position);focus.stop();if(useRemote&&!position)throw Error('较新的位置暂时无法对应原文，请继续读这里。');clearTimeout(persistTimer);progressSync.adopt(fresh.position?.revision||0);recordsPositionUnresolved=false;
    if(useRemote){closePanel();dismissTools();records=fresh;Object.assign(state,{chapterId:position.chapterId},openingReadingPreferences(position));overrides={};selectedId=null;renderChapter();restoreAnchor(position);cachePosition({...position,contentVersion:book.contentVersion,chapterLabel:resumeSummary(book,position)?.label,pending:false});allowScrollSave=false;announce('已回到另一处较新的阅读位置。');}
    else{restoringProgress=false;persist();announce('继续读这里，当前位置会保存到自己的书房。');}
    $('progress-notice').hidden=true;
  }catch(error){announce(error.message||'阅读位置暂时无法同步');}finally{restoringProgress=false;buttons.forEach(b=>b.disabled=false);focus.restore($('progress-notice').hidden?document.getElementById(anchor()?.passageId)||$('book-page'):trigger);}
}
$('progress-use-remote').addEventListener('click',event=>reconcileProgress(true,event));$('progress-keep-here').addEventListener('click',event=>reconcileProgress(false,event));
new ResizeObserver(()=>{if(!$('paragraph-tools').hidden)positionTools();}).observe($('paragraph-tools'));
document.addEventListener('reader:layout',queueReadingFlow);for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',queueReadingFlow);
window.addEventListener('resize',()=>{queueReadingFlow();if(!$('note-panel').hidden)mountPanel();if(!$('paragraph-tools').hidden)positionTools();});
$('retry-load').addEventListener('click',async event=>{const focus=trackActionFocus(document,event.currentTarget);$('load-error').hidden=true;$('loading').hidden=false;await boot();focus.restore($('load-error').hidden?$('book-page'):$('retry-load'));});
window.marginaliaReader={getBook:()=>book,retryPositionSave:()=>{if(recordsUnavailable||recordsPositionUnresolved||progressSync.paused)return Promise.resolve(null);clearTimeout(persistTimer);const position=captureProgress();if(!position)return Promise.resolve(null);cachePosition({...position,pending:true});return progressSync.save(position);},getPositionSaveState:()=>positionSaveState(latestPositionAttempt,confirmedPosition||records?.position,{durable:latestPositionDurable,unresolved:recordsPositionUnresolved||progressSync.paused}),getPersonalRecords:()=>records,areRecordsAvailable:()=>!recordsUnavailable,getState:()=>({...state}),getAudioSelection:()=>{if(selectedExcerpt)return structuredClone(selectedExcerpt);const p=paragraphMap.get(selectedId);if(!p)return null;const v=passageView(p);return paragraphSnapshot(book,p,p.chapterId,selectedQuoteLanguage,v.variant);},getExcerpt:()=>selectedExcerpt?structuredClone(selectedExcerpt):null,getChapterId:()=>state.chapterId,isPassageVisible:id=>{const node=document.getElementById(id);return !!node&&(pagination.active?!!pagination.visibleRect(node):node.getBoundingClientRect().bottom>0&&node.getBoundingClientRect().top<innerHeight);},getSelectedId:()=>selectedId,isSelectionActive:()=>!$('paragraph-tools').hidden||!$('note-panel').hidden,getAnchor:()=>{const a=anchor();return a?{...a,chapterId:paragraphMap.get(a.passageId)?.chapterId||state.chapterId}:null;},restoreAnchor:a=>{if(a&&document.getElementById(a.passageId)){restoreAnchor(a);persist();}},goToPassage:id=>{const p=paragraphMap.get(id);if(!p)return;if(p.chapterId!==state.chapterId)changeChapter(p.chapterId,id);else{restoreAnchor({passageId:id,offset:document.body.classList.contains('is-focused')?45:100});persist();}document.dispatchEvent(new CustomEvent('reader:jump',{detail:{passageId:id}}));},dismissTools};
document.addEventListener('reader:translation',e=>{const p=paragraphMap.get(e.detail.id);if(!p)return;p.translations=e.detail.translations;const raw=book.sections.flatMap(s=>s.paragraphs).find(x=>x.id===p.id);if(raw)raw.translations=p.translations;const reveal=e.detail.reveal!==false&&selectedId===p.id;if(reveal)state.mode='parallel';if(document.getElementById(p.id))updateText();announce(reveal?'这段双译草稿已保存，可随时核对原文。':'之前选择的段落双译已保存，可以继续阅读。');});
mountReaderConversation({bookId:selectedBookId,session:readerSession,getReader:()=>window.marginaliaReader,root:$('reader-conversation')});
boot();

document.addEventListener('reader:record-saved',e=>{const {type,record}=e.detail||{},field=type==='comment'?'comments':type==='question'?'questions':null;if(!field||!record||record.origin!=='user'||!paragraphMap.has(record.passageId)||record.bookId!==book?.bookId||record.contentVersion!==book?.contentVersion)return;if(!records[field].some(r=>r.id===record.id))records[field].push(record);if(!$('note-panel').hidden)renderPanel();document.dispatchEvent(new CustomEvent('reader:records-updated'));});
document.addEventListener('reader:milestone-saved',e=>{const record=e.detail?.record;if(!record||record.origin!=='user'||record.bookId!==book?.bookId||record.contentVersion!==book?.contentVersion)return;records.readingMilestones??=[];if(!records.readingMilestones.some(m=>m.id===record.id))records.readingMilestones.push(record);document.dispatchEvent(new CustomEvent('reader:records-updated'));});
