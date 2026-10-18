import {trackActionFocus} from './action-focus.mjs';
const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const states={'awaiting-host':'待连接',active:'已开启',paused:'已暂停',expired:'连接已到期'};
const title=book=>book?.title?.zh||book?.title?.en||'未选择书籍';
function sourceLink(value){
 if(typeof value!=='string'||!value.startsWith('/read?'))return null;
 try{const url=new URL(value,'https://leafhour.invalid');if(url.pathname!=='/read'||url.origin!=='https://leafhour.invalid'||!url.searchParams.get('book')||!url.searchParams.get('passage')||!url.searchParams.get('contentVersion')||url.searchParams.get('layer')!=='original')return null;return url.pathname+url.search;}catch{return null;}
}
function downloadConfig(config){
 const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'})),link=node('a');link.href=url;link.download='leafhour-daily-private.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}
// Owner reads and explicit writes only. A downloaded credential is not evidence
// of a running scheduler; server connection state is authoritative.
export function mountLibraryDailyReading({root,inboxRoot=null,api,getSession,getBooks=()=>[],getCurrentBook=()=>null,origin=globalThis.location?.origin,download=downloadConfig}){
 const heading=node('h3','','每日陪读'),intro=node('p','settings-description','每天留一张纸条，在书房等你。读书时不打扰，随时可以暂停。');
 const summary=node('div','daily-summary'),state=node('span','daily-state','尚未设置');state.id='daily-state';
 const schedule=node('p','daily-schedule','每天 20:00 · 北京时间'),channel=node('p','daily-channel','送到 Leafhour 书房');summary.append(state,schedule,channel);
 const binding=node('p','daily-binding'),connection=node('p','daily-connection'),expiry=node('p','daily-expiry');
 const form=node('form','daily-form');form.id='daily-form';
 const bookLabel=node('label','profile-field-label','陪读这本书');bookLabel.htmlFor='daily-book';const book=node('select','profile-input');book.id='daily-book';
 const timeLabel=node('label','profile-field-label','每天几点');timeLabel.htmlFor='daily-time';const time=node('input','profile-input');time.id='daily-time';time.type='time';time.required=true;time.value='20:00';
 const zone=node('p','daily-field-help','北京时间 · Asia/Shanghai。换书或改时间后，需要宿主重新确认连接。');
 const consentLabel=node('label','daily-consent'),consent=node('input');consent.id='daily-consent';consent.type='checkbox';consent.checked=false;
 consentLabel.append(consent,node('span','','允许陪读宿主读取这本书当前一段原文、阅读位置及当日阅读时长，用于续读纸条。私人笔记不在授权内。'));
 const save=node('button','primary','保存并准备连接');save.id='daily-save';save.type='submit';
 const pause=node('button','outline','暂停陪读');pause.id='daily-pause';pause.type='button';const resume=node('button','outline','恢复陪读');resume.id='daily-resume';resume.type='button';
 const actions=node('div','daily-actions');actions.append(save,pause,resume);
 const configButton=node('button','text-link','下载私有连接配置');configButton.id='daily-download';configButton.type='button';configButton.hidden=true;
 const configHelp=node('p','daily-field-help','连接配置含临时密钥，只交给自己的宿主，并将文件设为仅自己可读。授权 30 天，到期后需重新连接。');configHelp.hidden=true;
 const status=node('p','settings-status');status.id='daily-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const reload=node('button','text-link','刷新连接状态');reload.id='daily-refresh';reload.type='button';
 form.append(bookLabel,book,timeLabel,time,zone,consentLabel,actions,configButton,configHelp,status,reload);root.append(heading,intro,summary,binding,connection,expiry,form);
 let owner=null,generation=0,view=null,busy=false,credential=null,credentialBinding=null,dirty=false,loaded=false;
 const bindingKey=p=>p?JSON.stringify([p.id,p.revision,p.grantId,p.bookId,p.time,p.timeZone]):null;
 const currentOwner=()=>getSession()?.user?.id||null;
 const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');};
 const valid=(expected,sequence)=>currentOwner()===expected&&owner===expected&&generation===sequence;
 function renderInbox(){
  if(!inboxRoot)return;inboxRoot.replaceChildren();const cards=owner?[...(view?.inbox||[])].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,3):[];inboxRoot.hidden=!cards.length;
  if(!cards.length)return;const h=node('h2','','留在书房的纸条');inboxRoot.append(h);
  for(const card of cards){
   const article=node('article','daily-card'),meta=node('div','daily-card-meta'),label=node('span','','AI · 每日陪读');meta.append(label);
   if(card.label)meta.append(node('span','daily-card-label',card.label));
   const date=new Date(card.createdAt);if(!Number.isNaN(date.getTime())){const stamp=node('time','',new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date));stamp.dateTime=date.toISOString();meta.append(stamp);}
   article.append(meta,node('p','daily-card-message',card.message||''));
   if(card.quote?.text)article.append(node('blockquote','daily-card-quote',card.quote.text));
   const link=sourceLink(card.link);if(link){const back=node('a','text-link','回到这一段原文 →');back.href=link;article.append(back);}inboxRoot.append(article);
  }
 }
 function render(){
  const p=view?.plan,books=getBooks(),stateKey=p?.status==='active'&&!p.connectedAt?'awaiting-host':p?.status;state.textContent=p?(states[stateKey]||'待重新连接'):'尚未设置';state.dataset.state=stateKey||'unset';
  schedule.textContent='每天 '+(p?.time||'20:00')+' · '+((p?.timeZone||'Asia/Shanghai')==='Asia/Shanghai'?'北京时间':p.timeZone);
  binding.textContent=p?'陪读《'+title(books.find(b=>b.bookId===p.bookId))+'》':'从你正在读的书开始。';
  connection.textContent=p?.status==='active'&&p.connectedAt?'宿主：'+(p.hostLabel||'已连接')+' · 已完成连接':p?.status==='paused'?'已暂停，未完成的纸条不会送达。':p?'宿主尚未完成连接。准备配置后，还需由宿主确认日程。':'由你自己的 Agent 宿主按日程留纸条。';
  const end=new Date(p?.grantExpiresAt);expiry.textContent=p&&!Number.isNaN(end.getTime())?'授权到期：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}).format(end):'';
  if(!dirty){book.replaceChildren();for(const b of books){const option=node('option','',title(b));option.value=b.bookId;book.append(option);}book.value=p?.bookId||getCurrentBook()?.bookId||books[0]?.bookId||'';time.value=p?.time||'20:00';}
  for(const field of [book,time,consent,save,reload])field.disabled=!owner||busy;save.disabled||=!book.value||!loaded;pause.disabled=resume.disabled=!owner||busy||!loaded;
  pause.hidden=!p||!['active','awaiting-host'].includes(p.status);resume.hidden=p?.status!=='paused';
  configButton.hidden=!credential;configHelp.hidden=!credential;configButton.disabled=busy||!owner;form.setAttribute('aria-busy',String(busy));renderInbox();
 }
 function update(){const next=currentOwner();if(owner!==next){owner=next;generation++;view=null;credential=null;credentialBinding=null;busy=false;dirty=false;loaded=false;consent.checked=false;message('');}render();}
 async function refresh(){update();if(!owner||busy||typeof api!=='function')return;const expected=owner,sequence=++generation;busy=true;render();try{const result=await api('/api/library/daily-reading');if(!valid(expected,sequence))return;view=result;if(credentialBinding!==bindingKey(view?.plan))credential=null;loaded=true;message('');}catch(error){if(valid(expected,sequence))message('陪读状态暂时无法读取。'+(error.message||''),true);}finally{if(valid(expected,sequence)){busy=false;render();}}}
 async function write(path,body){
  update();if(!owner||busy||!loaded)return;const expected=owner,sequence=++generation,trigger=document.activeElement,focus=trackActionFocus(document,trigger);busy=true;if(path==='')credential=null;message('');render();
  try{const result=await api('/api/library/daily-reading'+path,body);if(!valid(expected,sequence))return;const {token,...publicResult}=result;view={...view,...publicResult};if(path==='')dirty=false;
   if(token){credential={version:1,serviceUrl:origin,token,hostInstallId:globalThis.crypto.randomUUID(),hostLabel:'我的陪读宿主',schedulerId:''};credentialBinding=bindingKey(view.plan);consent.checked=false;}
   if(path==='/pause'||credentialBinding!==bindingKey(view.plan))credential=null;message(path==='/pause'?'已暂停。'+(dirty?'未保存的编辑仍保留。':''):path==='/resume'?'已恢复，请核对宿主连接状态。'+(dirty?'未保存的编辑仍保留。':''):'已保存，等待宿主连接。');
  }catch(error){if(valid(expected,sequence))message(error.status===409?'设置已在另一处更新，请先刷新状态，再确认保存。':'设置暂未保存。'+(error.message||''),true);}
  finally{if(valid(expected,sequence)){busy=false;render();focus.restore(trigger?.hidden?reload:trigger);}else focus.stop();}
 }
 book.addEventListener('change',()=>{dirty=true;});time.addEventListener('input',()=>{dirty=true;});
 form.addEventListener('submit',event=>{event.preventDefault();if(!consent.checked){message('请先确认本次陪读授权。',true);return;}write('',{baseRevision:view?.plan?.revision||0,bookId:book.value,time:time.value,timeZone:'Asia/Shanghai',consent:{originalText:true,readingActivity:true}});});
 pause.addEventListener('click',()=>write('/pause',{baseRevision:view?.plan?.revision||0}));resume.addEventListener('click',()=>write('/resume',{baseRevision:view?.plan?.revision||0}));reload.addEventListener('click',()=>refresh());
 configButton.addEventListener('click',()=>{update();if(owner&&credential)download({...credential});});update();
 return {update,refresh,clear(){owner=null;generation++;view=null;credential=null;credentialBinding=null;busy=false;dirty=false;loaded=false;consent.checked=false;message('');render();}};
}
