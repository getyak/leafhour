import {chooseCurrentBook} from './reading-calendar.mjs';
const activityAt=book=>String(book.journey?.lastReadAt||book.resume?.updatedAt||'');

export function workspaceCurrentBook(books){
  return chooseCurrentBook(books)||books.filter(book=>book.resume||book.journey?.status==='finished').sort((a,b)=>activityAt(b).localeCompare(activityAt(a)))[0]||null;
}

export async function loadWorkspaceActivity(api,{month,date,timeZone}){
  const months=month===date.slice(0,7)?[...new Set([month,...readingWeek(date).map(day=>day.slice(0,7))])]:[month];
  const results=await Promise.all(months.map(value=>api('/api/library/activity?month='+value+'&timeZone='+encodeURIComponent(timeZone))));
  return {calendar:results[0],overview:month===date.slice(0,7)?{...results[0],days:results.flatMap(result=>result.days)}:null};
}

export function libraryShelf(books,{scope='all',query=''}={}){
  const needle=query.trim().toLocaleLowerCase();
  return books.filter(book=>(scope!=='private'||book.visibility==='private')&&(!needle||[book.title?.zh,book.title?.en,book.author].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a,b)=>Number(b.visibility==='private')-Number(a.visibility==='private')||activityAt(b).localeCompare(activityAt(a)));
}

export function readingBookUrl(book,resume=book.resume){
  const query=new URLSearchParams({book:book.bookId});
  if(resume?.passageId)query.set('passage',resume.passageId);
  return '/read?'+query;
}

export function readingWeek(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日期不正确。');
  const day=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date)throw Error('日期不正确。');
  day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
  return Array.from({length:7},(_,offset)=>{const value=new Date(day);value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);});
}

export function latestReadingEntry(data){
  return (data?.days||[]).flatMap(day=>day.details||[]).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0]||null;
}
