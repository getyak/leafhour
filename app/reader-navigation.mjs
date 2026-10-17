import {chineseSampleNotice} from './catalog-sample.mjs';
import {introductionFor} from './book-introduction.mjs';

function sourceLink(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
// One naming for "where am I" shared by the bookplate and the top chapter chooser.
// Explicit chapters read 第 N 章; automatic reading fragments and front matter stay honest.
export function currentChapterLabel(book,chapter){
  if(!book||!chapter)return '';
  const grouped=book.source?.structure==='automatic_groups';
  const label=grouped?'阅读片段 '+chapter.number:chapter.kind&&chapter.kind!=='body'?'':'第 '+chapter.number+' 章';
  return [label,chapter.title?.zh].filter(Boolean).join(' · ');
}
export function bookIntroduction(book,chapter){
  const grouped=book.source?.structure==='automatic_groups',chapters=book.chapters||[];
  const count=grouped?chapters.length:chapters.filter(c=>!c.kind||c.kind==='body').length;
  return {title:book.title?.zh||'未命名书籍',originalTitle:book.title?.en&&book.title.en!==book.title.zh?book.title.en:'',author:book.author||'',description:introductionFor(book).text||'这本书还没有简介。',extent:count+(grouped?' 个阅读片段':' 章'),current:currentChapterLabel(book,chapter),sourceUrl:sourceLink(book.source?.url),sample:chineseSampleNotice(book),scopeNote:typeof book.source?.scopeNote==='string'?book.source.scopeNote:'',cover:book.cover||'private'};
}

export function renderBookContents({list,book,chapterId,onNavigate,document=list.ownerDocument}){
  const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  list.replaceChildren();
  for(const chapter of book.chapters){
    const current=chapter.id===chapterId,row=make('div','toc-entry'),start=make('button','toc-chapter');start.type='button';
    if(current)start.setAttribute('aria-current','location');
    const number=make('span','toc-number',chapter.kind==='frontmatter'?'序':chapter.kind&&chapter.kind!=='body'?'附':String(chapter.number).padStart(2,'0'));
    const title=make('span','toc-title');title.append(make('span','toc-title-main',chapter.title.zh));
    if(chapter.title.en&&chapter.title.en!==chapter.title.zh)title.append(make('span','toc-title-original',chapter.title.en));
    start.append(number,title,make('span','toc-current',current?'在读':'↗'));
    start.addEventListener('click',()=>onNavigate(chapter.id));row.append(start);
    const sections=book.sections.filter(section=>section.chapterId===chapter.id&&section.paragraphs.length);
    if(book.source?.structure!=='source_chapters'&&sections.length){
      const details=make('details','toc-section-disclosure');details.open=current;details.append(make('summary','','本章小节'));
      const links=make('div','toc-sections');
      for(const section of sections){const link=make('button','','§'+section.number+' · '+(section.title||'小节 '+section.number));link.type='button';link.addEventListener('click',()=>onNavigate(chapter.id,section.paragraphs[0].id));links.append(link);}
      details.append(links);row.append(details);
    }
    list.append(row);
  }
}

// Native popovers provide light dismissal, Escape and focus return without a modal scrim.
export function mountBookIntroduction({document,getBook,getChapter,onOpen=()=>{}}){
  const $=id=>document.getElementById(id),trigger=$('open-book-info'),popover=$('book-info'),win=document.defaultView;
  const isOpen=()=>popover.matches(':popover-open');
  function render(){
    const book=getBook();if(!book)return;const info=bookIntroduction(book,getChapter());
    for(const [id,value] of [['book-info-title',info.title],['book-info-cover-title',info.title],['book-info-original-title',info.originalTitle],['book-info-author',info.author],['book-info-description',info.description],['book-info-extent',info.extent],['book-info-current',info.current],['book-info-sample',info.sample],['book-info-scope',info.scopeNote]]){$(id).textContent=value;$(id).hidden=!value;}
    popover.dataset.cover=['alice','walden','meditations'].includes(info.cover)?info.cover:'private';
    const source=$('book-info-source');source.hidden=!info.sourceUrl;if(info.sourceUrl)source.href=info.sourceUrl;else source.removeAttribute('href');
    // The current chapter lives on the chapter chooser; the metadata trigger only names the book.
    trigger.disabled=false;trigger.setAttribute('aria-label','关于《'+info.title+'》');
  }
  function position(){
    const rect=trigger.getBoundingClientRect(),width=Math.min(380,win.innerWidth-32),top=Math.max(rect.bottom+12,$('reading-header').getBoundingClientRect().bottom+10);
    popover.style.left=Math.max(16,Math.min(rect.left+rect.width/2-width/2,win.innerWidth-width-16))+'px';
    popover.style.top=top+'px';popover.style.setProperty('--book-info-top',top+'px');
  }
  popover.addEventListener('beforetoggle',event=>{trigger.setAttribute('aria-expanded',String(event.newState==='open'));if(event.newState==='open'){render();position();onOpen();}});
  popover.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(isOpen())));
  $('close-book-info').addEventListener('click',()=>{if(isOpen())popover.hidePopover();trigger.focus({preventScroll:true});});
  for(const event of ['reader:ready','reader:chapter'])document.addEventListener(event,render);
  document.addEventListener('reader:jump',()=>{if(isOpen())popover.hidePopover();});
  win.addEventListener('resize',()=>{if(isOpen())position();});
}

