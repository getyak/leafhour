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

export function roomShelf(books,{scope='all',query='',selectedBookId}={}){
  const filtered=libraryShelf(books,{scope,query});
  const current=books.find(book=>book.bookId===selectedBookId)||workspaceCurrentBook(books);
  const featured=!query.trim()&&filtered.some(book=>book.bookId===current?.bookId)?current:null;
  return {featured,books:filtered.filter(book=>book!==featured),total:filtered.length};
}

export function roomExcerpt(book,passageId){
  const rows=book.sections.flatMap(section=>section.paragraphs.map(p=>({...p,chapterId:section.chapterId})));
  const chapter=book.chapters.find(c=>['body','chapter'].includes(c.kind))||book.chapters.find(c=>!String(c.kind).startsWith('front'))||book.chapters[0];
  const id=passageId||book.readingStart?.passageId||chapter?.startPassageId;
  const paragraph=id?rows.find(p=>p.id===id):rows.find(p=>p.chapterId===chapter?.id&&p.kind!=='source_heading');
  if(!paragraph)throw Object.assign(Error('找不到这段原文，请重新选择段落。'),{status:404});
  const selectedChapter=book.chapters.find(c=>c.id===paragraph.chapterId);
  let truncated=false;
  const bounded=text=>{if(typeof text!=='string'||!text)return null;if(text.length<=6000)return text;truncated=true;let end=6000;if(text.charCodeAt(end-1)>=0xD800&&text.charCodeAt(end-1)<=0xDBFF)end--;return text.slice(0,end);};
  return {bookId:book.bookId,contentVersion:book.contentVersion,passageId:paragraph.id,chapterId:paragraph.chapterId,chapterTitle:selectedChapter?.title||null,original:bounded(paragraph.original),literal:bounded(paragraph.translations?.literal?.text),interpretive:bounded(paragraph.translations?.interpretive?.text),translationStatus:{literal:paragraph.translations?.literal?.status||'missing',interpretive:paragraph.translations?.interpretive?.status||'missing'},truncated};
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
