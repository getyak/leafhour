const validText=(value,max)=>typeof value==='string'&&value.length<=max;
const validPending=(value,key)=>value&&validText(value.id,128)&&value.id&&validText(value.passageId,256)&&key.endsWith(':'+value.passageId)&&validText(value.text,2000)&&value.text.trim();
const boundedPayload=value=>{const payload=structuredClone(value);if(!validText(payload.quote,4000))delete payload.quote;return payload;};
export function createNoteDrafts(saved,legacy={}){
  const entries=new Map(),saving=new Set(),source=saved?.version===1&&saved.entries&&typeof saved.entries==='object'?saved.entries:legacy;
  for(const [key,value]of Object.entries(source||{})){
    if(!/^(comment|question):/.test(key))continue;
    const text=typeof value==='string'?value:value?.text;if(!validText(text,2000))continue;
    entries.set(key,{text,pending:validPending(value?.pending,key)?boundedPayload(value.pending):null});
  }
  const entry=key=>{if(!entries.has(key))entries.set(key,{text:'',pending:null});return entries.get(key);};
  const acknowledge=(key,record)=>{
    const draft=entry(key),pending=draft.pending;
    if(!pending||pending.id!==record.id||pending.text!==record.text||pending.passageId!==record.passageId)return false;
    if(draft.text===pending.text)draft.text='';draft.pending=null;return true;
  };
  return {
    text:key=>entries.get(key)?.text||'',
    pending:key=>entries.get(key)?.pending?structuredClone(entries.get(key).pending):null,
    busy:key=>saving.has(key),
    edit(key,text){if(!validText(text,2000))throw Error('文字过长');entry(key).text=text;},
    begin(key,payload,newId){
      if(saving.has(key))throw Error('这条记录正在保存');const draft=entry(key);
      if(!draft.pending){if(!draft.text.trim())throw Error('请先写下自己的想法');draft.pending={...boundedPayload(payload),id:newId(),text:draft.text};}
      saving.add(key);return structuredClone(draft.pending);
    },
    acknowledge,
    finish:key=>saving.delete(key),
    reconcile(key,records){if(saving.has(key))return false;const pending=entries.get(key)?.pending;if(!pending)return false;const record=records.find(r=>r.id===pending.id&&r.text===pending.text&&r.passageId===pending.passageId);return !!record&&acknowledge(key,record);},
    snapshot:()=>({version:1,entries:Object.fromEntries([...entries].map(([key,value])=>[key,structuredClone(value)]))})
  };
}
