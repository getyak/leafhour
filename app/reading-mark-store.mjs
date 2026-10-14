import {normalizeReadingMilestone} from './reading-session-record.mjs';
export function createReadingMarkStore({storage,scope,book}){
  const prefix=scope+'|intent|',receiptPrefix=scope+'|confirmed|';let previous=[];
  const all=()=>{
    const raw=storage.getItem(scope),legacy=raw===null?[]:JSON.parse(raw);if(!Array.isArray(legacy)||legacy.length>100)throw Error('本机待确认标记无法读取，原数据已保留。');
    const rows=new Map(legacy.map(input=>{const row=normalizeReadingMilestone(input,book);return [row.id,row];}));
    const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(prefix));
    for(const key of keys){const row=normalizeReadingMilestone(JSON.parse(storage.getItem(key)),book);if(key!==prefix+encodeURIComponent(row.id))throw Error('标记的本机标识不一致。');rows.set(row.id,row);}
    return [...rows.values()].filter(row=>storage.getItem(receiptPrefix+encodeURIComponent(row.id))===null).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  };
  return {all,load(){previous=all();return structuredClone(previous);},save(next){
    const rows=next.map(row=>normalizeReadingMilestone(row,book));
    for(const row of rows){const key=prefix+encodeURIComponent(row.id),raw=storage.getItem(key);if(raw===null){if(all().length>=100)throw Error('待确认标记较多，请先重试。');storage.setItem(key,JSON.stringify(row));}else if(JSON.stringify(JSON.parse(raw))!==JSON.stringify(row))throw Error('待确认标记不能替换成另一项操作。');}
    for(const row of previous.filter(old=>!rows.some(next=>next.id===old.id)))storage.setItem(receiptPrefix+encodeURIComponent(row.id),'1');previous=structuredClone(rows);
  },matchesKey:key=>key===scope||key?.startsWith(prefix)||key?.startsWith(receiptPrefix),rawRecovery:()=>Object.fromEntries(Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k===scope||k?.startsWith(prefix)||k?.startsWith(receiptPrefix)).map(k=>[k,storage.getItem(k)]))};
}
