import {t,onUiLocaleChange} from './ui-locale.mjs';
import {paintBookCover} from './book-cover-ui.mjs';

export function importShelfPresentation(task,{format=t}={}){
 const parsed=task.job?.progress,publishing=task.job?.state==='publishing',active=['receiving','organizing'].includes(task.stage);
 const percent=publishing?null:Number.isFinite(task.percent)?task.percent:parsed?.total>0?Math.round(parsed.completed/parsed.total*100):null;
 const message=task.job?.error||task.errorMessage||(task.error?format('bookUpload.error'):publishing?format('bookUpload.saving'):task.stage==='organizing'&&parsed?.total?format('bookUpload.parsing',parsed):format(({receiving:'portal.upload.storing',organizing:'portal.upload.organizing'})[task.stage]||'bookUpload.'+task.stage));
 return {active,percent,message};
}

// Task cards live beside the shelf, independent of chat, filters and reading progress.
export function mountBookImportShelf({root,controller,getBooks=()=>[],navigate=url=>location.assign(url)}){
 const doc=root.ownerDocument,rows=new Map();let disposed=false;
 const el=(tag,cls)=>{const node=doc.createElement(tag);if(cls)node.className=cls;return node;};
 const heading=el('h2','import-shelf-title'),grid=el('div','import-shelf-grid');root.append(heading,grid);
 const label=task=>task.job?.title?.zh||task.job?.title?.en||task.filename.replace(/\.(pdf|epub|txt|md)$/i,'');
 function create(task){
  const card=el('article','book-import-card'),cover=el('div','book-cover'),copy=el('div','book-import-copy'),title=el('h3'),status=el('p','book-import-status'),progress=el('progress'),actions=el('div','book-import-actions');card.dataset.uploadId=task.id;cover.setAttribute('aria-hidden','true');status.setAttribute('role','status');progress.max=100;
  const controls={};for(const action of ['open','retry','consent','cancel']){const button=el('button');button.type='button';controls[action]=button;button.addEventListener('click',()=>{const current=rows.get(task.id)?.task;if(!current)return;if(action==='open'){controller.opened(current.id);navigate('/read?book='+encodeURIComponent(current.bookId));}else if(action==='retry')void controller.retry(current.id);else if(action==='consent')void controller.act(current.id,'consent');else void controller.cancel(current.id);});actions.append(button);}
  copy.append(title,status,progress,actions);card.append(cover,copy);grid.append(card);return {card,cover,title,status,progress,controls,task,coverKey:null};
 }
 function render(){
  if(disposed)return;const books=new Set(getBooks().map(b=>b.bookId)),tasks=controller.tasks().filter(task=>task.stage!=='cancelled'&&!(task.stage==='ready'&&books.has(task.bookId))),ids=new Set(tasks.map(task=>task.id));
  for(const [id,row]of rows)if(!ids.has(id)){row.card.remove();rows.delete(id);}
  heading.textContent=t('bookUpload.imports');root.hidden=!tasks.length;
  for(const task of tasks){let row=rows.get(task.id);if(!row){row=create(task);rows.set(task.id,row);}row.task=task;const name=label(task);row.title.textContent=name;row.card.dataset.stage=task.stage;
   const coverKey=JSON.stringify([name,task.job?.author,task.job?.coverAvailable,task.job?.id]);if(row.coverKey!==coverKey){row.coverKey=coverKey;paintBookCover(row.cover,{bookId:task.id,title:{zh:name,en:name},author:task.job?.author||'',visibility:'private'});if(task.job?.coverAvailable){const image=el('img','imported-cover-artwork');image.alt='';image.src='/api/library/ingestion/'+encodeURIComponent(task.job.id)+'/cover';row.cover.dataset.coverStyle='imported';image.addEventListener('load',()=>{row.cover.dataset.coverArtwork='ready';},{once:true});image.addEventListener('error',()=>{image.hidden=true;row.cover.dataset.coverArtwork='failed';},{once:true});row.cover.append(image);}}
   const {active,percent,message}=importShelfPresentation(task);
   row.status.textContent=message;
   row.progress.hidden=!active;row.progress.setAttribute('aria-label',row.status.textContent);if(percent!==null)row.progress.value=percent;else row.progress.removeAttribute('value');
   for(const [action,button]of Object.entries(row.controls)){button.textContent=t(({open:'pdf.action.open',retry:'portal.upload.retry',consent:'bookUpload.action.consent',cancel:'pdf.action.cancel'})[action]);button.hidden=action==='open'?task.stage!=='ready':action==='retry'?task.stage!=='interrupted':action==='consent'?!(task.stage==='permission'&&task.job?.ocrAvailable):['ready','cancelled'].includes(task.stage);button.disabled=!!task.busy&&!(action==='cancel'&&!task.job);}
  }
 }
 const off=controller.subscribe(render),offLocale=onUiLocaleChange(render);
 return {update:render,dispose(){disposed=true;off();offLocale();rows.clear();root.replaceChildren();}};
}
