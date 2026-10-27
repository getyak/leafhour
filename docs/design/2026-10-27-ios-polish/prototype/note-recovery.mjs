import {quoteIdentity} from './companion-context.mjs';

const layers=new Set(['source','literal','interpretive']);
function decodeQuote(key) {
  try {
    const values=JSON.parse(key);
    if(!Array.isArray(values)||values.length!==6)return null;
    const [passageId,version,layer,startUtf16,endUtf16,text]=values;
    const absent=startUtf16===null&&endUtf16===null;
    const range=Number.isSafeInteger(startUtf16)&&Number.isSafeInteger(endUtf16)&&startUtf16>=0&&endUtf16>=startUtf16;
    if(typeof passageId!=='string'||!passageId||typeof version!=='string'||!version||!layers.has(layer)||typeof text!=='string'||!text.trim()||(!absent&&!range))return null;
    return {passageId,version,layer,startUtf16,endUtf16,text};
  }catch{return null;}
}

export function readNoteDrafts(drafts,{passageIds,version}) {
  if(!drafts||typeof drafts!=='object'||Array.isArray(drafts))return [];
  return Object.entries(drafts).flatMap(([key,text])=>{
    if(typeof text!=='string'||!text.trim())return [];
    const quote=decodeQuote(key);
    if(!quote||quote.version!==version||!passageIds.includes(quote.passageId))return [];
    return [{key,quote,text}];
  });
}

export function undoNoteSave({notes,drafts,receipt}) {
  const unchanged=status=>({status,notes,drafts});
  if(!receipt?.note||typeof receipt.draftText!=='string'||!Array.isArray(notes))return unchanged('unavailable');
  const expected=receipt.note,key=quoteIdentity(expected.quote);
  if(expected.author!=='user'||receipt.draftText.trim()!==expected.text)return unchanged('unavailable');
  const index=notes.findIndex(note=>note.id===expected.id);
  if(!expected.id||index<0||!decodeQuote(key))return unchanged('unavailable');
  const actual=notes[index];
  if(actual.author!=='user'||actual.text!==expected.text||quoteIdentity(actual.quote)!==key)return unchanged('unavailable');
  const current=drafts?.[key];
  if(current!=null&&(typeof current!=='string'||current.trim()&&current!==receipt.draftText))return unchanged('conflict');
  return {status:'undone',notes:notes.filter((_,i)=>i!==index),drafts:{...drafts,[key]:receipt.draftText},quote:{...expected.quote}};
}
