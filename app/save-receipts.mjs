// Receipts describe separate objects: a submitted note, its current draft, or one
// exact final session snapshot. A successful unrelated batch is never evidence.
export function noteSaveReceipt({confirmed=false,durable=false,hasDraft=true}={}){
  if(confirmed&&!hasDraft)return '已保存到自己的书房。';
  const retained=durable?'文字已留在本机草稿中。':'文字仅在当前页面，请先复制；刷新或离开可能丢失。';
  return confirmed?'上次提交已保存，新写的文字仍是草稿。'+retained:'保存尚未确认。'+retained+' 重试会先确认同一次提交。';
}
export function matchingSessionSnapshot(expected,received){
  return !!expected&&!!received&&expected.bookId===received.bookId&&expected.contentVersion===received.contentVersion&&expected.id===received.id&&expected.sequence===received.sequence&&expected.status==='finished'&&received.status==='finished'&&expected.durationSeconds===received.durationSeconds&&expected.end?.chapterId===received.end?.chapterId&&expected.end?.passageId===received.end?.passageId;
}
export function readingSessionReceipt({confirmed=false,durable=false}={}){
  return confirmed?'本次时段已保存到书房。':durable?'本次时段已留本机，书房尚未确认。':'本次时段仅在当前页面，请重试保存或另存记录。';
}

export function positionSaveState(attempted,confirmed,{durable=false,unresolved=false}={}){
  const same=attempted&&confirmed&&attempted.passageId===confirmed.passageId&&attempted.chapterId===confirmed.chapterId&&attempted.contentVersion===confirmed.contentVersion&&attempted.offset===confirmed.offset&&attempted.withinParagraph===confirmed.withinParagraph&&(!attempted.localSequence||attempted.localSequence===confirmed.localSequence&&attempted.localWriterId===confirmed.localWriterId);
  return {confirmed:!!same&&!unresolved,durable,unresolved};
}

export function draftSaveReceipt({durable=false}={}){
  return '当前文字是草稿，尚未提交。'+(durable?'已留本机。':'仅在当前页面，请先复制；刷新或离开可能丢失。');
}

export function currentSessionReceipt(view,ending,state){
  return view?.status==='finished'&&view.id===ending?.id?readingSessionReceipt(state):'';
}
