import path from 'node:path';import {pathToFileURL} from 'node:url';import {mkdir,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';

export function guideOptions(argv){
 const options={intent:'intro',generate:false,includeAudio:false};
 const keys={'--book':'bookId','--owner-id':'ownerId','--chapter':'chapterId','--through':'throughPassageId','--intent':'intent'};
 for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--generate')options.generate=true;else if(key==='--include-audio')options.includeAudio=true;else if(keys[key]&&argv[i+1]&&!argv[i+1].startsWith('--'))options[keys[key]]=argv[++i];else throw Error('Unknown or incomplete option: '+key);}
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(options.bookId||'')||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.ownerId||''))throw Error('Provide --book and --owner-id using the verified Supabase Auth user ID.');
 if(!['intro','explain','book'].includes(options.intent)||options.includeAudio&&!options.generate)throw Error('Choose intro, explain or book; --include-audio requires --generate.');
 return options;
}

async function main(){
 const options=guideOptions(process.argv.slice(2));
 const {loadLocalEnvironment}=await import('../server/local-env.mjs');await loadLocalEnvironment();
 const {createPortal}=await import('../server/portal.mjs');
 const {createListeningGuideService}=await import('../server/listening-guide-service.mjs');
 const {createAudioBackup}=await import('../server/audio-backup.mjs');
 const root=process.cwd(),dataDir=path.join(root,'local/service/portal'),portal=await createPortal({dataDir,sendCode:null,translator:null,chatGenerator:null,companionGenerator:null});
 try{
  const owner={id:options.ownerId},book=await portal.library.getBook(owner,options.bookId),chapterId=options.chapterId||book.readingStart?.chapterId||book.chapters.find(c=>c.kind==='body')?.id||book.chapters[0]?.id;
  const service=createListeningGuideService({audio:portal.audio,library:portal.library}),input={intent:options.intent,contentVersion:book.contentVersion,...(options.intent==='book'?{}:{chapterId}),...(options.intent==='explain'?{scopeMode:'through',throughPassageId:options.throughPassageId}:{})};
  const preview=await service.prepare(owner,book.bookId,input);console.log(JSON.stringify({dryRun:!options.generate,bookId:book.bookId,...preview}));if(!options.generate)return;
  const directory=path.join(dataDir,'library/users',createHash('sha256').update(owner.id).digest('hex'),'resources/listening',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(directory,{recursive:true,mode:0o700});
  let job=await service.create(owner,book.bookId,{...input,idempotencyKey:randomUUID(),confirmProcessing:true});await writeFile(path.join(directory,'job.json'),JSON.stringify(job,null,2)+'\n',{mode:0o600,flag:'wx'});
  const deadline=Date.now()+20*60*1000;
  while(job.status==='preparing'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1500));job=await service.get(owner,book.bookId,job.id);}
  if(job.status!=='ready')throw Error(job.error?.message||'Guide is still preparing; use its saved job ID to retrieve it.');
  let session=await portal.audio.getSession(owner,book.bookId,job.sessionId);
  while(session.status==='generating'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1500));session=await portal.audio.getSession(owner,book.bookId,session.id);}
  const backup=createAudioBackup({audio:portal.audio,store:portal.audio.store,getBook:portal.library.getBook});const artifact=await backup.exportAudio({owner,bookId:book.bookId,includeAudio:options.includeAudio});
  await writeFile(path.join(directory,'review-backup.json'),JSON.stringify(artifact,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({directory,jobId:job.id,sessionId:session.id,status:session.status,reviewRequired:true,publiclyPublished:false}));
 }finally{await portal.audio?.close();await portal.chat.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.status?error.message:'Preparation failed; inspect the saved job or configuration.');process.exitCode=1;});
