export function pdfJobPresentation(job){
 const progress=(job.completedPages||0)+' / '+job.totalPages+' 页',actions=[];
 let status=job.state==='preparing'?'正在检查原文件':job.state==='publishing'?'全部页面已整理，正在放进书房':'正在自动整理';
 if(job.state==='done')return {status:'整本已可阅读 · '+progress,actions:['open']};
 if(job.state==='cancelled')return {status:'已取消整理 · '+progress,actions:[]};
 if(job.completedPages>0)actions.push('preview');
 if(job.state==='awaiting_consent'){status='需要允许识别扫描页';if(job.ocrAvailable)actions.unshift('consent');}
 if(job.state==='failed'){status=job.error||'整理暂未完成，原文件和进度已保留';actions.push('resume');}
 if(job.state==='needs_review'){status='正在等待核对上次识别请求，未重复提交';actions.push('reconcile');}
 actions.push('cancel');return {status:status+' · '+progress,actions};
}
// Keep only task IDs and acknowledgements on this device, never source text.
export function createPdfJobMemory({storage=null,now=Date.now}={}){
 const key=owner=>'leafhour-pdf-tasks:'+encodeURIComponent(owner),valid=id=>typeof id==='string'&&/^[-a-f0-9]{36}$/.test(id);
 const read=owner=>{try{const rows=JSON.parse(storage?.getItem(key(owner))||'[]');return Array.isArray(rows)?rows.filter(r=>valid(r?.id)&&['pending','opened'].includes(r.state)&&Number.isFinite(r.at)&&now()-r.at<7*86400000&&r.at<=now()+60000).slice(-40):[];}catch{return [];}};
 const set=(owner,id,state)=>{if(!owner||!valid(id))return;try{storage?.setItem(key(owner),JSON.stringify([...read(owner).filter(r=>r.id!==id),{id,state,at:now()}].slice(-40)));}catch{}};
 return {watch:(owner,id)=>set(owner,id,'pending'),opened:(owner,id)=>set(owner,id,'opened'),pending:owner=>read(owner).filter(r=>r.state==='pending').map(r=>r.id),wasOpened:(owner,id)=>read(owner).some(r=>r.id===id&&r.state==='opened')};
}
export function showPdfJob(job,{known=false,memory,owner,now=Date.now()}={}){
 if(known)return true;if(job.state==='cancelled')return false;if(job.state!=='done')return true;if(memory?.wasOpened(owner,job.id))return false;
 const created=Date.parse(job.createdAt);return !!memory?.pending(owner).includes(job.id)||Number.isFinite(created)&&created<=now&&now-created<3600000;
}
