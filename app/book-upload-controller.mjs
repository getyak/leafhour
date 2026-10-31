import {uploadPdf as sendPdf} from './pdf-ingestion.mjs';
import {createUploadState} from './upload-state.mjs';
import {createPdfJobMemory,showPdfJob} from './pdf-onboarding-state.mjs';

const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('read'));reader.readAsDataURL(file);});
const stage=job=>({done:'ready',cancelled:'cancelled',awaiting_consent:'permission',failed:'interrupted',needs_review:'review'})[job.state]||'organizing';

// One page owns this controller. It never touches chat drafts or generates a turn.
export function createBookUploadController({api,getOwner,getSession,uploadPdf=sendPdf,readBase64=readFile,request=fetch,storage=null,pollMs=2500,onReady=()=>{},document=globalThis.document}){
 let owner=getOwner()||null,revision=0,disposed=false,sequence=0,timer=null,refreshing=null;
 const records=new Map(),listeners=new Set(),memory=createPdfJobMemory({storage});
 const current=(captured,version)=>!disposed&&captured===owner&&captured===(getOwner()||null)&&version===revision;
 const emit=()=>{if(!disposed)for(const listener of listeners)listener(tasks());};
 const tasks=()=>[...records.values()].map(({file,run,...task})=>({...task,job:task.job?{...task.job}:null}));
 const schedule=()=>{clearTimeout(timer);if(!disposed&&owner&&!document?.hidden&&[...records.values()].some(r=>['preparing','running','publishing'].includes(r.job?.state))){timer=setTimeout(()=>void refresh(),pollMs);timer.unref?.();}};
 function syncOwner(){const next=getOwner()||null;if(next===owner)return false;owner=next;revision++;clearTimeout(timer);refreshing=null;records.clear();emit();return true;}
 const fence=(captured,version,record,run)=>{if(!current(captured,version)||record.stage==='cancelled'||run!==record.run)throw Error('inactive-upload');};
 function accept(record,job){for(const [id,other]of records)if(other!==record&&job.id&&other.job?.id===job.id)records.delete(id);record.job=job;record.stage=stage(job);record.bookId=job.bookId||null;record.percent=null;record.busy=false;record.error=false;record.errorMessage=null;if(job.id&&record.stage!=='ready')memory.watch(owner,job.id);emit();if(record.stage==='ready'&&!record.notified){record.notified=true;record.file=null;try{onReady({bookId:job.bookId,title:job.title||{en:record.filename},job});}catch{}}schedule();}
 async function transfer(record){
  const captured=owner,version=revision,run=++record.run;record.stage='receiving';record.percent=null;record.busy=true;record.error=false;record.errorMessage=null;emit();
  const assertCurrent=()=>fence(captured,version,record,run);
  const scopedApi=async(path,body)=>{
   assertCurrent();const result=await api(path,body);
   // The start/complete request can commit just before local cancellation.
   const job=result?.job||(result?.state&&result?.id?result:null);
   if(current(captured,version)&&record.stage==='cancelled'&&job&&job.state!=='done')await api('/api/library/ingestion/'+encodeURIComponent(job.id)+'/cancel',{});
   assertCurrent();return result;
  };
  try{
   let result;
   if(/\.pdf$/i.test(record.filename)||getSession()?.documentChunks)result=await uploadPdf({file:record.file,api:scopedApi,assertCurrent,onProgress:update=>{if(current(captured,version)&&record.run===run&&record.stage!=='cancelled'){record.percent=Number.isFinite(update.params?.percent)?update.params.percent:null;if(update.id==='pdf.upload.verifying')record.stage='organizing';emit();}}});
   else if(getSession()?.directUpload){
    const target=await scopedApi('/api/library/upload/start',{filename:record.filename,bytes:record.file.size});assertCurrent();
    const response=await request(target.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:record.file});assertCurrent();if(!response.ok)throw Error('upload');record.stage='organizing';emit();result=await scopedApi('/api/library/upload/complete',{id:target.id,...(getSession()?.documentJobs?{defer:true}:{})});
   }else{const base64=await readBase64(record.file);assertCurrent();record.stage='organizing';emit();result=await scopedApi('/api/library/upload',{filename:record.filename,base64,...(getSession()?.documentJobs?{defer:true}:{})});}
   if(!current(captured,version))return;
   if(record.stage==='cancelled'){if(result?.id&&result.state!=='done')await api('/api/library/ingestion/'+encodeURIComponent(result.id)+'/cancel',{});return;}
   assertCurrent();accept(record,result.state?result:{...result,state:'done'});
  }catch(error){if(current(captured,version)&&record.run===run&&record.stage!=='cancelled'){record.stage='interrupted';record.busy=false;record.error=true;record.errorMessage=Number.isInteger(error.status)&&error.status>=400&&error.status<500?String(error.message).slice(0,400):null;emit();}}
 }
 function start(file){if(disposed)return null;syncOwner();if(!owner)return null;const validator=createUploadState();validator.select(file);const duplicate=[...records.values()].find(r=>r.file===file&&!['ready','cancelled'].includes(r.stage));if(duplicate)return duplicate.id;
  const id='upload-'+(++sequence),record={id,filename:file.name,file,createdAt:new Date().toISOString(),stage:'receiving',percent:null,job:null,bookId:null,busy:true,run:0};records.set(id,record);void transfer(record);return id;
 }
 async function act(id,action){syncOwner();const record=records.get(id);if(disposed||!record?.job||record.busy)return;const captured=owner,version=revision;record.run++;record.busy=true;record.error=false;emit();
  try{const job=record.job,path=action==='consent'?'consent':action==='cancel'?'cancel':'resume';const result=await api('/api/library/ingestion/'+encodeURIComponent(job.id)+'/'+path,action==='consent'?{confirm:true,sourceHash:job.sourceHash}:{});if(current(captured,version))accept(record,result);}
  catch{if(current(captured,version)){record.busy=false;record.error=true;emit();}}
 }
 async function cancel(id){syncOwner();const record=records.get(id);if(!record||disposed||record.stage==='ready')return;if(record.job){await act(id,'cancel');return;}record.stage='cancelled';record.error=false;record.busy=false;emit();}
 async function retry(id){syncOwner();const record=records.get(id);if(!record||disposed||record.busy)return;if(record.job)return act(id,'resume');if(record.file)return transfer(record);}
 async function refresh(){syncOwner();clearTimeout(timer);if(disposed||!owner||document?.hidden)return;if(refreshing)return refreshing;const captured=owner,version=revision,runs=new Map([...records.values()].map(r=>[r.id,r.busy?null:r.run]));
  // A read begun during an action cannot attest to that action's outcome.
  const pending=(async()=>{try{const {jobs=[]}=await api('/api/library/ingestion');if(!current(captured,version))return;for(const job of jobs){let record=[...records.values()].find(r=>r.job?.id===job.id);if(!record&&([...records.values()].some(r=>r.busy&&!r.job)||!showPdfJob(job,{memory,owner})))continue;if(!record){record={id:'job-'+job.id,filename:job.filename,run:0};records.set(record.id,record);}if(!record.busy&&(!runs.has(record.id)||runs.get(record.id)===record.run)&&!(['ready','cancelled'].includes(record.stage)&&stage(job)!==record.stage))accept(record,job);}}
   catch{ /* Keep the last known card; a later poll recovers its progress. */ }
   finally{if(current(captured,version)){refreshing=null;schedule();}}})();refreshing=pending;return pending;
 }
 const visibility=()=>{if(document.hidden)clearTimeout(timer);else void refresh();};
 document?.addEventListener?.('visibilitychange',visibility);
 return {start,tasks,act,cancel,retry,refresh,syncOwner,subscribe(listener){listeners.add(listener);listener(tasks());return ()=>listeners.delete(listener);},opened(id){const job=records.get(id)?.job;if(job?.id)memory.opened(owner,job.id);},dispose(){if(disposed)return;disposed=true;revision++;clearTimeout(timer);document?.removeEventListener?.('visibilitychange',visibility);listeners.clear();records.clear();}};
}
