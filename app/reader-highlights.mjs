import {activeHighlights,highlightKey,highlightSegments} from './highlights.mjs';
import {sourceLineatedNodes} from './passage-layers.mjs';

// Works with text nodes inside persistent marks as well as plain prose.
export function textRange(document,prose,start,end){
  const walker=document.createTreeWalker(prose,4),range=document.createRange();let node,offset=0,started=false;
  while((node=walker.nextNode())){const next=offset+node.textContent.length;if(!started&&start<=next){range.setStart(node,start-offset);started=true;}if(started&&end<=next){range.setEnd(node,end-offset);return range;}offset=next;}
  return null;
}

export function mountReaderHighlights({document,getRecords,signedIn,available,selectionMatches,api,onSelect,onNote,onChange,announce,loginUrl}){
  const root=document.getElementById('chapter-text'),save=document.getElementById('show-highlight'),status=document.getElementById('highlight-status');
  let selected=null,busy=false,timer=null,indexed=null,index=new Map(),pending=new Map();
  const rows=()=>activeHighlights(getRecords());
  function notify(message,{error=false,login=false}={}){
    clearTimeout(timer);status.replaceChildren(document.createTextNode(message));status.hidden=false;status.dataset.error=String(error);announce(message);
    if(login){const link=document.createElement('a');link.href=loginUrl();link.textContent='登录书房 →';status.append(link);}
    if(!error)timer=setTimeout(()=>{status.hidden=true;},3500);
  }
  function updateTools(snapshot){
    selected=snapshot?structuredClone(snapshot):null;save.hidden=!selected;
    save.disabled=busy;save.textContent=busy?'正在保存…':selected&&rows().some(row=>highlightKey(row)===highlightKey(selected))?'取消高亮':'高亮';
  }
  function paint(prose,passageId){
    const all=getRecords()?.highlights;if(indexed!==all){indexed=all;index=new Map();for(const row of rows())for(const part of row.parts){const key=part.passageId+'|'+part.language+'|'+(part.language==='en'?'original':part.variant);if(!index.has(key))index.set(key,[]);index.get(key).push({id:row.id,part});}}
    const language=prose.dataset.readingLayer==='original'?'en':'zh',entries=index.get(passageId+'|'+language+'|'+(language==='en'?'original':prose.dataset.variant))||[],segments=highlightSegments(prose.textContent,entries),signature=JSON.stringify(segments);
    if(prose.dataset.highlightSignature===signature)return;prose.dataset.highlightSignature=signature;
    const fragment=document.createDocumentFragment();let start=0;
    for(const segment of segments){
      const nodes=sourceLineatedNodes(prose,segment.text,start,document);start+=segment.text.length;
      if(!segment.ids.length){fragment.append(...nodes);continue;}
      const mark=document.createElement('mark');mark.className='reader-highlight';mark.dataset.highlightIds=segment.ids.join(' ');mark.title='点击查看高亮';mark.append(...nodes);fragment.append(mark);
    }
    prose.replaceChildren(fragment);
  }
  function paintAll(){
    const selection=document.getSelection();if(selection&&!selection.isCollapsed&&root.contains(selection.anchorNode))return;
    for(const prose of root.querySelectorAll('p[data-reading-layer]'))paint(prose,prose.closest('.passage').dataset.id);
  }
  function accept(record){const records=getRecords();records.highlights=(records.highlights||[]).filter(row=>row.id!==record.id).concat(record);paintAll();onChange();}
  async function remove(row){
    if(busy)return;busy=true;updateTools(selected);
    try{const record=await api('/api/highlights/'+encodeURIComponent(row.id)+'/remove',{});if(selectionMatches(row))document.getSelection()?.removeAllRanges();accept(record);updateTools(selected);notify('高亮已取消。');}
    catch(error){notify(error.message||'高亮暂未取消，请重试。',{error:true});}
    finally{busy=false;updateTools(selected);}
  }
  save.addEventListener('click',async()=>{
    if(!selected||busy)return;
    if(!signedIn()){notify('登录后可以把高亮保存到自己的书房。',{error:true,login:true});return;}
    if(!available()){notify('个人记录暂时无法读取，请从“我的记录”重试读取。',{error:true});return;}
    const snapshot=structuredClone(selected),key=highlightKey(snapshot),existing=rows().find(row=>highlightKey(row)===key);if(existing){await remove(existing);return;}
    const input=pending.get(key)||{...snapshot,id:crypto.randomUUID()};pending.set(key,input);busy=true;updateTools(selected);
    try{const record=await api('/api/highlights',input);pending.delete(key);if(selectionMatches(snapshot))document.getSelection()?.removeAllRanges();accept(record);notify(record.deletedAt?'这条高亮已在另一处取消。':'高亮已保存。');}
    catch(error){notify('高亮尚未确认保存。'+(error.message||'请重试。'),{error:true});}
    finally{busy=false;updateTools(selected);}
  });
  root.addEventListener('click',event=>{
    const mark=event.target.closest('.reader-highlight');if(!mark||document.getSelection()?.toString().trim())return;
    const ids=mark.dataset.highlightIds.split(' '),row=rows().findLast(row=>ids.includes(row.id));if(!row)return;
    event.stopPropagation();onSelect(row,{passageId:mark.closest('.passage').dataset.id});
  });
  document.addEventListener('reader:layout',paintAll);document.addEventListener('reader:records-updated',paintAll);
  document.addEventListener('selectionchange',()=>{if(document.getSelection()?.isCollapsed)paintAll();});
  function recordNode(row){
    const section=document.createElement('section');section.className='personal-record highlight-record';
    const label=document.createElement('p');label.className='attribution';const part=row.parts[0];label.textContent='自己的高亮 · '+(part.language==='en'?'原文':part.variant==='literal'?'直译':'意译');
    const quote=document.createElement('blockquote');quote.textContent=row.parts.map(part=>part.text).join('\n\n');
    const actions=document.createElement('div');actions.className='highlight-record-actions';
    for(const [text,action]of [['回到原句',()=>onSelect(row)],['写想法',()=>{onSelect(row);onNote();}],['取消高亮',()=>remove(row)]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.addEventListener('click',event=>{event.stopPropagation();action();});actions.append(button);}
    section.append(label,quote,actions);return section;
  }
  return {paint,paintAll,updateTools,recordNode,notify};
}
