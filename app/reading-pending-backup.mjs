import {normalizeReadingSession,mergeReadingSession} from './reading-session-record.mjs';
export function pendingReadingBackup(book,snapshots){const sessions=new Map();for(const input of snapshots){const row=normalizeReadingSession(input,book);sessions.set(row.id,sessions.has(row.id)?mergeReadingSession(sessions.get(row.id),row):row);}return {kind:'marginalia-library',schemaVersion:1,books:[{book:structuredClone(book),records:{kind:'marginalia-personal-records',schemaVersion:3,bookId:book.bookId,contentVersion:book.contentVersion,comments:[],questions:[],readingMilestones:[],position:null,readingSessions:[...sessions.values()]}}]};}

export async function completeReadingBackupBook(book,readFullBook){
 if(!book.reading?.partial)return book;
 const full=await readFullBook(),ids=book.sections.flatMap(s=>s.paragraphs.map(p=>p.id)),paragraphs=full?.sections?.flatMap(s=>s.paragraphs)||[];
 if(full?.bookId!==book.bookId||full.contentVersion!==book.contentVersion||full.reading?.partial||paragraphs.length!==ids.length||paragraphs.some((p,i)=>p.id!==ids[i]||p.unloaded||typeof p.original!=='string'))throw Error('完整原文暂时无法核对，请先保留原始待同步数据');
 return full;
}
