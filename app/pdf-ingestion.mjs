// Bounded requests let a large scan outlive one serverless invocation.
export async function uploadPdf({file,api,onProgress,assertCurrent=()=>{}}){
 const bytes=await file.arrayBuffer();assertCurrent();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const upload=await api('/api/library/pdf-upload/start',{filename:file.name,bytes:file.size,sha256:hash,consent:true});
 const received=new Set(upload.received||[]);
 for(let i=0;i<upload.count;i++){
  if(received.has(i))continue;
  assertCurrent();const blob=file.slice(i*upload.partBytes,Math.min(file.size,(i+1)*upload.partBytes));
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('无法读取这一部分文件'));reader.readAsDataURL(blob);});
  await api('/api/library/pdf-upload/'+upload.id+'/part',{index:i,base64});onProgress('正在保存原文件 '+Math.round((i+1)/upload.count*100)+'%');
 }
 assertCurrent();onProgress('原文件已保存，正在核对页数…');return api('/api/library/pdf-upload/'+upload.id+'/complete',{});
}
export async function advancePdf({id,api,onProgress,shouldContinue=()=>true}){
 let job=await api('/api/library/ingestion/'+id);
 while(!['done','failed','cancelled','needs_review'].includes(job.state)&&shouldContinue()){
  onProgress(job.state==='preparing'?'正在拆分扫描页…':job.state==='publishing'?'全部页面已识别，正在入库…':'已识别 '+job.completedPages+' / '+job.totalPages+' 页');
  job=await api('/api/library/ingestion/'+id+'/advance',{});
  if(job.state==='running'&&shouldContinue())await new Promise(resolve=>setTimeout(resolve,1500));
 }
 if(job.state==='done')return job;
 if(['failed','needs_review'].includes(job.state))throw Error(job.error||'识别未完成，已保留进度。');
 return job;
}