// The top current-chapter entry is a real chooser: it opens the shared contents dialog
// and stays disabled until the book and its chapters are actually available.
export function mountChapterEntry({document,getBook,getChapter,onOpen}){
  const $=id=>document.getElementById(id),trigger=$('open-chapter'),label=$('running-chapter');
  if(!trigger)return {refresh:()=>{}};
  function refresh(){
    const book=getBook(),chapter=getChapter?.(),ready=!!(book&&chapter&&book.chapters?.some(c=>c.id===chapter.id));
    trigger.disabled=!ready;
    if(label)label.textContent=ready?currentChapterLabel(book,chapter):'选择章节';
  }
  trigger.addEventListener('click',()=>{if(!trigger.disabled)onOpen(trigger);});
  for(const event of ['reader:ready','reader:chapter'])document.addEventListener(event,refresh);
  refresh();
  return {refresh};
}

// One contents dialog serves the header directory entry, the settings entry and the
// chapter chooser. The dialog never owns a second contents model, and closing it
// (Escape included) returns focus to the control that actually opened it.
export function mountContentsDialog({document,getBook,getChapterId,onNavigate,onBeforeOpen=()=>{}}){
  const $=id=>document.getElementById(id),dialog=$('toc-dialog');
  let opener=null;
  const triggers=()=>[$('open-toc'),$('open-chapter')].filter(Boolean);
  function render(){
    const book=getBook();if(!book)return false;
    renderBookContents({list:$('toc-list'),book,chapterId:getChapterId(),onNavigate,document});
    return true;
  }
  function open(trigger){
    onBeforeOpen();
    if(!render())return false;
    opener=trigger&&typeof trigger.focus==='function'?trigger:null;
    if(!dialog.open)dialog.showModal();
    for(const node of triggers())node.setAttribute('aria-expanded',String(node===opener));
    return true;
  }
  dialog.addEventListener('close',()=>{
    for(const node of triggers())node.setAttribute('aria-expanded','false');
    const target=opener;opener=null;
    const restorable=target&&target.isConnected!==false&&!(target.closest&&target.closest('dialog:not([open])'));
    (restorable?target:$('open-toc'))?.focus?.({preventScroll:true});
  });
  return {open,close:()=>{if(dialog.open)dialog.close();},render,getOpener:()=>opener};
}

// The single listen entry in the side reading-tools panel. It only reacts to an
// explicit activation; opening or changing chapters never routes through it.
export function mountListenChapterEntry({document,onListenChapter}){
  const entry=document.getElementById('listen-chapter');
  if(!entry)return null;
  entry.addEventListener('click',()=>onListenChapter());
  return {entry};
}
