export const positionStorageKey=(bookId,ownerId='guest')=>'marginalia-focus-position-v1|'+ownerId+'|'+bookId;
export function acknowledgePosition(cached,saved,submitted){
  if(cached?.localWriterId!==submitted.localWriterId)return cached;
  if(cached?.localSequence===submitted.localSequence)return {...saved,pending:false};
  if(cached?.pending&&cached.localSequence>submitted.localSequence&&cached.baseRevision===submitted.baseRevision)return {...cached,baseRevision:saved.revision};
  return cached;
}
export function resolveReadingPosition(book,position){
  if(!validParagraphAnchor(position)||!['zh','en','parallel'].includes(position.mode)||!['literal','interpretive'].includes(position.variant)||position.contentVersion&&position.contentVersion!==book.contentVersion)return null;
  const section=book.sections.find(s=>s.paragraphs.some(p=>p.id===position.passageId));
  return section?{...position,chapterId:section.chapterId}:null;
}
export function chooseReadingPosition({book,remote,local,remoteAvailable=true}){
  const saved=resolveReadingPosition(book,remote),cached=resolveReadingPosition(book,local);
  if(remoteAvailable&&saved){
    if(cached?.pending&&cached.baseRevision===(saved.revision||0))return cached;
    return saved;
  }
  if(remoteAvailable&&cached?.pending&&(cached.baseRevision||0)!==(remote?.revision||0))return saved;
  return cached||saved;
}
export function resumeSummary(book,position,labels={}){
  const saved=resolveReadingPosition(book,position);if(!saved)return null;
  const chapter=book.chapters.find(c=>c.id===saved.chapterId);if(!chapter)return null;
  // Optional caller-supplied label formatting keeps this helper pure; the
  // legacy default stays exactly the stored source-language label.
  const fallbackTitle=labels.fallbackTitle||'上次的位置',chapterLabel=labels.chapterLabel||((number,title)=>'第 '+number+' 章 · '+title);
  const title=chapter.title?.zh||chapter.title?.en||fallbackTitle;
  const label=chapter.kind==='body'&&!/^第 .+ [章卷]$/.test(title)?chapterLabel(chapter.number,title):title;
  return {chapterId:chapter.id,passageId:saved.passageId,chapterTitle:title,label,mode:saved.mode,variant:saved.variant,observedAt:saved.observedAt||null,updatedAt:saved.updatedAt||null,revision:saved.revision||0};
}
export const recoveredPositionNeedsChoice=(knownRevision,remote)=>!!remote&&(remote.revision||0)!==knownRevision;
import {validParagraphAnchor} from './paragraph-anchor.mjs';
