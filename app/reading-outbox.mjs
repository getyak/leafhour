import {matchingSessionSnapshot} from './save-receipts.mjs';
const bad=message=>{throw Object.assign(Error(message),{status:400});};
const valid=row=>row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.id)&&Number.isInteger(row.sequence)&&row.sequence>0&&row.sequence<=10000000;
// load/save are synchronous owner-and-book-scoped persistence supplied by the caller.
export function createReadingOutbox({load,save,send}){
  const saved=load();if(!Array.isArray(saved)||saved.length>20||saved.some(row=>!valid(row))||new Set(saved.map(row=>row.id)).size!==saved.length)bad('本机待同步阅读记录无法读取，原数据已保留');
  let rows=structuredClone(saved),running=null;const confirmations=new Map();
  const persist=next=>{save(structuredClone(next));rows=next;};
  return {
    get size(){return rows.length;},
    confirmed:snapshot=>matchingSessionSnapshot(snapshot,confirmations.get(snapshot?.id)),
    refresh(){if(running)return false;const fresh=load();if(!Array.isArray(fresh)||fresh.length>20||fresh.some(row=>!valid(row))||new Set(fresh.map(row=>row.id)).size!==fresh.length)bad('本机待同步阅读记录无法读取，原数据已保留');rows=structuredClone(fresh);return true;},
    enqueue(row){
      if(!valid(row))bad('阅读快照不完整');const index=rows.findIndex(r=>r.id===row.id);
      if(index>=0&&rows[index].sequence>=row.sequence)return false;
      if(index<0&&rows.length>=20)bad('已有 20 次阅读待同步，请先重试保存，再开始新的时段');
      const next=structuredClone(rows);if(index<0)next.push(structuredClone(row));else next[index]=structuredClone(row);persist(next);return true;
    },
    flush(){
      if(running)return running;
      const work=async()=>{let sent=0,error=null;while(rows.length){const submitted=structuredClone(rows[0]);
        try{const receipt=await send(submitted);if(!receipt||receipt.id!==submitted.id||!Number.isInteger(receipt.sequence)||receipt.sequence<submitted.sequence)throw Object.assign(Error('服务尚未确认这次阅读，记录仍留在本机'),{status:502});confirmations.set(submitted.id,submitted);const index=rows.findIndex(row=>row.id===submitted.id);if(index>=0&&rows[index].sequence===submitted.sequence)persist(rows.filter((_,i)=>i!==index));sent++;}
        catch(failure){error=failure;break;}
      }return {sent,remaining:rows.length,error};};
      running=work();const completion=running;completion.finally(()=>{if(running===completion)running=null;}).catch(()=>{});return completion;
    }
  };
}
