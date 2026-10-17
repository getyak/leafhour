// Shared by the live service and backup validation; no DOM or Node dependencies.
import {isReadingTimeSource} from './reading-time-policy.mjs';
const bad=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function validReadingTimeZone(value){
  if(typeof value!=='string'||value.length>100)return false;
  try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true;}catch{return false;}
}
export function readingTimestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
  const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number),last=new Date(0);last.setUTCFullYear(year,month,0);
  if(month<1||month>12||day<1||day>last.getUTCDate()||hour>23||minute>59||second>59)return NaN;
  return Date.parse(value);
}
export function mergeReadingIntervals(intervals){
  const sorted=intervals.map(row=>[...row]).sort((a,b)=>a[0]-b[0]),out=[];
  for(const [start,end]of sorted){if(end<=start)continue;const previous=out.at(-1);if(previous&&start<=previous[1])previous[1]=Math.max(previous[1],end);else out.push([start,end]);}return out;
}
export const readingIntervalSeconds=intervals=>Math.floor(mergeReadingIntervals(intervals).reduce((sum,[a,b])=>sum+b-a,0)/1000);
// JSONB may reorder object keys; interval order and actual bounds still matter.
export function sameReadingSegments(left,right){
  if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;
  for(let i=0;i<left.length;i++){
    const a=left[i],b=right[i];
    if(!object(a)||!object(b)||typeof a.startedAt!=='string'||typeof a.endedAt!=='string'||a.startedAt!==b.startedAt||a.endedAt!==b.endedAt)return false;
  }
  return true;
}
const passages=book=>new Map(book.sections.flatMap(section=>section.paragraphs.map(p=>[p.id,section.chapterId])));
const anchor=(value,ids)=>{if(!object(value)||ids.get(value.passageId)!==value.chapterId)bad('阅读记录无法对应原文');return {chapterId:value.chapterId,passageId:value.passageId};};
const ownership=(input,book)=>{if(input.bookId!==undefined&&input.bookId!==book.bookId||input.contentVersion!==undefined&&input.contentVersion!==book.contentVersion)bad('阅读记录的原文版本或书籍不一致',409);};

export function normalizeReadingSession(input,book,now=Date.now()){
  if(!object(input)||!identifier(input.id)||input.source!==undefined&&!isReadingTimeSource(input.source)||!Number.isInteger(input.sequence)||input.sequence<1||input.sequence>10000000||!['active','paused','finished'].includes(input.status))bad('阅读时段标识或状态不正确');
  const source=input.source===undefined?'reader_focus':input.source;
  ownership(input,book);const started=readingTimestamp(input.startedAt),ended=readingTimestamp(input.endedAt);
  if(!Number.isFinite(started)||!Number.isFinite(ended)||ended<started||ended-started>86400000||ended>now+300000||started>now+300000)bad('阅读时段的时间不正确');
  if(!validReadingTimeZone(input.timeZone)||!Array.isArray(input.segments)||input.segments.length>120)bad('阅读时段的时区或区间不正确');
  const intervals=input.segments.map(segment=>{if(!object(segment))bad('阅读时段的区间不正确');const a=readingTimestamp(segment.startedAt),b=readingTimestamp(segment.endedAt);if(!Number.isFinite(a)||!Number.isFinite(b)||a<started||b>ended||b<a)bad('阅读时段的区间超出实际时间');return [a,b];});
  const merged=mergeReadingIntervals(intervals),ids=passages(book);
  if(source==='manual'&&(input.status!=='finished'||input.sequence!==1||ended<=started||ended>now||intervals.length!==1||intervals[0][0]!==started||intervals[0][1]!==ended))bad('手动补记须为已经结束的单个时段，最长24小时');
  let recordedAt;if(input.recordedAt!==undefined){const saved=readingTimestamp(input.recordedAt);if(!Number.isFinite(saved)||saved>now+300000)bad('阅读记录保存时间不正确');recordedAt=new Date(saved).toISOString();}
  return {id:input.id,bookId:book.bookId,contentVersion:book.contentVersion,source,sequence:input.sequence,status:input.status,startedAt:new Date(started).toISOString(),endedAt:new Date(ended).toISOString(),timeZone:input.timeZone,start:anchor(input.start,ids),end:anchor(input.end,ids),segments:merged.map(([a,b])=>({startedAt:new Date(a).toISOString(),endedAt:new Date(b).toISOString()})),durationSeconds:readingIntervalSeconds(merged),...(recordedAt?{recordedAt}:{})};
}
export function mergeReadingSession(previous,next){
  if(!previous)return next;
  if(previous.id!==next.id||previous.bookId!==next.bookId||previous.contentVersion!==next.contentVersion||previous.source!==next.source||previous.startedAt!==next.startedAt||previous.timeZone!==next.timeZone||previous.start?.chapterId!==next.start?.chapterId||previous.start?.passageId!==next.start?.passageId)bad('阅读时段标识冲突，原记录已保留',409);
  if(previous.source==='manual'){
    if(previous.endedAt!==next.endedAt||previous.end?.chapterId!==next.end?.chapterId||previous.end?.passageId!==next.end?.passageId||!sameReadingSegments(previous.segments,next.segments))bad('手动补记标识冲突，原记录已保留',409);
    return previous;
  }
  if(next.sequence<=previous.sequence)return previous;
  if(previous.status==='finished'&&next.status!=='finished')bad('这次阅读已经结束，请开始新的时段',409);
  const intervals=mergeReadingIntervals([...previous.segments,...next.segments].map(row=>[Date.parse(row.startedAt),Date.parse(row.endedAt)]));
  if(intervals.length>120)bad('这次阅读的暂停次数较多，请结束后再开始',413);
  return {...next,endedAt:new Date(Math.max(Date.parse(previous.endedAt),Date.parse(next.endedAt))).toISOString(),segments:intervals.map(([a,b])=>({startedAt:new Date(a).toISOString(),endedAt:new Date(b).toISOString()})),durationSeconds:readingIntervalSeconds(intervals)};
}
export function normalizeReadingMilestone(input,book,now=Date.now()){
  if(!object(input)||!identifier(input.id)||!['chapter_read','chapter_reopened','book_finished','book_reopened'].includes(input.type)||input.origin!==undefined&&input.origin!=='user')bad('请选择自己的阅读标记');
  ownership(input,book);const created=input.createdAt===undefined?now:readingTimestamp(input.createdAt);
  if(!Number.isFinite(created)||created>now+300000)bad('阅读标记的时间不正确');
  const chapter=input.type.startsWith('chapter_');if(chapter&&!book.chapters.some(c=>c.id===input.chapterId))bad('阅读标记无法对应章节');if(!chapter&&input.chapterId!==undefined)bad('全书标记不能附带其他章节');
  return {id:input.id,type:input.type,bookId:book.bookId,contentVersion:book.contentVersion,...(chapter?{chapterId:input.chapterId}:{}),origin:'user',createdAt:new Date(created).toISOString()};
}
export function normalizeReadingGoal(input,now=Date.now()){
  if(!object(input)||!Number.isInteger(input.minutes)||input.minutes<5||input.minutes>120)bad('每天的阅读时间请设为 5 到 120 分钟');
  const updated=input.updatedAt===undefined?now:readingTimestamp(input.updatedAt);if(!Number.isFinite(updated)||updated>now+300000)bad('阅读目标的时间不正确');return {minutes:input.minutes,updatedAt:new Date(updated).toISOString()};
}
