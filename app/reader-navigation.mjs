import {chineseSampleNotice} from './catalog-sample.mjs';
import {introductionFor} from './book-introduction.mjs';
import {mountPopover} from './popover-controls.mjs';
import {t,createUiLabels,onUiLocaleChange} from './ui-locale.mjs';

const legacyLabel=(id,params,fallback)=>fallback;

function sourceLink(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
// One naming for "where am I" shared by the bookplate and the top chapter chooser.
// Explicit chapters read 第 N 章; automatic reading fragments and front matter stay honest.
export function currentChapterLabel(book,chapter,format=legacyLabel){
  if(!book||!chapter)return '';
  const grouped=book.source?.structure==='automatic_groups';
  const label=grouped?format('navigation.fragment',{number:chapter.number},'阅读片段 '+chapter.number):chapter.kind&&chapter.kind!=='body'?'':format('navigation.chapter',{number:chapter.number},'第 '+chapter.number+' 章');
  return [label,chapter.title?.zh].filter(Boolean).join(' · ');
}
export function bookIntroduction(book,chapter,format=legacyLabel){
  const grouped=book.source?.structure==='automatic_groups',chapters=book.chapters||[];
  const count=grouped?chapters.length:chapters.filter(c=>!c.kind||c.kind==='body').length;
  return {title:book.title?.zh||format('reader.b1.untitled',{},'未命名书籍'),originalTitle:book.title?.en&&book.title.en!==book.title.zh?book.title.en:'',author:book.author||'',description:introductionFor(book).text||format('reader.b1.noIntroduction',{},'这本书还没有简介。'),extent:format(grouped?'reader.b1.fragmentCount':'reader.b1.chapterCount',{count},count+(grouped?' 个阅读片段':' 章')),current:currentChapterLabel(book,chapter,format),sourceUrl:sourceLink(book.source?.url),sample:chineseSampleNotice(book),scopeNote:typeof book.source?.scopeNote==='string'?book.source.scopeNote:'',cover:book.cover||'private'};
}

export function renderBookContents({list,book,chapterId,onNavigate,document=list.ownerDocument,labels=null}){
  const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const fixed=(tag,cls,id,params,fallback)=>{const node=make(tag,cls);if(labels)labels.text(node,id,params);else node.textContent=fallback;return node;};
  list.replaceChildren();
  for(const chapter of book.chapters){
    const current=chapter.id===chapterId,row=make('div','toc-entry'),start=make('button','toc-chapter');start.type='button';
    if(current)start.setAttribute('aria-current','location');
    const number=chapter.kind==='frontmatter'?fixed('span','toc-number','navigation.front',null,'序'):chapter.kind&&chapter.kind!=='body'?fixed('span','toc-number','navigation.back',null,'附'):make('span','toc-number',String(chapter.number).padStart(2,'0'));
    const title=make('span','toc-title');title.append(make('span','toc-title-main',chapter.title.zh));
    if(chapter.title.en&&chapter.title.en!==chapter.title.zh)title.append(make('span','toc-title-original',chapter.title.en));
    start.append(number,title,current?fixed('span','toc-current','navigation.reading',null,'在读'):make('span','toc-current',''));
    start.addEventListener('click',()=>onNavigate(chapter.id));row.append(start);
    const sections=book.sections.filter(section=>section.chapterId===chapter.id&&section.paragraphs.length);
    if(book.source?.structure!=='source_chapters'&&sections.length){
      const details=make('details','toc-section-disclosure');details.open=current;details.append(fixed('summary','','navigation.sections',null,'本章小节'));
      const links=make('div','toc-sections');
      for(const section of sections){const link=section.title?make('button','','§'+section.number+' · '+section.title):fixed('button','','navigation.section',{number:section.number},'§'+section.number+' · 小节 '+section.number);link.type='button';link.addEventListener('click',()=>onNavigate(chapter.id,section.paragraphs[0].id));links.append(link);}
      details.append(links);row.append(details);
    }
    list.append(row);
  }
}

// One shared popover controller (see popover-controls.mjs) provides light
// dismissal, Escape and focus return without a modal scrim in every browser.
export function mountBookIntroduction({document,getBook,getChapter,onOpen=()=>{}}){
  const $=id=>document.getElementById(id),trigger=$('open-book-info'),popover=$('book-info'),win=document.defaultView;
  let cached=null,fallbackText=null,disposed=false;
  function updateLabels(){
    if(disposed||!cached)return;
    $('book-info-extent').textContent=t(cached.grouped?'reader.b1.fragmentCount':'reader.b1.chapterCount',{count:cached.count});
    $('book-info-current').textContent=currentChapterLabel(cached.book,cached.chapter,t);
    const title=cached.untitled?t('reader.b1.untitled'):cached.title;
    if(cached.untitled){$('book-info-title').textContent=title;$('book-info-cover-title').textContent=title;}
    trigger.setAttribute('aria-label',t('reader.b1.aboutTitle',{title}));
    if(cached.sample)$('book-info-sample').textContent=t('reader.b1.sampleNotice',{count:cached.sample});
    if(fallbackText?.parentNode===$('book-info-description'))fallbackText.textContent=t('reader.b1.noIntroduction');
  }
  const offLocale=onUiLocaleChange(updateLabels);
  function render(){
    if(disposed)return;const book=getBook();if(!book)return;const chapter=getChapter(),info=bookIntroduction(book,chapter,t);
    cached={book:{source:{structure:book.source?.structure}},chapter:chapter?{...chapter,title:{...chapter.title}}:null,title:info.title,untitled:!book.title?.zh,grouped:book.source?.structure==='automatic_groups',count:(book.chapters||[]).filter(c=>book.source?.structure==='automatic_groups'||!c.kind||c.kind==='body').length,sample:book.chineseSample?.paragraphs};
    for(const [id,value] of [['book-info-title',info.title],['book-info-cover-title',info.title],['book-info-original-title',info.originalTitle],['book-info-author',info.author],['book-info-description',info.description],['book-info-extent',info.extent],['book-info-current',info.current],['book-info-sample',info.sample],['book-info-scope',info.scopeNote]]){$(id).textContent=value;$(id).hidden=!value;}
    fallbackText=null;if(!introductionFor(book).text){fallbackText=document.createTextNode(t('reader.b1.noIntroduction'));$('book-info-description').replaceChildren(fallbackText);}
    // Until the optional metadata read finishes, absence in the current book
    // snapshot is unknown rather than a confirmed empty account introduction.
    $('book-info-description').hidden=!introductionFor(book).text;
    updateLabels();
    popover.dataset.cover=['alice','walden','meditations'].includes(info.cover)?info.cover:'private';
    const source=$('book-info-source');source.hidden=!info.sourceUrl;if(info.sourceUrl)source.href=info.sourceUrl;else source.removeAttribute('href');
    // The current chapter lives on the chapter chooser; the metadata trigger only names the book.
    trigger.disabled=false;
  }
  function position(){
    const rect=trigger.getBoundingClientRect(),width=Math.min(380,win.innerWidth-32),top=Math.max(rect.bottom+12,$('reading-header').getBoundingClientRect().bottom+10);
    popover.style.left=Math.max(16,Math.min(rect.left+rect.width/2-width/2,win.innerWidth-width-16))+'px';
    popover.style.top=top+'px';popover.style.setProperty('--book-info-top',top+'px');
  }
  const info=mountPopover({document,element:popover,trigger});
  const offPopover=info.subscribe({beforeOpen:()=>{if(!disposed){render();position();onOpen();}}});
  const close=()=>info.close();$('close-book-info').addEventListener('click',close);
  for(const event of ['reader:ready','reader:chapter'])document.addEventListener(event,render);
  document.addEventListener('reader:jump',close);
  const resize=()=>{if(info.isOpen())position();};win.addEventListener('resize',resize);
  info.unmount=()=>{if(disposed)return;disposed=true;offLocale();offPopover();cached=null;fallbackText=null;$('close-book-info').removeEventListener('click',close);for(const event of ['reader:ready','reader:chapter'])document.removeEventListener(event,render);document.removeEventListener('reader:jump',close);win.removeEventListener('resize',resize);};
  // The one common popover handle: the reader page injects this exact instance
  // into every enhancement so no second registry copy can ever exist.
  return info;
}

// The top current-chapter entry is a real chooser: it opens the shared contents dialog
// and stays disabled until the book and its chapters are actually available.
export function mountChapterEntry({document,getBook,getChapter,onOpen}){
  const $=id=>document.getElementById(id),trigger=$('open-chapter'),label=$('running-chapter');
  if(!trigger)return {refresh:()=>{},unmount(){}};
  let cached=null,disposed=false;
  const updateLabels=()=>{if(!disposed&&label)label.textContent=cached?currentChapterLabel(cached.book,cached.chapter,t):t('navigation.choose');};
  const offLocale=onUiLocaleChange(updateLabels);
  function refresh(){
    if(disposed)return;
    const book=getBook(),chapter=getChapter?.(),ready=!!(book&&chapter&&book.chapters?.some(c=>c.id===chapter.id));
    trigger.disabled=!ready;
    cached=ready?{book:{source:{structure:book.source?.structure}},chapter:{number:chapter.number,kind:chapter.kind,title:{...chapter.title}}}:null;updateLabels();
  }
  const open=()=>{if(!disposed&&!trigger.disabled)onOpen(trigger);};trigger.addEventListener('click',open);
  for(const event of ['reader:ready','reader:chapter'])document.addEventListener(event,refresh);
  refresh();
  return {refresh,unmount(){if(disposed)return;disposed=true;offLocale();trigger.removeEventListener('click',open);for(const event of ['reader:ready','reader:chapter'])document.removeEventListener(event,refresh);}};
}

// One contents dialog serves the header directory entry, the settings entry and the
// chapter chooser. The dialog never owns a second contents model, and closing it
// (Escape included) returns focus to the control that actually opened it.
const contentsOwners=new WeakMap();
export function mountContentsDialog({document,getBook,getChapterId,onNavigate,onBeforeOpen=()=>{}}){
  const $=id=>document.getElementById(id),dialog=$('toc-dialog');
  let opener=null,disposed=false,ownedOpen=false;const token={};const labels=createUiLabels(),offLocale=onUiLocaleChange(()=>{if(!disposed)labels.refresh();});
  const triggers=()=>[$('open-toc'),$('open-chapter')].filter(Boolean);
  function render(){
    if(disposed)return false;
    const book=getBook();if(!book)return false;
    labels.clear();renderBookContents({list:$('toc-list'),book,chapterId:getChapterId(),onNavigate:(...args)=>{if(!disposed)onNavigate(...args);},document,labels});
    return true;
  }
  function open(trigger){
    if(disposed)return false;
    onBeforeOpen();
    if(!render())return false;
    opener=trigger&&typeof trigger.focus==='function'?trigger:null;ownedOpen=true;contentsOwners.set(dialog,token);
    if(!dialog.open)dialog.showModal();
    for(const node of triggers())node.setAttribute('aria-expanded',String(node===opener));
    return true;
  }
  const closed=()=>{
    if(disposed||dialog.open||!ownedOpen||contentsOwners.get(dialog)!==token)return;
    ownedOpen=false;contentsOwners.delete(dialog);
    for(const node of triggers())node.setAttribute('aria-expanded','false');
    const target=opener;opener=null;
    const restorable=target&&target.isConnected!==false&&!(target.closest&&target.closest('dialog:not([open])'));
    (restorable?target:$('open-toc'))?.focus?.({preventScroll:true});
  };dialog.addEventListener('close',closed);
  return {open,close:()=>{if(!disposed&&ownedOpen&&contentsOwners.get(dialog)===token&&dialog.open)dialog.close();},render,getOpener:()=>opener,unmount(){if(disposed)return;disposed=true;offLocale();labels.clear();dialog.removeEventListener('close',closed);if(contentsOwners.get(dialog)===token){contentsOwners.delete(dialog);ownedOpen=false;for(const node of triggers())node.setAttribute('aria-expanded','false');if(dialog.open)dialog.close();}opener=null;}};
}

// The single listen entry in the side reading-tools panel. It only reacts to an
// explicit activation; opening or changing chapters never routes through it.
export function mountListenChapterEntry({document,onListenChapter}){
  const entry=document.getElementById('listen-chapter');
  if(!entry)return null;
  const activate=()=>onListenChapter();entry.addEventListener('click',activate);
  return {entry,unmount(){entry.removeEventListener('click',activate);}};
}
