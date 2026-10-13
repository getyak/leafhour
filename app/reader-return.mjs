const bookKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const passageKey=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const noteKey=value=>['comment','question','records'].includes(value);
export function safeReaderReturn(value){
  if(typeof value!=='string'||value.length>1500||!value.startsWith('/')||value.startsWith('//'))return null;
  let url;try{url=new URL(value,'http://reader.local');}catch{return null;}
  const book=url.searchParams.get('book');if(url.origin!=='http://reader.local'||url.pathname!=='/read'||!bookKey(book))return null;
  const query=new URLSearchParams({book}),passage=url.searchParams.get('passage'),note=url.searchParams.get('note');
  if(passageKey(passage)){query.set('passage',passage);if(noteKey(note))query.set('note',note);else if(url.searchParams.get('action')==='translate')query.set('action','translate');}
  return '/read?'+query;
}
export function readerLoginUrl({bookId,passageId,note,action}){
  const query=new URLSearchParams({book:bookId});if(passageId)query.set('passage',passageId);if(note)query.set('note',note);if(action)query.set('action',action);
  const next=safeReaderReturn('/read?'+query),login=new URLSearchParams({login:'1'});if(next)login.set('next',next);return '/library?'+login;
}
export function resolveReaderEntry(book,query){
  if(query.get('book')!==book.bookId)return null;const id=query.get('passage');
  for(const section of book.sections)if(section.paragraphs.some(p=>p.id===id)){const note=noteKey(query.get('note'))?query.get('note'):null;return {chapterId:section.chapterId,passageId:id,offset:160,note,...(!note&&query.get('action')==='translate'?{action:'translate'}:{})};}
  return null;
}
