// iCalendar serialization for a reading appointment.
const escapeText=value=>String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const compact=value=>value.replace(/[-:]/g,'').replace('T','T');
function localDate(value,fail){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw fail('reading.schedule.invalidStart');
  const date=new Date(value+':00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==value)throw fail('reading.schedule.invalidDate');return date;
}
function folded(line){
  const encoder=new TextEncoder(),parts=[];let current='',bytes=0;
  for(const character of line){const size=encoder.encode(character).length;if(bytes+size>75){parts.push(current);current=' ';bytes=1;}current+=character;bytes+=size;}
  parts.push(current);return parts.join('\r\n');
}
// ICalendar serialization for a reading appointment. GET-192: the NEW ICS
// chrome (summary/description/alarm prose and validation messages) arrives as
// explicit pure label/formatter parameters from the UI caller at generation
// time; UID/UUID timing, times, escaping, folding, URL and rule bytes are
// unchanged, and no language event ever regenerates an artifact.
export function buildReadingCalendar(book,options,{origin,now=new Date(),labels}={}){
  const fail=id=>Object.assign(Error(id),{messageId:id});
  const {start,minutes,repeat='none',until,reminder=10,uid=crypto.randomUUID()}=options||{};
  const date=localDate(start,fail);
  if(!Number.isInteger(minutes)||minutes<5||minutes>240||!['none','daily','weekly'].includes(repeat)||!Number.isInteger(reminder)||reminder< -1||reminder>1440||typeof uid!=='string'||!/^[-A-Za-z0-9]{1,100}$/.test(uid))throw fail('reading.schedule.invalidOptions');
  const base=new URL(origin);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw fail('reading.schedule.invalidOrigin');
  if(typeof book?.bookId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(book.bookId))throw fail('reading.schedule.noBook');
  if(repeat!=='none'){
    if(typeof until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(until)||localDate(until+'T23:59',fail)<date)throw fail('reading.schedule.badRepeat');
  }
  const title=String(book.title?.zh||book.title?.en||'').slice(0,500),end=new Date(date.getTime()+minutes*60000),url=new URL('/read',base.origin);url.searchParams.set('book',book.bookId);
  const summary=labels?.summary?labels.summary(title):title,description=labels?.description?labels.description(title,minutes,url.href):url.href;
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Page by Page//Reading Calendar//ZH','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+uid+'@page-by-page','DTSTAMP:'+now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART:'+compact(start)+'00','DTEND:'+end.toISOString().slice(0,19).replace(/[-:]/g,''),'SUMMARY:'+escapeText(summary),'DESCRIPTION:'+escapeText(description),'URL:'+url.href,'TRANSP:OPAQUE'];
  if(repeat!=='none')lines.push('RRULE:FREQ='+repeat.toUpperCase()+';UNTIL='+until.replace(/-/g,'')+'T235959');
  if(reminder>=0)lines.push('BEGIN:VALARM','TRIGGER:'+(reminder?'-PT'+reminder+'M':'PT0M'),'ACTION:DISPLAY','DESCRIPTION:'+escapeText(labels?.alarm?labels.alarm(title):summary),'END:VALARM');
  lines.push('END:VEVENT','END:VCALENDAR');return lines.map(folded).join('\r\n')+'\r\n';
}
