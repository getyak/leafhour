// Sharing uses existing paragraph alignment; it never guesses a translation for a selected phrase.
import {sourceEmphasisEligible,sourceEmphasisRanges,sliceEmphasisRanges,emphasisSourceRuns,emphasisDisplayRuns} from './source-emphasis.mjs';
export {sourceEmphasisEligible,sourceEmphasisRanges,sliceEmphasisRanges,emphasisSourceRuns,emphasisDisplayRuns};
export const shareThemes={
 paper:{paper:'#f9f9f7',ink:'#222720',muted:'#777c73',line:'#dddeda',context:'#80877a'},
 warm:{paper:'#f5efe4',ink:'#39352e',muted:'#867e70',line:'#dcd2c1',context:'#918878'},
 night:{paper:'#1e2521',ink:'#edf0e8',muted:'#a2afa3',line:'#3b463e',context:'#a8b5a7'}
};
export const shareFonts={zh:'"Songti SC", "STSong", "Noto Serif CJK SC", serif',en:'"Leafhour Serif", Georgia, "Times New Roman", serif',ui:'-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'};
// Honest fallback boundary: when the self-hosted faces did not load, drawing
// and measurement both use this plain serif stack instead of claiming real
// italic rendering.
export const shareFontFallbacks={zh:shareFonts.zh,en:'Georgia, "Times New Roman", serif',ui:shareFonts.ui};
// Canvas text never triggers a font load by itself, so the upright AND italic
// faces are loaded explicitly before the first measurement.
export async function ensureShareFonts(fonts,{family='Leafhour Serif',size=48}={}){
  const fallback={family,upright:false,italic:false,fallback:true};
  if(!fonts||typeof fonts.load!=='function')return fallback;
  try{
    const [upright,italic]=await Promise.all([fonts.load('normal '+size+'px "'+family+'"'),fonts.load('italic '+size+'px "'+family+'"')]);
    return {family,upright:!!upright?.length,italic:!!italic?.length,fallback:!(upright?.length&&italic?.length)};
  }catch{return fallback;}
}
// Display representation shared by the canvas, its accessible description and
// the quote panel: markers are omitted exactly where presentation formatting
// is valid. Canonical model/snapshot text never uses this.
export function displayQuoteText(text,emphasis){
  if(!Array.isArray(emphasis)||!emphasis.length)return text;
  return emphasisDisplayRuns(text,emphasis).map(run=>run.text).join('');
}
export function normaliseShareOptions(raw={}){
 const one=(v,values,fallback)=>values.includes(v)?v:fallback;
 return {language:one(raw.language,['zh','en','bilingual'],'zh'),variant:one(raw.variant,['literal','interpretive'],'interpretive'),theme:one(raw.theme,Object.keys(shareThemes),'paper'),ratio:one(raw.ratio,['portrait','square','story'],'portrait'),layout:one(raw.layout,['stack','columns'],'stack'),above:one(raw.above,['hide','fade','keep'],'fade'),below:one(raw.below,['hide','fade','keep'],'fade'),size:Number.isFinite(Number(raw.size))?Math.max(32,Math.min(56,Number(raw.size))):48,source:raw.source!==false};
}
export function textFor(p,language,variant='interpretive'){return language==='en'?p.original:p.translations?.[variant]?.text;}
const validBoundary=(s,n)=>n===0||n===s.length||!(s.charCodeAt(n-1)>=0xD800&&s.charCodeAt(n-1)<=0xDBFF&&s.charCodeAt(n)>=0xDC00&&s.charCodeAt(n)<=0xDFFF);
export function buildShareModel(book,snapshot,rawOptions={}){
 const options=normaliseShareOptions(rawOptions);
 if(!snapshot||snapshot.bookId!==book.bookId||snapshot.contentVersion!==book.contentVersion)throw Error('摘录的书籍或版本已改变，请重新选择。');
 if(!Array.isArray(snapshot.parts)||!snapshot.parts.length||snapshot.parts.length>8)throw Error('请选择一到八段正文。');
 if(new Set(snapshot.parts.map(p=>p.language)).size!==1||!['zh','en'].includes(snapshot.parts[0].language))throw Error('请选择同一种语言的正文，再开启双语分享。');
 const rows=book.sections.flatMap(s=>s.paragraphs.map(p=>({...p,section:s.number,chapterId:s.chapterId}))),index=new Map(rows.map((p,i)=>[p.id,{p,i}]));
 let characters=0,previous=-1;
 const blocks=snapshot.parts.map(part=>{
  const found=index.get(part.passageId);
  if(!found||found.p.chapterId!==snapshot.chapterId||found.i<=previous)throw Error('摘录不能跨章节或重复段落。');previous=found.i;
  const p=found.p,source=textFor(p,part.language,part.variant);
  if(typeof source!=='string'||!Number.isInteger(part.start)||!Number.isInteger(part.end)||part.start<0||part.end<=part.start||part.end>source.length||!validBoundary(source,part.start)||!validBoundary(source,part.end)||source.slice(part.start,part.end)!==part.text)throw Error('摘录无法对应当前原文或译文，请重新选择。');
  characters+=part.text.length;if(characters>4000)throw Error('摘录较长，请将选择控制在4000字以内。');
  const full=part.start===0&&part.end===source.length;
  const originalLabel=book.sourceLanguage==='zh'?'中文原文':'英文原文';
  // Presentation only: full immutable source ranges for eligible originals.
  // The saved text fields above keep their raw UTF-16 characters and offsets.
  const emphasisOf=(language,text,start,end)=>language==='en'&&sourceEmphasisEligible(book)?{emphasis:sliceEmphasisRanges(sourceEmphasisRanges(text),start,end)}:{};
  const selected={text:part.text,language:part.language,label:part.language==='en'?originalLabel:(part.variant==='literal'?'直译':'意译')+' · 草稿',wholeCounterpart:false,...emphasisOf(part.language,source,part.start,part.end)};
  const counterpart=(language,variant)=>{const text=textFor(p,language,variant);if(typeof text!=='string'||!text.trim())throw Error('这段对应译文尚未准备好。');const name=language==='en'?originalLabel:variant==='literal'?'直译':'意译';return {text,language,label:name+(full?'':' · 对应整段')+(language==='zh'?' · 草稿':''),wholeCounterpart:!full,...emphasisOf(language,text,0,text.length)};};
  const desired=options.language==='bilingual'?part.language:options.language;
  const unchanged=desired===part.language&&(desired==='en'||options.variant===part.variant);
  const primary=unchanged?selected:counterpart(desired,options.variant);
  const secondary=options.language==='bilingual'?counterpart(part.language==='zh'?'en':'zh',options.variant):null;
  return {passageId:p.id,primary,secondary,selectionAligned:unchanged,section:p.section,page:p.source?.printedPage,sourceStart:part.start,sourceEnd:part.end,sourceLanguage:part.language,sourceVariant:part.variant};
 });
 const first=blocks[0],last=blocks.at(-1),a=index.get(first.passageId),z=index.get(last.passageId);
 const adjacent=(i,language)=>{const p=rows[i];return p?.chapterId===snapshot.chapterId?textFor(p,language,options.variant)||'':'';};
 const beforeSource=textFor(a.p,first.primary.language,options.variant)||'',afterSource=textFor(z.p,last.primary.language,options.variant)||'';
 const sameFirst=first.selectionAligned,sameLast=last.selectionAligned;
  // Context presentation keeps full-source provenance: the raw before/after
  // strings are never stripped or reparsed, and each context window gets its
  // own independent range window into its own full original.
 const adjacentInfo=(i,language)=>{const text=adjacent(i,language);return text?{text,full:text,start:0,end:text.length}:null;};
 const beforePick=(sameFirst&&beforeSource.slice(0,first.sourceStart))?{text:beforeSource.slice(0,first.sourceStart),full:beforeSource,start:0,end:first.sourceStart}:adjacentInfo(a.i-1,first.primary.language);
 const afterPick=(sameLast&&afterSource.slice(last.sourceEnd))?{text:afterSource.slice(last.sourceEnd),full:afterSource,start:last.sourceEnd,end:afterSource.length}:adjacentInfo(z.i+1,last.primary.language);
 const before=beforePick?beforePick.text:'',after=afterPick?afterPick.text:'';
 const contextEmphasis=(pick,language)=>pick&&language==='en'&&sourceEmphasisEligible(book)?sliceEmphasisRanges(sourceEmphasisRanges(pick.full),pick.start,pick.end):undefined;
 const chapter=book.chapters.find(c=>c.id===snapshot.chapterId);
 return {bookId:book.bookId,contentVersion:book.contentVersion,title:book.title?.zh||book.title?.en||'书籍摘录',author:typeof book.author==='string'?book.author:'',location:(book.source?.structure==='automatic_groups'?'阅读片段 '+(chapter?.number||''):'第 '+(chapter?.number||'')+' 章')+' · §'+first.section+(last.section!==first.section?'–'+last.section:'')+(first.page?' · 原书 '+first.page+' 页':''),blocks,before,after,beforeEmphasis:contextEmphasis(beforePick,first.primary.language),afterEmphasis:contextEmphasis(afterPick,last.primary.language),contextLanguage:first.primary.language,attribution:first.primary.label,selectedCharacters:characters};
}
export function paragraphSnapshot(book,p,chapterId,language='zh',variant='interpretive'){
 const text=textFor(p,language,variant);if(!text?.trim())throw Error('这段文字尚未准备好。');
 return {bookId:book.bookId,contentVersion:book.contentVersion,chapterId,parts:[{passageId:p.id,language,variant,start:0,end:text.length,text}]};
}
export function captureDOMSelection(selection,paragraphMap,book){
 if(!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
 const range=selection.getRangeAt(0),prose=[...document.querySelectorAll('.passage p[data-reading-layer]')];
 const parts=[];
 for(const node of prose){
  if(!node.getClientRects().length||!range.intersectsNode(node))continue;
  let start=0,end=node.textContent.length;
  if(node.contains(range.startContainer)){const prefix=range.cloneRange();prefix.selectNodeContents(node);prefix.setEnd(range.startContainer,range.startOffset);start=prefix.toString().length;}
  if(node.contains(range.endContainer)){const prefix=range.cloneRange();prefix.selectNodeContents(node);prefix.setEnd(range.endContainer,range.endOffset);end=prefix.toString().length;}
  const value=node.textContent.slice(start,end);if(!value.trim())continue;
  start+=value.length-value.trimStart().length;end-=value.length-value.trimEnd().length;
  const p=paragraphMap.get(node.closest('.passage').dataset.id);if(!p)return null;
  parts.push({passageId:p.id,language:node.dataset.readingLayer==='original'?'en':node.lang==='en'?'en':'zh',variant:node.dataset.variant||'interpretive',start,end,text:node.textContent.slice(start,end)});
 }
 if(!parts.length)return null;
 const snapshot={bookId:book.bookId,contentVersion:book.contentVersion,chapterId:paragraphMap.get(parts[0].passageId).chapterId,parts};
 buildShareModel(book,snapshot,{language:parts[0].language,variant:parts[0].variant});return snapshot;
}
export function wrapText(text,measure,maxWidth){
 const lines=[];
 const segments=new Intl.Segmenter(undefined,{granularity:'word'}),graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 for(const paragraph of text.split('\n')){
  const tokens=[...segments.segment(paragraph)].map(s=>s.segment);let line='';for(const [i,segment]of tokens.entries()){
   const closing=/^[，。！？；：、）】》」』]/u;
   if(line&&closing.test(tokens[i+1]||'')&&measure(line+segment+tokens[i+1])>maxWidth&&measure(segment+tokens[i+1])<=maxWidth){lines.push(line);line='';}
   if(measure(line+segment)<=maxWidth){line+=segment;continue;}
   if(line&&closing.test(segment)){const chars=[...graphemes.segment(line)].map(s=>s.segment),tail=chars.pop();if(chars.length)lines.push(chars.join(''));line=tail+segment;continue;}
   // Soft wraps stay at word/space boundaries: a space that would start the
   // next line trails the previous line instead. Canonical text is unchanged.
   if(line&&/^\s+$/u.test(segment)){line+=segment;lines.push(line);line='';continue;}
   if(line){lines.push(line);line='';}
   if(measure(segment)<=maxWidth){line=segment;continue;}
   for(const {segment:g}of graphemes.segment(segment)){if(line&&measure(line+g)>maxWidth){lines.push(line);line='';}line+=g;}
  }lines.push(line);
 }
 return lines;
}
// Mixed-style wrapping for emphasized display runs: each candidate string is
// measured whole in the same style it is drawn (never summed per grapheme),
// explicit '\n' hard breaks always break the layout, soft wraps stay at
// word/space boundaries, and every display character stays in exactly one
// line token. Markers are already excluded from display runs.
export function wrapEmphasisRuns(runs,measure,maxWidth){
 const segments=new Intl.Segmenter(undefined,{granularity:'word'}),graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 const lines=[];let line=[],width=0,endedWithBreak=false;
 const flush=(force=false)=>{if(line.length||force)lines.push(line);line=[];width=0;};
 const wrapSegment=segmentRuns=>{
  const tokens=[];
  for(const run of segmentRuns){if(!run.text)continue;for(const part of segments.segment(run.text))tokens.push({text:part.segment,italic:!!run.italic});}
  for(const token of tokens){
   const tokenWidth=measure(token.text,token.italic);
   if(line.length&&width+tokenWidth>maxWidth){
    if(/^\s+$/u.test(token.text)){line.push(token);flush();continue;}
    flush();
   }
   if(tokenWidth>maxWidth&&[...token.text].length>1){
    let piece='',pieceWidth=0;
    for(const grapheme of graphemes.segment(token.text)){
     const candidate=piece+grapheme.segment,candidateWidth=measure(candidate,token.italic);
     if(piece&&candidateWidth>maxWidth){line.push({text:piece,italic:token.italic});width+=pieceWidth;flush();piece=grapheme.segment;pieceWidth=measure(piece,token.italic);continue;}
     piece=candidate;pieceWidth=candidateWidth;
    }
    if(piece){line.push({text:piece,italic:token.italic});width+=pieceWidth;}
    continue;
   }
   line.push(token);width+=tokenWidth;
  }
 };
 let segment=[];
 for(const run of Array.isArray(runs)?runs:[]){
  let text=run.text||'';
  for(;;){
   const at=text.indexOf('\n'),piece=at<0?text:text.slice(0,at);
   if(piece){segment.push({text:piece,italic:!!run.italic});endedWithBreak=false;}
   if(at<0)break;
   wrapSegment(segment);flush(true);endedWithBreak=true;segment=[];text=text.slice(at+1);
  }
 }
 wrapSegment(segment);flush(endedWithBreak);
 return lines;
}
// Display-adapter trim only: whitespace at the two ends of a presented context
// never belongs to the quote itself.
export function trimDisplayRuns(runs){
 const out=(Array.isArray(runs)?runs:[]).filter(run=>run.text).map(run=>({...run}));
 while(out.length){const text=out[0].text.replace(/^\s+/u,'');if(text){out[0].text=text;break;}out.shift();}
 while(out.length){const text=out[out.length-1].text.replace(/\s+$/u,'');if(text){out[out.length-1].text=text;break;}out.pop();}
 return out.filter(run=>run.text);
}
// Reserve real drawn width for the ellipsis, trimming only the hidden edge of
// context. Both plain and styled contexts stay within two lines; canonical
// source/model strings are untouched.
function contextEllipsis(runs,side,measure,maxWidth){
 const line=runs.filter(run=>run.text).map(run=>({...run}));
 const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 for(;;){
  const edge=side==='above'?line[0]:line.at(-1),italic=!!edge?.italic;
  const width=line.reduce((sum,run)=>sum+measure(run.text,run.italic),0);
  if(width+measure('…',italic)<=maxWidth){const marker={text:'…',italic};return side==='above'?[marker,...line]:[...line,marker];}
  if(!edge)return [];
  const parts=[...graphemes.segment(edge.text)].map(part=>part.segment);
  if(side==='above')parts.shift();else parts.pop();
  edge.text=parts.join('');
  if(!edge.text){if(side==='above')line.shift();else line.pop();}
 }
}
export function layoutShareCard(model,rawOptions,measure){
 const options=normaliseShareOptions(rawOptions),width=1080,margin=104,usable=width-margin*2,items=[],font=options.size;let y=0;
 const text=(value,x,w,size,language,kind,extra={},emphasis=null)=>{const styled=Array.isArray(emphasis)&&emphasis.length?wrapEmphasisRuns(emphasisDisplayRuns(value,emphasis),(run,italic)=>measure(run,size,language,italic),w):null,lines=styled?styled.map(line=>line.map(run=>run.text).join('')):wrapText(value,t=>measure(t,size,language),w),lineHeight=size*(language==='en'?1.48:1.72),height=lines.length*lineHeight;const item={kind,x,y,width:w,fontSize:size,language,lines,lineHeight,height,...extra,...(styled?{runs:styled}:{})};items.push(item);return item;};
 const context=(value,side,mode,emphasis=null)=>{if(mode==='hide'||!value.trim())return;
  const size=font*.72,language=model.contextLanguage,lineHeight=size*(language==='en'?1.48:1.72);
  const measured=(run,italic)=>measure(run,size,language,italic);
  const wrapped=Array.isArray(emphasis)&&emphasis.length
   ?wrapEmphasisRuns(trimDisplayRuns(emphasisDisplayRuns(value,emphasis)),measured,usable)
   :wrapText(value.trim(),run=>measured(run,false),usable).map(line=>[{text:line,italic:false}]);
  const visible=side==='above'?wrapped.slice(-2):wrapped.slice(0,2);
  if(wrapped.length>2){const index=side==='above'?0:visible.length-1;visible[index]=contextEllipsis(visible[index],side,measured,usable);}
  const lines=visible.map(line=>line.map(run=>run.text).join('')),height=lines.length*lineHeight;
  items.push({kind:'context',x:margin,y,width:usable,fontSize:size,language,lines,lineHeight,height,mode,side,runs:visible});y+=height+48;
 };
 context(model.before,'above',options.above,model.beforeEmphasis);
 for(const [i,block]of model.blocks.entries()){
  if(i)y+=48;
  const start=y,column=options.layout==='columns'&&block.secondary;
  if(block.primary.wholeCounterpart){items.push({kind:'label',x:margin,y,width:usable,fontSize:19,lineHeight:30,height:30,lines:[block.primary.label],language:'ui'});y+=42;}
  const primary=text(block.primary.text,margin,column?(usable-56)/2:usable,font,block.primary.language,'quote',{},block.primary.emphasis);y+=primary.height;
  if(block.secondary){
   const secondaryX=column?margin+(usable+56)/2:margin,secondaryY=column?start:y+48;
   if(!column)items.push({kind:'rule',x:margin,y:y+27,width:42,height:1});
   const endPrimary=y;y=secondaryY;
   items.push({kind:'label',x:secondaryX,y,width:column?(usable-56)/2:usable,fontSize:19,lineHeight:30,height:30,lines:[block.secondary.label],language:'ui'});y+=40;
   const secondary=text(block.secondary.text,secondaryX,column?(usable-56)/2:usable,column?font*.82:font*.69,block.secondary.language,'translation',{},block.secondary.emphasis);y+=secondary.height;y=Math.max(y,endPrimary);
  }
 }
 if(options.below!=='hide'&&model.after.trim()){y+=54;context(model.after,'below',options.below,model.afterEmphasis);y-=48;}
 const bodyHeight=y,base={portrait:1350,square:1080,story:1920}[options.ratio],footerHeight=options.source?156:66,height=Math.max(base,Math.ceil(bodyHeight+footerHeight+216));
 if(height>6400)throw Error('双语摘录较长，请缩小字号或减少选中的段落。');
 const top=104+Math.max(0,(height-footerHeight-208-bodyHeight)/2);
 for(const item of items)item.y+=top;
 return {width,height,items,footerY:height-footerHeight,extended:height>base,quoteCharacters:model.blocks.reduce((n,b)=>n+b.primary.text.length+(b.secondary?.text.length||0),0),options};
}
