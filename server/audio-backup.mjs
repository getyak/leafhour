import {audioHash,audioError,prepareReading,validateDialogue,clipCacheKey} from './audio-content.mjs';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function validateAudioBackup(book,backup){
 if(!backup||backup.kind!=='marginalia-audio-backup'||backup.schemaVersion!==1||backup.bookId!==book.bookId||backup.contentVersion!==book.contentVersion||Buffer.byteLength(JSON.stringify(backup))>32*1024*1024||!Array.isArray(backup.sessions)||backup.sessions.length>1000||!Array.isArray(backup.dialogues)||backup.dialogues.length>200||!Array.isArray(backup.audio)||backup.audio.length>2000)throw audioError('听读备份格式、版本或大小不一致。');
 const dialogues=backup.dialogues.map(d=>{if(!validId(d.id)||!Number.isSafeInteger(d.revision)||d.revision<1)throw audioError('讲稿标识无效。');const valid=validateDialogue(book,d,d);let aiDraft;if(d.aiDraft)aiDraft={turns:validateDialogue(book,d,d.aiDraft).turns,origin:'ai'};return {...valid,id:d.id,revision:d.revision,origin:d.origin==='user-edited-ai'?'user-edited-ai':'ai',...(aiDraft?{aiDraft}:{}),createdAt:d.createdAt};});
 if(new Set(dialogues.map(d=>d.id)).size!==dialogues.length||new Set(backup.sessions.map(s=>s.id)).size!==backup.sessions.length)throw audioError('备份包含重复标识。');
 const files=new Map();for(const f of backup.audio){if(!/^[a-f0-9]{64}$/.test(f.checksum)||typeof f.base64!=='string'||f.base64.length>5400000||!['audio/mpeg','audio/wav'].includes(f.mimeType))throw audioError('声音备份格式无效。');const bytes=Buffer.from(f.base64,'base64');if(!bytes.length||bytes.length>4000000||audioHash(bytes)!==f.checksum)throw audioError('声音备份校验失败，未恢复任何记录。');files.set(f.checksum,{bytes,mimeType:f.mimeType});}
 const sessions=backup.sessions.map(s=>{
  if(!validId(s.id)||typeof s.idempotencyKey!=='string'||!Array.isArray(s.clips)||!s.clips.length||s.clips.length>100)throw audioError('听读会话无效。');
  let expected,snapshot;
  if(s.input?.mode==='dialogue'){const d=s.dialogueSnapshot||dialogues.find(d=>d.id===s.input.dialogueId&&d.revision===s.input.revision);if(!d||d.id!==s.input.dialogueId||d.revision!==s.input.revision)throw audioError('声音无法对应讲稿版本。');snapshot={...validateDialogue(book,d,d),id:d.id,revision:d.revision,origin:d.origin==='user-edited-ai'?'user-edited-ai':'ai',createdAt:d.createdAt};expected=snapshot.turns.map((t,i)=>({passageId:t.sourceRefs[0].passageId,text:t.text,textHash:audioHash(t.text),sourceHash:audioHash(t.text),start:0,end:t.text.length,language:'zh',variant:'interpretive',speaker:t.speaker,turnIndex:i}));}
  else if(s.input?.mode==='ai-response'){const text=s.input.text;if(typeof text!=='string'||!text.trim()||text.length>4000)throw audioError('回答朗读无效。');expected=[{text,textHash:audioHash(text),sourceHash:audioHash(text),language:'zh',variant:'interpretive',start:0,end:text.length}];}
  else expected=prepareReading(book,s.input).clips;
  if(expected.length!==s.clips.length||audioHash(expected)!==s.contentHash)throw audioError('备份文字与当前原文不一致。');
  const clips=s.clips.map((c,i)=>{if(!validId(c.id)||!['Sulafat','Kore','Charon','Puck'].includes(c.voice)||c.text!==expected[i].text)throw audioError('声音片段无效。');const file=files.get(c.checksum);if(file&&file.mimeType!==c.mimeType)throw audioError('声音格式不一致。');return {...expected[i],id:c.id,voice:c.voice,status:file?'ready':'pending',...(file?{checksum:c.checksum,mimeType:file.mimeType,bytes:file.bytes.length}:{})};});
  const position=s.position;if(!position||!Number.isInteger(position.clipIndex)||position.clipIndex<0||position.clipIndex>=clips.length||!Number.isFinite(position.seconds)||position.seconds<0||position.seconds>86400)throw audioError('听读位置无效。');
  return {id:s.id,idempotencyKey:s.idempotencyKey,input:s.input,...(snapshot?{dialogueSnapshot:snapshot}:{}),requestHash:audioHash(s.input),contentHash:s.contentHash,model:s.model||'restored-model',bookId:book.bookId,contentVersion:book.contentVersion,chapterId:s.chapterId,language:s.language,variant:s.variant,mode:s.mode,clips,position,createdAt:s.createdAt,status:clips.every(c=>c.status==='ready')?'ready':'interrupted'};
 });return {sessions,dialogues,files};
}
export function createAudioBackup({audio,store,getBook}){
 return {async exportAudio({owner,bookId,includeAudio=false}){
  const book=await getBook(owner,bookId),data=await audio.readData(owner,bookId),sessions=data.sessions.map(s=>({...s,clips:s.clips.map(({cacheKey,generationId,...c})=>c)})),files=new Map();
  if(includeAudio)for(const s of data.sessions)for(const c of s.clips)if(c.status==='ready'&&!files.has(c.checksum)){const bytes=await store.getClip(c.cacheKey);files.set(c.checksum,{checksum:c.checksum,mimeType:c.mimeType,base64:bytes.toString('base64')});}
  const result={kind:'marginalia-audio-backup',schemaVersion:1,bookId,contentVersion:book.contentVersion,dialogues:data.dialogues,sessions,preferences:await audio.getPreferences(owner),audio:[...files.values()]};if(Buffer.byteLength(JSON.stringify(result))>32*1024*1024)throw audioError('听读备份超过 32 MB，请先仅导出讲稿，分别下载音频。',413);return result;
 },async restoreAudio({owner,bookId,backup}){
  const book=await getBook(owner,bookId),validated=validateAudioBackup(book,backup);await audio.getPreferences(owner); // Authentication precedes every write.
  const prefs=backup.preferences||{};if(['narrator','guide','questioner'].some(k=>prefs[k]!==undefined&&!['Sulafat','Kore','Charon','Puck'].includes(prefs[k]))||prefs.speed!==undefined&&(!Number.isFinite(prefs.speed)||prefs.speed<0.75||prefs.speed>1.5)||prefs.follow!==undefined&&typeof prefs.follow!=='boolean')throw audioError('备份声音偏好无效。');
  const prior=await audio.readData(owner,bookId);for(const d of validated.dialogues){const old=prior.dialogues.find(x=>x.id===d.id);if(old&&audioHash(old.turns)!==audioHash(d.turns))throw audioError('现有修改稿与备份不同，未覆盖。',409);}
  for(const s of validated.sessions)for(const c of s.clips){c.cacheKey=clipCacheKey([owner.id,bookId],c,c.voice,s.model,'');if(c.status==='ready')await store.putClip(c.cacheKey,validated.files.get(c.checksum).bytes);}
  await store.mutate(owner.id,bookId,d=>{for(const s of validated.sessions)if(!d.sessions.some(x=>x.id===s.id))d.sessions.push(s);for(const row of validated.dialogues)if(!d.dialogues.some(x=>x.id===row.id))d.dialogues.push(row);return null;});await audio.savePreferences(owner,prefs);return {sessions:validated.sessions.length,dialogues:validated.dialogues.length};
 }};
}
