import {pdfJobPresentation} from './pdf-onboarding-state.mjs';
export function mountPdfOnboarding({document,root,api,getSession,capture,isCurrent,onOpen,onDone=()=>{}}){
 const rows=new Map(),watched=new Set(),notified=new Set();let timer=null,generation=0,loading=false;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const preview=document.createElement('dialog');preview.className='pdf-preview-dialog';preview.setAttribute('aria-label','已整理页面预览');document.body.append(preview);
 const error=make('p','muted');error.setAttribute('role','status');
 const button=(text,fn)=>{const b=make('button','text-link',text);b.type='button';b.addEventListener('click',fn);return b;};
 async function showPreview(job,trigger){
  const ticket=capture(),result=await api('/api/library/ingestion/'+job.id+'/preview',undefined,ticket);if(!isCurrent(ticket))return;
  preview.replaceChildren();const close=button('关闭预览',()=>{preview.close();if(trigger.isConnected)trigger.focus();});close.className='dialog-close';preview.append(close,make('h2','',job.filename),make('p','muted','已整理 '+result.completedPages+' / '+result.totalPages+' 页 · 原文待核对'),make('p','muted','以下是已整理页面的节选，整本内容仍以最终整理结果为准。'));
  const pages=make('div','pdf-preview-pages');for(const page of result.pages){const section=make('section');section.append(make('h3','','PDF 第 '+page.page+' 页'),make('p','pdf-preview-text',page.text));pages.append(section);}preview.append(pages);preview.showModal();close.focus();
 }
 async function act(job,action,row,trigger){
  const ticket=capture();row.busy=true;for(const b of row.actions.querySelectorAll('button'))b.disabled=true;
  try{
   if(action==='open'){onOpen(job.bookId);return;}
   if(action==='preview'){await showPreview(job,trigger);return;}
   const path=action==='consent'?'consent':action==='cancel'?'cancel':'resume';
   const result=await api('/api/library/ingestion/'+job.id+'/'+path,action==='consent'?{confirm:true,sourceHash:job.sourceHash}:{},ticket);
   if(isCurrent(ticket)){row.busy=false;render(result);await refresh();}
  }catch(e){if(isCurrent(ticket))row.status.textContent=e.message+' 原文件与已完成内容仍保留。';}
  finally{if(isCurrent(ticket)){row.busy=false;for(const b of row.actions.querySelectorAll('button'))b.disabled=false;if(trigger.isConnected)trigger.focus();else row.node.querySelector('button')?.focus();}}
 }
 function render(job){
  let row=rows.get(job.id);if(!row){const node=make('section','pdf-job'),title=make('h3','',job.filename),status=make('p','pdf-job-status'),bar=make('progress'),detail=make('div','pdf-job-detail'),actions=make('div','pdf-job-actions');status.setAttribute('role','status');bar.setAttribute('aria-label','原文整理进度');node.append(title,status,bar,detail,actions);row={node,status,bar,detail,actions,signature:null,busy:false};rows.set(job.id,row);root.append(node);}
  const model=pdfJobPresentation(job);if(row.status.textContent!==model.status)row.status.textContent=model.status;row.bar.max=job.totalPages||1;row.bar.value=job.completedPages||0;
  if(job.state!=='done')watched.add(job.id);
  const signature=job.state+'|'+model.actions.join(',');
  if(signature!==row.signature&&!row.busy){row.signature=signature;row.actions.replaceChildren();row.detail.replaceChildren();
   if(job.state==='awaiting_consent'){
    row.detail.append(make('p','','已发现 '+job.recognitionPages+' 页需要识别。本书共 '+job.totalPages+' 页，允许后仅将需要识别的页面发送至 PaddleOCR 官方服务，不发送笔记或对话。'),make('p','muted','按实际识别用量占用服务额度，超额暂停，原文件与进度保留。'));
    const privacy=make('details'),summary=make('summary','','识别与隐私说明');privacy.append(summary,make('p','muted','服务方保存与删除期限尚未确认。识别结果仍需与原件核对；你可以取消后续处理。'));row.detail.append(privacy);
    if(!job.ocrAvailable)row.detail.append(make('p','muted','当前识别服务暂不可用，原文件已保存。'));
   }else if(['preparing','running','publishing'].includes(job.state))row.detail.append(make('p','muted','可以离开页面，后台会继续整理。'));
   const labels={consent:'允许识别并继续',preview:'先看看已整理的内容',resume:'继续整理',reconcile:'核对识别状态',cancel:'取消整理',open:'开始阅读'};
   for(const action of model.actions){let control;control=button(labels[action],()=>act(job,action,row,control));if(action==='consent'||action==='open')control.className='primary small';row.actions.append(control);}
  }
  root.hidden=false;
  if(job.state==='done'&&watched.has(job.id)&&!notified.has(job.id)){notified.add(job.id);onDone(job);}
 }
 async function refresh(){
  clearTimeout(timer);if(loading||!getSession()?.user)return;if(document.hidden){timer=setTimeout(refresh,10000);return;}
  loading=true;const revision=generation,ticket=capture();let delay=10000;
  try{const {jobs}=await api('/api/library/ingestion',undefined,ticket);if(revision!==generation||!isCurrent(ticket))return;error.remove();
   const visible=jobs.filter(j=>!['done','cancelled'].includes(j.state)||rows.has(j.id));for(const job of visible)render(job);root.hidden=!visible.length;
   delay=visible.some(j=>['preparing','running','publishing'].includes(j.state))?2500:visible.some(j=>!['done','cancelled'].includes(j.state))?10000:0;
  }catch{if(revision===generation&&isCurrent(ticket)){error.textContent='暂时无法读取最新进度，原任务仍保留；连接恢复后会继续显示。';if(rows.size)root.append(error);}}
  finally{loading=false;if(revision!==generation){if(getSession()?.user)timer=setTimeout(refresh,0);}else if(delay)timer=setTimeout(refresh,delay);}
 }
 function track(job){watched.add(job.id);render(job);refresh();}
 function reset(){generation++;clearTimeout(timer);rows.clear();watched.clear();notified.clear();root.replaceChildren();root.hidden=true;if(preview.open)preview.close();preview.replaceChildren();}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});document.defaultView?.addEventListener('pagehide',()=>clearTimeout(timer));document.defaultView?.addEventListener('pageshow',()=>refresh());
 return {refresh,track,reset};
}
