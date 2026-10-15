import {createLibraryChatState,CHAT_TEXT_LIMIT} from './library-chat-state.mjs';

const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const button=(text,className='library-chat-button')=>{const element=node('button',className,text);element.type='button';return element;};
const bookTitle=book=>book?.title?.zh||book?.title?.en||'这本书';
const chapterTitle=value=>typeof value==='string'?value:value?.zh||value?.en||'当前阅读位置';
const readUrl=(bookId,passageId)=>'/read?book='+encodeURIComponent(bookId)+(passageId?'&passage='+encodeURIComponent(passageId):'');
const draftKey=(owner,book)=>'marginalia:chat-draft:'+encodeURIComponent(owner)+':'+encodeURIComponent(book);

export function mountLibraryChat({root,api,getSession,getBooks,getOwner,openAuth,getCurrentBook=()=>null}){
  const state=createLibraryChatState({readDraft:(owner,book)=>localStorage.getItem(draftKey(owner,book))||'',writeDraft:(owner,book,text)=>{if(text)localStorage.setItem(draftKey(owner,book),text);else localStorage.removeItem(draftKey(owner,book));}});
  let opener=null,owner=null,selectedBook=null,requestedPassage=null,pollTimer=null,pollCount=0,loadInFlight=null,composing=false,focusComposer=false,historySignature='';
  root.classList.add('library-chat-dialog');root.setAttribute('aria-labelledby','library-chat-title');
  const frame=node('div','library-chat-frame'),header=node('header','library-chat-header'),brand=node('span','library-chat-mark','循');brand.setAttribute('aria-hidden','true');
  const heading=node('div','library-chat-heading');heading.append(node('p','library-chat-eyebrow','循页 · 阅读助手'));const title=node('h2','','从这一页继续');title.id='library-chat-title';heading.append(title,node('p','library-chat-subtitle','把疑问留在原文旁边。'));
  const closeButton=button('×','library-chat-close');closeButton.setAttribute('aria-label','收起阅读助手');closeButton.title='收起阅读助手';header.append(brand,heading,closeButton);
  const bookRow=node('div','library-chat-book-row'),bookLabel=node('label','','正在读'),chooser=node('select','library-chat-book-choice');chooser.id='library-chat-book';bookLabel.htmlFor=chooser.id;bookRow.append(bookLabel,chooser);
  const context=node('details','library-chat-context'),contextSummary=node('summary'),contextLabel=node('span'),contextHint=node('span','library-chat-context-hint','查看原文与译文');contextSummary.append(contextLabel,contextHint);const contextBody=node('div','library-chat-context-body');context.append(contextSummary,contextBody);
  const messages=node('div','library-chat-messages');messages.setAttribute('role','log');messages.setAttribute('aria-label','和这本书的对话');messages.setAttribute('aria-live','polite');messages.setAttribute('aria-relevant','additions text');
  const statusBar=node('div','library-chat-status-row'),status=node('p','library-chat-status');status.id='library-chat-status';status.setAttribute('role','status');const refreshButton=button('重新载入','library-chat-text-button');statusBar.append(status,refreshButton);
  const form=node('form','library-chat-composer'),inputLabel=node('label','sr-only','想问这本书什么？'),input=node('textarea');input.id='library-chat-input';inputLabel.htmlFor=input.id;input.rows=3;input.placeholder='哪一句让你停了下来？';input.setAttribute('aria-describedby','library-chat-status library-chat-hint library-chat-count');
  const composerBottom=node('div','library-chat-composer-bottom'),count=node('span','library-chat-count');count.id='library-chat-count';const composerActions=node('div','library-chat-composer-actions'),stopButton=button('停止','library-chat-stop'),sendButton=node('button','library-chat-send','发送 ↑');sendButton.type='submit';composerActions.append(stopButton,sendButton);composerBottom.append(count,composerActions);form.append(inputLabel,input,composerBottom);
  const footer=node('div','library-chat-footer'),hint=node('p','library-chat-hint','发送后，助手会结合当前段与相邻段给出解释候选。');hint.id='library-chat-hint';const exportButton=button('导出这段对话','library-chat-text-button');footer.append(hint,exportButton);frame.append(header,bookRow,context,messages,statusBar,form,footer);root.replaceChildren(frame);

  const signedIn=()=>!!getSession()?.user;
  const activeOwner=()=>signedIn()?String(getOwner()||getSession().user.id):null;
  const books=()=>Array.isArray(getBooks())?getBooks():[];
  const currentBookId=()=>{const current=getCurrentBook();return typeof current==='string'?current:current?.bookId;};
  function clearPoll(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
  function syncOwner(){
    const next=activeOwner();if(next===owner)return false;
    owner=next;clearPoll();loadInFlight=null;pollCount=0;requestedPassage=null;historySignature='';selectedBook=books().some(book=>book.bookId===currentBookId())?currentBookId():books()[0]?.bookId||null;
    state.reset();state.setContext(owner,selectedBook);input.value='';context.open=false;return true;
  }
  function isCurrent(captured){if(captured===activeOwner()&&captured===owner)return true;syncOwner();render();return false;}
  function routeBack(label='回到书架'){const b=button(label,'library-chat-button');b.addEventListener('click',()=>{close();const shelf=document.getElementById('library-view');if(shelf&&!shelf.hidden)shelf.scrollIntoView({block:'start'});else location.assign('/library');});return b;}
  function sourceLink(label,passageId,bookId=selectedBook){const link=node('a','library-chat-source-link',label);link.href=readUrl(bookId,passageId);return link;}
  function renderContext(view){
    const item=view.data?.context;context.hidden=!item;contextLabel.textContent=chapterTitle(item?.chapterTitle);
    if(!item)return;
    contextBody.replaceChildren();contextBody.append(sourceLink('回到当前段落 ↗',item.passageId));
    for(const [key,label] of [['original','原文'],['literal','直译'],['interpretive','意译']]){
      const block=node('div','library-chat-source'),value=item[key],status=item.translationStatus?.[key];block.append(node('p','library-chat-source-label',label+(key!=='original'&&status==='draft'?' · 草稿':'')));
      block.append(node('p',key==='original'?'library-chat-original':'',value||'这一版译文尚未准备，保留原文供核对。'));contextBody.append(block);
    }
  }
  function emptyState(headingText,bodyText){const empty=node('section','library-chat-empty');empty.append(node('span','library-chat-empty-rule'),node('h3','',headingText),node('p','',bodyText));return empty;}
  function renderMessages(view){
    const signature=JSON.stringify([owner,selectedBook,view.phase,view.turns,view.pending?.status,signedIn(),books().length]);
    if(signature===historySignature)return;historySignature=signature;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<90;messages.replaceChildren();
    if(!signedIn()){
      const empty=emptyState('和书多聊几句','登录后，可以围绕原文提问，也能回来接着看自己的问题。');const login=button('登录后开始','library-chat-send');login.addEventListener('click',()=>{close();openAuth();});empty.append(login);messages.append(empty);return;
    }
    if(!selectedBook){const empty=emptyState('先选一本想读的书','回到书架打开一本书，再带着问题回来。');empty.append(routeBack());messages.append(empty);return;}
    if(view.phase==='loading'&&!view.data){const empty=emptyState('正在翻到这一页','正在载入原文和已有对话…');empty.classList.add('is-loading');messages.append(empty);return;}
    if(view.phase==='error'&&!view.data){messages.append(emptyState('这一页暂时没有打开','可以重新载入，已经写下的问题会保留。'));return;}
    if(!view.turns.length){
      const empty=emptyState('哪一句让你停了下来？','可以问一个词，也可以试着说出自己的理解，再一起核对原文。');
      const suggestions=node('div','library-chat-suggestions');for(const text of ['这段最容易被误读的地方是什么？','帮我把这段的论证拆开看看。','我想用自己的话复述这段。']){const suggestion=button(text,'library-chat-suggestion');suggestion.disabled=!!view.pending;suggestion.addEventListener('click',()=>{state.setDraft(text);render();input.focus();});suggestions.append(suggestion);}empty.append(suggestions);messages.append(empty);
    }
    for(const turn of view.turns){
      const row=node('article','library-chat-turn'),question=node('div','library-chat-question');question.append(node('p','library-chat-attribution','我的提问'),node('p','library-chat-text',turn.text));row.append(question);
      if(turn.answer?.summary){
        const answer=node('div','library-chat-answer'),answerHeading=node('div','library-chat-answer-heading'),copy=button('复制','library-chat-text-button');const answerText=node('p','library-chat-text',turn.answer.summary);copy.setAttribute('aria-label','复制这条 AI 解释');copy.addEventListener('click',()=>copyAnswer(turn.answer.summary,answerText,copy));answerHeading.append(node('p','library-chat-attribution','AI 解释 · 候选'),copy);answer.append(answerHeading,answerText);
        if(turn.answer.sourceRefs?.length){const references=node('details','library-chat-references');references.append(node('summary','','核对原文 · '+turn.answer.sourceRefs.length+' 处'));for(const ref of turn.answer.sourceRefs){const quote=node('blockquote','',ref.quote);quote.append(sourceLink('回到引用段落 ↗',ref.passageId));references.append(quote);}answer.append(references);}row.append(answer);
      }else{
        let text=turn.status==='running'?(view.pending?.status==='stopping'?'正在停止这次提问…':'正在对照原文思考…'):turn.status==='cancelled'?'这次提问已停止。':'这次没有得到回答。';
        if(view.retry?.uncertain&&view.retry.payload.id===turn.id)text='正在确认这次提问的结果。';const pending=node('p','library-chat-turn-status',text);if(turn.status==='running')pending.classList.add('is-pending');row.append(pending);
      }
      messages.append(row);
    }
    if(nearBottom||focusComposer)messages.scrollTop=messages.scrollHeight;
  }
  function render(){
    const view=state.view(),list=books(),visibleDraft=view.pending?'':view.draft;if(input.value!==visibleDraft)input.value=visibleDraft;input.placeholder=view.pending?'正在对照原文思考…':'哪一句让你停了下来？';
    chooser.replaceChildren(...list.map(book=>{const option=node('option','',bookTitle(book));option.value=book.bookId;return option;}));chooser.value=selectedBook||'';chooser.disabled=!!view.pending||!!view.retry?.uncertain;bookRow.hidden=!signedIn()||!selectedBook;
    renderContext(view);renderMessages(view);form.hidden=!signedIn()||!selectedBook;footer.hidden=form.hidden;
    const length=view.draft.length;count.textContent=length>=1800?(length>CHAT_TEXT_LIMIT?'已超出 '+(length-CHAT_TEXT_LIMIT)+' 字':'还可写 '+(CHAT_TEXT_LIMIT-length)+' 字'):'';count.classList.toggle('is-over-limit',length>CHAT_TEXT_LIMIT);input.setAttribute('aria-invalid',String(length>CHAT_TEXT_LIMIT));
    input.disabled=!!view.pending||!!view.retry?.uncertain;count.hidden=!!view.pending;sendButton.disabled=!view.canSend;sendButton.textContent=view.retry?.uncertain?'继续这次提问 ↑':view.retry?'再试一次 ↑':'发送 ↑';stopButton.hidden=!view.pending;stopButton.disabled=view.pending?.status==='stopping';
    if(!signedIn())status.textContent='';else if(!selectedBook)status.textContent='';else if(view.pending)status.textContent=view.pending.status==='stopping'?'正在停止。确认后可以重新提问。':pollCount>=12?'还在处理，可以点“查看进度”确认，也可以先收起窗口。':'可以先收起窗口，回答会留在这里。';else if(view.loadError)status.textContent=view.loadError;else if(view.notice)status.textContent=view.notice;else if(view.data?.available===false)status.textContent='阅读助手暂时不可用。可以先写下问题，稍后再试。';else if(view.phase==='loading')status.textContent='正在载入原文和已有对话…';else status.textContent='';
    statusBar.hidden=!status.textContent;status.classList.toggle('has-error',!!view.loadError);refreshButton.hidden=!signedIn()||!selectedBook||(!view.loadError&&!view.retry?.uncertain&&!view.pending&&view.data?.available!==false);refreshButton.disabled=!!loadInFlight||view.pending?.status==='stopping';refreshButton.textContent=view.pending||view.retry?.uncertain?'查看进度':'重新载入';exportButton.hidden=!view.turns.length;contextHint.textContent=context.open?'收起原文与译文':'查看原文与译文';
    hint.textContent=view.pending?'收起窗口不会停止提问。需要中断时，请点“停止”。':'发送后，助手会结合当前段与相邻段给出解释候选。';
    if(focusComposer&&root.open&&!input.disabled&&!form.hidden){focusComposer=false;input.focus();}
  }
  function schedulePoll(){
    clearPoll();if(!state.view().pending||!root.open||pollCount>=12)return;
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
    if(syncOwner()){render();return;}const request=state.beginSend();if(!request)return;clearPoll();pollCount=0;const captured=owner,bookId=selectedBook;render();messages.scrollTop=messages.scrollHeight;
    try{const turn=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat',request.payload);if(isCurrent(captured)&&state.resolveSend(request.ticket,turn)){render();schedulePoll();}}
    catch(error){if(!isCurrent(captured))return;const uncertain=!error.status||error.status===409||error.status>=500;if(state.rejectSend(request.ticket,error,{uncertain})){render();if(uncertain)await load();}}
    finally{if(isCurrent(captured)){render();schedulePoll();}}
  }
  async function stop(){
    const ticket=state.beginCancel();if(!ticket)return;clearPoll();const captured=owner,bookId=selectedBook;render();
    try{const turn=await api('/api/library/books/'+encodeURIComponent(bookId)+'/chat/'+encodeURIComponent(ticket.id)+'/cancel',{});if(isCurrent(captured))state.resolveCancel(ticket,turn);}
    catch(error){if(isCurrent(captured)){state.rejectCancel(ticket,error);render();await load();}}
    finally{if(isCurrent(captured))render();}
  }
  function close(){clearPoll();focusComposer=false;if(root.open)root.close();if(opener?.isConnected)opener.focus();}
  function choose(bookId,passageId=null){if(state.view().pending||state.view().retry?.uncertain)return false;clearPoll();loadInFlight=null;pollCount=0;selectedBook=bookId;requestedPassage=passageId;historySignature='';context.open=false;state.setContext(owner,selectedBook);return true;}
  async function copyAnswer(text,element,control){try{await navigator.clipboard.writeText(text);control.textContent='已复制';}catch{const range=document.createRange();range.selectNodeContents(element);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);control.textContent='已选中，可复制';}}
  function exportChat(){
    const view=state.view();if(!view.turns.length)return;const data={kind:'marginalia-book-chat',schemaVersion:1,exportedAt:new Date().toISOString(),bookId:selectedBook,title:view.data?.title,contentVersion:view.data?.contentVersion,turns:view.turns};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'})),link=node('a');link.href=url;link.download='循页-对话-'+selectedBook+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  closeButton.addEventListener('click',close);root.addEventListener('cancel',event=>{event.preventDefault();close();});root.addEventListener('close',()=>{clearPoll();if(opener?.isConnected)opener.focus();});
  chooser.addEventListener('change',()=>{if(choose(chooser.value)){render();load();}});context.addEventListener('toggle',()=>{contextHint.textContent=context.open?'收起原文与译文':'查看原文与译文';});
  input.addEventListener('input',()=>{state.setDraft(input.value);render();});input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229){event.preventDefault();send();}});
  form.addEventListener('submit',event=>{event.preventDefault();if(!composing)send();});stopButton.addEventListener('click',stop);refreshButton.addEventListener('click',()=>{pollCount=0;load();});exportButton.addEventListener('click',exportChat);
  return {
    open({bookId,passageId}={}){
      syncOwner();const candidate=bookId||selectedBook||currentBookId()||books()[0]?.bookId||null,valid=books().some(book=>book.bookId===candidate)?candidate:books()[0]?.bookId||null;
      if(!state.view().pending&&(selectedBook!==valid||passageId&&passageId!==requestedPassage))choose(valid,passageId||null);
      if(!root.open){opener=document.activeElement;root.showModal();}focusComposer=true;render();pollCount=0;load();
    },
    close,
    reset(){clearPoll();loadInFlight=null;pollCount=0;owner=null;selectedBook=null;requestedPassage=null;historySignature='';state.reset();input.value='';context.open=false;render();},
    update(){const changed=syncOwner();if(!books().some(book=>book.bookId===selectedBook)&&!state.view().pending)choose(books().find(book=>book.bookId===currentBookId())?.bookId||books()[0]?.bookId||null);render();if(root.open&&(changed||state.view().phase==='idle'))load();}
  };
}
