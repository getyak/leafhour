import {creditActionLabel,creditErrorId} from './credit-labels.mjs';
import {t,getUiLocale,onUiLocaleChange,createUiLabels} from './ui-locale.mjs';
import {readingChatQuoteFromExcerpt,normalizeReadingChatQuote,validateCurrentReadingChatQuote} from './reading-chat-quote.mjs';
import {activeHighlights,highlightKey} from './highlights.mjs';
import {renderChatMarkdown} from './library-chat-markdown.mjs';
import {createAnnotationPending} from './reader-annotation-pending.mjs';

const PREFIX='reader.annotation.',equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const terminal=value=>['completed','failed','cancelled'].includes(value);
const failureKey=error=>({401:'login',403:'login',409:'stale',413:'capacity',422:'stale',429:'limit'}[error?.status]||'unconfirmed');

// Uses the live reader's API, highlight acceptance, session and locale owner.
export function mountReaderAnnotations({document,api,getSession=()=>null,getSelection,getRecords,signedIn,available,accept,notify,isCurrent=()=>true,storage}){
 const view=document.defaultView,labels=createUiLabels(),listeners=[],controllers=new Set(),badges=new Map();
 const reader=()=>view.marginaliaReader,owner=()=>view.marginaliaPaletteAdapter?.getOwner?.();
 let disposed=false,epoch=0,readEpoch=0,layoutEpoch=0,scope=null,outbox=null,archive=null,requests=[],activeId=null,opener=null,busy=false,cancelling=false,composing=false,draftVersion=0,poll=null,frames=[],drafts=Object.create(null),lastMessages='',lastPlacement='',lastTarget=null,refusal=null;
 try{storage??=view.localStorage;}catch{}
 const node=(tag,className)=>{const el=document.createElement(tag);if(className)el.className=className;return el;};
 const write=(el,key,attribute)=>attribute?labels.attr(el,attribute,PREFIX+key):labels.text(el,PREFIX+key);
 const button=(key,action)=>{const el=node('button');el.type='button';write(el,key);el.addEventListener('click',action);return el;};
 const listen=(el,name,callback,options)=>{el?.addEventListener(name,callback,options);listeners.push(()=>el?.removeEventListener(name,callback,options));};
 const identity=()=>{const book=reader()?.getBook?.();return owner()&&book?JSON.stringify([owner(),book.bookId,book.contentVersion]):null;};
 const current=(token=epoch,own=scope)=>!disposed&&isCurrent()&&token===epoch&&own===scope&&identity()===own;
 const book=()=>reader()?.getBook?.(),endpoint=()=>'/api/library/books/'+encodeURIComponent(book().bookId)+'/annotations';
 const draftKey=()=> 'marginalia-annotation-drafts-v1|'+scope;
 const thread=()=>archive?.threads.find(row=>row.id===activeId)|| (outbox?.current()?.input.threadId===activeId?{id:activeId,quote:outbox.current().input.quote,messages:[]}:refusal?.id===activeId?{...refusal,messages:[]}:null);
 const lastRequest=()=>requests.findLast(row=>row.threadId===activeId);
 const card=node('section','reader-annotation-card');card.id='reader-annotation-card';card.hidden=true;card.setAttribute('role','region');
 const heading=node('header','reader-annotation-heading'),title=node('span');title.id='reader-annotation-title';write(title,'title');card.setAttribute('aria-labelledby',title.id);
 const close=button('close',()=>hide());close.className='reader-annotation-close';labels.forget(close,'text');close.textContent='×';write(close,'close','aria-label');heading.append(title,close);
 const scroll=node('div','reader-annotation-scroll'),source=node('div','reader-annotation-source'),sourceLabel=node('span'),sourceState=node('span'),sourceHistory=node('span'),selected=node('blockquote'),messages=node('div','reader-annotation-messages');source.append(sourceLabel,sourceState,sourceHistory,selected);
 const status=node('p','reader-annotation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const form=node('form','reader-annotation-form'),area=node('textarea');area.id='reader-annotation-followup';area.maxLength=2000;area.rows=2;write(area,'replyLabel','aria-label');write(area,'placeholder','placeholder');
 const send=button('send',()=>{}),price=node('small','reader-annotation-price');send.type='submit';const actions=node('div','reader-annotation-actions');
 const retry=button('retry',()=>retryRequest()),cancel=button('cancel',()=>cancelRequest()),remove=button('remove',()=>removeThread()),billLink=node('a','reader-annotation-billing-link');actions.append(retry,cancel,remove,price);
 form.append(area,send);scroll.append(source,messages,status,form,actions);card.append(heading,scroll);
 const state=key=>{if(key)write(status,key);else{labels.forget(status);status.textContent='';}};
 function paintRefusal(){
  price.hidden=getSession()?.billing?.enabled!==true;price.textContent=price.hidden?'':creditActionLabel('annotation',getUiLocale());
  const error=refusal?.id===activeId?refusal.error:null;
  if(error)labels.text(status,creditErrorId(error));
  if(error?.status===402){labels.text(billLink,'billing.accountLink');billLink.href='/billing?ui='+getUiLocale();if(billLink.parentElement!==actions)actions.append(billLink);}else billLink.remove();
  return !!error;
 }
 function notice(key,{recover=false}={}){
  notify('',{error:true,id:PREFIX+key});
  if(recover){const action=button('returnPending',async()=>{const pending=outbox?.current(),own=scope;if(!pending)return;await reader()?.goToPassage?.(pending.input.quote.parts[0].passageId,{validate:()=>!disposed&&identity()===own});if(!disposed&&identity()===own)show(pending.input.threadId,action);});document.getElementById('highlight-status')?.append(action);}
 }
 function saveDraft(){if(!activeId||!scope||identity()!==scope||disposed)return;drafts[activeId]=area.value;try{storage?.setItem(draftKey(),JSON.stringify(drafts));}catch{state('draftMemory');}}
 function cancelLayout(){layoutEpoch++;for(const frame of frames)view.cancelAnimationFrame(frame);frames=[];}
 function preserve(change){
  cancelLayout();const ticket=layoutEpoch,own=scope,context=epoch,r=reader(),anchor=r?.getAnchor?.(),valid=r?.captureLayout?.()||(()=>false);
  change();if(!anchor)return;
  frames.push(view.requestAnimationFrame(()=>{frames.push(view.requestAnimationFrame(()=>{if(ticket===layoutEpoch&&current(context,own)&&valid())reader()?.restoreLayoutAnchor?.(anchor);}));}));
 }
 function ensureScope(){
  const next=identity();if(next===scope)return !!next;
  epoch++;readEpoch++;cancelLayout();clearTimeout(poll);for(const controller of controllers)controller.abort();controllers.clear();
  card.hidden=true;card.remove();for(const badge of badges.values())badge.remove();badges.clear();activeId=null;busy=false;cancelling=false;archive=null;requests=[];drafts=Object.create(null);lastMessages='';lastPlacement='';lastTarget=null;refusal=null;scope=next;
  delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');
  if(!next){outbox=null;return false;}
  outbox=createAnnotationPending({storage,owner:owner(),bookId:book().bookId,contentVersion:book().contentVersion});document.body.append(card);
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
 function paintBadges(){
  const wanted=new Map();for(const row of archive?.threads||[]){if(row.deletedAt||!row.messages.some(message=>message.origin==='ai'))continue;const id=row.quote.parts[0].passageId;if(document.getElementById(id))wanted.set(id,wanted.get(id)||row.id);}
  for(const [id,badge]of badges)if(!wanted.has(id)||!badge.isConnected){badge.remove();badges.delete(id);}
  for(const [id,threadId]of wanted){if(badges.has(id)){badges.get(id).dataset.annotationThread=threadId;continue;}const badge=button('open',event=>{event.stopPropagation();show(badge.dataset.annotationThread,badge);});badge.className='reader-annotation-indicator';badge.dataset.annotationThread=threadId;badge.dataset.annotationPassage=id;labels.forget(badge,'text');badge.textContent='AI';write(badge,'open','aria-label');document.getElementById(id).after(badge);badges.set(id,badge);}
 }
 async function refresh(){
  if(!ensureScope()||!signedIn()||!available())return false;
  const token=epoch,own=scope,sequence=++readEpoch;
  try{const value=normalizeView(await call(endpoint()));if(!current(token,own)||sequence!==readEpoch)return false;archive=value.archive;requests=value.requests;for(const request of requests)outbox.reconcile(request);paintBadges();if(!card.hidden)render();schedule();return true;}
  catch(error){if(!error.stale&&current(token,own)&&!card.hidden)state('loadFailed');return false;}
 }
 function schedule(){clearTimeout(poll);if(outbox?.current()?.phase==='explain'&&(busy||requests.some(row=>row.id===outbox.current()?.input.id&&row.status==='running')))poll=view.setTimeout(()=>refresh(),1000);}
 function placement(){
  const held=thread(),passage=held&&document.getElementById(held.quote.parts[0].passageId);if(!passage)return null;
  if(document.body.dataset.paginated==='true')return {kind:'pane',target:document.getElementById('reading-pages')};
  const rect=[...passage.getClientRects()].find(row=>row.right>0&&row.left<view.innerWidth)||passage.getBoundingClientRect();
  const obstacles=[...document.querySelectorAll('.library-chat-dialog:not([hidden]),.note-panel:not([hidden])')].map(node=>node.getBoundingClientRect()).filter(row=>row.width&&row.height);
  const right=Math.min(view.innerWidth-24,...obstacles.filter(row=>row.left>=rect.right).map(row=>row.left-20));
  const margin=view.innerWidth>=1280&&document.body.dataset.mode!=='parallel'&&right-rect.right>=264;
  return {kind:margin?'margin':'inline',target:passage,width:Math.min(288,right-rect.right-24),left:rect.right+20,top:rect.top+view.scrollY};
 }
 function place(){
  if(card.hidden)return;
  const next=placement();if(!next)return;
  const changed=lastPlacement!==next.kind||lastTarget!==next.target||!card.isConnected;
  if(changed&&(composing||card.contains(document.activeElement))){if(lastPlacement==='margin'){card.style.width=Math.min(288,view.innerWidth-32)+'px';card.style.left=Math.max(16,Math.min(parseFloat(card.style.left)||16,view.innerWidth-Math.min(288,view.innerWidth-32)-16))+'px';}return;}
  const visible=Math.min(view.innerHeight,view.visualViewport?.height||view.innerHeight);
  const headingHeight=document.querySelector('.chapter-heading')?.getBoundingClientRect().height||0,reserved=document.getElementById('page-turner')?.getBoundingClientRect().height||44;
  const paneHeight=visible<=500?Math.min(200,Math.max(132,visible-220)):Math.min(260,Math.max(88,visible*.4),Math.max(88,visible-90-headingHeight-reserved-100));
  const resized=next.kind==='pane'&&(card.style.getPropertyValue('--annotation-pane-height')!==paneHeight+'px'||document.body.style.getPropertyValue('--annotation-visible-height')!==visible+'px');
  const apply=()=>{
   card.dataset.placement=next.kind;lastPlacement=next.kind;lastTarget=next.target;
   if(changed){if(next.kind==='margin')document.body.append(card);else (next.kind==='inline'?badges.get(next.target.id)||next.target:next.target).after(card);}
   if(next.kind==='margin'){card.style.width=next.width+'px';card.style.left=next.left+'px';card.style.top=next.top+'px';}else{card.style.removeProperty('width');card.style.removeProperty('left');card.style.removeProperty('top');}
   if(next.kind==='pane'){
    document.body.dataset.annotationPane='true';document.body.dataset.annotationCompact=String(visible<=500);document.body.style.setProperty('--annotation-visible-height',visible+'px');
    card.style.setProperty('--annotation-pane-height',paneHeight+'px');
   }else{delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');}
  };
  if(changed||resized)preserve(apply);else apply();
 }
 function staleQuote(quote){
  if(quote.contentVersion!==book().contentVersion)return true;
  const loaded=new Set(book().sections.flatMap(section=>section.paragraphs.map(p=>p.id)));
  if(!quote.parts.every(part=>loaded.has(part.passageId)))return false;
  try{validateCurrentReadingChatQuote(quote,book());return false;}catch{return true;}
 }
 function render(){
  const held=thread();if(!held||held.deletedAt){hide();return;}
  const part=held.quote.parts[0];write(sourceLabel,part.layer==='original'?'original':part.layer==='literal'?'literal':'interpretive');
  sourceState.hidden=part.layer==='original';if(!sourceState.hidden)write(sourceState,part.translationStatus==='reviewed'?'reviewed':'draft');const stale=staleQuote(held.quote);sourceHistory.hidden=!stale;if(stale)write(sourceHistory,'savedSelection');
  const signature=JSON.stringify([held.id,held.messages]);
  if(signature!==lastMessages){lastMessages=signature;messages.replaceChildren();for(const message of held.messages){const section=node('section','reader-annotation-message'),attribution=node('span','reader-annotation-attribution');write(attribution,message.origin==='user'?'user':message.provenance.source==='site-agent'?'site':'external');const refs=(message.sourceRefs||[]).map(ref=>({...ref,bookId:book().bookId,url:'/read?book='+encodeURIComponent(book().bookId)+'&passage='+encodeURIComponent(ref.passageId)}));const body=message.origin==='ai'?renderChatMarkdown(document,message.body,{sourceRefs:refs,onInternalLink:(event,ref)=>{event.preventDefault();if(ref&&current())reader()?.goToPassage?.(ref.passageId);}}):node('p');if(message.origin==='user')body.textContent=message.body;section.dataset.origin=message.origin;section.append(attribution);if(message.provenance?.label&&!['External Agent','Leafhour reading agent'].includes(message.provenance.label)){const agent=node('span','reader-annotation-agent');agent.textContent=message.provenance.label;section.append(agent);}section.append(body);messages.append(section);}}
  const pending=outbox?.current(),request=lastRequest();
  state(pending&&!outbox.status().durable?'requestStorage':pending&&!request?'unconfirmed':request?.status==='running'?'pending':request?.status==='failed'?'failed':request?.status==='cancelled'?'cancelled':held.messages.length?'':'noAi');
  const billingError=paintRefusal();
  retry.hidden=busy||stale&&!pending||!pending&&!['failed','cancelled'].includes(request?.status)&&!billingError;cancel.hidden=request?.status!=='running';cancel.disabled=cancelling;remove.hidden=busy||!!pending||request?.status==='running'||!archive?.threads.some(row=>row.id===held.id);send.disabled=stale||busy||!!pending||!area.value.trim();
  place();if(card.isConnected)labels.prune();
 }
 function show(id,origin){
  if(!ensureScope()||composing)return;
  if(card.hidden&&card.isConnected)card.remove();
  if(activeId!==id){saveDraft();activeId=id;area.value=drafts[id]||'';draftVersion++;lastMessages='';}
  const held=thread();if(!held||held.deletedAt)return;
  view.getSelection?.()?.removeAllRanges();reader()?.dismissTools?.({preserveSelection:true});
  opener=origin||opener;selected.textContent=held.quote.parts.map(part=>part.text).join('\n\n');
  card.hidden=false;render();place();
 }
 function hide({restoreFocus=true}={}){
  if(card.hidden)return;saveDraft();const returnFocus=restoreFocus&&card.contains(document.activeElement),origin=opener;
  const change=()=>{card.hidden=true;delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');};if(lastPlacement==='margin')change();else preserve(change);
  if(returnFocus){const badge=[...badges.values()].find(node=>node.dataset.annotationThread===activeId),target=origin?.isConnected&&origin.getClientRects().length?origin:badge?.isConnected&&badge.getClientRects().length?badge:document.getElementById('book-page');target?.focus({preventScroll:true});}
 }
 async function resume(operation){
  if(busy||!operation||!ensureScope())return;busy=true;refusal=null;const token=epoch,own=scope,version=draftVersion,submitted=operation.input.text;readEpoch++;
  try{
   outbox.remember(operation);if(!outbox.status().durable){notice('requestStorage');return;}
   if(operation.phase==='highlight'){const record=await call('/api/highlights',operation.highlight);if(!current(token,own))return;operation=outbox.highlightSaved(record);accept(record);if(!outbox.status().durable){show(operation.input.threadId,opener);notice('requestStorage');return;}}
   show(operation.input.threadId,opener);state('pending');send.disabled=true;retry.hidden=true;cancel.hidden=true;
   const response=call(endpoint()+'/explain',operation.input);clearTimeout(poll);poll=view.setTimeout(()=>refresh(),350);
   const result=await response;if(!current(token,own))return;
   const receipt=adoptReceipt(result,operation.input);
   if(receipt.status==='completed'&&submitted!==undefined&&draftVersion===version&&area.value===submitted&&!composing){area.value='';draftVersion++;saveDraft();}
   paintBadges();render();schedule();
  }catch(error){if(current(token,own)&&!error.stale){outbox.rejectPreflight(error.status,{preSubmit:error.preSubmit===true});if(creditErrorId(error))refusal={id:operation.input.threadId,quote:operation.input.quote,error};else{state(failureKey(error));notice(failureKey(error));}}}
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
 async function retryRequest(){if(outbox?.current()){await resume(outbox.current());return;}const held=thread();if(!held)return;outbox.remember({phase:'explain',input:{id:crypto.randomUUID(),threadId:held.id,quote:held.quote,responseLocale:getUiLocale(),...(held.highlightId?{highlightId:held.highlightId}:{}),...(area.value.trim()?{text:area.value}:{})}});await resume(outbox.current());}
 async function cancelRequest(){const pending=outbox?.current(),request=lastRequest();if(cancelling||request?.status!=='running')return;cancelling=true;const token=epoch,own=scope;try{const result=await call(endpoint()+'/requests/'+encodeURIComponent(request.id)+'/cancel',{});if(current(token,own)){if(pending)adoptReceipt(result,pending.input);else requests=requests.filter(row=>row.id!==request.id).concat(result.request);await refresh();}}catch(error){if(!error.stale)state('unconfirmed');}finally{if(current(token,own)){cancelling=false;render();}}}
 async function removeThread(){const held=thread();if(!held||busy||outbox.current())return;busy=true;const token=epoch,own=scope;try{await call(endpoint()+'/threads/'+encodeURIComponent(held.id)+'/remove',{});if(current(token,own)){hide();await refresh();}}catch(error){if(!error.stale)state('unconfirmed');}finally{if(current(token,own))busy=false;}}
 listen(area,'input',()=>{draftVersion++;saveDraft();send.disabled=!!thread()&&staleQuote(thread().quote)||busy||!!outbox?.current()||!area.value.trim();});
 listen(area,'compositionstart',()=>{composing=true;});listen(area,'compositionend',()=>{composing=false;draftVersion++;saveDraft();place();});
 listen(form,'submit',event=>{event.preventDefault();if(!busy&&!outbox?.current()&&area.value.trim()&&thread()&&!staleQuote(thread().quote))retryRequest();});
 for(const event of ['click','pointerup','keydown'])listen(card,event,e=>{if(event==='keydown'&&e.key==='Escape'&&!e.isComposing&&!composing){e.preventDefault();hide();}e.stopPropagation();});
 listen(card,'focusout',()=>{const token=epoch,own=scope;view.requestAnimationFrame(()=>{if(current(token,own))place();});});
 listen(view,'resize',place);listen(view.visualViewport,'resize',place);listen(view,'scroll',()=>{if(lastPlacement==='margin'&&!card.hidden)place();},{passive:true});
 listen(document,'reader:layout',()=>{paintBadges();place();});listen(document,'reader:content',()=>{paintBadges();place();});
 listen(document,'reader:chapter',event=>{if(event.detail?.chapterId===thread()?.quote.chapterId){paintBadges();place();refresh();return;}epoch++;readEpoch++;busy=false;cancelling=false;hide({restoreFocus:false});refresh();});
 listen(document,'reader:ready',()=>refresh());
 listen(document,'reader:session-changed',()=>{saveDraft();epoch++;readEpoch++;cancelLayout();clearTimeout(poll);for(const controller of controllers)controller.abort();card.hidden=true;card.remove();for(const badge of badges.values())badge.remove();badges.clear();scope=null;outbox=null;archive=null;requests=[];refusal=null;busy=false;cancelling=false;delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');});
 listen(document,'reader:records-updated',()=>refresh());listen(view,'focus',()=>refresh());
 for(const event of ['reader:jump','reader:page','wheel'])listen(document,event,cancelLayout,{passive:true});
 listen(document,'touchstart',event=>{if(!card.contains(event.target))cancelLayout();},{passive:true});
 const offLocale=onUiLocaleChange(()=>{labels.refresh();paintRefusal();});
 ensureScope();refresh();
 return {annotate,refresh,dispose(){if(disposed)return;saveDraft();disposed=true;epoch++;readEpoch++;cancelLayout();clearTimeout(poll);for(const controller of controllers)controller.abort();for(const off of listeners)off();offLocale();labels.clear();card.remove();for(const badge of badges.values())badge.remove();delete document.body.dataset.annotationPane;delete document.body.dataset.annotationCompact;document.body.style.removeProperty('--annotation-visible-height');}};
}
