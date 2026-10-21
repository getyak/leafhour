import {READING_CHAT_SCOPES,readChatScope} from './reading-chat-scope.mjs';
import {normalizeReadingChatQuote} from './reading-chat-quote.mjs';
export const CHAT_TEXT_LIMIT=2000;

// Async tickets are scoped to both the account and the selected book. Stopping a
// run changes its operation ticket before a late send response can be applied.
export function createLibraryChatState({readDraft=()=>'',writeDraft=()=>{},readPending=()=>null,writePending=()=>{},readQuoteHead=()=>null,writeQuoteHead=()=>{},readQuoteAck=()=>null,writeQuoteAck=()=>{},makeQuoteRevision=()=>crypto.randomUUID(),makeId=()=>crypto.randomUUID()}={}){
  let epoch=0,loadSequence=0,operation=0,scopeOperation=0,unsavedQuote=null,quoteRejectedRevision=null;
  let state={owner:null,bookId:null,draft:'',quote:null,quoteRevision:null,data:null,turns:[],phase:'idle',loadError:null,pending:null,retry:null,notice:'',scopePending:null,scopeUnconfirmed:false};
  const current=ticket=>!!ticket&&ticket.epoch===epoch&&ticket.owner===state.owner&&ticket.bookId===state.bookId;
  const ticket=extra=>({epoch,owner:state.owner,bookId:state.bookId,...extra});
  const persist=()=>{if(!state.owner||!state.bookId)return false;try{writeDraft(state.owner,state.bookId,state.draft);return true;}catch{return false;}};
  const payloadFor=turn=>({id:turn.id,passageId:turn.passageId,text:turn.text,...(turn.preferenceWrites===true?{preferenceWrites:true}:{}),...(turn.quote!==undefined?{quote:normalizeReadingChatQuote(turn.quote)}:{}),contentVersion:turn.contentVersion,...(turn.scopeRevision!==undefined?{scopeRevision:turn.scopeRevision}:{})});
  const persistPending=record=>{if(state.owner&&state.bookId&&typeof record?.draftText==='string')try{writePending(state.owner,state.bookId,{schemaVersion:1,owner:state.owner,bookId:state.bookId,payload:payloadFor(record.payload),draftText:record.draftText,...(record.quoteRevision?{quoteRevision:record.quoteRevision}:{})});}catch{}};
  const clearPending=payload=>{if(state.owner&&state.bookId)try{const saved=readPending(state.owner,state.bookId);if(!saved||saved.payload?.id===payload.id)writePending(state.owner,state.bookId,null);}catch{}};
  function restoredPending(owner,bookId){
    let saved;try{saved=readPending(owner,bookId);}catch{return null;}
    const p=saved?.payload;
    if(saved?.schemaVersion!==1||saved.owner!==owner||saved.bookId!==bookId||typeof saved.draftText!=='string'||saved.draftText.length>CHAT_TEXT_LIMIT||!saved.draftText.isWellFormed()||typeof p?.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(p.id)||typeof p.text!=='string'||!p.text.trim()||p.text.length>CHAT_TEXT_LIMIT||!p.text.isWellFormed()||saved.draftText.trim()!==p.text||typeof p.passageId!=='string'||!p.passageId||p.passageId.length>128||typeof p.contentVersion!=='string'||!p.contentVersion||p.contentVersion.length>256||p.preferenceWrites!==undefined&&typeof p.preferenceWrites!=='boolean'||p.scopeRevision!==undefined&&(!Number.isSafeInteger(p.scopeRevision)||p.scopeRevision<0))return null;
    try{
      if(p.quote===undefined&&saved.quoteRevision!==undefined)return null;
      if(p.quote!==undefined&&(!validRevision(saved.quoteRevision)||p.quote.bookId!==bookId||p.quote.parts?.[0]?.passageId!==p.passageId||p.quote.contentVersion!==p.contentVersion))return null;
      return {payload:payloadFor(p),draftText:saved.draftText,quoteRevision:saved.quoteRevision||null,uncertain:true,checked:false};
    }catch{return null;}
  }
  const validRevision=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
  const acknowledged=new Set();
  function readQuote(owner,bookId,fallback={quote:null,quoteRevision:null}){
    try{
      const head=readQuoteHead(owner,bookId);
      if(unsavedQuote?.owner===owner&&unsavedQuote.bookId===bookId){
        // A failed write did not make an old readable head a newer intent.
        if(!unsavedQuote.priorKnown||!head||head.revision===unsavedQuote.priorRevision)return fallback;
        unsavedQuote=null; // A different persisted revision belongs to another explicit edit.
      }
      if(!head)return fallback;
      if(head.schemaVersion!==1||head.owner!==owner||head.bookId!==bookId||!validRevision(head.revision)||Object.keys(head).some(k=>!['schemaVersion','owner','bookId','revision','quote'].includes(k)))return {quote:null,quoteRevision:null};
      const ack=readQuoteAck(owner,bookId,head.revision),done=ack?.schemaVersion===1&&ack.owner===owner&&ack.bookId===bookId&&ack.revision===head.revision||acknowledged.has(owner+'\0'+bookId+'\0'+head.revision);
      const quote=head.quote===null?null:normalizeReadingChatQuote(head.quote);
      if(quote&&quote.bookId!==bookId)return {quote:null,quoteRevision:null};
      return {quote:done?null:quote,quoteRevision:head.revision};
    }catch{return fallback;}
  }
  function acknowledgeQuote(tracked){
    const revision=tracked?.quoteRevision;if(!revision)return true;
    const owner=state.owner,bookId=state.bookId;let saved=true;
    // Never rewrite/delete the shared head. A concurrent tab owns its revision.
    try{writeQuoteAck(owner,bookId,revision,{schemaVersion:1,owner,bookId,revision});}catch{saved=false;}
    acknowledged.add(owner+'\0'+bookId+'\0'+revision);
    const fallback=state.quoteRevision===revision?{quote:null,quoteRevision:revision}:{quote:state.quote,quoteRevision:state.quoteRevision};
    Object.assign(state,readQuote(owner,bookId,fallback));return saved;
  }
  function matches(turn,payload){
    try{return !!turn&&!!turn.preferenceWrites===!!payload.preferenceWrites&&turn.id===payload.id&&turn.text===payload.text&&turn.passageId===payload.passageId&&turn.contentVersion===payload.contentVersion&&(turn.scopeRevision??0)===(payload.scopeRevision??0)&&JSON.stringify(turn.quote===undefined?null:normalizeReadingChatQuote(turn.quote))===JSON.stringify(payload.quote??null);}catch{return false;}
  }
  const canChangeQuote=()=>!!state.owner&&!!state.bookId&&!state.pending&&!state.retry?.uncertain&&!state.scopePending;
  function quoteReady(){
    if(!state.quote)return true;const part=state.quote.parts[0],context=state.data?.context;
    if(state.quoteRevision===quoteRejectedRevision||state.quote.bookId!==state.bookId||state.quote.contentVersion!==state.data?.contentVersion||part.passageId!==context?.passageId)return false;
    // Current GET includes the first source/translation; never certify unseen parts.
    if(Object.hasOwn(context,part.layer)){
      const source=context[part.layer];if(typeof source!=='string'||source.slice(part.start,part.end)!==part.text||part.layer!=='original'&&context.translationStatus?.[part.layer]!==part.translationStatus)return false;
    }
    return true;
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
  const canSend=()=>!!state.owner&&!!state.bookId&&state.phase==='ready'&&state.data?.available===true&&!!state.data.context?.passageId&&!state.pending&&!state.scopePending&&!state.scopeUnconfirmed&&(state.retry?.uncertain?state.retry.checked&&state.data.context.passageId===state.retry.payload.passageId:quoteReady()&&validText());
  function finish(turn){
    const pending=state.pending,tracked=pending?.id===turn.id?pending:state.retry?.payload.id===turn.id?state.retry:null;putTurn(turn);
    if(turn.status==='running'){
      state.pending={...(pending||{}),id:turn.id,text:turn.text,payload:payloadFor(turn),draftText:tracked?.draftText??null,quoteRevision:tracked?.quoteRevision||null,status:'running'};persistPending(state.pending);return;
    }
    state.pending=null;
    if(turn.status==='completed'){
      const quoteSaved=acknowledgeQuote(tracked);if(clearExactDraft(tracked?.draftText)&&quoteSaved)clearPending(payloadFor(turn));state.retry=null;state.notice='';
    }else{
      clearPending(payloadFor(turn));
      Object.assign(state,readQuote(state.owner,state.bookId,{quote:state.quote,quoteRevision:state.quoteRevision}));
      restore(turn.text);state.retry={payload:payloadFor(turn),draftText:tracked?.draftText??turn.text,quoteRevision:tracked?.quoteRevision||null,uncertain:false,checked:true};state.notice={id:turn.status==='cancelled'?'chat.stopped':'cs.noAnswer'};
    }
  }
  return {
    view:()=>({...state,quote:state.quote?structuredClone(state.quote):null,canChangeQuote:canChangeQuote(),quoteLocalOnly:!!unsavedQuote,quoteStale:!!state.quote&&!!state.data&&!quoteReady(),canSend:canSend()}),
    setQuote(value){
      if(!canChangeQuote())return false;let quote;try{quote=value===null?null:normalizeReadingChatQuote(value);}catch{return false;}if(quote&&quote.bookId!==state.bookId)return false;
      let priorKnown=false,priorRevision=null;try{priorRevision=readQuoteHead(state.owner,state.bookId)?.revision||null;priorKnown=true;}catch{}
      const revision=makeQuoteRevision();if(!validRevision(revision))return false;quoteRejectedRevision=null;state.quote=quote;state.quoteRevision=revision;
      try{writeQuoteHead(state.owner,state.bookId,{schemaVersion:1,owner:state.owner,bookId:state.bookId,revision,quote});unsavedQuote=null;}catch{unsavedQuote={owner:state.owner,bookId:state.bookId,revision,priorKnown,priorRevision};}return true;
    },
    setContext(owner,bookId){
      owner=owner||null;bookId=bookId||null;if(owner===state.owner&&bookId===state.bookId)return false;
      epoch++;operation++;unsavedQuote=null;quoteRejectedRevision=null;let draft='';if(owner&&bookId)try{draft=String(readDraft(owner,bookId)||'');}catch{}
      const retry=owner&&bookId?restoredPending(owner,bookId):null;
      state={owner,bookId,draft,...(owner&&bookId?readQuote(owner,bookId):{quote:null,quoteRevision:null}),data:null,turns:[],phase:'idle',loadError:null,pending:null,retry,notice:retry?{id:'c.notice.checking'}:null,scopePending:null,scopeUnconfirmed:false};return true;
    },
    reset(){epoch++;operation++;unsavedQuote=null;quoteRejectedRevision=null;state={owner:null,bookId:null,draft:'',quote:null,quoteRevision:null,data:null,turns:[],phase:'idle',loadError:null,pending:null,retry:null,notice:'',scopePending:null,scopeUnconfirmed:false};},
    setDraft(text){state.draft=String(text);persist();},
    beginLoad({passageId}={}){if(!state.owner||!state.bookId)return null;loadSequence++;state.loadError='';if(passageId&&state.data?.context?.passageId!==passageId)state.data=null;state.phase='loading';return ticket({loadSequence});},
    resolveLoad(request,data){
      if(!current(request)||request.loadSequence!==loadSequence)return false;
      if(!data||data.bookId!==state.bookId||!Array.isArray(data.turns)){state.phase=state.data?'ready':'error';state.loadError={id:'c.error.loadFailed'};return false;}
      if(data.scope!==undefined)try{readChatScope(data.scope);}catch{state.scopeUnconfirmed=true;state.phase='error';state.loadError={id:'c.error.scopeUnconfirmed'};return false;}
      const scopeWasUnconfirmed=state.scopeUnconfirmed;if(data.scope!==undefined&&!state.scopePending)state.scopeUnconfirmed=false;
      const previous=state.turns;state.data=data;state.phase='ready';state.loadError='';
      if(scopeWasUnconfirmed&&!state.scopeUnconfirmed)state.notice={id:'cs.scopeReloaded'};
      state.turns=data.turns.map(turn=>{const local=previous.find(t=>t.id===turn.id);return turn.status==='running'&&local&&local.status!=='running'?local:turn;});
      const target=state.pending?.id||state.retry?.payload.id,recovered=target&&state.turns.find(t=>t.id===target);
      if(recovered&&state.pending?.status!=='stopping'){
        const tracked=state.pending?.payload||state.retry?.payload;
        if(tracked&&!matches(recovered,tracked)){state.turns=previous;state.phase='error';state.loadError={id:'chat.quote.receiptMismatch'};return false;}finish(recovered);
      }
      else if(!state.pending&&state.retry?.uncertain){const changed=state.retry.payload.contentVersion!==data.contentVersion,unavailable=data.available===false;state.retry={...state.retry,uncertain:!changed&&!unavailable,checked:true};if(changed||unavailable)clearPending(state.retry.payload);state.notice={id:unavailable?'cs.unavailable':changed?'cs.versionUpdated':'cs.noAnswerContinue'};}
      if(!state.pending){const running=state.turns.find(t=>t.status==='running'&&t.kind!=='companion');if(running)finish(running);}
      if(state.pending&&!state.turns.some(t=>t.id===state.pending.id)){const local=previous.find(t=>t.id===state.pending.id);if(local)state.turns.push(local);}
      return true;
    },
    rejectLoad(request,error){if(!current(request)||request.loadSequence!==loadSequence)return false;state.phase=state.data?'ready':'error';state.loadError={id:'cs.loadFailed'};return true;},
    beginScopeChange(mode){
      if(!READING_CHAT_SCOPES.includes(mode)||!state.data?.scope||state.phase!=='ready'||state.pending||state.retry?.uncertain||state.scopePending||state.scopeUnconfirmed)return null;
      const scope=readChatScope(state.data.scope),request=ticket({scopeOperation:++scopeOperation});
      state.scopePending={...request,mode,baseRevision:scope.revision,previousMode:scope.mode};state.notice={id:'cs.savingScope'};
      return {ticket:request,payload:{mode,baseRevision:scope.revision}};
    },
    resolveScopeChange(request,value){
      if(!current(request)||request.scopeOperation!==state.scopePending?.scopeOperation)return false;
      const pending=state.scopePending;state.scopePending=null;let scope;try{scope=readChatScope(value);}catch{}
      if(!scope||scope.mode!==pending.mode||scope.revision!==pending.baseRevision+(pending.mode===pending.previousMode?0:1)){state.scopeUnconfirmed=true;state.notice={id:'cs.scopeUncertain'};return false;}
      loadSequence++;state.phase='ready';state.loadError='';state.scopeUnconfirmed=false;state.data={...state.data,scope};state.notice={id:'cs.scopeSaved'};return true;
    },
    rejectScopeChange(request,error){
      if(!current(request)||request.scopeOperation!==state.scopePending?.scopeOperation)return false;
      state.scopePending=null;state.scopeUnconfirmed=true;state.notice={id:'cs.scopeReread'};return true;
    },
    beginSend({preferenceWrites=false}={}){
      if(!canSend())return null;
      const text=state.draft.trim(),old=state.retry;
      const payload=old?.uncertain&&old.checked?{...old.payload}:{...(preferenceWrites?{preferenceWrites:true}:{}),id:makeId(),passageId:state.data.context.passageId,text,...(state.quote?{quote:structuredClone(state.quote)}:{}),contentVersion:state.data.contentVersion,...(state.data.scope?{scopeRevision:state.data.scope.revision}:{})};
      const request=ticket({operation:++operation,id:payload.id});state.pending={id:payload.id,text:payload.text,payload,draftText:old?.uncertain?old.draftText:state.draft,quoteRevision:old?.uncertain?old.quoteRevision:state.quote?state.quoteRevision:null,status:'running'};state.retry=null;state.notice='';persistPending(state.pending);
      putTurn({id:payload.id,passageId:payload.passageId,contentVersion:payload.contentVersion,text:payload.text,...(payload.quote?{quote:payload.quote}:{}),origin:'user',createdAt:new Date().toISOString(),status:'running',answer:null});
      // Save the original id before dispatch so reloading cannot create a paid duplicate.
      return {ticket:request,payload};
    },
    resolveSend(request,turn){
      if(!current(request)||request.operation!==operation||request.id!==state.pending?.id||state.pending.status==='stopping'||!matches(turn,state.pending.payload))return false;
      // A concurrent GET may have snapshotted the book before this POST claimed
      // its turn. A confirmed terminal receipt supersedes that older read.
      if(turn.status!=='running'){loadSequence++;state.phase=state.data?'ready':'idle';state.loadError='';}
      finish(turn);return true;
    },
    rejectSend(request,error,{uncertain=false}={}){
      if(!current(request)||request.operation!==operation||request.id!==state.pending?.id)return false;
      if(error?.status===412)state.scopeUnconfirmed=true;
      const pending=state.pending;if(error?.status===422&&pending.payload.quote&&state.quoteRevision===pending.quoteRevision)quoteRejectedRevision=pending.quoteRevision;state.pending=null;restore(pending.text);state.retry={payload:pending.payload,draftText:pending.draftText,quoteRevision:pending.quoteRevision,uncertain,checked:!uncertain};if(uncertain)persistPending(state.retry);else clearPending(pending.payload);
      putTurn({...state.turns.find(t=>t.id===pending.id),status:uncertain?'running':'failed',error:error?.message});
      state.notice={id:uncertain?'cs.interrupted':error?.status===422?'chat.quote.changed':'cs.noAnswer'};return true;
    },
    beginCancel(){if(!state.pending||state.pending.status==='stopping')return null;loadSequence++;state.phase=state.data?'ready':'idle';const request=ticket({operation:++operation,id:state.pending.id});state.pending={...state.pending,status:'stopping'};return request;},
    resolveCancel(request,turn){if(!current(request)||request.operation!==operation||request.id!==state.pending?.id||!matches(turn,state.pending.payload)||!['completed','failed','cancelled'].includes(turn.status))return false;finish(turn);return true;},
    rejectCancel(request,error){if(!current(request)||request.operation!==operation||request.id!==state.pending?.id)return false;const pending=state.pending;if(error?.status===422&&pending.payload.quote&&state.quoteRevision===pending.quoteRevision)quoteRejectedRevision=pending.quoteRevision;state.pending=null;restore(pending.text);state.retry={payload:pending.payload,draftText:pending.draftText,quoteRevision:pending.quoteRevision,uncertain:true,checked:false};persistPending(state.retry);state.notice={id:'cs.stopUncertain'};state.loadError=error?.message||'';return true;}
  };
}
