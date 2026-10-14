import {normalizeReadingSession,mergeReadingSession} from './reading-session-record.mjs';
// Each live clock owns a unique session key. Other tabs only write receipts; they never
// replace a live producer's payload with their older in-memory copy. No storage lock assumed.
export function createReadingQueueStore({storage,scope,book}){
  const payloadPrefix=scope+'|session|',receiptPrefix=scope+'|receipt|',owned=new Set();let previous=[];
  const parse=value=>JSON.parse(value),legacy=()=>{const raw=storage.getItem(scope);if(raw===null)return [];const rows=parse(raw);if(!Array.isArray(rows)||rows.length>20)throw Error('原有待同步记录无法读取，原数据已保留。');return rows.map(row=>normalizeReadingSession(row,book));};
  const receipt=id=>{const raw=storage.getItem(receiptPrefix+id);if(raw===null)return 0;const value=Number(raw);if(!Number.isInteger(value)||value<1||value>10000000)throw Error('本机保存确认无法读取，原数据已保留。');return value;};
  function all(){const rows=new Map();for(const row of legacy())rows.set(row.id,row);const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k?.startsWith(payloadPrefix));for(const key of keys){const raw=storage.getItem(key);if(raw===null)continue;const row=normalizeReadingSession(parse(raw),book);if(key!==payloadPrefix+row.id)throw Error('待同步记录的标识不一致，原数据已保留。');rows.set(row.id,rows.has(row.id)?mergeReadingSession(rows.get(row.id),row):row);}return [...rows.values()].filter(row=>receipt(row.id)<row.sequence).sort((a,b)=>Number(owned.has(b.id))-Number(owned.has(a.id))||Date.parse(a.startedAt)-Date.parse(b.startedAt));}
  return {all,get pendingCount(){return all().length;},
    own(id){if(storage.getItem(payloadPrefix+id)!==null||legacy().some(row=>row.id===id))throw Error('这次阅读的标识已经使用，原记录保留。');owned.add(id);},
    load(){previous=all().slice(0,20);return structuredClone(previous);},
    save(next){
      const normalized=next.map(row=>normalizeReadingSession(row,book)),remaining=new Map(all().map(row=>[row.id,row]));
      for(const row of normalized){if(!owned.has(row.id)){if(!previous.some(old=>old.id===row.id&&old.sequence>=row.sequence)&&(remaining.get(row.id)?.sequence||0)<row.sequence)throw Error('只能保存当前阅读产生的时段。');continue;}if(receipt(row.id)>=row.sequence)continue;const raw=storage.getItem(payloadPrefix+row.id),old=raw===null?null:normalizeReadingSession(parse(raw),book);if(!remaining.has(row.id)&&remaining.size>=20)throw Error('已有 20 次阅读待同步，请先重试保存。');if(!old||old.sequence<=row.sequence){storage.setItem(payloadPrefix+row.id,JSON.stringify(row));remaining.set(row.id,row);}}
      for(const removed of previous.filter(row=>!normalized.some(r=>r.id===row.id))){const acknowledged=Math.max(receipt(removed.id),removed.sequence);storage.setItem(receiptPrefix+removed.id,String(acknowledged));const raw=storage.getItem(payloadPrefix+removed.id),current=raw===null?null:normalizeReadingSession(parse(raw),book);if(current?.status==='finished'&&current.sequence<=acknowledged){storage.removeItem(payloadPrefix+removed.id);if(!legacy().some(row=>row.id===removed.id))storage.removeItem(receiptPrefix+removed.id);}}
      previous=structuredClone(normalized);
    },
    matchesKey:key=>key===scope||key?.startsWith(payloadPrefix)||key?.startsWith(receiptPrefix),
    rawRecovery(){return Object.fromEntries(Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k===scope||k?.startsWith(payloadPrefix)||k?.startsWith(receiptPrefix)).map(k=>[k,storage.getItem(k)]));}
  };
}
