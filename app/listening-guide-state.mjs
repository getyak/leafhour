// Source identity travels with an audio question; never infer it from a later selection.
export function guideRequest(reader,intent,scopeMode='through'){
 const book=reader?.getBook?.();if(!book||!['intro','explain','book'].includes(intent))throw Error('请先打开一本书。');
 if(intent==='book')return {intent,contentVersion:book.contentVersion};
 const chapterId=reader.getChapterId(),rows=book.sections.filter(s=>s.chapterId===chapterId).flatMap(s=>s.paragraphs);
 if(!rows.length)throw Error('请先选择一个章节。');
 const passageId=(reader.isSelectionActive?.()?reader.getSelectedId?.():null)||reader.getAnchor?.()?.passageId;
 if(intent==='explain'&&scopeMode==='through'&&!rows.some(p=>p.id===passageId))throw Error('请先选择讲到哪一段。');
 return {intent,contentVersion:book.contentVersion,chapterId,...(intent==='explain'?{throughPassageId:passageId,scopeMode}:{})};
}
export function sceneSourceIds({book,clip}){
 if(!book||!clip)return [];
 const known=new Set(book.sections.flatMap(s=>s.paragraphs.map(p=>p.id))),refs=(clip.turns||[clip]).flatMap(t=>t.sourceRefs||clip.sourceRefs||[]);
 return [...new Set([clip.passageId,...refs.map(r=>r.passageId)].filter(id=>known.has(id)))].slice(0,4);
}
export function sceneQuestion({book,clip}){
 if(!book||!clip)return null;
 const rows=new Map(book.sections.flatMap(s=>s.paragraphs).map(p=>[p.id,p]));
 const turns=clip.turns||[clip],refs=turns.flatMap(t=>t.sourceRefs||clip.sourceRefs||[]).filter(r=>typeof r.quote==='string'&&rows.get(r.passageId)?.original?.includes(r.quote));
 if(!refs.length&&clip.passageId&&typeof rows.get(clip.passageId)?.original==='string')refs.push({passageId:clip.passageId,quote:rows.get(clip.passageId).original.slice(clip.start||0,clip.end||500)});
 if(!refs.length)return null;
 const unique=[...new Map(refs.map(r=>[r.passageId,r])).values()].slice(0,4);
 const transcript=turns.map(t=>t.text).filter(Boolean).join('\n').slice(0,900);
 const sources=unique.map(r=>r.passageId+'：'+r.quote.slice(0,150)).join('\n');
 return {passageId:unique[0].passageId,passageIds:unique.map(r=>r.passageId),draft:('请结合原文解释我刚听到的这一小段，保留作者的重要限定。\n\n听读内容（AI 讲解或朗读）：\n'+transcript+'\n\n原文定位：\n'+sources).slice(0,2000)};
}
export function createGuideRunner({request,onProgress=()=>{},onReady=()=>{},onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let epoch=0,timer=null,job=null,active=false,pendingInput=null;
 async function accept(value,ticket){
  if(ticket!==epoch){if(value?.id)await request('guides/'+value.id+'/cancel',{}).catch(()=>{});return;}
  job=value;onProgress(value);
  if(value.status==='ready'&&value.sessionId){active=false;await onReady(value);return;}
  if(['failed','interrupted','cancelled'].includes(value.status)){active=false;onError(Object.assign(Error(value.error?.message||'讲解未完成，已保存的内容仍可查看。'),{guideStatus:value.status}));return;}
  timer=setTimer(()=>poll(ticket),1500);
 }
 async function poll(ticket){if(ticket!==epoch||!job)return;try{await accept(await request('guides/'+job.id),ticket);}catch(error){if(ticket===epoch){active=false;onError(error);}}}
 return {async start(input){if(active)return;active=true;pendingInput=input;const ticket=++epoch;clearTimer(timer);job=null;try{await accept(await request('guides',input),ticket);}catch(error){if(ticket===epoch){active=false;onError(error);}}},async retry(){if(job?.id)return this.resume(job.id);if(pendingInput)return this.start(pendingInput);},async resume(id){if(typeof id!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(id))return;active=true;const ticket=++epoch;job={id};await poll(ticket);},async cancel(){epoch++;active=false;clearTimer(timer);const prior=job,priorInput=pendingInput;job=null;pendingInput=null;if(prior?.id){if(prior.status!=='ready')await request('guides/'+prior.id+'/cancel',{}).catch(()=>{});}else if(priorInput?.idempotencyKey)await request('guides/requests/'+encodeURIComponent(priorInput.idempotencyKey)+'/cancel',{}).catch(()=>{});},get active(){return active;}};
}
