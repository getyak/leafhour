import {normalizeReadingChatQuote} from './reading-chat-quote.mjs';
export function encodeReadingChatInput(job,{inputLabel='读者这次说：',bounded=false}={}){
 const payload={location:job.book===null?{scope:'library',currentBook:null}:{bookId:job.book.bookId,contentVersion:job.book.contentVersion,title:job.book.title,passageId:job.passageId,...(job.chapterId?{chapterId:job.chapterId}:{}),...(job.chapterTitle?{chapterTitle:job.chapterTitle}:{})},history:[],...(job.quote!==undefined?{selectedQuote:normalizeReadingChatQuote(job.quote,{bounded})}:{})};
 const encode=()=>JSON.stringify(payload)+'\n\n'+inputLabel+'\n'+job.text;
 const groups=[];
 for(const message of (job.history||[]).filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string')){
  const row={role:message.role,content:message.content,...(message.role==='user'&&message.quote!==undefined?{selectedQuote:normalizeReadingChatQuote(message.quote,{bounded})}:{})};
  if(row.role==='assistant'&&groups.at(-1)?.length===1&&groups.at(-1)[0].role==='user')groups.at(-1).push(row);else groups.push([row]);
 }
 if(bounded){
  const size=()=>new TextEncoder().encode(encode()).length;
  if(size()>24576)throw Object.assign(Error('Conversation input budget exhausted'),{status:413});
  groups.splice(0,Math.max(0,groups.length-6));payload.history=groups.flat();
  while(size()>24576&&groups.length){groups.shift();payload.history=groups.flat();}
 }
 payload.history=groups.flat();
 return encode();
}
