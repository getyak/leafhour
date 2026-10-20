import {t,getUiLocale,uiHref,onUiLocaleChange,uiReady} from './ui-locale.mjs';
import {trackActionFocus} from './action-focus.mjs';
import {settingGroup,switchRow,mountTimeEditor} from './settings-controls.mjs';
import {mountChoiceControl} from './choice-control.mjs';
import {mountPopover} from './popover-controls.mjs';
const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
// Literal server-default card label: custom labels stay literal data, this
// default is filtered as data, never matched against UI text for translation.
const DEFAULT_INBOX_LABEL='每日陪读';
const KNOWN_STATES=new Set(['awaiting-host','active','paused','expired','revoked']);
const title=book=>book?.title?.zh||book?.title?.en||t('book.fallback');
function sourceLink(value){
 if(typeof value!=='string'||!value.startsWith('/read?'))return null;
 try{const url=new URL(value,'https://leafhour.invalid');if(url.pathname!=='/read'||url.origin!=='https://leafhour.invalid'||!url.searchParams.get('book')||!url.searchParams.get('passage')||!url.searchParams.get('contentVersion')||url.searchParams.get('layer')!=='original')return null;return url.pathname+url.search;}catch{return null;}
}
function downloadConfig(config){
 const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'})),link=node('a');link.href=url;link.download='leafhour-daily-private.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}
