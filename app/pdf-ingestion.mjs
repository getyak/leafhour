// Bounded requests let a large scan outlive one serverless invocation.
export async function uploadPdf({file,api,onProgress=()=>{},assertCurrent=()=>{}}){
 onProgress({id:'pdf.upload.checking'});
 const bytes=await file.arrayBuffer();assertCurrent();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const upload=await api('/api/library/pdf-upload/start',{filename:file.name,bytes:file.size,sha256:hash,mode:'auto',consent:false});
 if(upload.job){assertCurrent();onProgress({id:upload.job.state==='done'?'pdf.upload.existing':'pdf.upload.resumed'});return upload.job;}
 const received=new Set(upload.received||[]);
 for(let i=0;i<upload.count;i++){
  if(received.has(i))continue;
  assertCurrent();const blob=file.slice(i*upload.partBytes,Math.min(file.size,(i+1)*upload.partBytes));
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Object.assign(Error('pdf.upload.readError'),{messageId:'pdf.upload.readError'}));reader.readAsDataURL(blob);});
  await api('/api/library/pdf-upload/'+upload.id+'/part',{index:i,base64});onProgress({id:'pdf.upload.saved',params:{percent:Math.round((i+1)/upload.count*100)}});
 }
 assertCurrent();onProgress({id:'pdf.upload.verifying'});return api('/api/library/pdf-upload/'+upload.id+'/complete',{});
}
export async function advancePdf({id,api,onProgress=()=>{},shouldContinue=()=>true,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const read=async()=>{for(let n=0;n<4;n++){try{return await api('/api/library/ingestion/'+id);}catch(error){if(n===3||!shouldContinue())throw error;onProgress({id:'pdf.advance.reconnect'});await pause(Math.min(8000,1000*2**n));}}};
 let job=await read();
 while(!['done','failed','cancelled','needs_review','awaiting_consent'].includes(job.state)&&shouldContinue()){
  onProgress({id:job.state==='preparing'?'pdf.advance.preparing':job.state==='publishing'?'pdf.advance.publishing':'pdf.advance.progress',params:{completed:job.completedPages,total:job.totalPages}});
  await pause(2500);if(shouldContinue())job=await read();
 }
 if(job.state==='done')return job;
 if(['failed','needs_review'].includes(job.state))throw Object.assign(Error(job.error||'pdf.advance.incomplete'),job.error?{}:{messageId:'pdf.advance.incomplete'});
 return job;
}
