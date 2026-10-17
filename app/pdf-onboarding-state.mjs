export function pdfJobPresentation(job){
 const progress=(job.completedPages||0)+' / '+job.totalPages+' 页',actions=[];
 let status=job.state==='preparing'?'正在检查原文件':job.state==='publishing'?'全部页面已整理，正在放进书房':'正在自动整理';
 if(job.state==='done')return {status:'整本已可阅读 · '+progress,actions:['open']};
 if(job.state==='cancelled')return {status:'已取消整理 · '+progress,actions:[]};
 if(job.completedPages>0)actions.push('preview');
 if(job.state==='awaiting_consent'){status='需要允许识别扫描页';if(job.ocrAvailable)actions.push('consent');}
 if(job.state==='failed'){status=job.error||'整理暂未完成，原文件和进度已保留';actions.push('resume');}
 if(job.state==='needs_review'){status='正在等待核对上次识别请求，未重复提交';actions.push('reconcile');}
 actions.push('cancel');return {status:status+' · '+progress,actions};
}
