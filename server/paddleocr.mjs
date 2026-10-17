import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fail} from './document-import.mjs';
export const PADDLE_MODEL='PaddleOCR-VL-1.6';
// Flatten only observed Chinese print-emphasis wrappers. Real formulae stay
// untouched, and the raw provider payload remains the audit source.
function readableContent(value){
 const transforms=[];
 const text=value.replace(/(\${1,2})([^$]*?)\1/g,(full,delimiter,inner)=>{
  if(/^\s*(?:\\underset\{\\cdot\}\{[\u3400-\u9fff]{1,32}\}\s*)+$/.test(inner)){transforms.push('chinese-dot-emphasis-v1');return inner.replace(/\\underset\{\\cdot\}\{([\u3400-\u9fff]+)\}/g,'$1').replace(/\s/g,'');}
  const note=inner.match(/^\s*\^\{([①-⑳])\}\s*$/);if(note){transforms.push('circled-note-marker-v1');return note[1];}return full;
 });
 return {text:text.replace(/([\u3400-\u9fff，。；：！？、])\r?\n(?=[\u3400-\u9fff，。；：！？、])/g,'$1').replace(/\r?\n/g,' ').trim(),transforms:[...new Set(transforms)]};
}
export function normalizePaddlePage(page,number){
 const raw=page.prunedResult;if(!raw||!Array.isArray(raw.parsing_res_list)||!Number.isFinite(raw.width)||!Number.isFinite(raw.height)||raw.width<=0||raw.height<=0)throw fail('识别结果缺少页面结构，未发布不完整书籍',502);
 const discarded=[],blocks=[];
 for(const b of raw.parsing_res_list){
  if(['header','footer','number','header_image','footer_image'].includes(b.block_label)||b.block_label==='aside_text'&&/^\s*\d{1,4}\s*$/.test(b.block_content||'')&&Array.isArray(b.block_bbox)&&(b.block_bbox[2]<raw.width*.22||b.block_bbox[0]>raw.width*.78)){discarded.push(b);continue;}
  if(typeof b.block_content!=='string')throw fail('识别结果文字格式无效',502);
  const {text,transforms}=readableContent(b.block_content);
  if(!text)continue;
  const a=b.block_bbox;const bbox=Array.isArray(a)&&a.length===4&&a.every(Number.isFinite)?a.map((x,i)=>Math.max(0,Math.min(1,x/(i%2?raw.height:raw.width)))):null;
  blocks.push({id:randomUUID(),text,type:b.block_label||'text',bbox,providerOrder:b.block_order??null,transforms});
 }
 return {page:number,text:blocks.map(b=>b.text).join('\n\n'),blocks,discarded,blank:blocks.length===0};
}
export function createPaddleProvider({env=process.env,client:injected}={}){
 if(!injected&&!env.PADDLEOCR_ACCESS_TOKEN)return null;
 let promise;const client=()=>promise??=(injected?Promise.resolve(injected):import('@paddleocr/api-sdk').then(({PaddleOCRClient})=>new PaddleOCRClient({token:env.PADDLEOCR_ACCESS_TOKEN,baseUrl:'https://paddleocr.aistudio-app.com',requestTimeout:45000,pollTimeout:60000})));
 return {
  async submit(bytes,{batchId}={}){const dir=await mkdtemp(path.join(os.tmpdir(),'leafhour-ocr-'));try{const file=path.join(dir,'pages.pdf');await writeFile(file,bytes,{mode:0o600});return await (await client()).submitDocumentParsing({filePath:file,model:PADDLE_MODEL,batchId,options:{useDocOrientationClassify:false,useDocUnwarping:false,markdownIgnoreLabels:['header','footer','number','header_image','footer_image']}});}finally{await rm(dir,{recursive:true,force:true});}},
  async recover(batchId){const found=await (await client()).getBatchStatus(batchId);if(found.jobs.length!==1)return null;return {jobId:found.jobs[0].jobId,model:PADDLE_MODEL,task:'document_parsing',batchId};},
  async status(handle){return (await client()).getStatus(handle.jobId);},
  async result(handle){return (await client()).waitDocumentParsingResult(handle);}
 };
}
