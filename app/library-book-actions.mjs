import {paintBookCover} from './book-binding.mjs';
import {roomIcons} from './library-shell.mjs';
import {buildReadingCalendar} from './reading-schedule.mjs';
import {moveShelfBook} from './shelf-order.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls='')=>{const n=node('button',cls,text);n.type='button';return n;};
const icon=name=>{const n=node('span');n.dataset.icon=name;n.setAttribute('aria-hidden','true');return n;};
const title=book=>book.title?.zh||book.title?.en||'这本书';
const localInput=date=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const filename=value=>value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').slice(0,70)||'读书日程';

export function mountLibraryBookActions({api,getSession,getBooks,getOwner,getRevision,setRevision,onReorder,onChanged,openAuth}){
  const menu=node('div','book-action-menu');menu.id='library-book-menu';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label','书籍操作');
  const dialog=node('dialog','book-action-dialog');dialog.id='library-book-dialog';dialog.setAttribute('aria-labelledby','book-action-title');
  const head=node('div','book-action-heading'),heading=node('h2');heading.id='book-action-title';const close=button('','book-action-close');close.setAttribute('aria-label','关闭书籍操作');close.append(icon('x'));head.append(heading,close);
  const body=node('div','book-action-body'),status=node('p','book-action-status');status.setAttribute('role','status');dialog.append(head,body,status);document.body.append(menu,dialog);roomIcons(dialog);
  let opener=null,selected=null,sequence=0,menuTrigger=null;
  const current=ticket=>ticket===sequence&&dialog.open;
  const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  function closeMenu(){if(menu.matches(':popover-open'))menu.hidePopover();}
  function clear(){sequence++;closeMenu();if(dialog.open)dialog.close();body.replaceChildren();menu.replaceChildren();selected=null;message('');}
  function show(book,text){opener=book&&menuTrigger?.isConnected?menuTrigger:document.activeElement;closeMenu();sequence++;selected=book;heading.textContent=text;body.replaceChildren();message('');if(!dialog.open)dialog.showModal();return sequence;}
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{sequence++;body.replaceChildren();message('');if(opener?.isConnected)opener.focus();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  menu.addEventListener('beforetoggle',event=>{menuTrigger?.setAttribute('aria-expanded',String(event.newState==='open'));});
  menu.addEventListener('keydown',event=>{const items=[...menu.querySelectorAll('[role=menuitem]:not(:disabled)')],index=items.indexOf(document.activeElement);let next;if(event.key==='ArrowDown')next=(index+1)%items.length;else if(event.key==='ArrowUp')next=(index+items.length-1)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;else if(event.key==='Escape'){event.preventDefault();closeMenu();menuTrigger?.focus();return;}else return;event.preventDefault();items[next]?.focus();});
  function authenticated(){if(getSession()?.user)return true;closeMenu();if(dialog.open)dialog.close();openAuth();return false;}
  function cover(book,cls='action-book-cover'){const c=node('div',cls);c.setAttribute('aria-hidden','true');paintBookCover(c,book);return c;}
  function bookInfo(book){
    show(book,'关于这本书');const info=node('div','action-book-information'),copy=node('div');copy.append(node('h3','',title(book)));if(book.author)copy.append(node('p','action-author',book.author));if(book.title?.en&&book.title.en!==book.title.zh)copy.append(node('p','action-original',book.title.en));copy.append(node('p','',book.description||'这本书还没有简介。'),node('p','action-scope',book.visibility==='public'?'公版原文 · 已有译文保留草稿标记':'自己的书 · 原文与阅读记录按账户保存'));
    if(book.source?.url){try{const url=new URL(book.source.url);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){const link=node('a','text-link','查看底本来源 ↗');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';copy.append(link);}}catch{}}
    info.append(cover(book),copy);body.append(info);
  }
  function calendar(book){
    show(book,'留一段时间给这本书');body.append(node('p','action-intro',title(book)));
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
    confirm.addEventListener('click',async()=>{if(confirm.disabled)return;confirm.disabled=true;confirm.textContent='正在收起…';try{const saved=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/archive',{baseRevision:getRevision()});if(owner!==getOwner())return;setRevision(saved.revision);await onChanged();if(current(ticket))dialog.close();}catch(error){if(current(ticket)&&owner===getOwner()){message(error.message,true);confirm.disabled=false;confirm.textContent='移到回收站';}}});
  }
  async function trash(){
    if(!authenticated())return;const ticket=show(null,'回收站'),owner=getOwner();message('正在打开回收站…');
    try{const data=await api('/api/library/trash');if(!current(ticket)||owner!==getOwner())return;setRevision(data.revision);message('');body.append(node('p','action-scope','移走的书与阅读记录都还在这里。恢复后可以继续原来的阅读。'));if(!data.books.length){body.append(node('p','trash-empty','回收站是空的。'));return;}
      const list=node('div','trash-book-list');for(const book of data.books){const row=node('div','trash-book-row'),copy=node('div');copy.append(node('strong','',title(book)),node('small','',book.author||book.source?.filename||''));const restore=button('恢复到书架','outline');row.append(copy,restore);list.append(row);restore.addEventListener('click',async()=>{restore.disabled=true;try{const saved=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/restore',{baseRevision:getRevision()});if(owner!==getOwner())return;setRevision(saved.revision);await onChanged();if(current(ticket))trash();}catch(error){if(current(ticket)&&owner===getOwner()){message(error.message,true);restore.disabled=false;}}});}body.append(list);
    }catch(error){if(current(ticket)&&owner===getOwner())message(error.message,true);}
  }
  async function share(book){
    if(!authenticated())return;const ticket=show(book,'送出一本书'),owner=getOwner();dialog.classList.add('gift-compose-dialog');
    const layout=node('div','gift-compose-layout'),preview=node('div','gift-compose-preview');preview.append(cover(book),node('p','gift-compose-book-title',title(book)));if(book.author)preview.append(node('p','action-author',book.author));
    const form=node('form','gift-compose-form'),toLabel=node('label','','收信人的称呼'),to=node('input');to.id='gift-recipient';to.maxLength=80;to.placeholder='留空也可以';toLabel.htmlFor=to.id;
    const wordsLabel=node('label','','想留给对方的话'),words=node('textarea');words.id='gift-message';words.maxLength=500;words.rows=4;words.placeholder='读到这里，想起了你。';wordsLabel.htmlFor=words.id;
    const included=node('label','gift-compose-included'),translations=node('input');translations.type='checkbox';translations.checked=true;included.append(translations,node('span','','一并送出已有译文'));
    const signature=getSession().user.displayName||getSession().user.email?.split('@')[0]||'一位读者';const sign=node('p','gift-compose-signature','落款：'+signature),scope=node('p','action-scope','这封信会附上整本原文。你的笔记、问题和阅读记录留在自己的书房。'),create=button('生成赠书信','primary');create.type='submit';
    form.append(toLabel,to,wordsLabel,words,sign,included,scope,create);layout.append(preview,form);const result=node('div','gift-compose-result');result.hidden=true;const history=node('details','gift-compose-history'),historyTitle=node('summary','','之前送出的信'),historyRows=node('div');history.append(historyTitle,historyRows);history.hidden=true;body.append(layout,result,history);
    function linkRow(gift){const row=node('div','gift-history-row');row.dataset.token=gift.token;const label=node('span','',gift.recipient?'给 '+gift.recipient:'一封赠书信'),open=node('a','','打开 ↗');open.href=gift.shareUrl||'/gift/'+gift.token;open.target='_blank';open.rel='noopener';const revoke=button('收回','text-link');revoke.addEventListener('click',()=>{revoke.disabled=true;const confirm=button('确认收回','danger-action'),cancel=button('保留','text-link'),text=node('small','','收回后，这个链接将无法继续打开。已下载的阅读包不受影响。');row.append(text,confirm,cancel);cancel.addEventListener('click',()=>{text.remove();confirm.remove();cancel.remove();revoke.disabled=false;});confirm.addEventListener('click',async()=>{confirm.disabled=true;try{await api('/api/book-gifts/'+gift.token+'/revoke',{});if(!current(ticket)||owner!==getOwner())return;row.replaceChildren(node('span','','这封信已收回。'));if(result.dataset.token===gift.token)result.replaceChildren(node('p','','这封赠书信已收回。'));}catch(error){if(current(ticket)&&owner===getOwner()){message(error.message,true);confirm.disabled=false;}}});});row.append(label,open,revoke);return row;}
    api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gifts').then(data=>{if(current(ticket)&&owner===getOwner()){const gifts=Array.isArray(data)?data:data.gifts||[],shown=new Set([...historyRows.children].map(row=>row.dataset.token));for(const gift of gifts.filter(g=>!g.revoked))if(!shown.has(gift.token))historyRows.append(linkRow(gift));history.hidden=!historyRows.children.length;}}).catch(error=>{if(current(ticket)&&owner===getOwner())message('之前的赠书信暂时没有载入。'+error.message,true);});
    form.addEventListener('submit',async event=>{event.preventDefault();if(create.disabled)return;create.disabled=true;create.textContent='正在封好这封信…';message('');try{const gift=await api('/api/library/books/'+encodeURIComponent(book.bookId)+'/gifts',{recipient:to.value.trim(),message:words.value.trim(),includeTranslations:translations.checked});if(!current(ticket)||owner!==getOwner())return;
      const url=new URL(gift.shareUrl||'/gift/'+gift.token,location.origin).href,input=node('input','gift-share-url');input.value=url;input.readOnly=true;input.setAttribute('aria-label','赠书信链接');const copy=button('复制赠书链接','primary'),open=node('a','text-link','看看这封信 ↗');open.href=url;open.target='_blank';open.rel='noopener';result.dataset.token=gift.token;result.replaceChildren(node('p','gift-result-title','信已封好，交给你想送书的人。'),input,copy,open);result.hidden=false;copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);if(current(ticket))message('赠书链接已复制。');}catch{input.focus();input.select();message('请复制上面这条链接。');}});history.hidden=false;historyRows.prepend(linkRow(gift));create.textContent='再生成一封';create.disabled=false;
    }catch(error){if(current(ticket)&&owner===getOwner()){message(error.message,true);create.disabled=false;create.textContent='生成赠书信';}}});
  }
  dialog.addEventListener('close',()=>dialog.classList.remove('gift-compose-dialog'));
  function openMenu(book,trigger){
    closeMenu();menuTrigger=trigger;selected=book;const ids=getBooks().map(b=>b.bookId),index=ids.indexOf(book.bookId);menu.replaceChildren(node('p','book-menu-title',title(book)));
    const items=[['info','书籍信息',()=>bookInfo(book)],['mail','送出这本书',()=>share(book)],['calendar-plus','添加读书日程',()=>calendar(book)],['arrow-left','向前移动',()=>{menuTrigger?.focus({preventScroll:true});return onReorder(moveShelfBook(ids,book.bookId,ids[index-1],'before'));},index<1],['arrow-right','向后移动',()=>{menuTrigger?.focus({preventScroll:true});return onReorder(moveShelfBook(ids,book.bookId,ids[index+1],'after'));},index===ids.length-1],['trash-2','移到回收站',()=>archive(book)]];
    for(const [name,label,run,disabled]of items){const item=button('','book-menu-item'+(name==='trash-2'?' is-destructive':''));item.setAttribute('role','menuitem');item.disabled=!!disabled;item.append(icon(name),node('span','',label));item.addEventListener('click',()=>{closeMenu();Promise.resolve(run()).catch(error=>{document.getElementById('library-status').textContent=error.message;});});menu.append(item);}roomIcons(menu);menu.showPopover();const r=trigger.getBoundingClientRect(),width=menu.offsetWidth;menu.style.left=Math.max(12,Math.min(innerWidth-width-12,r.right-width))+'px';menu.style.top=Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,r.bottom+8))+'px';menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function decorate(card,book){
    card.querySelector(':scope > .book-action-trigger')?.remove();card.dataset.bookId=book.bookId;const trigger=button('','book-action-trigger');trigger.setAttribute('aria-label','《'+title(book)+'》更多操作');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',menu.id);trigger.append(icon('ellipsis'));trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(menu.matches(':popover-open')&&menuTrigger===trigger)closeMenu();else openMenu(book,trigger);});card.append(trigger);roomIcons(trigger);return trigger;
  }
  window.addEventListener('resize',closeMenu);document.addEventListener('scroll',event=>{if(!menu.contains(event.target)&&!dialog.contains(event.target))closeMenu();},{capture:true,passive:true});
  return {decorate,trash,clear,closeMenu};
}
