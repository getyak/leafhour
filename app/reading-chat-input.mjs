import {normalizeReadingChatQuote} from './reading-chat-quote.mjs';
const encoder=new TextEncoder(),LIMIT=24576;
const fail=()=>{throw Object.assign(Error('Conversation input budget exhausted'),{status:413});};
export function encodeReadingChatInput(job,{inputLabel='读者这次说：'}={}){
 const payload={location:{bookId:job.book.bookId,contentVersion:job.book.contentVersion,title:job.book.title,passageId:job.passageId,...(job.chapterId?{chapterId:job.chapterId}:{}),...(job.chapterTitle?{chapterTitle:job.chapterTitle}:{})},history:[],...(job.quote!==undefined?{selectedQuote:normalizeReadingChatQuote(job.quote)}:{})};
 const encode=()=>JSON.stringify(payload)+'\n\n'+inputLabel+'\n'+job.text;
 if(encoder.encode(encode()).length>LIMIT)fail();
 const groups=[];
 for(const message of (job.history||[]).filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string')){
  const row={role:message.role,content:message.content,...(message.role==='user'&&message.quote!==undefined?{selectedQuote:normalizeReadingChatQuote(message.quote)}:{})};
  if(row.role==='assistant'&&groups.at(-1)?.length===1&&groups.at(-1)[0].role==='user')groups.at(-1).push(row);else groups.push([row]);
 }
 const retained=groups.slice(-6);payload.history=retained.flat();
 while(encoder.encode(encode()).length>LIMIT&&retained.length){retained.shift();payload.history=retained.flat();}
 const result=encode();if(encoder.encode(result).length>LIMIT)fail();return result;
}
