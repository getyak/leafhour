// GET-190 conservative source-emphasis presentation.
//
// One pure tokenizer runs over the FULL immutable source string. It only
// decides presentation ranges; source text, saved excerpts, share model text
// and every offset convention keep their raw UTF-16 characters unchanged.
//
// Supported subset: conservative single-underscore emphasis (`_content_`) for
// eligible default public plain-text catalog originals. This is not a Markdown
// renderer and claims no CommonMark conformance. Escaped (`\ _`), unmatched,
// intraword (including astral letters and combining marks), double (`__x__`),
// code-span, path, URL and link underscores stay safe literal text. Nothing
// here parses, creates or executes HTML.

const wordChar=/[\p{L}\p{N}\p{M}_]/u,space=/\s/u;
// Conservative path/URL boundary characters: an underscore glued to these is
// part of a path, query or fragment, never an emphasis delimiter. Sentence
// punctuation after a closer (,.;:?! quotes and brackets) stays normal prose.
const pathStartChars='/\\?#&=:%+@~',pathEndChars='/\\#&=';
const highSurrogate=/[\uD800-\uDBFF]/,lowSurrogate=/[\uDC00-\uDFFF]/;
// Word boundaries address full Unicode code points so astral letters and
// combining marks keep underscore runs intraword.
const codePointBefore=(text,i)=>{if(i<=0)return '';let k=i-1;if(k>0&&highSurrogate.test(text[k-1])&&lowSurrogate.test(text[k]))k--;return text.slice(k,i);};
const codePointAt=(text,i)=>{if(i>=text.length)return '';return highSurrogate.test(text[i])&&i+1<text.length?text.slice(i,i+2):text[i];};

// Eligibility follows public metadata and source type only: the default
// public plain-text catalog originals. Private uploads (PDF/EPUB/code/data
// strings) and structured or translated sources remain literal.
export function sourceEmphasisEligible(book){
  return !!book&&book.visibility==='public'&&typeof book.source?.format==='string'&&book.source.format==='txt';
}

// Paired same-length backtick runs mark conservative code spans whose
// underscores never become delimiters. Unpaired backticks are literal text.
function codeMask(text){
  const mask=new Uint8Array(text.length),runs=[];
  for(let i=0;i<text.length;){if(text[i]!=='`'){i++;continue;}let j=i;while(text[j]==='`')j++;runs.push([i,j]);i=j;}
  const used=new Array(runs.length).fill(false);
  for(let i=0;i<runs.length;i++){if(used[i])continue;for(let j=i+1;j<runs.length;j++){
    if(used[j]||runs[j][1]-runs[j][0]!==runs[i][1]-runs[i][0])continue;
    used[i]=used[j]=true;for(let k=runs[i][1];k<runs[j][0];k++)mask[k]=1;break;}}
  return mask;
}

// Conservative path/URL/link literal regions: markdown links and bare URLs
// keep every underscore literal. A pair whose delimiters or content cross such
// a region stays literal too.
function linkMask(text){
  const mask=new Uint8Array(text.length);
  // Keep recognizable link labels literal even when the destination contains
  // balanced parentheses. This is conservative masking, not Markdown parsing.
  for(const label of text.matchAll(/\[[^\[\]]*\]/g)){
    const next=label.index+label[0].length;let end=-1;
    if(text[next]==='['){const close=text.indexOf(']',next+1);if(close>=0&&!text.slice(next+1,close).includes('['))end=close+1;}
    if(text[next]==='('){
      let depth=0;
      for(let i=next;i<text.length;i++){
        if(text[i]==='\\'){i++;continue;}
        if(text[i]==='(')depth++;
        else if(text[i]===')'&&--depth===0){end=i+1;break;}
      }
    }
    if(end>=0)for(let k=label.index;k<end;k++)mask[k]=1;
  }
  for(const pattern of [/(?:https?|ftp):\/\/\S+/g,/www\.\S+/g])
    for(const match of text.matchAll(pattern))for(let k=match.index;k<match.index+match[0].length;k++)mask[k]=1;
  return mask;
}
function literalMask(text){
  const mask=codeMask(text),links=linkMask(text);
  for(let i=0;i<mask.length;i++)mask[i]=mask[i]||links[i];
  return mask;
}

