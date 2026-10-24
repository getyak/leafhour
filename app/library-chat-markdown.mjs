// A small DOM-only Markdown subset. Raw HTML is always a text node.
export function safeChatUrl(value,{sourceRefs=[],recommendations=[],allowRecommendations=false,origin=globalThis.location?.origin}={}){
  if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value))return null;
  if(value.startsWith('/')){
    if(value.startsWith('//'))return null;
    const allowed=[...sourceRefs,...(allowRecommendations?recommendations:[])];
    return allowed.some(ref=>ref.url===value&&value==='/read?book='+encodeURIComponent(ref.bookId)+(ref.passageId?'&passage='+encodeURIComponent(ref.passageId):''))?value:null;
  }
  try{const url=new URL(value);if(url.username||url.password)return null;if(origin&&url.origin===origin)return safeChatUrl(url.pathname+url.search+url.hash,{sourceRefs,recommendations,allowRecommendations,origin});return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function renderChatMarkdown(document,text,{sourceRefs=[],onInternalLink,onInternalLinkCreated}={}){
  const root=document.createElement('div');root.className='library-chat-text library-chat-markdown';
  const literal=(parent,value)=>parent.append(document.createTextNode(value));
  function inline(parent,value,depth=0){
    if(depth>8){literal(parent,value);return;}
    const token=/(`+)([^`\n]+)\1|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;let start=0,match;
    while((match=token.exec(value))){literal(parent,value.slice(start,match.index));
      if(match[1]){const code=document.createElement('code');code.textContent=match[2];parent.append(code);}
      else if(match[3]){const url=safeChatUrl(match[4],{sourceRefs});if(url){const link=document.createElement('a');link.href=url;if(url.startsWith('/')){onInternalLinkCreated?.(link,url);link.addEventListener('click',event=>onInternalLink?.(event,sourceRefs.find(ref=>ref.url===url)));}else{link.target='_blank';link.rel='noopener noreferrer';}inline(link,match[3],depth+1);parent.append(link);}else literal(parent,match[0]);}
      else{const el=document.createElement(match[5]||match[6]?'strong':'em');inline(el,match[5]||match[6]||match[7]||match[8],depth+1);parent.append(el);}start=token.lastIndex;
    }literal(parent,value.slice(start));
  }
  const lines=String(text).replace(/\r\n?/g,'\n').split('\n');
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  const divider=line=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line||'');
  const block=line=>/^\s*(#{1,6}\s|>|```|~~~|[-+*]\s|\d+[.)]\s)/.test(line||'');
  for(let i=0;i<lines.length;){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if(fence){const pre=document.createElement('pre'),code=document.createElement('code'),body=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence[1]))body.push(lines[i++]);if(i<lines.length)i++;code.textContent=body.join('\n');pre.append(code);root.append(pre);continue;}
    const heading=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);if(heading){const el=document.createElement('h'+heading[1].length);inline(el,heading[2]);root.append(el);i++;continue;}
    if(line.includes('|')&&divider(lines[i+1])){
      const wrap=document.createElement('div');wrap.className='library-chat-table';const table=document.createElement('table'),head=document.createElement('thead'),row=document.createElement('tr');for(const value of cells(line)){const cell=document.createElement('th');inline(cell,value);row.append(cell);}head.append(row);table.append(head);const body=document.createElement('tbody');i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=document.createElement('tr');for(const value of cells(lines[i++])){const cell=document.createElement('td');inline(cell,value);row.append(cell);}body.append(row);}table.append(body);wrap.append(table);root.append(wrap);continue;
    }
    if(/^\s*>/.test(line)){const quote=document.createElement('blockquote'),body=[];while(i<lines.length&&/^\s*>/.test(lines[i]))body.push(lines[i++].replace(/^\s*>\s?/,''));inline(quote,body.join('\n'));root.append(quote);continue;}
    const list=line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);if(list){const ordered=/^\d/.test(list[1]),el=document.createElement(ordered?'ol':'ul');while(i<lines.length){const item=lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);if(!item||/^\d/.test(item[1])!==ordered)break;const li=document.createElement('li');inline(li,item[2]);el.append(li);i++;}root.append(el);continue;}
    const paragraph=document.createElement('p'),body=[line];i++;while(i<lines.length&&lines[i].trim()&&!block(lines[i])&&!(lines[i].includes('|')&&divider(lines[i+1])))body.push(lines[i++]);inline(paragraph,body.join('\n'));root.append(paragraph);
  }
  return root;
}

