import {t,getUiLocale,uiHref,onUiLocaleChange,uiReady,createUiMessage} from './ui-locale.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {paintBookCover,paintBookIdentity,bookCoverLabel} from './book-cover-ui.mjs';
import {roomIcons} from './library-shell.mjs';
import {buildReadingCalendar} from './reading-schedule.mjs';
import {moveShelfBook} from './shelf-order.mjs';
import {mountGiftComposer} from './gift-compose.mjs';
import {mountPopover} from './popover-controls.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls='')=>{const n=node('button',cls,text);n.type='button';return n;};
const icon=name=>{const n=node('span');n.dataset.icon=name;n.setAttribute('aria-hidden','true');return n;};
const title=book=>bookCoverLabel(book,getUiLocale()).title||t('book.fallback');
const localInput=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const filename=value=>value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').slice(0,70)||'读书日程';

export function mountLibraryBookActions({api,getSession,getBooks,getOwner,getRevision,setRevision,onReorder,onChanged,openAuth,onOverlay=()=>{},onClose=()=>{}}){
  const labels=new Map(),menuLabels=new Map(),triggers=new Map();let disposed=false,headingId=null,pruneScheduled=false;
  function scheduleTriggerPrune(){if(pruneScheduled)return;pruneScheduled=true;queueMicrotask(()=>{pruneScheduled=false;if(disposed)return;for(const trigger of triggers.keys())if(!trigger.isConnected)triggers.delete(trigger);});}
  const label=(node,id,params,scope=labels)=>{scope.set(node,{id,params});node.textContent=t(id,params);return node;};
  const uiNode=(tag,cls,id,params,scope=labels)=>label(node(tag,cls),id,params,scope);
  const uiButton=(id,cls)=>label(button('',cls),id);
  const menu=node('div','book-action-menu');menu.id='library-book-menu';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label',t('book.actions'));
  const dialog=node('dialog','book-action-dialog');dialog.id='library-book-dialog';dialog.setAttribute('aria-labelledby','book-action-title');
  const head=node('div','book-action-heading'),heading=node('h2');heading.id='book-action-title';const close=button('','book-action-close');close.setAttribute('aria-label',t('book.actions.close'));close.append(icon('x'));head.append(heading,close);
  const body=node('div','book-action-body'),status=node('p','book-action-status');status.setAttribute('role','status');dialog.append(head,body,status);document.body.append(menu,dialog);roomIcons(dialog);
  const menuControl=mountPopover({document,element:menu});
  let opener=null,selected=null,sequence=0,business=null,menuSequence=0;
  let giftComposer=null;
  const current=ticket=>!disposed&&ticket===sequence&&dialog.open;
  const statusMessage=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('error',!!error);});
  const message=(text,error=false)=>{statusMessage.clear();status.textContent=text;status.classList.toggle('error',error);};
  const notice=(id,params,error=false)=>statusMessage.set(id,params,error);
  function closeMenu(){menuSequence++;menuControl.close();}
  function clear(){giftComposer?.clear();sequence++;menuSequence++;menuControl.close({focus:false});menuControl.setTrigger(null);if(dialog.open)dialog.close();body.replaceChildren();menu.replaceChildren();selected=null;business=null;headingId=null;labels.clear();menuLabels.clear();triggers.clear();message('');}
  function show(book,text,kind=null){opener=book&&menuControl.trigger?.isConnected?menuControl.trigger:document.activeElement;closeMenu();sequence++;selected=book;business=kind;headingId=text&&typeof text==='object'?text.id:null;heading.textContent=headingId?t(headingId):text;body.replaceChildren();labels.clear();message('');if(!dialog.open)dialog.showModal();return sequence;}
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{const closed=business;sequence++;body.replaceChildren();message('');business=null;headingId=null;labels.clear();if(!disposed&&opener?.isConnected)opener.focus();if(!disposed&&closed)onClose(closed,'user');});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  menu.addEventListener('keydown',event=>{const items=[...menu.querySelectorAll('[role=menuitem]:not(:disabled)')],index=items.indexOf(document.activeElement);let next;if(event.key==='ArrowDown')next=(index+1)%items.length;else if(event.key==='ArrowUp')next=(index+items.length-1)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;else if(event.key==='Escape'){event.preventDefault();closeMenu();return;}else return;event.preventDefault();items[next]?.focus();});
  function authenticated(){if(disposed)return false;if(getSession()?.user)return true;closeMenu();if(dialog.open)dialog.close();openAuth();return false;}
  function cover(book,cls='action-book-cover'){const c=node('div',cls);c.setAttribute('aria-hidden','true');paintBookCover(c,book);return c;}
  function bookInfo(book){
    const ticket=show(book,{id:'book.info'},'info'),owner=getOwner(),description=book.description?node('p','',book.description):uiNode('p','','book.description.empty'),provenance=node('p','action-scope');provenance.hidden=true;const info=node('div','action-book-information'),copy=node('div');copy.append(paintBookIdentity(node('h3'),book));if(book.author)copy.append(paintBookIdentity(node('p','action-author'),book,'author'));if(book.title?.en&&book.title.en!==book.title.zh)copy.append(node('p','action-original',book.title.en));if(book.visibility==='public'&&book.author)copy.append(node('p','action-original',book.author));copy.append(description,provenance,uiNode('p','action-scope',book.visibility==='public'?'book.public':'book.private'));
    if(book.source?.url){try{const url=new URL(book.source.url);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){const link=uiNode('a','text-link','book.source');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';copy.append(link);}}catch{}}
    if(book.visibility==='private'){const review=uiNode('a','text-link','book.review');review.href=uiHref('/source-review?book='+encodeURIComponent(book.bookId));review.dataset.uiOwnedHref='/source-review?book='+encodeURIComponent(book.bookId);copy.append(review);}
    info.append(cover(book),copy);body.append(info);
    if(!book.description)api('/api/library/books/'+encodeURIComponent(book.bookId)+'/introduction').then(data=>{if(!current(ticket)||owner!==getOwner())return;if(data.text){labels.delete(description);description.textContent=data.text;}if(data.source==='ai'){provenance.hidden=false;label(provenance,'book.description.ai');}}).catch(()=>{if(current(ticket)&&owner===getOwner())notice('book.description.unavailable',null,true);});
  }
  function calendar(book){
    show(book,{id:'book.schedule.title'},'schedule');body.append(node('p','action-intro',title(book)));
    const form=node('form','reading-schedule-form'),fields=node('div','schedule-fields');
    const field=(label,type,value)=>{const wrap=node('label','schedule-field'),input=node('input');input.type=type;input.value=value;wrap.append(uiNode('span','',label),input);fields.append(wrap);return input;};
    const start=field('book.schedule.start','datetime-local',localInput(new Date(Date.now()+3600000))),minutes=field('book.schedule.minutes','number',String(book.journey?.dailyGoalMinutes||15));start.required=minutes.required=true;minutes.min='5';minutes.max='240';minutes.step='5';
    const select=(label,values)=>{const wrap=node('label','schedule-field'),input=node('select');wrap.append(uiNode('span','',label),input);for(const [value,text]of values){const option=uiNode('option','',text);option.value=value;input.append(option);}fields.append(wrap);return input;};
    const repeat=select('book.schedule.repeat',[['none','book.schedule.none'],['daily','book.schedule.daily'],['weekly','book.schedule.weekly']]),reminder=select('book.schedule.reminder',[['10','book.schedule.before10'],['0','book.schedule.atStart'],['5','book.schedule.before5'],['30','book.schedule.before30'],['-1','book.schedule.noReminder']]),until=field('book.schedule.until','date',localInput(new Date(Date.now()+90*86400000)).slice(0,10));until.parentElement.hidden=true;
    repeat.addEventListener('change',()=>{until.parentElement.hidden=repeat.value==='none';until.required=repeat.value!=='none';});
    const note=uiNode('p','action-scope','book.schedule.help'),save=uiButton('book.schedule.download','primary');save.type='submit';form.append(fields,note,save);body.append(form);
    form.addEventListener('submit',event=>{event.preventDefault();if(disposed)return;try{const text=buildReadingCalendar(book,{start:start.value,minutes:Number(minutes.value),repeat:repeat.value,until:until.value,reminder:Number(reminder.value)},{origin:location.origin,labels:{summary:title=>t('book.ics.summary',{title}),description:(title,minutes,url)=>t('book.ics.description',{title,minutes,url}),alarm:title=>t('book.ics.alarm',{title})}});download(text,filename(title(book))+'·读书日程.ics','text/calendar;charset=utf-8');notice('book.schedule.downloaded');}catch(error){notice(['reading.schedule.invalidStart','reading.schedule.invalidDate','reading.schedule.invalidOptions','reading.schedule.invalidOrigin','reading.schedule.noBook','reading.schedule.badRepeat'].includes(error.messageId)?error.messageId:'book.error',null,true);}});
  }
  async function archive(book){
    if(!authenticated())return;const ticket=show(book,{id:'book.archive.title'}),owner=getOwner();body.append(node('p','action-intro',title(book)),uiNode('p','','book.archive.help'));
    const actions=node('div','action-dialog-buttons'),cancel=uiButton('book.archive.cancel','outline'),confirm=uiButton('book.archive.confirm','danger-action');actions.append(cancel,confirm);body.append(actions);cancel.addEventListener('click',()=>dialog.close());
    confirm.addEventListener('click',async()=>{if(disposed||confirm.disabled)return;const focus=trackActionFocus(document,confirm);confirm.disabled=true;label(confirm,'book.archive.busy');try{const saved=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/archive',{baseRevision:getRevision()});if(disposed||owner!==getOwner())return;setRevision(saved.revision);await onChanged();if(current(ticket))dialog.close();}catch(error){if(current(ticket)&&owner===getOwner()){notice('book.error',null,true);confirm.disabled=false;label(confirm,'book.archive.confirm');}}finally{if(current(ticket)&&owner===getOwner())focus.restore(confirm);else focus.stop();}});
  }
  async function trash(){
    if(!authenticated())return;const ticket=show(null,{id:'book.trash'},'trash'),owner=getOwner();notice('book.trash.loading');onOverlay({kind:'trash'});
    try{const data=await api('/api/library/trash');if(!current(ticket)||owner!==getOwner())return;setRevision(data.revision);message('');body.append(uiNode('p','action-scope','book.trash.help'));if(!data.books.length){body.append(uiNode('p','trash-empty','book.trash.empty'));return;}
      const list=node('div','trash-book-list');for(const book of data.books){const row=node('div','trash-book-row'),copy=node('div');copy.append(node('strong','',title(book)),node('small','',book.author||book.source?.filename||''));const restore=uiButton('book.trash.restore','outline');row.append(copy,restore);list.append(row);restore.addEventListener('click',async()=>{if(disposed)return;const focus=trackActionFocus(document,restore);restore.disabled=true;try{const saved=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/restore',{baseRevision:getRevision()});if(disposed||owner!==getOwner())return;setRevision(saved.revision);await onChanged();if(current(ticket)){await trash();focus.restore(body.querySelector('button')||close);}}catch(error){if(current(ticket)&&owner===getOwner()){notice('book.error',null,true);restore.disabled=false;focus.restore(restore);}}finally{focus.stop();}});}body.append(list);
    }catch(error){if(current(ticket)&&owner===getOwner())notice('book.error',null,true);}
  }
  giftComposer=mountGiftComposer({api,dialog,body,getSession,getOwner,show,current,message,cover});
  async function share(book){if(authenticated())return giftComposer.open(book);}
  async function exportBook(book){
    const ticket=show(book,{id:'export.title'},'export'),owner=getOwner();notice('export.loading');
    try{const {mountBookExport}=await import('./book-export-ui.mjs');if(!current(ticket)||owner!==getOwner())return;await mountBookExport({document,body,book,api,current:()=>current(ticket)&&owner===getOwner(),t,locale:getUiLocale,notice,label});}
    catch{if(current(ticket)&&owner===getOwner())notice('export.error',null,true);}
  }

  dialog.addEventListener('close',()=>dialog.classList.remove('gift-compose-dialog'));
  function openMenu(book,trigger){
    if(disposed)return;closeMenu();menuControl.setTrigger(trigger);selected=book;menuLabels.clear();const ids=getBooks().map(b=>b.bookId),index=ids.indexOf(book.bookId);menu.replaceChildren(node('p','book-menu-title',title(book)));
    const items=[['info','book.info',()=>bookInfo(book)],['mail','book.gift',()=>share(book)],['calendar-plus','book.schedule.add',()=>calendar(book)],['arrow-left','book.move.before',()=>{menuControl.trigger?.focus({preventScroll:true});return onReorder(moveShelfBook(ids,book.bookId,ids[index-1],'before'));},index<1],['arrow-right','book.move.after',()=>{menuControl.trigger?.focus({preventScroll:true});return onReorder(moveShelfBook(ids,book.bookId,ids[index+1],'after'));},index===ids.length-1],['trash-2','book.archive.confirm',()=>archive(book)]];
    items.push(['download','export.title',()=>exportBook(book)]);
    for(const [name,label,run,disabled]of items){const item=button('','book-menu-item'+(name==='trash-2'?' is-destructive':''));item.setAttribute('role','menuitem');item.disabled=!!disabled;item.append(icon(name),uiNode('span','',label,undefined,menuLabels));item.addEventListener('click',()=>{if(disposed)return;closeMenu();const ticket=menuSequence,owner=getOwner();Promise.resolve().then(()=>{if(!disposed&&ticket===menuSequence&&owner===getOwner())return run();}).catch(error=>{if(disposed||ticket!==menuSequence||owner!==getOwner())return;const status=document.getElementById('library-status');if(status)status.textContent=t('book.error');});});menu.append(item);}roomIcons(menu);menuControl.open();const r=trigger.getBoundingClientRect(),width=menu.offsetWidth;menu.style.left=Math.max(12,Math.min(innerWidth-width-12,r.right-width))+'px';menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,r.bottom+8))+'px';menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function decorate(card,book){
    const previous=card.querySelector(':scope > .book-action-trigger');if(previous){triggers.delete(previous);previous.remove();}scheduleTriggerPrune();
    card.dataset.bookId=book.bookId;const trigger=button('','book-action-trigger');trigger.setAttribute('aria-label',t('book.more',{title:title(book)}));triggers.set(trigger,{book});trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',menu.id);trigger.append(icon('ellipsis'));trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(menuControl.isOpen()&&menuControl.trigger===trigger)closeMenu();else openMenu(book,trigger);});card.append(trigger);roomIcons(trigger);return trigger;
  }
  function updateLabels(){
    if(disposed)return;menu.setAttribute('lang',getUiLocale());dialog.setAttribute('lang',getUiLocale());menu.setAttribute('aria-label',t('book.actions'));close.setAttribute('aria-label',t('book.actions.close'));
    if(headingId)heading.textContent=t(headingId);
    for(const scope of [menuLabels,labels])for(const [node,{id,params}]of scope)node.textContent=t(id,params);
    for(const [trigger,{book}]of triggers){if(!trigger.isConnected){triggers.delete(trigger);continue;}trigger.setAttribute('aria-label',t('book.more',{title:title(book)}));}
    for(const link of body.querySelectorAll('[data-ui-owned-href]'))link.href=uiHref(link.dataset.uiOwnedHref);
    statusMessage.refresh();
  }
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();
  const onScroll=event=>{if(!menu.contains(event.target)&&!dialog.contains(event.target))closeMenu();};
  window.addEventListener('resize',closeMenu);document.addEventListener('scroll',onScroll,{capture:true,passive:true});
  return {decorate,trash,clear,closeMenu,updateLabels,dispose(){if(disposed)return;disposed=true;offLocale();clear();window.removeEventListener('resize',closeMenu);document.removeEventListener('scroll',onScroll,true);menu.remove();dialog.remove();},getOverlayKind:()=>business,closeDialog:()=>{if(dialog.open)dialog.close();}};
}
