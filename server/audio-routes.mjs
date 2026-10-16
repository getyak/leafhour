import {mediaConfiguration} from './media-config.mjs';import {audioError} from './audio-content.mjs';
import {createAudioBackup} from './audio-backup.mjs';
import {estimateAudio} from './audio-estimate.mjs';
export function createAudioRoutes({audio,library}){
 const backup=audio?createAudioBackup({audio,store:audio.store,getBook:library.getBook}):null;
 return {async handle({req,res,user,bookId,action,body,send}){
  if(action==='capabilities'&&req.method==='GET'){await library.getBook(user,bookId);send(200,audio?audio.capabilities():{...mediaConfiguration({}).public,speechAvailable:false,dialogueAvailable:false,local:false,reason:'此实例暂未开启听读，仍可继续阅读。'});return true;}
  if(!user?.id)throw audioError('请先进入自己的书房，再准备声音。',401,'authentication_required');
  await library.getBook(user,bookId);if(!audio)throw audioError('此实例暂未开启听读，请在本机书房使用。',503,'not_configured');
  const get=req.method==='GET',post=req.method==='POST';
  if(action==='export'&&get){res.setHeader('Content-Disposition','attachment; filename="leafhour-audio-backup.json"');send(200,await backup.exportAudio({owner:user,bookId,includeAudio:new URL(req.url,'http://reader.local').searchParams.get('audio')!=='0'}));return true;}
  if(action==='import'&&post){send(200,await backup.restoreAudio({owner:user,bookId,backup:body}));return true;}
  if(action==='validate'&&post){const {validateAudioBackup}=await import('./audio-backup.mjs');const valid=validateAudioBackup(await library.getBook(user,bookId),body);send(200,{sessions:valid.sessions.length,dialogues:valid.dialogues.length});return true;}
  if(action==='prepare'&&post){const prepared=await audio.prepare(user,bookId,body);send(200,{...prepared,estimate:estimateAudio(prepared.clips,audio.capabilities().speechModel),externalProcessing:true});return true;}
  if(action==='preferences'){if(get)send(200,await audio.getPreferences(user));else if(post)send(200,await audio.savePreferences(user,body));else return false;return true;}
  if(action==='records'&&get){send(200,await audio.listRecords(user,bookId));return true;}
  if(action==='sessions'&&post){send(202,await audio.createSession(user,bookId,body));return true;}
  const session=action.match(/^sessions\/([A-Za-z0-9-]+)(\/cancel)?$/);
  if(session){if(session[2]&&post)send(200,await audio.cancelSession(user,bookId,session[1]));else if(!session[2]&&get)send(200,await audio.getSession(user,bookId,session[1]));else return false;return true;}
  if(action==='position'&&post){send(200,await audio.savePosition(user,bookId,body));return true;}
  const clip=action.match(/^clips\/([A-Za-z0-9-]+)$/);if(clip&&get){const {bytes,mimeType}=await audio.getClip(user,bookId,clip[1]);res.statusCode=200;res.setHeader('Content-Type',mimeType);res.setHeader('Content-Length',bytes.length);res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition','inline; filename="leafhour-audio.'+(mimeType==='audio/wav'?'wav':'mp3')+'"');res.end(bytes);return true;}
  if(action==='dialogues'&&post){send(201,await audio.createDialogue(user,bookId,body));return true;}
  const dialogue=action.match(/^dialogues\/([A-Za-z0-9-]+)$/);if(dialogue){if(get)send(200,await audio.getDialogue(user,bookId,dialogue[1]));else if(post)send(200,await audio.editDialogue(user,bookId,dialogue[1],body));else return false;return true;}
  return false;
 }};
}
