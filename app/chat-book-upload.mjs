import {createBookUploadController} from './book-upload-controller.mjs';
import {t,getUiLocale,onUiLocaleChange,uiHref} from './ui-locale.mjs';

export const uploadedBookHref=bookId=>uiHref('/read?book='+encodeURIComponent(bookId));

// Card nodes and controls survive every progress and language update.
export function mountChatBookUpload({root,document=root.ownerDocument||globalThis.document,host,actionsHost,attachment:existingAttachment,controller,api,getOwner,getSession,request,storage=null,signedIn,openAuth,onSelect=()=>{},navigate=url=>location.assign(url)}){
 const ownsController=!controller;controller=controller||createBookUploadController({api,getOwner,getSession,request,storage});
 const rows=new Map(),listeners=[];let disposed=false,dragDepth=0;
 const make=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n;};
 const listen=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
 const attachment=existingAttachment||make('button','chat-book-attach');attachment.type='button';if(!existingAttachment)attachment.textContent='＋';
 const picker=make('input','chat-book-picker');picker.type='file';picker.accept='.pdf,.epub,.txt,.md';picker.hidden=true;if(!existingAttachment)actionsHost.append(attachment);actionsHost.append(picker);
 const notice=make('p','chat-book-notice');notice.setAttribute('role','status');notice.hidden=true;host.append(notice);
 function add(file){if(disposed||!file)return null;if(!signedIn()){openAuth();return null;}try{const id=controller.start(file);notice.hidden=true;return id;}catch{notice.textContent=t('portal.upload.invalid');notice.hidden=false;host.hidden=false;return null;}}
 const actionsFor=task=>task.stage==='ready'?['open','select']:task.stage==='cancelled'?[]:task.stage==='permission'?(task.job?.ocrAvailable?['consent','cancel']:['cancel']):task.stage==='interrupted'?['retry','cancel']:task.stage==='review'?['reconcile','cancel']:['cancel'];
 function rowFor(task){
  let row=rows.get(task.id);if(row)return row;
  const card=make('article','chat-book-task'),heading=make('div','chat-book-task-heading'),type=make('span','chat-book-type'),name=make('h3','chat-book-filename'),status=make('p','chat-book-stage'),progress=make('progress','chat-book-progress'),actions=make('div','chat-book-actions');status.setAttribute('role','status');status.setAttribute('aria-live','polite');heading.append(type,name);card.append(heading,status,progress,actions);card.setAttribute('data-upload-id',task.id);
  row={card,type,name,status,progress,actions,controls:new Map(),task};rows.set(task.id,row);host.append(card);return row;
 }
 function paint(task){
  const row=rowFor(task);row.task=task;row.name.textContent=task.filename;row.type.textContent=task.filename?.split('.').pop()?.toUpperCase()||'';
  const status=t(task.error?'bookUpload.error':({receiving:'portal.upload.storing',organizing:'portal.upload.organizing'})[task.stage]||'bookUpload.'+task.stage);if(row.status.textContent!==status)row.status.textContent=status;
  row.progress.hidden=!['receiving','organizing'].includes(task.stage);row.progress.max=100;
  if(Number.isFinite(task.percent))row.progress.value=task.percent;else row.progress.removeAttribute?.('value');
  row.progress.setAttribute('aria-label',t('pdf.progress.label'));row.card.setAttribute('lang',getUiLocale());
  const visible=actionsFor(task);
  for(const action of ['open','select','consent','retry','reconcile','cancel']){
   let control=row.controls.get(action);
   if(!control){control=make('button','library-chat-text-button chat-book-'+action);control.type='button';row.controls.set(action,control);row.actions.append(control);control.addEventListener('click',()=>{if(disposed||!rows.has(task.id))return;const current=row.task;if(action==='open'){controller.opened(current.id);navigate(uploadedBookHref(current.bookId));}else if(action==='select')onSelect(current.bookId);else if(action==='retry')void controller.retry(current.id);else if(action==='cancel')void controller.cancel(current.id);else void controller.act(current.id,action);});}
   control.textContent=t(({open:'pdf.action.open',retry:'portal.upload.retry',reconcile:'pdf.action.reconcile',cancel:'pdf.action.cancel'})[action]||'bookUpload.action.'+action);control.hidden=!visible.includes(action);control.disabled=!!task.busy&&!(action==='cancel'&&!task.job);
  }
 }
 function render(tasks){if(disposed)return;const ids=new Set(tasks.map(task=>task.id));for(const [id,row]of rows)if(!ids.has(id)){row.card.remove();rows.delete(id);}for(const task of tasks)paint(task);host.hidden=!tasks.length&&notice.hidden;attachment.disabled=false;attachment.setAttribute('aria-label',t('nav.bring'));attachment.setAttribute('title',t('nav.bring'));}
 if(root.open)void controller.refresh();
 const unsubscribe=controller.subscribe(render),offLocale=onUiLocaleChange(()=>{render(controller.tasks());if(!notice.hidden)notice.textContent=t('portal.upload.invalid');});
 listen(root,'reading-chat-open',()=>void controller.refresh());
 listen(attachment,'click',()=>signedIn()?picker.click():openAuth());listen(picker,'change',()=>{add(picker.files?.[0]);picker.value='';});
 const files=event=>event.dataTransfer?.files?.length||Array.from(event.dataTransfer?.types||[]).includes('Files');
 for(const event of ['dragenter','dragover'])listen(root,event,e=>{if(!files(e))return;e.preventDefault();if(event==='dragenter')dragDepth++;root.classList.add('is-file-drag');if(e.dataTransfer)e.dataTransfer.dropEffect='copy';});
 listen(root,'dragleave',()=>{if(--dragDepth<=0){dragDepth=0;root.classList.toggle('is-file-drag',false);}});
 listen(root,'drop',event=>{if(!files(event))return;event.preventDefault();dragDepth=0;root.classList.toggle('is-file-drag',false);add(event.dataTransfer.files?.[0]);});
 return {controller,add,books(list){list=Array.isArray(list)?[...list]:[];for(const task of controller.tasks())if(task.stage==='ready'&&task.bookId&&!list.some(book=>book.bookId===task.bookId))list.push({bookId:task.bookId,title:task.job?.title||{en:task.filename}});return list;},update:()=>render(controller.tasks()),dispose(){if(disposed)return;disposed=true;if(ownsController)controller.dispose();unsubscribe();offLocale();for(const off of listeners)off();rows.clear();}};
}
