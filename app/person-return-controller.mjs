import {consumePersonReturn} from './person-return.mjs';
export async function restorePersonReadingReturn({storage,owner,bookId,getReader,chat,isCurrent=()=>true}){
 const saved=consumePersonReturn({storage,owner,bookId}),reader=getReader(),book=reader?.getBook?.();
 if(!saved||!book||book.bookId!==bookId||saved.contentVersion&&saved.contentVersion!==book.contentVersion||!isCurrent())return false;
 if(saved.passageId){await reader.ensurePassages?.([saved.passageId]);if(!isCurrent())return false;const current=getReader()?.getBook?.();if(current?.contentVersion!==book.contentVersion||!current.sections.some(s=>s.paragraphs.some(p=>p.id===saved.passageId)))return false;await getReader()?.goToPassage?.(saved.passageId);}
 if(isCurrent()&&saved.draft)chat.open?.({bookId,passageId:saved.passageId||getReader()?.getAnchor?.()?.passageId,draft:saved.draft});
 return isCurrent();
}
