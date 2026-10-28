import {t,getUiLocale,onUiLocaleChange,uiReady,createUiMessage} from './ui-locale.mjs';
import {PART_BYTES,MAX_ARCHIVE_BYTES} from './library-transfer-limits.mjs';
// Archive parsing/compression is loaded only after an explicit data action.
let archiveTools=null,archiveLoading=null;
const loadArchive=()=>archiveTools?Promise.resolve(archiveTools):archiveLoading||(archiveLoading=import('./library-portability.mjs').then(module=>archiveTools=module).finally(()=>{archiveLoading=null;}));
const createLibraryArchive=async(...args)=>(await loadArchive()).createLibraryArchive(...args);
const readLibraryArchive=async(...args)=>(await loadArchive()).readLibraryArchive(...args);
const portableHash=async(...args)=>(await loadArchive()).portableHash(...args);
const personalExportItems=(...args)=>archiveTools.personalExportItems(...args);
const selectedRecordExport=(...args)=>archiveTools.selectedRecordExport(...args);
const exportLibraryInParts=async(...args)=>{const [module]=await Promise.all([import('./library-export.mjs'),loadArchive()]);return module.exportLibraryInParts(...args);};
const readExportResource=async(...args)=>(await import('./library-export.mjs')).readExportResource(...args);
import {mountChoiceControl} from './choice-control.mjs';
import {settingGroup,switchRow,mountDropzone,mountConfirm} from './settings-controls.mjs';
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const button=text=>{const el=node('button',text);el.type='button';el.className='outline';return el;};
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=bytes=>{let text='';for(let n=0;n<bytes.length;n+=8192)text+=String.fromCharCode(...bytes.subarray(n,n+8192));return btoa(text);};
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function mountLibraryData({root,api,getSession,getOwner=()=>getSession()?.user?.id||'guest',onRestored=async()=>{}}){
 const labels=new Map(),recordLabels=new Map(),attributes=new Map();let disposed=false,pages=1;
 const label=(el,id,params,scope=labels)=>{scope.set(el,{id,params});el.textContent=t(id,params);return el;};
 const uiNode=(tag,id)=>label(node(tag),id),uiButton=id=>label(button(''),id);
 const aria=(el,id)=>{attributes.set(el,id);el.setAttribute('aria-label',t(id));};
 root.classList.add('library-data');let generation=0,owner=getOwner(),busy=false,items=[],selected=new Set(),preview='',page=0,restoreId=null,mode='personal',pending=null,committing=false;
 const title=uiNode('h3','data.title'),intro=uiNode('p','data.settings.intro');intro.className='settings-description';
 const status=node('p');status.className='settings-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 // Guests see why every control is read-only and how to unlock it.
 const guestHelp=uiNode('p','data.guest');guestHelp.className='settings-description';guestHelp.id='data-guest';guestHelp.hidden=true;
 // One quiet backup group: the include-original switch, one primary action.
 const backupGroup=settingGroup({document,title:'',description:''});
 label(backupGroup.title,'data.backupTitle');
 const originalCheck=node('input');originalCheck.type='checkbox';
 const originalSwitch=switchRow({document,input:originalCheck,label:t('data.originals'),description:''});label(originalSwitch.label,'data.originals');
 const backup=uiButton('data.backup'),backupHelp=uiNode('p','data.settings.backupHelp');backupHelp.className='settings-description';
 backupGroup.body.append(originalSwitch.root,backupHelp,backup);
 // Restore group: a selectable dropzone stages the archive, and only the
 // explicit confirm action ever starts a restore.
 const restoreGroup=settingGroup({document,title:'',description:''});
 label(restoreGroup.title,'data.restoreTitle');
 const file=node('input');file.type='file';file.id='data-restore-file';file.accept='.zip,.json,application/zip,application/json';aria(file,'data.file');
 const dropzone=mountDropzone({document,input:file,title:t('data.drop.title'),action:t('data.drop.action'),hint:t('data.drop.hint')});
 const restoreHelp=uiNode('p','data.settings.restoreHelp');restoreHelp.className='settings-description';
 const restore=uiButton('data.restore'),cancel=uiButton('data.cancel');cancel.hidden=true;
 restoreGroup.body.append(dropzone.root,restore,cancel,restoreHelp);
 // Export group keeps its existing choices; selects gain the shared choice
 // presentation through the explicit sync path.
 const exportGroup=settingGroup({document,title:'',description:''});
 label(exportGroup.title,'data.personalTitle');
 const load=uiButton('data.load'),controls=node('div');controls.className='data-export-controls';
 const modeSelect=node('select');aria(modeSelect,'data.scope');for(const value of ['personal','share']){const o=uiNode('option','data.'+value);o.value=value;modeSelect.append(o);}
 const format=node('select');aria(format,'data.format');for(const [value,labelText]of [['json','JSON'],['markdown','Markdown'],['pdf','PDF']]){const o=node('option',labelText);o.value=value;format.append(o);}
 const bookSelect=node('select');aria(bookSelect,'data.book');
 const quotes=node('input');quotes.type='checkbox';
 const quoteSwitch=switchRow({document,input:quotes,label:t('data.quotes'),description:''});label(quoteSwitch.label,'data.quotes');
 const rangeHelp=uiNode('p','data.rangeHelp');rangeHelp.className='settings-description';
 const list=node('fieldset'),legend=uiNode('legend','data.legend');list.append(legend);const rows=node('div');list.append(rows);
 const pager=node('div'),previous=uiButton('data.previous'),next=uiButton('data.next'),count=node('span');pager.className='data-pager';pager.append(previous,count,next);
 const previewButton=uiButton('data.preview'),save=uiButton('data.download'),output=node('textarea');output.readOnly=true;output.rows=10;aria(output,'data.output');save.disabled=true;
 controls.append(modeSelect,format,bookSelect,quoteSwitch.root,rangeHelp,list,pager,previewButton,output,save);controls.hidden=true;
 exportGroup.body.append(load,controls);
 // Technical limits, formats, merge behavior and exclusions stay out of the
 // three short groups and never promise behavior the merge service lacks.
 const advanced=node('details');advanced.className='settings-advanced';advanced.id='data-advanced';
 const advancedSummary=uiNode('summary','data.advanced');
 const advancedLimits=uiNode('p','data.advanced.limits');advancedLimits.className='settings-description';
 const advancedMerge=uiNode('p','data.advanced.merge');advancedMerge.className='settings-description';
 const advancedExclusions=uiNode('p','data.advanced.exclusions');advancedExclusions.className='settings-description';
 const technicalNotes=['data.intro','data.backupHelp','data.restoreHelp'].map(id=>{const p=uiNode('p',id);p.className='settings-description';return p;});
 advanced.append(advancedSummary,...technicalNotes,advancedLimits,advancedMerge,advancedExclusions);
 root.append(title,intro,guestHelp,backupGroup.root,restoreGroup.root,exportGroup.root,advanced,status);
 const allButtons=[backup,restore,load,previewButton,save];
 const statusMessage=createUiMessage((text,error)=>{status.textContent=text;status.classList.toggle('error',!!error);});
 const say=(id,params=null,error=false)=>{if(id)statusMessage.set(id,params,error);else{statusMessage.clear();status.textContent='';status.classList.toggle('error',false);}};
 const problem=id=>Object.assign(Error(id),{messageId:id});
 const report=error=>error.code==='PDF_GLYPH_UNAVAILABLE'?say('export.glyphError',null,true):say(['data.chooseFile','data.tooLarge','data.chooseRecords'].includes(error.messageId)?error.messageId:'data.error',null,true);
 function updateCount(){label(count,'data.count',{page:page+1,pages,count:selected.size});}
 function invalidate(){preview='';output.value='';save.disabled=true;}
 function render(){
  const visible=items.filter(i=>i.bookId===bookSelect.value&&(mode!=='share'||i.category!=='time'));pages=Math.max(1,Math.ceil(visible.length/100));page=Math.min(page,pages-1);recordLabels.clear();rows.replaceChildren();
  for(const item of visible.slice(page*100,(page+1)*100)){
   const wrap=node('label'),input=node('input');input.type='checkbox';input.checked=selected.has(item.key);input.dataset.recordKey=item.key;
   input.addEventListener('change',()=>{if(disposed)return;if(input.checked)selected.add(item.key);else selected.delete(item.key);invalidate();updateCount();});
   const prefix=node('span'),description=node('span');
   const prefixText=()=> (item.origin==='ai'?'AI':t('data.user'))+' · '+t('data.'+item.category)+' · ';
   recordLabels.set(prefix,{format:prefixText});prefix.textContent=prefixText();
   if(item.category==='time'){
    const sources={reader_focus:'reading.time.source.reader_focus',reader_reading_estimate:'reading.time.source.reader_estimate',manual_self_report:'reading.time.source.manual',design_preview_focus_timer:'reading.time.source.legacy'};
    const describe=()=> (sources[item.source]?t(sources[item.source]):item.source)+' · '+t('data.seconds',{seconds:item.durationSeconds});recordLabels.set(description,{format:describe});description.textContent=describe();
   }else description.textContent=String(item.text).slice(0,180);
   wrap.append(input,prefix,description);rows.append(wrap);
  }
  previous.disabled=page===0;next.disabled=page+1>=pages;updateCount();
  syncChoices();
 }
 // Local archive validation for the staged file: selecting or dropping only
 // stages and checks, it never restores. Every result is bound to its owner,
 // generation and exact File, so a stale check can never paint a later choice.
 let validationToken=0,validatedSelection=null;
 const selectionCurrent=(chosen,token,own)=>!disposed&&token===validationToken&&own===getOwner()&&(file.files&&file.files[0])===chosen;
 const selectionValidated=()=>!!validatedSelection&&selectionCurrent(validatedSelection.file,validatedSelection.token,validatedSelection.owner);
 async function validateSelection(){
  const chosen=file.files&&file.files[0],token=++validationToken,own=getOwner();
  validatedSelection=null;updateBusy();
  if(!chosen){dropzone.setState({state:'empty'});return;}
  dropzone.setState({state:'checking',name:chosen.name,size:chosen.size});
  try{
   if(!selectionCurrent(chosen,token,own)||!getSession()?.user)return;
   if(chosen.size>MAX_ARCHIVE_BYTES)throw problem('data.tooLarge');
   let bytes=new Uint8Array(await chosen.arrayBuffer());
   if(!selectionCurrent(chosen,token,own))return;
   if(chosen.name.toLowerCase().endsWith('.json')){let legacy;try{legacy=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('JSON 备份无法读取');}bytes=await createLibraryArchive(legacy);}
   await readLibraryArchive(bytes);
   if(!selectionCurrent(chosen,token,own))return;
   validatedSelection={file:chosen,token,owner:own};
   dropzone.setState({state:'valid',name:chosen.name,size:chosen.size});updateBusy();
  }catch(error){
   if(!selectionCurrent(chosen,token,own))return;
   dropzone.setState({state:'invalid',name:chosen.name,size:chosen.size});
  }
 }
file.addEventListener('change',()=>{void validateSelection();});
 function updateBusy(){
  const blocked=busy||!getSession()?.user;
  for(const b of allButtons)b.disabled=blocked||b===restore&&!selectionValidated()||b===save&&!preview;
  // One consistent read-only story: the file field, both switches and the
  // export selects share the same blocked state, and the enhanced chrome is
  // re-synced after every disabled/value/options change.
  file.disabled=blocked;originalCheck.disabled=blocked;quotes.disabled=blocked;
  for(const [select]of choices)select.disabled=blocked;
  label(load,busy?'data.busy':'data.load');root.setAttribute('aria-busy',String(busy));cancel.hidden=!busy&&!restoreId;cancel.disabled=committing;guestHelp.hidden=!!getSession()?.user;
  syncChoices();
 }
 async function run(work){if(disposed||busy)return;const current=++generation,own=getOwner(),opener=document.activeElement;busy=true;say('data.busy');updateBusy();const assert=()=>{if(disposed||current!==generation||own!==getOwner())throw Error('操作已取消或账户已切换，请重新操作。');};const call=async(url,payload)=>{assert();const request=Promise.resolve().then(()=>{assert();return api(url,payload);});const operation={request,url};pending=operation;let result;try{result=await request;}finally{if(pending===operation)pending=null;}assert();if(url==='/api/library/restore/start')restoreId=result.id;assert();return result;};try{await work({assert,call});}catch(error){if(!disposed&&current===generation&&own===getOwner())report(error);}finally{if(!disposed&&current===generation){busy=false;committing=false;updateBusy();if(opener?.isConnected&&document.activeElement===document.body)opener.focus({preventScroll:true});}}}
 const readResource=(call,assert,url)=>readExportResource({api:call,assertCurrent:assert,url});
 async function readBackup(call,assert){return exportLibraryInParts({api:call,assertCurrent:assert,partAction:'portability-part',onProgress:p=>say('data.progress',{index:p.bookIndex,count:p.bookCount,bytes:p.receivedBytes})});}
 backup.addEventListener('click',()=>run(async({call,assert})=>{
  const includeOriginals=originalCheck.checked,snapshot=await readBackup(call,assert),originals=[];let total=new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if(includeOriginals)for(const entry of snapshot.books.filter(e=>e.book.visibility==='private')){const id=encodeURIComponent(entry.book.bookId),info=await readResource(call,assert,'/api/library/books/'+id+'/original/info');if(!info.available)throw Error(entry.book.title.zh+'：'+info.reason);total+=info.bytes;if(total>MAX_ARCHIVE_BYTES)throw Error('含原文件的备份超过 512 MiB，请在本机分批整理');const bytes=new Uint8Array(info.bytes);for(let offset=0;offset<info.bytes;){const part=await readResource(call,assert,'/api/library/books/'+id+'/portability-original?offset='+offset+'&sha256='+info.sha256),raw=decode(part.data),expected=Math.min(PART_BYTES,info.bytes-offset);if(part.offset!==offset||part.totalBytes!==info.bytes||part.sha256!==info.sha256||raw.length!==expected||part.nextOffset!==(offset+expected<info.bytes?offset+expected:null))throw Error('原文件分段校验失败');bytes.set(raw,offset);offset+=expected;say('data.originalProgress',{title:entry.book.title.zh,bytes:offset,total:info.bytes});}originals.push({bookId:entry.book.bookId,bytes});}
  const bytes=await createLibraryArchive(snapshot,{originals});assert();download(bytes,'leafhour-reading-library.zip','application/zip');say('data.backupReady');
 }));
 load.addEventListener('click',()=>run(async({call,assert})=>{const snapshot=await readBackup(call,assert);items=personalExportItems(snapshot);selected.clear();invalidate();bookSelect.replaceChildren();for(const book of snapshot.books.filter(e=>items.some(i=>i.bookId===e.book.bookId))){const o=node('option',book.book.title.zh);o.value=book.book.bookId;bookSelect.append(o);}if(bookSelect.options.length)bookSelect.value=bookSelect.options[0].value;page=0;controls.hidden=false;render();say(items.length?'data.loaded':'data.empty');}));
 modeSelect.addEventListener('change',()=>{mode=modeSelect.value;selected.clear();page=0;invalidate();render();});format.addEventListener('change',invalidate);quotes.addEventListener('change',invalidate);bookSelect.addEventListener('change',()=>{page=0;render();});previous.addEventListener('click',()=>{page--;render();});next.addEventListener('click',()=>{page++;render();});
 previewButton.addEventListener('click',()=>{if(disposed)return;try{if(!selected.size)throw problem('data.chooseRecords');preview=selectedRecordExport(items.filter(i=>selected.has(i.key)),{format:format.value==='pdf'?'markdown':format.value,sharing:mode==='share',includeQuotes:quotes.checked,labels:Object.fromEntries(['share','personal','type','origin','user','id','version','anchor','created','updated','timeSource','seconds','quote','aiQuote'].map(id=>[id,t('data.md.'+id)]))});output.value=preview;save.disabled=false;say('data.previewReady');}catch(error){invalidate();report(error);}});
 save.addEventListener('click',()=>{if(disposed||!preview||busy||getOwner()!==owner)return;if(format.value==='pdf'){const content=preview;void run(async({assert})=>{const valid=()=>{assert();if(preview!==content||format.value!=='pdf')throw Error('Export changed');};const [{documentPdf},{textExportDocument,documentFilename,downloadDocument}]=await Promise.all([import('./document-pdf.mjs'),import('./document-export.mjs')]);valid();const title=t(mode==='share'?'data.md.share':'data.md.personal'),bytes=await documentPdf(textExportDocument(content,title),{assertCurrent:valid});valid();downloadDocument(bytes,documentFilename(title,'pdf'),'application/pdf');say('export.downloadRequested');});return;}download(preview,mode==='share'?'leafhour-selected-share.'+(format.value==='json'?'json':'md'):'leafhour-personal-records.'+(format.value==='json'?'json':'md'),format.value==='json'?'application/json':'text/markdown;charset=utf-8');say('data.downloadReady');});
 // Heavy actions run only behind one explicit confirmation that names the
 // consequence: starting a restore and stopping a running operation.
 const confirm=mountConfirm({document,labels:{cancel:t('data.confirm.cancel'),confirm:t('data.confirm.restoreAction')}});
 confirm.cancelButton.id='data-confirm-cancel';confirm.confirmButton.id='data-confirm-action';root.append(confirm.dialog);
 // Selects gain the shared choice presentation when the environment supports
 // it; the native selects stay the value owners otherwise.
 const enhance=(select,key)=>{try{return mountChoiceControl({document,select,label:t(key)})||null;}catch{return null;}};
 const choices=[[modeSelect,'data.scope',enhance(modeSelect,'data.scope')],[format,'data.format',enhance(format,'data.format')],[bookSelect,'data.book',enhance(bookSelect,'data.book')]];
 let confirmKind=null;
 const confirmLabels=()=>({title:t(confirmKind==='cancel'?'data.confirm.cancelTitle':'data.confirm.restoreTitle'),consequence:t(confirmKind==='cancel'?'data.confirm.cancelConsequence':'data.confirm.restoreConsequence'),confirmLabel:t(confirmKind==='cancel'?'data.confirm.cancelAction':'data.confirm.restoreAction'),cancelLabel:t('data.confirm.cancel')});
 const staleConfirm=()=>{confirm.close();say('data.confirmStale',null,true);};
 const syncChoices=()=>{for(const [,,control]of choices)control?.sync();};
 restore.addEventListener('click',()=>{
  if(disposed||busy||!getSession()?.user||!selectionValidated())return;
  const chosen=file.files&&file.files[0];
  if(!chosen){report(problem('data.chooseFile'));return;}
  const openedOwner=getOwner(),openedGeneration=generation,openedValidation=validatedSelection;
  const stillOpen=()=>!disposed&&!busy&&openedOwner===getOwner()&&openedGeneration===generation&&validatedSelection===openedValidation&&selectionValidated()&&(file.files&&file.files[0])===chosen;
  confirmKind='restore';
  confirm.open({title:t('data.confirm.restoreTitle'),consequence:t('data.confirm.restoreConsequence'),confirmLabel:t('data.confirm.restoreAction'),cancelLabel:t('data.confirm.cancel'),opener:restore,onConfirm:()=>{
   // Re-checked BEFORE any arrayBuffer, parser or API call.
   if(!stillOpen()){staleConfirm();return;}
   void run(async({call,assert})=>{
  if(!chosen)throw problem('data.chooseFile');if(chosen.size>MAX_ARCHIVE_BYTES)throw problem('data.tooLarge');let bytes=new Uint8Array(await chosen.arrayBuffer());assert();if(chosen.name.toLowerCase().endsWith('.json')){let legacy;try{legacy=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('JSON 备份无法读取');}bytes=await createLibraryArchive(legacy);}const checked=await readLibraryArchive(bytes);assert();say('data.verified',{books:checked.backup.books.length});const operation=await call('/api/library/restore/start',{bytes:bytes.length,sha256:await portableHash(bytes)});restoreId=operation.id;
  for(let offset=0;offset<bytes.length;offset+=PART_BYTES){await call('/api/library/restore/'+operation.id+'/part',{offset,data:encode(bytes.subarray(offset,offset+PART_BYTES))});say('data.upload',{bytes:Math.min(bytes.length,offset+PART_BYTES),total:bytes.length});}
  say('data.committing');committing=true;updateBusy();const result=await call('/api/library/restore/'+operation.id+'/commit',{});restoreId=null;committing=false;await onRestored();assert();items=[];selected.clear();controls.hidden=true;invalidate();say('data.restored',{books:result.restored,originals:result.originals});
   });
  }});
 });
 // A file change withdraws any waiting confirmation for the previous file.
 file.addEventListener('change',()=>confirm.close());
 const doCancel=async({operation,openingRestoreId=null}={})=>{
  if(disposed||committing)return;const own=getOwner(),sequence=++generation;busy=true;cancel.disabled=true;say('data.stopping');
  const valid=()=>!disposed&&generation===sequence&&own===getOwner();
  try{const result=await operation?.request.catch(()=>null);if(!valid())return;const id=openingRestoreId||(operation?.url==='/api/library/restore/start'?result?.id:null);if(id)await api('/api/library/restore/'+id+'/cancel',{});if(!valid())return;restoreId=null;say(id?'data.cancelledRestore':'data.stopped');}
  catch(error){if(valid())say('data.cancelError',null,true);}
  finally{if(valid()){busy=false;updateBusy();}}
 };
 cancel.addEventListener('click',()=>{
  if(disposed||committing||cancel.disabled)return;
  // The cancel confirmation names the operation it was opened for.
  const openedOwner=getOwner(),openedGeneration=generation,openedPending=pending,openedRestoreId=restoreId;
  confirmKind='cancel';
  confirm.open({title:t('data.confirm.cancelTitle'),consequence:t('data.confirm.cancelConsequence'),confirmLabel:t('data.confirm.cancelAction'),cancelLabel:t('data.confirm.cancel'),opener:cancel,onConfirm:()=>{
   if(disposed||openedOwner!==getOwner()||openedGeneration!==generation){staleConfirm();return;}
   void doCancel({operation:openedPending,openingRestoreId:openedRestoreId});
  }});
 });
 function clear(){generation++;validationToken++;validatedSelection=null;confirm.close();busy=false;committing=false;restoreId=null;items=[];selected.clear();preview='';originalCheck.checked=false;quotes.checked=false;mode='personal';modeSelect.value=mode;page=0;controls.hidden=true;recordLabels.clear();rows.replaceChildren();bookSelect.replaceChildren();output.value='';file.value='';dropzone.setState({state:'empty'});say('');updateBusy();}
 function update(){if(disposed)return;if(owner!==getOwner()){owner=getOwner();clear();}updateBusy();}
 function updateLabels(){if(disposed)return;root.setAttribute('lang',getUiLocale());for(const [el,{id,params}]of labels)el.textContent=t(id,params);for(const [el,{format}]of recordLabels)el.textContent=format();for(const [el,id]of attributes)el.setAttribute('aria-label',t(id));for(const [select,key,control]of choices)control?.updateLabels({label:t(key)});dropzone.updateLabels({title:t('data.drop.title'),action:t('data.drop.action'),hint:t('data.drop.hint')});confirm.updateLabels(confirmLabels());statusMessage.refresh();}
 const offLocale=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);updateLabels();update();
 return {update,clear,updateLabels,closeTransient(){confirm.close({focus:false});},dispose(){if(disposed)return;disposed=true;generation++;offLocale();labels.clear();recordLabels.clear();attributes.clear();statusMessage.clear();confirm.destroy();dropzone.destroy();for(const [,,control]of choices)control?.destroy?.();}};
}
