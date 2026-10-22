import {activeHighlights,highlightKey,highlightSegments} from './highlights.mjs';
import {t,getUiLocale,onUiLocaleChange,createUiLabels} from './ui-locale.mjs';
import {sourceLineatedNodes} from './passage-layers.mjs';

const HIGHLIGHT_UI='reader.highlight.';
// Works with text nodes inside persistent marks as well as plain prose.
export function textRange(document,prose,start,end){
  const walker=document.createTreeWalker(prose,4),range=document.createRange();let node,offset=0,started=false;
  while((node=walker.nextNode())){const next=offset+node.textContent.length;if(!started&&start<=next){range.setStart(node,start-offset);started=true;}if(started&&end<=next){range.setEnd(node,end-offset);return range;}offset=next;}
  return null;
}

export function mountReaderHighlights({document,getRecords,signedIn,available,getSession=()=>null,selectionMatches,api,onSelect,onNote,onChange,announce,loginUrl,loadAnnotationModule=()=>import('./reader-annotations.mjs')}){
  const root=document.getElementById('chapter-text'),save=document.getElementById('show-highlight'),status=document.getElementById('highlight-status');
  let selected=null,busy=false,timer=null,indexed=null,index=new Map(),pending=new Map(),disposed=false;
  const annotate=document.getElementById('annotate-selection');
  let annotation,annotationEpoch=0;
  const loadAnnotations=()=>annotation??=loadAnnotationModule().then(module=>disposed?null:module.mountReaderAnnotations({document,api,getSession,getRecords,getSelection:()=>selected,signedIn,available,accept,notify,isCurrent:()=>!disposed}));
  function loadFailed(ticket=annotationEpoch){if(!disposed&&ticket===annotationEpoch){document.body.dataset.annotationsState='error';notify('',{error:true,reload:true,id:'reader.annotation.loadFailed'});}}
  async function openAnnotation(row,origin,ticket=annotationEpoch){
    try{const controller=await loadAnnotations();if(!disposed&&ticket===annotationEpoch)controller?.openHighlight(row,origin);}
    catch{loadFailed(ticket);}
  }
  const labels=createUiLabels(),listeners=[];
  const pruneLabels=()=>labels.prune();
  const write=(node,id,params,attribute)=>{if(attribute)labels.attr(node,attribute,id,params);else labels.text(node,id,params);};
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  const offLocale=onUiLocaleChange(()=>{labels.refresh({pruneDetached:true});});
  const rows=()=>activeHighlights(getRecords());
  function notify(message,{error=false,login=false,reload=false,id=HIGHLIGHT_UI+'error'}={}){
    if(disposed)return;pruneLabels();
    clearTimeout(timer);status.replaceChildren();const text=document.createElement('span');write(text,id);status.append(text);status.hidden=false;status.dataset.error=String(error);announce(t(id));
    if(login){const link=document.createElement('a');link.href=loginUrl(link);write(link,HIGHLIGHT_UI+'login');status.append(link);}
    if(reload){const action=document.createElement('button');action.type='button';write(action,'reader.annotation.reload');action.addEventListener('click',()=>document.defaultView.location.reload());status.append(action);}
    if(!error)timer=setTimeout(()=>{status.hidden=true;},3500);
  }
  function updateTools(snapshot){if(disposed)return;
    selected=snapshot?structuredClone(snapshot):null;save.hidden=!selected;
    if(annotate)annotate.hidden=true;
    save.disabled=busy;write(save,busy?'record.saving':'reader.shell.highlight');
  }
  function paint(prose,passageId){if(disposed)return;
    const all=getRecords()?.highlights;if(indexed!==all){indexed=all;index=new Map();for(const row of rows())for(const part of row.parts){const key=part.passageId+'|'+part.language+'|'+(part.language==='en'?'original':part.variant);if(!index.has(key))index.set(key,[]);index.get(key).push({id:row.id,part});}}
    const language=prose.dataset.readingLayer==='original'?'en':'zh',entries=index.get(passageId+'|'+language+'|'+(language==='en'?'original':prose.dataset.variant))||[],segments=highlightSegments(prose.textContent,entries),signature=JSON.stringify(segments);
    if(prose.dataset.highlightSignature===signature)return;prose.dataset.highlightSignature=signature;
    const fragment=document.createDocumentFragment();let start=0;
    for(const segment of segments){
      const nodes=sourceLineatedNodes(prose,segment.text,start,document);start+=segment.text.length;
      if(!segment.ids.length){fragment.append(...nodes);continue;}
      const mark=document.createElement('mark');mark.className='reader-highlight';mark.dataset.highlightIds=segment.ids.join(' ');write(mark,HIGHLIGHT_UI+'view',null,'title');mark.append(...nodes);fragment.append(mark);
    }
    prose.replaceChildren(fragment);
  }
  function paintAll(){if(disposed)return;pruneLabels();
    const selection=document.getSelection();if(selection&&!selection.isCollapsed&&root.contains(selection.anchorNode))return;
    for(const prose of root.querySelectorAll('p[data-reading-layer]'))paint(prose,prose.closest('.passage').dataset.id);
  }
  function accept(record){const records=getRecords();records.highlights=(records.highlights||[]).filter(row=>row.id!==record.id).concat(record);paintAll();onChange();}
  async function remove(row){
    if(disposed||busy)return;busy=true;updateTools(selected);
    try{const record=await api('/api/highlights/'+encodeURIComponent(row.id)+'/remove',{});if(disposed)return;if(selectionMatches(row))document.getSelection()?.removeAllRanges();accept(record);updateTools(selected);notify('',{id:HIGHLIGHT_UI+'removed'});}
    catch(error){notify('',{id:HIGHLIGHT_UI+'removeFailed',error:true});}
    finally{busy=false;updateTools(selected);}
  }
  listen(save,'click',async()=>{
    if(!selected||busy)return;
    if(!signedIn()){notify('',{id:HIGHLIGHT_UI+'loginHint',error:true,login:true});return;}
    if(!available()){notify('',{id:HIGHLIGHT_UI+'recordsUnavailable',error:true});return;}
    const ticket=annotationEpoch,snapshot=structuredClone(selected),key=highlightKey(snapshot),existing=rows().find(row=>highlightKey(row)===key);if(existing){await openAnnotation(existing,save);return;}
    const input=pending.get(key)||{...snapshot,id:crypto.randomUUID()};pending.set(key,input);busy=true;updateTools(selected);
    try{const record=await api('/api/highlights',input);if(disposed||ticket!==annotationEpoch)return;pending.delete(key);if(selectionMatches(snapshot))document.getSelection()?.removeAllRanges();accept(record);notify('',{id:record.deletedAt?HIGHLIGHT_UI+'deletedElsewhere':HIGHLIGHT_UI+'saved'});if(!record.deletedAt)await openAnnotation(record,save,ticket);}
    catch(error){notify('',{id:HIGHLIGHT_UI+'saveFailed',error:true});}
    finally{busy=false;updateTools(selected);}
  });
  if(annotate){listen(document,'reader:session-changed',()=>{annotationEpoch++;pending.clear();updateTools(null);});listen(annotate,'click',()=>{const snapshot=selected,ticket=annotationEpoch;return loadAnnotations().then(controller=>{if(!disposed&&snapshot&&snapshot===selected&&ticket===annotationEpoch)return controller?.annotate(annotate);}).catch(()=>loadFailed(ticket));});listen(document,'reader:ready',()=>{const ticket=++annotationEpoch;if(signedIn())loadAnnotations().catch(()=>loadFailed(ticket));});}
  listen(root,'click',event=>{
    const mark=event.target.closest('.reader-highlight');if(document.body?.dataset.annotationsVisible==='false'||!mark||document.getSelection()?.toString().trim())return;
    const ids=mark.dataset.highlightIds.split(' '),row=rows().findLast(row=>ids.includes(row.id));if(!row)return;
    event.stopPropagation();openAnnotation(row,mark);
  });
  listen(document,'reader:layout',paintAll);listen(document,'reader:records-updated',paintAll);
  listen(document,'selectionchange',()=>{if(document.getSelection()?.isCollapsed)paintAll();});
  function recordNode(row){pruneLabels();
    const section=document.createElement('section');section.className='personal-record highlight-record';
    const label=document.createElement('p');label.className='attribution';const part=row.parts[0];write(label,HIGHLIGHT_UI+'own.'+(part.language==='en'?'original':part.variant));
    const quote=document.createElement('blockquote');quote.textContent=row.parts.map(part=>part.text).join('\n\n');
    const actions=document.createElement('div');actions.className='highlight-record-actions';
    const writeThought=async()=>{try{if(await onSelect(row)===true&&!disposed)onNote();}catch{notify('',{error:true});}};
    for(const [text,action]of [[HIGHLIGHT_UI+'return',()=>onSelect(row)],['reader.b1.writeThought',writeThought],[HIGHLIGHT_UI+'remove',()=>remove(row)]]){const button=document.createElement('button');button.type='button';write(button,text);button.addEventListener('click',event=>{event.stopPropagation();action();});actions.append(button);}
    section.append(label,quote,actions);return section;
  }
  return {paint,paintAll,updateTools,recordNode,notify,unmount(){if(disposed)return;disposed=true;annotation?.then(controller=>controller?.dispose()).catch(()=>{});offLocale();clearTimeout(timer);labels.clear();for(const off of listeners)off();listeners.length=0;}};
}