// Loaded with the answer renderer when a conversation opens; this presentation
// code does not enter the fixed reader startup bundle or own a locale runtime.
const activityKey=tool=>({reader_get_context:'context',reader_read_chapter:'chapter',reader_list_books:'library',reader_get_outline:'outline',reader_search:'search',reader_recommend_books:'books',reader_search_web:'web',reader_cite:'cite',get_preferences:'preferences',update_preference:'preferences',delete_preference:'preferences'})[tool]||'other';
function renderChatActivity({parent,turn,completed,ownerRow,node,ui,t,paintFor,createUiMessage}){
    const activity=Array.isArray(turn.activity)?turn.activity:[];if(!completed||!activity.length)return;
    const details=node('details','library-chat-activity-details');
    const summary=node('summary'),failed=activity.filter(a=>a.status==='failed').length,summaryMsg=createUiMessage(text=>{summary.textContent=text;});
    summaryMsg.set(failed?'chat.activity.withFailures':'chat.activity.summary',{count:activity.length,failed});paintFor(ownerRow,()=>summaryMsg.refresh());
    details.append(summary);
    const groups=new Map();for(const item of activity){const key=activityKey(item.tool)+'/'+item.status,group=groups.get(key)||{item,count:0};group.count++;groups.set(key,group);}
    for(const {item,count}of groups.values()){const row=node('p'),statusId=({running:'chat.activity.running',completed:'done',failed:'fl'})[item.status]||'fl',msg=createUiMessage(text=>{row.textContent=text;});paintFor(ownerRow,()=>msg.set('chat.activity.line',{name:t('chat.activity.'+activityKey(item.tool)),count,status:t(statusId)}));details.append(row);}parent.append(details);
  }

function renderChatRecommendations({parent,answer,node,ui,sourceHref}){
    const candidates=(answer.recommendations||[]).slice(0,3);if(!candidates.length)return;
    const section=node('details','library-chat-recommendations');section.append(ui('summary','library-chat-source-label','rb'));
    for(const item of candidates){const url=safeChatUrl(item.url,{recommendations:candidates,allowRecommendations:true});if(!url)continue;
      const card=node('a','library-chat-recommendation');if(url.startsWith('/'))sourceHref(card,url);else{card.href=url;card.target='_blank';card.rel='noopener noreferrer';}
      card.append(node('span','',item.title),ui('small','',item.owned?'il':item.source==='catalog'?'rn':'eb'));section.append(card);
    }parent.append(section);
  }

function renderChatContext({item,contextBody,sourceLink,node,ui,uiAttr,live}){
    contextBody.replaceChildren();contextBody.append(sourceLink('chat.location.back',item.passageId));
    const choice=node('select','library-chat-layer-choice');uiAttr(choice,'aria-label','chat.textVersion');
    for(const [value,id]of [['original','lo'],['literal','ll'],['interpretive','li']]){const option=ui('option','',id);option.value=value;choice.append(option);}choice.value='original';
    const sourceHost=node('div');contextBody.append(choice,sourceHost);
    const paint=()=>{const key=choice.value;
      const block=node('div','library-chat-source'),value=item[key],status=item.translationStatus?.[key],label=node('p','library-chat-source-label');
      label.append(ui('span','',({original:'lo',literal:'ll',interpretive:'li'})[key]));if(key!=='original'&&status==='draft')label.append(ui('span','','ds'));
      const className=key==='original'?'library-chat-original':'';
      block.append(label,value?node('p',className,value):ui('p',className,'t.nr'));sourceHost.replaceChildren(block);
    };live(choice,'change',paint);paint();
}

function renderChatReferences({parent,refs,node,ui,sourceLink,createUiMessage,paintFor,ownerRow,bookId}){if(!refs?.length)return;const references=node('details','library-chat-references'),summary=node('summary'),refsMsg=createUiMessage(text=>{summary.textContent=text;});refsMsg.set('chat.referencesCount',{count:refs.length});paintFor(ownerRow,()=>refsMsg.refresh());references.append(summary);for(const ref of refs){const quote=node('blockquote','',ref.quote),label=node('span','library-chat-source-label');label.append(ui('span','',({original:'lo',literal:'ll',interpretive:'li'})[ref.layer]||'lo'));if(ref.translationStatus==='draft')label.append(ui('span','','ds'));quote.append(label,sourceLink('backToQuote',ref.passageId,ref.bookId||bookId));references.append(quote);}parent.append(references);}
function addAnswerFold({answer,heading,copy,summary,ui,live,t}){
 if(summary.length<=1200)return;
          const content=[...answer.children].filter(n=>n!==heading&&n!==copy),fold=ui('button','library-chat-text-button library-chat-answer-toggle','chat.answer.collapse');fold.type='button';fold.setAttribute('aria-expanded','true');
          live(fold,'click',()=>{const collapsed=fold.getAttribute('aria-expanded')==='true';for(const n of content)n.hidden=collapsed;fold.setAttribute('aria-expanded',String(!collapsed));const id=collapsed?'chat.answer.expand':'chat.answer.collapse';fold.setAttribute('data-ui',id);fold.textContent=t(id);});answer.append(fold);
        }
renderChatMarkdown.decorations=Object.freeze({addAnswerFold,activityLabel:(tool,t)=>t('chat.activity.'+activityKey(tool)),renderReferences:renderChatReferences,renderActivity:renderChatActivity,renderRecommendations:renderChatRecommendations,renderContext:renderChatContext});
