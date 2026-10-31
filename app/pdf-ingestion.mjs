// Bounded requests let a large scan outlive one serverless invocation.
export async function uploadPdf({file,api,onProgress=()=>{},assertCurrent=()=>{}}){
 onProgress({id:'pdf.upload.checking'});
 const bytes=await file.arrayBuffer();assertCurrent();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');assertCurrent();
 const upload=await api('/api/library/pdf-upload/start',{filename:file.name,bytes:file.size,sha256:hash,mode:/\.pdf$/i.test(file.name)?'auto':'document',consent:false});
 if(upload.job){assertCurrent();onProgress({id:upload.job.state==='done'?'pdf.upload.existing':'pdf.upload.resumed'});return upload.job;}
 const received=new Set(upload.received||[]);let completed=received.size,failure=null,next=0,useInline=upload.transport!=='signed';
 const check=()=>{assertCurrent();if(failure)throw failure;};
 const sendPart=async i=>{
  check();const blob=file.slice(i*upload.partBytes,Math.min(file.size,(i+1)*upload.partBytes));
  let inline=useInline;
  if(!inline){
   const partHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');check();
   const target=await api('/api/library/pdf-upload/'+upload.id+'/target',{index:i,sha256:partHash});check();
   let response;try{response=await fetch(target.url,{method:target.method||'PUT',headers:target.headers||{'Content-Type':'application/octet-stream'},body:blob,credentials:'omit',referrerPolicy:'no-referrer'});}catch{check();inline=true;useInline=true;}check();
   if(response?.ok){await api('/api/library/pdf-upload/'+upload.id+'/commit',{index:i,sha256:partHash});check();}else {inline=true;useInline=true;}
  }
  if(inline){
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Object.assign(Error('pdf.upload.readError'),{messageId:'pdf.upload.readError'}));reader.readAsDataURL(blob);});check();
   await api('/api/library/pdf-upload/'+upload.id+'/part',{index:i,base64});check();
  }
  onProgress({id:'pdf.upload.saved',params:{percent:Math.round(++completed/upload.count*100)}});
 };
 const worker=async()=>{try{while(next<upload.count){const index=next++;if(!received.has(index))await sendPart(index);}}catch(error){failure??=error;}};
 await Promise.all(Array.from({length:upload.transport==='signed'?2:1},worker));if(failure)throw failure;
 assertCurrent();onProgress({id:'pdf.upload.verifying'});const job=await api('/api/library/pdf-upload/'+upload.id+'/complete',{});assertCurrent();return job;
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