// Full-source content ranges for conservative single-underscore emphasis.
// Markers live at start-1 and end in the same immutable string. Ranges never
// overlap, never split a surrogate pair and address UTF-16 offsets.
export function sourceEmphasisRanges(text){
  if(typeof text!=='string'||!text.includes('_'))return [];
  const literal=literalMask(text),length=text.length,ranges=[];
  const escaped=i=>i>0&&text[i-1]==='\\';
  const crossesLiteral=(from,to)=>{for(let k=from;k<to;k++)if(literal[k])return true;return false;};
  const isOpener=i=>text[i]==='_'&&!escaped(i)&&!literal[i]&&(i===0||!wordChar.test(codePointBefore(text,i))&&!pathStartChars.includes(text[i-1]))&&i+1<length&&!space.test(text[i+1])&&text[i+1]!=='_';
  const isCloser=(i,j)=>text[j]==='_'&&!escaped(j)&&!literal[j]&&!space.test(text[j-1])&&text[j-1]!=='_'&&(j+1>=length||!wordChar.test(codePointAt(text,j+1))&&!pathEndChars.includes(text[j+1]))&&!text.slice(i+1,j).includes('`')&&!crossesLiteral(i+1,j);
  for(let i=0;i<length;i++){
    if(!isOpener(i))continue;
    // Content may not contain an underscore, so only the next underscore can
    // close this opener; anything else makes the whole opener literal.
    const j=text.indexOf('_',i+1);
    if(j<0)return ranges;
    if(j>i+1&&isCloser(i,j)){ranges.push({start:i+1,end:j});i=j;}
  }
  return ranges;
}

// Re-express full-source ranges inside a slice window [start,end). A marker
// belongs to the slice only when its own character lies inside the window, so
// a selection whose delimiters sit partly outside still formats correctly.
export function sliceEmphasisRanges(ranges,start=0,end=Infinity){
  if(!Array.isArray(ranges))return [];
  const windowEnd=Number.isFinite(end)?end:Infinity,out=[];
  for(const range of ranges){
    if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.end<=range.start||range.start<start&&range.end<start)continue;
    const open=range.start-1>=start&&range.start-1<windowEnd,close=range.end>=start&&range.end<windowEnd;
    const from=Math.max(range.start,start),to=Math.min(range.end,windowEnd);
    if(to<from||to===from&&!open&&!close)continue;
    out.push({start:from-start,end:Math.min(to,windowEnd)-start,open,close});
  }
  return out;
}

// Decompose a slice into presentation runs that cover every character of the
// slice exactly once, in order. Marker runs are the hidden syntax delimiters;
// italic runs are real emphasis content; everything else is plain text.
export function emphasisSourceRuns(text,ranges){
  const runs=[];if(typeof text!=='string')return runs;
  const add=(value,italic,marker)=>{if(!value)return;const last=runs[runs.length-1];if(last&&last.italic===italic&&last.marker===marker)last.text+=value;else runs.push({text:value,italic,marker});};
  let cursor=0;
  for(const range of Array.isArray(ranges)?ranges:[]){
    if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end))continue;
    const start=Math.max(0,Math.min(range.start,text.length)),end=Math.max(start,Math.min(range.end,text.length));
    if(start<cursor)continue;
    const open=!!range.open&&start>0,close=!!range.close&&end<text.length;
    add(text.slice(cursor,open?start-1:start),false,false);
    if(open)add('_',false,true);
    add(text.slice(start,end),true,false);
    if(close)add('_',false,true);
    cursor=close?end+1:end;
  }
  add(text.slice(cursor),false,false);
  return runs;
}

// Visible presentation: the same runs with syntax markers omitted. Saved or
// exported strings never use this — it exists for DOM/canvas display only.
export function emphasisDisplayRuns(text,ranges){
  return emphasisSourceRuns(text,ranges).filter(run=>!run.marker);
}
