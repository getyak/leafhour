import {t,getUiLocale,onUiLocaleChange,uiHref,bindUi,createUiMessage,uiReady} from './ui-locale.mjs';
import {createLibraryChatState,CHAT_TEXT_LIMIT} from './library-chat-state.mjs';
import {readChatScope} from './reading-chat-scope.mjs';
import {renderChatMarkdown,safeChatUrl} from './library-chat-markdown.mjs';
import {trackActionFocus} from './action-focus.mjs';

// GET-184: explicit owning-component labels for the injected AI trigger.
export const CHAT_TEXT={get trigger(){return t('chat.entry');},get triggerLabel(){return t('open');}};


const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const button=(text,className='library-chat-button')=>{const element=node('button',className,text);element.type='button';return element;};
const bookTitle=book=>book?.title?.zh||book?.title?.en||t('bk');
const chapterTitle=value=>typeof value==='string'?value:value?.zh||value?.en||t('currentPosition');
const readUrl=(bookId,passageId)=>'/read?book='+encodeURIComponent(bookId)+(passageId?'&passage='+encodeURIComponent(passageId):'');
const draftKey=(owner,book)=>'marginalia:chat-draft:'+encodeURIComponent(owner)+':'+encodeURIComponent(book);
const quoteHeadKey=(owner,book)=>'marginalia:chat-quote:'+encodeURIComponent(owner)+':'+encodeURIComponent(book);
const quoteAckKey=(owner,book,revision)=>'marginalia:chat-quote-ack:'+encodeURIComponent(owner)+':'+encodeURIComponent(book)+':'+encodeURIComponent(revision);
const pendingKey=(owner,book)=>'marginalia:chat-pending:'+encodeURIComponent(owner)+':'+encodeURIComponent(book);

