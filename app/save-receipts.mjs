// Receipts describe separate objects: a submitted note, its current draft, or one
// exact final session snapshot. A successful unrelated batch is never evidence.
import {sameReadingSegments} from './reading-session-record.mjs';
const legacyReceipt=(id,params,fallback)=>fallback;
const legacyMessages=/* @__PURE__ */Object.freeze({
  "receipt.note.pendingMemory": "保存尚未确认。文字仅在当前页面，请先复制；刷新或离开可能丢失。 重试会先确认同一次提交。",
  "receipt.session.pendingMemory": "本次时段仅在当前页面，请重试保存或另存记录。",
  "receipt.draft.memory": "当前文字是草稿，尚未提交。仅在当前页面，请先复制；刷新或离开可能丢失。",
  "receipt.note.pendingLocal": "保存尚未确认。文字已留在本机草稿中。 重试会先确认同一次提交。",
  "receipt.session.pendingLocal": "本次时段已留本机，书房尚未确认。",
  "receipt.draft.local": "当前文字是草稿，尚未提交。已留本机。",
  "receipt.note.saved": "已保存到自己的书房。",
  "receipt.session.saved": "本次时段已保存到书房。",
  "receipt.note.savedDraftMemory": "上次提交已保存，新写的文字仍是草稿。文字仅在当前页面，请先复制；刷新或离开可能丢失。",
  "receipt.note.savedDraftLocal": "上次提交已保存，新写的文字仍是草稿。文字已留在本机草稿中。"
});
// Browser UI entry: state and message IDs only. Compatibility prose stays in
// the legacy wrapper, so explicit formatter callers do not ship unused labels.
export function formatNoteSaveReceipt({confirmed=false,durable=false,hasDraft=true}={},format){
 return format(confirmed&&!hasDraft?'receipt.note.saved':'receipt.note.'+(confirmed?'savedDraft':'pending')+(durable?'Local':'Memory'),{});
}
export function noteSaveReceipt(state={},format=legacyReceipt){
 return formatNoteSaveReceipt(state,(id,params)=>format(id,params,legacyMessages[id]));
}
export function matchingSessionSnapshot(expected,received){
  return !!expected&&!!received&&expected.bookId===received.bookId&&expected.contentVersion===received.contentVersion&&expected.id===received.id&&expected.sequence===received.sequence&&expected.status==='finished'&&received.status==='finished'&&expected.durationSeconds===received.durationSeconds&&expected.end?.chapterId===received.end?.chapterId&&expected.end?.passageId===received.end?.passageId&&['source','startedAt','endedAt','timeZone'].every(key=>expected[key]===undefined||expected[key]===received[key])&&(expected.start===undefined||expected.start.chapterId===received.start?.chapterId&&expected.start.passageId===received.start?.passageId)&&(expected.segments===undefined||sameReadingSegments(expected.segments,received.segments));
}
export function formatReadingSessionReceipt({confirmed=false,durable=false}={},format){
 return format('receipt.session.'+(confirmed?'saved':durable?'pendingLocal':'pendingMemory'),{});
}
export function readingSessionReceipt(state={},format=legacyReceipt){
 return formatReadingSessionReceipt(state,(id,params)=>format(id,params,legacyMessages[id]));
}

export function positionSaveState(attempted,confirmed,{durable=false,unresolved=false}={}){
  const same=attempted&&confirmed&&attempted.passageId===confirmed.passageId&&attempted.chapterId===confirmed.chapterId&&attempted.contentVersion===confirmed.contentVersion&&attempted.offset===confirmed.offset&&attempted.withinParagraph===confirmed.withinParagraph&&(!attempted.localSequence||attempted.localSequence===confirmed.localSequence&&attempted.localWriterId===confirmed.localWriterId);
  return {confirmed:!!same&&!unresolved,durable,unresolved};
}

export function formatDraftSaveReceipt({durable=false}={},format){return format('receipt.draft.'+(durable?'local':'memory'),{});}
export function draftSaveReceipt(state={},format=legacyReceipt){
 return formatDraftSaveReceipt(state,(id,params)=>format(id,params,legacyMessages[id]));
}

export function formatCurrentSessionReceipt(view,ending,state,format){
 return view?.status==='finished'&&view.id===ending?.id?formatReadingSessionReceipt(state,format):'';
}
export function currentSessionReceipt(view,ending,state,format=legacyReceipt){
  return view?.status==='finished'&&view.id===ending?.id?readingSessionReceipt(state,format):'';
}
