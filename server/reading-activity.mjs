import {mergeReadingIntervals,readingIntervalSeconds,validReadingTimeZone} from '../app/reading-session-record.mjs';
export {normalizeReadingSession,mergeReadingSession,normalizeReadingMilestone,normalizeReadingGoal} from '../app/reading-session-record.mjs';
const bad=message=>{throw Object.assign(Error(message),{status:400});};
export {readingJourney} from '../app/reading-journey.mjs';
function dateFormatter(timeZone){const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});return stamp=>{const parts=Object.fromEntries(format.formatToParts(stamp).map(p=>[p.type,p.value]));return parts.year.padStart(4,'0')+'-'+parts.month+'-'+parts.day;};}
function splitByDay(start,end,dateKey,emit){
  let cursor=start;while(cursor<end){const day=dateKey(cursor);let boundary=end;
    if(dateKey(end-1)!==day){let low=cursor+1,high=end;while(low<high){const mid=Math.floor((low+high)/2);if(dateKey(mid)===day)low=mid+1;else high=mid;}boundary=low;}
    emit(day,[cursor,boundary]);cursor=boundary;
  }
}
export function buildReadingCalendar(entries,{month,timeZone}){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!validReadingTimeZone(timeZone))bad('请选择有效月份和时区');
  const [year,monthNumber]=month.split('-').map(Number),last=new Date(0);last.setUTCFullYear(year,monthNumber,0);const dateKey=dateFormatter(timeZone),days=Array.from({length:last.getUTCDate()},(_,i)=>({date:month+'-'+String(i+1).padStart(2,'0'),durationSeconds:0,notes:0,questions:0,chapterMarks:0,books:[],details:[],_intervals:[],_books:new Map()})),byDay=new Map(days.map(d=>[d.date,d]));
  const rowFor=(day,book)=>{let row=day._books.get(book.bookId);if(!row){row={bookId:book.bookId,title:book.title,author:book.author||'',durationSeconds:0,sessionCount:0,notes:0,questions:0,chapterMarks:0,_intervals:[],_sessions:new Set()};day._books.set(book.bookId,row);}return row;};
  for(const {book,records}of entries){
    if(records.bookId!==book.bookId)continue;
    for(const session of records.readingSessions||[]){
      if(session.source!=='reader_focus'||session.bookId!==book.bookId||session.contentVersion!==book.contentVersion||!Array.isArray(session.segments))continue;
      const sessionDays=new Set();for(const segment of session.segments){const start=Date.parse(segment.startedAt),end=Date.parse(segment.endedAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>86400000)continue;
        splitByDay(start,end,dateKey,(date,interval)=>{const day=byDay.get(date);if(!day)return;const row=rowFor(day,book);day._intervals.push(interval);row._intervals.push(interval);row._sessions.add(session.id);sessionDays.add(date);});
      }
      for(const date of sessionDays)byDay.get(date).details.push({id:session.id,type:'reading',bookId:book.bookId,title:book.title,createdAt:session.endedAt,startedAt:session.startedAt,endedAt:session.endedAt,source:'reader_focus',chapterId:session.end.chapterId,passageId:session.end.passageId});
    }
    for(const [field,type]of [['comments','comment'],['questions','question']])for(const note of records[field]||[]){
      if(note.origin!=='user')continue;const stamp=Date.parse(note.createdAt);if(!Number.isFinite(stamp))continue;const day=byDay.get(dateKey(stamp));if(!day)continue;const row=rowFor(day,book),key=type==='comment'?'notes':'questions';day[key]++;row[key]++;day.details.push({id:note.id,type,bookId:book.bookId,title:book.title,createdAt:note.createdAt,origin:'user',text:note.text.slice(0,240),passageId:note.passageId,chapterId:book.sections.find(s=>s.paragraphs.some(p=>p.id===note.passageId))?.chapterId});
    }
    for(const mark of records.readingMilestones||[]){
      if(mark.origin!=='user'||!['chapter_read','book_finished'].includes(mark.type))continue;const stamp=Date.parse(mark.createdAt);if(!Number.isFinite(stamp))continue;const day=byDay.get(dateKey(stamp));if(!day)continue;const row=rowFor(day,book);day.chapterMarks++;row.chapterMarks++;day.details.push({id:mark.id,type:mark.type,bookId:book.bookId,title:book.title,createdAt:mark.createdAt,origin:'user',chapterId:mark.chapterId,passageId:book.sections.find(s=>s.chapterId===mark.chapterId)?.paragraphs[0]?.id||book.readingStart?.passageId||book.sections[0]?.paragraphs[0]?.id});
    }
  }
  for(const day of days){
    day.durationSeconds=readingIntervalSeconds(day._intervals);day.details.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    const sources=new Map();for(const item of day.details){const old=sources.get(item.bookId);if(!old||old.type!=='reading'&&item.type==='reading')sources.set(item.bookId,item);}
    day.books=[...day._books.values()].map(row=>{const {_intervals,_sessions,...visible}=row,item=sources.get(row.bookId),source=item?{bookId:item.bookId,type:item.type,chapterId:item.chapterId,passageId:item.passageId}:null;return {...visible,durationSeconds:readingIntervalSeconds(_intervals),sessionCount:_sessions.size,...(source?{source}:{})};});
    day.totalDetails=day.details.length;day.details=day.details.slice(0,20);delete day._intervals;delete day._books;
  }
  return {month,timeZone,days,durationSeconds:days.reduce((sum,d)=>sum+d.durationSeconds,0),readingDays:days.filter(d=>d.durationSeconds>0||d.chapterMarks>0).length,notes:days.reduce((sum,d)=>sum+d.notes,0),questions:days.reduce((sum,d)=>sum+d.questions,0),meaning:'前台阅读时段由用户开启；重叠时间不重复累计。笔记、读完标记与理解分别记录。'};
}