export function mountLibraryChat({root,api,getSession,getBooks,getOwner,openAuth,getCurrentBook=()=>null,getCurrentPassage=()=>null,onNavigateToPassage=null,externalLauncher=null,positionLauncher=null,onViewChange=()=>{}}){
  const state=createLibraryChatState({readQuoteHead:(owner,book)=>JSON.parse(localStorage.getItem(quoteHeadKey(owner,book))||'null'),writeQuoteHead:(owner,book,head)=>localStorage.setItem(quoteHeadKey(owner,book),JSON.stringify(head)),readQuoteAck:(owner,book,revision)=>JSON.parse(localStorage.getItem(quoteAckKey(owner,book,revision))||'null'),writeQuoteAck:(owner,book,revision,ack)=>localStorage.setItem(quoteAckKey(owner,book,revision),JSON.stringify(ack)),readDraft:(owner,book)=>localStorage.getItem(draftKey(owner,book))||'',writeDraft:(owner,book,text)=>{if(text)localStorage.setItem(draftKey(owner,book),text);else localStorage.removeItem(draftKey(owner,book));},readPending:(owner,book)=>JSON.parse(localStorage.getItem(pendingKey(owner,book))||'null'),writePending:(owner,book,record)=>{if(record)localStorage.setItem(pendingKey(owner,book),JSON.stringify(record));else localStorage.removeItem(pendingKey(owner,book));}});
  // Owned UI text nodes carry explicit data-ui message ids and are relabeled
  // by the shared runtime binding; cached createUiMessage descriptors cover
  // parameterized/status chrome. A language commit never calls render(), never
  // mutates state or drafts, never touches input values/IME/focus, never
  // schedules work and never rerenders source or answer markdown.
  const ui=(tag,cls,id)=>{const n=node(tag,cls);n.setAttribute('data-ui',id);n.textContent=t(id);return n;};
  const uiAttr=(n,attr,id)=>{n.setAttribute('data-ui-'+attr,id);n.setAttribute(attr,t(id));return n;};
  const sourceHref=(link,target)=>{link.href=uiHref(target);link.setAttribute('data-ui-owned-href',target);links.add(link);return link;};
  const links=new Set(),rowPaints=new Map();
  let disposed=false,currentView=state.view();
  const listeners=[];
  const listen=(target,type,fn)=>{const owned=event=>{if(!disposed)return fn(event);};target.addEventListener(type,owned);listeners.push(()=>target.removeEventListener(type,owned));};
  const live=(target,type,fn)=>target.addEventListener(type,event=>{if(!disposed)return fn(event);});
  const unbind=bindUi(root);
  let viewOpen=false,opener=null,owner=null,selectedBook=null,requestedPassage=null,pollTimer=null,pollCount=0,pollStarted=0,loadInFlight=null,composing=false,focusComposer=false,historySignature='',contextSignature='',booksSignature='',targetMessageId=null;
  root.classList.add('library-chat-dialog');root.setAttribute('aria-labelledby','library-chat-title');
  root.setAttribute('aria-modal','false');
  const frame=node('div','library-chat-frame'),header=node('header','library-chat-header');
  const heading=node('div','library-chat-heading'),title=ui('h2','','dg');title.id='library-chat-title';
  const bookRow=node('div','library-chat-book-row'),bookLabel=ui('label','sr-only','rd'),chooser=node('select','library-chat-book-choice');chooser.id='library-chat-book';bookLabel.htmlFor=chooser.id;const singleBookTitle=node('p','library-chat-book-title');bookRow.append(bookLabel,chooser,singleBookTitle);heading.append(title,bookRow);
  const menu=node('details','library-chat-menu'),menuSummary=node('summary','','···');uiAttr(menuSummary,'aria-label','moreActions');const menuItems=node('div','library-chat-menu-items');menu.append(menuSummary,menuItems);
  const closeButton=button('−','library-chat-close');uiAttr(closeButton,'aria-label','close');uiAttr(closeButton,'title','close');header.append(heading,menu,closeButton);
  // GET-184: the default launcher is the monochrome Leafhour mark — no cartoon
  // character and therefore no character-motion hooks. An optional external
  // launcher configuration skips generated launcher DOM, cartoon motion, drag
  // positioning and launcher ARIA ownership entirely; the shared reading pill
  // is never handed to this mutable launcher implementation.
  let launcher=null,trigger=null,characterMotion=null,characterPosition=null;
  if(externalLauncher){
    trigger=ui('button','library-chat-trigger','chat.entry');trigger.type='button';uiAttr(trigger,'aria-label','open');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',root.id);
    externalLauncher.triggerHost?.append(trigger);
    characterPosition=externalLauncher.position||null;
  }else{
    launcher=button('','library-chat-launcher');uiAttr(launcher,'aria-label','open');launcher.setAttribute('aria-controls',root.id);launcher.setAttribute('aria-expanded','false');uiAttr(launcher,'title','dg');
    root.after(launcher);
    characterPosition=positionLauncher?positionLauncher(launcher):null;
  }
  const returnFocus=()=>{if(externalLauncher){externalLauncher.focusReturn?externalLauncher.focusReturn():trigger?.focus({preventScroll:true});return;}if(opener?.isConnected&&!opener.hidden)opener.focus();else launcher.focus();};
  const legacyOpener=document.getElementById('library-chat-open');if(legacyOpener)legacyOpener.hidden=true;
  const context=node('details','library-chat-context'),contextSummary=node('summary'),contextLabel=node('span'),contextHint=node('span','library-chat-context-hint');contextSummary.append(contextLabel,contextHint);const contextBody=node('div','library-chat-context-body');context.append(contextSummary,contextBody);
  const messages=node('div','library-chat-messages');messages.setAttribute('role','log');uiAttr(messages,'aria-label','title');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-relevant','additions text');
  const statusBar=node('div','library-chat-status-row'),status=node('p','library-chat-status');status.id='library-chat-status';status.setAttribute('role','status');const refreshButton=button('','library-chat-text-button');statusBar.append(status,refreshButton);
  const scopeRow=node('div','library-chat-scope-row'),scopeLabel=ui('label','','scope.allowed'),scopeChoice=node('select','library-chat-scope-choice');scopeChoice.id='library-chat-scope';scopeLabel.htmlFor=scopeChoice.id;
  for(const [value,id]of [['book','scope.currentBook'],['library','scope.library']]){const option=ui('option','',id);option.value=value;scopeChoice.append(option);}scopeRow.append(scopeLabel,scopeChoice);
  const form=node('form','library-chat-composer'),inputLabel=ui('label','sr-only','placeholder'),input=node('textarea');input.id='library-chat-input';inputLabel.htmlFor=input.id;input.rows=2;uiAttr(input,'placeholder','h.cmp');input.setAttribute('aria-describedby','library-chat-status library-chat-count');
  const quoteChip=node('div','library-chat-quote-chip'),quoteMeta=node('p','library-chat-quote-meta'),quoteText=node('blockquote','library-chat-quote-text'),quoteRemove=button('×','library-chat-quote-remove'),quoteStale=ui('p','library-chat-quote-stale','chat.quote.stale'),quoteLocal=ui('p','library-chat-quote-stale','chat.quote.localOnly');uiAttr(quoteRemove,'aria-label','chat.quote.remove');uiAttr(quoteRemove,'title','chat.quote.remove');quoteRemove.type='button';quoteChip.hidden=true;quoteChip.append(quoteMeta,quoteText,quoteRemove,quoteStale,quoteLocal);let quoteSignature='';
  const composerBottom=node('div','library-chat-composer-bottom'),count=node('span','library-chat-count');count.id='library-chat-count';const composerActions=node('div','library-chat-composer-actions'),stopButton=ui('button','library-chat-stop','st'),sendButton=node('button','library-chat-send','↑');sendButton.type='submit';composerActions.append(stopButton,sendButton);composerBottom.append(count,composerActions);form.append(quoteChip,inputLabel,input,composerBottom);
  const footer=node('div','library-chat-footer'),hint=node('p','library-chat-hint');hint.id='library-chat-hint';
  const exportButton=ui('button','library-chat-text-button','export'),menuHint=node('p','library-chat-menu-hint');
  menuItems.append(scopeRow,hint,exportButton,menuHint);frame.append(header,messages,statusBar,context,form,footer);root.replaceChildren(frame);
  // Composed scope hints repaint from cached state on business renders and on
  // language commits alike; the wording itself lives in the catalogues.
  function paintHint(){
    const view=currentView,scope=confirmedScope(view),base=!scope||view.scopeUnconfirmed?'sc.ns':(scope.mode==='book'?'sc.p':'sc.w');
    hint.textContent=t(base)+t('sc.mod')+(view.retry?.uncertain?t('sc.pn'):'');menuHint.textContent=view.pending?t('sn'):t('sc.chg');
  }
  // Parameterized/status chrome keeps stable cached descriptors.
  const statusMsg=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('has-error',!!error);statusBar.hidden=!text;});
  const countMsg=createUiMessage(text=>{count.textContent=text;});

  const signedIn=()=>!!getSession()?.user;
  const confirmedScope=view=>{if(!view.data?.scope)return null;try{return readChatScope(view.data.scope);}catch{return null;}};
  const activeOwner=()=>signedIn()?String(getOwner()||getSession().user.id):null;
  const books=()=>Array.isArray(getBooks())?getBooks():[];
  const currentBookId=()=>{const current=getCurrentBook();return typeof current==='string'?current:current?.bookId;};
  function clearPoll(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
  function syncOwner(){
    const next=activeOwner();if(next===owner)return false;
    owner=next;clearPoll();loadInFlight=null;pollCount=0;pollStarted=0;requestedPassage=null;historySignature='';selectedBook=books().some(book=>book.bookId===currentBookId())?currentBookId():books()[0]?.bookId||null;
    state.reset();state.setContext(owner,selectedBook);requestedPassage=state.view().retry?.payload.passageId||state.view().quote?.parts[0].passageId||null;input.value='';context.open=false;return true;
  }
  function isCurrent(captured){if(disposed)return false;if(captured===activeOwner()&&captured===owner)return true;syncOwner();render();return false;}
  function routeBack(){const b=ui('button','library-chat-button','bts');live(b,'click',()=>{close();const shelf=document.getElementById('library-view');if(shelf&&!shelf.hidden)shelf.scrollIntoView({block:'start'});else location.assign(uiHref('/library'));});return b;}
  function sourceLink(id,passageId,bookId=selectedBook){const link=ui('a','library-chat-source-link',id);sourceHref(link,readUrl(bookId,passageId));live(link,'click',event=>{if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;if(bookId===currentBookId()&&onNavigateToPassage?.(bookId,passageId)===true){event.preventDefault();close();}});return link;}
  function renderContext(view){
    const item=view.data?.context,signature=JSON.stringify([owner,selectedBook,item]);if(signature===contextSignature)return;contextSignature=signature;context.hidden=!item;contextLabel.textContent=chapterTitle(item?.chapterTitle);
    if(!item){contextBody.replaceChildren();return;}
    contextBody.replaceChildren();contextBody.append(sourceLink('backToPassage',item.passageId));
    for(const key of ['original','literal','interpretive']){
      const block=node('div','library-chat-source'),value=item[key],status=item.translationStatus?.[key],label=node('p','library-chat-source-label');
      label.append(ui('span','',({original:'lo',literal:'ll',interpretive:'li'})[key]));if(key!=='original'&&status==='draft')label.append(ui('span','','ds'));
      const className=key==='original'?'library-chat-original':'';
      block.append(label,value?node('p',className,value):ui('p',className,'t.nr'));contextBody.append(block);
    }
  }
  function emptyState(headingId,bodyId){const empty=node('section','library-chat-empty');empty.append(node('span','library-chat-empty-rule'),ui('h3','',headingId),ui('p','',bodyId));return empty;}
  const turnNodes=new Map();
  const paintFor=(row,fn)=>{let paints=rowPaints.get(row);if(!paints)rowPaints.set(row,paints=[]);paints.push(fn);fn();};
  function showEmpty(element){turnNodes.clear();rowPaints.clear();messages.replaceChildren(element);}
  function renderActivity(parent,turn,completed,ownerRow=parent){
    const activity=Array.isArray(turn.activity)?turn.activity:[];if(!completed||!activity.length)return;
    const details=node('details','library-chat-activity-details');
    const chapters=new Set(activity.filter(a=>a.status==='completed'&&['reader_get_context','reader_read_chapter'].includes(a.tool)&&a.bookId&&a.chapterId).map(a=>a.bookId+'/'+a.chapterId));
    const summary=node('summary');
    if(chapters.size){const message=createUiMessage(text=>{summary.textContent=text;});message.set('chat.activity.chapters',{count:chapters.size});paintFor(ownerRow,()=>message.refresh());}
    else summary.setAttribute('data-ui','toolLog'),summary.textContent=t('toolLog');
    details.append(summary);
    for(const item of activity){const row=node('p'),statusId=({running:'itr',completed:'done',failed:'fl'})[item.status]||'fl';row.append(node('span','',item.label+' · '),ui('span','',statusId));details.append(row);}parent.append(details);
  }
  function pendingText(turn,view){
    if(turn.status==='failed')return t('cs.noAnswer');
    if(turn.status==='cancelled')return t('chat.stopped');
    if(view.pending?.status==='stopping')return t('stopping');
    if(view.retry?.uncertain&&view.retry.payload.id===turn.id)return view.retry.checked?t('n.cont'):t('n.cf');
    const activity=Array.isArray(turn.activity)?turn.activity:[];
    return activity.findLast(item=>item.status==='running')?.label||t('th');
  }
  function updateActivity(row,turn,view){
    const status=[...row.children].find(child=>child.className.includes('library-chat-turn-status'));
    if(status)status.textContent=pendingText(turn,view);
  }
  function renderRecommendations(parent,answer){
    const candidates=(answer.recommendations||[]).slice(0,3);if(!candidates.length)return;
    const section=node('section','library-chat-recommendations');section.append(ui('p','library-chat-source-label','rb'));
    for(const item of candidates){const url=safeChatUrl(item.url,{recommendations:candidates,allowRecommendations:true});if(!url)continue;
      const card=node('a','library-chat-recommendation');if(url.startsWith('/'))sourceHref(card,url);else{card.href=url;card.target='_blank';card.rel='noopener noreferrer';}
      card.append(node('span','',item.title),ui('small','',item.owned?'il':item.source==='catalog'?'rn':'eb'));section.append(card);
    }parent.append(section);
  }
  function renderMessages(view){
    const signature=JSON.stringify([owner,selectedBook,view.data?'ready':view.phase,view.turns,view.pending?.status,view.retry,view.data?.scope?.mode,signedIn(),books().length]);
    if(signature===historySignature)return;historySignature=signature;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90,scrollTop=messages.scrollTop;
    if(!signedIn()){
      const empty=emptyState('prompt','h.sign');const login=ui('button','library-chat-send','sts');live(login,'click',()=>{close();openAuth();});empty.append(login);showEmpty(empty);return;
    }
    if(!selectedBook){const empty=emptyState('pickBook','h.nb');empty.append(routeBack());showEmpty(empty);return;}
    if(view.phase==='loading'&&!view.data){const empty=emptyState('turningTo','s.load');empty.classList.add('is-loading');showEmpty(empty);return;}
    if(view.phase==='error'&&!view.data){showEmpty(emptyState('pageNotOpen','r.h'));return;}
    const displayTurns=[...view.turns];if(view.retry?.uncertain&&!displayTurns.some(turn=>turn.id===view.retry.payload.id))displayTurns.push({...view.retry.payload,origin:'user',status:'running',answer:null});
    if(!displayTurns.length){
      const wide=confirmedScope(view)?.mode==='library',empty=emptyState(wide?'h.bk':'ex.fu',wide?'h.ch':'h.ck');
      const suggestions=node('div','library-chat-suggestions');
      for(const id of ['ex.f','ex.c',wide?'ex.r':'ex.a']){
        // A new explicit click writes the CURRENT localized suggestion text;
        // already-entered drafts are never rewritten by a language change.
        const suggestion=ui('button','library-chat-suggestion',id);suggestion.disabled=!!view.pending;
        live(suggestion,'click',()=>{if(disposed)return;state.setDraft(t(id));render();input.focus();});
        suggestions.append(suggestion);
      }
      empty.append(suggestions);showEmpty(empty);return;
    }
    const desired=[],nextNodes=new Map();let completedAnswer=null;
    for(const turn of displayTurns){
      const key=JSON.stringify([owner,selectedBook,turn.id]),rowSignature=JSON.stringify([turn,turn.status==='running'?view.pending?.status:null,view.retry?.payload.id===turn.id?view.retry:null]);
      const cached=turnNodes.get(key);if(cached?.signature===rowSignature){desired.push(cached.node);nextNodes.set(key,cached);continue;}
      if(cached?.node&&turn.status==='running'&&cached.status==='running'){updateActivity(cached.node,turn,view);desired.push(cached.node);nextNodes.set(key,{...cached,signature:rowSignature});continue;}
      const row=node('article','library-chat-turn');row.setAttribute('data-message-id',turn.id);if(turn.kind!=='companion'){const question=node('div','library-chat-question');question.append(ui('p','library-chat-attribution','mq'));if(turn.quote){const selected=node('blockquote','library-chat-selected-snapshot');selected.append(ui('p','library-chat-source-label','chat.quote.snapshot'),ui('span','library-chat-source-label',({original:'lo',literal:'ll',interpretive:'li'})[turn.quote.parts[0].layer]));if(turn.quote.parts.some(part=>part.translationStatus==='draft'))selected.append(ui('span','library-chat-source-label','ds'));selected.append(node('p','',turn.quote.parts.map(part=>part.text).join('\n\n')));question.append(selected);}question.append(node('p','library-chat-text',turn.text));row.append(question);}
      if(turn.answer?.summary){
        const answer=node('div','library-chat-answer'),answerHeading=node('div','library-chat-answer-heading'),copy=ui('button','library-chat-text-button','cp');const answerText=renderChatMarkdown(document,turn.answer.summary,{sourceRefs:turn.answer.sourceRefs||[],onInternalLinkCreated:sourceHref,onInternalLink:(event,ref)=>{if(disposed)return;if(ref&&ref.bookId===currentBookId()&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&!(event.button>0)&&onNavigateToPassage?.(ref.bookId,ref.passageId)===true){event.preventDefault();close();}}});uiAttr(copy,'aria-label','copyAnswer');live(copy,'click',()=>copyAnswer(turn.answer.summary,answerText,copy));answerHeading.append(turn.kind==='companion'?ui('p','library-chat-attribution','cm'):node('p','library-chat-attribution','AI'),copy);answer.append(answerHeading,answerText);
        if(turn.answer.sourceRefs?.length){const references=node('details','library-chat-references'),summary=node('summary'),refsMsg=createUiMessage(text=>{summary.textContent=text;});refsMsg.set('chat.referencesCount',{count:turn.answer.sourceRefs.length});paintFor(row,()=>refsMsg.refresh());references.append(summary);for(const ref of turn.answer.sourceRefs){const quote=node('blockquote','',ref.quote),label=node('span','library-chat-source-label');label.append(ui('span','',({original:'lo',literal:'ll',interpretive:'li'})[ref.layer]||'lo'));if(ref.translationStatus==='draft')label.append(ui('span','','ds'));quote.append(label,sourceLink('backToQuote',ref.passageId,ref.bookId||selectedBook));references.append(quote);}answer.append(references);}renderRecommendations(answer,turn.answer);renderActivity(answer,turn,true,row);row.append(answer);if(cached?.status==='running'&&turn.status==='completed')completedAnswer=answer;
      }else{
        const pending=node('p','library-chat-turn-status');paintFor(row,()=>{pending.textContent=pendingText(turn,currentView);});
        if(turn.status==='running')pending.classList.add('is-pending');row.append(pending);renderActivity(row,turn,turn.status!=='running');
      }
      desired.push(row);nextNodes.set(key,{signature:rowSignature,node:row,status:turn.status});
    }
    // Leave unchanged nodes in place, retaining text selection and open references.
    const retained=new Set(desired);for(const child of [...messages.children])if(!retained.has(child))child.remove();for(const key of [...rowPaints.keys()])if(!retained.has(key))rowPaints.delete(key);
    desired.forEach((row,index)=>{if(messages.children[index]!==row)messages.insertBefore(row,messages.children[index]||null);});
    turnNodes.clear();for(const [key,value] of nextNodes)turnNodes.set(key,value);
    if(nearBottom&&completedAnswer&&root.open){
      // Align inside the log; scrollIntoView would also move the reader page.
      messages.scrollTop+=completedAnswer.getBoundingClientRect().top-messages.getBoundingClientRect().top-messages.clientTop;
    }else messages.scrollTop=nearBottom?messages.scrollHeight:scrollTop;
  }
  function render(){
    const view=currentView=state.view();characterMotion?.setState({thinking:!!view.pending,chatOpen:root.open});const list=books(),visibleDraft=view.pending?'':view.draft;if(input.value!==visibleDraft)input.value=visibleDraft;
    const listSignature=JSON.stringify(list.map(book=>[book.bookId,bookTitle(book)]));if(listSignature!==booksSignature){booksSignature=listSignature;chooser.replaceChildren(...list.map(book=>{const option=node('option','',bookTitle(book));option.value=book.bookId;return option;}));}chooser.value=selectedBook||'';chooser.hidden=list.length<2;singleBookTitle.hidden=list.length>1;singleBookTitle.textContent=bookTitle(list.find(book=>book.bookId===selectedBook));chooser.disabled=!!view.pending||!!view.retry?.uncertain||!!view.scopePending;bookRow.hidden=!signedIn()||!selectedBook;
    quoteChip.hidden=!view.quote;
    const nextQuoteSignature=JSON.stringify(view.quote);if(nextQuoteSignature!==quoteSignature){quoteSignature=nextQuoteSignature;quoteText.textContent=view.quote?.parts.map(part=>part.text).join('\n\n')||'';}
    quoteRemove.disabled=!view.canChangeQuote;quoteStale.hidden=!view.quoteStale;quoteLocal.hidden=!view.quoteLocalOnly;
    if(view.quote){quoteMeta.replaceChildren(ui('span','',({original:'lo',literal:'ll',interpretive:'li'})[view.quote.parts[0].layer]));if(view.quote.parts.some(part=>part.translationStatus==='draft'))quoteMeta.append(ui('span','','ds'));}
    renderContext(view);renderMessages(view);if(targetMessageId){const target=[...messages.children].find(n=>n.getAttribute('data-message-id')===targetMessageId);if(target){messages.scrollTop+=target.getBoundingClientRect().top-messages.getBoundingClientRect().top-messages.clientTop;targetMessageId=null;}}form.hidden=!signedIn()||!selectedBook;footer.hidden=form.hidden;
    const length=view.draft.length;count.classList.toggle('is-over-limit',length>CHAT_TEXT_LIMIT);input.setAttribute('aria-invalid',String(length>CHAT_TEXT_LIMIT));
    if(length>=1800)countMsg.set(length>CHAT_TEXT_LIMIT?'chat.count.over':'chat.count.left',{count:length>CHAT_TEXT_LIMIT?length-CHAT_TEXT_LIMIT:CHAT_TEXT_LIMIT-length});else countMsg.clear();
    input.disabled=!!view.pending||!!view.retry?.uncertain;sendButton.disabled=!view.canSend||!confirmedScope(view);
    sendButton.textContent=view.retry?'↻':'↑';uiAttr(sendButton,'aria-label',view.retry?.uncertain?'cont':view.retry?'ta':'sd');
    if(launcher){launcher.classList.toggle('is-waiting',!!view.pending);uiAttr(launcher,'aria-label',root.open?'close':view.pending?'op':'open');}
    stopButton.hidden=!view.pending;stopButton.disabled=view.pending?.status==='stopping';
    refreshButton.hidden=!signedIn()||!selectedBook||(!view.loadError&&!view.retry?.uncertain&&!view.pending&&!view.scopeUnconfirmed&&!!confirmedScope(view)&&view.data?.available!==false);refreshButton.disabled=!!loadInFlight||view.pending?.status==='stopping';refreshButton.setAttribute('data-ui',view.pending||view.retry?.uncertain?'a.prog':'a.rel');refreshButton.textContent=t(refreshButton.getAttribute('data-ui'));exportButton.hidden=!view.turns.length;contextHint.setAttribute('data-ui',context.open?'x.cl':'x.op');contextHint.textContent=t(contextHint.getAttribute('data-ui'));
    const scope=confirmedScope(view);uiAttr(input,'placeholder',scope?.mode==='library'?'h.bk':'h.cmp');scopeChoice.value=view.scopePending?.mode||scope?.mode||'book';scopeChoice.disabled=!scope||view.phase!=='ready'||!!view.scopePending||view.scopeUnconfirmed||!!view.pending||!!view.retry?.uncertain;
    paintHint();
    if(!signedIn()||!selectedBook)statusMsg.clear();
    else if(view.pending)statusMsg.set(view.pending.status==='stopping'?'s.stop':'s.bg');
    else if(view.loadError)statusMsg.set(view.loadError.id,view.loadError.params,true);
    else if(view.notice)statusMsg.set(view.notice.id,view.notice.params);
    else if(view.data?.available===false)statusMsg.set('s.un');
    else if(view.phase==='loading')statusMsg.set('s.load');
    else if(!confirmedScope(view))statusMsg.set('s.scope');
    else statusMsg.clear();
    if(focusComposer&&root.open&&!input.disabled&&!form.hidden){focusComposer=false;input.focus();}
  }
  function schedulePoll(){
    clearPoll();if(disposed||!state.view().pending||!root.open)return;if(!pollStarted)pollStarted=Date.now();if(Date.now()-pollStarted>=90000)return;
    pollTimer=setTimeout(()=>{pollTimer=null;pollCount++;load({poll:true});},Math.min(1500+pollCount*400,5000));
  }
  async function load({poll=false}={}){
    if(disposed)return;syncOwner();if(disposed||!signedIn()||!selectedBook){render();return;}if(loadInFlight)return loadInFlight;
    const captured=owner,ticket=state.beginLoad({passageId:requestedPassage}),bookId=selectedBook,passageId=requestedPassage;
    const promise=(async()=>{
      try{const data=await Promise.resolve().then(()=>{if(!isCurrent(captured))return null;return api('/api/library/books/'+encodeURIComponent(bookId)+'/chat'+(passageId?'?passageId='+encodeURIComponent(passageId):''));});if(!isCurrent(captured))return;if(state.resolveLoad(ticket,data)&&!requestedPassage)requestedPassage=data.context?.passageId||null;}
      catch(error){if(isCurrent(captured))state.rejectLoad(ticket,error);}
      finally{if(loadInFlight===promise)loadInFlight=null;if(isCurrent(captured)){render();if(state.view().pending&&(poll||root.open))schedulePoll();}}
    })();loadInFlight=promise;render();return promise;
  }
  async function send(){
    if(disposed||syncOwner()||!confirmedScope(state.view())){render();return;}const request=state.beginSend();if(!request)return;root.dispatchEvent(new Event('reading-chat-send'));clearPoll();pollCount=0;pollStarted=Date.now();const captured=owner,bookId=selectedBook;render();messages.scrollTop=messages.scrollHeight;void load({poll:true});
    try{const turn=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat',request.payload);if(isCurrent(captured)&&state.resolveSend(request.ticket,turn)){render();schedulePoll();}}
    catch(error){if(!isCurrent(captured))return;const uncertain=!error.status||error.status===409||error.status>=500;if(state.rejectSend(request.ticket,error,{uncertain})){render();if(uncertain||error.status===412)await load();}}
    finally{if(isCurrent(captured)){render();schedulePoll();}}
  }
  async function saveScope(){
    if(disposed||syncOwner()){render();return;}const request=state.beginScopeChange(scopeChoice.value);if(!request){render();return;}
    const captured=owner,bookId=selectedBook,focus=trackActionFocus(document,scopeChoice);render();
    try{const scope=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat/scope',request.payload);if(isCurrent(captured)&&bookId===selectedBook&&!state.resolveScopeChange(request.ticket,scope))await load();}
    catch(error){if(isCurrent(captured)&&bookId===selectedBook&&state.rejectScopeChange(request.ticket,error))await load();}
    finally{if(isCurrent(captured)&&bookId===selectedBook){render();if(root.open)focus.restore(!scopeChoice.disabled?scopeChoice:!input.disabled?input:closeButton);else focus.stop();}else focus.stop();}
  }
  async function stop(){
    if(disposed)return;const ticket=state.beginCancel();if(!ticket)return;const focus=trackActionFocus(document,stopButton);clearPoll();const captured=owner,bookId=selectedBook;render();
    try{const turn=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat/'+encodeURIComponent(ticket.id)+'/cancel',{});if(isCurrent(captured))state.resolveCancel(ticket,turn);}
    catch(error){if(isCurrent(captured)){state.rejectCancel(ticket,error);render();await load();}}
    finally{if(isCurrent(captured)){render();if(root.open)focus.restore(!input.disabled&&!form.hidden?input:stopButton.hidden?refreshButton.hidden?closeButton:refreshButton:stopButton);else focus.stop();}else focus.stop();}
  }
  function close(){if(disposed||!viewOpen)return;viewOpen=false;characterMotion?.setState({chatOpen:false});clearPoll();focusComposer=false;menu.open=false;if(root.open)root.close();onViewChange(false);if(launcher){launcher.setAttribute('aria-expanded','false');uiAttr(launcher,'aria-label',state.view().pending?'op':'open');}returnFocus();}
  function choose(bookId,passageId=null){if(state.view().pending||state.view().retry?.uncertain||state.view().scopePending)return false;clearPoll();loadInFlight=null;pollCount=0;pollStarted=0;selectedBook=bookId;requestedPassage=passageId;historySignature='';context.open=false;state.setContext(owner,selectedBook);requestedPassage=state.view().retry?.payload.passageId||state.view().quote?.parts[0].passageId||requestedPassage;return true;}
  async function copyAnswer(text,element,control){
    // Async copy feedback keeps a stable descriptor and is localized with the
    // effective locale when it settles; raw remote error text is never shown.
    try{await navigator.clipboard.writeText(text);if(disposed)return;control.setAttribute('data-ui','cpd');control.textContent=t('cpd');}
    catch{if(disposed)return;const range=document.createRange();range.selectNodeContents(element);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);control.setAttribute('data-ui','sel');control.textContent=t('sel');}
  }
  function exportChat(){
    const view=state.view();if(!view.turns.length)return;const data={kind:'marginalia-book-chat',schemaVersion:1,exportedAt:new Date().toISOString(),bookId:selectedBook,title:view.data?.title,contentVersion:view.data?.contentVersion,turns:view.turns};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'})),link=node('a');link.href=url;link.download='Leafhour-对话-'+selectedBook+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  listen(launcher||trigger,'click',()=>root.open?close():controls.open());
  function escape(event){if(event.key==='Escape'&&root.open){event.preventDefault();event.stopPropagation();close();}}
  listen(root,'keydown',escape);listen(launcher||trigger,'keydown',escape);
  // Match the visible viewport when a mobile keyboard reduces or pans it.
  function fitViewport(){const viewport=window.visualViewport;if(!viewport)return;root.style.setProperty('--chat-viewport-height',viewport.height+'px');root.style.setProperty('--chat-viewport-top',viewport.offsetTop+'px');root.classList.toggle('is-compact-viewport',viewport.height<=500);if(root.open&&viewport.height<=500&&document.activeElement===input)frame.scrollTop+=Math.max(0,form.getBoundingClientRect().bottom-Math.min(frame.getBoundingClientRect().bottom,viewport.offsetTop+viewport.height-8));}
  if(window.visualViewport){listen(window.visualViewport,'resize',fitViewport);listen(window.visualViewport,'scroll',fitViewport);}fitViewport();
  listen(input,'focus',fitViewport);
  listen(closeButton,'click',close);listen(root,'cancel',event=>{event.preventDefault();close();});listen(root,'close',()=>{if(root.open||!viewOpen)return;viewOpen=false;clearPoll();onViewChange(false);returnFocus();});
  listen(scopeChoice,'change',saveScope);
  listen(chooser,'change',()=>{if(choose(chooser.value)){render();load();}});listen(context,'toggle',()=>{contextHint.setAttribute('data-ui',context.open?'x.cl':'x.op');contextHint.textContent=t(contextHint.getAttribute('data-ui'));});
  listen(quoteRemove,'click',()=>{if(state.setQuote(null)){render();input.focus();}});
  listen(input,'input',()=>{state.setDraft(input.value);render();});listen(input,'compositionstart',()=>{composing=true;});listen(input,'compositionend',()=>{composing=false;});listen(input,'keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229){event.preventDefault();send();}});
  listen(form,'submit',event=>{event.preventDefault();if(!composing)send();});listen(stopButton,'click',stop);listen(refreshButton,'click',async()=>{const focus=trackActionFocus(document,refreshButton),captured=owner,bookId=selectedBook;pollCount=0;try{await load();}finally{if(root.open&&captured===owner&&bookId===selectedBook)focus.restore(!refreshButton.hidden&&!refreshButton.disabled?refreshButton:!input.disabled&&!form.hidden?input:closeButton);else focus.stop();}});listen(exportButton,'click',()=>{exportChat();menu.open=false;menuSummary.focus();});
  function updateLabels(){
    if(disposed)return;
    if(trigger){trigger.textContent=CHAT_TEXT.trigger;uiAttr(trigger,'aria-label','open');}
    for(const paints of rowPaints.values())for(const paint of paints)paint();
    for(const link of [...links]){if(link.isConnected===false){links.delete(link);continue;}link.href=uiHref(link.getAttribute('data-ui-owned-href')||'');}
    paintHint();statusMsg.refresh();countMsg.refresh();
  }
  const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(()=>{if(!disposed){bindUi(root);updateLabels();}});
  const controls={
    open({bookId,passageId,messageId,draft}={}){
      if(disposed)return;
      externalLauncher?.onOpen?.();
      targetMessageId=messageId||null;root.dispatchEvent(new Event('reading-chat-open'));
      syncOwner();const view=state.view(),canFollow=!view.draft&&!view.quote&&!view.pending&&!view.retry?.uncertain&&!view.scopePending;
      const candidate=bookId||(canFollow?currentBookId():null)||selectedBook||books()[0]?.bookId||null,valid=books().some(book=>book.bookId===candidate)?candidate:books()[0]?.bookId||null;
      const currentPassage=canFollow?(passageId||getCurrentPassage()||null):requestedPassage;
      if(!view.pending&&!view.retry?.uncertain&&(selectedBook!==valid||canFollow&&currentPassage!==requestedPassage))choose(valid,currentPassage);
      if(typeof draft==='string'&&draft.length<=2000&&!state.view().draft&&!state.view().pending&&!state.view().retry?.uncertain)state.setDraft(draft);
      if(!root.open){viewOpen=true;opener=document.activeElement;root.show();onViewChange(true);closeButton.focus();}if(launcher)launcher.setAttribute('aria-expanded','true');focusComposer=!!messageId;render();pollCount=0;load();
    },
    quote(value){
      if(disposed||syncOwner()||!signedIn()||value?.bookId!==selectedBook||!state.setQuote(value))return false;
      if(requestedPassage!==value.parts[0].passageId)loadInFlight=null;requestedPassage=value.parts[0].passageId;controls.open({bookId:selectedBook,passageId:requestedPassage});focusComposer=true;render();return true;
    },
    surface:()=>({launcher,trigger,header,root,preferenceHost:menuItems,motion:characterMotion,position:characterPosition}),
    refresh:()=>root.open?load():Promise.resolve(),
    close,
    reset(){if(disposed)return;clearPoll();loadInFlight=null;pollCount=0;pollStarted=0;owner=null;selectedBook=null;requestedPassage=null;historySignature='';state.reset();input.value='';context.open=false;render();},
    update(){if(disposed)return;const changed=syncOwner();if(!books().some(book=>book.bookId===selectedBook)&&!state.view().pending)choose(books().find(book=>book.bookId===currentBookId())?.bookId||books()[0]?.bookId||null);render();if(root.open&&(changed||state.view().phase==='idle'))load();},
    updateLabels,
    dispose(){
      if(disposed)return;disposed=true;offLocale();unbind();for(const off of listeners.splice(0))off();if(viewOpen){viewOpen=false;onViewChange(false);}if(root.open)root.close();launcher?.remove();trigger?.remove();characterMotion?.dispose?.();characterPosition?.dispose?.();clearPoll();loadInFlight=null;rowPaints.clear();links.clear();turnNodes.clear();
    }
  };
  return controls;
}
