// iCalendar serialization for a reading appointment.
const escapeText=value=>String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const compact=value=>value.replace(/[-:]/g,'').replace('T','T');
function localDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('请选择有效的开始日期与时间。');
  const date=new Date(value+':00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==value)throw Error('开始日期不存在。');return date;
}
function folded(line){
  const encoder=new TextEncoder(),parts=[];let current='',bytes=0;
  for(const character of line){const size=encoder.encode(character).length;if(bytes+size>75){parts.push(current);current=' ';bytes=1;}current+=character;bytes+=size;}
  parts.push(current);return parts.join('\r\n');
}
export function buildReadingCalendar(book,options,{origin,now=new Date()}={}){
  const {start,minutes,repeat='none',until,reminder=10,uid=crypto.randomUUID()}=options||{};
  const date=localDate(start);
  if(!Number.isInteger(minutes)||minutes<5||minutes>240||!['none','daily','weekly'].includes(repeat)||!Number.isInteger(reminder)||reminder< -1||reminder>1440||typeof uid!=='string'||!/^[-A-Za-z0-9]{1,100}$/.test(uid))throw Error('请检查阅读时长、重复方式与提醒。');
  const base=new URL(origin);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw Error('书房地址不正确。');
  if(typeof book?.bookId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(book.bookId))throw Error('请选择这本书。');
  if(repeat!=='none'){
    if(typeof until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(until)||localDate(until+'T23:59')<date)throw Error('重复结束日期不能早于开始日期。');
  }
  const title=String(book.title?.zh||book.title?.en||'这本书').slice(0,500),end=new Date(date.getTime()+minutes*60000),url=new URL('/read',base.origin);url.searchParams.set('book',book.bookId);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Page by Page//Reading Calendar//ZH','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+uid+'@page-by-page','DTSTAMP:'+now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART:'+compact(start)+'00','DTEND:'+end.toISOString().slice(0,19).replace(/[-:]/g,''),'SUMMARY:'+escapeText('读《'+title+'》'),'DESCRIPTION:'+escapeText('给《'+title+'》留出 '+minutes+' 分钟。\n回到书房：'+url.href),'URL:'+url.href,'TRANSP:OPAQUE'];
  if(repeat!=='none')lines.push('RRULE:FREQ='+repeat.toUpperCase()+';UNTIL='+until.replace(/-/g,'')+'T235959');
  if(reminder>=0)lines.push('BEGIN:VALARM','TRIGGER:'+(reminder?'-PT'+reminder+'M':'PT0M'),'ACTION:DISPLAY','DESCRIPTION:'+escapeText('读《'+title+'》'),'END:VALARM');
  lines.push('END:VEVENT','END:VCALENDAR');return lines.map(folded).join('\r\n')+'\r\n';
}
