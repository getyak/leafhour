import {t,onUiLocaleChange,uiReady} from './ui-locale.mjs';

// Display only. Read the current reader and measured page label; never save a
// position, fetch a chapter, or infer a whole-book percentage from chapter size.
export function chapterScrollProgress({top,bottom,viewport,inset=0}){
 if(![top,bottom,viewport,inset].every(Number.isFinite)||bottom<=top||viewport<=inset)return null;
 const travel=bottom-top-(viewport-inset);
 return travel<=0?(bottom<=viewport?1:0):Math.max(0,Math.min(1,(inset-top)/travel));
}
export function locationChapter(book,id){
 const chapter=book?.chapters?.find(c=>c.id===id);if(!chapter)return null;
 const grouped=book.source?.structure==='automatic_groups';
 if(!grouped&&chapter.kind&&chapter.kind!=='body')return {title:chapter.title?.zh||chapter.title?.en||''};
 const chapters=grouped?book.chapters:book.chapters.filter(c=>!c.kind||c.kind==='body');
 return {id:'reader.location.'+(grouped?'fragment':'chapter'),params:{number:chapters.indexOf(chapter)+1,count:chapters.length}};
}
export function mountReaderLocation({document,tools,getReader=()=>document.defaultView.marginaliaReader}){
 const view=document.defaultView,trigger=document.getElementById('reading-tools-trigger'),header=document.getElementById('reading-header'),text=document.getElementById('chapter-text'),pages=document.getElementById('reading-pages'),running=document.getElementById('running-progress');
 const badge=document.createElement('span'),chapterText=document.createElement('span'),positionText=document.createElement('span');badge.id='reading-location';badge.className='reading-location';badge.hidden=true;badge.append(chapterText,positionText);trigger.append(badge);
 const described=trigger.getAttribute('aria-describedby');trigger.setAttribute('aria-describedby',[described,badge.id].filter(Boolean).join(' '));
 let disposed=false,frame=null;const listeners=[];
 const listen=(target,name,fn,options)=>{const owned=e=>{if(!disposed)fn(e);};target.addEventListener(name,owned,options);listeners.push(()=>target.removeEventListener(name,owned,options));};
 const write=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 function paint(){
  if(disposed)return;frame=null;
  const reader=getReader(),book=reader?.getBook(),id=reader?.getChapterId(),chapter=book?.chapters?.find(c=>c.id===id),descriptor=locationChapter(book,id);
  let position='',short='';const paginated=document.body.dataset.paginated==='true';
  if(descriptor){
   const section=[...text.children].find(n=>n.dataset.chapterId===id),ready=!!section&&!!section.querySelector('.passage')&&!book.sections.filter(s=>s.chapterId===id).some(s=>s.paragraphs.some(p=>p.unloaded));
   if(ready&&paginated){position=document.getElementById('page-position').textContent;short=position.match(/\d+\s*\/\s*\d+\s*$/)?.[0]||position;}
   else if(ready){const bounds=section.getBoundingClientRect(),inset=document.body.classList.contains('is-focused')?24:Math.max(0,header.getBoundingClientRect().bottom),fraction=chapterScrollProgress({top:bounds.top,bottom:bounds.bottom,viewport:view.innerHeight,inset});if(fraction!==null){short=Math.round(fraction*100)+'%';position=t(book.source?.structure==='automatic_groups'?'reader.location.fragmentPercent':'reader.location.percent',{percent:Math.round(fraction*100)});}}
   const chapterLabel=descriptor.id?t(descriptor.id,descriptor.params):descriptor.title;
   write(chapterText,chapterLabel);write(positionText,!paginated&&position?' · '+position:'');badge.hidden=!chapterLabel&&!position;write(running,short||position);running?.setAttribute('aria-label',position);
   const bookTrigger=document.getElementById('open-book-info'),chapterTrigger=document.getElementById('open-chapter');
   if(bookTrigger)bookTrigger.title=book.title?.zh||book.title?.en||'';
   if(chapterTrigger)chapterTrigger.title=chapter.title?.zh||chapter.title?.en||'';
  }else{badge.hidden=true;write(chapterText,'');write(positionText,'');write(running,'');running?.removeAttribute('aria-label');}
 }
 function schedule(){if(!disposed&&frame===null)frame=view.requestAnimationFrame(paint);}
 for(const name of ['reader:ready','reader:chapter','reader:layout','reader:jump','reader:page','reader:focus','reader:flow-extended'])listen(document,name,schedule);
 listen(view,'scroll',schedule,{passive:true});listen(view,'resize',schedule);listen(pages,'scroll',schedule,{passive:true});
 // The existing coordinator owns reveal, holds, timeout, dismissal and Escape.
 // The persistent pill is also the native keyboard and touch reveal target.
 listen(document,'pointermove',event=>{if(event.pointerType==='mouse'&&!event.buttons&&event.clientY<=16&&document.body.classList.contains('is-focused')&&!document.querySelector('dialog[open],[popover][data-popover-open],.experience-surface')&&!document.getSelection?.()?.toString())tools.toolbar.reveal(false);},{passive:true});
 const observer=new view.ResizeObserver(schedule);observer.observe(text);observer.observe(pages);observer.observe(header);
 const offLocale=onUiLocaleChange(paint);void uiReady.then(()=>{if(!disposed)schedule();});void document.fonts?.ready.then(()=>{if(!disposed)schedule();});
 function unmount(){if(disposed)return;disposed=true;view.cancelAnimationFrame(frame);observer.disconnect();offLocale();for(const release of listeners)release();badge.remove();if(described===null)trigger.removeAttribute('aria-describedby');else trigger.setAttribute('aria-describedby',described);}
 listen(document,'reader:session-changed',unmount);listen(view,'pagehide',event=>{if(!event.persisted)unmount();});listen(view,'pageshow',schedule);schedule();return {unmount};
}
