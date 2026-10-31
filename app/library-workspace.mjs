import {chooseCurrentBook} from './reading-calendar.mjs';
import {contentLanguage,matchesReadingLanguage} from './book-reading-languages.mjs';
const activityAt=book=>String(book.journey?.lastReadAt||book.resume?.updatedAt||'');
// Catalog creation is a build timestamp, not the reader adding that book.
const addedAt=book=>String(book.addedAt||(book.visibility==='private'?book.createdAt:'')||'');
const recentAt=book=>[activityAt(book),addedAt(book)].sort().at(-1)||'';
const publishedAt=book=>{const value=book.publicationYear??book.source?.publicationDate??book.publicationDate;const year=typeof value==='number'?value:typeof value==='string'&&/^-?\d{1,4}(?:-|$)/.test(value)?Number(value.match(/^-?\d{1,4}/)[0]):NaN;return Number.isFinite(year)?year:null;};
export function compareShelfBooks(a,b,sort='recent'){
 if(sort==='published-asc'||sort==='published-desc'){const left=publishedAt(a),right=publishedAt(b);if(left===null||right===null){if(left!==right)return left===null?1:-1;}else if(left!==right)return (left-right)*(sort==='published-desc'?-1:1);}
 if(sort==='manual')return (Number.isFinite(a.shelfPosition)||Number.isFinite(b.shelfPosition)?(a.shelfPosition??Number.MAX_SAFE_INTEGER)-(b.shelfPosition??Number.MAX_SAFE_INTEGER):0)||Number(b.visibility==='private')-Number(a.visibility==='private')||activityAt(b).localeCompare(activityAt(a));
 return (sort==='added'?addedAt(b).localeCompare(addedAt(a)):recentAt(b).localeCompare(recentAt(a)))||String(a.bookId).localeCompare(String(b.bookId));
}

export function currentReadingBookmark(books){
  return chooseCurrentBook(books.filter(book=>!book.personalizationPending&&typeof book.resume?.passageId==='string'&&book.resume.passageId))||null;
}

export function workspaceCurrentBook(books){
  return chooseCurrentBook(books)||books.filter(book=>book.resume||book.journey?.status==='finished').sort((a,b)=>activityAt(b).localeCompare(activityAt(a)))[0]||null;
}

export async function loadWorkspaceActivity(api,{month,date,timeZone}){
  const months=month===date.slice(0,7)?[...new Set([month,...readingWeek(date).map(day=>day.slice(0,7))])]:[month];
  const results=await Promise.all(months.map(value=>api('/api/library/activity?month='+value+'&timeZone='+encodeURIComponent(timeZone))));
  return {calendar:results[0],overview:month===date.slice(0,7)?{...results[0],days:results.flatMap(result=>result.days)}:null};
}

export function shelfReadingStatus(book){
  if(book.personalizationPending)return 'pending';
  if(book.journey?.status==='finished')return 'finished';
  return book.resume?.passageId||book.journey?.lastReadAt||book.journey?.completedChapters>0?'reading':'unread';
}

export const shelfLanguage=book=>contentLanguage(book.sourceLanguage);
export const hasShelfFilters=({scope='all',status='all',topic='all',language='all',form='all',query=''}={})=>scope!=='all'||status!=='all'||topic!=='all'||language!=='all'||form!=='all'||!!query.trim();

export function libraryShelf(books,{scope='all',query='',status='all',topic='all',language='all',form='all',sort='manual'}={},{searchText=()=>''}={}){
  const needle=query.trim().toLocaleLowerCase();
  return books.filter(book=>(scope==='all'||book.visibility===scope)&&(status==='all'||book.personalizationPending||shelfReadingStatus(book)===status)&&(topic==='all'||Array.isArray(book.topics)&&book.topics.includes(topic))&&(book.personalizationPending||matchesReadingLanguage(book,{language,form}))&&(!needle||[book.title?.zh,book.title?.en,book.author,searchText(book)].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a,b)=>compareShelfBooks(a,b,sort));
}

export function roomShelf(books,{selectedBookId,...filters}={},options={}){
  const filtered=libraryShelf(books,filters,options);
  const current=books.find(book=>book.bookId===selectedBookId)||workspaceCurrentBook(books);
  const featured=!hasShelfFilters(filters)&&filtered.some(book=>book.bookId===current?.bookId)?current:null;
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

// Read only the selected book's records, then expose one current user-authored question.
export function latestRoomQuestion(book,records){
  const passages=new Set(book.sections.flatMap(section=>section.paragraphs.map(p=>p.id)));
  let latest=null,latestAt=-Infinity;
  for(const question of records?.questions||[]){
    if(!question||question.bookId!==book.bookId||question.contentVersion!==book.contentVersion||question.origin!=='user'||!passages.has(question.passageId)||typeof question.id!=='string'||!question.id||question.id.length>128||typeof question.text!=='string'||!question.text.trim()||question.text.length>2000)continue;
    const createdAt=typeof question.createdAt==='string'?Date.parse(question.createdAt):NaN;
    if(Number.isFinite(createdAt)&&createdAt>=latestAt){latest=question;latestAt=createdAt;}
  }
  return latest?{id:latest.id,passageId:latest.passageId,text:latest.text}:null;
}

export function roomQuestionUrl(book,question){
  return readingBookUrl(book,{passageId:question.passageId})+'&note=question';
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
