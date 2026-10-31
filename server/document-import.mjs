import path from 'node:path';
import {extractEpub} from './epub-import.mjs';
import {createHash} from 'node:crypto';
import {inferSourceLanguage} from '../app/source-language.mjs';
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const MAX_FILE_BYTES=256*1024*1024;

export async function extractDocument({filename,bytes,onProgress}){
  if(typeof filename!=='string'||!filename.trim()||filename.length>240||!Buffer.isBuffer(bytes)||!bytes.length)throw fail('请选择有内容的书籍文件');
  if(bytes.length>MAX_FILE_BYTES||!filename.toLowerCase().endsWith('.pdf')&&bytes.length>20*1024*1024)throw fail('PDF 最多 256 MB，EPUB 与文本最多 20 MB',413);
  const ext=path.extname(filename).toLowerCase();
  if(!['.pdf','.epub','.txt','.md'].includes(ext))throw fail('目前支持 PDF、EPUB、TXT 和 Markdown');
  if(ext==='.epub')return extractEpub(bytes,{onProgress});
  if(ext!=='.pdf'){
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fail('请将文本保存为 UTF-8 编码');}
    if(/[\u0000-\u0008\u000e-\u001f]/.test(text))throw fail('这个文件不是可阅读的文本');
    if(!text.trim())throw fail('文件中没有可阅读的文字');
    return {pages:[{page:null,text}],format:ext.slice(1),review:'extracted_unreviewed'};
  }
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw fail('文件内容不是有效 PDF');
  // Explicitly trace the worker into serverless bundles. PDF.js otherwise imports
  // workerSrc dynamically, which can be omitted from a deployed function.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let task,document;
  try{
    task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false,disableFontFace:true});
    document=await task.promise;
    if(document.numPages>1200)throw fail('PDF 超过当前单本 1200 页的处理容量',413);
    const pages=[];let total=0;
    for(let i=1;i<=document.numPages;i++){
      const page=await document.getPage(i),content=await page.getTextContent();
      let text='',lastY=null;
      for(const item of content.items){if(!('str' in item))continue;const y=item.transform[5];if(lastY!==null&&Math.abs(y-lastY)>item.height*1.8)text+='\n\n';else if(lastY!==null&&Math.abs(y-lastY)>2)text+='\n';text+=item.str+(item.hasEOL?'\n':' ');lastY=y;}
      total+=text.length;if(total>8_000_000)throw fail('PDF 文字量过大，请按章节拆分',413);
      pages.push({page:i,text:text.trim()});page.cleanup();
    }
    if(pages.reduce((n,p)=>n+p.text.trim().length,0)<20)throw fail('这份 PDF 没有可提取文字，可能是扫描件。请先做文字识别（OCR），或上传文字版 PDF。',422);
    return {pages,format:'pdf',review:'extracted_unreviewed'};
  }catch(error){if(error.status)throw error;throw fail(error.name==='PasswordException'?'PDF 已加密，请先解密后上传':'PDF 无法解析，请检查文件是否完整',422);}
  finally{if(task)await task.destroy();}
}

