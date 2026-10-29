import {buildReadingCalendar} from './reading-activity.mjs';
import {readingTimestamp,readingIntervalSeconds,mergeReadingIntervals} from '../app/reading-session-record.mjs';
import {READING_TIME_SOURCES,isReadingTimeSource} from '../app/reading-time-policy.mjs';
const sources=()=>Object.fromEntries(READING_TIME_SOURCES.map(source=>[source,[]]));
const totals=rows=>Object.fromEntries(READING_TIME_SOURCES.map(source=>[source,readingIntervalSeconds(rows[source])]));
// Validate historical records defensively; never turn stored duration claims into time.
function clean({book,records}){
 const anchors=new Map((book.sections||[]).flatMap(section=>section.paragraphs.map(p=>[p.id,section.chapterId])));
 const validAnchor=a=>a&&anchors.get(a.passageId)===a.chapterId;
 const readingSessions=(records.readingSessions||[]).flatMap(session=>{
  if(!isReadingTimeSource(session.source)||session.bookId!==book.bookId||session.contentVersion!==book.contentVersion||!Array.isArray(session.segments)||!validAnchor(session.start)||!validAnchor(session.end))return [];
  const start=readingTimestamp(session.startedAt),end=readingTimestamp(session.endedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>86400000)return [];
  const segments=session.segments.filter(segment=>{const a=readingTimestamp(segment?.startedAt),b=readingTimestamp(segment?.endedAt);return Number.isFinite(a)&&Number.isFinite(b)&&b>a&&a>=start&&b<=end;});
  return [{...session,segments}];
 });
 const notes=field=>(records[field]||[]).filter(n=>!n.deletedAt&&n.origin==='user'&&typeof n.text==='string'&&anchors.has(n.passageId));
 return {book,records:{...records,readingSessions,comments:notes('comments'),questions:notes('questions')}};
}
export function buildReadingSummary(entries,query){
 const safe=entries.filter(({book,records})=>book?.bookId===records?.bookId).map(clean),calendar=buildReadingCalendar(safe,query);
 const intervals=[],bySource=sources(),days=new Set(),format=new Intl.DateTimeFormat('en-CA',{timeZone:query.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const date=stamp=>format.format(stamp);
 const books=safe.map(({book,records})=>{
  const rows=[],source=sources();for(const session of records.readingSessions)for(const segment of session.segments){const pair=[Date.parse(segment.startedAt),Date.parse(segment.endedAt)];rows.push(pair);intervals.push(pair);source[session.source].push(pair);bySource[session.source].push(pair);}
  const monthSeconds=calendar.days.reduce((sum,day)=>sum+(day.books.find(b=>b.bookId===book.bookId)?.durationSeconds||0),0);
  return {bookId:book.bookId,title:book.title,author:book.author||'',durationSeconds:readingIntervalSeconds(rows),monthSeconds,sourceDurationSeconds:totals(source)};
 });
 for(const [start,end]of mergeReadingIntervals(intervals)){let cursor=start;while(cursor<end){const key=date(cursor);days.add(key);if(date(end-1)===key)break;let low=cursor+1,high=end;while(low<high){const mid=Math.floor((low+high)/2);if(date(mid)===key)low=mid+1;else high=mid;}cursor=low;}}
 return {...calendar,allTime:{durationSeconds:readingIntervalSeconds(intervals),readingDays:days.size,sourceDurationSeconds:totals(bySource)},books};
}