// GET-201 daily reading tab. Owner reads and explicit writes only. A downloaded
// credential is not evidence of a running scheduler; server connection state is
// authoritative. The tab opens on one plain sentence carrying the book and one
// 24-hour time; host, expiry, timezone and refresh live in one connection
// disclosure; the permission card explains the bounded read and its consent is
// explicit. Changing the book or time invalidates that consent, so enabling or
// changing the plan always needs one deliberate authorization action — this is
// the deliberate exception to autosave, never a silent grant, resume or plan
// change. Language commits relabel owned nodes from cached public state only:
// no API call, no option or inbox rebuild, no session/book read and no
// plan/grant write.
export function mountLibraryDailyReading({root,inboxRoot=null,api,getSession,getBooks=()=>[],getCurrentBook=()=>null,origin=globalThis.location?.origin,download=downloadConfig}){
 const labels=new Map(),links=new Set();
 const text=spec=>spec.render?spec.render():t(spec.id,spec.params);
 const own=(n,spec)=>{labels.set(n,spec);n.textContent=text(spec);return n;};
 const ui=(tag,cls,id,params)=>own(node(tag,cls),{id,params});
 const heading=ui('h3','','daily.title'),intro=ui('p','settings-description','daily.intro');
 // One plain sentence: book and time appear here, once.
 const hero=node('p','daily-sentence');
 const heroTime=ui('span','','daily.sentence.time');
 const timeToken=node('button','daily-time-token');timeToken.id='daily-time-token';timeToken.type='button';
 const heroBook=ui('span','','daily.sentence.book');
 const bookToken=node('button','daily-book-token');bookToken.id='daily-book-token';bookToken.type='button';
 const heroEnd=ui('span','','daily.sentence.end');
 const badge=node('div','daily-summary'),state=node('span','daily-state');state.id='daily-state';
 badge.append(state);
 const binding=ui('p','daily-binding','daily.binding.none'),connection=ui('p','daily-connection','daily.connection.none'),expiry=node('p','daily-expiry'),channel=ui('p','daily-channel','daily.channel'),zone=ui('p','daily-field-help','daily.field.zone');
 binding.id='daily-binding';connection.id='daily-connection';expiry.id='daily-expiry';channel.id='daily-channel';zone.id='daily-zone';
 const form=node('form','daily-form');form.id='daily-form';
 hero.append(heroTime,timeToken,heroBook,bookToken,heroEnd);
 // One 24-hour trigger in the sentence opens a compact editor; the native time
 // and select nodes stay the value owners and keep their single real change.
 const time=node('input','daily-time-native');time.id='daily-time';time.type='time';time.required=true;time.value='20:00';
 const timeText=node('input','profile-input daily-time-text');timeText.id='daily-time-text';timeText.type='text';
 const timePanel=node('div','daily-editor-panel');timePanel.id='daily-time-editor';
 const timeEditor=mountTimeEditor({document,input:time,editor:timeText,panel:timePanel,times:['07:00','12:30','20:00','22:30'],customLabel:t('daily.time.custom'),label:t('daily.field.time')});
 timeEditor.root.classList.add('daily-inline-editor');timeEditor.root.append(time);
 timeEditor.root.id='daily-time-popover';timeEditor.root.setAttribute('popover','auto');timeEditor.root.setAttribute('role','dialog');
 if(typeof timeEditor.root.showPopover!=='function')timeEditor.root.setAttribute('hidden','');
 timeToken.setAttribute('aria-controls',timeEditor.root.id);timeToken.setAttribute('aria-expanded','false');timeToken.setAttribute('aria-haspopup','dialog');
 timeToken.setAttribute('popovertarget',timeEditor.root.id);
 const guardEditor=event=>{if(event.currentTarget.disabled||currentOwner()!==owner){event.preventDefault();event.stopImmediatePropagation();}};
 timeToken.addEventListener('click',guardEditor);
 const timePopover=mountPopover({document,element:timeEditor.root,trigger:timeToken,beforeOpen:()=>timeEditor.open(),onChange:open=>{if(open)queueMicrotask(()=>{if(timePopover.isOpen())timeText.focus({preventScroll:true});});}});
 const book=node('select','daily-book-select');book.id='daily-book';
 const bookPanel=node('div','daily-editor-panel');bookPanel.id='daily-book-editor';bookPanel.append(book);
 const bookChoice=(()=>{try{return mountChoiceControl({document,select:book,label:t('daily.field.book')})||null;}catch{return null;}})();
 bookPanel.setAttribute('popover','auto');bookPanel.setAttribute('role','dialog');bookPanel.setAttribute('aria-label',t('daily.field.book'));
 if(typeof bookPanel.showPopover!=='function')bookPanel.setAttribute('hidden','');
 bookToken.setAttribute('aria-controls',bookPanel.id);bookToken.setAttribute('aria-expanded','false');bookToken.setAttribute('aria-haspopup','dialog');
 bookToken.setAttribute('popovertarget',bookPanel.id);bookToken.addEventListener('click',guardEditor);
 const bookPopover=mountPopover({document,element:bookPanel,trigger:bookToken,onChange:open=>{if(open)queueMicrotask(()=>{if(bookPopover.isOpen())(bookChoice?.input||bookChoice?.chips?.find(chip=>!chip.disabled)||book).focus({preventScroll:true});});}});
 // Escape first dismisses an open nested listbox; once closed it belongs to
 // the book popup. Enter here can never submit the enclosing authorization.
 bookPanel.addEventListener('keydown',event=>{if(event.key==='Escape'&&bookChoice?.input?.getAttribute('aria-expanded')!=='true'){event.preventDefault();event.stopPropagation();bookPopover.close();}},true);
 bookPanel.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
 const closeTransient=()=>{timePopover.close({focus:false});bookPopover.close({focus:false});timeEditor.close();};
 // The permission card explains exactly what the daily note may read.
 const permission=settingGroup({document,title:'',description:''});
 permission.title.textContent=t('daily.permission.title');labels.set(permission.title,{id:'daily.permission.title'});
 permission.description.textContent=t('daily.permission.description');labels.set(permission.description,{id:'daily.permission.description'});
 const consent=node('input');consent.id='daily-consent';consent.type='checkbox';consent.checked=false;
 const consentSwitch=switchRow({document,input:consent,label:t('daily.consent'),description:''});
 labels.set(consentSwitch.label,{id:'daily.consent'});
 permission.body.append(consentSwitch.root);
 const save=ui('button','primary','daily.enable');save.id='daily-save';save.type='submit';
 const pauseInput=node('input');pauseInput.id='daily-pause-toggle';pauseInput.type='checkbox';pauseInput.checked=false;
 const pauseSwitch=switchRow({document,input:pauseInput,label:t('daily.pause.toggle'),description:''});
 labels.set(pauseSwitch.label,{id:'daily.pause.toggle'});
 const actions=node('div','daily-actions');actions.append(save);
 const status=node('p','settings-status');status.id='daily-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 // Everything about hosts, expiry, time zone and refresh stays available in
 // one quiet connection-details disclosure instead of the first screen.
 const details=node('details','daily-connection-details');details.id='daily-connection-details';
 const detailsSummary=ui('summary','','daily.connection.details');
 const reload=ui('button','text-link','daily.refresh');reload.id='daily-refresh';reload.type='button';
 const configButton=ui('button','text-link','daily.download');configButton.id='daily-download';configButton.type='button';configButton.hidden=true;
 const configHelp=ui('p','daily-field-help','daily.download.help');configHelp.hidden=true;
 details.append(detailsSummary,binding,connection,expiry,channel,zone,reload,configButton,configHelp);
 form.append(hero,bookPanel,timeEditor.root,badge,pauseSwitch.root,permission.root,actions,details,status);root.append(heading,intro,form);
 let owner=null,generation=0,view=null,busy=false,credential=null,credentialBinding=null,dirty=false,loaded=false,disposed=false,noticeEdited=false;
 // Cached public presentation for label-only language updates: it never reads
 // sessions, books or the server and never rebuilds options or the inbox.
 let model={stateKey:'unset',time:'20:00',zoneId:'Asia/Shanghai',boundTitle:null,bookBound:false,hostLabel:null,connected:false,paused:false,hasPlan:false,expiryDate:null};
 const bindingKey=p=>p?JSON.stringify([p.id,p.revision,p.grantId,p.bookId,p.time,p.timeZone]):null;
 const currentOwner=()=>getSession()?.user?.id||null;
 const localeDate=(date,options)=>new Intl.DateTimeFormat(getUiLocale(),{timeZone:'Asia/Shanghai',...options}).format(date);
 const paintStatus=(textValue,error)=>{status.textContent=textValue;status.classList.toggle('error',!!error);status.setAttribute('role',error?'alert':'status');};
 let lastNotice=null;
 const notice=(id,params=null,error=false,{edited=false}={})=>{lastNotice={id,params,error};noticeEdited=edited;paintStatus(t(id,params)+(edited?' '+t('daily.status.edited'):''),error);};
 const message=(textValue,error=false)=>{lastNotice=null;noticeEdited=false;paintStatus(textValue,error);};
 const valid=(expected,sequence)=>!disposed&&currentOwner()===expected&&owner===expected&&generation===sequence;
 function renderInbox(){
  if(!inboxRoot)return;inboxRoot.replaceChildren();const cards=owner?[...(view?.inbox||[])].sort((a,b)=>Date.parse(b.deliveredAt||b.createdAt)-Date.parse(a.deliveredAt||a.createdAt)).slice(0,3):[];inboxRoot.hidden=!cards.length;
  if(!cards.length)return;inboxRoot.append(own(node('h2',''),{id:'daily.inbox.title'}));
  for(const card of cards){
   const article=node('article','daily-card'),meta=node('div','daily-card-meta');meta.append(own(node('span',''),{id:'daily.inbox.label'}));
   if(card.label&&card.label!==DEFAULT_INBOX_LABEL)meta.append(node('span','daily-card-label',card.label));
   const date=new Date(card.deliveredAt||card.createdAt);if(!Number.isNaN(date.getTime())){const stamp=node('time','',localeDate(date,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));stamp.dateTime=date.toISOString();own(stamp,{render:()=>localeDate(date,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})});meta.append(stamp);}
   const bookTitle=card.bookTitle||getBooks().find(b=>b.bookId===card.bookId)?.title?.zh;if(bookTitle)article.append(own(node('p','daily-card-source'),{render:()=>t('daily.inbox.source',{title:bookTitle})+(card.chapterLabel?' · '+card.chapterLabel:'')}));
   article.append(meta,node('p','daily-card-message',card.message||''));
   if(card.quote?.text)article.append(node('blockquote','daily-card-quote',card.quote.text));
   const link=sourceLink(card.link);if(link){const back=own(node('a','text-link'),{id:'daily.inbox.back'});back.href=uiHref(link);back.setAttribute('data-ui-owned-href',link);links.add(back);article.append(back);}inboxRoot.append(article);
  }
 }
 // The sentence always shows the editor's current 24-hour value, so the page
 // states each fact once instead of repeating a status log.
 const selectedBookLabel=()=>[...(book.options||[])].find(option=>option.value===book.value)?.textContent||'';
 const paintToken=()=>{timeToken.textContent=time.value||model.time;timeToken.setAttribute('aria-label',t('daily.field.time'));bookToken.textContent=model.bookLabel||t('daily.binding.boundBook');};
 const syncSwitches=()=>{consentSwitch.sync();pauseSwitch.sync();};
 function renderChrome(){
  state.textContent=t('daily.state.'+model.stateKey);state.dataset.state=model.stateKey;
  paintToken();
  binding.textContent=model.hasPlan?t('daily.binding.book',{title:model.boundTitle})+(model.bookBound?'':t('daily.binding.removed')):t('daily.binding.none');
  connection.textContent=model.connected?t('daily.connection.active',{host:model.hostLabel||t('daily.host.default')}):model.paused?t('daily.connection.paused'):model.hasPlan?t('daily.connection.pending'):t('daily.connection.none');
  expiry.textContent=model.expiryDate?t('daily.expiry',{date:localeDate(model.expiryDate,{year:'numeric',month:'long',day:'numeric'})}):'';
 }
 function render(){
  const p=view?.plan,books=getBooks(),rawState=p?.status==='active'&&!p.connectedAt?'awaiting-host':p?.status;
  model.stateKey=p?(KNOWN_STATES.has(rawState)?rawState:'reconnect'):'unset';model.hasPlan=!!p;model.time=p?.time||'20:00';
  model.zoneId=p?.timeZone||'Asia/Shanghai';
  const boundBook=p&&books.find(b=>b.bookId===p.bookId);model.bookBound=!!boundBook;
  model.boundTitle=p?.bookTitle||(boundBook?title(boundBook):p?t('daily.binding.boundBook'):'');
  model.connected=p?.status==='active'&&!!p.connectedAt;model.paused=p?.status==='paused';model.hostLabel=p?.hostLabel||null;
  const end=new Date(p?.grantExpiresAt);model.expiryDate=p&&!Number.isNaN(end.getTime())?end:null;
  if(!dirty){book.replaceChildren();if(p&&!boundBook){const option=node('option','',model.boundTitle+t('daily.boundSuffix'));option.value=p.bookId;book.append(option);}for(const b of books){const option=node('option','',title(b));option.value=b.bookId;book.append(option);}book.value=p?.bookId||getCurrentBook()?.bookId||books[0]?.bookId||'';time.value=p?.time||'20:00';}
  model.bookLabel=selectedBookLabel();
  book.setAttribute('aria-label',t('daily.field.book'));
  // The sentence always shows the hydrated or edited value, never a stale one.
  renderChrome();
  for(const field of [book,time,timeText,timeToken,bookToken,consent,save,reload])field.disabled=!owner||busy;
  if(!owner||busy)closeTransient();save.disabled||=!book.value||!loaded;
  // The pause switch only ever mirrors the server plan; a write in flight keeps
  // the user's pressed state and a refused write falls back to it in render().
  pauseSwitch.root.hidden=!p;
  pauseInput.disabled=!owner||busy||!loaded||!p||!['active','awaiting-host','paused'].includes(p.status);
  if(!busy)pauseInput.checked=model.paused;
  configButton.hidden=!credential;configHelp.hidden=!credential;configButton.disabled=busy||!owner;form.setAttribute('aria-busy',String(busy));timeEditor.sync();bookChoice?.sync();syncSwitches();renderInbox();
 }
 function update(){const next=currentOwner();if(owner!==next){closeTransient();owner=next;generation++;view=null;credential=null;credentialBinding=null;busy=false;dirty=false;loaded=false;consent.checked=false;message('');}render();}
 async function refresh(){update();if(disposed||!owner||busy||typeof api!=='function')return;const expected=owner,sequence=++generation;busy=true;render();try{const result=await api('/api/library/daily-reading');if(!valid(expected,sequence))return;view=result;if(credentialBinding!==bindingKey(view?.plan))credential=null;loaded=true;message('');}catch(error){if(valid(expected,sequence))notice('daily.status.error',null,true);}finally{if(valid(expected,sequence)){busy=false;render();}}}
 async function write(path,body){
  update();if(disposed||!owner||busy||!loaded)return;const expected=owner,sequence=++generation,trigger=document.activeElement,focus=trackActionFocus(document,trigger);busy=true;if(path==='')credential=null;message('');render();
  try{const result=await api('/api/library/daily-reading'+path,body);if(!valid(expected,sequence))return;const {token,...publicResult}=result;view={...view,...publicResult};if(path==='')dirty=false;
   if(token){credential={version:1,serviceUrl:origin,token,hostInstallId:globalThis.crypto.randomUUID(),hostLabel:'我的陪读宿主',schedulerId:''};credentialBinding=bindingKey(view.plan);consent.checked=false;}
   if(path==='/pause'||credentialBinding!==bindingKey(view.plan))credential=null;
   notice(path==='/pause'?'daily.status.paused':path==='/resume'?'daily.status.resumed':'daily.status.saved',null,false,{edited:dirty});
  }catch(error){if(valid(expected,sequence))notice(error.status===409?'daily.status.conflict':'daily.status.saveFailed',null,true);}
  finally{if(valid(expected,sequence)){busy=false;render();focus.restore(trigger?.hidden?reload:trigger);}else focus.stop();}
 }
 // Explicit edits keep a draft; a new book or time invalidates the previous
 // authorization so the next enable action must be a fresh, deliberate consent.
 const invalidateConsent=()=>{if(consent.checked){consent.checked=false;consentSwitch.sync();notice('daily.status.reauthorize');}};
 const onBookChange=()=>{dirty=true;model.bookLabel=selectedBookLabel();paintToken();invalidateConsent();},onTimeInput=()=>{dirty=true;paintToken();invalidateConsent();};
 book.addEventListener('change',onBookChange);time.addEventListener('input',onTimeInput);
 // The one deliberate enabling action: it is what creates or changes the plan.
 const onSubmit=event=>{event.preventDefault();if(!owner||busy||!loaded)return;if(!timeEditor.commit()){notice('daily.time.invalid',null,true);return;}if(!consent.checked){notice('daily.status.consentRequired',null,true);return;}write('',{baseRevision:view?.plan?.revision||0,bookId:book.value,time:time.value,timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}});};
 form.addEventListener('submit',onSubmit);
 const onPauseToggle=()=>write(pauseInput.checked?'/pause':'/resume',{baseRevision:view?.plan?.revision||0}),onReload=()=>refresh();
 pauseInput.addEventListener('change',onPauseToggle);reload.addEventListener('click',onReload);
 const onDownload=()=>{update();if(owner&&credential)download({...credential});};
 configButton.addEventListener('click',onDownload);update();
 function updateLabels(){
  if(disposed)return;
  for(const [n,spec] of labels){if(!n.isConnected){labels.delete(n);links.delete(n);continue;}n.textContent=text(spec);}
  book.setAttribute('aria-label',t('daily.field.book'));bookPanel.setAttribute('aria-label',t('daily.field.book'));timeEditor.updateLabels({customLabel:t('daily.time.custom'),label:t('daily.field.time')});bookChoice?.updateLabels({label:t('daily.field.book')});paintToken();
  renderChrome();
  for(const link of [...links]){if(!link.isConnected){links.delete(link);continue;}link.href=uiHref(link.getAttribute('data-ui-owned-href')||'');}
  if(lastNotice)paintStatus(t(lastNotice.id,lastNotice.params)+(noticeEdited?' '+t('daily.status.edited'):''),lastNotice.error);
 }
 const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
 return {update,refresh,updateLabels,closeTransient,dispose(){
   if(disposed)return;closeTransient();disposed=true;generation++;offLocale();labels.clear();links.clear();lastNotice=null;view=null;credential=null;credentialBinding=null;busy=false;loaded=false;dirty=false;
   book.removeEventListener('change',onBookChange);time.removeEventListener('input',onTimeInput);form.removeEventListener('submit',onSubmit);
   pauseInput.removeEventListener('change',onPauseToggle);reload.removeEventListener('click',onReload);configButton.removeEventListener('click',onDownload);
   timeEditor.destroy?.();
 },clear(){closeTransient();owner=null;generation++;view=null;credential=null;credentialBinding=null;busy=false;dirty=false;loaded=false;consent.checked=false;syncSwitches();message('');render();}};
}