export function makeBook({bookId,filename,sourceHash,extracted,title,author='',visibility='private',sourceUrl=null,license=null}){
  const paragraphs=[];
  for(const page of extracted.pages){
    const blocks=page.blocks?.map(b=>b.text)||page.text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(x=>x.replace(/([^\n])\n(?=[^\n])/g,'$1 ').trim()).filter(Boolean);
    for(const [blockIndex,block] of blocks.entries()){
      // Bound a single translation context without throwing away any source text.
      const parts=block.match(/[\s\S]{1,5000}(?:\s|$)|[\s\S]{1,5000}/g)||[];
      for(const [partIndex,original] of parts.entries())paragraphs.push({id:(page.blocks?.[blockIndex]?.id? page.blocks[blockIndex].id+(parts.length>1?'-'+partIndex:''):null)||`${sourceHash.slice(0,16)}-p${String(paragraphs.length+1).padStart(5,'0')}`,original:original.trim(),translations:{},source:{pdfPage:page.page,printedPage:null,review:extracted.review,...(page.href?{href:page.href,blockIndex,elementId:page.blocks?.[blockIndex]?.elementId||null,elementIds:page.blocks?.[blockIndex]?.elementIds||[]}:{}),...(page.blocks?.[blockIndex]?{bbox:page.blocks[blockIndex].bbox,type:page.blocks[blockIndex].type,processor:extracted.processor}: {})},annotationIds:[],termIds:[]});
    }
  }
  if(!paragraphs.length)throw fail('没有找到可阅读的段落');
  const chapters=[],sections=[];let structure='automatic_groups';
  let epubCuts=[];
  if(extracted.format==='epub'){
    const starts=new Map(),anchors=new Map();for(const [i,p] of paragraphs.entries()){if(!starts.has(p.source.href))starts.set(p.source.href,i);for(const id of p.source.elementIds||[]){const key=p.source.href+'#'+id;if(!anchors.has(key))anchors.set(key,i);}}
    const seen=new Set();for(const nav of extracted.navigation||[]){const at=nav.fragment?anchors.get(nav.href+'#'+nav.fragment):starts.get(nav.href);if(at!==undefined&&!seen.has(at)){seen.add(at);epubCuts.push({at,title:nav.title});}}
    epubCuts.sort((a,b)=>a.at-b.at);
    if(epubCuts.length)structure='epub_navigation';
    else{epubCuts=extracted.pages.map(page=>({at:starts.get(page.href),title:page.title})).filter(row=>row.at!==undefined);structure='epub_spine';}
  }
  const outline=(extracted.outline||[]).filter((r,i,all)=>Number.isSafeInteger(r.page)&&r.page>=1&&typeof r.title==='string'&&r.title.trim()&&r.title.length<=120&&(!i||r.page>all[i-1].page));
  let cuts=epubCuts.length?epubCuts:outline.length>=2?outline.map(r=>({at:paragraphs.findIndex(p=>p.source.pdfPage>=r.page),title:r.title.trim()})).filter(r=>r.at>=0):[];
  if(extracted.format!=='epub'&&cuts.length>=2)structure='pdf_outline';
  else if(extracted.format!=='epub'){cuts=paragraphs.flatMap((p,i)=>['doc_title','paragraph_title','section_title'].includes(p.source.type)&&p.original.length<=100&&/^(?:第.{1,8}[章节篇部]|(?:chapter|part|book)\s+[IVX\d]+)/iu.test(p.original)?[{at:i,title:p.original}]:[]);if(cuts.length>=2&&cuts.length<=200)structure='source_headings';else cuts=[];}
  if(cuts.length){if(cuts[0].at>0)cuts.unshift({at:0,title:'卷首'});for(let i=0;i<cuts.length;i++){const row=cuts[i],number=i+1,id='ch'+String(number).padStart(2,'0');chapters.push({id,number,kind:'source-section',title:{zh:row.title,en:''}});sections.push({number,chapterId:id,title:row.title,paragraphs:paragraphs.slice(row.at,cuts[i+1]?.at??paragraphs.length)});}}

  for(let i=0;!cuts.length&&i<paragraphs.length;i+=30){const number=chapters.length+1,id='ch'+String(number).padStart(2,'0');chapters.push({id,number,title:{zh:paragraphs.length<=30?'开始阅读':`阅读片段 ${number}`,en:''}});sections.push({number,chapterId:id,title:'自动分段 · 原文未逐段校对',paragraphs:paragraphs.slice(i,i+30)});}
  const text=paragraphs.slice(0,10).map(p=>p.original).join('');
  return {bookId,contentVersion:extracted.contentVersion||sourceHash,title:{zh:title||extracted.title||path.basename(filename,path.extname(filename)),en:title||extracted.title||path.basename(filename,path.extname(filename))},author:author||extracted.author||'',visibility,sourceLanguage:inferSourceLanguage(text),targetLanguage:'zh',source:{filename:path.basename(filename),sha256:sourceHash,format:extracted.format,url:sourceUrl,license,review:extracted.review,structure,...(extracted.publicationDate?{publicationDate:extracted.publicationDate}:{}),...(extracted.processor?{processor:extracted.processor,pages:extracted.pages.length,quality:extracted.quality}: {})},chapters,sections,annotations:[],glossary:[],createdAt:new Date().toISOString()};
}
