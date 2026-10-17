import {audioHash,audioError,prepareReading,validateDialogue,clipCacheKey,chunkAudio,audioValueEqual} from './audio-content.mjs';
import {prepareDialogueScenes,sceneCacheKey} from './audio-scenes.mjs';
import {validateGuide} from './listening-guide-content.mjs';
const checkedScript=(book,d,candidate=d)=>d.kind==='guided-listening'?validateGuide(book,d.scope,{...d,...candidate}):validateDialogue(book,d,candidate);
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const historyStatuses=new Set(['failed','cancelled','interrupted']);
function checkedGuideHistory(book,row){
 if(!validId(row?.id)||!historyStatuses.has(row.status)||typeof row.createdAt!=='string'||row.createdAt.length>64||!Number.isFinite(Date.parse(row.createdAt)))throw audioError('导听候选历史格式无效。');
 const transcript=validateGuide(book,row.transcript?.scope,row.transcript);
 return {id:row.id,status:row.status,createdAt:row.createdAt,transcript};
}
export function validateAudioBackup(book,backup){
 if(!backup||backup.kind!=='marginalia-audio-backup'||backup.schemaVersion!==1||backup.bookId!==book.bookId||backup.contentVersion!==book.contentVersion||Buffer.byteLength(JSON.stringify(backup))>32*1024*1024||!Array.isArray(backup.sessions)||backup.sessions.length>1000||!Array.isArray(backup.dialogues)||backup.dialogues.length>200||!Array.isArray(backup.audio)||backup.audio.length>2000)throw audioError('听读备份格式、版本或大小不一致。');
 const dialogues=backup.dialogues.map(d=>{if(!validId(d.id)||!Number.isSafeInteger(d.revision)||d.revision<1)throw audioError('讲稿标识无效。');const valid=checkedScript(book,d);let aiDraft;if(d.aiDraft)aiDraft={turns:checkedScript(book,d,d.aiDraft).turns,origin:'ai'};return {...valid,id:d.id,revision:d.revision,origin:d.origin==='user-edited-ai'?'user-edited-ai':'ai',...(aiDraft?{aiDraft}:{}),createdAt:d.createdAt};});
 if(backup.guideJobs!==undefined&&(!Array.isArray(backup.guideJobs)||backup.guideJobs.length>100))throw audioError('导听候选历史过多或格式无效。');
 const guideJobs=(backup.guideJobs||[]).map(row=>checkedGuideHistory(book,row));
 if(new Set(guideJobs.map(j=>j.id)).size!==guideJobs.length)throw audioError('导听候选历史包含重复标识。');
 if(new Set(dialogues.map(d=>d.id)).size!==dialogues.length||new Set(backup.sessions.map(s=>s.id)).size!==backup.sessions.length)throw audioError('备份包含重复标识。');
 const files=new Map();for(const f of backup.audio){if(!/^[a-f0-9]{64}$/.test(f.checksum)||typeof f.base64!=='string'||f.base64.length>5400000||!['audio/mpeg','audio/wav'].includes(f.mimeType))throw audioError('声音备份格式无效。');const bytes=Buffer.from(f.base64,'base64');if(!bytes.length||bytes.length>4000000||audioHash(bytes)!==f.checksum)throw audioError('声音备份校验失败，未恢复任何记录。');files.set(f.checksum,{bytes,mimeType:f.mimeType});}
 const sessions=backup.sessions.map(s=>{
  if(!validId(s.id)||typeof s.idempotencyKey!=='string'||!Array.isArray(s.clips)||!s.clips.length||s.clips.length>512)throw audioError('听读会话无效。');
  const chunkingVersion=s.chunkingVersion??1;let expected,snapshot;
  if(s.input?.mode==='dialogue'){const d=s.dialogueSnapshot||dialogues.find(d=>d.id===s.input.dialogueId&&d.revision===s.input.revision);if(!d||d.id!==s.input.dialogueId||d.revision!==s.input.revision)throw audioError('声音无法对应讲稿版本。');snapshot={...checkedScript(book,d),id:d.id,revision:d.revision,origin:d.origin==='user-edited-ai'?'user-edited-ai':'ai',createdAt:d.createdAt};if(chunkingVersion===3){if(snapshot.kind!=='guided-listening')throw audioError('声音场景版本不一致。');expected=prepareDialogueScenes(book.bookId,snapshot).clips;}else{if(snapshot.kind==='guided-listening')throw audioError('声音场景版本不一致。');expected=snapshot.turns.map((t,i)=>({passageId:t.sourceRefs[0].passageId,text:t.text,textHash:audioHash(t.text),sourceHash:audioHash(t.text),start:0,end:t.text.length,language:'zh',variant:'interpretive',speaker:t.speaker,turnIndex:i}));}}
  else if(s.input?.mode==='ai-response'){const text=s.input.text;if(typeof text!=='string'||!text.trim()||text.length>4000)throw audioError('回答朗读无效。');expected=[{text,textHash:audioHash(text),sourceHash:audioHash(text),language:'zh',variant:'interpretive',start:0,end:text.length}];}
  else expected=prepareReading(book,s.input,{chunkingVersion}).clips;
  if(chunkingVersion!==3)expected=chunkAudio({clips:expected},chunkingVersion).clips;
  if(expected.length!==s.clips.length||audioHash(expected)!==s.contentHash)throw audioError('备份文字与当前原文不一致。');
  const clips=s.clips.map((c,i)=>{if(!validId(c.id)||!['Sulafat','Kore','Charon','Puck'].includes(c.voice)||c.text!==expected[i].text)throw audioError('声音片段无效。');const file=files.get(c.checksum);if(file&&file.mimeType!==c.mimeType)throw audioError('声音格式不一致。');
   let turns;if(chunkingVersion===3){
    if(!Array.isArray(c.turns)||c.turns.length!==expected[i].turns.length||c.turns.some(t=>!['Sulafat','Kore','Charon','Puck'].includes(t.voice))||new Set(c.turns.map(t=>t.voice)).size>2)throw audioError('声音场景声线无效。');
    const {id,voice,status,mimeType,bytes,checksum,generationId,cacheKey,...actual}=c;const withoutVoices={...actual,turns:c.turns.map(({voice,...t})=>t)};
    if(!audioValueEqual(withoutVoices,expected[i]))throw audioError('声音场景的语气或出处不一致。');turns=structuredClone(c.turns);
   }
   return {...expected[i],...(turns?{turns}:{}),id:c.id,voice:c.voice,status:file?'ready':'pending',...(file?{checksum:c.checksum,mimeType:file.mimeType,bytes:file.bytes.length}:{})};});
  const position=s.position;if(!position||!Number.isInteger(position.clipIndex)||position.clipIndex<0||position.clipIndex>=clips.length||!Number.isFinite(position.seconds)||position.seconds<0||position.seconds>86400)throw audioError('听读位置无效。');
  const {guideJobId,...restoredInput}=s.input;
  return {id:s.id,chunkingVersion,idempotencyKey:s.idempotencyKey,input:restoredInput,...(snapshot?{dialogueSnapshot:snapshot}:{}),requestHash:audioHash(restoredInput),contentHash:s.contentHash,model:s.model||'restored-model',bookId:book.bookId,contentVersion:book.contentVersion,chapterId:s.chapterId,language:s.language,variant:s.variant,mode:s.mode,clips,position,createdAt:s.createdAt,status:clips.every(c=>c.status==='ready')?'ready':'interrupted'};
 });return {sessions,dialogues,guideJobs,files};
}
export function createAudioBackup({audio,store,getBook}){
 return {async exportAudio({owner,bookId,includeAudio=false}){
  const book=await getBook(owner,bookId),data=await audio.readData(owner,bookId),sessions=data.sessions.map(({lease,workerState,authorityKey,...s})=>{const {guideJobId,...input}=s.input;return {...s,input,requestHash:audioHash(input),clips:s.clips.map(({cacheKey,generationId,...c})=>c)};}),files=new Map();
  // Terminal candidates are useful reading records, but a backup must never
  // carry leases, queued work, request keys or a claim of semantic verification.
  const guideJobs=(data.guideJobs||[]).filter(j=>j.candidate&&historyStatuses.has(j.status)).map(j=>checkedGuideHistory(book,{id:j.id,status:j.status,createdAt:j.createdAt,transcript:j.candidate}));
  if(includeAudio)for(const s of data.sessions)for(const c of s.clips)if(c.status==='ready'&&!files.has(c.checksum)){const bytes=await store.getClip(c.cacheKey);files.set(c.checksum,{checksum:c.checksum,mimeType:c.mimeType,base64:bytes.toString('base64')});}
  const result={kind:'marginalia-audio-backup',schemaVersion:1,bookId,contentVersion:book.contentVersion,dialogues:data.dialogues,sessions,...(guideJobs.length?{guideJobs}:{}),preferences:await audio.getPreferences(owner),audio:[...files.values()]};if(Buffer.byteLength(JSON.stringify(result))>32*1024*1024)throw audioError('听读备份超过 32 MB，请先仅导出讲稿，分别下载音频。',413);return result;
 },async restoreAudio({owner,bookId,backup}){
  const book=await getBook(owner,bookId),validated=validateAudioBackup(book,backup);await audio.getPreferences(owner); // Authentication precedes every write.
  const prefs=backup.preferences||{};if(['narrator','guide','questioner'].some(k=>prefs[k]!==undefined&&!['Sulafat','Kore','Charon','Puck'].includes(prefs[k]))||prefs.speed!==undefined&&(!Number.isFinite(prefs.speed)||prefs.speed<0.75||prefs.speed>1.5)||prefs.follow!==undefined&&typeof prefs.follow!=='boolean')throw audioError('备份声音偏好无效。');
  const prior=await audio.readData(owner,bookId);for(const d of validated.dialogues){const old=prior.dialogues.find(x=>x.id===d.id);if(old&&!audioValueEqual(old.turns,d.turns))throw audioError('现有修改稿与备份不同，未覆盖。',409);}
  const histories=validated.guideJobs.map(row=>({id:'imported-guide-'+audioHash([bookId,row.transcript,row.createdAt]).slice(0,40),status:row.status,createdAt:row.createdAt,stage:'history',scope:row.transcript.scope,candidate:row.transcript,verification:[],readPassageIds:row.transcript.passageIds,outlines:[],batchCount:0,error:{code:'restored_transcript',message:'这是从备份恢复的候选讲稿，尚未核验；恢复不会继续生成声音。'}}));
  if((prior.guideJobs?.length||0)+histories.filter(j=>!prior.guideJobs?.some(old=>old.id===j.id)).length>100)throw audioError('导听候选历史过多，请分开保留备份。',413);
  for(const s of validated.sessions)for(const c of s.clips){c.cacheKey=s.chunkingVersion===3?sceneCacheKey([owner.id,bookId],c,s.model):clipCacheKey([owner.id,bookId],c,c.voice,s.model,'');if(c.status==='ready')await store.putClip(c.cacheKey,validated.files.get(c.checksum).bytes);}
  await store.mutate(owner.id,bookId,d=>{for(const s of validated.sessions)if(!d.sessions.some(x=>x.id===s.id))d.sessions.push(s);for(const row of validated.dialogues)if(!d.dialogues.some(x=>x.id===row.id))d.dialogues.push(row);const jobs=(d.guideJobs??=[]);for(const history of histories)if(!jobs.some(j=>j.id===history.id))jobs.push(history);return null;});await audio.savePreferences(owner,prefs);return {sessions:validated.sessions.length,dialogues:validated.dialogues.length,...(histories.length?{guideJobs:histories.length}:{})};
 }};
}
