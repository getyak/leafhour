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
