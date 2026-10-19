import {trackActionFocus} from './action-focus.mjs';
import {paintBookCover} from './book-binding.mjs';
import {roomIcons} from './library-shell.mjs';
import {buildReadingCalendar} from './reading-schedule.mjs';
import {moveShelfBook} from './shelf-order.mjs';
import {mountGiftComposer} from './gift-compose.mjs';
import {mountPopover} from './popover-controls.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls='')=>{const n=node('button',cls,text);n.type='button';return n;};
const icon=name=>{const n=node('span');n.dataset.icon=name;n.setAttribute('aria-hidden','true');return n;};
const title=book=>book.title?.zh||book.title?.en||'这本书';
const localInput=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const filename=value=>value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').slice(0,70)||'读书日程';

export function mountLibraryBookActions({api,getSession,getBooks,getOwner,getRevision,setRevision,onReorder,onChanged,openAuth,onOverlay=()=>{},onClose=()=>{}}){
  const menu=node('div','book-action-menu');menu.id='library-book-menu';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label','书籍操作');
  const dialog=node('dialog','book-action-dialog');dialog.id='library-book-dialog';dialog.setAttribute('aria-labelledby','book-action-title');
  const head=node('div','book-action-heading'),heading=node('h2');heading.id='book-action-title';const close=button('','book-action-close');close.setAttribute('aria-label','关闭书籍操作');close.append(icon('x'));head.append(heading,close);
  const body=node('div','book-action-body'),status=node('p','book-action-status');status.setAttribute('role','status');dialog.append(head,body,status);document.body.append(menu,dialog);roomIcons(dialog);
  const menuControl=mountPopover({document,element:menu});
  let opener=null,selected=null,sequence=0,business=null;
  let giftComposer=null;
  const current=ticket=>ticket===sequence&&dialog.open;
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  function closeMenu(){menuControl.close();}
  function clear(){giftComposer?.clear();sequence++;menuControl.close({focus:false});menuControl.setTrigger(null);if(dialog.open)dialog.close();body.replaceChildren();menu.replaceChildren();selected=null;business=null;message('');}
  function show(book,text,kind=null){opener=book&&menuControl.trigger?.isConnected?menuControl.trigger:document.activeElement;closeMenu();sequence++;selected=book;business=kind;heading.textContent=text;body.replaceChildren();message('');if(!dialog.open)dialog.showModal();return sequence;}
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{const closed=business;sequence++;body.replaceChildren();message('');business=null;if(opener?.isConnected)opener.focus();if(closed)onClose(closed,'user');});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  menu.addEventListener('keydown',event=>{const items=[...menu.querySelectorAll('[role=menuitem]:not(:disabled)')],index=items.indexOf(document.activeElement);let next;if(event.key==='ArrowDown')next=(index+1)%items.length;else if(event.key==='ArrowUp')next=(index+items.length-1)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;else if(event.key==='Escape'){event.preventDefault();closeMenu();return;}else return;event.preventDefault();items[next]?.focus();});
  function authenticated(){if(getSession()?.user)return true;closeMenu();if(dialog.open)dialog.close();openAuth();return false;}
  function cover(book,cls='action-book-cover'){const c=node('div',cls);c.setAttribute('aria-hidden','true');paintBookCover(c,book);return c;}
  function bookInfo(book){
    const ticket=show(book,'关于这本书','info'),owner=getOwner(),description=node('p','',book.description||'这本书还没有简介。'),provenance=node('p','action-scope');provenance.hidden=true;const info=node('div','action-book-information'),copy=node('div');copy.append(node('h3','',title(book)));if(book.author)copy.append(node('p','action-author',book.author));if(book.title?.en&&book.title.en!==book.title.zh)copy.append(node('p','action-original',book.title.en));copy.append(description,provenance,node('p','action-scope',book.visibility==='public'?'公版原文 · 已有译文保留草稿标记':'自己的书 · 原文与阅读记录按账户保存'));
    if(book.source?.url){try{const url=new URL(book.source.url);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){const link=node('a','text-link','查看底本来源 ↗');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';copy.append(link);}}catch{}}
    if(book.visibility==='private'){const review=node('a','text-link','校对原文与来源');review.href='/source-review?book='+encodeURIComponent(book.bookId);copy.append(review);}
    info.append(cover(book),copy);body.append(info);
    if(!book.description)api('/api/library/books/'+encodeURIComponent(book.bookId)+'/introduction').then(data=>{if(!current(ticket)||owner!==getOwner())return;if(data.text)description.textContent=data.text;if(data.source==='ai'){provenance.hidden=false;provenance.textContent='AI 简介初稿 · 仅依据目录与正文开头取样，尚未人工核对。';}}).catch(()=>{if(current(ticket)&&owner===getOwner())message('已保存的简介暂时无法读取，可以稍后重试。',true);});
  }
  function calendar(book){
    show(book,'留一段时间给这本书','schedule');body.append(node('p','action-intro',title(book)));
    const form=node('form','reading-schedule-form'),fields=node('div','schedule-fields');
    const field=(label,type,value)=>{const wrap=node('label','schedule-field'),input=node('input');input.type=type;input.value=value;wrap.append(node('span','',label),input);fields.append(wrap);return input;};
    const start=field('开始时间','datetime-local',localInput(new Date(Date.now()+3600000))),minutes=field('阅读时长（分钟）','number',String(book.journey?.dailyGoalMinutes||15));start.required=minutes.required=true;minutes.min='5';minutes.max='240';minutes.step='5';
    const select=(label,values)=>{const wrap=node('label','schedule-field'),input=node('select');wrap.append(node('span','',label),input);for(const [value,text]of values){const option=node('option','',text);option.value=value;input.append(option);}fields.append(wrap);return input;};
    const repeat=select('重复',[['none','不重复'],['daily','每天'],['weekly','每周这一天']]),reminder=select('日历提醒',[['10','提前 10 分钟'],['0','开始时'],['5','提前 5 分钟'],['30','提前 30 分钟'],['-1','不提醒']]),until=field('重复到','date',localInput(new Date(Date.now()+90*86400000)).slice(0,10));until.parentElement.hidden=true;
    repeat.addEventListener('change',()=>{until.parentElement.hidden=repeat.value==='none';until.required=repeat.value!=='none';});
    const note=node('p','action-scope','按你导入日历的本地时间安排。日程里会附上返回这本书的链接。'),save=button('下载日程文件','primary');save.type='submit';form.append(fields,note,save);body.append(form);
    form.addEventListener('submit',event=>{event.preventDefault();try{const text=buildReadingCalendar(book,{start:start.value,minutes:Number(minutes.value),repeat:repeat.value,until:until.value,reminder:Number(reminder.value)},{origin:location.origin});download(text,filename(title(book))+'·读书日程.ics','text/calendar;charset=utf-8');message('日程文件已下载。打开文件并加入日历后，提醒才会生效。');}catch(error){message(error.message,true);}});
  }
  async function archive(book){
    if(!authenticated())return;const ticket=show(book,'把这本书移到回收站？'),owner=getOwner();body.append(node('p','action-intro',title(book)),node('p','','原文、译文与阅读记录会保留，可以从回收站恢复。'));
    const actions=node('div','action-dialog-buttons'),cancel=button('继续留在书架','outline'),confirm=button('移到回收站','danger-action');actions.append(cancel,confirm);body.append(actions);cancel.addEventListener('click',()=>dialog.close());
    confirm.addEventListener('click',async()=>{if(confirm.disabled)return;const focus=trackActionFocus(document,confirm);confirm.disabled=true;confirm.textContent='正在收起…';try{const saved=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/archive',{baseRevision:getRevision()});if(owner!==getOwner())return;setRevision(saved.revision);await onChanged();if(current(ticket))dialog.close();}catch(error){if(current(ticket)&&owner===getOwner()){message(error.message,true);confirm.disabled=false;confirm.textContent='移到回收站';}}finally{if(current(ticket)&&owner===getOwner())focus.restore(confirm);else focus.stop();}});
  }
  async function trash(){
    if(!authenticated())return;const ticket=show(null,'回收站','trash'),owner=getOwner();message('正在打开回收站…');onOverlay({kind:'trash'});
    try{const data=await api('/api/library/trash');if(!current(ticket)||owner!==getOwner())return;setRevision(data.revision);message('');body.append(node('p','action-scope','移走的书与阅读记录都还在这里。恢复后可以继续原来的阅读。'));if(!data.books.length){body.append(node('p','trash-empty','回收站是空的。'));return;}
      const list=node('div','trash-book-list');for(const book of data.books){const row=node('div','trash-book-row'),copy=node('div');copy.append(node('strong','',title(book)),node('small','',book.author||book.source?.filename||''));const restore=button('恢复到书架','outline');row.append(copy,restore);list.append(row);restore.addEventListener('click',async()=>{const focus=trackActionFocus(document,restore);restore.disabled=true;try{const saved=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/restore',{baseRevision:getRevision()});if(owner!==getOwner())return;setRevision(saved.revision);await onChanged();if(current(ticket)){await trash();focus.restore(body.querySelector('button')||close);}}catch(error){if(current(ticket)&&owner===getOwner()){message(error.message,true);restore.disabled=false;focus.restore(restore);}}finally{focus.stop();}});}body.append(list);
    }catch(error){if(current(ticket)&&owner===getOwner())message(error.message,true);}
  }
  giftComposer=mountGiftComposer({api,dialog,body,getSession,getOwner,show,current,message,cover});
  async function share(book){if(authenticated())return giftComposer.open(book);}
  dialog.addEventListener('close',()=>dialog.classList.remove('gift-compose-dialog'));
  function openMenu(book,trigger){
    closeMenu();menuControl.setTrigger(trigger);selected=book;const ids=getBooks().map(b=>b.bookId),index=ids.indexOf(book.bookId);menu.replaceChildren(node('p','book-menu-title',title(book)));
    const items=[['info','书籍信息',()=>bookInfo(book)],['mail','送出这本书',()=>share(book)],['calendar-plus','添加读书日程',()=>calendar(book)],['arrow-left','向前移动',()=>{menuControl.trigger?.focus({preventScroll:true});return onReorder(moveShelfBook(ids,book.bookId,ids[index-1],'before'));},index<1],['arrow-right','向后移动',()=>{menuControl.trigger?.focus({preventScroll:true});return onReorder(moveShelfBook(ids,book.bookId,ids[index+1],'after'));},index===ids.length-1],['trash-2','移到回收站',()=>archive(book)]];
    for(const [name,label,run,disabled]of items){const item=button('','book-menu-item'+(name==='trash-2'?' is-destructive':''));item.setAttribute('role','menuitem');item.disabled=!!disabled;item.append(icon(name),node('span','',label));item.addEventListener('click',()=>{closeMenu();Promise.resolve(run()).catch(error=>{document.getElementById('library-status').textContent=error.message;});});menu.append(item);}roomIcons(menu);menuControl.open();const r=trigger.getBoundingClientRect(),width=menu.offsetWidth;menu.style.left=Math.max(12,Math.min(innerWidth-width-12,r.right-width))+'px';menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,r.bottom+8))+'px';menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function decorate(card,book){
    card.querySelector(':scope > .book-action-trigger')?.remove();card.dataset.bookId=book.bookId;const trigger=button('','book-action-trigger');trigger.setAttribute('aria-label','《'+title(book)+'》更多操作');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',menu.id);trigger.append(icon('ellipsis'));trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(menuControl.isOpen()&&menuControl.trigger===trigger)closeMenu();else openMenu(book,trigger);});card.append(trigger);roomIcons(trigger);return trigger;
  }
  window.addEventListener('resize',closeMenu);document.addEventListener('scroll',event=>{if(!menu.contains(event.target)&&!dialog.contains(event.target))closeMenu();},{capture:true,passive:true});
  return {decorate,trash,clear,closeMenu,getOverlayKind:()=>business,closeDialog:()=>{if(dialog.open)dialog.close();}};
}
