const variantLabel=variant=>variant==='literal'?'直译':'意译';
const translatedText=(passage,variant)=>{const text=passage.translations?.[variant]?.text;return typeof text==='string'&&text.trim()?text:null;};
import {sourceEmphasisRanges,sliceEmphasisRanges,emphasisSourceRuns,emphasisDisplayRuns,sourceEmphasisEligible} from './source-emphasis.mjs';

// Missing versions never borrow another translation or relabel the original.
export function visibleQuoteLanguage(passage,{mode,variant='interpretive',translationHidden=false}={},selectedLayer=null){
  if(selectedLayer==='en'||selectedLayer==='zh')return selectedLayer;
  return mode==='en'||translationHidden||!translatedText(passage,variant)?'en':'zh';
}
export function passagePresentation(passage,{mode='zh',variant='interpretive',sourceLanguage='en',sourceEmphasis=false}={}){
  const original={kind:'original',text:passage.original,lang:sourceLanguage==='zh'?'zh-Hans':sourceLanguage||'und',label:'原文',...(passage.source?.presentation==='preformatted'?{preformatted:true}:{}),...(Array.isArray(passage.source?.lineBreaks)?{lineBreaks:passage.source.lineBreaks}:{}),...(sourceEmphasis?{emphasis:sourceEmphasisRanges(passage.original)}:{})};
  if(mode==='en'||passage.kind==='source_heading')return {layers:[original],notice:null};
  const text=translatedText(passage,variant),label=variantLabel(variant);
  if(!text)return {layers:[mode==='parallel'||sourceLanguage==='zh'?original:{...original,fallback:true}],notice:null};
  const translation={kind:'translation',text,lang:'zh-Hans',label};
  return {layers:mode==='parallel'?[original,translation]:[translation],notice:null};
}

// A BR adds a visual line boundary without inserting characters into quoted text.
// Conservative emphasis is presentation over full immutable source ranges: the
// hidden marker text nodes and real em content keep every raw UTF-16 character
// in the DOM exactly once, while visible rendering and native copy omit the
// syntax markers. Selection/highlight offsets continue to address the raw
// source string, including through overlapping highlight repaints.
const sourceLineation=new WeakMap();
const emElement=(document,text)=>{const node=document.createElement('em');node.className='source-emphasis';node.append(document.createTextNode(text));return node;};
const markerElement=(document,text)=>{const node=document.createElement('span');node.className='source-syntax';if(node.setAttribute)node.setAttribute('aria-hidden','true');node.append(document.createTextNode(text));return node;};
// Build presentation nodes for a window [start,end) of the full immutable
// source. Emphasis ranges stay registered in full-source coordinates and are
// intersected with the segment start; a detached segment is never reparsed.
export function sourcePresentationNodes(document,text,emphasis=[],{start=0,lineBreaks=[]}={}){
  const children=[],breaks=(!Array.isArray(lineBreaks)?[]:lineBreaks).filter(b=>Number.isSafeInteger(b)&&b>start&&b<=start+text.length).map(b=>b-start).sort((a,b)=>a-b);
  const runs=emphasisSourceRuns(text,sliceEmphasisRanges(Array.isArray(emphasis)?emphasis:[],start,start+text.length));
  let offset=0,bi=0;
  for(const run of runs){
    const from=offset,to=offset+run.text.length;offset=to;
    // A break exactly at a run boundary belongs outside hidden markers and
    // em wrappers so the verse line stays visible in every layer.
    while(bi<breaks.length&&breaks[bi]===from){children.push(document.createElement('br'));bi++;}
    const container=run.marker?markerElement(document,run.text):run.italic?emElement(document,run.text):null;
    const parts=[];let cursor=from;
    while(bi<breaks.length&&breaks[bi]<to){const b=breaks[bi++];if(b>cursor)parts.push(document.createTextNode(text.slice(cursor,b)),document.createElement('br'));else parts.push(document.createElement('br'));cursor=b;}
    if(cursor<to||!parts.length&&!container)parts.push(document.createTextNode(text.slice(cursor,to)));
    if(container){container.replaceChildren(...parts);children.push(container);}else children.push(...parts);
  }
  if(!children.length)children.push(document.createTextNode(''));
  while(bi<breaks.length){bi++;children.push(document.createElement('br'));}
  return children;
}
export function sourceLineatedNodes(node,text,start=0,document=node.ownerDocument){
 const info=sourceLineation.get(node)||{};
 return sourcePresentationNodes(document,text,info.emphasis||[],{start,lineBreaks:info.lineBreaks||[]});
}

// GET-186/190 quote panel presentation — the exact helper renderPanelSource
// uses. A saved slice is formatted from its full immutable source only when
// the snapshot identity, integer bounds and raw slice all validate against
// that source. A historical excerpt whose saved text no longer matches the
// current source stays literal and is never re-tokenized as a stale detached
// fragment. Inter-part joins and raw saved strings are preserved; the
// returned displayText is the presented excerpt (markers omitted exactly
// where formatting was valid) for accessible naming.
export function quotePanelSourceNodes(document,{book=null,snapshot=null,parts=[],originalFor=null,join='　'}={}){
  const identity=!snapshot||!!book&&snapshot.bookId===book.bookId&&snapshot.contentVersion===book.contentVersion;
  const eligible=sourceEmphasisEligible(book),nodes=[],pieces=[],formatted=[];
  for(const [index,part] of (Array.isArray(parts)?parts:[]).entries()){
    if(index){nodes.push(document.createTextNode(join));pieces.push(join);}
    const text=typeof part?.text==='string'?part.text:'';
    const full=typeof originalFor==='function'?originalFor(part):null;
    const valid=identity&&eligible&&part?.language==='en'&&typeof full==='string'&&Number.isInteger(part.start)&&Number.isInteger(part.end)&&part.start>=0&&part.end>=part.start&&part.end<=full.length&&full.slice(part.start,part.end)===text;
    if(valid){
      const ranges=sourceEmphasisRanges(full);
      nodes.push(...sourcePresentationNodes(document,text,ranges,{start:part.start}));
      pieces.push(emphasisDisplayRuns(text,sliceEmphasisRanges(ranges,part.start,part.end)).map(run=>run.text).join(''));
    }else{nodes.push(document.createTextNode(text));pieces.push(text);}
    formatted.push(valid);
  }
  if(!nodes.length)nodes.push(document.createTextNode(''));
  return {nodes,displayText:pieces.join(''),formatted};
}
export function applySourceLineation(node,offsets,document=node.ownerDocument,emphasis=[]){
 const text=node.textContent;
 if(!Array.isArray(offsets)||!offsets.length||offsets.length>1000||offsets.some((n,i)=>!Number.isSafeInteger(n)||n<=0||n>=text.length||i>0&&n<=offsets[i-1]||/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n]))){offsets=null;}
 const ranges=Array.isArray(emphasis)?emphasis.filter(r=>r&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=text.length&&!(/[\uD800-\uDBFF]/.test(text[r.start-1]||'')&&/[\uDC00-\uDFFF]/.test(text[r.start]||''))&&!(/[\uD800-\uDBFF]/.test(text[r.end-1]||'')&&/[\uDC00-\uDFFF]/.test(text[r.end]||''))):[];
 sourceLineation.set(node,{lineBreaks:offsets?[...offsets]:[],emphasis:ranges});node.replaceChildren(...sourceLineatedNodes(node,text,0,document));
}
