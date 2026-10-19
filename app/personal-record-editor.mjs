import {createReadingDraftStore} from './reading-draft-store.mjs';
import {personalRecordAnchor,personalRecordRevision} from './personal-records.mjs';
import {t,getUiLocale,onUiLocaleChange} from './ui-locale.mjs';

const acknowledged=(record,pending,book)=>!!pending&&record?.id===pending.id&&record.origin==='user'&&(record.bookId===undefined||record.bookId===book.bookId)&&record.contentVersion===pending.contentVersion&&record.passageId===pending.passageId&&record.text===pending.text&&record.lastEditId===pending.editId&&record.revision===pending.baseRevision+1;

export function createPersonalRecordRenderer({document,getBook,scope,api,onUpdate,onJump,storage,newId=()=>crypto.randomUUID()}){
  const edits=new Map(),mountedViews=new Set(),formatters=new Map();
  let disposed=false,identity=null,epoch=0;
  const msg=(id,params)=>({id:'record.'+id,params});
  const format=value=>{
    if(Array.isArray(value))return value.map(format).join(' ');
    if(!value||typeof value!=='object')return value||'';
    if(value.time!==undefined){
      const locale=getUiLocale();if(!formatters.has(locale))formatters.set(locale,new Intl.DateTimeFormat(locale,{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}));
      return t(value.id,{time:value.time?formatters.get(locale).format(new Date(value.time)):t('record.timeUnconfirmed')});
    }
    return t(value.id,value.params);
  };
  const offLocale=onUiLocaleChange(()=>{
    for(const view of mountedViews){
      if(!view.row.isConnected){mountedViews.delete(view);continue;}
      for(const [node,value] of view.labels)node.textContent=format(value);
    }
  });
  const persist=state=>{try{state.store.persist();return true;}catch{return false;}};
  const refresh=state=>{for(const view of state.views){if(view.row.isConnected)view.draw();else state.views.delete(view);}};
  function recordNode(record,type,withAnchor=false){
    const book=getBook();if(disposed)throw Error('Record renderer is disposed');
    if(identity!==book){identity=book;epoch++;}
    const bookId=book.bookId,bookVersion=book.contentVersion,mapKey=[bookId,bookVersion,type,record.id].join('|'),row=document.createElement('section');row.className='saved-record';
    for(const old of mountedViews)if(!old.row.isConnected)mountedViews.delete(old);
    let current=record,state=edits.get(mapKey),area,trigger;
    const key=type+':'+record.passageId,kind=type==='question'?'question':'words';
    const view={row,draw,labels:new Map(),epoch,settle:null};mountedViews.add(view);if(state)state.views.add(view);
    const put=(node,value)=>{view.labels.set(node,value);node.textContent=format(value);};
    const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined){if(text&&typeof text==='object')put(node,text);else node.textContent=text;}return node;};
    const button=(text,action)=>{const node=el('button','quiet-button',text);node.type='button';node.addEventListener('click',event=>{event.stopPropagation();if(!disposed)return action(event);});return node;};
    const time=(id,value)=>{const valid=typeof value==='string'&&Number.isFinite(Date.parse(value)),node=el('time','',{id:'record.'+id,time:valid?value:null});if(valid){node.dateTime=value;node.title=value;}return node;};
    const active=stamp=>!disposed&&stamp===epoch&&getBook()?.bookId===bookId&&getBook()?.contentVersion===bookVersion;
    function draw(){
      if(disposed)return;view.settle=null;view.labels.clear();row.replaceChildren();area=null;
      if(state&&personalRecordRevision(state.record)>personalRecordRevision(current))current=state.record;
      const anchor=personalRecordAnchor(current,book),own=current.origin==='user';
      if(withAnchor&&anchor)row.append(button(msg(type==='question'?'anchor.question':'anchor.thought',{section:anchor.section}),()=>onJump(current,type,anchor)));
      row.append(el('p','attribution',msg(own?(type==='question'?(current.status==='open'?'own.question.open':'own.question.unknown'):'own.words'):'originUnknown')),el('p','',current.text));
      if(current.quote){row.append(el('p','attribution',msg(current.quoteOrigin==='original'?'quote.original':current.quoteOrigin==='translation'?'quote.translation':'quote.unknown')),el('blockquote','',current.quote));}
      row.append(time('created',current.createdAt));if(personalRecordRevision(current)>0)row.append(time('modified',current.updatedAt));
      if(!anchor){row.append(el('p','form-status',msg('anchorUnknown')));return;}
      if(!own)return;
      trigger=button(msg('edit.'+kind),()=>{
        try{
          if(!state){
            const store=createReadingDraftStore({storage:storage??document.defaultView.localStorage,scope:scope+'|'+[book.bookId,book.contentVersion,type,current.id].map(encodeURIComponent).join('|'),book,newId});store.activate(key);
            const pending=store.pending(key);if(acknowledged(current,pending,book)){store.reconcile(key,[current]);store.setEditBaseRevision(key,personalRecordRevision(current));store.persist();}
            if(!store.text(key)&&!store.pending(key)){store.setEditBaseRevision(key,personalRecordRevision(current));store.edit(key,current.text);}
            else if(store.editBaseRevision(key)===undefined&&Number.isSafeInteger(store.pending(key)?.baseRevision))store.setEditBaseRevision(key,store.pending(key).baseRevision);
            const conflict=!store.pending(key)&&store.editBaseRevision(key)!==personalRecordRevision(current);
            state={store,record:current,open:true,conflict,notice:conflict?msg('olderDraft'):'',views:new Set([view])};edits.set(mapKey,state);
          }else{state.open=true;if(!state.store.text(key)&&!state.store.pending(key)){state.record=current;state.store.setEditBaseRevision(key,personalRecordRevision(current));state.store.edit(key,current.text);}}
          draw();area?.focus();
        }catch{row.append(el('p','form-status',msg('draftUnavailable')));}
      });trigger.dataset.editTrigger='true';
      if(!state?.open){row.append(trigger);if(state?.notice){const status=el('p','form-status',state.notice);status.setAttribute('role','status');row.append(status);}return;}
      const busy=state.store.busy(key),form=el('form','composer'),label=el('label','',msg('label.'+kind)),status=el('p','form-status',state.notice);
      area=el('textarea');area.id='record-edit-'+newId();area.maxLength=2000;area.value=state.store.text(key);label.htmlFor=area.id;
      const hint=el('p','form-status',msg('editHint'));
      const save=button(msg(busy?'saving':state.store.pending(key)?'retry':'save'),()=>{});save.type='submit';
      const cancel=button(msg(state.store.pending(key)?'closePending':'cancel'),()=>{
        if(state.store.busy(key))return;
        if(state.store.pending(key)){state.open=false;state.notice=[msg('closedPending')];if(!persist(state))state.notice.push(msg('copyFirst'));draw();trigger?.focus();return;}
        state.store.discardPending(key);state.store.edit(key,'');const durable=persist(state);state.open=false;state.conflict=false;state.notice=msg(durable?'cancelled':'cancelNotDurable');draw();trigger?.focus();
      });cancel.disabled=busy;
      const updateSave=()=>{save.disabled=state.store.busy(key)||state.conflict||!state.store.text(key).trim()&&!state.store.pending(key);};updateSave();
      // Returning to this book may create a new editor while an older epoch's
      // save is still settling. Release only its existing busy chrome; keep
      // the new textarea, selection and draft intact, with an honest retry.
      view.settle=()=>{put(save,msg(state.store.busy(key)?'saving':state.store.pending(key)?'retry':'save'));cancel.disabled=state.store.busy(key);updateSave();put(status,state.notice);};
      area.addEventListener('input',()=>{state.store.edit(key,area.value);put(status,msg(persist(state)?'draftLocal':'draftNotDurable'));updateSave();});
      status.setAttribute('role',state.conflict?'alert':'status');status.setAttribute('aria-live','polite');form.append(label,area,hint,save,cancel);
      if(state.conflict){
        const latest=button(msg('reload.'+kind),async()=>{const stamp=epoch;
          latest.disabled=true;
          try{
            const fresh=await api('/api/records');if(!active(stamp))return;const saved=fresh[type==='question'?'questions':'comments']?.find(value=>value.id===current.id);
            if(!saved||saved.origin!=='user'||!personalRecordAnchor(saved,book)||personalRecordRevision(saved)<personalRecordRevision(state.record))throw Error('Latest record could not be matched safely');
            state.store.discardPending(key);state.store.setEditBaseRevision(key,personalRecordRevision(saved));state.record=saved;current=saved;state.conflict=false;state.notice=[msg('reloaded')];if(!persist(state))state.notice.push(msg('copyFirst'));onUpdate(saved,type);refresh(state);row.querySelector('textarea')?.focus();
          }catch{if(!active(stamp))return;put(status,msg('reloadFailed'));status.setAttribute('role','alert');latest.disabled=false;}
        });form.append(latest);
      }
      form.append(status);row.append(form);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(state.store.busy(key)||state.conflict||!state.store.text(key).trim()&&!state.store.pending(key))return;
        const stamp=epoch,draftId=state.store.activeId(key),submission=state.store.begin(key,{passageId:state.record.passageId,contentVersion:state.record.contentVersion,baseRevision:state.store.editBaseRevision(key),editId:newId()},()=>current.id);
        const durable=persist(state);state.notice=msg(durable?'savingNotice':'savingNotDurable');refresh(state);
        let rejected=false;try{
          const saved=await api('/api/'+(type==='question'?'questions':'comments')+'/'+encodeURIComponent(current.id)+'/edit',{text:submission.text,contentVersion:submission.contentVersion,baseRevision:submission.baseRevision,editId:submission.editId});
          if(!active(stamp))return;if(!acknowledged(saved,submission,book)||!state.store.acknowledge(key,saved,draftId))throw Error('Record edit acknowledgement is not confirmed');
          state.store.setEditBaseRevision(key,personalRecordRevision(saved));state.record=saved;current=saved;onUpdate(saved,type);const retained=state.store.text(key)!=='';state.open=retained;state.notice=[msg(retained?'savedWithDraft':'saved')];if(!persist(state))state.notice.push(msg('draftNotCleared'));
        }catch(error){if(!active(stamp))return;rejected=[400,413].includes(error.status);state.conflict=error.status===409;state.notice=msg(state.conflict?'conflict':rejected?'rejected':'unconfirmed');}
        finally{state.store.finish(key,draftId);if(active(stamp)){if(rejected){state.store.discardPending(key);if(!persist(state))state.notice=[state.notice,msg('copyFirst')];}refresh(state);if(row.isConnected)(row.querySelector('textarea')||row.querySelector('[data-edit-trigger]'))?.focus();}else if(!disposed){state.notice=msg('unconfirmed');for(const currentView of state.views)if(currentView.row.isConnected&&currentView.epoch===epoch)currentView.settle?.();}}
      });
    }
    draw();return row;
  }
  return {recordNode,unmount(){disposed=true;offLocale();mountedViews.clear();}};
}
