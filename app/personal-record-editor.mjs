import {createReadingDraftStore} from './reading-draft-store.mjs';
import {personalRecordAnchor,personalRecordRevision} from './personal-records.mjs';

const acknowledged=(record,pending,book)=>!!pending&&record?.id===pending.id&&record.origin==='user'&&(record.bookId===undefined||record.bookId===book.bookId)&&record.contentVersion===pending.contentVersion&&record.passageId===pending.passageId&&record.text===pending.text&&record.lastEditId===pending.editId&&record.revision===pending.baseRevision+1;

export function createPersonalRecordRenderer({document,getBook,scope,api,onUpdate,onJump,storage,newId=()=>crypto.randomUUID()}){
  const edits=new Map();
  const formatter=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'});
  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const button=(text,action)=>{const node=el('button','quiet-button',text);node.type='button';node.addEventListener('click',event=>{event.stopPropagation();return action(event);});return node;};
  const persist=state=>{try{state.store.persist();return true;}catch{return false;}};
  const refresh=state=>{for(const view of state.views){if(view.row.isConnected)view.draw();else state.views.delete(view);}};
  function time(label,value){
    const valid=typeof value==='string'&&Number.isFinite(Date.parse(value)),node=el('time','',label+(valid?formatter.format(new Date(value)):'时间待确认'));
    if(valid){node.dateTime=value;node.title=value;}return node;
  }
  function recordNode(record,type,withAnchor=false){
    const book=getBook(),mapKey=[book.bookId,book.contentVersion,type,record.id].join('|'),row=el('section','saved-record');
    let current=record,state=edits.get(mapKey),area,trigger;
    const key=type+':'+record.passageId,kind=type==='question'?'问题':'原话';
    const view={row,draw};if(state)state.views.add(view);
    function draw(){
      row.replaceChildren();area=null;
      if(state&&personalRecordRevision(state.record)>personalRecordRevision(current))current=state.record;
      const anchor=personalRecordAnchor(current,book),own=current.origin==='user';
      if(withAnchor&&anchor)row.append(button((type==='question'?'问题':'想法')+' · §'+anchor.section,()=>onJump(current,type,anchor)));
      row.append(el('p','attribution',own?(type==='question'?'你的问题 · '+(current.status==='open'?'未解决':'状态待确认'):'你的原话'):'记录来源待确认'),el('p','',current.text));
      if(current.quote){row.append(el('p','attribution','当时引用 · '+(current.quoteOrigin==='original'?'原文':current.quoteOrigin==='translation'?'译文':'来源待确认')),el('blockquote','',current.quote));}
      row.append(time('创建 ',current.createdAt));if(personalRecordRevision(current)>0)row.append(time('修改 ',current.updatedAt));
      if(!anchor){row.append(el('p','form-status','原文位置待确认。原话与当时的引用已保留，尚未自动移动；核对来源后再修改。'));return;}
      if(!own)return;
      trigger=button('修改'+kind,()=>{
        try{
          if(!state){
            const store=createReadingDraftStore({storage:storage??document.defaultView.localStorage,scope:scope+'|'+[book.bookId,book.contentVersion,type,current.id].map(encodeURIComponent).join('|'),book,newId});store.activate(key);
            const pending=store.pending(key);if(acknowledged(current,pending,book)){store.reconcile(key,[current]);store.setEditBaseRevision(key,personalRecordRevision(current));store.persist();}
            if(!store.text(key)&&!store.pending(key)){store.setEditBaseRevision(key,personalRecordRevision(current));store.edit(key,current.text);}
            else if(store.editBaseRevision(key)===undefined&&Number.isSafeInteger(store.pending(key)?.baseRevision))store.setEditBaseRevision(key,store.pending(key).baseRevision);
            const conflict=!store.pending(key)&&store.editBaseRevision(key)!==personalRecordRevision(current);
            state={store,record:current,open:true,conflict,notice:conflict?'草稿基于较早或未确认的原话。请先读取较新原话，核对后再保存；你的草稿仍保留。':'',views:new Set([view])};edits.set(mapKey,state);
          }else{state.open=true;if(!state.store.text(key)&&!state.store.pending(key)){state.record=current;state.store.setEditBaseRevision(key,personalRecordRevision(current));state.store.edit(key,current.text);}}
          draw();area?.focus();
        }catch{row.append(el('p','form-status','修改草稿暂时无法安全读取，原数据已保留。请先另存本机待同步文字。'));}
      });trigger.dataset.editTrigger='true';
      if(!state?.open){row.append(trigger);if(state?.notice){const status=el('p','form-status',state.notice);status.setAttribute('role','status');row.append(status);}return;}
      const busy=state.store.busy(key),form=el('form','composer'),label=el('label','',type==='question'?'修改这个问题':'修改这条原话'),status=el('p','form-status',state.notice);
      area=el('textarea');area.id='record-edit-'+newId();area.maxLength=2000;area.value=state.store.text(key);label.htmlFor=area.id;
      const hint=el('p','form-status','修改草稿仅保留本机。导出前请先保存修改；原文、引用与创建时间保持不变。');
      const save=button(busy?'正在保存…':state.store.pending(key)?'重试上次修改':'保存修改',()=>{});save.type='submit';
      const cancel=button(state.store.pending(key)?'暂存并关闭':'取消修改',()=>{
        if(state.store.busy(key))return;
        if(state.store.pending(key)){state.open=false;state.notice='修改尚未确认，上次提交与新草稿仍保留，重新打开可重试确认；关闭不会撤回可能已提交的修改。';if(!persist(state))state.notice+=' 本机无法保留，请先复制文字。';draw();trigger?.focus();return;}
        state.store.discardPending(key);state.store.edit(key,'');const durable=persist(state);state.open=false;state.conflict=false;state.notice=durable?'修改已取消，已保存的原话未改变。':'已保存的原话未改变；本机草稿未能清理，刷新后可能仍会出现。';draw();trigger?.focus();
      });cancel.disabled=busy;
      const updateSave=()=>{save.disabled=state.store.busy(key)||state.conflict||!state.store.text(key).trim()&&!state.store.pending(key);};updateSave();
      area.addEventListener('input',()=>{state.store.edit(key,area.value);status.textContent=persist(state)?'修改草稿已留在本机，尚未保存到书房。':'本机无法保留修改草稿，请先复制文字；当前页面中的文字仍在。';updateSave();});
      status.setAttribute('role',state.conflict?'alert':'status');status.setAttribute('aria-live','polite');form.append(label,area,hint,save,cancel);
      if(state.conflict){
        const latest=button('读取较新'+kind,async()=>{
          latest.disabled=true;
          try{
            const fresh=await api('/api/records'),saved=fresh[type==='question'?'questions':'comments']?.find(value=>value.id===current.id);
            if(!saved||saved.origin!=='user'||!personalRecordAnchor(saved,book)||personalRecordRevision(saved)<personalRecordRevision(state.record))throw Error('较新记录暂时无法安全对应原文，草稿已保留。');
            state.store.discardPending(key);state.store.setEditBaseRevision(key,personalRecordRevision(saved));state.record=saved;current=saved;state.conflict=false;state.notice='已读取较新原话，修改草稿仍保留。核对后再次保存才会更新原话。';if(!persist(state))state.notice+=' 本机暂时无法保存草稿，请先复制。';onUpdate(saved,type);refresh(state);row.querySelector('textarea')?.focus();
          }catch(error){status.textContent=error.message||'读取暂时失败，草稿仍在。';status.setAttribute('role','alert');latest.disabled=false;}
        });form.append(latest);
      }
      form.append(status);row.append(form);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(state.store.busy(key)||state.conflict||!state.store.text(key).trim()&&!state.store.pending(key))return;
        const draftId=state.store.activeId(key),submission=state.store.begin(key,{passageId:state.record.passageId,contentVersion:state.record.contentVersion,baseRevision:state.store.editBaseRevision(key),editId:newId()},()=>current.id);
        const durable=persist(state);state.notice=durable?'正在保存修改。':'正在保存；本机无法保留草稿，请先复制文字。';refresh(state);
        let rejected=false;try{
          const saved=await api('/api/'+(type==='question'?'questions':'comments')+'/'+encodeURIComponent(current.id)+'/edit',{text:submission.text,contentVersion:submission.contentVersion,baseRevision:submission.baseRevision,editId:submission.editId});
          if(!acknowledged(saved,submission,book)||!state.store.acknowledge(key,saved,draftId))throw Error('服务尚未确认这次修改，上次提交与新草稿已保留。');
          state.store.setEditBaseRevision(key,personalRecordRevision(saved));state.record=saved;current=saved;onUpdate(saved,type);const retained=state.store.text(key)!=='';state.open=retained;state.notice=retained?'上次修改已确认；新写的草稿仍保留，核对后再保存。':'修改已保存到自己的书房。';if(!persist(state))state.notice+=' 本机草稿尚未能清理。';
        }catch(error){rejected=[400,413].includes(error.status);state.conflict=error.status===409;state.notice=(error.message||'修改暂时未确认')+(rejected?' 这次修改未保存，草稿仍保留；调整文字后可再次保存。':' 你的新文字与上次提交仍保留；可重试确认或先复制文字。');}
        finally{state.store.finish(key,draftId);if(rejected){state.store.discardPending(key);if(!persist(state))state.notice+=' 本机暂时无法保留，请先复制。';}refresh(state);if(row.isConnected)(row.querySelector('textarea')||row.querySelector('[data-edit-trigger]'))?.focus();}
      });
    }
    draw();return row;
  }
  return {recordNode};
}
