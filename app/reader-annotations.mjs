import {creditActionLabel,creditErrorId} from './credit-labels.mjs';
import {t,getUiLocale,uiHref,onUiLocaleChange,createUiLabels} from './ui-locale.mjs';
import {readingChatQuoteFromExcerpt,normalizeReadingChatQuote,validateCurrentReadingChatQuote} from './reading-chat-quote.mjs';
import {activeHighlights,highlightKey,normalizeHighlight} from './highlights.mjs';
import {renderChatMarkdown} from './library-chat-markdown.mjs';
import {createAnnotationPending} from './reader-annotation-pending.mjs';
import {mountAnnotationMargins,annotationSheetBounds} from './reader-annotation-margins.mjs';
import {createNoteDrafts} from './note-drafts.mjs';

const PREFIX='reader.annotation.',equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const terminal=value=>['completed','failed','cancelled'].includes(value);
const failureKey=error=>({401:'login',403:'login',409:'stale',413:'capacity',422:'stale',429:'limit'}[error?.status]||'unconfirmed');

// Uses the live reader's API, highlight acceptance, session and locale owner.
export function mountReaderAnnotations({document,api,getSession=()=>null,getSelection,getRecords,signedIn,available,accept,notify,isCurrent=()=>true,storage}){
 const view=document.defaultView,labels=createUiLabels(),listeners=[],controllers=new Set();
 const reader=()=>view.marginaliaReader,owner=()=>view.marginaliaPaletteAdapter?.getOwner?.();
 let disposed=false,epoch=0,readEpoch=0,scope=null,outbox=null,archive=null,requests=[],activeId=null,opener=null,busy=false,cancelling=false,composing=false,draftVersion=0,poll=null,drafts=Object.create(null),lastMessages='',refusal=null,markThread=null,noteDrafts=createNoteDrafts(),noteBusy=false,noteStorageBad=false;
 try{storage??=view.localStorage;}catch{}
 const node=(tag,className)=>{const el=document.createElement(tag);if(className)el.className=className;return el;};
 const write=(el,key,attribute)=>attribute?labels.attr(el,attribute,PREFIX+key):labels.text(el,PREFIX+key);
 const button=(key,action)=>{const el=node('button');el.type='button';write(el,key);el.addEventListener('click',action);return el;};
 const listen=(el,name,callback,options)=>{el?.addEventListener(name,callback,options);listeners.push(()=>el?.removeEventListener(name,callback,options));};
 const identity=()=>{const book=reader()?.getBook?.();return owner()&&book?JSON.stringify([owner(),book.bookId,book.contentVersion]):null;};
 const current=(token=epoch,own=scope)=>!disposed&&isCurrent()&&token===epoch&&own===scope&&identity()===own;
 const book=()=>reader()?.getBook?.(),endpoint=()=>'/api/library/books/'+encodeURIComponent(book().bookId)+'/annotations';
 const draftKey=()=> 'marginalia-annotation-drafts-v1|'+scope;
 const thread=()=>archive?.threads.find(row=>row.id===activeId)|| (outbox?.current()?.input.threadId===activeId?{id:activeId,quote:outbox.current().input.quote,highlightId:outbox.current().input.highlightId,messages:[]}:refusal?.id===activeId?{...refusal,messages:[]}:markThread?.id===activeId?markThread:null);
 const lastRequest=()=>requests.findLast(row=>row.threadId===activeId);
 const card=node('section','reader-annotation-card');card.id='reader-annotation-card';card.hidden=true;card.setAttribute('role','region');
 const heading=node('header','reader-annotation-heading'),title=node('span');title.id='reader-annotation-title';write(title,'title');card.setAttribute('aria-labelledby',title.id);
 const close=button('close',()=>hide());close.className='reader-annotation-close';labels.forget(close,'text');close.textContent='×';write(close,'close','aria-label');const previous=button('previous',()=>step(-1)),next=button('next',()=>step(1)),count=node('span','reader-annotation-count');previous.className='reader-annotation-previous';next.className='reader-annotation-next';labels.forget(previous);labels.forget(next);previous.textContent='‹';next.textContent='›';write(previous,'previous','aria-label');write(next,'next','aria-label');heading.append(title,previous,count,next,close);
 const scroll=node('div','reader-annotation-scroll'),source=node('div','reader-annotation-source'),sourceLabel=node('span'),sourceState=node('span'),sourceHistory=node('span'),selected=node('blockquote'),messages=node('div','reader-annotation-messages');source.append(sourceLabel,sourceState,sourceHistory,selected);
 const status=node('p','reader-annotation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const form=node('form','reader-annotation-form'),area=node('textarea');area.id='reader-annotation-followup';area.maxLength=2000;area.rows=2;write(area,'replyLabel','aria-label');write(area,'placeholder','placeholder');
 const saveNote=button('saveNote',()=>saveOwnNote());saveNote.className='reader-annotation-save-note';
 const explain=button('explain',()=>retryRequest());explain.className='reader-annotation-explain';
 const send=button('send',()=>{}),price=node('small','reader-annotation-price');send.type='submit';const actions=node('div','reader-annotation-actions');
 const retry=button('retry',()=>retryRequest()),cancel=button('cancel',()=>cancelRequest()),remove=button('remove',()=>removeThread()),billLink=node('a','reader-annotation-billing-link');actions.append(retry,cancel,remove,price,explain);
 form.append(area,saveNote,send);scroll.append(source,messages,status,form,actions);card.append(heading,scroll);
 const state=key=>{if(key)write(status,key);else{labels.forget(status);status.textContent='';}};
 function paintRefusal(){
  price.hidden=getSession()?.billing?.enabled!==true;price.textContent=price.hidden?'':creditActionLabel('annotation',getUiLocale());
  const error=refusal?.id===activeId?refusal.error:null;
  if(error)labels.text(status,creditErrorId(error));
  if(error?.status===402){labels.text(billLink,'billing.accountLink');billLink.href=uiHref('/billing');if(billLink.parentElement!==actions)actions.append(billLink);}else billLink.remove();
  return !!error;
 }
 function notice(key,{recover=false}={}){
  notify('',{error:true,id:PREFIX+key});
  if(recover){const action=button('returnPending',async()=>{const pending=outbox?.current(),own=scope;if(!pending)return;await reader()?.goToPassage?.(pending.input.quote.parts[0].passageId,{validate:()=>!disposed&&identity()===own});if(!disposed&&identity()===own)show(pending.input.threadId,action);});document.getElementById('highlight-status')?.append(action);}
 }
 function saveDraft(){if(!activeId||!scope||identity()!==scope||disposed)return;drafts[activeId]=area.value;try{storage?.setItem(draftKey(),JSON.stringify(drafts));}catch{state('draftMemory');}}
 const margins=mountAnnotationMargins({document,storage,getScope:()=>scope,getEntries:summaryEntries,onRetry:()=>refresh(),onOpen:(id,origin)=>{
  const row=activeHighlights(getRecords()).find(r=>'highlight-'+r.id===id);if(row)openHighlight(row,origin);else show(id,origin);
 },onHide:()=>hide(),write});
 function noteKey(){return 'marginalia-annotation-own-drafts-v1|'+scope;}
 function ownKey(){const held=thread();return 'comment:'+(held?.highlightId||held?.id)+':'+held?.quote.parts[0].passageId;}
 function persistOwn(){if(noteStorageBad){state('requestStorage');return false;}try{storage.setItem(noteKey(),JSON.stringify(noteDrafts.snapshot()));return true;}catch{state('draftMemory');return false;}}
 function ownMessages(held){const quote=held.quote.parts.map(p=>p.text).join('\n\n');return (getRecords()?.comments||[]).filter(r=>!r.deletedAt&&r.passageId===held.quote.parts[0].passageId&&r.quote===quote);}
 function summaryEntries(){
  const rows=(archive?.threads||[]).filter(r=>!r.deletedAt),linked=new Set(rows.filter(r=>r.messages.length).map(r=>r.highlightId)),entries=[];
  for(const row of rows){const last=row.messages.findLast(m=>m.origin==='ai')||row.messages.at(-1);if(!last)continue;entries.push({id:row.id,passageId:row.quote.parts[0].passageId,quote:row.quote.parts.map(p=>p.text).join(' '),text:last.body.replace(/[*#`]/g,''),origin:last.origin});}
  for(const row of activeHighlights(getRecords())){if(linked.has(row.id))continue;const own=(getRecords()?.comments||[]).findLast(r=>!r.deletedAt&&r.passageId===row.parts[0].passageId&&r.quote===row.parts.map(p=>p.text).join('\n\n'));entries.push({id:'highlight-'+row.id,passageId:row.parts[0].passageId,quote:row.parts.map(p=>p.text).join(' '),text:own?.text,origin:'user'});}
  return entries;
 }
 function ensureScope(){
  const next=identity();if(next===scope)return !!next;
  epoch++;readEpoch++;clearTimeout(poll);for(const controller of controllers)controller.abort();controllers.clear();
  card.hidden=true;card.remove();margins.reset();activeId=null;busy=false;cancelling=false;archive=null;requests=[];drafts=Object.create(null);lastMessages='';refusal=null;scope=next;markThread=null;noteBusy=false;noteStorageBad=false;noteDrafts=createNoteDrafts();margins.reset();margins.state('pending');
  delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');
  if(!next){outbox=null;return false;}
  outbox=createAnnotationPending({storage,owner:owner(),bookId:book().bookId,contentVersion:book().contentVersion});document.body.append(card);
  try{const raw=storage?.getItem(noteKey());if(raw){if(raw.length>=220000)throw Error('Draft exceeds limit');const value=JSON.parse(raw);if(value?.version!==1||!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries))throw Error('Invalid draft');noteDrafts=createNoteDrafts(value);}}catch{noteStorageBad=true;}
  try{const raw=storage?.getItem(draftKey());if(raw&&raw.length<220000){const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))for(const [key,text]of Object.entries(value).slice(0,100))if(typeof text==='string'&&text.length<=2000)drafts[key]=text;}}catch{}
  return true;
 }
 async function call(url,input){
  const token=epoch,own=scope,controller=new AbortController();controllers.add(controller);
  try{const result=await api(url,input,{signal:controller.signal});if(!current(token,own))throw Object.assign(Error('Stale annotation response'),{stale:true});return result;}finally{controllers.delete(controller);}
 }
 function normalizeView(value){
  if(value?.archive?.kind!=='leafhour-reader-annotations'||value.archive.bookId!==book().bookId||!Array.isArray(value.archive.threads)||value.archive.threads.length>100||!Array.isArray(value.requests))throw Error('Invalid annotation view');
  for(const row of value.archive.threads){normalizeReadingChatQuote(row.quote);if(!Array.isArray(row.messages)||row.messages.length>20||row.messages.some(message=>!['ai','user'].includes(message.origin)||typeof message.body!=='string'||message.body.length>12000||message.origin==='ai'&&!['site-agent','external-agent'].includes(message.provenance?.source)))throw Error('Invalid annotation thread');}
  return value;
 }
 function adoptReceipt(result,input){
  if(!result?.request||result.request.id!==input.id||result.request.threadId!==input.threadId||!['running','completed','cancelled','failed'].includes(result.request.status))throw Error('Unconfirmed annotation receipt');
  requests=requests.filter(row=>row.id!==input.id).concat(result.request);
  if(result.thread){if(result.thread.id!==input.threadId||!equal(result.thread.quote,input.quote))throw Error('Unconfirmed annotation thread');if(archive)archive.threads=archive.threads.filter(row=>row.id!==result.thread.id).concat(result.thread);}
  outbox.reconcile(result.request);readEpoch++;return result.request;
 }
 function paintBadges(){margins.refresh();}
 async function refresh(){
  if(!ensureScope()||!signedIn()||!available())return false;
  const token=epoch,own=scope,sequence=++readEpoch;
  try{const value=normalizeView(await call(endpoint()));if(!current(token,own)||sequence!==readEpoch)return false;archive=value.archive;requests=value.requests;margins.state('ready');for(const request of requests)outbox.reconcile(request);paintBadges();if(!card.hidden)render();schedule();return true;}
  catch(error){if(!error.stale&&current(token,own)){margins.state('error');if(!card.hidden)state('loadFailed');}return false;}
 }
 function schedule(){clearTimeout(poll);if(outbox?.current()?.phase==='explain'&&(busy||requests.some(row=>row.id===outbox.current()?.input.id&&row.status==='running')))poll=view.setTimeout(()=>refresh(),1000);}
 function place(){
  if(card.hidden)return;
  const move=(parent,before=null)=>{if(card.parentElement===parent)return;const focused=card.contains(document.activeElement)&&document.activeElement;parent.insertBefore(card,before);if(focused)focused.focus({preventScroll:true});};
  const chat=document.querySelector('.reader-chat-workspace[open]'),embedded=chat?.classList.contains('is-reader-chat-mobile'),frame=embedded&&chat.querySelector('.library-chat-frame');
  if(frame){
   move(frame,frame.querySelector('.library-chat-messages'));
   card.inert=false;card.dataset.placement='chat';card.style.removeProperty('width');card.style.removeProperty('left');card.style.removeProperty('top');return;
  }
  const held=thread(),rect=held&&margins.rectFor(held.quote.parts[0].passageId),rails=margins.rails();
  const rail=rails.find(r=>r.side==='right')||rails[0];
  card.dataset.placement=rail?'margin':'sheet';
  move(document.body);
  if(rail){card.style.width=rail.width+'px';card.style.left=rail.left+'px';const top=Math.max(76,Math.min(rect?.top||76,view.innerHeight-280));card.style.top=top+'px';card.style.setProperty('--annotation-card-height',Math.max(132,view.innerHeight-top-24)+'px');}
  else{
   card.style.removeProperty('width');card.style.removeProperty('left');card.style.removeProperty('top');
   const blocked=[...document.querySelectorAll('.reader-chat-workspace[open]:not(.is-reader-chat-mobile)')].map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
   const bounds=annotationSheetBounds({viewport:view.innerWidth,blocked});
   card.style.setProperty('--annotation-sheet-left',bounds.left+'px');card.style.setProperty('--annotation-sheet-width',bounds.width+'px');
   const viewport=view.visualViewport,top=(viewport?.offsetTop||0)+12;
   let bottom=Math.max(12,view.innerHeight-(viewport?.height||view.innerHeight)-(viewport?.offsetTop||0)+12);
   const tools=document.getElementById('reading-session')?.getBoundingClientRect();
   if(tools?.width&&tools.left<bounds.left+bounds.width/2&&tools.right>bounds.left-bounds.width/2)bottom=Math.max(bottom,view.innerHeight-tools.top+12);
   card.style.setProperty('--annotation-sheet-height',Math.max(0,view.innerHeight-bottom-top)+'px');
   card.style.setProperty('--annotation-sheet-bottom',bottom+'px');
  }
 }
 function staleQuote(quote){
  if(quote.contentVersion!==book().contentVersion)return true;
  const loaded=new Set(book().sections.flatMap(section=>section.paragraphs.map(p=>p.id)));
  if(!quote.parts.every(part=>loaded.has(part.passageId)))return false;
  try{if(!allowsAi(quote)){const row={id:'local-selection',bookId:quote.bookId,contentVersion:quote.contentVersion,chapterId:quote.chapterId,parts:quote.parts.map(p=>({passageId:p.passageId,language:p.layer==='original'?'en':'zh',variant:p.layer==='original'?'interpretive':p.layer,start:p.start,end:p.end,text:p.text}))};return !equal(markQuote(row),quote);}validateCurrentReadingChatQuote(quote,book());return false;}catch{return true;}
 }
 function allowsAi(quote){try{normalizeReadingChatQuote(quote);return true;}catch{return false;}}
 function markQuote(input){const row=normalizeHighlight(input,book());return {kind:'leafhour-reading-quote',schemaVersion:1,bookId:row.bookId,contentVersion:row.contentVersion,chapterId:row.chapterId,parts:row.parts.map(p=>{const layer=p.language==='en'?'original':p.variant,paragraph=book().sections.flatMap(s=>s.paragraphs).find(r=>r.id===p.passageId);return {passageId:p.passageId,layer,start:p.start,end:p.end,text:p.text,...(layer==='original'?{}:{translationStatus:paragraph.translations[layer].status})};})};}
 function render(){
  const held=thread();if(!held||held.deletedAt){hide();return;}
  const nearby=neighbors(),index=nearby.findIndex(r=>r.id===activeId);previous.hidden=next.hidden=count.hidden=nearby.length<2;count.textContent=nearby.length>1?(index+1)+' / '+nearby.length:'';
  const part=held.quote.parts[0];write(sourceLabel,part.layer==='original'?'original':part.layer==='literal'?'literal':'interpretive');
  sourceState.hidden=part.layer==='original';if(!sourceState.hidden)write(sourceState,part.translationStatus==='reviewed'?'reviewed':'draft');const stale=staleQuote(held.quote);sourceHistory.hidden=!stale;if(stale)write(sourceHistory,'savedSelection');
  const signature=JSON.stringify([held.id,held.messages,ownMessages(held)]);
  if(signature!==lastMessages){lastMessages=signature;messages.replaceChildren();for(const row of ownMessages(held)){const section=node('section','reader-annotation-message'),attribution=node('span','reader-annotation-attribution'),body=node('p');write(attribution,'mine');body.textContent=row.text;section.dataset.origin='user';section.append(attribution,body);messages.append(section);}for(const message of held.messages){const section=node('section','reader-annotation-message'),attribution=node('span','reader-annotation-attribution');write(attribution,message.origin==='user'?'user':message.provenance.source==='site-agent'?'site':'external');const refs=(message.sourceRefs||[]).map(ref=>({...ref,bookId:book().bookId,url:'/read?book='+encodeURIComponent(book().bookId)+'&passage='+encodeURIComponent(ref.passageId)}));const body=message.origin==='ai'?renderChatMarkdown(document,message.body,{sourceRefs:refs,onInternalLink:(event,ref)=>{event.preventDefault();if(ref&&current())reader()?.goToPassage?.(ref.passageId);}}):node('p');if(message.origin==='user')body.textContent=message.body;section.dataset.origin=message.origin;section.append(attribution);if(message.provenance?.label&&!['External Agent','Leafhour reading agent'].includes(message.provenance.label)){const agent=node('span','reader-annotation-agent');agent.textContent=message.provenance.label;section.append(agent);}section.append(body);messages.append(section);}}
  const pending=outbox?.current(),request=lastRequest();
  const key=ownKey(),pendingNote=noteDrafts.pending(key);if(noteDrafts.reconcile(key,getRecords()?.comments||[])){if(area.value===pendingNote.text&&!composing){area.value=noteDrafts.text(key);saveDraft();}else if(composing)noteDrafts.edit(key,area.value);persistOwn();}
  saveNote.disabled=noteBusy||stale||!area.value.trim()&&!noteDrafts.pending(key);send.hidden=held.markOnly===true;explain.hidden=!!pending||request?.status==='running';explain.disabled=stale||busy||noteBusy||!allowsAi(held.quote);
  state(pending&&!outbox.status().durable?'requestStorage':pending&&!request?'unconfirmed':request?.status==='running'?'pending':request?.status==='failed'?'failed':request?.status==='cancelled'?'cancelled':held.messages.length?'':'noAi');
  const billingError=paintRefusal();
  if(!pending&&!billingError&&!allowsAi(held.quote))state('longSelection');
  retry.hidden=busy||stale&&!pending||!pending&&!['failed','cancelled'].includes(request?.status)&&!billingError;cancel.hidden=request?.status!=='running';cancel.disabled=cancelling;remove.hidden=busy||!!pending||request?.status==='running'||!archive?.threads.some(row=>row.id===held.id);send.disabled=stale||busy||!!pending||!area.value.trim();
  place();if(card.isConnected)labels.prune();
 }
 function neighbors(){const held=thread();return held?summaryEntries().filter(r=>r.passageId===held.quote.parts[0].passageId):[];}
 function step(delta){const rows=neighbors(),index=rows.findIndex(r=>r.id===activeId),entry=rows[(index+delta+rows.length)%rows.length];if(!entry)return;const mark=activeHighlights(getRecords()).find(r=>'highlight-'+r.id===entry.id);if(mark)openHighlight(mark,opener);else show(entry.id,opener);}
 function show(id,origin){
  if(!ensureScope()||composing)return;
  const opening=card.hidden,editingElsewhere=!card.contains(document.activeElement)&&document.activeElement?.closest('input,textarea,select,[contenteditable="true"]');
  if(card.hidden&&card.isConnected)card.remove();
  if(activeId!==id){saveDraft();activeId=id;area.value=drafts[id]||'';draftVersion++;lastMessages='';}
  const held=thread();if(!held||held.deletedAt)return;
  if(!area.value)area.value=noteDrafts.text(ownKey());
  view.getSelection?.()?.removeAllRanges();reader()?.dismissTools?.({preserveSelection:true});
  opener=origin||opener;selected.textContent=held.quote.parts.map(part=>part.text).join('\n\n');
  margins.reveal();margins.select(id);card.hidden=false;render();place();if(opening&&!editingElsewhere)close.focus({preventScroll:true});
 }
 const canReturnFocus=target=>!!target&&target.isConnected&&!target.disabled&&!target.hidden&&!target.closest('[hidden],[inert],[aria-hidden="true"]')&&target.getClientRects().length&&target.matches('button,a[href],input,textarea,select,summary,[tabindex]');
 function hide({restoreFocus=true}={}){
  if(card.hidden)return;saveDraft();const returnFocus=restoreFocus&&card.contains(document.activeElement),origin=opener;
  card.hidden=true;margins.select(null);
  if(returnFocus){const badge=document.querySelector('[data-annotation-thread="'+activeId+'"]'),target=card.closest('dialog[open]')?.querySelector('.library-chat-close')||(canReturnFocus(origin)?origin:canReturnFocus(badge)?badge:document.getElementById('book-page'));target?.focus({preventScroll:true});}
 }
 async function openHighlight(row,origin,{validate=()=>true}={}){
  if(!ensureScope()||!validate())return;const token=epoch,own=scope;if(!archive&&!await refresh()){if(current(token,own)&&validate())notice('loadFailed');return;}if(!current(token,own)||!validate())return;
  let quote;try{quote=markQuote(row);}catch{notice('stale');return;}
  const held=archive?.threads.find(r=>!r.deletedAt&&r.highlightId===row.id&&equal(r.quote,quote));
  if(held){show(held.id,origin);return;}
  markThread={id:'highlight-'+row.id,highlightId:row.id,quote,messages:[],markOnly:true};show(markThread.id,origin);
 }
 async function saveOwnNote(){
  const held=thread();if(!held||noteBusy||staleQuote(held.quote)||!signedIn()||!available())return;
  const key=ownKey(),token=epoch,own=scope,scopeDrafts=noteDrafts,version=draftVersion;if(!area.value.trim()&&!noteDrafts.pending(key))return;
  if(!noteDrafts.pending(key)&&ownMessages(held).some(r=>r.text===area.value)){state('savedNote');return;}
  noteDrafts.edit(key,area.value);
  const first=held.quote.parts[0],input=noteDrafts.begin(key,{passageId:first.passageId,contentVersion:held.quote.contentVersion,quote:held.quote.parts.map(p=>p.text).join('\n\n'),quoteLanguage:first.layer==='original'?book().sourceLanguage||'en':first.language||'zh',quoteOrigin:first.layer==='original'?'original':'translation'},()=>crypto.randomUUID());
  if(!persistOwn()){noteDrafts.finish(key);return;}
  noteBusy=true;saveNote.disabled=true;state('savingNote');
  try{const record=await call('/api/comments',input);if(!current(token,own))return;if(!noteDrafts.acknowledge(key,record))throw Error('Unconfirmed note');const records=getRecords();records.comments??=[];if(!records.comments.some(r=>r.id===record.id))records.comments.push(record);if(activeId===held.id){if(area.value===input.text&&!composing&&draftVersion===version){area.value='';saveDraft();}else noteDrafts.edit(key,area.value);}persistOwn();lastMessages='';paintBadges();render();state('savedNote');}
  catch(error){if(current(token,own)&&!error.stale)state('noteUnconfirmed');}
  finally{scopeDrafts.finish(key);if(current(token,own)){noteBusy=false;saveNote.disabled=!area.value.trim()&&!noteDrafts.pending(key);}}
 }
 async function resume(operation){
  if(busy||!operation||!ensureScope())return;busy=true;refusal=null;const token=epoch,own=scope,submitted=operation.input.text;readEpoch++;
  try{
   outbox.remember(operation);if(!outbox.status().durable){notice('requestStorage');return;}
   if(operation.phase==='highlight'){const record=await call('/api/highlights',operation.highlight);if(!current(token,own))return;operation=outbox.highlightSaved(record);accept(record);if(!outbox.status().durable){show(operation.input.threadId,opener);notice('requestStorage');return;}}
   show(operation.input.threadId,opener);state('pending');send.disabled=true;retry.hidden=true;cancel.hidden=true;
   const version=draftVersion,ownDraftKey=ownKey();const response=call(endpoint()+'/explain',operation.input);clearTimeout(poll);poll=view.setTimeout(()=>refresh(),350);
   const result=await response;if(!current(token,own))return;
   const receipt=adoptReceipt(result,operation.input);
   if(receipt.status==='completed'&&submitted!==undefined&&draftVersion===version&&area.value===submitted&&!composing){area.value='';draftVersion++;saveDraft();if(noteDrafts.text(ownDraftKey)===submitted){noteDrafts.edit(ownDraftKey,'');persistOwn();}}
   paintBadges();render();schedule();
  }catch(error){if(current(token,own)&&!error.stale){outbox.rejectPreflight(error.status,{preSubmit:error.preSubmit===true});if(creditErrorId(error))refusal={id:operation.input.threadId,quote:operation.input.quote,highlightId:operation.input.highlightId,error};else{state(failureKey(error));notice(failureKey(error));}}}
  finally{if(current(token,own)){busy=false;if(!card.hidden)render();}}
 }
 async function annotate(origin){
  if(!ensureScope()||!signedIn()){notice('login');return;}
  if(!available()){notice('loadFailed');return;}
  if(outbox.status().problem){notice('requestStorage');return;}
  if(outbox.current()){notice('busy',{recover:true});return;}
  const snapshot=getSelection();if(!snapshot)return;const token=epoch,own=scope;
  if(snapshot.parts.reduce((sum,part)=>sum+part.text.length,0)+2*(snapshot.parts.length-1)>2000){notice('selectionLong');return;}
  let quote;try{quote=readingChatQuoteFromExcerpt(snapshot,book());}catch{notice('stale');return;}
  if(!await refresh()||!current(token,own)){notice('loadFailed');return;}
  const existing=activeHighlights(getRecords()).find(row=>highlightKey(row)===highlightKey(snapshot));
  const held=archive.threads.find(row=>!row.deletedAt&&row.highlightId===existing?.id&&equal(row.quote,quote));
  if(held?.messages.some(message=>message.origin==='ai')){show(held.id,origin);return;}
  const input={id:crypto.randomUUID(),threadId:held?.id||crypto.randomUUID(),quote,responseLocale:getUiLocale()};
  const operation=existing?{phase:'explain',input:{...input,highlightId:existing.id}}:{phase:'highlight',input,highlight:{...structuredClone(snapshot),id:crypto.randomUUID()}};
  outbox.remember(operation);opener=origin;activeId=input.threadId;area.value=drafts[activeId]||'';await resume(operation);
 }
 async function retryRequest(){if(noteBusy||busy||!signedIn()||!available())return;if(outbox?.current()){await resume(outbox.current());return;}const held=thread();if(!held)return;if(!allowsAi(held.quote)){state('longSelection');return;}outbox.remember({phase:'explain',input:{id:crypto.randomUUID(),threadId:held.markOnly===true?crypto.randomUUID():held.id,quote:held.quote,responseLocale:getUiLocale(),...(held.highlightId?{highlightId:held.highlightId}:{}),...(area.value.trim()?{text:area.value}:{})}});await resume(outbox.current());}
 async function cancelRequest(){const pending=outbox?.current(),request=lastRequest();if(cancelling||request?.status!=='running')return;cancelling=true;const token=epoch,own=scope;try{const result=await call(endpoint()+'/requests/'+encodeURIComponent(request.id)+'/cancel',{});if(current(token,own)){if(pending)adoptReceipt(result,pending.input);else requests=requests.filter(row=>row.id!==request.id).concat(result.request);await refresh();}}catch(error){if(!error.stale)state('unconfirmed');}finally{if(current(token,own)){cancelling=false;render();}}}
 async function removeThread(){const held=thread();if(!held||busy||outbox.current())return;busy=true;const token=epoch,own=scope;try{await call(endpoint()+'/threads/'+encodeURIComponent(held.id)+'/remove',{});if(current(token,own)){hide();await refresh();}}catch(error){if(!error.stale)state('unconfirmed');}finally{if(current(token,own))busy=false;}}
 listen(area,'input',()=>{draftVersion++;saveDraft();noteDrafts.edit(ownKey(),area.value);persistOwn();saveNote.disabled=noteBusy||!area.value.trim()&&!noteDrafts.pending(ownKey());send.disabled=!!thread()&&staleQuote(thread().quote)||busy||!!outbox?.current()||!area.value.trim();});
 listen(area,'compositionstart',()=>{composing=true;});listen(area,'compositionend',()=>{composing=false;draftVersion++;saveDraft();noteDrafts.edit(ownKey(),area.value);persistOwn();place();});
 listen(form,'submit',event=>{event.preventDefault();if(thread()?.markOnly===true){saveOwnNote();return;}if(!busy&&!outbox?.current()&&area.value.trim()&&thread()&&!staleQuote(thread().quote))retryRequest();});
 for(const event of ['click','pointerup','keydown'])listen(card,event,e=>{if(event==='keydown'&&e.key==='Tab')return;if(event==='keydown'&&e.key==='Escape'&&!e.isComposing&&!composing){e.preventDefault();hide();}e.stopPropagation();});
 listen(card,'focusout',()=>{const token=epoch,own=scope;view.requestAnimationFrame(()=>{if(current(token,own))place();});});
 listen(document,'keydown',event=>{if(event.defaultPrevented||event.target?.closest?.('dialog[open]'))return;if(event.key==='Escape'&&!card.hidden&&!card.inert&&!card.closest('[inert]')&&!event.isComposing&&!composing){event.preventDefault();event.stopPropagation();hide();}},true);
 listen(view,'resize',place);listen(view.visualViewport,'resize',place);listen(view.visualViewport,'scroll',place);listen(view,'scroll',()=>{if(!card.hidden)place();},{passive:true});
 listen(document,'reader:layout',()=>{paintBadges();place();});listen(document,'reader:content',()=>{paintBadges();place();});
 listen(document,'reader:chat-layout',()=>{paintBadges();place();});
 listen(document,'reader:chapter',event=>{if(event.detail?.chapterId===thread()?.quote.chapterId){paintBadges();place();refresh();return;}epoch++;readEpoch++;busy=false;noteBusy=false;for(const key of Object.keys(noteDrafts.snapshot().entries))noteDrafts.finish(key);cancelling=false;hide({restoreFocus:false});refresh();});
 listen(document,'reader:ready',()=>refresh());
 listen(document,'reader:session-changed',()=>{saveDraft();epoch++;readEpoch++;clearTimeout(poll);for(const controller of controllers)controller.abort();card.hidden=true;card.remove();margins.reset();scope=null;margins.reset();outbox=null;archive=null;requests=[];refusal=null;markThread=null;noteBusy=false;busy=false;cancelling=false;delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');});
 listen(document,'reader:records-updated',()=>{paintBadges();refresh();});listen(view,'focus',()=>refresh());
 const offLocale=onUiLocaleChange(()=>{labels.refresh();paintRefusal();});
 ensureScope();refresh();
 return {annotate,openHighlight,openThread:show,refresh,dispose(){if(disposed)return;saveDraft();disposed=true;epoch++;readEpoch++;clearTimeout(poll);for(const controller of controllers)controller.abort();for(const off of listeners)off();offLocale();labels.clear();card.remove();margins.dispose();delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');}};
}
