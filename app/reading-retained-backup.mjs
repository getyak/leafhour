import {createReadingQueueStore} from './reading-queue-store.mjs';
import {createReadingMarkStore} from './reading-mark-store.mjs';
import {createReadingDraftStore} from './reading-draft-store.mjs';
import {mergeReadingSession,normalizeReadingSession} from './reading-session-record.mjs';
import {isReadingTimeSource} from './reading-time-policy.mjs';
import {validateLibraryBackup} from './library-backup.mjs';
const scope=(name,owner,bookId)=>name+'|'+owner+'|'+bookId;
export function retainedLibraryBackup({backup,storage,owner}){
  if(!owner||owner==='guest')throw Error('请先登录自己的书房再导出。');
  const result=structuredClone(backup);let draftCount=0,pendingSessions=0,pendingMarks=0,ongoingSessions=0;
  for(const entry of result.books){
    const book=entry.book,queue=createReadingQueueStore({storage,scope:scope('marginalia-reading-outbox-v1',owner,book.bookId),book}),sessions=new Map(entry.records.readingSessions.map(r=>[r.id,r]));
    const pending=queue.all();pendingSessions+=pending.length;
    for(const row of pending){const old=sessions.get(row.id);if(old&&!isReadingTimeSource(old.source))throw Error('待同步时段与旧来源标识冲突，原数据保留。');sessions.set(row.id,old?mergeReadingSession(normalizeReadingSession(old,book),row):row);}
    entry.records.readingSessions=[...sessions.values()];ongoingSessions+=entry.records.readingSessions.filter(r=>isReadingTimeSource(r.source)&&r.status!=='finished').length;
    const marks=new Map((entry.records.readingMilestones||[]).map(m=>[m.id,m])),localMarks=createReadingMarkStore({storage,scope:scope('marginalia-reading-marks-v1',owner,book.bookId),book}).all();pendingMarks+=localMarks.length;for(const row of localMarks){if(marks.has(row.id)&&marks.get(row.id).type!==row.type)throw Error('待同步标记与书房记录冲突，请先保留当前阅读页。');marks.set(row.id,marks.get(row.id)||row);}entry.records.readingMilestones=[...marks.values()];entry.records.schemaVersion=3;
    const drafts=createReadingDraftStore({storage,scope:scope('marginalia-reading-ending-drafts-v1',owner,book.bookId),book}).list();if(drafts.length)entry.localReadingDrafts={version:1,entries:drafts};draftCount+=drafts.length;
  }
  return {backup:result,draftCount,pendingSessions,pendingMarks,ongoingSessions};
}
export function restoreRetainedDrafts({backup,storage,owner}){
  if(!owner||owner==='guest')throw Error('请先登录自己的书房再恢复。');
  validateLibraryBackup(backup);
  for(const entry of backup.books)if(entry.localReadingDrafts)createReadingDraftStore({storage,scope:scope('marginalia-reading-ending-drafts-v1',owner,entry.book.bookId),book:entry.book}).import(entry.localReadingDrafts.entries);
}
