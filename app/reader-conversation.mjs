import {mountReaderCompanion} from './reader-companion.mjs';
import {mountLibraryChat} from './library-chat.mjs';

export function readerInteractionBlocked(document,target){
  return !!document.querySelector('dialog[open]:not(.library-chat-dialog),[popover]:popover-open')||!!target?.closest?.('dialog,.library-chat-launcher,.squirrel-companion-bubble,.squirrel-companion-pill');
}

export function readerConversationContext(reader,bookId){
  const book=reader?.getBook?.();
  if(!book||book.bookId!==bookId)return null;
  const passages=new Set(book.sections.flatMap(section=>section.paragraphs.map(paragraph=>paragraph.id)));
  const selected=reader.isSelectionActive?.()?reader.getSelectedId?.():null,anchor=reader.getAnchor?.()?.passageId;
  return {book,passages,passageId:passages.has(selected)?selected:passages.has(anchor)?anchor:null};
}

export function mountReaderConversation({bookId,session,getReader,root,request=fetch,navigate=url=>location.assign(url),replace=url=>location.replace(url),mountChat=mountLibraryChat,mountCompanion=mountReaderCompanion}){
  if(!bookId||!root)return null;
  let chat,companion;
  const context=()=>readerConversationContext(getReader(),bookId);
  const api=async(url,data,options={})=>{
    const response=await request(url,{...options,...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{'Content-Type':'application/json','X-Reader-Owner':session?.user?.id||'guest'}});
    if(response.headers.get('X-Reader-Session-Changed')==='1'){
      companion?.dispose();chat?.reset();replace('/library');throw Object.assign(Error('账户已切换，请重新进入书房。'),{status:409});
    }
    if(url.endsWith('/companion/messages')&&response.ok){const identity=await request('/api/auth/session',{cache:'no-store'});const current=await identity.json();if(!identity.ok||(current.user?.id||'guest')!==(session?.user?.id||'guest')){companion?.dispose();chat?.reset();replace('/library');throw Object.assign(Error('账户已切换，请重新进入书房。'),{status:409});}}
    const value=await response.json();
    if(!response.ok)throw Object.assign(Error(value.error||'对话暂时无法载入，请重试。'),{status:response.status});
    return value;
  };
  chat=mountChat({root,api,getSession:()=>session,getOwner:()=>session?.user?.id||null,getBooks:()=>{const current=context();return current?[current.book]:[];},getCurrentBook:()=>bookId,getCurrentPassage:()=>context()?.passageId||null,
    openAuth:()=>{
      const query=new URLSearchParams({book:bookId}),passage=context()?.passageId;if(passage)query.set('passage',passage);
      navigate('/library?login=1&next='+encodeURIComponent('/read?'+query));
    },
    onNavigateToPassage:(targetBook,passageId)=>{
      const current=context();if(targetBook!==bookId||!current?.passages.has(passageId))return false;
      const reader=getReader();reader.dismissTools?.();reader.goToPassage(passageId);return true;
    }
  });
  if(typeof chat.surface==='function')companion=mountCompanion({bookId,getOwner:()=>session?.user?.id||null,getReader,api,chat,openAuth:()=>{const query=new URLSearchParams({book:bookId}),passage=context()?.passageId;if(passage)query.set('passage',passage);navigate('/library?login=1&next='+encodeURIComponent('/read?'+query));}});
  document.addEventListener('reader:ready',()=>chat.update());
  document.addEventListener('reader:audio-question',event=>{
    const detail=event.detail,current=context();
    if(!current||detail?.ownerId!==(session?.user?.id||null)||detail.bookId!==bookId||!current.passages.has(detail.passageId)||typeof detail.draft!=='string'||!detail.draft.trim()||detail.draft.length>2000)return;
    chat.open?.({bookId,passageId:detail.passageId,draft:detail.draft});
  });
  if(context())chat.update();
  return chat;
}
