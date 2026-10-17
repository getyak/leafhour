export function createReadingBook({book,readChapter,onContent=()=>{}}){
 const loaded=new Set(book.reading?.loadedChapters||book.chapters.map(c=>c.id)),pending=new Map();
 function ensure(id){
  if(!book.chapters.some(c=>c.id===id))return Promise.reject(Error('找不到这一章'));
  if(loaded.has(id))return Promise.resolve();
  if(pending.has(id))return pending.get(id);
  const task=Promise.resolve().then(()=>readChapter(id,book.contentVersion)).then(result=>{
   const expected=book.sections.filter(s=>s.chapterId===id);
   if(result?.bookId!==book.bookId||result.contentVersion!==book.contentVersion||result.chapterId!==id||!Array.isArray(result.sections)||result.sections.length!==expected.length)throw Error('章节版本无法核对，请重新打开这本书');
   for(let i=0;i<expected.length;i++){
    const section=result.sections[i],ids=expected[i].paragraphs.map(p=>p.id);
    if(section.chapterId!==id||section.number!==expected[i].number||!Array.isArray(section.paragraphs)||section.paragraphs.length!==ids.length||section.paragraphs.some((p,n)=>p.id!==ids[n]||p.unloaded||typeof p.original!=='string'))throw Error('章节原文不完整，请重试读取');
   }
   book.sections=book.sections.map(s=>s.chapterId===id?result.sections.find(row=>row.number===s.number):s);loaded.add(id);
   if(book.reading)book.reading.loadedChapters=[...loaded];onContent(id);
  }).finally(()=>pending.delete(id));pending.set(id,task);return task;
 }
 return {ensure,isLoaded:id=>loaded.has(id)};
}

export function createReadingNavigation({isLoaded,ensure,commit,onPending=()=>{},onError=()=>{}}){
 let generation=0;
 function begin(){const ticket=++generation;return ()=>ticket===generation;}
 return {begin,navigate(id,target,{current=begin(),validate=()=>true}={}){
  if(!current())return Promise.resolve(false);
  const finish=()=>{if(!current()||!validate())return false;commit(id,target);return true;};
  if(isLoaded(id))return Promise.resolve(finish());
  onPending(id);
  return ensure(id).then(finish,error=>{if(current())onError(error);return false;});
 },invalidate(){generation++;}};
}
