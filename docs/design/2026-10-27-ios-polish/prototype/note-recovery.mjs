import {quoteIdentity} from './companion-context.mjs';

const layers=new Set(['source','literal','interpretive']);
function decodeQuote(key) {
  try {
    const values=JSON.parse(key);
    if(!Array.isArray(values)||values.length!==6||JSON.stringify(values)!==key)return null;
    const [passageId,version,layer,startUtf16,endUtf16,text]=values;
    const absent=startUtf16===null&&endUtf16===null;
    const range=Number.isSafeInteger(startUtf16)&&Number.isSafeInteger(endUtf16)&&startUtf16>=0&&endUtf16>startUtf16;
    if(typeof passageId!=='string'||!passageId||typeof version!=='string'||!version||!layers.has(layer)||typeof text!=='string'||!text.trim()||(!absent&&!range))return null;
    return {passageId,version,layer,startUtf16,endUtf16,text};
  }catch{return null;}
}

const splitsSurrogate=(text,offset)=>text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff&&text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff;
export function readNoteDrafts(drafts,{passages,version}) {
  if(!drafts||typeof drafts!=='object'||Array.isArray(drafts))return [];
  return Object.entries(drafts).flatMap(([key,text])=>{
    if(typeof text!=='string'||!text.trim())return [];
    const quote=decodeQuote(key);
    if(!quote||quote.version!==version)return [];
    const source=passages.find(p=>p.id===quote.passageId)?.[quote.layer];
    if(typeof source!=='string')return [];
    if(quote.startUtf16===null){if(!source.includes(quote.text))return [];}
    else if(quote.endUtf16>source.length||source.slice(quote.startUtf16,quote.endUtf16)!==quote.text||splitsSurrogate(source,quote.startUtf16)||splitsSurrogate(source,quote.endUtf16))return [];
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
