import {createLibraryChatState,CHAT_TEXT_LIMIT} from './library-chat-state.mjs';
import {readChatScope} from './reading-chat-scope.mjs';
import {renderChatMarkdown,safeChatUrl} from './library-chat-markdown.mjs';
import {trackActionFocus} from './action-focus.mjs';

// GET-184: explicit owning-component labels for the injected AI trigger.
export const CHAT_TEXT={trigger:'Ask AI',triggerLabel:'打开阅读对话'};


const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const button=(text,className='library-chat-button')=>{const element=node('button',className,text);element.type='button';return element;};
const bookTitle=book=>book?.title?.zh||book?.title?.en||'这本书';
const chapterTitle=value=>typeof value==='string'?value:value?.zh||value?.en||'当前阅读位置';
const readUrl=(bookId,passageId)=>'/read?book='+encodeURIComponent(bookId)+(passageId?'&passage='+encodeURIComponent(passageId):'');
const draftKey=(owner,book)=>'marginalia:chat-draft:'+encodeURIComponent(owner)+':'+encodeURIComponent(book);
const pendingKey=(owner,book)=>'marginalia:chat-pending:'+encodeURIComponent(owner)+':'+encodeURIComponent(book);

export function mountLibraryChat({root,api,getSession,getBooks,getOwner,openAuth,getCurrentBook=()=>null,getCurrentPassage=()=>null,onNavigateToPassage=null,externalLauncher=null,positionLauncher=null}){
  const state=createLibraryChatState({readDraft:(owner,book)=>localStorage.getItem(draftKey(owner,book))||'',writeDraft:(owner,book,text)=>{if(text)localStorage.setItem(draftKey(owner,book),text);else localStorage.removeItem(draftKey(owner,book));},readPending:(owner,book)=>JSON.parse(localStorage.getItem(pendingKey(owner,book))||'null'),writePending:(owner,book,record)=>{if(record)localStorage.setItem(pendingKey(owner,book),JSON.stringify(record));else localStorage.removeItem(pendingKey(owner,book));}});
  let opener=null,owner=null,selectedBook=null,requestedPassage=null,pollTimer=null,pollCount=0,pollStarted=0,loadInFlight=null,composing=false,focusComposer=false,historySignature='',contextSignature='',booksSignature='',targetMessageId=null;
  root.classList.add('library-chat-dialog');root.setAttribute('aria-labelledby','library-chat-title');
  root.setAttribute('aria-modal','false');
  const frame=node('div','library-chat-frame'),header=node('header','library-chat-header');
  const heading=node('div','library-chat-heading'),title=node('h2','','阅读对话');title.id='library-chat-title';
  const bookRow=node('div','library-chat-book-row'),bookLabel=node('label','sr-only','正在读'),chooser=node('select','library-chat-book-choice');chooser.id='library-chat-book';bookLabel.htmlFor=chooser.id;const singleBookTitle=node('p','library-chat-book-title');bookRow.append(bookLabel,chooser,singleBookTitle);heading.append(title,bookRow);
  const menu=node('details','library-chat-menu'),menuSummary=node('summary','','···');menuSummary.setAttribute('aria-label','更多对话操作');const menuItems=node('div','library-chat-menu-items');menu.append(menuSummary,menuItems);
  const closeButton=button('−','library-chat-close');closeButton.setAttribute('aria-label','收起阅读对话');closeButton.title='收起阅读对话';header.append(heading,menu,closeButton);
  // GET-184: the default launcher is the monochrome Leafhour mark — no cartoon
  // character and therefore no character-motion hooks. An optional external
  // launcher configuration skips generated launcher DOM, cartoon motion, drag
  // positioning and launcher ARIA ownership entirely; the shared reading pill
  // is never handed to this mutable launcher implementation.
  let launcher=null,trigger=null,characterMotion=null,characterPosition=null;
  if(externalLauncher){
    trigger=node('button','library-chat-trigger');trigger.type='button';trigger.textContent=CHAT_TEXT.trigger;trigger.setAttribute('aria-label',CHAT_TEXT.triggerLabel);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',root.id);
    externalLauncher.triggerHost?.append(trigger);
    characterPosition=externalLauncher.position||null;
  }else{
    launcher=button('','library-chat-launcher');launcher.setAttribute('aria-label','打开阅读对话');launcher.setAttribute('aria-controls',root.id);launcher.setAttribute('aria-expanded','false');launcher.title='阅读对话';
    root.after(launcher);
    characterPosition=positionLauncher?positionLauncher(launcher):null;
  }
  const returnFocus=()=>{if(externalLauncher){externalLauncher.focusReturn?externalLauncher.focusReturn():trigger?.focus({preventScroll:true});return;}if(opener?.isConnected&&!opener.hidden)opener.focus();else launcher.focus();};
  const legacyOpener=document.getElementById('library-chat-open');if(legacyOpener)legacyOpener.hidden=true;
  const context=node('details','library-chat-context'),contextSummary=node('summary'),contextLabel=node('span'),contextHint=node('span','library-chat-context-hint','查看原文与译文');contextSummary.append(contextLabel,contextHint);const contextBody=node('div','library-chat-context-body');context.append(contextSummary,contextBody);
  const messages=node('div','library-chat-messages');messages.setAttribute('role','log');messages.setAttribute('aria-label','和这本书的对话');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-relevant','additions text');
  const statusBar=node('div','library-chat-status-row'),status=node('p','library-chat-status');status.id='library-chat-status';status.setAttribute('role','status');const refreshButton=button('重新载入','library-chat-text-button');statusBar.append(status,refreshButton);
  const scopeRow=node('div','library-chat-scope-row'),scopeLabel=node('label','','允许查阅'),scopeChoice=node('select','library-chat-scope-choice');scopeChoice.id='library-chat-scope';scopeLabel.htmlFor=scopeChoice.id;for(const [value,label]of [['book','仅当前书'],['library','书房、公版与网络']]){const option=node('option','',label);option.value=value;scopeChoice.append(option);}scopeRow.append(scopeLabel,scopeChoice);
  const form=node('form','library-chat-composer'),inputLabel=node('label','sr-only','想问这本书什么？'),input=node('textarea');input.id='library-chat-input';inputLabel.htmlFor=input.id;input.rows=2;input.placeholder='聊聊这本书，或找下一本。';input.setAttribute('aria-describedby','library-chat-status library-chat-hint library-chat-count');
  const composerBottom=node('div','library-chat-composer-bottom'),count=node('span','library-chat-count');count.id='library-chat-count';const composerActions=node('div','library-chat-composer-actions'),stopButton=button('停止','library-chat-stop'),sendButton=node('button','library-chat-send','↑');sendButton.type='submit';composerActions.append(stopButton,sendButton);composerBottom.append(count,composerActions);form.append(scopeRow,inputLabel,input,composerBottom);
  const footer=node('div','library-chat-footer'),hint=node('p','library-chat-hint','查阅范围尚未确认，暂不发送问题。');hint.id='library-chat-hint';const exportButton=button('导出这段对话','library-chat-text-button'),menuHint=node('p','library-chat-menu-hint',hint.textContent);menuItems.append(exportButton,menuHint);form.append(hint);frame.append(header,messages,statusBar,context,form,footer);root.replaceChildren(frame);

  const signedIn=()=>!!getSession()?.user;
  const confirmedScope=view=>{if(!view.data?.scope)return null;try{return readChatScope(view.data.scope);}catch{return null;}};
  const activeOwner=()=>signedIn()?String(getOwner()||getSession().user.id):null;
  const books=()=>Array.isArray(getBooks())?getBooks():[];
  const currentBookId=()=>{const current=getCurrentBook();return typeof current==='string'?current:current?.bookId;};
  function clearPoll(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
  function syncOwner(){
    const next=activeOwner();if(next===owner)return false;
    owner=next;clearPoll();loadInFlight=null;pollCount=0;pollStarted=0;requestedPassage=null;historySignature='';selectedBook=books().some(book=>book.bookId===currentBookId())?currentBookId():books()[0]?.bookId||null;
    state.reset();state.setContext(owner,selectedBook);requestedPassage=state.view().retry?.payload.passageId||null;input.value='';context.open=false;return true;
  }
  function isCurrent(captured){if(captured===activeOwner()&&captured===owner)return true;syncOwner();render();return false;}
  function routeBack(label='回到书架'){const b=button(label,'library-chat-button');b.addEventListener('click',()=>{close();const shelf=document.getElementById('library-view');if(shelf&&!shelf.hidden)shelf.scrollIntoView({block:'start'});else location.assign('/library');});return b;}
  function sourceLink(label,passageId,bookId=selectedBook){const link=node('a','library-chat-source-link',label);link.href=readUrl(bookId,passageId);link.addEventListener('click',event=>{if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;if(bookId===currentBookId()&&onNavigateToPassage?.(bookId,passageId)===true){event.preventDefault();close();}});return link;}
  function renderContext(view){
    const item=view.data?.context,signature=JSON.stringify([owner,selectedBook,item]);if(signature===contextSignature)return;contextSignature=signature;context.hidden=!item;contextLabel.textContent=chapterTitle(item?.chapterTitle);
    if(!item){contextBody.replaceChildren();return;}
    contextBody.replaceChildren();contextBody.append(sourceLink('回到当前段落 ↗',item.passageId));
    for(const [key,label] of [['original','原文'],['literal','直译'],['interpretive','意译']]){
      const block=node('div','library-chat-source'),value=item[key],status=item.translationStatus?.[key];block.append(node('p','library-chat-source-label',label+(key!=='original'&&status==='draft'?' · 草稿':'')));
      block.append(node('p',key==='original'?'library-chat-original':'',value||'这一版译文尚未准备，保留原文供核对。'));contextBody.append(block);
    }
  }
  function emptyState(headingText,bodyText){const empty=node('section','library-chat-empty');empty.append(node('span','library-chat-empty-rule'),node('h3','',headingText),node('p','',bodyText));return empty;}
  const turnNodes=new Map();
  function showEmpty(element){turnNodes.clear();messages.replaceChildren(element);}
  function renderActivity(parent,turn,completed){
    const activity=Array.isArray(turn.activity)?turn.activity:[];if(!completed||!activity.length)return;
    const details=node('details','library-chat-activity-details');
    const chapters=new Set(activity.filter(a=>a.status==='completed'&&['reader_get_context','reader_read_chapter'].includes(a.tool)&&a.bookId&&a.chapterId).map(a=>a.bookId+'/'+a.chapterId));
    details.append(node('summary','',chapters.size?'查阅了 '+chapters.size+' 个章节':'查看工具记录'));
    for(const item of activity)details.append(node('p','',item.label+' · '+({running:'已中断',completed:'完成',failed:'未成功'})[item.status]));parent.append(details);
  }
  function pendingText(turn,view){
    if(view.pending?.status==='stopping')return '正在停止这次提问…';
    if(view.retry?.uncertain&&view.retry.payload.id===turn.id)return view.retry.checked?'暂未收到回答，可以继续上次提问。':'正在确认这次提问的结果。';
    const activity=Array.isArray(turn.activity)?turn.activity:[];
    return activity.findLast(item=>item.status==='running')?.label||'正在思考…';
  }
  function updateActivity(row,turn,view){
    const status=[...row.children].find(child=>child.className.includes('library-chat-turn-status'));
    if(status)status.textContent=pendingText(turn,view);
  }
  function renderRecommendations(parent,answer){
    const candidates=(answer.recommendations||[]).slice(0,3);if(!candidates.length)return;
    const section=node('section','library-chat-recommendations');section.append(node('p','library-chat-source-label','相关书目'));
    for(const item of candidates){const url=safeChatUrl(item.url,{recommendations:candidates,allowRecommendations:true});if(!url)continue;
      const card=node('a','library-chat-recommendation');card.href=url;if(!url.startsWith('/')){card.target='_blank';card.rel='noopener noreferrer';}
      card.append(node('span','',item.title),node('small','',item.owned?'书房已有':item.source==='catalog'?'可直接阅读':'外部书目'));section.append(card);
    }parent.append(section);
  }
  function renderMessages(view){
    const signature=JSON.stringify([owner,selectedBook,view.data?'ready':view.phase,view.turns,view.pending?.status,view.retry,view.data?.scope?.mode,signedIn(),books().length]);
    if(signature===historySignature)return;historySignature=signature;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90,scrollTop=messages.scrollTop;
    if(!signedIn()){
      const empty=emptyState('和书多聊几句','登录后，可以围绕原文提问，也能回来接着看自己的问题。');const login=button('登录后开始','library-chat-send');login.addEventListener('click',()=>{close();openAuth();});empty.append(login);showEmpty(empty);return;
    }
    if(!selectedBook){const empty=emptyState('先选一本想读的书','回到书架打开一本书，再带着问题回来。');empty.append(routeBack());showEmpty(empty);return;}
    if(view.phase==='loading'&&!view.data){const empty=emptyState('正在翻到这一页','正在载入原文和已有对话…');empty.classList.add('is-loading');showEmpty(empty);return;}
    if(view.phase==='error'&&!view.data){showEmpty(emptyState('这一页暂时没有打开','可以重新载入，已经写下的问题会保留。'));return;}
    const displayTurns=[...view.turns];if(view.retry?.uncertain&&!displayTurns.some(turn=>turn.id===view.retry.payload.id))displayTurns.push({...view.retry.payload,origin:'user',status:'running',answer:null});
    if(!displayTurns.length){
      const wide=confirmedScope(view)?.mode==='library',empty=emptyState(wide?'聊聊这本书，或找下一本。':'从这一段继续追问。',wide?'聊聊这一章，也可以比较章节，或找一本接着读的书。':'可以核对当前段落、解释概念，或比较本书章节。');
      const suggestions=node('div','library-chat-suggestions');for(const text of ['你最喜欢这一章的哪句话？','前后章节怎样联系？',wide?'推荐一本接着读的书':'这段话如何支持本章的论点？']){const suggestion=button(text,'library-chat-suggestion');suggestion.disabled=!!view.pending;suggestion.addEventListener('click',()=>{state.setDraft(text);render();input.focus();});suggestions.append(suggestion);}empty.append(suggestions);showEmpty(empty);return;
    }
    const desired=[],nextNodes=new Map();let completedAnswer=null;
    for(const turn of displayTurns){
      const key=JSON.stringify([owner,selectedBook,turn.id]),rowSignature=JSON.stringify([turn,turn.status==='running'?view.pending?.status:null,view.retry?.payload.id===turn.id?view.retry:null]);
      const cached=turnNodes.get(key);if(cached?.signature===rowSignature){desired.push(cached.node);nextNodes.set(key,cached);continue;}
      if(cached?.node&&turn.status==='running'&&cached.status==='running'){updateActivity(cached.node,turn,view);desired.push(cached.node);nextNodes.set(key,{...cached,signature:rowSignature});continue;}
      const row=node('article','library-chat-turn');row.setAttribute('data-message-id',turn.id);if(turn.kind!=='companion'){const question=node('div','library-chat-question');question.append(node('p','library-chat-attribution','我的提问'),node('p','library-chat-text',turn.text));row.append(question);}
      if(turn.answer?.summary){
        const answer=node('div','library-chat-answer'),answerHeading=node('div','library-chat-answer-heading'),copy=button('复制','library-chat-text-button');const answerText=renderChatMarkdown(document,turn.answer.summary,{sourceRefs:turn.answer.sourceRefs||[],onInternalLink:(event,ref)=>{if(ref&&ref.bookId===currentBookId()&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&!(event.button>0)&&onNavigateToPassage?.(ref.bookId,ref.passageId)===true){event.preventDefault();close();}}});copy.setAttribute('aria-label','复制这条 AI 回答');copy.addEventListener('click',()=>copyAnswer(turn.answer.summary,answerText,copy));answerHeading.append(node('p','library-chat-attribution',turn.kind==='companion'?'AI · 陪读':'AI'),copy);answer.append(answerHeading,answerText);
        if(turn.answer.sourceRefs?.length){const references=node('details','library-chat-references');references.append(node('summary','','核对原文 · '+turn.answer.sourceRefs.length+' 处'));for(const ref of turn.answer.sourceRefs){const quote=node('blockquote','',ref.quote);quote.append(node('span','library-chat-source-label',({original:'原文',literal:'直译',interpretive:'意译'})[ref.layer]||'原文'));if(ref.translationStatus==='draft')quote.children[0].textContent+=' · 草稿';quote.append(sourceLink('回到引用段落 ↗',ref.passageId,ref.bookId||selectedBook));references.append(quote);}answer.append(references);}renderRecommendations(answer,turn.answer);renderActivity(answer,turn,true);row.append(answer);if(cached?.status==='running'&&turn.status==='completed')completedAnswer=answer;
      }else{
        const text=turn.status==='running'?pendingText(turn,view):turn.status==='cancelled'?'这次提问已停止。':'这次没有得到回答。';
        const pending=node('p','library-chat-turn-status',text);if(turn.status==='running')pending.classList.add('is-pending');row.append(pending);renderActivity(row,turn,turn.status!=='running');
      }
      desired.push(row);nextNodes.set(key,{signature:rowSignature,node:row,status:turn.status});
    }
    // Leave unchanged nodes in place, retaining text selection and open references.
    const retained=new Set(desired);for(const child of [...messages.children])if(!retained.has(child))child.remove();
    desired.forEach((row,index)=>{if(messages.children[index]!==row)messages.insertBefore(row,messages.children[index]||null);});
    turnNodes.clear();for(const [key,value] of nextNodes)turnNodes.set(key,value);
    if(nearBottom&&completedAnswer&&root.open){
      // Align inside the log; scrollIntoView would also move the reader page.
      messages.scrollTop+=completedAnswer.getBoundingClientRect().top-messages.getBoundingClientRect().top-messages.clientTop;
    }else messages.scrollTop=nearBottom?messages.scrollHeight:scrollTop;
  }
  function render(){
    const view=state.view();characterMotion?.setState({thinking:!!view.pending,chatOpen:root.open});const list=books(),visibleDraft=view.pending?'':view.draft;if(input.value!==visibleDraft)input.value=visibleDraft;input.placeholder=view.pending?'正在思考…':'聊聊这本书，或找下一本。';
    const listSignature=JSON.stringify(list.map(book=>[book.bookId,bookTitle(book)]));if(listSignature!==booksSignature){booksSignature=listSignature;chooser.replaceChildren(...list.map(book=>{const option=node('option','',bookTitle(book));option.value=book.bookId;return option;}));}chooser.value=selectedBook||'';chooser.hidden=list.length<2;singleBookTitle.hidden=list.length>1;singleBookTitle.textContent=bookTitle(list.find(book=>book.bookId===selectedBook));chooser.disabled=!!view.pending||!!view.retry?.uncertain||!!view.scopePending;bookRow.hidden=!signedIn()||!selectedBook;
    renderContext(view);renderMessages(view);if(targetMessageId){const target=[...messages.children].find(n=>n.getAttribute('data-message-id')===targetMessageId);if(target){messages.scrollTop+=target.getBoundingClientRect().top-messages.getBoundingClientRect().top-messages.clientTop;targetMessageId=null;}}form.hidden=!signedIn()||!selectedBook;footer.hidden=form.hidden;
    const length=view.draft.length;count.textContent=length>=1800?(length>CHAT_TEXT_LIMIT?'已超出 '+(length-CHAT_TEXT_LIMIT)+' 字':'还可写 '+(CHAT_TEXT_LIMIT-length)+' 字'):'';count.classList.toggle('is-over-limit',length>CHAT_TEXT_LIMIT);input.setAttribute('aria-invalid',String(length>CHAT_TEXT_LIMIT));
    input.disabled=!!view.pending||!!view.retry?.uncertain;count.hidden=!!view.pending;sendButton.disabled=!view.canSend||!confirmedScope(view);const sendLabel=view.retry?.uncertain?'继续上次提问':view.retry?'再试一次':'发送问题';sendButton.textContent=view.retry?'↻':'↑';sendButton.setAttribute('aria-label',sendLabel);sendButton.title=sendLabel;if(launcher){launcher.classList.toggle('is-waiting',!!view.pending);launcher.setAttribute('aria-label',root.open?'收起阅读对话':view.pending?'打开阅读对话，提问正在处理':'打开阅读对话');}stopButton.hidden=!view.pending;stopButton.disabled=view.pending?.status==='stopping';
    if(!signedIn())status.textContent='';else if(!selectedBook)status.textContent='';else if(view.pending)status.textContent=view.pending.status==='stopping'?'正在停止。确认后可以重新提问。':'可以先收起窗口，回答会留在这里。';else if(view.loadError)status.textContent=view.loadError;else if(view.notice)status.textContent=view.notice;else if(view.data?.available===false)status.textContent='阅读助手暂时不可用。可以先写下问题，稍后再试。';else if(view.phase==='loading')status.textContent='正在载入原文和已有对话…';else if(!confirmedScope(view))status.textContent='查阅范围尚未确认，请重新载入；问题仍保留。';else status.textContent='';
    statusBar.hidden=!status.textContent;status.classList.toggle('has-error',!!view.loadError);refreshButton.hidden=!signedIn()||!selectedBook||(!view.loadError&&!view.retry?.uncertain&&!view.pending&&!view.scopeUnconfirmed&&!!confirmedScope(view)&&view.data?.available!==false);refreshButton.disabled=!!loadInFlight||view.pending?.status==='stopping';refreshButton.textContent=view.pending||view.retry?.uncertain?'查看进度':'重新载入';exportButton.hidden=!view.turns.length;contextHint.textContent=context.open?'收起原文与译文':'查看原文与译文';
    const scope=confirmedScope(view);scopeChoice.value=view.scopePending?.mode||scope?.mode||'book';scopeChoice.disabled=!scope||view.phase!=='ready'||!!view.scopePending||view.scopeUnconfirmed||!!view.pending||!!view.retry?.uncertain;
    input.placeholder=scope?.mode==='library'?'聊聊这本书，或找下一本。':'问问这本书，或比较其中的章节。';
    hint.textContent=!scope||view.scopeUnconfirmed?'查阅范围尚未确认，暂不发送问题；草稿仍保留。':(scope.mode==='book'?'只按需读取本书原文与译文。':'可按需读取书房、公版与网络，检索词会交给检索服务。')+' 问题、当前位置及允许范围内最多六轮对话会发送给实例配置的云模型；私人评论不自动读取。'+(view.retry?.uncertain?' 上次提问仍按原范围确认。':'');
    menuHint.textContent=hint.textContent+(view.pending?' 收起窗口不会停止提问，需要中断时请点“停止”。':' 修改范围不会发送问题；旧回答仍保留，缩小范围后不会自动送入新范围。');
    if(focusComposer&&root.open&&!input.disabled&&!form.hidden){focusComposer=false;input.focus();}
  }
  function schedulePoll(){
    clearPoll();if(!state.view().pending||!root.open)return;if(!pollStarted)pollStarted=Date.now();if(Date.now()-pollStarted>=90000)return;
    pollTimer=setTimeout(()=>{pollTimer=null;pollCount++;load({poll:true});},Math.min(1500+pollCount*400,5000));
  }
  async function load({poll=false}={}){
    syncOwner();if(!signedIn()||!selectedBook){render();return;}if(loadInFlight)return loadInFlight;
    const captured=owner,ticket=state.beginLoad({passageId:requestedPassage}),bookId=selectedBook,passageId=requestedPassage;
    const promise=(async()=>{
      try{const data=await Promise.resolve().then(()=>api('/api/library/books/'+encodeURIComponent(bookId)+'/chat'+(passageId?'?passageId='+encodeURIComponent(passageId):'')));if(!isCurrent(captured))return;if(state.resolveLoad(ticket,data)&&!requestedPassage)requestedPassage=data.context?.passageId||null;}
      catch(error){if(isCurrent(captured))state.rejectLoad(ticket,error);}
      finally{if(loadInFlight===promise)loadInFlight=null;if(isCurrent(captured)){render();if(state.view().pending&&(poll||root.open))schedulePoll();}}
    })();loadInFlight=promise;render();return promise;
  }
  async function send(){
    if(syncOwner()||!confirmedScope(state.view())){render();return;}const request=state.beginSend();if(!request)return;root.dispatchEvent(new Event('reading-chat-send'));clearPoll();pollCount=0;pollStarted=Date.now();const captured=owner,bookId=selectedBook;render();messages.scrollTop=messages.scrollHeight;void load({poll:true});
    try{const turn=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat',request.payload);if(isCurrent(captured)&&state.resolveSend(request.ticket,turn)){render();schedulePoll();}}
    catch(error){if(!isCurrent(captured))return;const uncertain=!error.status||error.status===409||error.status>=500;if(state.rejectSend(request.ticket,error,{uncertain})){render();if(uncertain||error.status===412)await load();}}
    finally{if(isCurrent(captured)){render();schedulePoll();}}
  }
  async function saveScope(){
    if(syncOwner()){render();return;}const request=state.beginScopeChange(scopeChoice.value);if(!request){render();return;}
    const captured=owner,bookId=selectedBook,focus=trackActionFocus(document,scopeChoice);render();
    try{const scope=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat/scope',request.payload);if(isCurrent(captured)&&bookId===selectedBook&&!state.resolveScopeChange(request.ticket,scope))await load();}
    catch(error){if(isCurrent(captured)&&bookId===selectedBook&&state.rejectScopeChange(request.ticket,error))await load();}
    finally{if(isCurrent(captured)&&bookId===selectedBook){render();if(root.open)focus.restore(!scopeChoice.disabled?scopeChoice:!input.disabled?input:closeButton);else focus.stop();}else focus.stop();}
  }
  async function stop(){
    const ticket=state.beginCancel();if(!ticket)return;const focus=trackActionFocus(document,stopButton);clearPoll();const captured=owner,bookId=selectedBook;render();
    try{const turn=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat/'+encodeURIComponent(ticket.id)+'/cancel',{});if(isCurrent(captured))state.resolveCancel(ticket,turn);}
    catch(error){if(isCurrent(captured)){state.rejectCancel(ticket,error);render();await load();}}
    finally{if(isCurrent(captured)){render();if(root.open)focus.restore(!input.disabled&&!form.hidden?input:stopButton.hidden?refreshButton.hidden?closeButton:refreshButton:stopButton);else focus.stop();}else focus.stop();}
  }
  function close(){characterMotion?.setState({chatOpen:false});clearPoll();focusComposer=false;menu.open=false;if(root.open)root.close();if(launcher){launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-label',state.view().pending?'打开阅读对话，提问正在处理':'打开阅读对话');}returnFocus();}
  function choose(bookId,passageId=null){if(state.view().pending||state.view().retry?.uncertain||state.view().scopePending)return false;clearPoll();loadInFlight=null;pollCount=0;pollStarted=0;selectedBook=bookId;requestedPassage=passageId;historySignature='';context.open=false;state.setContext(owner,selectedBook);requestedPassage=state.view().retry?.payload.passageId||requestedPassage;return true;}
  async function copyAnswer(text,element,control){try{await navigator.clipboard.writeText(text);control.textContent='已复制';}catch{const range=document.createRange();range.selectNodeContents(element);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);control.textContent='已选中，可复制';}}
  function exportChat(){
    const view=state.view();if(!view.turns.length)return;const data={kind:'marginalia-book-chat',schemaVersion:1,exportedAt:new Date().toISOString(),bookId:selectedBook,title:view.data?.title,contentVersion:view.data?.contentVersion,turns:view.turns};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'})),link=node('a');link.href=url;link.download='Leafhour-对话-'+selectedBook+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  (launcher||trigger).addEventListener('click',()=>root.open?close():controls.open());
  function escape(event){if(event.key==='Escape'&&root.open){event.preventDefault();event.stopPropagation();close();}}
  root.addEventListener('keydown',escape);(launcher||trigger).addEventListener('keydown',escape);
  // Match the visible viewport when a mobile keyboard reduces or pans it.
  function fitViewport(){const viewport=window.visualViewport;if(!viewport)return;root.style.setProperty('--chat-viewport-height',viewport.height+'px');root.style.setProperty('--chat-viewport-top',viewport.offsetTop+'px');root.classList.toggle('is-compact-viewport',viewport.height<=500);if(root.open&&viewport.height<=500&&document.activeElement===input)frame.scrollTop+=Math.max(0,form.getBoundingClientRect().bottom-Math.min(frame.getBoundingClientRect().bottom,viewport.offsetTop+viewport.height-8));}
  window.visualViewport?.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('scroll',fitViewport);fitViewport();
  input.addEventListener('focus',fitViewport);
  closeButton.addEventListener('click',close);root.addEventListener('cancel',event=>{event.preventDefault();close();});root.addEventListener('close',()=>{clearPoll();returnFocus();});
  scopeChoice.addEventListener('change',saveScope);
  chooser.addEventListener('change',()=>{if(choose(chooser.value)){render();load();}});context.addEventListener('toggle',()=>{contextHint.textContent=context.open?'收起原文与译文':'查看原文与译文';});
  input.addEventListener('input',()=>{state.setDraft(input.value);render();});input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229){event.preventDefault();send();}});
  form.addEventListener('submit',event=>{event.preventDefault();if(!composing)send();});stopButton.addEventListener('click',stop);refreshButton.addEventListener('click',async()=>{const focus=trackActionFocus(document,refreshButton),captured=owner,bookId=selectedBook;pollCount=0;try{await load();}finally{if(root.open&&captured===owner&&bookId===selectedBook)focus.restore(!refreshButton.hidden&&!refreshButton.disabled?refreshButton:!input.disabled&&!form.hidden?input:closeButton);else focus.stop();}});exportButton.addEventListener('click',()=>{exportChat();menu.open=false;menuSummary.focus();});
  const controls={
    open({bookId,passageId,messageId,draft}={}){
      externalLauncher?.onOpen?.();
      targetMessageId=messageId||null;root.dispatchEvent(new Event('reading-chat-open'));
      syncOwner();const view=state.view(),canFollow=!view.draft&&!view.pending&&!view.retry?.uncertain&&!view.scopePending;
      const candidate=bookId||(canFollow?currentBookId():null)||selectedBook||books()[0]?.bookId||null,valid=books().some(book=>book.bookId===candidate)?candidate:books()[0]?.bookId||null;
      const currentPassage=canFollow?(passageId||getCurrentPassage()||null):requestedPassage;
      if(!view.pending&&!view.retry?.uncertain&&(selectedBook!==valid||canFollow&&currentPassage!==requestedPassage))choose(valid,currentPassage);
      if(typeof draft==='string'&&draft.length<=2000&&!state.view().draft&&!state.view().pending&&!state.view().retry?.uncertain)state.setDraft(draft);
      if(!root.open){opener=document.activeElement;root.show();closeButton.focus();}if(launcher)launcher.setAttribute('aria-expanded','true');focusComposer=!!messageId;render();pollCount=0;load();
    },
    surface:()=>({launcher,trigger,header,root,motion:characterMotion,position:characterPosition}),
    refresh:()=>root.open?load():Promise.resolve(),
    close,
    reset(){clearPoll();loadInFlight=null;pollCount=0;pollStarted=0;owner=null;selectedBook=null;requestedPassage=null;historySignature='';state.reset();input.value='';context.open=false;render();},
    update(){const changed=syncOwner();if(!books().some(book=>book.bookId===selectedBook)&&!state.view().pending)choose(books().find(book=>book.bookId===currentBookId())?.bookId||books()[0]?.bookId||null);render();if(root.open&&(changed||state.view().phase==='idle'))load();}
  };
  return controls;
}
