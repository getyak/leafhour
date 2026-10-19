import {pdfJobPresentation,createPdfJobMemory,showPdfJob} from './pdf-onboarding-state.mjs';
import {t,getUiLocale,onUiLocaleChange,uiReady} from './ui-locale.mjs';
export function mountPdfOnboarding({document,root,api,getSession,capture,isCurrent,onOpen,onDone=()=>{}}){
 let storage=null;try{storage=document.defaultView?.localStorage;}catch{}const memory=createPdfJobMemory({storage}),owner=()=>getSession()?.user?.id;
 const rows=new Map(),watched=new Set(),notified=new Set(),listeners=[];let timer=null,generation=0,loading=false,disposed=false,previewLabels=[],previewIntent=0,ownedCloseEvents=0;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const say=(node,id,params)=>{node.textContent=t(id,params);return node;};
 const label=(list,node,id,params)=>{list.push({node,id,params});return say(node,id,params);};
 const relabel=list=>{for(const {node,id,params}of list)say(node,id,params);};
 const listen=(node,event,fn)=>{node?.addEventListener(event,fn);listeners.push(()=>node?.removeEventListener(event,fn));};
 const preview=document.createElement('dialog');preview.className='pdf-preview-dialog';document.body.append(preview);
 // Invalidate at the user's close intent. Native close events arrive in a
 // later task and must not invalidate a newer request started in between.
 function closePreview(){previewIntent++;if(preview.open){ownedCloseEvents++;preview.close();}}
 const error=make('p','muted');error.setAttribute('role','status');
 const button=(list,id,fn)=>{const b=label(list,make('button','text-link'),id);b.type='button';b.addEventListener('click',()=>{if(!disposed)fn();});return b;};
 function updateLabels(){
  if(disposed)return;
  root.setAttribute('lang',getUiLocale());preview.setAttribute('lang',getUiLocale());preview.setAttribute('aria-label',t('pdf.preview.title'));error.textContent=t('pdf.progress.unavailable');relabel(previewLabels);
  for(const row of rows.values()){
   row.status.textContent=row.error?t('pdf.action.failed'):pdfJobPresentation(row.job,{format:t}).status;
   row.bar.setAttribute('aria-label',t('pdf.progress.label'));relabel(row.labels);
  }
 }
 async function showPreview(job,trigger){
  const ticket=capture(),revision=generation,intent=++previewIntent,result=await api('/api/library/ingestion/'+job.id+'/preview',undefined,ticket);if(disposed||revision!==generation||intent!==previewIntent||!isCurrent(ticket))return;
  preview.replaceChildren();previewLabels=[];
  const close=button(previewLabels,'pdf.preview.close',()=>{closePreview();if(trigger.isConnected)trigger.focus();});close.className='dialog-close';
  preview.append(close,make('h2','',job.filename),label(previewLabels,make('p','muted'),'pdf.preview.progress',{completed:result.completedPages,total:result.totalPages}),label(previewLabels,make('p','muted'),'pdf.preview.help'));
  const pages=make('div','pdf-preview-pages');for(const page of result.pages){const section=make('section');section.append(label(previewLabels,make('h3'),'pdf.preview.page',{page:page.page}),make('p','pdf-preview-text',page.text));pages.append(section);}preview.append(pages);preview.showModal();close.focus();
 }
 async function act(job,action,row,trigger){
  if(disposed)return;const ticket=capture(),revision=generation,current=()=>!disposed&&revision===generation&&isCurrent(ticket);row.busy=true;for(const b of row.actions.querySelectorAll('button'))b.disabled=true;
  try{
   if(action==='open'){opened(job);onOpen(job.bookId);return;}
   if(action==='preview'){await showPreview(job,trigger);return;}
   const path=action==='consent'?'consent':action==='cancel'?'cancel':'resume';
   const result=await api('/api/library/ingestion/'+job.id+'/'+path,action==='consent'?{confirm:true,sourceHash:job.sourceHash}:{},ticket);
   if(current()){row.busy=false;render(result);await refresh();}
  }catch{if(current()){row.error=true;say(row.status,'pdf.action.failed');}}
  finally{if(current()){row.busy=false;for(const b of row.actions.querySelectorAll('button'))b.disabled=false;if(action!=='preview'){if(trigger.isConnected)trigger.focus();else row.node.querySelector('button')?.focus();}}}
 }
 function render(job){
  if(disposed)return;
  let row=rows.get(job.id);if(!row){const node=make('section','pdf-job'),title=make('h3','',job.filename),status=make('p','pdf-job-status'),bar=make('progress'),detail=make('div','pdf-job-detail'),actions=make('div','pdf-job-actions');status.setAttribute('role','status');node.append(title,status,bar,detail,actions);row={node,status,bar,detail,actions,signature:null,busy:false,labels:[]};rows.set(job.id,row);root.append(node);}
  row.job=job;row.error=false;row.status.textContent=pdfJobPresentation(job,{format:t}).status;row.bar.max=job.totalPages||1;row.bar.value=job.completedPages||0;
  if(job.state!=='done'&&!watched.has(job.id)){watched.add(job.id);memory.watch(owner(),job.id);}
  const model=pdfJobPresentation(job,{format:t}),signature=job.state+'|'+model.actions.join(',');
  if(signature!==row.signature&&!row.busy){row.signature=signature;row.labels=[];row.actions.replaceChildren();row.detail.replaceChildren();
   if(job.state==='awaiting_consent'){
    row.detail.append(label(row.labels,make('p'),'pdf.consent.pages',{recognition:job.recognitionPages,total:job.totalPages}),label(row.labels,make('p','muted'),'pdf.consent.usage'));
    const privacy=make('details'),summary=label(row.labels,make('summary'),'pdf.privacy.title');privacy.append(summary,label(row.labels,make('p','muted'),'pdf.privacy.help'));row.detail.append(privacy);
    if(!job.ocrAvailable)row.detail.append(label(row.labels,make('p','muted'),'pdf.ocr.unavailable'));
   }else if(['preparing','running','publishing'].includes(job.state))row.detail.append(label(row.labels,make('p','muted'),'pdf.running.help'));
   for(const action of model.actions){let control;control=button(row.labels,'pdf.action.'+action,()=>act(row.job,action,row,control));if(action==='consent'||action==='open')control.className='primary small';row.actions.append(control);}
  }
  row.bar.setAttribute('aria-label',t('pdf.progress.label'));root.hidden=false;
  if(job.state==='done'&&watched.has(job.id)&&!notified.has(job.id)){notified.add(job.id);onDone(job);}
 }
 async function refresh(){
  clearTimeout(timer);if(disposed||loading||!getSession()?.user)return;if(document.hidden){timer=setTimeout(refresh,10000);return;}
  loading=true;const revision=generation,ticket=capture();let delay=10000;
  try{const {jobs}=await api('/api/library/ingestion',undefined,ticket);if(disposed||revision!==generation||!isCurrent(ticket))return;error.remove();
   for(const id of memory.pending(owner()))watched.add(id);const visible=jobs.filter(j=>showPdfJob(j,{known:rows.has(j.id),memory,owner:owner()}));for(const job of visible)render(job);root.hidden=!visible.length;
   delay=visible.some(j=>['preparing','running','publishing'].includes(j.state))?2500:visible.some(j=>!['done','cancelled'].includes(j.state))?10000:0;
  }catch{if(!disposed&&revision===generation&&isCurrent(ticket)){say(error,'pdf.progress.unavailable');if(rows.size)root.append(error);}}
  finally{loading=false;if(disposed)return;if(revision!==generation){if(getSession()?.user)timer=setTimeout(refresh,0);}else if(delay)timer=setTimeout(refresh,delay);}
 }
 function track(job){if(disposed)return;watched.add(job.id);memory.watch(owner(),job.id);render(job);refresh();}
 function opened(job){if(disposed)return;memory.opened(owner(),job.id);watched.delete(job.id);}
 function reset(){generation++;closePreview();clearTimeout(timer);rows.clear();watched.clear();notified.clear();root.replaceChildren();root.hidden=true;preview.replaceChildren();previewLabels=[];}
 listen(preview,'cancel',event=>{event.preventDefault();closePreview();});
 listen(preview,'close',()=>{if(ownedCloseEvents)ownedCloseEvents--;else previewIntent++;});
 listen(document,'visibilitychange',()=>{if(!document.hidden)refresh();});listen(document.defaultView,'pagehide',()=>clearTimeout(timer));listen(document.defaultView,'pageshow',()=>refresh());
 const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();
 return {refresh,track,reset,opened,updateLabels,dispose(){if(disposed)return;disposed=true;offLocale();for(const off of listeners)off();reset();preview.remove();}};
}
