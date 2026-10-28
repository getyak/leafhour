import {t,getUiLocale,onUiLocaleChange,uiHref} from './ui-locale.mjs';
import {localReadingDate} from './reading-calendar.mjs';
import {createLibraryArrivalState} from './library-arrival-state.mjs';

export function formatLibraryArrival(data){
 const zone=data.timeZone;
 const title=value=>typeof value==='string'?value:(['en','ja'].includes(getUiLocale())?value?.en||value?.zh:value?.zh||value?.en)||'';
 const duration=seconds=>seconds<60?t('arrival.lessMinute'):t('unit.minutes',{minutes:new Intl.NumberFormat(getUiLocale()).format(Math.floor(seconds/60))});
 const day=data.yesterday,last=data.lastRead,parts=[];
  if(day.durationSeconds>0){const sources=Object.entries(day.sourceDurationSeconds||{}).filter(([,seconds])=>seconds>0).map(([source])=>t('arrival.source.'+source));parts.push(t('arrival.yesterday',{time:duration(day.durationSeconds),sources:sources.join(t('arrival.bookSeparator'))}));
  }else parts.push(t('arrival.noYesterday'));
  if(day.notes||day.questions)parts.push(t('arrival.activity',{notes:day.notes,questions:day.questions}));
  if(last){const at=new Intl.DateTimeFormat(getUiLocale(),{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(last.at));parts.push(t('arrival.last',{at,title:title(last.title),time:duration(last.durationSeconds)}));}
  else parts.push(t('arrival.firstRead'));
 return parts;
}

export function mountLibraryArrival({api,getOwner,getSession,surface,onOpenChat,storage=globalThis.localStorage,document=globalThis.document,window=globalThis.window}){
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',dateKey=()=>localReadingDate(zone);
 const make=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;};
 const bubble=make('aside','library-arrival squirrel-companion-bubble');bubble.hidden=true;bubble.setAttribute('aria-labelledby','library-arrival-title');
 const heading=make('h2','library-arrival-title');heading.id='library-arrival-title';
 const close=make('button','library-arrival-close');close.type='button';close.textContent='×';
 const copy=make('p','library-arrival-copy');copy.setAttribute('role','status');
 const actions=make('div','library-arrival-actions'),resume=make('a','library-arrival-resume'),talk=make('button','text-link');talk.type='button';
 actions.append(resume,talk);bubble.append(heading,close,copy,actions);surface.root.after(bubble);
 const preference=make('label','library-arrival-preference'),enabled=make('input',''),preferenceText=make('span','');enabled.type='checkbox';preference.append(enabled,preferenceText);surface.preferenceHost.append(preference);
 let data=null,detach=null,ready=false,timer=null,disposed=false;
 function paint(){
  heading.textContent=t('arrival.title');close.setAttribute('aria-label',t('arrival.close'));talk.textContent=t('arrival.talk');resume.textContent=t('arrival.continue');preferenceText.textContent=t('arrival.preference');
  if(!data)return;bubble.lang=getUiLocale();
  const last=data.lastRead;
  if(last)resume.href=uiHref('/read?'+new URLSearchParams({book:last.bookId,...(last.passageId?{passage:last.passageId}:{})}));
  copy.textContent=formatLibraryArrival(data).join(' ');resume.hidden=!last;surface.position?.layout();
 }
 const canShow=()=>ready&&!document.hidden&&!surface.root.open&&!document.querySelector('dialog[open],[popover][data-popover-open]')&&!document.getSelection?.()?.toString()&&!document.activeElement?.closest?.('input,textarea,select,[contenteditable=true]');
 const hide=()=>{bubble.hidden=true;data=null;detach?.();detach=null;};
 const state=createLibraryArrivalState({getOwner:()=>getSession()?.user?getOwner():null,getAccount:()=>getSession()?.user?.id||null,dateKey,timeZone:zone,storage,locks:window.navigator?.locks,canShow,load:()=>api('/api/library/arrival?timeZone='+encodeURIComponent(zone)),onHide:hide,onShow:value=>{data=value;paint();bubble.hidden=false;detach=surface.position?.attach(bubble);}});
 const update=()=>{if(disposed)return;enabled.checked=state.enabled();preference.hidden=!getSession()?.user;if(ready)state.update();};
 close.addEventListener('click',()=>{state.dismiss();surface.launcher?.focus({preventScroll:true});});talk.addEventListener('click',()=>{state.dismiss();onOpenChat();});enabled.addEventListener('change',()=>state.setEnabled(enabled.checked));
 const keydown=event=>{if(event.key==='Escape'&&!bubble.hidden){const focused=bubble.contains(document.activeElement);state.dismiss();if(focused)surface.launcher?.focus({preventScroll:true});}};
 const activity=()=>{if(document.hidden){hide();return;}update();};
 const afterFocus=()=>queueMicrotask(update);
 const storageChanged=event=>{if(event.key?.startsWith('marginalia:library-arrival:')){if(!state.enabled())state.dismiss();update();}};
 document.addEventListener('visibilitychange',activity);document.addEventListener('focusout',afterFocus);document.addEventListener('selectionchange',update);document.addEventListener('keydown',keydown);window.addEventListener('focus',update);window.addEventListener('storage',storageChanged);
 timer=window.setInterval(update,30000);const offLocale=onUiLocaleChange(paint);paint();update();
 return {update(){ready=true;update();},suspend(){ready=false;state.clear();},clear(){ready=false;state.clear();enabled.checked=state.enabled();},dispose(){disposed=true;state.dispose();window.clearInterval(timer);offLocale();document.removeEventListener('visibilitychange',activity);document.removeEventListener('focusout',afterFocus);document.removeEventListener('selectionchange',update);document.removeEventListener('keydown',keydown);window.removeEventListener('focus',update);window.removeEventListener('storage',storageChanged);bubble.remove();preference.remove();}};
}
