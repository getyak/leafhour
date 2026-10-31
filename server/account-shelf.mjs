import {readingTimestamp} from '../app/reading-session-record.mjs';
import {isReadingTimeSource} from '../app/reading-time-policy.mjs';

const time=(value,now)=>{const n=readingTimestamp(value);return Number.isFinite(n)&&n<=now+300000?n:null;};
const latest=(values,now)=>{const stamps=values.map(value=>time(value,now)).filter(value=>value!==null);return stamps.length?new Date(Math.max(...stamps)).toISOString():null;};
const title=value=>typeof value==='string'?value:value?.zh||value?.en||null;

// Shelf metadata projects already validated records without original paragraphs,
// saved translations or the text of a private note.
export function accountBookMetadata(row,records,{now=Date.now(),pinned=false,shelfPosition}={}){
 const current=records?.bookId===row.bookId?records:{},chapters=Array.isArray(row.chapterIndex)?row.chapterIndex:[],position=current.position;
 const validPosition=position?.contentVersion===row.contentVersion&&typeof position.chapterId==='string'&&typeof position.passageId==='string'&&position.passageId&&['en','zh','parallel'].includes(position.mode)&&['literal','interpretive'].includes(position.variant)&&(!chapters.length||chapters.some(chapter=>chapter.id===position.chapterId));
 let resume=null;
 if(validPosition){
  const chapter=chapters.find(chapter=>chapter.id===position.chapterId),chapterTitle=title(chapter?.title)||title(position.chapterTitle);
  resume={chapterId:position.chapterId,passageId:position.passageId,mode:position.mode,variant:position.variant,revision:Number.isSafeInteger(position.revision)?position.revision:0,updatedAt:position.updatedAt||null,...(position.observedAt?{observedAt:position.observedAt}:{}),...(Number.isFinite(position.withinParagraph)?{withinParagraph:position.withinParagraph}:{}),...(Number.isFinite(position.offset)?{offset:position.offset}:{}),...(chapterTitle?{chapterTitle,label:chapterTitle}:{})};
 }
 const sessions=(current.readingSessions||[]).filter(session=>session.bookId===row.bookId&&session.contentVersion===row.contentVersion&&isReadingTimeSource(session.source)&&time(session.endedAt,now)!==null&&Array.isArray(session.segments)&&session.segments.some(segment=>{const a=time(segment.startedAt,now),b=time(segment.endedAt,now);return a!==null&&b!==null&&b>a;}));
 const sessionAt=latest(sessions.map(session=>session.endedAt),now),body=chapters.filter(chapter=>!chapter.kind||chapter.kind==='body'),chapterState=new Map(body.map(chapter=>[chapter.id,'unread']));
 let status='reading',finishedAt=null;
 const marks=(current.readingMilestones||[]).filter(mark=>mark.origin==='user'&&mark.bookId===row.bookId&&mark.contentVersion===row.contentVersion&&time(mark.createdAt,now)!==null).sort((a,b)=>readingTimestamp(a.createdAt)-readingTimestamp(b.createdAt));
 for(const mark of marks){if(mark.type==='book_finished'){status='finished';finishedAt=mark.createdAt;}else if(mark.type==='book_reopened'){status='reading';finishedAt=null;}else if(chapterState.has(mark.chapterId)&&['chapter_read','chapter_reopened'].includes(mark.type))chapterState.set(mark.chapterId,mark.type==='chapter_read'?'read':'unread');}
 return {...row,...(shelfPosition!==undefined?{shelfPosition}:{}),pinned,readingStateReady:true,personalizationPending:true,resume,journey:{status,finishedAt,lastReadAt:sessionAt,completedChapters:[...chapterState.values()].filter(value=>value==='read').length,totalChapters:body.length,dailyGoalMinutes:current.readingGoal?.minutes||15},lastReadAt:latest([sessionAt,resume?.observedAt||resume?.updatedAt],now)};
}

export function shelfWithPins(shelf,visible,rows){
 const available=new Set(rows.map(row=>row.bookId));
 return {...visible,pinned:(Array.isArray(shelf.pinned)?shelf.pinned:[]).filter(id=>available.has(id)),pinsInitialized:Array.isArray(shelf.pinned)};
}
