import {fail} from './document-import.mjs';
async function open(bytes){
 await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false,disableFontFace:true});
 try{return {task,document:await task.promise};}catch(error){await task.destroy();throw fail(error.name==='PasswordException'?'这份 PDF 已加密，请先提供解锁后的副本。':'PDF 无法读取，请检查文件是否完整。',422);}
}
export async function inspectNativePdf(bytes){
 const {task,document}=await open(bytes),pages=[];let total=0;
 try{
  if(document.numPages>1200)throw fail('这份 PDF 超过当前单本 1200 页的处理容量。',413);
  for(let i=1;i<=document.numPages;i++){
   const page=await document.getPage(i),content=await page.getTextContent();let text='',lastY=null;
   for(const item of content.items){if(typeof item.str!=='string')continue;const y=item.transform[5];if(lastY!==null&&Math.abs(y-lastY)>item.height*1.8)text+='\n\n';else if(lastY!==null&&Math.abs(y-lastY)>2)text+='\n';text+=item.str+(item.hasEOL?'\n':' ');lastY=y;}
   text=text.trim();total+=text.length;if(total>8000000)throw fail('这份 PDF 的文字量超过当前单本处理容量，原文件仍保留。',413);
   const letters=(text.match(/[\p{L}\p{N}]/gu)||[]).length,bad=(text.match(/[\ufffd\ue000-\uf8ff]/gu)||[]).length;
   pages.push({page:i,text,needsRecognition:letters<8||bad>Math.max(1,text.length*.01)});page.cleanup();
  }
  return {pages};
 }finally{await task.destroy();}
}
export async function nativePdfOutline(bytes){
 const {task,document}=await open(bytes);try{
  const nodes=await document.getOutline(),rows=[];
  const walk=async list=>{for(const node of list||[]){let dest=node.dest;if(typeof dest==='string')dest=await document.getDestination(dest);if(Array.isArray(dest)&&dest[0]&&typeof node.title==='string'){try{const page=await document.getPageIndex(dest[0])+1;if(page>=1&&page<=document.numPages&&node.title.trim().length<=120)rows.push({page,title:node.title.trim()});}catch{}}await walk(node.items);}};
  await walk(nodes);const unique=rows.filter((r,i)=>r.title&&(!i||r.page>rows[i-1].page));return unique.length>=2&&unique.length<=200?unique:[];
 }finally{await task.destroy();}
}
