// Bounded requests let a large scan outlive one serverless invocation.
export async function uploadPdf({file,api,onProgress=()=>{},assertCurrent=()=>{}}){
 onProgress('正在核对原文件，已有的书会直接打开…');
 const bytes=await file.arrayBuffer();assertCurrent();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const upload=await api('/api/library/pdf-upload/start',{filename:file.name,bytes:file.size,sha256:hash,mode:'auto',consent:false});
 if(upload.job){assertCurrent();onProgress(upload.job.state==='done'?'这本书已在书房，正在打开…':'已找回原文件与整理进度…');return upload.job;}
 const received=new Set(upload.received||[]);
 for(let i=0;i<upload.count;i++){
  if(received.has(i))continue;
  assertCurrent();const blob=file.slice(i*upload.partBytes,Math.min(file.size,(i+1)*upload.partBytes));
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('无法读取这一部分文件'));reader.readAsDataURL(blob);});
  await api('/api/library/pdf-upload/'+upload.id+'/part',{index:i,base64});onProgress('正在保存原文件 '+Math.round((i+1)/upload.count*100)+'%');
 }
 assertCurrent();onProgress('原文件已保存，正在核对页数…');return api('/api/library/pdf-upload/'+upload.id+'/complete',{});
}
export async function advancePdf({id,api,onProgress=()=>{},shouldContinue=()=>true,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const read=async()=>{for(let n=0;n<4;n++){try{return await api('/api/library/ingestion/'+id);}catch(error){if(n===3||!shouldContinue())throw error;onProgress('连接暂时中断，正在找回原来的整理进度…');await pause(Math.min(8000,1000*2**n));}}};
 let job=await read();
 while(!['done','failed','cancelled','needs_review','awaiting_consent'].includes(job.state)&&shouldContinue()){
  onProgress(job.state==='preparing'?'正在逐页检查原文件…':job.state==='publishing'?'全部页面已整理，正在放进书房…':'已整理 '+job.completedPages+' / '+job.totalPages+' 页');
  await pause(2500);if(shouldContinue())job=await read();
 }
 if(job.state==='done')return job;
 if(['failed','needs_review'].includes(job.state))throw Error(job.error||'识别未完成，已保留进度。');
 return job;
}
