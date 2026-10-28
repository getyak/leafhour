import {billingErrorDetails} from './owner-scope.mjs';
import {readingChatQuoteFromExcerpt} from './reading-chat-quote.mjs';
import {getUiLinkLocale,t,uiHref,onUiLocaleChange} from './ui-locale.mjs';
import {mountReaderChatWorkspace} from './reader-chat-workspace.mjs';
import {readerLoginUrl} from './reader-return.mjs';
import {mountCompanionAnchor} from './reader-companion.mjs';
import {mountLibraryChat} from './library-chat.mjs';
import {overlayOpen} from './popover-controls.mjs';
import {readChatResponse} from './chat-stream.mjs';

export function readerInteractionBlocked(document,target){
  return overlayOpen(document,'dialog[open]:not(.library-chat-dialog)')||!!target?.closest?.('dialog,.library-chat-launcher,.squirrel-companion-bubble,.squirrel-companion-pill');
}

export function readerConversationContext(reader,bookId){
  const book=reader?.getBook?.();
  if(!book||book.bookId!==bookId)return null;
  const passages=new Set(book.sections.flatMap(section=>section.paragraphs.map(paragraph=>paragraph.id)));
  const selected=reader.isSelectionActive?.()?reader.getSelectedId?.():null,anchor=reader.getAnchor?.()?.passageId;
  return {book,passages,passageId:passages.has(selected)?selected:passages.has(anchor)?anchor:null};
}

