import {normalizeReadingSession,sameReadingSegments} from './reading-session-record.mjs';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function normalized(row,book){
 if(!object(row)||row.bookId!==book.bookId||row.contentVersion!==book.contentVersion)throw Error('Pending reading source changed');
 // These IDs validate the saved envelope only. The server verifies their real
 // membership in this exact source version; no canonical book is downloaded.
 const chapters=new Map();for(const anchor of [row.start,row.end]){
  if(!anchor||!/^[-\w]{1,128}$/.test(anchor.chapterId)||!/^[-\w]{1,128}$/.test(anchor.passageId))throw Error('Pending reading anchor is invalid');
  const ids=chapters.get(anchor.chapterId)||new Set();ids.add(anchor.passageId);chapters.set(anchor.chapterId,ids);
 }
 return normalizeReadingSession(row,{bookId:book.bookId,contentVersion:book.contentVersion,sections:[...chapters].map(([chapterId,ids])=>({chapterId,paragraphs:[...ids].map(id=>({id}))}))});
}
function matching(row,receipt){
 return object(receipt)&&['id','bookId','contentVersion','source','sequence','status','startedAt','endedAt','timeZone','durationSeconds'].every(key=>receipt[key]===row[key])&&['start','end'].every(key=>receipt[key]?.chapterId===row[key].chapterId&&receipt[key]?.passageId===row[key].passageId)&&sameReadingSegments(row.segments,receipt.segments);
}
export async function drainAccountReading({storage,owner,books,isCurrent,send,limit=20}){
 const result={sent:0,skipped:0,error:null};if(!storage||!owner||!isCurrent())return result;
 const prefix='marginalia-reading-outbox-v1|'+owner+'|',known=new Map(books.map(book=>[book.bookId,book])),tasks=[];
 try{
  const keys=Array.from({length:Math.min(storage.length,10000)},(_,i)=>storage.key(i)).filter(key=>key?.startsWith(prefix)&&key.slice(prefix.length).split('|')[1]!=='receipt');
  for(const key of keys){
   const suffix=key.slice(prefix.length),[bookId,type,id]=suffix.split('|'),book=known.get(bookId);
   if(!book||type==='receipt'||type&&type!=='session')continue;
   try{const raw=storage.getItem(key);if(raw===null)continue;const value=JSON.parse(raw),rows=type==='session'?[value]:value;if(!Array.isArray(rows)||rows.length>20)throw Error('Pending reading queue is unreadable');
    for(const saved of rows){const row=normalized(saved,book);if(type==='session'&&id!==row.id)throw Error('Pending reading key is inconsistent');const scope=prefix+bookId,receipt=Number(storage.getItem(scope+'|receipt|'+row.id)||0);if(!Number.isSafeInteger(receipt)||receipt<0)throw Error('Pending reading receipt is unreadable');if(receipt>=row.sequence)continue;tasks.push({key,scope,raw,row,legacy:type!=='session'});}
   }catch{result.skipped++;}
  }
  for(const task of tasks.slice(0,Math.min(20,Math.max(0,limit)))){
   if(!isCurrent())break;
   const receipt=await send(task.row.bookId,task.row);if(!isCurrent())break;
   if(!matching(task.row,receipt)){result.error=Error('Pending reading was not confirmed');break;}
   const raw=storage.getItem(task.key),latest=raw===null?[]:task.legacy?JSON.parse(raw):[JSON.parse(raw)];
   if(!Array.isArray(latest))throw Error('Pending reading changed during delivery');
   const sameSequence=latest.find(row=>row.id===task.row.id&&row.sequence===task.row.sequence);
   if(sameSequence&&!matching(task.row,normalized(sameSequence,known.get(task.row.bookId))))throw Error('Pending reading changed during delivery');
   // A receipt for N acknowledges N only, even if another tab has produced N+1.
   const receiptKey=task.scope+'|receipt|'+task.row.id,previous=Number(storage.getItem(receiptKey)||0);if(!Number.isSafeInteger(previous)||previous<0)throw Error('Pending reading receipt is unreadable');
   storage.setItem(receiptKey,String(Math.max(previous,task.row.sequence)));
   if(task.legacy&&raw!==null){const rows=JSON.parse(raw);if(Array.isArray(rows)){const next=rows.filter(row=>!(row.id===task.row.id&&row.sequence===task.row.sequence));if(next.length)storage.setItem(task.key,JSON.stringify(next));else storage.removeItem(task.key);}}
   else if(task.row.status==='finished'&&raw===task.raw)storage.removeItem(task.key);
   if(task.row.status==='finished'&&storage.getItem(task.scope+'|session|'+task.row.id)===null){const legacy=JSON.parse(storage.getItem(task.scope)||'[]');if(Array.isArray(legacy)&&!legacy.some(row=>row.id===task.row.id))storage.removeItem(receiptKey);}
   result.sent++;
  }
 }catch(error){result.error=error;}
 return result;
}
