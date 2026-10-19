import {t,getUiLocale,uiHref,onUiLocaleChange,uiReady} from './ui-locale.mjs';
import {trackActionFocus} from './action-focus.mjs';
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
// Owner reads and explicit writes only. A downloaded credential is not evidence
// of a running scheduler; server connection state is authoritative. Language
// commits relabel owned nodes from cached public state only: no API call, no
// option or inbox rebuild, no session/book read and no plan/grant write.
export function mountLibraryDailyReading({root,inboxRoot=null,api,getSession,getBooks=()=>[],getCurrentBook=()=>null,origin=globalThis.location?.origin,download=downloadConfig}){
 const labels=new Map(),links=new Set();
 const text=spec=>spec.render?spec.render():t(spec.id,spec.params);
 const own=(n,spec)=>{labels.set(n,spec);n.textContent=text(spec);return n;};
 const ui=(tag,cls,id,params)=>own(node(tag,cls),{id,params});
 const heading=ui('h3','','daily.title'),intro=ui('p','settings-description','daily.intro');
 const summary=node('div','daily-summary'),state=node('span','daily-state');state.id='daily-state';
 const schedule=node('p','daily-schedule'),channel=ui('p','daily-channel','daily.channel');summary.append(state,schedule,channel);
 const binding=node('p','daily-binding'),connection=node('p','daily-connection'),expiry=node('p','daily-expiry');
 const form=node('form','daily-form');form.id='daily-form';
 const bookLabel=ui('label','profile-field-label','daily.field.book');bookLabel.htmlFor='daily-book';const book=node('select','profile-input');book.id='daily-book';
 const timeLabel=ui('label','profile-field-label','daily.field.time');timeLabel.htmlFor='daily-time';const time=node('input','profile-input');time.id='daily-time';time.type='time';time.required=true;time.value='20:00';
 const zone=ui('p','daily-field-help','daily.field.zone');
 const consentLabel=node('label','daily-consent'),consent=node('input');consent.id='daily-consent';consent.type='checkbox';consent.checked=false;
 consentLabel.append(consent,ui('span','','daily.consent'));
 const save=ui('button','primary','daily.save');save.id='daily-save';save.type='submit';
 const pause=ui('button','outline','daily.pause');pause.id='daily-pause';pause.type='button';const resume=ui('button','outline','daily.resume');resume.id='daily-resume';resume.type='button';
 const actions=node('div','daily-actions');actions.append(save,pause,resume);
 const configButton=ui('button','text-link','daily.download');configButton.id='daily-download';configButton.type='button';configButton.hidden=true;
 const configHelp=ui('p','daily-field-help','daily.download.help');configHelp.hidden=true;
 const status=node('p','settings-status');status.id='daily-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const reload=ui('button','text-link','daily.refresh');reload.id='daily-refresh';reload.type='button';
 form.append(bookLabel,book,timeLabel,time,zone,consentLabel,actions,configButton,configHelp,status,reload);root.append(heading,intro,summary,binding,connection,expiry,form);
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
 function renderChrome(){
  state.textContent=t('daily.state.'+model.stateKey);state.dataset.state=model.stateKey;
  schedule.textContent=t('daily.schedule',{time:model.time,zone:model.zoneId==='Asia/Shanghai'?t('daily.zone.beijing'):model.zoneId});
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
  renderChrome();
  if(!dirty){book.replaceChildren();if(p&&!boundBook){const option=node('option','',model.boundTitle+t('daily.boundSuffix'));option.value=p.bookId;book.append(option);}for(const b of books){const option=node('option','',title(b));option.value=b.bookId;book.append(option);}book.value=p?.bookId||getCurrentBook()?.bookId||books[0]?.bookId||'';time.value=p?.time||'20:00';}
  for(const field of [book,time,consent,save,reload])field.disabled=!owner||busy;save.disabled||=!book.value||!loaded;pause.disabled=resume.disabled=!owner||busy||!loaded;
  pause.hidden=!p||!['active','awaiting-host'].includes(p.status);resume.hidden=p?.status!=='paused';
  configButton.hidden=!credential;configHelp.hidden=!credential;configButton.disabled=busy||!owner;form.setAttribute('aria-busy',String(busy));renderInbox();
 }
 function update(){const next=currentOwner();if(owner!==next){owner=next;generation++;view=null;credential=null;credentialBinding=null;busy=false;dirty=false;loaded=false;consent.checked=false;message('');}render();}
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
 const onBookChange=()=>{dirty=true;},onTimeInput=()=>{dirty=true;};
 book.addEventListener('change',onBookChange);time.addEventListener('input',onTimeInput);
 const onSubmit=event=>{event.preventDefault();if(!consent.checked){notice('daily.status.consentRequired',null,true);return;}write('',{baseRevision:view?.plan?.revision||0,bookId:book.value,time:time.value,timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}});};
 form.addEventListener('submit',onSubmit);
 const onPause=()=>write('/pause',{baseRevision:view?.plan?.revision||0}),onResume=()=>write('/resume',{baseRevision:view?.plan?.revision||0}),onReload=()=>refresh();
 pause.addEventListener('click',onPause);resume.addEventListener('click',onResume);reload.addEventListener('click',onReload);
 const onDownload=()=>{update();if(owner&&credential)download({...credential});};
 configButton.addEventListener('click',onDownload);update();
 function updateLabels(){
  if(disposed)return;
  for(const [n,spec] of labels){if(!n.isConnected){labels.delete(n);links.delete(n);continue;}n.textContent=text(spec);}
  renderChrome();
  for(const link of [...links]){if(!link.isConnected){links.delete(link);continue;}link.href=uiHref(link.getAttribute('data-ui-owned-href')||'');}
  if(lastNotice)paintStatus(t(lastNotice.id,lastNotice.params)+(noticeEdited?' '+t('daily.status.edited'):''),lastNotice.error);
 }
 const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
 return {update,refresh,updateLabels,dispose(){
   if(disposed)return;disposed=true;generation++;offLocale();labels.clear();links.clear();lastNotice=null;view=null;credential=null;credentialBinding=null;busy=false;loaded=false;dirty=false;
   book.removeEventListener('change',onBookChange);time.removeEventListener('input',onTimeInput);form.removeEventListener('submit',onSubmit);
   pause.removeEventListener('click',onPause);resume.removeEventListener('click',onResume);reload.removeEventListener('click',onReload);configButton.removeEventListener('click',onDownload);
 },clear(){owner=null;generation++;view=null;credential=null;credentialBinding=null;busy=false;dirty=false;loaded=false;consent.checked=false;message('');render();}};
}
