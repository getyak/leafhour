import {createNoteDrafts} from './note-drafts.mjs';

const keys=storage=>Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(Boolean);
const clone=value=>structuredClone(value);
function draftAnchor(key,book){
  const match=/^(comment|question):(.+)$/.exec(key||'');
  if(!match||!book.sections.some(s=>s.paragraphs.some(p=>p.id===match[2])))throw Error('草稿无法对应这本书的原文，原数据已保留。');
  return {type:match[1],passageId:match[2]};
}
export function validateReadingDraftBackup(value,book){
  if(!value||value.version!==1||!Array.isArray(value.entries)||value.entries.length>200)throw Error('本机阅读草稿格式不完整。');
  const ids=new Set();
  for(const row of value.entries){
    draftAnchor(row?.key,book);
    if(typeof row.id!=='string'||!row.id||row.id.length>500||ids.has(row.id)||typeof row.text!=='string'||row.text.length>2000||!Number.isInteger(row.revision)||row.revision<1||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('本机阅读草稿的标识、文字或时间不完整。');
    if(row.editBaseRevision!==undefined&&(!Number.isSafeInteger(row.editBaseRevision)||row.editBaseRevision<0))throw Error('修改草稿的原始版本不正确。');
    const checked=createNoteDrafts({version:1,entries:{[row.key]:row}}).snapshot().entries[row.key];
    if(row.pending!==null&&(!checked?.pending||JSON.stringify(checked.pending)!==JSON.stringify(row.pending))||row.pending?.contentVersion!==undefined&&row.pending.contentVersion!==book.contentVersion)throw Error('草稿中的待确认提交无法对应原文。');
    ids.add(row.id);
  }
  return value;
}

// A tab owns its draft payload. Taking over another tab's exact revision creates a
// new payload first; a revision-specific receipt then hides only that old copy.
// If its original tab keeps typing, its next revision remains a separate draft.
export function createReadingDraftStore({storage,scope,book,newId=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}){
  const prefix=scope+'|draft|',retiredPrefix=scope+'|retired|',active=new Map(),owned=new Map(),retirements=new Map();
  const retired=row=>storage.getItem(retiredPrefix+encodeURIComponent(row.id)+'|'+row.revision)!==null;
  const read=()=>{
    const rows=new Map(),sources=[{scope,prefix:'legacy:'}];
    if(scope.startsWith('marginalia-reading-ending-drafts-v1')){const v2=scope.replace('marginalia-reading-ending-drafts-v1','marginalia-focus-drafts-v2'),v1=scope.replace('marginalia-reading-ending-drafts-v1','marginalia-focus-drafts-v1');sources.push(storage.getItem(v2)!==null?{scope:v2,prefix:'legacy-focus-v2:'}:{scope:v1,prefix:'legacy-focus-v1:'});}
    for(const source of sources){const raw=storage.getItem(source.scope);if(raw===null)continue;const parsed=JSON.parse(raw),legacy=createNoteDrafts(parsed?.version===1?parsed:null,parsed?.version===1?{}:parsed).snapshot();for(const [key,value]of Object.entries(legacy.entries)){
      draftAnchor(key,book);const id=source.prefix+key;rows.set(id,{id,key,...value,revision:1,updatedAt:'1970-01-01T00:00:00.000Z'});
    }}
    for(const key of keys(storage).filter(k=>k.startsWith(prefix))){const row=JSON.parse(storage.getItem(key));validateReadingDraftBackup({version:1,entries:[row]},book);if(key!==prefix+encodeURIComponent(row.id))throw Error('草稿的本机标识不一致，原数据已保留。');rows.set(row.id,row);}
    for(const [id,state]of owned)if(state.dirty)rows.set(id,{...state.row,...state.model.snapshot().entries[state.row.key]});
    return [...rows.values()].filter(row=>(row.text.trim()||row.pending)&&!retired(row)).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
  };
  function activate(key,id){
    draftAnchor(key,book);
    if(id===undefined&&active.has(key))return;
    const rows=read(),source=id?rows.find(r=>r.id===id&&r.key===key):rows.find(r=>r.key===key);
    if(id&&!source)throw Error('这份草稿已更新，请重新打开草稿列表。');
    if(source&&owned.has(source.id)){active.set(key,source.id);return;}
    const row={id:newId(),key,text:source?.text||'',pending:source?.pending||null,revision:1,updatedAt:now(),...(source?.editBaseRevision!==undefined?{editBaseRevision:source.editBaseRevision}:{})};
    owned.set(row.id,{row,model:createNoteDrafts({version:1,entries:{[key]:row}}),dirty:!!source});active.set(key,row.id);
    if(source)retirements.set(row.id,source);
  }
  const state=key=>{if(!active.has(key))activate(key);return owned.get(active.get(key));};
  const change=(key,fn)=>{const item=state(key),result=fn(item.model);item.dirty=true;return result;};
  function persist(){
    for(const item of owned.values())if(item.dirty){
      const row={...item.row,...item.model.snapshot().entries[item.row.key],revision:item.row.revision+1,updatedAt:now()};
      if(read().length>200&&!storage.getItem(prefix+encodeURIComponent(row.id))&&!retirements.has(row.id))throw Error('本机草稿较多，请先保存或导出已有草稿。');
      storage.setItem(prefix+encodeURIComponent(row.id),JSON.stringify(row));item.row=row;item.dirty=false;
    }
    for(const [id,source]of retirements)if(!owned.get(id).dirty&&storage.getItem(prefix+encodeURIComponent(id))!==null){storage.setItem(retiredPrefix+encodeURIComponent(source.id)+'|'+source.revision,'1');retirements.delete(id);}
    return true;
  }
  read();
  return {
    activate,persist,list:()=>clone(read()),memoryRecovery:()=>clone([...owned.values()].map(item=>({...item.row,...item.model.snapshot().entries[item.row.key]})).filter(row=>row.text.trim()||row.pending)),
    activeId:key=>active.get(key),text:key=>state(key).model.text(key),pending:key=>state(key).model.pending(key),busy:key=>state(key).model.busy(key),
    editBaseRevision:key=>state(key).model.editBaseRevision(key),setEditBaseRevision:(key,revision)=>change(key,m=>m.setEditBaseRevision(key,revision)),
    edit:(key,text)=>change(key,m=>m.edit(key,text)),begin:(key,payload,id)=>change(key,m=>m.begin(key,payload,id)),discardPending:key=>change(key,m=>m.discardPending(key)),
    acknowledge:(key,record,id)=>{const item=id?owned.get(id):state(key);const result=item.model.acknowledge(key,record);if(result)item.dirty=true;return result;},finish:(key,id)=>(id?owned.get(id):state(key)).model.finish(key),
    reconcile:(key,records)=>{const item=state(key),result=item.model.reconcile(key,records);if(result)item.dirty=true;return result;},
    import(entries){
      validateReadingDraftBackup({version:1,entries},book);const existing=read(),next=[];
      for(const input of entries){if([...existing,...next].some(r=>r.key===input.key&&r.text===input.text&&JSON.stringify(r.pending)===JSON.stringify(input.pending)))continue;const occupied=storage.getItem(prefix+encodeURIComponent(input.id))!==null||input.id.startsWith('legacy:');next.push({...clone(input),id:occupied?newId():input.id});}
      if(existing.length+next.length>200)throw Error('本机草稿较多，请先保存或导出已有草稿。');
      for(const row of next)storage.setItem(prefix+encodeURIComponent(row.id),JSON.stringify(row));
    },
    matchesKey:key=>key===scope||key?.startsWith(prefix)||key?.startsWith(retiredPrefix),
    rawRecovery:()=>Object.fromEntries(keys(storage).filter(k=>k===scope||k.startsWith(prefix)||k.startsWith(retiredPrefix)).map(k=>[k,storage.getItem(k)]))
  };
}
