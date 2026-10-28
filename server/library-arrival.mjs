import {localReadingDate} from '../app/reading-calendar.mjs';
import {validReadingTimeZone,readingIntervalSeconds} from '../app/reading-session-record.mjs';
import {READING_TIME_SOURCES,isReadingTimeSource} from '../app/reading-time-policy.mjs';

// Only an allowlisted summary leaves this boundary. No text, original content,
// complete records, intervals or model context is returned to the companion.
export function buildLibraryArrival(entries,{timeZone,now=Date.now()}={}){
 if(!validReadingTimeZone(timeZone)||!Number.isFinite(now))throw Object.assign(Error('Invalid reading time zone'),{status:400});
 const dateKey=stamp=>localReadingDate(timeZone,new Date(stamp)),date=dateKey(now),prior=new Date(date+'T12:00:00Z');prior.setUTCDate(prior.getUTCDate()-1);const yesterday=prior.toISOString().slice(0,10);
 const midnight=day=>{const noon=Date.parse(day+'T12:00:00Z');let lo=noon-36*3600000,hi=noon+36*3600000;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(dateKey(mid)<day)lo=mid+1;else hi=mid;}return lo;};
 const start=midnight(yesterday),end=midnight(date),intervals=[],sources=Object.fromEntries(READING_TIME_SOURCES.map(s=>[s,[]])),books=new Map();let notes=0,questions=0,chapterMarks=0,lastRead=null;
 for(const {book,records}of entries){
  if(records.bookId!==book.bookId||records.contentVersion!==book.contentVersion)continue;
  let touched=false;
  for(const session of records.readingSessions||[]){
   if(session.bookId!==book.bookId||session.contentVersion!==book.contentVersion||!isReadingTimeSource(session.source)||!Array.isArray(session.segments))continue;
   const valid=session.segments.map(s=>[Date.parse(s.startedAt),Date.parse(s.endedAt)]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a&&b-a<=86400000&&b<=now);
   if(!valid.length)continue;
   const at=Math.max(...valid.map(([,b])=>b));
   if(!lastRead||at>Date.parse(lastRead.at))lastRead={bookId:book.bookId,title:book.title,at:new Date(at).toISOString(),durationSeconds:readingIntervalSeconds(valid),source:session.source,chapterId:session.end?.chapterId||null,passageId:session.end?.passageId||null,chapterTitle:(book.chapterIndex||book.chapters||[]).find(c=>c.id===session.end?.chapterId)?.title||null};
   for(const [a,b]of valid){const clipped=[Math.max(start,a),Math.min(end,b)];if(clipped[1]>clipped[0]){intervals.push(clipped);sources[session.source].push(clipped);touched=true;}}
  }
  for(const [field,key]of [['comments','notes'],['questions','questions'],['readingMilestones','chapterMarks']])for(const item of records[field]||[]){
   const stamp=Date.parse(item.createdAt);if(item.origin!=='user'||item.bookId&&item.bookId!==book.bookId||item.contentVersion&&item.contentVersion!==book.contentVersion||!Number.isFinite(stamp)||stamp<start||stamp>=end||key==='chapterMarks'&&!['chapter_read','book_finished'].includes(item.type))continue;
   if(key==='notes')notes++;else if(key==='questions')questions++;else chapterMarks++;
  }
  if(touched)books.set(book.bookId,{bookId:book.bookId,title:book.title});
 }
 return {date,timeZone,yesterday:{date:yesterday,durationSeconds:readingIntervalSeconds(intervals),sourceDurationSeconds:Object.fromEntries(READING_TIME_SOURCES.map(s=>[s,readingIntervalSeconds(sources[s])])),notes,questions,chapterMarks,bookCount:books.size,books:[...books.values()].slice(0,3)},lastRead};
}
