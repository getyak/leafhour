import {READING_CHAT_SCOPES,readChatScope} from './reading-chat-scope.mjs';
export const CHAT_TEXT_LIMIT=2000;

// Async tickets are scoped to both the account and the selected book. Stopping a
// run changes its operation ticket before a late send response can be applied.
export function createLibraryChatState({readDraft=()=>'',writeDraft=()=>{},readPending=()=>null,writePending=()=>{},makeId=()=>crypto.randomUUID()}={}){
  let epoch=0,loadSequence=0,operation=0,scopeOperation=0;
  let state={owner:null,bookId:null,draft:'',data:null,turns:[],phase:'idle',loadError:'',pending:null,retry:null,notice:'',scopePending:null,scopeUnconfirmed:false};
  const current=ticket=>!!ticket&&ticket.epoch===epoch&&ticket.owner===state.owner&&ticket.bookId===state.bookId;
  const ticket=extra=>({epoch,owner:state.owner,bookId:state.bookId,...extra});
  const persist=()=>{if(!state.owner||!state.bookId)return false;try{writeDraft(state.owner,state.bookId,state.draft);return true;}catch{return false;}};
  const payloadFor=turn=>({id:turn.id,passageId:turn.passageId,text:turn.text,contentVersion:turn.contentVersion,...(turn.scopeRevision!==undefined?{scopeRevision:turn.scopeRevision}:{})});
  const persistPending=record=>{if(state.owner&&state.bookId&&typeof record?.draftText==='string')try{writePending(state.owner,state.bookId,{schemaVersion:1,owner:state.owner,bookId:state.bookId,payload:payloadFor(record.payload),draftText:record.draftText});}catch{}};
  const clearPending=payload=>{if(state.owner&&state.bookId)try{const saved=readPending(state.owner,state.bookId);if(!saved||saved.payload?.id===payload.id)writePending(state.owner,state.bookId,null);}catch{}};
  function restoredPending(owner,bookId){
    let saved;try{saved=readPending(owner,bookId);}catch{return null;}
    const p=saved?.payload;
    if(saved?.schemaVersion!==1||saved.owner!==owner||saved.bookId!==bookId||typeof saved.draftText!=='string'||saved.draftText.length>CHAT_TEXT_LIMIT||typeof p?.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(p.id)||typeof p.text!=='string'||!p.text.trim()||p.text.length>CHAT_TEXT_LIMIT||saved.draftText.trim()!==p.text||typeof p.passageId!=='string'||!p.passageId||p.passageId.length>128||typeof p.contentVersion!=='string'||!p.contentVersion||p.contentVersion.length>256||p.scopeRevision!==undefined&&(!Number.isSafeInteger(p.scopeRevision)||p.scopeRevision<0))return null;
    return {payload:payloadFor(p),draftText:saved.draftText,uncertain:true,checked:false};
  }
  function clearExactDraft(snapshot){
    if(typeof snapshot!=='string')return true;
    // A different tab may have saved a later draft while this request ran.
    let latest,readable=false;try{latest=readDraft(state.owner,state.bookId);readable=typeof latest==='string';}catch{}
    if(state.draft!==snapshot)return !readable||latest===snapshot?persist():true;
    if(readable&&latest!==snapshot){state.draft=latest;return true;}
    state.draft='';return persist();
  }
  const restore=text=>{if(!state.draft){state.draft=text;persist();}};
  const putTurn=turn=>{const index=state.turns.findIndex(t=>t.id===turn.id);state.turns=index<0?[...state.turns,turn]:state.turns.map((t,i)=>i===index?turn:t);};
  const validText=()=>!!state.draft.trim()&&state.draft.length<=CHAT_TEXT_LIMIT;
  const canSend=()=>!!state.owner&&!!state.bookId&&state.phase==='ready'&&state.data?.available===true&&!!state.data.context?.passageId&&!state.pending&&!state.scopePending&&!state.scopeUnconfirmed&&(state.retry?.uncertain?state.retry.checked&&state.data.context.passageId===state.retry.payload.passageId:validText());
  function finish(turn){
    const pending=state.pending,tracked=pending?.id===turn.id?pending:state.retry?.payload.id===turn.id?state.retry:null;putTurn(turn);
    if(turn.status==='running'){
      state.pending={...(pending||{}),id:turn.id,text:turn.text,payload:payloadFor(turn),draftText:tracked?.draftText??null,status:'running'};persistPending(state.pending);return;
    }
    state.pending=null;
    if(turn.status==='completed'){
      if(clearExactDraft(tracked?.draftText))clearPending(payloadFor(turn));state.retry=null;state.notice='';
    }else{
      clearPending(payloadFor(turn));
      restore(turn.text);state.retry={payload:payloadFor(turn),draftText:tracked?.draftText??turn.text,uncertain:false,checked:true};state.notice=turn.status==='cancelled'?'已停止。问题已放回输入框，可以修改后再问。':'这次没有得到回答。问题已保留，可以再试一次。';
    }
  }
  return {
    view:()=>({...state,canSend:canSend()}),
    setContext(owner,bookId){
      owner=owner||null;bookId=bookId||null;if(owner===state.owner&&bookId===state.bookId)return false;
      epoch++;operation++;let draft='';if(owner&&bookId)try{draft=String(readDraft(owner,bookId)||'');}catch{}
      const retry=owner&&bookId?restoredPending(owner,bookId):null;
      state={owner,bookId,draft,data:null,turns:[],phase:'idle',loadError:'',pending:null,retry,notice:retry?'正在确认上次提问的进度…':'',scopePending:null,scopeUnconfirmed:false};return true;
    },
    reset(){epoch++;operation++;state={owner:null,bookId:null,draft:'',data:null,turns:[],phase:'idle',loadError:'',pending:null,retry:null,notice:'',scopePending:null,scopeUnconfirmed:false};},
    setDraft(text){state.draft=String(text);persist();},
    beginLoad({passageId}={}){if(!state.owner||!state.bookId)return null;loadSequence++;state.loadError='';if(passageId&&state.data?.context?.passageId!==passageId)state.data=null;state.phase='loading';return ticket({loadSequence});},
    resolveLoad(request,data){
      if(!current(request)||request.loadSequence!==loadSequence)return false;
      if(!data||data.bookId!==state.bookId||!Array.isArray(data.turns)){state.phase=state.data?'ready':'error';state.loadError='这本书的对话暂时无法载入，请重试。';return false;}
      if(data.scope!==undefined)try{readChatScope(data.scope);}catch{state.scopeUnconfirmed=true;state.phase='error';state.loadError='查阅范围尚未确认，请重新载入；问题仍保留。';return false;}
      const scopeWasUnconfirmed=state.scopeUnconfirmed;if(data.scope!==undefined&&!state.scopePending)state.scopeUnconfirmed=false;
      const previous=state.turns;state.data=data;state.phase='ready';state.loadError='';
      if(scopeWasUnconfirmed&&!state.scopeUnconfirmed)state.notice='已重新读取当前范围，请核对后再发送；问题仍保留。';
      state.turns=data.turns.map(turn=>{const local=previous.find(t=>t.id===turn.id);return turn.status==='running'&&local&&local.status!=='running'?local:turn;});
      const target=state.pending?.id||state.retry?.payload.id,recovered=target&&state.turns.find(t=>t.id===target);
      if(recovered&&state.pending?.status!=='stopping')finish(recovered);
      else if(!state.pending&&state.retry?.uncertain){const changed=state.retry.payload.contentVersion!==data.contentVersion,unavailable=data.available===false;state.retry={...state.retry,uncertain:!changed&&!unavailable,checked:true};if(changed||unavailable)clearPending(state.retry.payload);state.notice=unavailable?'阅读助手暂时不可用，问题已保留，可以继续修改。':changed?'原文版本已更新。问题已保留，再次发送会按当前原文提问。':'暂未收到回答。可以继续这次提问，已有结果会优先恢复。';}
      if(!state.pending){const running=state.turns.find(t=>t.status==='running'&&t.kind!=='companion');if(running)finish(running);}
      if(state.pending&&!state.turns.some(t=>t.id===state.pending.id)){const local=previous.find(t=>t.id===state.pending.id);if(local)state.turns.push(local);}
      return true;
    },
    rejectLoad(request,error){if(!current(request)||request.loadSequence!==loadSequence)return false;state.phase=state.data?'ready':'error';state.loadError=error?.message||'对话暂时无法载入，请重试。';return true;},
    beginScopeChange(mode){
      if(!READING_CHAT_SCOPES.includes(mode)||!state.data?.scope||state.phase!=='ready'||state.pending||state.retry?.uncertain||state.scopePending||state.scopeUnconfirmed)return null;
      const scope=readChatScope(state.data.scope),request=ticket({scopeOperation:++scopeOperation});
      state.scopePending={...request,mode,baseRevision:scope.revision,previousMode:scope.mode};state.notice='正在保存查阅范围，问题尚未发送。';
      return {ticket:request,payload:{mode,baseRevision:scope.revision}};
    },
    resolveScopeChange(request,value){
      if(!current(request)||request.scopeOperation!==state.scopePending?.scopeOperation)return false;
      const pending=state.scopePending;state.scopePending=null;let scope;try{scope=readChatScope(value);}catch{}
      if(!scope||scope.mode!==pending.mode||scope.revision!==pending.baseRevision+(pending.mode===pending.previousMode?0:1)){state.scopeUnconfirmed=true;state.notice='范围设置尚未确认，请重新载入；问题仍保留。';return false;}
      loadSequence++;state.phase='ready';state.loadError='';state.scopeUnconfirmed=false;state.data={...state.data,scope};state.notice='查阅范围已保存，之后的问题按此范围发送。';return true;
    },
    rejectScopeChange(request,error){
      if(!current(request)||request.scopeOperation!==state.scopePending?.scopeOperation)return false;
      state.scopePending=null;state.scopeUnconfirmed=true;state.notice=(error?.message||'查阅范围暂未确认')+' 问题仍保留，请重新读取当前范围。';return true;
    },
    beginSend(){
      if(!canSend())return null;
      const text=state.draft.trim(),old=state.retry;
      const payload=old?.uncertain&&old.checked?{...old.payload}:{id:makeId(),passageId:state.data.context.passageId,text,contentVersion:state.data.contentVersion,...(state.data.scope?{scopeRevision:state.data.scope.revision}:{})};
      const request=ticket({operation:++operation,id:payload.id});state.pending={id:payload.id,text:payload.text,payload,draftText:old?.uncertain?old.draftText:state.draft,status:'running'};state.retry=null;state.notice='';persistPending(state.pending);
      putTurn({id:payload.id,passageId:payload.passageId,contentVersion:payload.contentVersion,text:payload.text,origin:'user',createdAt:new Date().toISOString(),status:'running',answer:null});
      // Save the original id before dispatch so reloading cannot create a paid duplicate.
      return {ticket:request,payload};
    },
    resolveSend(request,turn){
      if(!current(request)||request.operation!==operation||request.id!==state.pending?.id||state.pending.status==='stopping'||turn?.id!==request.id||turn.passageId!==state.pending.payload.passageId||turn.contentVersion!==state.pending.payload.contentVersion||state.pending.payload.scopeRevision!==undefined&&turn.scopeRevision!==state.pending.payload.scopeRevision)return false;
      // A concurrent GET may have snapshotted the book before this POST claimed
      // its turn. A confirmed terminal receipt supersedes that older read.
      if(turn.status!=='running'){loadSequence++;state.phase=state.data?'ready':'idle';state.loadError='';}
      finish(turn);return true;
    },
    rejectSend(request,error,{uncertain=false}={}){
      if(!current(request)||request.operation!==operation||request.id!==state.pending?.id)return false;
      if(error?.status===412)state.scopeUnconfirmed=true;
      const pending=state.pending;state.pending=null;restore(pending.text);state.retry={payload:pending.payload,draftText:pending.draftText,uncertain,checked:!uncertain};if(uncertain)persistPending(state.retry);else clearPending(pending.payload);
      putTurn({...state.turns.find(t=>t.id===pending.id),status:uncertain?'running':'failed',error:error?.message});
      state.notice=uncertain?'连接中断，正在确认这次提问的进度。请先确认结果，避免重复提问。':error?.message||'这次没有得到回答，问题已保留。';return true;
    },
    beginCancel(){if(!state.pending||state.pending.status==='stopping')return null;loadSequence++;state.phase=state.data?'ready':'idle';const request=ticket({operation:++operation,id:state.pending.id});state.pending={...state.pending,status:'stopping'};return request;},
    resolveCancel(request,turn){if(!current(request)||request.operation!==operation||request.id!==state.pending?.id)return false;finish({...turn,status:['completed','failed','cancelled'].includes(turn?.status)?turn.status:'cancelled',id:request.id,text:turn?.text||state.pending.text,passageId:turn?.passageId||state.pending.payload.passageId,contentVersion:turn?.contentVersion||state.pending.payload.contentVersion,origin:'user'});return true;},
    rejectCancel(request,error){if(!current(request)||request.operation!==operation||request.id!==state.pending?.id)return false;const pending=state.pending;state.pending=null;restore(pending.text);state.retry={payload:pending.payload,draftText:pending.draftText,uncertain:true,checked:false};persistPending(state.retry);state.notice='还不能确认是否已停止。请先查看进度，再决定是否重试。';state.loadError=error?.message||'';return true;}
  };
}
