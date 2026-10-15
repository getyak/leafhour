import {normalizeReadingSession} from './reading-session-record.mjs';
export function restoreReadingEnding(saved,book){if(!saved||saved.status!=='finished')return null;try{const snapshot=normalizeReadingSession(saved,book);return {snapshot,anchor:{...snapshot.end},durationSeconds:snapshot.durationSeconds};}catch{return null;}}
export function latestReadingEnding(rows,book){
  const candidates=rows.filter(r=>r.status==='finished'&&r.bookId===book.bookId&&r.contentVersion===book.contentVersion).sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt));
  for(const row of candidates){const ending=restoreReadingEnding(row,book);if(ending)return ending;}return null;
}