export function mountReaderConversation({bookId,session,getReader,root,request=fetch,navigate=url=>location.assign(url),replace=url=>location.replace(url),mountChat=mountLibraryChat,mountCompanion=null,integration=null,uploadController=null,mountUpload=null,renderMarkdown=null,announce=()=>{}}){
  if(!bookId||!root)return null;
  let chat,companion,workspace,disposed=false;
  const events=globalThis.document,listeners=[];
  const on=(name,handler)=>{events.addEventListener(name,handler);listeners.push(()=>events.removeEventListener(name,handler));};
  const requireActive=()=>{if(disposed)throw Object.assign(Error('Conversation disposed'),{code:'READER_CONVERSATION_DISPOSED'});};
  const openAuth=()=>{if(disposed)return;const passageId=context()?.passageId;navigate(readerLoginUrl({bookId,passageId,ui:getUiLinkLocale()}));};
  let disposeChat;
  const dispose=()=>{if(disposed)return;disposed=true;for(const remove of listeners)remove();companion?.dispose();uploadController?.dispose();disposeChat?.();workspace?.dispose();externalLauncher?.position?.dispose();};
  const sessionChanged=()=>{requireActive();companion?.dispose();chat?.reset();dispose();events.dispatchEvent(new CustomEvent('reader:session-changed'));replace(uiHref('/library'));throw Object.assign(Error(t('conversation.accountChanged')),{status:409});};
  // GET-184: one injected seam bundle is split into exactly four contracts —
  // the chat-owned AI trigger host, the companion bubble anchor (shared pill),
  // the focus-return callback and the unread callback. No launcher DOM, drag or
  // ARIA is ever attached to the shared pill.
  const externalLauncher=integration?{anchor:integration.companionAnchor,triggerHost:integration.triggerHost,focusReturn:integration.focusReturn,onOpen:()=>integration.onOpen?.(),position:mountCompanionAnchor({anchor:integration.companionAnchor})}:null;

  const context=()=>disposed?null:readerConversationContext(getReader(),bookId);
  const api=async(url,data,options={})=>{
    requireActive();
    const {onProgress,...requestOptions}=options;
    const response=await request(url,{...requestOptions,...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{'Content-Type':'application/json','X-Reader-Owner':session?.user?.id||'guest',...(onProgress?{Accept:'application/x-ndjson'}:{})}});
    requireActive();
    if(response.headers.get('X-Reader-Session-Changed')==='1')sessionChanged();
    if(url.endsWith('/companion/messages')&&response.ok){const identity=await request('/api/auth/session',{cache:'no-store'});requireActive();const current=await identity.json();requireActive();if(!identity.ok||(current.user?.id||'guest')!==(session?.user?.id||'guest'))sessionChanged();}
    const value=await readChatResponse(response,{onProgress,isCurrent:()=>!disposed&&!options.signal?.aborted});requireActive();
    if(!response.ok)throw Object.assign(Error(value.error||'对话暂时无法载入，请重试。'),{status:response.status,...billingErrorDetails(value)});
    return value;
  };
  let taskStorage=null;try{taskStorage=globalThis.localStorage;}catch{}
  chat=mountChat({root,api,uploadController,mountUpload,renderMarkdown,uploadOptions:{request,storage:taskStorage},getSession:()=>session,getOwner:()=>session?.user?.id||null,getBooks:()=>{const current=context();return current?[current.book]:[];},getCurrentBook:()=>bookId,getCurrentPassage:()=>context()?.passageId||null,externalLauncher,
    openAuth,dismissOnOutside:()=>workspace?.isMobile()!==false,onViewChange:opened=>{if(opened)getReader()?.dismissTools?.({preserveSelection:true});workspace?.setOpen(opened);},
    onNavigateToPassage:(targetBook,passageId)=>{
      const current=context();if(targetBook!==bookId||!current?.passages.has(passageId))return false;
      const reader=getReader();if(workspace?.isMobile())chat.close();reader.dismissTools?.();
      const navigationCurrent=()=>!disposed&&getReader()===reader,focusAtStart=events.activeElement;
      Promise.resolve(reader.goToPassage(passageId,{validate:navigationCurrent})).then(changed=>{if(changed&&navigationCurrent()&&events.activeElement===focusAtStart)events.getElementById?.(passageId)?.focus({preventScroll:true});}).catch(()=>{if(navigationCurrent())announce(t('reader.b1.chapterFailed'));});return true;
    }
  });
  chat.quoteSelection=()=>{
    if(disposed)return false;if(!session?.user){openAuth();return false;}
    const reader=getReader(),book=reader?.getBook?.();let snapshot;
    try{
      if(!reader?.isSelectionActive?.())throw Error('missing');
      snapshot=reader.getExcerpt?.()||reader.getAudioSelection?.();
      if(!snapshot||reader.isQuoteVisible&&!reader.isQuoteVisible(snapshot)||snapshot.parts.some(part=>!reader.isPassageVisible?.(part.passageId)))throw Error('missing');
      const quote=readingChatQuoteFromExcerpt(snapshot,book);
      if(!chat.quote?.(quote)){announce(t('chat.quote.busy'));return false;}
      reader.dismissTools?.();return true;
    }catch{announce(t(snapshot?.parts?.reduce((n,part)=>n+(part.text?.length||0),0)>2000?'chat.quote.tooLong':snapshot?'chat.quote.changed':'chat.quote.unavailable'));return false;}
  };
  workspace=mountReaderChatWorkspace({root,getReader,labels:{resize:t('chat.resize')}});
  listeners.push(onUiLocaleChange(()=>workspace.setLabels({resize:t('chat.resize')})));
  if(typeof chat.surface==='function'){const options={bookId,getOwner:()=>session?.user?.id||null,getReader,api,chat,openAuth,integration:integration?{anchor:integration.companionAnchor,onUnread:integration.onUnread,onFocusReturn:integration.focusReturn}:null};if(mountCompanion)companion=mountCompanion(options);else chat.companionReady=import('./reader-companion-loader.mjs').then(m=>{if(!disposed)companion=m.mountReaderCompanion(options);}).catch(()=>{});}
  let restoredPerson=false;
  const restorePerson=()=>{if(disposed||restoredPerson||!context())return;try{const storage=globalThis.sessionStorage;if(!storage?.getItem('leafhour:person-return:1'))return;restoredPerson=true;void import('./person-return-controller.mjs').then(m=>{if(!disposed)return m.restorePersonReadingReturn({storage,owner:session?.user?.id||'guest',bookId,getReader,chat,isCurrent:()=>!disposed});}).catch(()=>{});}catch{}};
  on('reader:ready',()=>{if(!disposed){chat.update();void restorePerson();}});
  on('reader:audio-question',event=>{
    if(disposed)return;
    const detail=event.detail,current=context();
    if(!current||detail?.ownerId!==(session?.user?.id||null)||detail.bookId!==bookId||!current.passages.has(detail.passageId)||typeof detail.draft!=='string'||!detail.draft.trim()||detail.draft.length>2000)return;
    chat.open?.({bookId,passageId:detail.passageId,draft:detail.draft});
  });
  disposeChat=chat.dispose?.bind(chat);chat.dispose=dispose;
  if(context()){chat.update();void restorePerson();}
  return chat;
}
